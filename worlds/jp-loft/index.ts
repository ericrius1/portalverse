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
const DOG_HOME = new THREE.Vector3(-4.4, 0, 9.5);

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

    // Front door, by the entrance
    furnish(door, HALF_WIDTH - 0.2, doorZ, new THREE.Vector3(-1, 0, 0));

    // Living room (left): couch facing the path across a rug, lamp on a side table, plants
    rug(-6.4, 12, 4.2, 3.2, rugMaterial('#8a3b2e', '#d9a56b'));
    furnish(couch, -7.6, 12, towardPath(-7.6), 1.25);
    furnish(sideTable, -7.8, 14.4, towardPath(-7.8));
    furnish(lamp, -7.8, 14.4, towardPath(-7.8)).position.y = 0.48;
    warmLight(-7.8, 1.4, 14.4);
    furnish(plant, -9.1, 16.8, towardPath(-9), 1.3);
    furnish(plant, -9.1, 7.4, towardPath(-9), 1.1);
    // Dog bed by the couch
    const dogBed = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.62, 0.7, 0.16, 28)), material(new THREE.MeshStandardMaterial({ color: '#6b8f71', roughness: 1 })));
    dogBed.position.set(DOG_HOME.x, 0.08, DOG_HOME.z);
    root.add(dogBed);

    // Reading nook (right): couch facing the path, lamp, bookshelves against the window piers
    rug(6.6, 14, 3.6, 3, rugMaterial('#2f4858', '#86bbd8'));
    furnish(couch, 7.7, 14, towardPath(7.7), 1.1);
    furnish(sideTable, 7.9, 11.6, towardPath(7.9));
    furnish(lamp, 7.9, 11.6, towardPath(7.9)).position.y = 0.48;
    warmLight(7.9, 1.4, 11.6);
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
    box(1.3, 0.92, 3.6, cabinet, 7.4, 0.46, -2);
    box(1.5, 0.06, 3.8, counterTop, 7.4, 0.95, -2);
    const stoolMaterial = material(new THREE.MeshStandardMaterial({ color: '#b07a4f', roughness: 0.6 }));
    for (const z of [-3.2, -2, -0.8]) {
      const stool = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.2, 0.16, 0.72, 16)), stoolMaterial);
      stool.position.set(6.3, 0.36, z);
      root.add(stool);
    }
    const pendantGlow = material(new THREE.MeshBasicMaterial({ color: '#ffd29a' }));
    const cord = material(new THREE.MeshBasicMaterial({ color: '#111111' }));
    for (const z of [-3, -1]) {
      const bulb = new THREE.Mesh(geometry(new THREE.SphereGeometry(0.16, 16, 12)), pendantGlow);
      bulb.position.set(7.4, 2.6, z);
      root.add(bulb);
      box(0.02, CEILING - 2.75, 0.02, cord, 7.4, (CEILING + 2.75) / 2, z);
    }
    warmLight(7.4, 2.3, -2, 16);

    // Dining table (left) with benches and a plant
    const tableWood = material(new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.55 }));
    box(1.4, 0.08, 3, tableWood, -7, 0.76, -4);
    for (const [dx, dz] of [[-0.6, -1.3], [0.6, -1.3], [-0.6, 1.3], [0.6, 1.3]]) box(0.08, 0.74, 0.08, tableWood, -7 + dx, 0.37, -4 + dz);
    box(0.4, 0.45, 2.6, tableWood, -8.1, 0.225, -4);
    box(0.4, 0.45, 2.6, tableWood, -5.9, 0.225, -4);
    furnish(plant, -9.1, -7.2, towardPath(-9), 1.4);
    warmLight(-7, 2.4, -4, 12);

    // Bedroom corner (left): bed, side tables, lamps
    const linen = material(new THREE.MeshStandardMaterial({ color: '#e9e4da', roughness: 0.95 }));
    const blanket = material(new THREE.MeshStandardMaterial({ color: '#c2674b', roughness: 0.95 }));
    rug(-6.8, -22, 4.4, 3.6, rugMaterial('#3d3a4b', '#a39ec2'));
    box(2.4, 0.35, 2.2, tableWood, -8.3, 0.18, -22);
    box(2.3, 0.25, 2.1, linen, -8.3, 0.48, -22);
    box(1.5, 0.08, 2.15, blanket, -7.9, 0.62, -22);
    box(0.5, 0.18, 0.75, linen, -9.25, 0.68, -22.55);
    box(0.5, 0.18, 0.75, linen, -9.25, 0.68, -21.45);
    box(0.3, 1.1, 2.4, tableWood, -9.65, 0.55, -22);
    for (const z of [-23.7, -20.3]) {
      furnish(sideTable, -9.2, z, towardPath(-9));
      furnish(lamp, -9.2, z, towardPath(-9)).position.y = 0.48;
    }
    warmLight(-9.2, 1.4, -21.9, 12);

    // Lounge (right): second couch under the window, plants
    rug(6.6, -18, 3.8, 3, rugMaterial('#4b3f2f', '#c9a227'));
    furnish(couch, 7.9, -18, towardPath(7.9), 1.25);
    furnish(plant, 9.1, -14.6, towardPath(9), 1.3);
    furnish(plant, 9.1, -21.6, towardPath(9), 1.2);
    furnish(plant, -9.1, -31, towardPath(-9), 1.5);
    furnish(plant, 9.1, 31.5, towardPath(9), 1.5);

    // The shiba
    const shiba = shibaGltf.scene;
    shiba.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(shiba);
    const clip = (name: string) => shibaGltf.animations.find(a => a.name === name);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const name of ['Idle', 'Walk', 'Gallop', 'Idle_2_HeadLow']) {
      const animation = clip(name);
      if (animation) actions.set(name, mixer.clipAction(animation));
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
    const setMood = (next: string) => {
      if (next === mood || !actions.has(next)) return;
      actions.get(next)!.reset().fadeIn(0.3).play();
      actions.get(mood)?.fadeOut(0.3);
      mood = next;
    };
    let dogSpeed = 0;
    let dogHeading = 0;
    const toTarget = new THREE.Vector3();
    const followPoint = new THREE.Vector3();

    ctx.onUpdate((dt) => {
      const step = Math.min(dt, 1 / 20);
      const player = ctx.player?.position;
      const near = player && Math.abs(player.z) < HALF_LENGTH && player.distanceTo(dog.position) < 30;
      if (near) {
        // Keep about 1.8 m from the player, on whichever side the dog already is.
        followPoint.copy(dog.position).sub(player).setY(0);
        if (followPoint.lengthSq() < 1e-4) followPoint.set(1, 0, 0);
        followPoint.setLength(1.8).add(player);
      } else {
        followPoint.copy(DOG_HOME);
      }
      followPoint.x = THREE.MathUtils.clamp(followPoint.x, -HALF_WIDTH + 1, HALF_WIDTH - 1);
      followPoint.z = THREE.MathUtils.clamp(followPoint.z, -35, 35); // stay clear of the portals
      toTarget.copy(followPoint).sub(dog.position).setY(0);
      const distance = toTarget.length();
      const wanted = distance > 5 ? 7 : distance > 0.35 ? Math.min(2.4, distance * 2) : 0;
      dogSpeed += (wanted - dogSpeed) * Math.min(1, step * 4);
      if (distance > 0.05 && dogSpeed > 0.05) {
        const heading = Math.atan2(toTarget.x, toTarget.z);
        const turn = Math.atan2(Math.sin(heading - dogHeading), Math.cos(heading - dogHeading));
        dogHeading += turn * Math.min(1, step * 6);
        dog.position.x += Math.sin(dogHeading) * dogSpeed * step;
        dog.position.z += Math.cos(dogHeading) * dogSpeed * step;
      } else if (!near && distance < 0.4) {
        dogHeading += Math.atan2(Math.sin(-Math.PI / 2 - dogHeading), Math.cos(-Math.PI / 2 - dogHeading)) * Math.min(1, step * 3);
      }
      dog.rotation.y = dogHeading;
      setMood(dogSpeed > 4 ? 'Gallop' : dogSpeed > 0.25 ? 'Walk' : near ? 'Idle' : 'Idle_2_HeadLow');
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
