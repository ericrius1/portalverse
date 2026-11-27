import * as THREE from 'three/webgpu';
import { breathe, seededRandom } from '@portalverse/core/rooms/kit';
import {
  CAVE_RX,
  CAVE_RZ,
  CEILING_Y,
  HOLE_RADIUS,
  ISLANDS,
  LAKE_Y,
  PATH_HALF_WIDTH,
  POOL_Y,
  RIM_RADIUS,
  RIM_Y,
  SWITCHES,
  groundAt,
  pathAt,
  smooth,
  stage,
} from './logic';
import { icicleMaterial, lakeMaterial, poolMaterial, rockMaterial, type ClimateUniforms, type Resources } from './materials';

/** Hash noise, 0..1, stable for a lattice point. */
function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise, 0..1. */
function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Lumpy, rocky detail: a few octaves with sharp creases. */
function rocky(x: number, z: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 0.35;
  for (let i = 0; i < 4; i++) {
    sum += amp * (1 - Math.abs(noise(x * freq, z * freq) * 2 - 1));
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}

/** What gets drawn for the floor at a point: the walking surface plus rocks, and deep beds under the lakes. */
export function floorShape(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < RIM_RADIUS + 0.4) {
    // The hole's rim: a ring of rubble with a steep inner wall down into the pool.
    const lip = RIM_Y + rocky(x * 2, z * 2) * 0.5;
    if (r < HOLE_RADIUS - 0.3) return POOL_Y - 2;
    return lip * smooth(HOLE_RADIUS - 0.3, HOLE_RADIUS + 0.2, r) + (POOL_Y - 2) * (1 - smooth(HOLE_RADIUS - 0.3, HOLE_RADIUS + 0.2, r));
  }
  const g = groundAt(x, z);
  if (g.surface === 'lake') return LAKE_Y - 0.9;
  const detail = rocky(x, z);
  if (g.surface === 'wall') return g.y + detail * Math.min(3, g.y * 0.4 + 0.5);
  const { distance } = pathAt(x, z);
  // Under the path's basalt columns the floor drops away into lava, out of sight.
  const onPad = SWITCHES.some(s => Math.hypot(x - (s.plate.x + s.pedestal.x) / 2, z - s.plate.z) < 2.1);
  if (distance < PATH_HALF_WIDTH + 0.1 || onPad) return g.y - 0.6;
  return g.y + (detail - 0.4) * 0.22;
}

interface CaveLayout {
  floor: { positions: Float32Array; indices: Uint32Array };
  shell: Float32Array;
  boulders: THREE.Matrix4[];
  stalactites: THREE.Matrix4[];
  icicles: Array<{ matrix: THREE.Matrix4; delay: number }>;
}

const FLOOR = { minX: -32, maxX: 32, minZ: -50, maxZ: 50, step: 0.5 };
let shared: Promise<CaveLayout> | undefined;

/** Everything about the cave that never changes, built once (in small pieces) and shared by every mount. */
export function caveLayout(): Promise<CaveLayout> {
  shared ??= buildLayout();
  return shared;
}

const SHELL_SEGMENTS = [72, 40] as const;

