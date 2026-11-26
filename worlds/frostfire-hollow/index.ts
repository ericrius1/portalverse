import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { createCave } from './cave';
import { createEffects, type Wind } from './effects';
import {
  PLATE_RADIUS,
  PLATE_TOP,
  SWITCHES,
  WALK_RX,
  WALK_RZ,
  YELL_PUSH,
  createBurn,
  createClimate,
  createMonster as createMonsterState,
  createPlates,
  createSlide,
  createYell,
  flip,
  gustDirection,
  gustStrength,
  slideStep,
  stage,
  stepBurn,
  stepClimate,
  stepMonster,
  stepPlates,
  stepYell,
  walkHeight,
  yellPhase,
} from './logic';
import { createMagic } from './magic';
import { createClimateUniforms, createResources } from './materials';
import { createMonster } from './monster';
import { createPath } from './path';
import { createRubble } from './rubble';
import { createSwitches } from './switches';

/**
 * FROSTFIRE HOLLOW (`frostfire-hollow`)
 * A lava cave where a broken basalt path splits around a hole in the floor. A grumpy lava
 * monster lives in the hole, follows you as you pass, and now and then roars at you hard enough
 * to blow you off the path. Walk through the lava and you catch fire. Step on the plate by
 * either switch to flip the whole cave to ice (the lava drains, a cold gust blows, the path
 * knits together under snow, icicles grow and the lakes freeze slippery), and back again. The
 * switch starts on fire at every mount and isn't saved.
 */
