import * as THREE from 'three/webgpu';
import { CAVE_RX, CAVE_RZ, CEILING_Y, LAKE_Y, WALK_RX, WALK_RZ, groundAt } from './logic';
import { rockMaterial, type ClimateUniforms, type Resources } from './materials';

const ROCKS = 70;
const GRAVITY = 20;

/** Under the lumpy dome: roughly how high the ceiling is over a spot. */
const ceilingAt = (x: number, z: number) =>
  CEILING_Y * Math.sqrt(Math.max(0, 1 - (x / (CAVE_RX + 3)) ** 2 - (z / (CAVE_RZ + 3)) ** 2));

interface Rock {
  /** -1 = free; otherwise seconds since it hit the ground. */
  landed: number;
  live: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  bounced: boolean;
  floor: number;
  lava: boolean;
}

/**
 * Rocks shaken loose from the ceiling when the cave quakes. They rain down around the player,
 * bounce once off the path (or plop into the lava) and then sink away.
 */
export function createRubble(res: Resources, u: ClimateUniforms, rand: () => number) {
  const geo = res.geo(new THREE.DodecahedronGeometry(1, 0));
  const mesh = new THREE.InstancedMesh(geo, rockMaterial(u, res.own), ROCKS);
  mesh.name = 'falling-rocks';
  mesh.frustumCulled = false;
  const rocks: Rock[] = Array.from({ length: ROCKS }, () => ({
    landed: -1, live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0,
    spin: new THREE.Vector3(), rot: new THREE.Euler(), bounced: false, floor: 0, lava: false,
  }));
  const dummy = new THREE.Object3D();
  let next = 0;
  let owed = 0;

  const drop = (near: { x: number; z: number }) => {
    const r = rocks[next++ % ROCKS];
    // Around the player, never right on their head.
    const a = rand() * Math.PI * 2;
    const d = 2.5 + rand() * 13;
    r.x = THREE.MathUtils.clamp(near.x + Math.cos(a) * d, -WALK_RX, WALK_RX);
    r.z = THREE.MathUtils.clamp(near.z + Math.sin(a) * d, -WALK_RZ, WALK_RZ);
    r.y = ceilingAt(r.x, r.z) - 0.6;
    r.vx = (rand() - 0.5) * 1.2;
    r.vz = (rand() - 0.5) * 1.2;
    r.vy = -rand() * 2;
    // Mostly gravel and fist-sized stones, the odd big chunk.
    r.size = 0.12 + 0.75 * rand() ** 2.4;
    r.spin.set((rand() - 0.5) * 8, (rand() - 0.5) * 8, (rand() - 0.5) * 8);
    r.rot.set(rand() * 6, rand() * 6, rand() * 6);
    const g = groundAt(r.x, r.z);
    r.lava = g.surface === 'lake';
    r.floor = g.surface === 'lake' ? LAKE_Y : g.y;
    r.bounced = false;
    r.landed = -1;
    r.live = true;
  };

  return {
    mesh,
    /** `quake` 0..1: how hard the cave is shaking. */
    update(dt: number, quake: number, player: { x: number; z: number } | null) {
      if (quake > 0 && player) {
        owed += quake * 30 * dt;
        while (owed >= 1) { owed -= 1; drop(player); }
      } else owed = 0;

      rocks.forEach((r, i) => {
        if (!r.live) {
          dummy.scale.setScalar(0);
        } else {
          if (r.landed < 0) {
            r.vy -= GRAVITY * dt;
            r.x += r.vx * dt;
            r.y += r.vy * dt;
            r.z += r.vz * dt;
            r.rot.x += r.spin.x * dt;
            r.rot.y += r.spin.y * dt;
            r.rot.z += r.spin.z * dt;
            const bottom = r.floor + r.size * 0.6;
            if (r.y < bottom) {
              if (!r.lava && !r.bounced && r.vy < -4) {
                // One hard bounce off the rock, skittering sideways.
                r.y = bottom;
                r.vy *= -0.3;
                r.vx = (rand() - 0.5) * 3;
                r.vz = (rand() - 0.5) * 3;
                r.spin.multiplyScalar(0.5);
                r.bounced = true;
              } else {
                r.y = bottom;
                r.landed = 0;
              }
            }
          } else {
            // Settled: sink into the lava (fast) or crumble away (slowly).
            r.landed += dt;
            const life = r.lava ? 0.9 : 2.5;
            const t = r.landed / life;
            r.y -= (r.lava ? 1.4 : 0.15) * dt;
            if (t >= 1) r.live = false;
          }
          const shrink = r.landed < 0 ? 1 : Math.max(0, 1 - (r.landed / (r.lava ? 0.9 : 2.5)) ** 2);
          dummy.position.set(r.x, r.y, r.z);
          dummy.rotation.copy(r.rot);
          dummy.scale.set(r.size, r.size * 0.75, r.size * 0.9).multiplyScalar(shrink);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
