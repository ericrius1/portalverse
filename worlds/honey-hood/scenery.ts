import * as THREE from 'three/webgpu';
import { attribute, color, mix } from 'three/tsl';
import {
  HYDRANT,
  ROAD_HALF_WIDTH,
  goldenPlantSpots,
  roadCenterX,
  treeSpots,
  type Point,
  type Spot,
} from './logic';
import { KERB_WIDTH, TILE_COUNT, roadPoint, stepGlow, tileAt, tileBounds } from './tiles';
import { mesh, span, type Resources } from './tools';

type Rand = () => number;

/** A flat strip following the road, from `inner` to `outer` metres off its middle. */
function roadStrip(inner: number, outer: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const steps = 460;
  for (let i = 0; i <= steps; i++) {
    const z = -46 + (92 * i) / steps;
    const slope = (roadCenterX(z + 0.05) - roadCenterX(z - 0.05)) / 0.1;
    const length = Math.hypot(slope, 1);
    // Unit normal across the road.
    const nx = 1 / length;
    const nz = -slope / length;
    for (const offset of [inner, outer]) {
      positions.push(roadCenterX(z) + nx * offset, y, z + nz * offset);
    }
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createGround(res: Resources): THREE.Group {
  const ground = new THREE.Group();
  const grass = mesh(res.geo(new THREE.PlaneGeometry(220, 220)), res.mat('#2f4a1e', { roughness: 0.95 }));
  grass.rotation.x = -Math.PI / 2;
  const road = new THREE.Group();
  road.name = 'road';
  const kerb = res.mat('#d9a752', { side: THREE.DoubleSide });
  road.add(
    mesh(res.geo(roadStrip(-ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.02)),
      res.mat('#24170f', { roughness: 0.95, side: THREE.DoubleSide })),
    mesh(res.geo(roadStrip(-ROAD_HALF_WIDTH, -ROAD_HALF_WIDTH + KERB_WIDTH, 0.03)), kerb),
    mesh(res.geo(roadStrip(ROAD_HALF_WIDTH - KERB_WIDTH, ROAD_HALF_WIDTH, 0.03)), kerb),
  );
  ground.add(grass, road);
  return ground;
}

/** How far a player's feet can be above the road and still be stepping on it. */
const FOOT_REACH = 0.15;

/** Height the light rises from a lit tile. */
const HALO_HEIGHT = 1.05;
const TILE_GAP = 0.07;
const TILE_SLICES = 20;

/** A mesh with one block of vertices per tile, each carrying that tile's `glow`. */
function perTileGeometry(
  res: Resources,
  build: (tile: number, vertex: (point: Spot, y: number, extra: number) => number, face: (...i: number[]) => void) => void,
  extraName: string,
) {
  const positions: number[] = [];
  const extras: number[] = [];
  const indices: number[] = [];
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    build(
      tile,
      (point, y, extra) => {
        positions.push(point.x, y, point.z);
        extras.push(extra);
        return extras.length - 1;
      },
      (a, b, c, d) => indices.push(a, c, b, b, c, d),
    );
  }
  const geometry = res.geo(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute(extraName, new THREE.Float32BufferAttribute(extras, 1));
  const glow = new THREE.Float32BufferAttribute(new Float32Array(extras.length), 1);
  glow.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('glow', glow);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const perTile = extras.length / TILE_COUNT;
  return {
    geometry,
    light(values: Float32Array) {
      const array = glow.array as Float32Array;
      values.forEach((value, tile) => array.fill(value, tile * perTile, (tile + 1) * perTile));
      glow.needsUpdate = true;
    },
  };
}

/** Points along a tile's four inset edges, as [start edge, end edge] pairs. */
function tileOutline(tile: number): Spot[][] {
  const bounds = tileBounds(tile);
  const from = bounds.from + TILE_GAP;
  const to = bounds.to - TILE_GAP;
  const left = bounds.left + TILE_GAP;
  const right = bounds.right - TILE_GAP;
  const along = (offset: number) =>
    Array.from({ length: TILE_SLICES + 1 }, (_, i) => roadPoint(from + ((to - from) * i) / TILE_SLICES, offset));
  const crossing = (s: number) =>
    Array.from({ length: 5 }, (_, i) => roadPoint(s, left + ((right - left) * i) / 4));
  return [along(left), along(right), crossing(from), crossing(to)];
}

/** The road's paving. All tiles are one mesh, lit one by one, with light rising from their edges. */
export function createRoadTiles(res: Resources) {
  const slabs = perTileGeometry(res, (tile, vertex, face) => {
    const [left, right] = tileOutline(tile);
    // Neighbouring stones differ a little in tone.
    const shade = 0.82 + ((tile * 7) % 11) * 0.036;
    const rows = left.map((point, i) => [vertex(point, 0.035, shade), vertex(right[i], 0.035, shade)]);
    for (let i = 0; i < TILE_SLICES; i++) face(rows[i][0], rows[i][1], rows[i + 1][0], rows[i + 1][1]);
  }, 'shade');
  const halos = perTileGeometry(res, (tile, vertex, face) => {
    for (const edge of tileOutline(tile)) {
      const posts = edge.map(point => [vertex(point, 0.04, 0), vertex(point, HALO_HEIGHT, 1)]);
      for (let i = 1; i < posts.length; i++) face(posts[i - 1][0], posts[i - 1][1], posts[i][0], posts[i][1]);
    }
  }, 'rise');

  const glow = attribute('glow', 'float');
  const slabMaterial = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.7, side: THREE.DoubleSide }));
  slabMaterial.colorNode = mix(color('#7a5a48').mul(attribute('shade', 'float')), color('#ffe27a'), glow);
  slabMaterial.emissiveNode = color('#ffb000').mul(glow.mul(1.3));

  // Additive light that is strongest at the tile and thins out as it rises.
  const haloMaterial = res.own(new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  haloMaterial.colorNode = color('#ffc229');
  haloMaterial.opacityNode = glow.mul(attribute('rise', 'float').oneMinus().pow(1.6)).mul(0.8);

  const tiles = new THREE.Mesh(slabs.geometry, slabMaterial);
  tiles.name = 'road-tiles';
  const halo = new THREE.Mesh(halos.geometry, haloMaterial);
  halo.name = 'tile-glow';
  const group = new THREE.Group();
  group.add(tiles, halo);
  const values = new Float32Array(TILE_COUNT);

  return {
    group,
    /** `feet` is the player's position, or null when nobody is here. */
    update(dt: number, feet: { x: number; y: number; z: number } | null) {
      const standing = feet && feet.y < FOOT_REACH ? tileAt(feet.x, feet.z) : -1;
      if (!stepGlow(values, standing, dt)) return;
      slabs.light(values);
      halos.light(values);
    },
  };
}