export default defineRoom('frostfire-hollow', {
  async mount(ctx) {
    const res = createResources();
    const u = createClimateUniforms();
    const rand = seededRandom(1337);
    const root = new THREE.Group();
    ctx.scene.add(root);
    const background = new THREE.Color('#1e0a06');
    ctx.scene.background = background;
    const fog = new THREE.FogExp2(background.getHex(), 0.014);
    ctx.scene.fog = fog;

    ctx.setTerrainHeight(walkHeight);
    for (const s of SWITCHES) {
      ctx.addPlatform({
        minX: s.plate.x - PLATE_RADIUS * 0.7, maxX: s.plate.x + PLATE_RADIUS * 0.7,
        minZ: s.plate.z - PLATE_RADIUS * 0.7, maxZ: s.plate.z + PLATE_RADIUS * 0.7,
        topY: PLATE_TOP,
      });
    }
    ctx.setWalkBounds({ minX: -WALK_RX, maxX: WALK_RX, minZ: -WALK_RZ, maxZ: WALK_RZ });

    const climate = createClimate();
    const slide = createSlide();
    const plates = createPlates();
    const monster = createMonsterState();
    const yell = createYell(rand);
    const burn = createBurn();
    let shove: [number, number] = [0, 0];
    let frameDt = 1 / 60;
    ctx.setCollider({
      move: (from, to, radius) => slideStep(slide, climate, from, to, radius, frameDt, shove),
    });

    const cave = await createCave(res, u);
    await ctx.breathe();
    const path = createPath(res, u);
    await ctx.breathe();
    const monsterView = createMonster(res, u, rand);
    await ctx.breathe();
    const switches = createSwitches(res);
    const effects = createEffects(res, u, rand);
    const magic = createMagic(res, u, rand);
    const rubble = createRubble(res, u, rand);
    root.add(cave.group, path.group, monsterView.group, monsterView.drops, switches.group, effects.group, magic.group, rubble.mesh);
    await ctx.breathe();

    const wind: Wind = { strength: 0, dir: [0, 1], warm: 0 };
    let ringTimer = 0;
    // The thaw is violent: when the cave turns back from ice to lava, the ground quakes.
    let quake = 0;
    let quakeAge = 0;
    let lastMode = climate.mode;
    const chestAt = new THREE.Vector3();
    const update = (dt: number, elapsed: number) => {
      frameDt = Math.min(1 / 20, Math.max(1 / 240, dt || 1 / 60));
      const feet = ctx.player?.position ?? null;
      if (stepPlates(plates, feet)) flip(climate, SWITCHES[plates.on].plate);
      stepClimate(climate, dt);
      if (climate.mode !== lastMode) {
        if (climate.mode === 'fire') { quake = 1; quakeAge = 0; }
        lastMode = climate.mode;
      }
      u.drain.value = stage(climate.frost, 0, 0.4);
      u.ice.value = stage(climate.frost, 0.3, 1);
      // The lava sinks away as it drains, and the ice settles back up at the old level.
      u.lakeDip.value = 0.3 * Math.sin(Math.PI * climate.frost);
      cave.fogColor(u.ice.value as number, background);
      fog.color.copy(background);

      const spot = feet ? { x: feet.x, z: feet.z } : null;
      stepMonster(monster, dt, elapsed, spot);
      shove = stepYell(yell, dt, rand, monster, spot);
      const phase = yellPhase(yell);
      monsterView.update(monster, dt, elapsed, phase, spot);
      // Shockwave rings while he roars.
      if (phase.roar > 0.5 && yell.t > 0) {
        ringTimer -= dt;
        if (ringTimer <= 0) {
          effects.shockwave(monsterView.mouth, yell.dir, feet ? chestAt.set(feet.x, feet.y + 1.1, feet.z) : undefined);
          ringTimer = 0.22;
        }
      } else ringTimer = 0;

      stepBurn(burn, dt, climate.frost, feet);
      switches.update(climate.mode, plates.on, dt);
      cave.update(climate.frost, elapsed);
      path.update(climate);
      magic.update(elapsed);

      // The wind past the player: the roar's blast when there is one, otherwise the cold gust.
      const blast = Math.hypot(shove[0], shove[1]) / YELL_PUSH;
      const gust = gustStrength(climate);
      if (blast > gust && feet) {
        wind.strength = blast;
        wind.dir = yell.dir;
        // The roar brings its own breath; no gust smoke around the player.
        wind.warm = 1;
      } else {
        wind.strength = gust;
        wind.dir = feet ? gustDirection(feet.x, feet.z) : [0, 1];
        wind.warm = 0;
      }
      // His breath: smouldering from his jaws as he draws in, then a jet of fire (or freezing
      // smoke) roaring at you.
      const breath = phase.roar > 0.05 ? 0.5 + 0.5 * phase.roar : phase.windup * 0.4;
      effects.breath(dt, monsterView.mouth, feet ? chestAt.set(feet.x, feet.y + 1.1, feet.z) : null, breath, (u.ice.value as number) > 0.5);
      effects.update(dt, elapsed, wind, feet, burn.level, ctx.player?.camera);

      // Shake the camera after the engine has placed it this frame (it's set fresh every frame,
      // so the offset never builds up). A quick jolt, a rumble while the lava surges back, then
      // it settles over about 3.5 s.
      let amp = 0;
      if (quake > 0) {
        quakeAge += dt;
        const jolt = Math.min(1, quakeAge / 0.12);
        amp = quake * jolt * (quakeAge < 1.2 ? 1 : Math.max(0, 1 - (quakeAge - 1.2) / 2.3));
        if (amp <= 0) quake = 0;
      }
      // Rocks shaken loose from the ceiling rain down while it shakes.
      rubble.update(dt, amp, spot);
      const cam = ctx.player?.camera;
      if (cam && amp > 0) {
        const t = elapsed;
        const n = (a: number, b: number, c: number) => Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.1;
        cam.position.x += n(37, 61, 97) * 0.16 * amp;
        cam.position.y += n(43, 71, 89) * 0.2 * amp;
        cam.position.z += n(31, 53, 83) * 0.16 * amp;
        cam.rotation.z += n(23, 47, 79) * 0.025 * amp;
      }
    };
    update(0, 0);
    ctx.onUpdate(update);
    ctx.onDispose(() => {
      ctx.scene.remove(root);
      root.traverse(child => {
        if ((child as THREE.InstancedMesh).isInstancedMesh) (child as THREE.InstancedMesh).dispose();
      });
      res.dispose();
    });
  },
});
