/// <reference types="vite/client" />
/**
 * CORAL REEF WALK (`jp-reef`)
 *
 * Inspired by JP's `react-fiber-sea-floor` / `longHome` / `collectivSea` scenes and
 * built from their low-poly underwater pack: a sandy path along the sea floor
 * through a coral canyon, with rippling caustic light, drifting jellyfish, schools
 * of fish, a turtle and a manta ray gliding overhead, swaying seaweed, light shafts
 * from the surface and slowly falling marine snow.
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  color,
  float,
  max,
  mix,
  modelPosition,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
} from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { disposeObject, loadGLB, seededRandom } from '@portalverse/core/rooms/kit';
import causticsUrl from './assets/collectivsea-caustics.png?url';
import { bindFogDensity, mountFogControls } from './fogControls';
import { jellyHeight, turtleSwim, raySwim, shaftEnvelope } from './creatureMotion';
import { createWaterLight, WATER_COLOR, WATER_FOG_NEAR, WATER_FOG_FAR, type CausticField } from './water';

const assets = import.meta.glob<string>('./assets/*.glb', { query: '?url', import: 'default', eager: true });
const asset = (name: string): string => {
  const url = assets[`./assets/${name}.glb`];
  if (!url) throw new Error(`jp-reef: missing asset ${name}`);
  return url;
};

const PATH_HALF_WIDTH = 4;
const ROOM_HALF_LENGTH = 46;

/** Sea floor: flat along the path, rising into dunes and canyon walls away from it. */
function seabedHeight(x: number, z: number): number {
  const off = Math.max(0, Math.abs(x) - PATH_HALF_WIDTH);
  const dunes = Math.sin(x * 0.35 + z * 0.12) * 0.45 + Math.cos(z * 0.27 - x * 0.18) * 0.35;
  const walls = THREE.MathUtils.smoothstep(Math.abs(x), 16, 42) * 9;
  return THREE.MathUtils.smoothstep(off, 0, 3) * (0.6 + dunes) + walls;
}

function createSandMaterial(caustic: CausticField): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const p = positionWorld;
  const ripples = sin(p.x.mul(2.1).add(sin(p.z.mul(0.6)).mul(1.5))).mul(0.5).add(0.5);
  const onPath = float(1).sub(smoothstep(float(PATH_HALF_WIDTH - 1), float(PATH_HALF_WIDTH + 1.5), abs(p.x)));
  const base = mix(vec3(0.62, 0.58, 0.45), vec3(0.78, 0.74, 0.6), ripples.mul(0.5).add(onPath.mul(0.35)));
  material.colorNode = base;
  material.emissiveNode = vec3(1, 0.98, 0.87).mul(caustic()).mul(1.5);
  return material;
}

/** Swap a model's materials for node versions that catch the caustics on their upward faces. */
function causticLit(model: THREE.Object3D, caustic: CausticField, extra?: (m: THREE.MeshStandardNodeMaterial) => void): THREE.Material[] {
  const converted = new Map<THREE.Material, THREE.MeshStandardNodeMaterial>();
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.MeshStandardMaterial;
    let material = converted.get(source);
    if (!material) {
      material = new THREE.MeshStandardNodeMaterial({
        color: source.color,
        map: source.map,
        roughness: source.roughness ?? 0.85,
        metalness: source.metalness ?? 0,
        side: source.side,
      });
      material.emissiveNode = vec3(1, 0.98, 0.87)
        .mul(caustic())
        .mul(max(normalWorld.y, 0))
        .mul(1.1);
      extra?.(material);
      converted.set(source, material);
    }
    mesh.material = material;
  });
  return [...converted.values()];
}

/** Which way a model's head points along an axis, judged by where its vertices bunch up. */
function headSign(model: THREE.Object3D, axis: 'x' | 'z'): 1 | -1 {
  let sum = 0;
  let count = 0;
  const box = new THREE.Box3().setFromObject(model);
  const mid = (box.min[axis] + box.max[axis]) / 2;
  const v = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    const position = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      sum += v[axis] - mid;
      count++;
    }
  });
  return count && sum < 0 ? -1 : 1;
}

interface Swimmer {
  object: THREE.Object3D;
  phase: number;
  radius: number;
  height: number;
  speed: number;
  centerX: number;
  centerZ: number;
  stretch: number;
}