/** The ring of tall trees. Returns the points that honey drips from. */
export function createTrees(res: Resources, rand: Rand): { group: THREE.Group; sources: Point[] } {
  const group = new THREE.Group();
  const spots = treeSpots(rand);
  const bark = res.mat('#4a2c1a', { roughness: 0.95 });
  const honey = res.mat('#ffab0f', { roughness: 0.15, emissive: '#7a3d00' });
  const dummy = new THREE.Object3D();

  const trunks = new THREE.InstancedMesh(res.geo(new THREE.CylinderGeometry(0.55, 1.15, 24, 10)), bark, spots.length);
  const clumps = 4;
  const leaves = new THREE.InstancedMesh(
    res.geo(new THREE.IcosahedronGeometry(3.6, 1)),
    res.mat('#ffffff', { roughness: 0.9, flatShading: true }),
    spots.length * clumps,
  );
  const greens = ['#2e6b2a', '#3f8030', '#5a8f2b', '#256038'];
  const color = new THREE.Color();

  const sources: Point[] = [];
  const branches: Array<[THREE.Vector3, THREE.Vector3]> = [];

  spots.forEach((tree, i) => {
    dummy.position.set(tree.x, 12 * tree.scale, tree.z);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.setScalar(tree.scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    for (let k = 0; k < clumps; k++) {
      dummy.position.set(
        tree.x + (k ? (rand() - 0.5) * 5.5 : 0),
        (k ? 20 + rand() * 4 : 25.5) * tree.scale,
        tree.z + (k ? (rand() - 0.5) * 5.5 : 0),
      );
      dummy.rotation.set(rand(), rand() * Math.PI * 2, rand());
      dummy.scale.set(tree.scale, tree.scale * (0.75 + rand() * 0.3), tree.scale);
      dummy.updateMatrix();
      leaves.setMatrixAt(i * clumps + k, dummy.matrix);
      leaves.setColorAt(i * clumps + k, color.set(greens[Math.floor(rand() * greens.length)]));
    }

    if (!tree.drips) return;
    // Branches reach in over the room; honey hangs from their tips.
    const alongSide = Math.abs(tree.z) <= 47;
    for (let k = 0; k < 3; k++) {
      const reach = 1.5 + rand() * 2.5;
      const drift = (k - 1) * 2.2 + (rand() - 0.5);
      const tip = new THREE.Vector3(
        alongSide ? tree.x - Math.sign(tree.x) * reach : tree.x + drift,
        (15 + rand() * 3) * tree.scale,
        alongSide ? tree.z + drift : tree.z - Math.sign(tree.z) * reach,
      );
      branches.push([new THREE.Vector3(tree.x, tip.y + 1.6, tree.z), tip]);
      sources.push({ x: tip.x, y: tip.y - 0.55, z: tip.z });
    }
  });

  const limbs = new THREE.InstancedMesh(res.geo(new THREE.CylinderGeometry(0.1, 0.22, 1, 6)), bark, branches.length);
  const globs = new THREE.InstancedMesh(res.geo(new THREE.SphereGeometry(1, 12, 10)), honey, branches.length);
  branches.forEach(([from, to], i) => {
    // The cylinder narrows toward +Y, so it runs from trunk to tip.
    span(dummy, from, to);
    dummy.updateMatrix();
    limbs.setMatrixAt(i, dummy.matrix);
    dummy.position.set(to.x, to.y - 0.28, to.z);
    dummy.quaternion.identity();
    dummy.scale.set(0.3, 0.4 + rand() * 0.2, 0.3);
    dummy.updateMatrix();
    globs.setMatrixAt(i, dummy.matrix);
  });

  group.add(trunks, leaves, limbs, globs);
  return { group, sources };
}

export function createGoldenPlants(res: Resources, rand: Rand): THREE.Group {
  const group = new THREE.Group();
  group.name = 'golden-plants';
  const spots = goldenPlantSpots(rand);
  const blades = 7;
  const bladeGeo = res.geo(new THREE.ConeGeometry(0.13, 1, 4).translate(0, 0.5, 0).scale(1, 1, 0.35));
  const leaves = new THREE.InstancedMesh(
    bladeGeo,
    res.mat('#ffc93c', { metalness: 0.45, roughness: 0.32, emissive: '#6b4500' }),
    spots.length * blades,
  );
  const blooms = new THREE.InstancedMesh(
    res.geo(new THREE.IcosahedronGeometry(0.17, 0)),
    res.mat('#ffe27a', { metalness: 0.4, roughness: 0.22, emissive: '#a87400' }),
    spots.length,
  );
  const dummy = new THREE.Object3D();
  spots.forEach((spot, i) => {
    const size = 0.6 + rand() * 0.75;
    const turn = rand() * Math.PI * 2;
    for (let k = 0; k < blades; k++) {
      const lean = k ? 0.35 + rand() * 0.55 : 0;
      dummy.position.set(spot.x, 0, spot.z);
      dummy.rotation.set(0, turn + (k / (blades - 1)) * Math.PI * 2, lean, 'YXZ');
      dummy.scale.set(size, size * (k ? 0.7 + rand() * 0.4 : 1.25), size);
      dummy.updateMatrix();
      leaves.setMatrixAt(i * blades + k, dummy.matrix);
    }
    dummy.position.set(spot.x, size * 1.28, spot.z);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    blooms.setMatrixAt(i, dummy.matrix);
  });
  group.add(leaves, blooms);
  return group;
}

export function createHydrant(res: Resources): THREE.Group {
  const hydrant = new THREE.Group();
  hydrant.name = 'fire-hydrant';
  hydrant.position.set(HYDRANT.x, 0, HYDRANT.z);
  const red = res.mat('#d9231c', { roughness: 0.35, metalness: 0.2 });
  const steel = res.mat('#d8d5cc', { roughness: 0.3, metalness: 0.5 });
  const drum = res.geo(new THREE.CylinderGeometry(1, 1, 1, 18));
  const dome = res.geo(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2));

  hydrant.add(
    mesh(drum, red, [0, 0.09, 0], [0.46, 0.18, 0.46]),
    mesh(drum, red, [0, 0.62, 0], [0.31, 0.9, 0.31]),
    mesh(drum, red, [0, 1.1, 0], [0.42, 0.14, 0.42]),
    mesh(dome, red, [0, 1.17, 0], [0.34, 0.3, 0.34]),
    mesh(drum, steel, [0, 1.52, 0], [0.09, 0.16, 0.09]),
  );
  // Two side outlets and one facing the road.
  for (const [x, z, size] of [[0, 1, 1], [0, -1, 1], [-1, 0, 1.35]]) {
    for (const [reach, radius, width, material] of [[0.36, 0.15, 0.2, red], [0.5, 0.18, 0.1, steel]] as const) {
      const cap = mesh(drum, material, [x * reach, 0.72, z * reach], [radius * size, width, radius * size]);
      if (x) cap.rotation.z = Math.PI / 2;
      else cap.rotation.x = Math.PI / 2;
      hydrant.add(cap);
    }
  }
  return hydrant;
}
