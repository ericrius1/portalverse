/// <reference types="vite/client" />
/**
 * NIGHT LOFT (`jp-loft`)
 *
 * Inspired by JP's `apartment` and `white-fiber` scenes, using their furniture, the
 * shiba and the night-city sky: a long open-plan loft with window bays looking out
 * over the city, warm lamps, a kitchen island, a dining table, a reading nook and a
 * bedroom corner. The shiba trots after you while you're here and goes back to its
 * bed when you leave.
 */
import * as THREE from 'three/webgpu';
import { abs, color, cos, float, floor, fract, mix, positionWorld, sin, smoothstep, vec3 } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { disposeObject, groundModel, loadGLB, seededRandom } from '@portalverse/core/rooms/kit';
import cityUrl from './assets/modern_buildings_night_1k.hdr?url';

const assets = import.meta.glob<string>('./assets/*.glb', { query: '?url', import: 'default', eager: true });
const asset = (name: string): string => {
  const url = assets[`./assets/${name}.glb`];
  if (!url) throw new Error(`jp-loft: missing asset ${name}`);
  return url;
};

const HALF_WIDTH = 10;
const HALF_LENGTH = 48;
const CEILING = 7;
const BAY = 6;
const DOG_HOME = new THREE.Vector3(-4.0, 0, 8.6);

/**
 * Average face normals across coincident vertices so the low-poly shiba shades
 * smoothly across split faces and fur-colour seams, and remove the metallic sheen.
 */
function smoothShiba(shiba: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  shiba.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    meshes.push(mesh);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      const isEye = mat.name.startsWith('Eyes_');
      mat.flatShading = false;
      mat.metalness = 0;
      mat.roughness = isEye ? 0.45 : 0.92;
      mat.envMapIntensity = isEye ? 0.35 : 0.2;
      mat.needsUpdate = true;
    }
  });

  // Shiba raw vertices are ~0.01-0.04 units before the 100x parent scale, so quantize at 1e-6.
  const accum = new Map<string, [number, number, number]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const face = new THREE.Vector3();

  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    const idx = mesh.geometry.getIndex();
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      face.crossVectors(ab, ac);
      for (const v of [a, b, c]) {
        const key = keyOf(v.x, v.y, v.z);
        const sum = accum.get(key);
        if (sum) {
          sum[0] += face.x;
          sum[1] += face.y;
          sum[2] += face.z;
        } else {
          accum.set(key, [face.x, face.y, face.z]);
        }
      }
    }
  }

  for (const sum of accum.values()) {
    const len = Math.hypot(sum[0], sum[1], sum[2]);
    if (len > 1e-12) {
      sum[0] /= len;
      sum[1] /= len;
      sum[2] /= len;
    }
  }

  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    let norm = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!norm || norm.count !== pos.count) {
      norm = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
      mesh.geometry.setAttribute('normal', norm);
    }
    for (let i = 0; i < pos.count; i++) {
      const sum = accum.get(keyOf(pos.getX(i), pos.getY(i), pos.getZ(i)));
      if (sum) norm.setXYZ(i, sum[0], sum[1], sum[2]);
    }
    norm.needsUpdate = true;
  }
}

/** Direction a piece of furniture faces, judged from where its tall parts (the back) are. */
function frontOf(model: THREE.Object3D): THREE.Vector3 {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const high = box.min.y + (box.max.y - box.min.y) * 0.6;
  const back = new THREE.Vector3();
  let count = 0;
  const v = new THREE.Vector3();
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    const position = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (v.y > high) { back.add(v); count++; }
    }
  });
  if (!count) return new THREE.Vector3(0, 0, 1);
  back.divideScalar(count).sub(center).setY(0);
  // Only trust the thinner (depth) axis.
  const size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) back.x = 0; else back.z = 0;
  return back.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : back.normalize().negate();
}

