import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { createBee } from './bee';
import { createBird, createFeathers } from './bird';
import { createSpeechBubble } from './bubble';
import { createDrip, createHunt, puddleSize, stepDrip, stepHunt } from './logic';
import { createGoldenPlants, createGround, createHydrant, createRoadTiles, createTrees } from './scenery';
import { createResources } from './tools';

/**
 * HONEY IN DA HOOD YA HEARD (`honey-hood`)
 * A twisty tiled road, lighting underfoot, through tall honey-dripping trees, golden plants and a fire
 * hydrant, patrolled by a giant bee in a blue jacket who eats passing birds.
 */
export default defineRoom('honey-hood', {
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);
    ctx.scene.background = new THREE.Color('#f4b866');
    ctx.scene.fog = new THREE.FogExp2('#e9ab62', 0.0095);

    const hemi = new THREE.HemisphereLight('#fff0cc', '#3d3415', 1.7);
    const sun = new THREE.DirectionalLight('#ffd28a', 2.1);
    sun.position.set(18, 30, 24);
    root.add(hemi, sun);

    const res = createResources();
    const rand = seededRandom(808);

    root.add(createGround(res));
    ctx.addPlatform({ minX: -48, maxX: 48, minZ: -46, maxZ: 46, topY: 0 });
    const tiles = createRoadTiles(res);
    const bubble = createSpeechBubble(res);
    root.add(tiles.group, bubble.sprite);
    const trees = createTrees(res, rand);
    root.add(trees.group, createGoldenPlants(res, rand), createHydrant(res));

    // Honey: each source cycles through a falling drop and a short-lived puddle.
    const drips = trees.sources.map(source => createDrip(source, rand));
    const honey = res.mat('#ffab0f', { roughness: 0.12, metalness: 0.15, emissive: '#8a4600' });
    const drops = new THREE.InstancedMesh(res.geo(new THREE.SphereGeometry(0.17, 10, 8)), honey, drips.length);
    const puddles = new THREE.InstancedMesh(
      res.geo(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2)),
      res.mat('#ffb414', { roughness: 0.1, metalness: 0.2, emissive: '#7d4200', transparent: true, opacity: 0.9 }),
      drips.length,
    );
    drops.name = 'honey-drops';
    puddles.name = 'honey-puddles';
    drops.frustumCulled = false;
    puddles.frustumCulled = false;
    const puddleRadii = drips.map(() => 0.65 + rand() * 0.75);
    root.add(drops, puddles);

    const bee = createBee(res, rand);
    const bird = createBird(res);
    const feathers = createFeathers(res, rand);
    root.add(bee.group, bird.group, feathers.mesh);
    const hunt = createHunt(rand);

    const dummy = new THREE.Object3D();
    const mouth = new THREE.Vector3();

    const update = (dt: number, elapsed: number) => {
      drips.forEach((drip, i) => {
        stepDrip(drip, dt, rand);

        const falling = drip.phase === 'falling';
        // Drops stretch as they pick up speed.
        const stretch = 1.2 + Math.min(1.6, drip.speed * 0.13);
        dummy.position.set(drip.source.x, drip.y, drip.source.z);
        dummy.scale.set(falling ? 1 : 0, falling ? stretch : 0, falling ? 1 : 0);
        dummy.updateMatrix();
        drops.setMatrixAt(i, dummy.matrix);

        const size = drip.phase === 'puddle' ? puddleSize(drip.timer) * puddleRadii[i] : 0;
        // Slightly different heights stop overlapping puddles flickering.
        dummy.position.set(drip.source.x, 0.045 + (i % 12) * 0.001, drip.source.z);
        dummy.scale.setScalar(size);
        dummy.updateMatrix();
        puddles.setMatrixAt(i, dummy.matrix);
      });
      drops.instanceMatrix.needsUpdate = true;
      puddles.instanceMatrix.needsUpdate = true;

      const event = stepHunt(hunt, dt, rand);
      const eating = hunt.mode === 'eating';
      bee.group.position.set(hunt.bee.x, hunt.bee.y, hunt.bee.z);
      bee.group.rotation.set(hunt.mode === 'hunting' ? 0.14 : 0, hunt.yaw, 0, 'YXZ');
      // Wide open as it closes in, then chomping.
      const gape = hunt.mode === 'hunting' ? 0.7 : eating ? Math.abs(Math.sin(hunt.timer * 13)) : 0;
      bee.animate(elapsed, gape);

      const prey = hunt.bird;
      bird.group.visible = !!prey;
      if (prey) {
        if (event === 'eat') feathers.burst(prey);
        if (eating) {
          // The mouthful is drawn in and shrinks away.
          mouth.set(0, -0.06, 1.5);
          bee.group.updateMatrixWorld();
          bee.group.localToWorld(mouth);
          bird.group.position.lerp(mouth, Math.min(1, dt * 14));
          bird.group.scale.setScalar(Math.max(0, hunt.timer - 0.5) * 1.6);
        } else {
          bird.group.position.set(prey.x, prey.y, prey.z);
          bird.group.rotation.y = Math.atan2(prey.vx, prey.vz);
          bird.group.scale.setScalar(1);
          bird.flap(elapsed);
        }
      }
      feathers.update(dt);
      const feet = ctx.player?.position ?? null;
      tiles.update(dt, feet);
      bubble.update(dt, feet);
    };

    update(0, 0);
    ctx.onUpdate(update);
    ctx.onDispose(() => {
      ctx.scene.remove(root);
      drops.dispose();
      puddles.dispose();
      res.dispose();
    });
  },
});
