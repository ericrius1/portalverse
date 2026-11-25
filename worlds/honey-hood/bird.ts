import * as THREE from 'three/webgpu';
import { mesh, type Resources } from './tools';

export interface BirdModel {
  group: THREE.Group;
  flap(elapsed: number): void;
}

/** A plump red songbird facing +Z. */
export function createBird(res: Resources): BirdModel {
  const group = new THREE.Group();
  group.name = 'bird';
  const body = res.mat('#e4432f');
  const dark = res.mat('#8f2318', { side: THREE.DoubleSide });
  const ball = res.geo(new THREE.SphereGeometry(1, 16, 12));
  const cone = res.geo(new THREE.ConeGeometry(1, 1, 8));

  group.add(
    mesh(ball, body, [0, 0, 0], [0.34, 0.32, 0.55]),
    mesh(ball, body, [0, 0.23, 0.48], [0.25, 0.25, 0.25]),
  );
  const beak = mesh(cone, res.mat('#ffae1f'), [0, 0.2, 0.8], [0.09, 0.26, 0.09]);
  beak.rotation.x = Math.PI / 2;
  const tail = mesh(cone, dark, [0, 0.05, -0.68], [0.26, 0.55, 0.06]);
  tail.rotation.x = Math.PI / 2;
  group.add(beak, tail);
  for (const side of [-1, 1]) {
    group.add(mesh(ball, res.mat('#120c08'), [side * 0.18, 0.3, 0.65], [0.055, 0.055, 0.055]));
  }

  const wingGeo = res.geo(new THREE.CircleGeometry(1, 16));
  wingGeo.rotateX(-Math.PI / 2);
  const wings = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.25, 0.08, 0);
    pivot.add(mesh(wingGeo, dark, [side * 0.45, 0, 0], [0.5, 1, 0.24]));
    group.add(pivot);
    return { pivot, side };
  });

  return {
    group,
    flap(elapsed) {
      for (const wing of wings) wing.pivot.rotation.z = wing.side * Math.sin(elapsed * 17) * 0.8;
    },
  };
}

const FEATHERS = 28;
const FEATHER_SECONDS = 2;

/** The puff of feathers left behind when a bird is eaten. */
export function createFeathers(res: Resources, rand: () => number) {
  const feathers = new THREE.InstancedMesh(
    res.geo(new THREE.CircleGeometry(0.16, 6).scale(0.45, 1, 1)),
    res.mat('#ff6a4d', { side: THREE.DoubleSide, emissive: '#451008' }),
    FEATHERS,
  );
  feathers.name = 'feathers';
  feathers.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const origin = new THREE.Vector3();
  const velocities = Array.from({ length: FEATHERS }, () =>
    new THREE.Vector3(rand() - 0.5, rand() - 0.25, rand() - 0.5).multiplyScalar(5));
  let age = FEATHER_SECONDS;

  const update = (dt: number) => {
    age = Math.min(FEATHER_SECONDS, age + dt);
    const spread = 1 - Math.exp(-age * 2.2);
    velocities.forEach((velocity, i) => {
      dummy.position.copy(origin).addScaledVector(velocity, spread * 0.6);
      dummy.position.y -= age * age * 0.6;
      dummy.rotation.set(age * velocity.x, age * velocity.y, i);
      dummy.scale.setScalar(1 - age / FEATHER_SECONDS);
      dummy.updateMatrix();
      feathers.setMatrixAt(i, dummy.matrix);
    });
    feathers.instanceMatrix.needsUpdate = true;
  };
  update(0);

  return {
    mesh: feathers,
    burst(at: { x: number; y: number; z: number }) {
      origin.set(at.x, at.y, at.z);
      age = 0;
    },
    update,
  };
}