export default defineRoom('jp-loft', {
  async mount(ctx) {
    const rand = seededRandom(1999);
    const root = new THREE.Group();
    ctx.scene.add(root);
    const templates: GLTF[] = [];
    const ownGeometries: THREE.BufferGeometry[] = [];
    const ownMaterials: THREE.Material[] = [];
    const geometry = <T extends THREE.BufferGeometry>(g: T): T => { ownGeometries.push(g); return g; };
    const material = <T extends THREE.Material>(m: T): T => { ownMaterials.push(m); return m; };

    const [city, couch, lamp, plant, sideTable, door, shibaGltf] = await Promise.all([
      new HDRLoader().loadAsync(cityUrl),
      ...['couch', 'lamp', 'plant', 'side-table', 'door', 'shiba'].map(name => loadGLB(asset(name))),
    ]);
    templates.push(couch, lamp, plant, sideTable, door, shibaGltf);

    // Night city outside, and its glow on the room
    city.mapping = THREE.EquirectangularReflectionMapping;
    ctx.scene.background = new THREE.Color('#0b0e18');
    ctx.scene.environment = city;
    ctx.scene.environmentIntensity = 0.45;
    ctx.scene.fog = new THREE.Fog('#0b0e18', 45, 160);
    const skyGeometry = geometry(new THREE.SphereGeometry(150, 64, 32));
    skyGeometry.scale(-1, 1, 1);
    const sky = new THREE.Mesh(skyGeometry, material(new THREE.MeshBasicNodeMaterial({ map: city, color: new THREE.Color(1.7, 1.7, 1.7), fog: false })));
    sky.position.y = 8;
    root.add(sky);
    root.add(new THREE.HemisphereLight('#7f8fbf', '#2a1c14', 0.55));

    // Floor: warm planks
    ctx.addPlatform({ minX: -HALF_WIDTH, maxX: HALF_WIDTH, minZ: -HALF_LENGTH, maxZ: HALF_LENGTH, topY: 0 });
    const floorMaterial = material(new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0 }));
    const plank = floor(positionWorld.x.div(0.24));
    const shade = fract(sin(plank.mul(12.9898)).mul(43758.5453));
    const grain = sin(positionWorld.z.mul(9).add(shade.mul(40)).add(sin(positionWorld.z.mul(1.7)))).mul(0.5).add(0.5);
    const edge = abs(fract(positionWorld.x.div(0.24)).sub(0.5)).mul(2); // 0 mid-plank, 1 at a seam
    const seam = smoothstep(float(0.9), float(0.98), edge);
    floorMaterial.colorNode = mix(vec3(0.33, 0.2, 0.12), vec3(0.52, 0.34, 0.2), shade.mul(0.6).add(grain.mul(0.25))).mul(float(1).sub(seam.mul(0.35)));
    const floorMesh = new THREE.Mesh(geometry(new THREE.PlaneGeometry(HALF_WIDTH * 2, HALF_LENGTH * 2)), floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    root.add(floorMesh);

    // Ceiling and beams
    const darkWood = material(new THREE.MeshStandardMaterial({ color: '#2b1d14', roughness: 0.8 }));
    const ceiling = new THREE.Mesh(geometry(new THREE.PlaneGeometry(HALF_WIDTH * 2, HALF_LENGTH * 2)), darkWood);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = CEILING;
    root.add(ceiling);
    const beamCount = Math.floor((HALF_LENGTH * 2) / 4) + 1;
    const beams = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(HALF_WIDTH * 2, 0.35, 0.3)), darkWood, beamCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < beamCount; i++) {
      dummy.position.set(0, CEILING - 0.18, -HALF_LENGTH + i * 4);
      dummy.updateMatrix();
      beams.setMatrixAt(i, dummy.matrix);
    }
    root.add(beams);

    // End walls (behind the portals): brick
    const brick = material(new THREE.MeshStandardNodeMaterial({ roughness: 0.9 }));
    const row = floor(positionWorld.y.div(0.24));
    const course = fract(positionWorld.x.div(0.5).add(row.mul(0.5)));
    const mortar = smoothstep(float(0.03), float(0.06), fract(positionWorld.y.div(0.24))).mul(smoothstep(float(0.02), float(0.05), course));
    const brickTone = fract(sin(row.mul(7.13).add(floor(positionWorld.x.div(0.5).add(row.mul(0.5))).mul(3.7))).mul(951.3));
    brick.colorNode = mix(vec3(0.42, 0.38, 0.34), mix(vec3(0.43, 0.18, 0.12), vec3(0.58, 0.27, 0.17), brickTone), mortar);
    for (const end of [-1, 1]) {
      const wall = new THREE.Mesh(geometry(new THREE.PlaneGeometry(HALF_WIDTH * 2, CEILING)), brick);
      wall.position.set(0, CEILING / 2, end * HALF_LENGTH);
      wall.rotation.y = end > 0 ? Math.PI : 0;
      root.add(wall);
    }

    // Side walls: window bays onto the city, one solid bay for the front door
    const frame = material(new THREE.MeshStandardMaterial({ color: '#17191f', roughness: 0.5, metalness: 0.6 }));
    const wallPaint = material(new THREE.MeshStandardMaterial({ color: '#d8cfc4', roughness: 0.9 }));
    const glass = material(new THREE.MeshStandardMaterial({ color: '#8fb3ff', transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    const bays = Math.round((HALF_LENGTH * 2) / BAY);
    const doorBay = { side: 1, index: Math.floor((HALF_LENGTH + 28) / BAY) };
    const doorZ = -HALF_LENGTH + (doorBay.index + 0.5) * BAY;
    const pier = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(0.4, CEILING, 0.6)), frame, (bays + 1) * 2);
    const sill = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(0.3, 0.8, BAY)), wallPaint, bays * 2);
    const header = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(0.3, 0.9, BAY)), wallPaint, bays * 2);
    const mullion = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(0.08, CEILING - 1.7, 0.08)), frame, bays * 2);
    const transom = new THREE.InstancedMesh(geometry(new THREE.BoxGeometry(0.08, 0.08, BAY - 0.4)), frame, bays * 2);
    const pane = new THREE.InstancedMesh(geometry(new THREE.PlaneGeometry(BAY - 0.4, CEILING - 1.7)), glass, bays * 2);
    let piers = 0, sills = 0, headers = 0, mullions = 0, transoms = 0, panes = 0;
    const put = (mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, ry = 0) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    };
    for (const side of [-1, 1]) {
      const x = side * HALF_WIDTH;
      for (let i = 0; i <= bays; i++) put(pier, piers++, x, CEILING / 2, -HALF_LENGTH + i * BAY);
      for (let i = 0; i < bays; i++) {
        const z = -HALF_LENGTH + (i + 0.5) * BAY;
        if (side === doorBay.side && i === doorBay.index) {
          const solid = new THREE.Mesh(geometry(new THREE.BoxGeometry(0.3, CEILING, BAY)), wallPaint);
          solid.position.set(x, CEILING / 2, z);
          root.add(solid);
          continue;
        }
        put(sill, sills++, x, 0.4, z);
        put(header, headers++, x, CEILING - 0.45, z);
        put(mullion, mullions++, x, 0.8 + (CEILING - 1.7) / 2, z);
        put(transom, transoms++, x, 3.6, z);
        put(pane, panes++, x, 0.8 + (CEILING - 1.7) / 2, z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
    }
    for (const [mesh, used] of [[pier, piers], [sill, sills], [header, headers], [mullion, mullions], [transom, transoms], [pane, panes]] as const) {
      mesh.count = used;
      root.add(mesh);
    }

    // Furniture
    const lights: THREE.PointLight[] = [];
    const warmLight = (x: number, y: number, z: number, intensity = 14) => {
      const light = new THREE.PointLight('#ffb36b', intensity, 10, 2);
      light.position.set(x, y, z);
      root.add(light);
      lights.push(light);
    };
    const facing = new Map<THREE.Object3D, THREE.Vector3>();
    /** Place a model on the floor at (x, z), its front turned toward `face`. */
    const furnish = (gltf: GLTF, x: number, z: number, face: THREE.Vector3, scale = 1) => {
      let front = facing.get(gltf.scene);
      if (!front) {
        front = frontOf(gltf.scene);
        facing.set(gltf.scene, front);
      }
      const piece = groundModel(gltf.scene.clone());
      piece.scale.setScalar(scale);
      piece.rotation.y = Math.atan2(face.x, face.z) - Math.atan2(front.x, front.z);
      piece.position.set(x, 0, z);
      root.add(piece);
      return piece;
    };
    const towardPath = (x: number) => new THREE.Vector3(-Math.sign(x), 0, 0);
    const rugMaterial = (a: string, b: string) => {
      const m = material(new THREE.MeshStandardNodeMaterial({ roughness: 1 }));
      const stripes = sin(positionWorld.x.mul(6).add(cos(positionWorld.z.mul(2)))).mul(0.5).add(0.5);
      m.colorNode = mix(color(new THREE.Color(a)), color(new THREE.Color(b)), smoothstep(float(0.4), float(0.6), stripes));
      return m;
    };
    const rug = (x: number, z: number, w: number, d: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry(new THREE.PlaneGeometry(w, d)), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.01, z);
      root.add(mesh);
    };
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geometry(new THREE.BoxGeometry(w, h, d)), m);
      mesh.position.set(x, y, z);
      root.add(mesh);
      return mesh;
    };

    // Soften couch fabric so it reads as upholstery rather than shiny vinyl
    couch.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.roughness = 0.85;
          mat.envMapIntensity = 0.35;
        }
      }
    });

    // Front door, by the entrance
    furnish(door, HALF_WIDTH - 0.25, doorZ, new THREE.Vector3(-1, 0, 0), 1.65);

    // Living room (left): couch facing the path across a rug, lamp on a side table, plants
    const sideTableHeight = 0.483;
    rug(-6.4, 12.6, 6.2, 5.4, rugMaterial('#8a3b2e', '#d9a56b'));
    furnish(couch, -7.7, 12, towardPath(-7.7), 1.75);
    furnish(sideTable, -7.9, 14.6, towardPath(-7.9), 1.65);
    furnish(lamp, -7.9, 14.6, towardPath(-7.9), 1.5).position.y = sideTableHeight * 1.65;
    warmLight(-7.9, 2.0, 14.6, 16);
    furnish(plant, -9.0, 17.2, towardPath(-9), 1.65);
    furnish(plant, -9.0, 7.2, towardPath(-9), 1.45);
    // Dog bed by the couch
    const dogBed = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.75, 0.85, 0.18, 28)), material(new THREE.MeshStandardMaterial({ color: '#6b8f71', roughness: 1 })));
    dogBed.position.set(DOG_HOME.x, 0.09, DOG_HOME.z);
    root.add(dogBed);

    // Reading nook (right): couch facing the path, lamp, bookshelves against the window piers
    rug(6.5, 13.4, 5.8, 5.2, rugMaterial('#2f4858', '#86bbd8'));
    furnish(couch, 7.7, 14, towardPath(7.7), 1.65);
    furnish(sideTable, 7.9, 11.45, towardPath(7.9), 1.65);
    furnish(lamp, 7.9, 11.45, towardPath(7.9), 1.5).position.y = sideTableHeight * 1.65;
    warmLight(7.9, 2.0, 11.45, 16);
    const shelfWood = material(new THREE.MeshStandardMaterial({ color: '#5a3a24', roughness: 0.7 }));
    const bookColors = ['#c0392b', '#2e86ab', '#f6c85f', '#6f4e7c', '#9fd356', '#e8e1d5', '#264653'].map(c => material(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })));
    for (const shelfZ of [18.5, 20.8]) {
      box(0.5, 2.6, 2, shelfWood, 9.3, 1.3, shelfZ);
      for (let level = 0; level < 4; level++) {
        let z = shelfZ - 0.9;
        while (z < shelfZ + 0.85) {
          const w = 0.06 + rand() * 0.07;
          const h = 0.32 + rand() * 0.18;
          box(0.3, h, w, bookColors[Math.floor(rand() * bookColors.length)], 9.15, 0.12 + level * 0.62 + h / 2, z + w / 2);
          z += w + 0.01;
        }
      }
    }

    // Kitchen island (right) with stools and pendants
    const counterTop = material(new THREE.MeshStandardMaterial({ color: '#eae6df', roughness: 0.25, metalness: 0.05 }));
    const cabinet = material(new THREE.MeshStandardMaterial({ color: '#2f3b33', roughness: 0.6 }));
    box(1.75, 1.18, 4.8, cabinet, 7.5, 0.59, -2);
    box(2.0, 0.08, 5.1, counterTop, 7.5, 1.22, -2);
    const stoolMaterial = material(new THREE.MeshStandardMaterial({ color: '#b07a4f', roughness: 0.6 }));
    for (const z of [-3.6, -2, -0.4]) {
      const stool = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.28, 0.22, 0.92, 16)), stoolMaterial);
      stool.position.set(6.0, 0.46, z);
      root.add(stool);
    }
    const pendantGlow = material(new THREE.MeshBasicMaterial({ color: '#ffd29a' }));
    const cord = material(new THREE.MeshBasicMaterial({ color: '#111111' }));
    for (const z of [-3.4, -0.6]) {
      const bulb = new THREE.Mesh(geometry(new THREE.SphereGeometry(0.22, 16, 12)), pendantGlow);
      bulb.position.set(7.5, 3.2, z);
      root.add(bulb);
      box(0.025, CEILING - 3.4, 0.025, cord, 7.5, (CEILING + 3.4) / 2, z);
    }
    warmLight(7.5, 2.9, -2, 18);

    // Dining table / desk (left) with benches and a plant
    const tableWood = material(new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.55 }));
    box(2.0, 0.11, 4.4, tableWood, -6.9, 1.05, -4);
    for (const [dx, dz] of [[-0.85, -1.95], [0.85, -1.95], [-0.85, 1.95], [0.85, 1.95]]) {
      box(0.12, 1.02, 0.12, tableWood, -6.9 + dx, 0.51, -4 + dz);
    }
    box(0.56, 0.62, 3.8, tableWood, -8.45, 0.31, -4);
    box(0.56, 0.62, 3.8, tableWood, -5.35, 0.31, -4);
    furnish(plant, -9.0, -8.4, towardPath(-9), 1.7);
    warmLight(-6.9, 2.9, -4, 15);

    // Bedroom corner (left): king-size bed, side tables, lamps
    const linen = material(new THREE.MeshStandardMaterial({ color: '#e9e4da', roughness: 0.95 }));
    const blanket = material(new THREE.MeshStandardMaterial({ color: '#c2674b', roughness: 0.95 }));
    rug(-6.6, -22, 6.8, 6.6, rugMaterial('#3d3a4b', '#a39ec2'));
    box(3.4, 0.5, 3.1, tableWood, -7.9, 0.25, -22);
    box(3.25, 0.36, 2.95, linen, -7.9, 0.68, -22);
    box(2.15, 0.11, 3.02, blanket, -7.32, 0.89, -22);
    box(0.7, 0.26, 1.05, linen, -9.1, 0.98, -22.72);
    box(0.7, 0.26, 1.05, linen, -9.1, 0.98, -21.28);
    box(0.36, 1.75, 3.3, tableWood, -9.7, 0.875, -22);
    for (const z of [-24.45, -19.55]) {
      furnish(sideTable, -9.0, z, towardPath(-9), 1.65);
      furnish(lamp, -9.0, z, towardPath(-9), 1.5).position.y = sideTableHeight * 1.65;
    }
    warmLight(-9.0, 2.0, -22, 16);

    // Lounge (right): second couch under the window, plants
    rug(6.5, -18, 6.0, 5.0, rugMaterial('#4b3f2f', '#c9a227'));
    furnish(couch, 7.7, -18, towardPath(7.7), 1.75);
    furnish(plant, 9.0, -14.2, towardPath(9), 1.6);
    furnish(plant, 9.0, -21.8, towardPath(9), 1.55);
    furnish(plant, -9.0, -31, towardPath(-9), 1.8);
    furnish(plant, 9.0, 31.5, towardPath(9), 1.8);

    // The shiba
    const shiba = shibaGltf.scene;
    smoothShiba(shiba);
    const mixer = new THREE.AnimationMixer(shiba);
    const clip = (name: string) => shibaGltf.animations.find(a => a.name === name);
    const actions = new Map<string, THREE.AnimationAction>();
    const oneShots = new Set(['Gallop_Jump', 'Jump_ToIdle', 'Attack']);
    for (const name of ['Idle', 'Idle_2', 'Idle_2_HeadLow', 'Walk', 'Gallop', 'Gallop_Jump', 'Jump_ToIdle', 'Eating', 'Attack']) {
      const animation = clip(name);
      if (animation) {
        const action = mixer.clipAction(animation);
        if (oneShots.has(name)) action.setLoop(THREE.LoopOnce, 1);
        actions.set(name, action);
      }
    }
    actions.get('Idle_2_HeadLow')?.play();
    mixer.update(0);
    shiba.updateMatrixWorld(true);
    const unscaled = new THREE.Box3().setFromObject(shiba, true);
    shiba.scale.multiplyScalar(0.8 / Math.max(1e-6, unscaled.max.y - unscaled.min.y));
    const dog = groundModel(shiba, true);
    dog.position.copy(DOG_HOME);
    root.add(dog);
    let mood = 'Idle_2_HeadLow';
    let oneShotUntil = 0;
    const setMood = (next: string, fade = 0.28) => {
      if (next === mood || !actions.has(next)) return;
      actions.get(next)!.reset().fadeIn(fade).play();
      actions.get(mood)?.fadeOut(fade);
      mood = next;
    };
    const triggerOneShot = (name: string, duration: number, now: number) => {
      const action = actions.get(name);
      if (!action) return;
      action.reset().fadeIn(0.16).play();
      if (mood !== name) actions.get(mood)?.fadeOut(0.16);
      mood = name;
      oneShotUntil = now + duration;
    };

    type DogMode = 'home' | 'lead' | 'orbit' | 'dash_out' | 'dash_wait' | 'dash_back' | 'wait';
    let mode: DogMode = 'home';
    let modeTimer = 0;
    let nextPlayTimer = 6;
    let waitAnticTimer = 2.2;
    let waitAnim: 'Idle' | 'Idle_2' | 'Eating' = 'Idle_2';
    let leadSide = 1;
    let orbitAngle = 0;
    let orbitDir = 1;
    let orbitJumped = false;
    let dashJumped = false;
    let dogSpeed = 0;
    let dogHeading = 0;
    let hasLastPlayer = false;
    const lastPlayerPos = new THREE.Vector3();
    const playerForward = new THREE.Vector3(0, 0, -1);
    const dashTarget = new THREE.Vector3();
    const toTarget = new THREE.Vector3();
    const followPoint = new THREE.Vector3();

    const clampToLoft = (p: THREE.Vector3) => {
      p.x = THREE.MathUtils.clamp(p.x, -HALF_WIDTH + 1.2, HALF_WIDTH - 1.2);
      p.z = THREE.MathUtils.clamp(p.z, -35, 35); // stay clear of the portals
    };

    ctx.onUpdate((dt, elapsed) => {
      const step = Math.min(dt, 1 / 20);
      const player = ctx.player?.position;
      const near = Boolean(player && Math.abs(player.z) < HALF_LENGTH && player.distanceTo(dog.position) < 32);

      // Track the direction the player is moving so the shiba runs ahead into view instead of trailing behind.
      let playerSpeed = 0;
      if (player) {
        if (hasLastPlayer && step > 1e-4) {
          const dx = player.x - lastPlayerPos.x;
          const dz = player.z - lastPlayerPos.z;
          playerSpeed = Math.hypot(dx, dz) / step;
          if (playerSpeed > 0.45) {
            const inv = 1 / Math.hypot(dx, dz);
            playerForward.x += (dx * inv - playerForward.x) * Math.min(1, step * 5);
            playerForward.z += (dz * inv - playerForward.z) * Math.min(1, step * 5);
            const len = Math.hypot(playerForward.x, playerForward.z);
            if (len > 1e-4) {
              playerForward.x /= len;
              playerForward.z /= len;
            }
          }
        }
        lastPlayerPos.copy(player);
        hasLastPlayer = true;
      } else {
        hasLastPlayer = false;
      }

      if (!near || !player) {
        mode = 'home';
      } else if (mode === 'home') {
        mode = 'lead';
        nextPlayTimer = 4 + rand() * 4;
      }

      modeTimer -= step;
      let speedCap = 9.0;
      let facePlayerWhenStopped = false;

      if (mode === 'home' || !player) {
        followPoint.copy(DOG_HOME);
      } else if (mode === 'orbit') {
        orbitAngle += orbitDir * 2.15 * step;
        const radius = 3.0;
        followPoint.set(
          player.x + Math.cos(orbitAngle) * radius,
          0,
          player.z + Math.sin(orbitAngle) * radius,
        );
        clampToLoft(followPoint);
        speedCap = 9.5;
        if (!orbitJumped && modeTimer < 1.8) {
          orbitJumped = true;
          triggerOneShot('Gallop_Jump', 0.92, elapsed);
        }
        if (modeTimer <= 0) {
          mode = 'lead';
          leadSide = -leadSide;
          nextPlayTimer = 6 + rand() * 5;
          triggerOneShot('Jump_ToIdle', 1.15, elapsed);
        }
      } else if (mode === 'dash_out') {
        followPoint.copy(dashTarget);
        speedCap = 10.5;
        if (!dashJumped && dog.position.distanceTo(dashTarget) < 5.5) {
          dashJumped = true;
          triggerOneShot('Gallop_Jump', 0.92, elapsed);
        }
        if (dog.position.distanceTo(dashTarget) < 0.85 || modeTimer <= 0) {
          mode = 'dash_wait';
          modeTimer = 1.2 + rand() * 0.8;
          triggerOneShot(rand() < 0.55 ? 'Attack' : 'Jump_ToIdle', 1.15, elapsed);
        }
      } else if (mode === 'dash_wait') {
        followPoint.copy(dog.position);
        facePlayerWhenStopped = true;
        if (modeTimer <= 0) {
          mode = 'dash_back';
          modeTimer = 4.5;
        }
      } else if (mode === 'dash_back') {
        // Race right back in front of the player and pull up with a happy hop.
        followPoint.set(
          player.x + playerForward.x * 2.8 + -playerForward.z * leadSide * 1.1,
          0,
          player.z + playerForward.z * 2.8 + playerForward.x * leadSide * 1.1,
        );
        clampToLoft(followPoint);
        speedCap = 10.5;
        if (dog.position.distanceTo(followPoint) < 0.75 || modeTimer <= 0) {
          mode = 'wait';
          modeTimer = 3.5 + rand() * 2.5;
          waitAnticTimer = 1.6;
          waitAnim = 'Idle_2';
          nextPlayTimer = 6 + rand() * 5;
          triggerOneShot('Jump_ToIdle', 1.25, elapsed);
        }
      } else if (mode === 'wait') {
        followPoint.copy(dog.position);
        facePlayerWhenStopped = true;
        waitAnticTimer -= step;
        if (waitAnticTimer <= 0 && elapsed >= oneShotUntil) {
          const roll = rand();
          if (roll < 0.28) {
            triggerOneShot('Jump_ToIdle', 1.25, elapsed);
          } else if (roll < 0.5) {
            triggerOneShot('Attack', 1.25, elapsed);
          } else if (roll < 0.72) {
            waitAnim = 'Eating';
          } else {
            waitAnim = roll < 0.88 ? 'Idle_2' : 'Idle';
          }
          waitAnticTimer = 2.2 + rand() * 2.0;
        }
        const distToPlayer = Math.hypot(dog.position.x - player.x, dog.position.z - player.z);
        const dotAhead = (dog.position.x - player.x) * playerForward.x + (dog.position.z - player.z) * playerForward.z;
        // If the player walks past or moves away, bound back ahead into view.
        if (playerSpeed > 1.2 && (distToPlayer > 5.0 || dotAhead < 0.3)) {
          mode = 'lead';
        } else if (modeTimer <= 0) {
          nextPlayTimer -= step;
          if (nextPlayTimer <= 0) {
            if (rand() < 0.55) {
              mode = 'orbit';
              modeTimer = 3.2;
              orbitAngle = Math.atan2(dog.position.z - player.z, dog.position.x - player.x);
              orbitDir = rand() < 0.5 ? 1 : -1;
              orbitJumped = false;
            } else {
              mode = 'dash_out';
              modeTimer = 3.5;
              dashJumped = false;
              const side = rand() < 0.5 ? 1 : -1;
              dashTarget.set(
                player.x + playerForward.x * (7.5 + rand() * 3) + -playerForward.z * side * (1.8 + rand() * 1.5),
                0,
                player.z + playerForward.z * (7.5 + rand() * 3) + playerForward.x * side * (1.8 + rand() * 1.5),
              );
              clampToLoft(dashTarget);
            }
          } else if (distToPlayer > 4.2) {
            mode = 'lead';
          }
        }
      } else {
        // `lead`: stay ahead & slightly to the side of the player's path so the dog is always in view.
        const sideX = -playerForward.z * leadSide;
        const sideZ = playerForward.x * leadSide;
        followPoint.set(
          player.x + playerForward.x * 3.4 + sideX * 1.6,
          0,
          player.z + playerForward.z * 3.4 + sideZ * 1.6,
        );
        clampToLoft(followPoint);
        facePlayerWhenStopped = true;
        const distToLead = Math.hypot(followPoint.x - dog.position.x, followPoint.z - dog.position.z);
        // Periodically break into a circle around you or a dash-and-return while accompanying you.
        nextPlayTimer -= step;
        if (nextPlayTimer <= 0 && distToLead < 5.0) {
          if (rand() < 0.55) {
            mode = 'orbit';
            modeTimer = 3.2;
            orbitAngle = Math.atan2(dog.position.z - player.z, dog.position.x - player.x);
            orbitDir = rand() < 0.5 ? 1 : -1;
            orbitJumped = false;
          } else {
            mode = 'dash_out';
            modeTimer = 3.5;
            dashJumped = false;
            const side = rand() < 0.5 ? 1 : -1;
            dashTarget.set(
              player.x + playerForward.x * (7.5 + rand() * 3) + -playerForward.z * side * (1.5 + rand() * 1.8),
              0,
              player.z + playerForward.z * (7.5 + rand() * 3) + playerForward.x * side * (1.5 + rand() * 1.8),
            );
            clampToLoft(dashTarget);
          }
        } else if (distToLead < 0.7 && playerSpeed < 0.8) {
          mode = 'wait';
          modeTimer = 3.0 + rand() * 2.5;
          waitAnticTimer = 1.6 + rand() * 1.2;
          waitAnim = rand() < 0.65 ? 'Idle_2' : 'Idle';
        }
      }

      clampToLoft(followPoint);
      toTarget.copy(followPoint).sub(dog.position).setY(0);
      const distance = toTarget.length();
      const wanted =
        mode === 'orbit' || mode === 'dash_out' || mode === 'dash_back'
          ? Math.min(speedCap, Math.max(6.2, distance * 2.4))
          : distance > 4.2
            ? Math.min(speedCap, 7.8 + Math.min(2.5, playerSpeed * 0.4))
            : distance > 0.45
              ? Math.min(3.4, distance * 2.2)
              : 0;
      dogSpeed += (wanted - dogSpeed) * Math.min(1, step * 5.5);

      if (distance > 0.08 && dogSpeed > 0.08) {
        const heading = Math.atan2(toTarget.x, toTarget.z);
        const turn = Math.atan2(Math.sin(heading - dogHeading), Math.cos(heading - dogHeading));
        dogHeading += turn * Math.min(1, step * 7.5);
        const move = Math.min(distance, dogSpeed * step);
        dog.position.x += Math.sin(dogHeading) * move;
        dog.position.z += Math.cos(dogHeading) * move;
      } else if (facePlayerWhenStopped && player) {
        const lookAtPlayer = Math.atan2(player.x - dog.position.x, player.z - dog.position.z);
        const turn = Math.atan2(Math.sin(lookAtPlayer - dogHeading), Math.cos(lookAtPlayer - dogHeading));
        dogHeading += turn * Math.min(1, step * 5);
      } else if (mode === 'home' && distance < 0.4) {
        dogHeading += Math.atan2(Math.sin(-Math.PI / 2 - dogHeading), Math.cos(-Math.PI / 2 - dogHeading)) * Math.min(1, step * 3);
      }
      dog.rotation.y = dogHeading;

      if (elapsed >= oneShotUntil) {
        if (dogSpeed > 4.2) setMood('Gallop', 0.2);
        else if (dogSpeed > 0.35) setMood('Walk', 0.22);
        else if (mode === 'wait') setMood(waitAnim, 0.3);
        else if (mode === 'dash_wait') setMood('Idle_2', 0.25);
        else setMood(near ? 'Idle_2' : 'Idle_2_HeadLow', 0.3);
      }
      mixer.update(dt);
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      mixer.stopAllAction();
      for (const gltf of templates) disposeObject(gltf.scene);
      city.dispose();
      for (const g of ownGeometries) g.dispose();
      for (const m of ownMaterials) m.dispose();
    });
  },
});