export default defineRoom('jp-reef', {
  async mount(ctx) {
    const rand = seededRandom(20261124);
    const root = new THREE.Group();
    ctx.scene.add(root);
    const templates: GLTF[] = [];
    const ownMaterials: THREE.Material[] = [];
    const ownGeometries: THREE.BufferGeometry[] = [];
    const load = async (name: string) => {
      const gltf = await loadGLB(asset(name));
      templates.push(gltf);
      return gltf.scene;
    };

    const atlas = await new THREE.TextureLoader().loadAsync(causticsUrl);
    const water = createWaterLight(atlas);
    const { caustic } = water;
    ctx.onDispose(() => atlas.dispose());
    ctx.scene.background = new THREE.Color(WATER_COLOR);
    const fog = new THREE.Fog(WATER_COLOR, WATER_FOG_NEAR, WATER_FOG_FAR);
    ctx.scene.fog = fog;
    ctx.onDispose(bindFogDensity(fog));
    ctx.onActivate(mountFogControls);
    root.add(new THREE.HemisphereLight('#c9f5ec', '#237f7e', 1.1));
    const sun = new THREE.DirectionalLight('#fff4d6', 1.2);
    sun.position.set(6, 30, 4);
    root.add(sun);

    // Sea floor
    ctx.setTerrainHeight(seabedHeight);
    ctx.addPlatform({ minX: -PATH_HALF_WIDTH, maxX: PATH_HALF_WIDTH, minZ: -ROOM_HALF_LENGTH, maxZ: ROOM_HALF_LENGTH, topY: 0 });
    const floorGeometry = new THREE.PlaneGeometry(150, 130, 110, 96);
    floorGeometry.rotateX(-Math.PI / 2);
    const floorPositions = floorGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < floorPositions.count; i++) {
      floorPositions.setY(i, seabedHeight(floorPositions.getX(i), floorPositions.getZ(i)));
    }
    floorGeometry.computeVertexNormals();
    const sandMaterial = createSandMaterial(caustic);
    root.add(new THREE.Mesh(floorGeometry, sandMaterial));
    ownGeometries.push(floorGeometry);
    ownMaterials.push(sandMaterial);

    // The surface overhead, shimmering
    const surfaceGeometry = new THREE.PlaneGeometry(220, 220);
    surfaceGeometry.rotateX(Math.PI / 2);
    const surfaceMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    surfaceMaterial.colorNode = mix(color(WATER_COLOR), color('#a4ece1'), caustic(0.65).mul(0.65));
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surface.position.y = 26;
    root.add(surface);
    ownGeometries.push(surfaceGeometry);
    ownMaterials.push(surfaceMaterial);

    // Light shafts slanting down from the surface
    const shaftGeometry = new THREE.PlaneGeometry(3.2, 30);
    const shaftMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    });
    const shaftFade = shaftEnvelope(uv().x, uv().y, positionWorld.y);
    const flicker = sin(time.mul(0.7).add(modelPosition.x.mul(0.37)).add(modelPosition.z.mul(0.21))).mul(0.35).add(0.65);
    shaftMaterial.colorNode = color('#d2fff0');
    shaftMaterial.opacityNode = shaftFade.mul(flicker).mul(0.14);
    for (let i = 0; i < 14; i++) {
      const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
      const side = i % 2 ? 1 : -1;
      shaft.position.set(side * (3 + rand() * 12), 13, -42 + i * 6.3 + rand() * 2);
      shaft.rotation.set(0.18 + rand() * 0.1, rand() * Math.PI, side * (0.25 + rand() * 0.15));
      root.add(shaft);
    }
    ownGeometries.push(shaftGeometry);
    ownMaterials.push(shaftMaterial);

    // Load every model at once
    const [reefs, corals, rocks, weeds, jellyModels, creatures] = await Promise.all([
      Promise.all(['Coral_reef_003', 'Coral_reef_004', 'Coral_reef_008', 'Coral_reef_010', 'Coral_reef_016'].map(load)),
      Promise.all(['Coral_003', 'Coral_006', 'Coral_008', 'Coral_011', 'Coral_013', 'Coral_014', 'Coral_021', 'Coral_024'].map(load)),
      Promise.all(['Rock_020', 'Rock_022', 'Rock_027', 'Rock_048'].map(load)),
      Promise.all(['Seaweed_001', 'Seaweed_002', 'Seaweed_003'].map(load)),
      Promise.all(['Medusa_001', 'Medusa_002'].map(load)),
      Promise.all(['Fish_001', 'Fish_002', 'Fish_003', 'Fish_004', 'Turtle_001', 'Skat_001'].map(load)),
    ]);

    // Corals, rocks and seaweed lining the canyon
    for (const model of [...reefs, ...corals, ...rocks]) ownMaterials.push(...causticLit(model, caustic));
    // Seaweed sways more the higher up the frond, each plant on its own beat.
    for (const model of weeds) {
      ownMaterials.push(...causticLit(model, caustic, material => {
        const height = max(positionLocal.y, 0);
        const beat = time.mul(1.3).add(modelPosition.x.mul(0.9)).add(modelPosition.z.mul(0.6));
        const sway = sin(beat.add(positionLocal.y.mul(1.2))).mul(height.mul(height)).mul(0.035);
        material.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.6)));
      }));
    }
    const place = (models: THREE.Object3D[], x: number, z: number, scale: number) => {
      const copy = models[Math.floor(rand() * models.length)].clone();
      copy.position.set(x, seabedHeight(x, z) - 0.15, z);
      copy.rotation.y = rand() * Math.PI * 2;
      copy.scale.setScalar(scale);
      root.add(copy);
    };
    for (let z = -ROOM_HALF_LENGTH; z <= ROOM_HALF_LENGTH; z += 5.5) {
      for (const side of [-1, 1]) {
        place(reefs, side * (7.5 + rand() * 6), z + rand() * 3, 0.8 + rand() * 0.6);
        place(corals, side * (4.6 + rand() * 3), z + rand() * 4, 1.4 + rand() * 1.4);
        place(corals, side * (9 + rand() * 7), z + rand() * 4, 1.8 + rand() * 1.8);
        place(rocks, side * (15 + rand() * 12), z + rand() * 4, 1.2 + rand() * 1.4);
        for (let w = 0; w < 3; w++) place(weeds, side * (4.4 + rand() * 9), z + rand() * 5, 0.9 + rand() * 0.8);
      }
    }

    // Jellyfish drifting above the path, pulsing their bells
    const [jellyA, jellyB] = jellyModels;
    const jellyMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const beat = time.mul(2.1).add(modelPosition.x.mul(1.7)).add(modelPosition.y.mul(0.9));
    const pulse = sin(beat).mul(0.5).add(0.5);
    // Asset bells sit near y=0; the tentacles extend into negative local Y.
    const bell = smoothstep(float(-0.28), float(-0.02), positionLocal.y);
    const squeeze = float(1).sub(pulse.mul(0.16).mul(bell));
    const trail = sin(beat.sub(positionLocal.y.mul(3))).mul(float(1).sub(bell)).mul(0.06);
    jellyMaterial.positionNode = vec3(
      positionLocal.x.mul(squeeze).add(trail),
      positionLocal.y.mul(float(1).add(pulse.mul(0.08).mul(bell))),
      positionLocal.z.mul(squeeze).add(trail.mul(0.7)),
    );
    jellyMaterial.colorNode = mix(vec3(0.95, 0.55, 0.95), vec3(0.6, 0.85, 1.0), bell).add(pulse.mul(0.25));
    jellyMaterial.opacityNode = float(0.32).add(bell.mul(0.3));
    for (const model of [jellyA, jellyB]) {
      model.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = jellyMaterial;
          // GPU deformation extends outside the static GLB bounds.
          mesh.geometry.computeBoundingSphere();
          mesh.geometry.boundingSphere!.radius += 0.25;
        }
      });
    }
    ownMaterials.push(jellyMaterial);
    const jellies: Array<{ object: THREE.Object3D; x: number; y: number; z: number; drift: number; phase: number }> = [];
    for (let i = 0; i < 16; i++) {
      const object = (i % 2 ? jellyA : jellyB).clone();
      const side = i % 2 ? 1 : -1;
      const jelly = {
        object,
        x: side * (2.5 + rand() * 9),
        y: 3.5 + rand() * 9,
        z: -40 + rand() * 80,
        drift: 0.15 + rand() * 0.2,
        phase: rand() * Math.PI * 2,
      };
      object.scale.setScalar(0.9 + rand() * 0.9);
      object.position.set(jelly.x, jellyHeight(jelly.y, jelly.drift, jelly.phase, 0), jelly.z);
      jellies.push(jelly);
      root.add(object);
    }

    // Schools of fish, a turtle and a manta ray circling through the canyon
    const [fishA, fishB, fishC, fishD, turtle, ray] = creatures;
    const steer = (model: THREE.Object3D, axis: 'x' | 'z', sign = headSign(model, axis)) => {
      // Turn the model so its head points down the holder's +Z, the axis Object3D.lookAt aims.
      const holder = new THREE.Group();
      model.rotation.y = axis === 'x' ? (sign > 0 ? -Math.PI / 2 : Math.PI / 2) : (sign > 0 ? 0 : Math.PI);
      holder.add(model);
      return holder;
    };
    for (const model of [fishA, fishB, fishC, fishD]) {
      ownMaterials.push(...causticLit(model, caustic, material => {
        const wiggle = sin(time.mul(11).add(positionLocal.x.mul(14)).add(modelPosition.x.mul(3.1)).add(modelPosition.z.mul(1.7)));
        material.positionNode = positionLocal.add(vec3(0, 0, wiggle.mul(0.03)));
      }));
    }
    ownMaterials.push(...causticLit(turtle, caustic, material => {
      material.positionNode = turtleSwim(water.clock);
    }), ...causticLit(ray, caustic, material => {
      material.positionNode = raySwim(water.clock);
    }));
    for (const model of [turtle, ray]) model.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.boundingSphere!.radius += 0.2;
    });
    const fishModels = [fishA, fishB, fishC, fishD].map(model => steer(model, 'x'));
    const swimmers: Swimmer[] = [];
    for (let school = 0; school < 5; school++) {
      const model = fishModels[school % fishModels.length];
      const centerZ = -30 + school * 15;
      const centerX = (school % 2 ? 1 : -1) * (5 + rand() * 4);
      for (let i = 0; i < 12; i++) {
        const object = model.clone();
        object.scale.setScalar(1.6 + rand() * 0.6);
        swimmers.push({
          object,
          phase: rand() * 0.6 + i * 0.09,
          radius: 4 + rand() * 1.6,
          height: 2.6 + rand() * 2.4,
          speed: 0.45 + rand() * 0.05,
          centerX: centerX + (rand() - 0.5) * 1.2,
          centerZ: centerZ + (rand() - 0.5) * 1.2,
          stretch: 1.6,
        });
        root.add(object);
      }
    }
    for (const [model, axis, scale, height, radius, speed, centerZ] of [
      [turtle, 'x', 2.2, 7, 11, 0.12, 10],
      [ray, 'x', 2.6, 9.5, 14, 0.09, -12],
    ] as const) {
      // Both supplied creatures face -X (the ray's long tail extends toward +X).
      const object = steer(model, axis, -1);
      object.scale.setScalar(scale);
      swimmers.push({ object, phase: rand() * 6, radius, height, speed, centerX: 0, centerZ, stretch: 2.2 });
      root.add(object);
    }

    // Marine snow
    const SNOW = 520;
    const snowGeometry = new THREE.OctahedronGeometry(0.035, 0);
    const snowMaterial = new THREE.MeshBasicMaterial({ color: '#e6fbff', transparent: true, opacity: 0.6 });
    const snow = new THREE.InstancedMesh(snowGeometry, snowMaterial, SNOW);
    const flakes = Array.from({ length: SNOW }, () => ({
      x: (rand() - 0.5) * 50, y: rand() * 22, z: (rand() - 0.5) * 92, sink: 0.15 + rand() * 0.25, phase: rand() * 6.3,
    }));
    root.add(snow);
    ownGeometries.push(snowGeometry);
    ownMaterials.push(snowMaterial);

    const dummy = new THREE.Object3D();
    const ahead = new THREE.Vector3();
    ctx.onUpdate((dt, elapsed) => {
      water.clock.value = elapsed;
      for (const jelly of jellies) {
        jelly.object.position.set(
          jelly.x + Math.sin(elapsed * 0.3 + jelly.phase) * 0.8,
          jellyHeight(jelly.y, jelly.drift, jelly.phase, elapsed),
          jelly.z + Math.cos(elapsed * 0.25 + jelly.phase) * 0.8,
        );
      }
      for (const s of swimmers) {
        const angle = elapsed * s.speed + s.phase;
        const at = (a: number, out: THREE.Vector3) => out.set(
          s.centerX + Math.cos(a) * s.radius,
          s.height + Math.sin(a * 2) * 0.4,
          s.centerZ + Math.sin(a) * s.radius * s.stretch,
        );
        at(angle, s.object.position);
        at(angle + 0.05, ahead);
        s.object.lookAt(ahead);
      }
      for (let i = 0; i < SNOW; i++) {
        const f = flakes[i];
        f.y -= f.sink * dt;
        if (f.y < 0) f.y = 22;
        dummy.position.set(f.x + Math.sin(elapsed * 0.4 + f.phase) * 0.6, f.y, f.z + Math.cos(elapsed * 0.3 + f.phase) * 0.6);
        dummy.updateMatrix();
        snow.setMatrixAt(i, dummy.matrix);
      }
      snow.instanceMatrix.needsUpdate = true;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      for (const gltf of templates) disposeObject(gltf.scene);
      for (const geometry of ownGeometries) geometry.dispose();
      for (const material of ownMaterials) material.dispose();
    });
  },
});