async function buildLayout(): Promise<CaveLayout> {
  const cols = Math.round((FLOOR.maxX - FLOOR.minX) / FLOOR.step) + 1;
  const rows = Math.round((FLOOR.maxZ - FLOOR.minZ) / FLOOR.step) + 1;
  const positions = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    const z = FLOOR.minZ + j * FLOOR.step;
    for (let i = 0; i < cols; i++) {
      const x = FLOOR.minX + i * FLOOR.step;
      const k = (j * cols + i) * 3;
      positions[k] = x;
      positions[k + 1] = floorShape(x, z);
      positions[k + 2] = z;
    }
    await breathe();
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let n = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      indices.set([a, a + cols, a + 1, a + 1, a + cols, a + cols + 1], n);
      n += 6;
    }
  }
  await breathe();

  // The cave's walls and ceiling: a lumpy dome.
  const sphere = new THREE.SphereGeometry(1, SHELL_SEGMENTS[0], SHELL_SEGMENTS[1]);
  const shell = (sphere.getAttribute('position').array as Float32Array).slice();
  sphere.dispose();
  for (let k = 0; k < shell.length; k += 3) {
    const [sx, sy, sz] = [shell[k], shell[k + 1], shell[k + 2]];
    const bump = 1 + (rocky(sx * 9 + sy * 4, sz * 9 - sy * 3) - 0.45) * 0.16;
    shell[k] = sx * (CAVE_RX + 3) * bump;
    shell[k + 1] = sy * CEILING_Y * bump;
    shell[k + 2] = sz * (CAVE_RZ + 3) * bump;
  }
  await breathe();

  const rand = seededRandom(4242);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const ceilingAt = (x: number, z: number) =>
    CEILING_Y * Math.sqrt(Math.max(0, 1 - (x / (CAVE_RX + 3)) ** 2 - (z / (CAVE_RZ + 3)) ** 2));

  // Boulders on the banks, the rim and the islands, never on the path itself: mostly pebbles and
  // stones, some big rocks, and the odd huge one against the walls.
  const boulders: THREE.Matrix4[] = [];
  const sized = (small: number, big: number) => small + (big - small) * rand() ** 2.6;
  let tries = 0;
  while (boulders.length < 320 && tries++ < 9000) {
    const x = (rand() * 2 - 1) * 25;
    const z = (rand() * 2 - 1) * 44;
    const { distance } = pathAt(x, z);
    const r = Math.hypot(x, z);
    const onRim = r > HOLE_RADIUS + 0.2 && r < RIM_RADIUS + 0.3;
    const onIsland = ISLANDS.some(i => Math.hypot(x - i.x, z - i.z) < i.r * 0.9);
    const onBank = distance > PATH_HALF_WIDTH + 0.3 && distance < PATH_HALF_WIDTH + 2.2;
    const g = groundAt(x, z);
    if (!onRim && !onIsland && !onBank && g.surface !== 'wall') continue;
    if (distance < PATH_HALF_WIDTH + 0.3 || Math.abs(z) > 34 && Math.abs(x) < 4) continue;
    // Only small stones right by the path; big ones further out.
    const room = Math.min(1, (distance - PATH_HALF_WIDTH) / 4);
    const s = onRim ? sized(0.2, 1.3) : g.surface === 'wall' ? sized(0.4, 4.5) : sized(0.08, 0.4 + room * 1.8);
    const y = onRim ? RIM_Y : g.surface === 'lake' ? LAKE_Y : g.y;
    e.set(rand() * 3, rand() * 6, rand() * 3);
    const squash = 0.4 + rand() * 0.7;
    m.compose(new THREE.Vector3(x, y - s * 0.15, z), q.setFromEuler(e), new THREE.Vector3(s * (0.8 + rand() * 0.9), s * squash, s * (0.8 + rand() * 0.9)));
    boulders.push(m.clone());
  }
  await breathe();

  const stalactites: THREE.Matrix4[] = [];
  const icicles: CaveLayout['icicles'] = [];
  for (let i = 0; i < 130; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 0.88;
    const x = Math.cos(a) * d * (CAVE_RX + 3);
    const z = Math.sin(a) * d * (CAVE_RZ + 3);
    // From stubby nubs to a few great fangs of rock.
    const len = sized(0.4, 7.5);
    const girth = 0.15 + len * (0.12 + rand() * 0.12);
    e.set((rand() - 0.5) * 0.2, rand() * 6, (rand() - 0.5) * 0.2);
    m.compose(new THREE.Vector3(x, ceilingAt(x, z) + 0.3, z), q.setFromEuler(e), new THREE.Vector3(girth, len, girth * (0.7 + rand() * 0.6)));
    stalactites.push(m.clone());
    // Icicles cluster around the stalactite tips.
    for (let k = 0; k < 2; k++) {
      const ix = x + (rand() - 0.5) * 2.5;
      const iz = z + (rand() - 0.5) * 2.5;
      e.set((rand() - 0.5) * 0.15, rand() * 6, (rand() - 0.5) * 0.15);
      m.compose(new THREE.Vector3(ix, ceilingAt(ix, iz) - 0.1, iz), q.setFromEuler(e), new THREE.Vector3(0.12 + rand() * 0.12, 0.8 + rand() * 2.2, 0.12 + rand() * 0.12));
      icicles.push({ matrix: m.clone(), delay: rand() });
    }
  }
  // A fringe of icicles hanging from the hole's rim into the pool.
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rand() * 0.05;
    const r = HOLE_RADIUS + 0.05;
    e.set((rand() - 0.5) * 0.2, rand() * 6, (rand() - 0.5) * 0.2);
    m.compose(new THREE.Vector3(Math.cos(a) * r, RIM_Y + 0.15, Math.sin(a) * r), q.setFromEuler(e), new THREE.Vector3(0.1 + rand() * 0.1, 0.4 + rand() * 0.9, 0.1 + rand() * 0.1));
    icicles.push({ matrix: m.clone(), delay: rand() });
  }
  return { floor: { positions, indices }, shell, boulders, stalactites, icicles };
}

