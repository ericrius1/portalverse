import * as THREE from 'three/webgpu';
import { color, float, instancedDynamicBufferAttribute, mix, sin, smoothstep, time, uv } from 'three/tsl';
import type { Resources } from './materials';

export type PuffKind = 'cold' | 'fire';

export interface PuffSpec {
  at: THREE.Vector3;
  vel: THREE.Vector3;
  /** Starting size (m) and how many times bigger it gets by the end. */
  size: number;
  grow: number;
  life: number;
  /** Slowing per second (0 = none) and upward drift (m/s²). */
  drag?: number;
  rise?: number;
}

interface Puff {
  age: number;
  life: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: number;
  grow: number;
  drag: number;
  rise: number;
  spin: number;
  turn: number;
  seed: number;
}

/**
 * A pool of soft, camera-facing puffs that live in the room: frosty smoke (`cold`) or rolling
 * fire (`fire`, additive, white-hot at first, cooling to orange and deep red). Each puff carries
 * its own fade, seed and age to the shader, so they swirl differently and change colour as they go.
 */
export function createPuffs(res: Resources, kind: PuffKind, count: number, rand: () => number) {
  const data = new Float32Array(count * 3);
  const attr = new THREE.InstancedBufferAttribute(data, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  const per = instancedDynamicBufferAttribute(attr, 'vec3') as unknown as THREE.Node<'vec3'>;
  const fade = per.x;
  const seed = per.y;
  const age = per.z;

  const fire = kind === 'fire';
  const mat = res.own(new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  const q = uv().sub(0.5);
  const swirl = sin(q.x.mul(9).add(seed.mul(6.3)).add(time.mul(fire ? 3 : 0.9)).add(sin(q.y.mul(7).sub(seed.mul(3)))))
    .mul(sin(q.y.mul(8).sub(seed.mul(4.1)).sub(time.mul(fire ? 2.4 : 0.7)).add(sin(q.x.mul(5).add(seed)))))
    .mul(0.5).add(0.5);
  const soft = smoothstep(float(0.5), float(0.06), q.length());
  if (fire) {
    // White-hot core, then orange, then a dull red as it cools and thins.
    const c = (hex: string) => color(new THREE.Color(hex));
    const hot = mix(c('#fff2b0'), c('#ff8a1a'), smoothstep(float(0), float(0.35), age));
    const cooled = mix(hot, c('#8a1a06'), smoothstep(float(0.35), float(1), age));
    const core = soft.mul(swirl.mul(0.7).add(0.3));
    mat.colorNode = cooled.mul(core).mul(fade).mul(2.2);
  } else {
    mat.colorNode = mix(color(new THREE.Color('#9fcff0')), color(new THREE.Color('#f2fbff')), swirl.mul(soft));
    mat.opacityNode = soft.mul(swirl.mul(0.6).add(0.4)).mul(fade).mul(0.5);
  }

  const mesh = new THREE.InstancedMesh(res.geo(new THREE.PlaneGeometry(1, 1)), mat, count);
  mesh.name = fire ? 'fire-breath' : 'cold-breath';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;

  const pool: Puff[] = Array.from({ length: count }, () => ({
    age: -1, life: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), size: 1, grow: 1, drag: 0, rise: 0, spin: 0, turn: 0, seed: 0,
  }));
  let next = 0;
  const dummy = new THREE.Object3D();
  const qz = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  return {
    mesh,
    emit(spec: PuffSpec) {
      const puff = pool[next++ % count];
      puff.age = 0;
      puff.life = spec.life;
      puff.p.copy(spec.at);
      puff.v.copy(spec.vel);
      puff.size = spec.size;
      puff.grow = spec.grow;
      puff.drag = spec.drag ?? 0;
      puff.rise = spec.rise ?? 0;
      puff.spin = rand() * Math.PI * 2;
      puff.turn = (rand() - 0.5) * (fire ? 3 : 1.2);
      puff.seed = rand() * 10;
    },
    update(dt: number, camera?: THREE.Camera) {
      let any = false;
      pool.forEach((puff, i) => {
        let f = 0;
        let t = 0;
        if (puff.age >= 0) {
          puff.age += dt;
          if (puff.age > puff.life) puff.age = -1;
          else {
            any = true;
            t = puff.age / puff.life;
            puff.v.multiplyScalar(Math.max(0, 1 - puff.drag * dt));
            puff.v.y += puff.rise * dt;
            puff.p.addScaledVector(puff.v, dt);
            // Fire flares in fast and burns out; smoke swells in gently and thins away.
            f = fire ? Math.min(1, t * 12) * (1 - t) ** 1.4 : Math.sin(Math.PI * t) ** 1.3;
            dummy.position.copy(puff.p);
            if (camera) dummy.quaternion.copy(camera.quaternion);
            else dummy.quaternion.identity();
            dummy.quaternion.multiply(qz.setFromAxisAngle(zAxis, puff.spin + puff.turn * puff.age));
            dummy.scale.setScalar(puff.size * (1 + t * (puff.grow - 1)));
          }
        }
        if (f <= 0) dummy.scale.setScalar(0);
        data[i * 3] = f;
        data[i * 3 + 1] = puff.seed;
        data[i * 3 + 2] = t;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.visible = any;
      mesh.instanceMatrix.needsUpdate = true;
      attr.needsUpdate = true;
    },
  };
}
