import * as THREE from 'three/webgpu';
import {
  clamp,
  color,
  float,
  instancedDynamicBufferAttribute,
  mix,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
} from 'three/tsl';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { TILE_RADIUS, pathTiles, tileKnit, type Climate, type Tile } from './logic';
import { lakeMaterial, type ClimateUniforms, type Resources } from './materials';

const COLUMN_HEIGHT = 0.7;
let shared: Tile[] | undefined;
const tiles = () => (shared ??= pathTiles(seededRandom(99)));

const c = (hex: string) => color(new THREE.Color(hex));

/**
 * The path: hexagonal basalt column tops. Over the lava they're broken apart, shrunk, tilted
 * and sunk a little, with lava glowing in the cracks between. When the cave freezes they slide
 * together into one snow-covered path, in a wave out from the switch that was flipped.
 */
export function createPath(res: Resources, u: ClimateUniforms) {
  const list = tiles();
  const group = new THREE.Group();
  group.name = 'path';

  // Per-tile 0..1: how far it has knitted together (and snowed over).
  const knitArray = new Float32Array(list.length);
  const knitAttr = new THREE.InstancedBufferAttribute(knitArray, 1);
  knitAttr.setUsage(THREE.DynamicDrawUsage);
  const knit = instancedDynamicBufferAttribute(knitAttr, 'float') as unknown as THREE.Node<'float'>;

  const mat = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.9 }));
  const p = positionWorld;
  const grain = sin(p.x.mul(3.1).add(sin(p.z.mul(2.3)))).mul(sin(p.z.mul(2.7).sub(p.x.mul(1.3)))).mul(0.5).add(0.5);
  const top = clamp(normalWorld.y.mul(1.5).sub(0.4), 0, 1);
  // Local y: -1 at the column's foot, 0 at its top.
  const low = smoothstep(-0.25, -0.75, positionLocal.y);
  const rock = mix(c('#2b2220'), c('#4a3b33'), grain);
  const snow = mix(c('#dfeef8'), c('#ffffff'), grain);
  const iceSide = mix(c('#6e93ad'), c('#a9cbe0'), grain);
  const snowy = mix(iceSide, snow, top);
  mat.colorNode = mix(rock, snowy, knit);
  // Glowing undersides where they sit in the lava, fading as they knit and the lava cools.
  const heat = float(1).sub(u.drain).mul(float(1).sub(knit));
  const pulse = sin(time.mul(1.7).add(p.x.mul(0.8)).add(p.z.mul(0.6))).mul(0.25).add(0.75);
  mat.emissiveNode = c('#ff5a14').mul(low.mul(1.6).add(top.oneMinus().mul(0.25))).mul(heat).mul(pulse)
    .add(c('#6fd2ff').mul(knit.mul(top).mul(0.06)));
  mat.roughnessNode = mix(float(0.92), float(0.6), knit);

  // A hex prism whose top sits at y = 0, slightly bevelled.
  const geo = res.geo(new THREE.CylinderGeometry(TILE_RADIUS * 0.94, TILE_RADIUS, COLUMN_HEIGHT, 6, 1).translate(0, -COLUMN_HEIGHT / 2, 0));
  const columns = new THREE.InstancedMesh(geo, mat, list.length);
  columns.name = 'path-columns';
  columns.frustumCulled = false;

  // Lava in the cracks, just under the column tops.
  const lava = new THREE.InstancedMesh(
    res.geo(new THREE.CircleGeometry(TILE_RADIUS * 1.15, 6).rotateX(-Math.PI / 2)),
    lakeMaterial(u, res.own),
    list.length,
  );
  lava.name = 'path-lava';
  lava.frustumCulled = false;
  const m = new THREE.Matrix4();
  list.forEach((t, i) => {
    lava.setMatrixAt(i, m.makeTranslation(t.x, t.h - 0.22, t.z).multiply(new THREE.Matrix4().makeScale(t.size, 1, t.size)));
  });
  group.add(lava, columns);

  const dummy = new THREE.Object3D();
  let last = -1;
  const place = (climate: Climate) => {
    list.forEach((t, i) => {
      const k = tileKnit(climate, t.x, t.z);
      knitArray[i] = k;
      const b = 1 - k;
      // Broken: pushed apart, shrunk, tipped, and sunk or heaved up. Knitted: snug and level.
      dummy.position.set(t.x + t.jx * 0.12 * b, t.h + t.lift * b, t.z + t.jz * 0.12 * b);
      dummy.rotation.set(t.tilt * 0.16 * b / t.size, t.spin * 0.5 * b, t.jx * 0.12 * b / t.size);
      // Knitted, every slab is at least a full cell and overlaps its neighbours: no gaps.
      const joined = Math.max(1, t.size) * 1.07;
      const broken = t.size * (0.92 - t.shrink * 0.14);
      const s = broken + (joined - broken) * k;
      dummy.scale.set(s, 1, s);
      dummy.updateMatrix();
      columns.setMatrixAt(i, dummy.matrix);
    });
    columns.instanceMatrix.needsUpdate = true;
    knitAttr.needsUpdate = true;
  };

  return {
    group,
    update(climate: Climate) {
      // Only rebuild while the cave is changing.
      if (climate.frost === last) return;
      last = climate.frost;
      place(climate);
    },
  };
}