/** Builds the cave for one mount from the shared layout. */
export async function createCave(res: Resources, u: ClimateUniforms) {
  const layout = await caveLayout();
  const group = new THREE.Group();
  group.name = 'cave';
  const rock = rockMaterial(u, res.own);

  const floorGeo = res.geo(new THREE.BufferGeometry());
  floorGeo.setAttribute('position', new THREE.BufferAttribute(layout.floor.positions, 3));
  floorGeo.setIndex(new THREE.BufferAttribute(layout.floor.indices, 1));
  floorGeo.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeo, rock);
  floor.name = 'cave-floor';
  await breathe();

  const shellGeo = res.geo(new THREE.SphereGeometry(1, SHELL_SEGMENTS[0], SHELL_SEGMENTS[1]));
  shellGeo.setAttribute('position', new THREE.BufferAttribute(layout.shell, 3));
  shellGeo.computeVertexNormals();
  const shell = new THREE.Mesh(shellGeo, res.own(rock.clone()));
  (shell.material as THREE.Material).side = THREE.BackSide;
  shell.name = 'cave-shell';
  await breathe();

  // The lakes: one sheet with the hole cut out, and the monster's pool inside it.
  const outline = new THREE.Shape();
  outline.moveTo(-34, -52).lineTo(34, -52).lineTo(34, 52).lineTo(-34, 52).lineTo(-34, -52);
  const hole = new THREE.Path();
  hole.absarc(0, 0, HOLE_RADIUS + 0.4, 0, Math.PI * 2, true);
  outline.holes.push(hole);
  const lake = new THREE.Mesh(res.geo(new THREE.ShapeGeometry(outline, 48).rotateX(-Math.PI / 2)), lakeMaterial(u, res.own));
  lake.position.y = LAKE_Y;
  lake.name = 'lakes';
  const pool = new THREE.Mesh(res.geo(new THREE.CircleGeometry(HOLE_RADIUS + 0.5, 64).rotateX(-Math.PI / 2)), poolMaterial(u, res.own));
  pool.position.y = POOL_Y;
  pool.name = 'pool';

  const boulderGeo = res.geo(new THREE.IcosahedronGeometry(1, 1));
  {
    // Chip the boulders into rough shapes.
    const p = boulderGeo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + hash(p.getX(i) * 3.1, p.getY(i) * 2.7 + p.getZ(i)) * 0.4;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    boulderGeo.computeVertexNormals();
  }
  const boulders = new THREE.InstancedMesh(boulderGeo, rock, layout.boulders.length);
  layout.boulders.forEach((mat, i) => boulders.setMatrixAt(i, mat));
  boulders.name = 'boulders';

  // Cones hanging from y = 0 down to a tip at y = -1, so scaling y grows them downwards.
  const coneGeo = res.geo(new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0).rotateX(Math.PI));
  const stalactites = new THREE.InstancedMesh(coneGeo, rock, layout.stalactites.length);
  layout.stalactites.forEach((mat, i) => stalactites.setMatrixAt(i, mat));
  stalactites.name = 'stalactites';

  const icicleGeo = res.geo(new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0).rotateX(Math.PI));
  const icicles = new THREE.InstancedMesh(icicleGeo, icicleMaterial(res.own), layout.icicles.length);
  icicles.name = 'icicles';
  icicles.frustumCulled = false;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const grown = new THREE.Matrix4();
  const scale = new THREE.Matrix4();
  let lastIce = -1;
  const growIcicles = (ice: number) => {
    if (Math.abs(ice - lastIce) < 0.002) return;
    lastIce = ice;
    layout.icicles.forEach(({ matrix, delay }, i) => {
      const g = stage(ice, 0.1 + delay * 0.5, 0.5 + delay * 0.5);
      if (g <= 0) {
        icicles.setMatrixAt(i, hidden);
        return;
      }
      scale.makeScale(0.4 + 0.6 * g, g, 0.4 + 0.6 * g);
      icicles.setMatrixAt(i, grown.copy(matrix).multiply(scale));
    });
    icicles.instanceMatrix.needsUpdate = true;
  };
  growIcicles(0);

  group.add(floor, shell, lake, pool, boulders, stalactites, icicles);

  // Lava light from the lakes, and a cold light that takes over when they freeze.
  const lavaLights = [
    [-14, 22], [14, 22], [-16, 0], [16, 0], [-12, -24], [12, -24], [0, 0],
  ].map(([x, z]) => {
    const light = new THREE.PointLight('#ff6a1f', 0, 34, 1.6);
    light.position.set(x, x === 0 && z === 0 ? 1.5 : 1.2, z);
    group.add(light);
    return light;
  });
  const hemi = new THREE.HemisphereLight('#ff9a5c', '#2a0d05', 0.5);
  const cold = new THREE.DirectionalLight('#cfe9ff', 0);
  cold.position.set(-10, 20, 15);
  group.add(hemi, cold);
  const fireSky = new THREE.Color('#1e0a06');
  const iceSky = new THREE.Color('#071a2e');
  const fireHemiTop = new THREE.Color('#6a2414');
  const iceHemiTop = new THREE.Color('#9fe8ff');
  const fireHemiBottom = new THREE.Color('#ff5a1a');
  const iceHemiBottom = new THREE.Color('#5a3aa8');

  return {
    group,
    fogColor: (ice: number, out: THREE.Color) => out.copy(fireSky).lerp(iceSky, ice),
    update(frost: number, elapsed: number) {
      const drain = u.drain.value as number;
      const ice = u.ice.value as number;
      lake.position.y = LAKE_Y - (u.lakeDip.value as number);
      growIcicles(ice);
      lavaLights.forEach((light, i) => {
        const flicker = 0.85 + 0.15 * Math.sin(elapsed * (2.3 + i * 0.37) + i);
        light.intensity = (i === 6 ? 60 : 90) * (1 - drain) * flicker;
      });
      hemi.color.copy(fireHemiTop).lerp(iceHemiTop, ice);
      hemi.groundColor.copy(fireHemiBottom).lerp(iceHemiBottom, ice);
      hemi.intensity = 0.55 + 0.5 * ice;
      cold.intensity = 1.1 * ice;
      void frost;
    },
  };
}
