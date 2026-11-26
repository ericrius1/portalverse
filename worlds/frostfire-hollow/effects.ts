import * as THREE from 'three/webgpu';
import { color, float, mix, positionLocal, smoothstep, uniform } from 'three/tsl';
import { CEILING_Y, LAKE_Y, WALK_RX, WALK_RZ } from './logic';
import type { ClimateUniforms, Resources } from './materials';
import { createPuffs } from './puffs';

const MOTES = 260;
const FLAMES = 48;
const RINGS = 5;

export interface Wind {
  /** 0..1 */
  strength: number;
  /** Where it blows towards, in room x/z. */
  dir: readonly [number, number];
  /** 0 = cold smoke rolls past the player (the gust); 1 = no smoke (the roar, which brings its own breath). */
  warm: number;
}

/**
 * Air in the cave: embers rising off the lava that turn into slowly falling snow; cold smoke
 * rolling past the player in the gust; the monster's fire or frost breath and the roar's
 * shockwaves; and flames licking up the player when they've walked through lava.
 */
export function createEffects(res: Resources, u: ClimateUniforms, rand: () => number) {
  const group = new THREE.Group();
  group.name = 'cave-air';
  const additive = () => res.own(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

  const moteMat = additive();
  moteMat.colorNode = mix(color(new THREE.Color('#ff8a2a')).mul(2.2), color(new THREE.Color('#e8f6ff')).mul(1.1), u.ice);
  const motes = new THREE.InstancedMesh(res.geo(new THREE.OctahedronGeometry(0.06, 0)), moteMat, MOTES);
  motes.frustumCulled = false;
  motes.name = 'motes';
  const mote = Array.from({ length: MOTES }, () => ({
    x: (rand() * 2 - 1) * WALK_RX,
    y: LAKE_Y + rand() * (CEILING_Y - 4),
    z: (rand() * 2 - 1) * WALK_RZ,
    phase: rand() * 10,
    speed: 0.5 + rand() * 0.8,
  }));

  // Cold smoke (the gust, and the ice monster's breath) and rolling fire (the lava monster's).
  const coldPuffs = createPuffs(res, 'cold', 180, rand);
  const firePuffs = createPuffs(res, 'fire', 160, rand);
  const at = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const aim = new THREE.Vector3();
  let gustOwed = 0;
  let breathOwed = 0;

  // Shockwave rings from the monster's mouth.
  const ringGeo = res.geo(new THREE.TorusGeometry(1, 0.08, 8, 40));
  const rings = Array.from({ length: RINGS }, () => {
    const mat = additive();
    const fade = uniform(0);
    mat.colorNode = mix(color(new THREE.Color('#ffb04a')).mul(2), color(new THREE.Color('#bfeaff')).mul(1.6), u.ice).mul(fade);
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, fade, age: -1, from: new THREE.Vector3(), dir: new THREE.Vector3() };
  });
  let nextRing = 0;

  // Flames on the player: little cones flickering upward around their body.
  const flameMat = additive();
  const flameLevel = uniform(0);
  const up = smoothstep(float(-0.5), float(0.5), positionLocal.y);
  flameMat.colorNode = mix(color(new THREE.Color('#ffdf6a')).mul(2.4), color(new THREE.Color('#ff3a00')).mul(1.6), up).mul(flameLevel);
  const flames = new THREE.InstancedMesh(res.geo(new THREE.ConeGeometry(0.13, 0.6, 6, 1, true)), flameMat, FLAMES);
  flames.frustumCulled = false;
  flames.name = 'player-flames';
  const flame = Array.from({ length: FLAMES }, () => ({ a: rand() * Math.PI * 2, r: 0.15 + rand() * 0.35, t: rand(), speed: 1.2 + rand() * 1.2, s: 0.6 + rand() * 0.8 }));
  const flameLight = new THREE.PointLight('#ff7a2a', 0, 7, 1.8);
  group.add(motes, coldPuffs.mesh, firePuffs.mesh, flames, flameLight);

  const dummy = new THREE.Object3D();
  const look = new THREE.Vector3();
  return {
    group,
    /**
     * The monster's breath from `mouth` toward `target`: a roaring jet of fire (or freezing
     * smoke, when he's ice) at full `strength`, a smoulder curling from his jaws at low strength.
     */
    breath(dt: number, mouth: THREE.Vector3, target: THREE.Vector3 | null, strength: number, ice: boolean) {
      if (strength <= 0.01) { breathOwed = 0; return; }
      const jet = strength > 0.5;
      breathOwed += (jet ? 75 : 10) * strength * dt;
      if (target) aim.subVectors(target, mouth).normalize();
      else aim.set(0, -0.3, 1).normalize();
      while (breathOwed >= 1) {
        breathOwed -= 1;
        at.copy(mouth).addScaledVector(aim, rand() * 0.6);
        if (jet) {
          const spread = 0.2;
          vel.set(aim.x + (rand() - 0.5) * spread, aim.y + (rand() - 0.5) * spread, aim.z + (rand() - 0.5) * spread)
            .normalize().multiplyScalar(14 + rand() * 7);
        } else {
          vel.set((rand() - 0.5) * 0.8, ice ? -0.4 : 0.8, (rand() - 0.5) * 0.8).addScaledVector(aim, 0.8);
        }
        if (ice) {
          coldPuffs.emit({ at, vel, size: jet ? 0.7 + rand() * 0.4 : 0.35, grow: jet ? 5.5 : 4, life: jet ? 1.3 + rand() * 0.6 : 1.6, drag: 1.8, rise: -0.5 });
        } else {
          firePuffs.emit({ at, vel, size: jet ? 0.55 + rand() * 0.35 : 0.3, grow: jet ? 5 : 3, life: jet ? 0.8 + rand() * 0.45 : 0.9, drag: 1.6, rise: 3 });
        }
      }
    },
    /** Sends a shockwave ring from `from` along `dir` (x/z), angled down toward `at` if given. */
    shockwave(from: THREE.Vector3, dir: readonly [number, number], at?: THREE.Vector3) {
      const ring = rings[nextRing++ % RINGS];
      ring.age = 0;
      ring.from.copy(from);
      if (at) {
        const across = Math.hypot(at.x - from.x, at.z - from.z) || 1;
        ring.dir.set(dir[0], Math.max(-1, Math.min(0.3, (at.y - from.y) / across)), dir[1]).normalize();
      } else ring.dir.set(dir[0], 0, dir[1]);
    },
    update(dt: number, elapsed: number, wind: Wind, player: THREE.Vector3 | null, burn: number, camera?: THREE.Camera) {
      const ice = u.ice.value as number;
      const rise = 0.7 * (1 - ice) - 0.6 * ice;
      const blow = wind.strength * 5;
      const [gx, gz] = wind.dir;
      mote.forEach((m, i) => {
        m.y += rise * m.speed * dt;
        m.x += (Math.sin(elapsed * 0.7 + m.phase) * 0.3 + gx * blow) * dt;
        m.z += (Math.cos(elapsed * 0.6 + m.phase) * 0.3 + gz * blow) * dt;
        if (m.y > CEILING_Y - 3) m.y = LAKE_Y;
        if (m.y < LAKE_Y) m.y = CEILING_Y - 3;
        if (Math.abs(m.x) > WALK_RX) m.x = -Math.sign(m.x) * WALK_RX;
        if (Math.abs(m.z) > WALK_RZ) m.z = -Math.sign(m.z) * WALK_RZ;
        const flicker = 0.6 + 0.4 * Math.sin(elapsed * 3 + m.phase * 5);
        dummy.position.set(m.x, m.y, m.z);
        dummy.rotation.set(elapsed + m.phase, m.phase, 0);
        dummy.scale.setScalar(flicker * (1 + ice * 0.6));
        dummy.updateMatrix();
        motes.setMatrixAt(i, dummy.matrix);
      });
      motes.instanceMatrix.needsUpdate = true;

      // The gust: cold smoke rolling out of the hollow and past the player.
      const cold = wind.strength * (1 - wind.warm);
      if (player && cold > 0.01) {
        gustOwed += cold * 34 * dt;
        const sx = -gz;
        const sz = gx;
        while (gustOwed >= 1) {
          gustOwed -= 1;
          const along = -9 - rand() * 6;
          const side = (rand() * 2 - 1) * 6;
          at.set(player.x + gx * along + sx * side, player.y + 0.2 + rand() * 2.2, player.z + gz * along + sz * side);
          vel.set(gx, 0.15, gz).multiplyScalar(5 + rand() * 4);
          coldPuffs.emit({ at, vel, size: 1.4 + rand() * 1.4, grow: 3.2, life: 1.6 + rand() * 1.2, drag: 0.5, rise: 0.2 });
        }
      } else gustOwed = 0;
      coldPuffs.update(dt, camera);
      firePuffs.update(dt, camera);

      for (const ring of rings) {
        if (ring.age < 0) continue;
        ring.age += dt;
        const life = 0.9;
        if (ring.age > life) {
          ring.age = -1;
          ring.mesh.visible = false;
          continue;
        }
        const t = ring.age / life;
        ring.mesh.visible = true;
        ring.mesh.position.copy(ring.from).addScaledVector(ring.dir, ring.age * 16);
        look.copy(ring.mesh.position).add(ring.dir);
        ring.mesh.lookAt(look);
        ring.mesh.scale.setScalar(0.6 + t * 4.5);
        ring.fade.value = (1 - t) ** 1.5;
      }

      flameLevel.value = burn;
      flames.visible = burn > 0.01 && !!player;
      flameLight.intensity = burn * 22 * (0.8 + 0.2 * Math.sin(elapsed * 17));
      if (flames.visible && player) {
        flameLight.position.set(player.x, player.y + 1, player.z);
        flame.forEach((f, i) => {
          f.t += dt * f.speed;
          if (f.t > 1) f.t -= 1;
          const a = f.a + elapsed * 0.8;
          const r = f.r * (1 - f.t * 0.5);
          dummy.position.set(player.x + Math.cos(a) * r, player.y + f.t * 1.9, player.z + Math.sin(a) * r);
          dummy.rotation.set(Math.sin(elapsed * 9 + i) * 0.2, 0, Math.cos(elapsed * 7 + i) * 0.2);
          const s = f.s * Math.sin(Math.PI * f.t) * burn;
          dummy.scale.set(s, s * (1.2 + Math.sin(elapsed * 13 + i) * 0.3), s);
          dummy.updateMatrix();
          flames.setMatrixAt(i, dummy.matrix);
        });
        flames.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
