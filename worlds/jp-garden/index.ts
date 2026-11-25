/// <reference types="vite/client" />
/**
 * BREEZY PLANT GARDEN (`jp-garden`)
 *
 * Inspired by JP's `portfolio-3` interactive garden, using its rigged leaf models:
 * giant flat-coloured tropical plants (elephant ears, taro, monstera, banana and fan
 * palm leaves) in the portfolio's style rule: flat colours, no shading, shape shown
 * through movement. A breeze and rolling gusts sway every stem, and plants bend away
 * from you as you walk past, springing back with a wobble.
 */
import * as THREE from 'three/webgpu';
import { abs, color, float, max, mix, positionWorld, sin, smoothstep, texture, vec3 } from 'three/tsl';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { disposeObject, loadGLB, seededRandom } from '@portalverse/core/rooms/kit';
import monsteraBaseUrl from './assets/monstera-base-mask.png?url';
import monsteraRibUrl from './assets/monstera-rib-mask.png?url';
import monsteraVeinUrl from './assets/monstera-vein-mask.png?url';

const assets = import.meta.glob<string>('./assets/*.glb', { query: '?url', import: 'default', eager: true });
const asset = (name: string): string => {
  const url = assets[`./assets/${name}.glb`];
  if (!url) throw new Error(`jp-garden: missing asset ${name}`);
  return url;
};

const SKY = '#fbebe4';
const PATH_HALF_WIDTH = 3.6;
const ROOM_HALF_LENGTH = 46;
const PUSH_RADIUS = 3.2;
const UP = new THREE.Vector3(0, 1, 0);

/** Soft mounds away from the path; the path itself stays level. */
function groundHeight(x: number, z: number): number {
  const off = THREE.MathUtils.smoothstep(Math.abs(x), PATH_HALF_WIDTH + 0.5, PATH_HALF_WIDTH + 6);
  return off * (Math.sin(x * 0.21 + 1.3) * 0.5 + Math.cos(z * 0.17) * 0.45 + 0.4);
}

/**
 * Colours the portfolio painted on through mask images, which the models don't carry.
 * Stems are a shade darker than leaves.
 */
const RECOLOR: Record<string, string> = {
  Elephant_Ear_1_Stem_Material: '#5a86b8',
  TexturedPlant_Stem_Blue: '#5a86b8',
};

/**
 * Unlit TSL monstera material ported from JP's `portfolio-3` (`LeafModel.tsx` +
 * `MONSTERA_MASK`): cuts the fenestrated leaf silhouette and layers central rib
 * and side veins from the three grayscale mask textures.
 */
function createMonsteraMaterial(
  baseMask: THREE.Texture,
  ribMask: THREE.Texture,
  veinMask: THREE.Texture,
): THREE.MeshBasicNodeMaterial {
  for (const tex of [baseMask, ribMask, veinMask]) {
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
  }
  const baseV = texture(baseMask).r;
  const ribV = texture(ribMask).r;
  const veinV = texture(veinMask).r;
  const blade = mix(color(new THREE.Color('#a8ae96')), color(new THREE.Color('#848872')), veinV);
  const leafColor = mix(blade, color(new THREE.Color('#c8cab8')), ribV);
  const leafAlpha = max(max(baseV, ribV), veinV);

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    alphaTest: 0.45,
  });
  material.colorNode = leafColor;
  material.opacityNode = smoothstep(float(0.35), float(0.65), leafAlpha);
  return material;
}

/**
 * Trim and curve `textured-plant.glb`'s stem so it meets the underside of the
 * kalo leaf at the piko instead of extending past the leaf into the V-notch.
 */
function fixTaroStem(model: THREE.Object3D): void {
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    if (mat.name !== 'TexturedPlant_Stem_Blue' && !mesh.name.includes('Stem')) return;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const span = Math.max(1e-4, yMax - yMin);
    const targetTopY = 0.835;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = THREE.MathUtils.clamp((y - yMin) / span, 0, 1);
      pos.setY(i, yMin + t * (targetTopY - yMin));
      pos.setZ(i, pos.getZ(i) + t * t * 0.125);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  });
}

/**
 * Relax `elephant-1.glb`'s tall stretched leaf proportions into a fuller heart
 * shape and tuck the stem tip cleanly behind the leaf so it never punches through.
 */
function fixElephantEar(model: THREE.Object3D): void {
  const pikoX = 0.03;
  const pikoY = 5.3;
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const mat = mesh.material as THREE.Material;
    if (mat.name === 'Elephant_Ear_1_Stem_Material') {
      let yMin = Infinity;
      let yMax = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      const span = Math.max(1e-4, yMax - yMin);
      const targetTopY = 5.2;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = THREE.MathUtils.clamp((y - yMin) / span, 0, 1);
        const pullBack = THREE.MathUtils.smoothstep(y, 3.2, yMax);
        pos.setY(i, yMin + t * (targetTopY - yMin));
        pos.setZ(i, pos.getZ(i) - pullBack * 0.065);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pikoX + (pos.getX(i) - pikoX) * 1.24);
        pos.setY(i, pikoY + (pos.getY(i) - pikoY) * 0.72);
      }
    }
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  });
}

/** Flat, unlit versions of a model's materials: the garden's no-shading look. */
function flatten(model: THREE.Object3D, override?: THREE.Material): THREE.Material[] {
  const converted = new Map<THREE.Material, THREE.Material>();
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false; // bending moves leaves outside the bind-pose bounds
    if (override) {
      mesh.material = override;
      return;
    }
    const source = mesh.material as THREE.MeshStandardMaterial;
    let material = converted.get(source);
    if (!material) {
      const recolor = RECOLOR[source.name];
      material = new THREE.MeshBasicNodeMaterial({
        color: recolor ? new THREE.Color(recolor) : source.color,
        map: source.map,
        side: THREE.DoubleSide,
        alphaTest: source.map ? 0.4 : 0,
      });
      converted.set(source, material);
    }
    mesh.material = material;
  });
  return override ? [override] : [...converted.values()];
}

interface BendBone {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  parentRestInverse: THREE.Quaternion;
  share: number;
}

/** One plant (or leaf) that bends as a whole toward a horizontal direction. */
interface Bendable {
  bones: BendBone[];
  base: THREE.Vector3;
  bend: THREE.Vector2;
  velocity: THREE.Vector2;
  phase: number;
  /** Bigger plants are heavier: they lean less and spring back slower. */
  give: number;
}

/** Keep leaf-to-stem junction bones locked to their stem tips so bending never pulls them apart. */
const RIGID_JUNCTION_BONES = new Set(['Plant_Leaf', 'TP_Leaf_Base']);

/** Collect a placed plant's bones, sharing the bend evenly across each chain's depth. */
function makeBendable(object: THREE.Object3D, base: THREE.Vector3, phase: number, give: number): Bendable {
  object.updateMatrixWorld(true);
  const bones = new Set<THREE.Bone>();
  object.traverse(child => {
    const mesh = child as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) {
      for (const bone of mesh.skeleton.bones) {
        if (!RIGID_JUNCTION_BONES.has(bone.name)) bones.add(bone);
      }
    }
  });
  const depthOf = (bone: THREE.Object3D) => {
    let depth = 0;
    for (let p = bone.parent; p && (p as THREE.Bone).isBone; p = p.parent) depth++;
    return depth;
  };
  const maxDepth = Math.max(0, ...[...bones].map(depthOf));
  const parentWorld = new THREE.Quaternion();
  return {
    bones: [...bones].map(bone => {
      bone.parent!.getWorldQuaternion(parentWorld);
      return { bone, rest: bone.quaternion.clone(), parentRestInverse: parentWorld.clone().invert(), share: 1 / (maxDepth + 1) };
    }),
    base: base.clone(),
    bend: new THREE.Vector2(),
    velocity: new THREE.Vector2(),
    phase,
    give,
  };
}

/**
 * The shape a leaf lies in at rest: where its stem starts, which way it points, and
 * which side faces out. Leaves are authored flat, so a rosette stands them up.
 */
function leafRest(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  let root: THREE.Bone | undefined;
  model.traverse(child => {
    const mesh = child as THREE.SkinnedMesh;
    if (!root && mesh.isSkinnedMesh) root = mesh.skeleton.bones[0];
  });
  const pivot = root ? root.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const direction = box.getCenter(new THREE.Vector3()).sub(pivot).setY(0);
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
  direction.normalize();
  const thinnest = size.x < size.y && size.x < size.z ? 'x' : size.y < size.z ? 'y' : 'z';
  const face = new THREE.Vector3().setComponent('xyz'.indexOf(thinnest), 1);
  return { pivot, direction, face };
}

/** Rotation taking a resting leaf to point along `target`, its face turned toward the sky. */
function standLeaf(rest: ReturnType<typeof leafRest>, target: THREE.Vector3): THREE.Quaternion {
  const aim = new THREE.Quaternion().setFromUnitVectors(rest.direction, target);
  const face = rest.face.clone().applyQuaternion(aim);
  const wanted = UP.clone().addScaledVector(target, -UP.dot(target)).normalize();
  const roll = Math.atan2(face.clone().cross(wanted).dot(target), face.dot(wanted));
  return new THREE.Quaternion().setFromAxisAngle(target, roll).multiply(aim);
}

export default defineRoom('jp-garden', {
  async mount(ctx) {
    const rand = seededRandom(5150);
    const root = new THREE.Group();
    ctx.scene.add(root);
    const templates: GLTF[] = [];
    const ownMaterials: THREE.Material[] = [];
    const ownGeometries: THREE.BufferGeometry[] = [];
    const ownTextures: THREE.Texture[] = [];

    ctx.scene.background = new THREE.Color(SKY);
    ctx.scene.fog = new THREE.Fog(SKY, 30, 120);
    // Only the portal frames are lit; the garden itself is flat colour.
    root.add(new THREE.HemisphereLight('#fff6ef', '#f0c9b8', 1.6));

    // Ground and path
    ctx.setTerrainHeight(groundHeight);
    ctx.addPlatform({ minX: -PATH_HALF_WIDTH, maxX: PATH_HALF_WIDTH, minZ: -ROOM_HALF_LENGTH, maxZ: ROOM_HALF_LENGTH, topY: 0 });
    const groundGeometry = new THREE.PlaneGeometry(160, 130, 80, 66);
    groundGeometry.rotateX(-Math.PI / 2);
    const groundPositions = groundGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < groundPositions.count; i++) {
      groundPositions.setY(i, groundHeight(groundPositions.getX(i), groundPositions.getZ(i)));
    }
    const groundMaterial = new THREE.MeshBasicNodeMaterial();
    const onPath = float(1).sub(smoothstep(float(PATH_HALF_WIDTH - 0.4), float(PATH_HALF_WIDTH + 0.4), abs(positionWorld.x)));
    const patches = sin(positionWorld.x.mul(0.31).add(sin(positionWorld.z.mul(0.23)).mul(2))).mul(0.5).add(0.5);
    groundMaterial.colorNode = mix(
      mix(vec3(0.93, 0.78, 0.72), vec3(0.88, 0.72, 0.68), patches.mul(0.6)),
      vec3(0.97, 0.88, 0.82),
      onPath,
    );
    root.add(new THREE.Mesh(groundGeometry, groundMaterial));
    ownGeometries.push(groundGeometry);
    ownMaterials.push(groundMaterial);

    // A flat sun and a few flat clouds, far off
    const discGeometry = new THREE.CircleGeometry(1, 48);
    ownGeometries.push(discGeometry);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: '#f7b9a0', fog: false });
    const cloudMaterial = new THREE.MeshBasicMaterial({ color: '#fff7f2', fog: false });
    ownMaterials.push(sunMaterial, cloudMaterial);
    const sunDisc = new THREE.Mesh(discGeometry, sunMaterial);
    sunDisc.position.set(-30, 34, -95);
    sunDisc.scale.setScalar(9);
    root.add(sunDisc);
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Mesh(discGeometry, cloudMaterial);
      const side = i % 2 ? 1 : -1;
      cloud.position.set(side * (25 + rand() * 30), 22 + rand() * 14, -90 + rand() * 180);
      cloud.scale.set(6 + rand() * 6, 2 + rand() * 1.5, 1);
      cloud.lookAt(0, cloud.position.y, cloud.position.z);
      root.add(cloud);
    }

    // Plants & monstera mask textures
    const names = ['elephant-1', 'textured-plant', 'monstera-leaf-2', 'banana-leaf', 'fan-palm-2'] as const;
    const textureLoader = new THREE.TextureLoader();
    const [loaded, monsteraMasks] = await Promise.all([
      Promise.all(names.map(name => loadGLB(asset(name)))),
      Promise.all([monsteraBaseUrl, monsteraRibUrl, monsteraVeinUrl].map(url => textureLoader.loadAsync(url))),
    ]);
    templates.push(...loaded);
    ownTextures.push(...monsteraMasks);
    const monsteraMaterial = createMonsteraMaterial(monsteraMasks[0], monsteraMasks[1], monsteraMasks[2]);
    fixElephantEar(loaded[0].scene);
    fixTaroStem(loaded[1].scene);
    const [elephant, taro, monstera, banana, fanPalm] = loaded.map((gltf, i) => {
      ownMaterials.push(...flatten(gltf.scene, i === 2 ? monsteraMaterial : undefined));
      return gltf.scene;
    });
    const plants: Bendable[] = [];
    const footprints = new Map<THREE.Object3D, { box: THREE.Box3; center: THREE.Vector3 }>();
    const rests = new Map<THREE.Object3D, ReturnType<typeof leafRest>>();

    /**
     * An upright plant, its base centred on (x, z). Kalo and elephant ear leaves face the
     * model's +Z (the stem meets each leaf at its back), so turn that toward a point on
     * the path near the plant: walkers see the fronts of the leaves.
     */
    const upright = (template: THREE.Object3D, x: number, z: number, scale: number, give: number) => {
      let footprint = footprints.get(template);
      if (!footprint) {
        const box = new THREE.Box3().setFromObject(template, true);
        footprint = { box, center: box.getCenter(new THREE.Vector3()) };
        footprints.set(template, footprint);
      }
      const { box, center } = footprint;
      const plant = cloneSkinned(template);
      plant.position.set(-center.x, -box.min.y, -center.z);
      const holder = new THREE.Group();
      holder.add(plant);
      holder.position.set(x, groundHeight(x, z), z);
      holder.rotation.y = Math.atan2(-x, (rand() - 0.5) * 12);
      holder.scale.setScalar(scale);
      root.add(holder);
      plants.push(makeBendable(holder, holder.position, rand() * 6.3, give));
    };

    /** A clump of flat leaves standing up around (x, z). */
    const rosette = (template: THREE.Object3D, x: number, z: number, count: number, scale: number, lift = 0) => {
      let rest = rests.get(template);
      if (!rest) {
        rest = leafRest(template);
        rests.set(template, rest);
      }
      const center = new THREE.Vector3(x, groundHeight(x, z), z);
      const start = rand() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const around = start + (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.4;
        const rise = 0.55 + rand() * 0.5;
        const target = new THREE.Vector3(Math.cos(around) * Math.cos(rise), Math.sin(rise), Math.sin(around) * Math.cos(rise));
        const leaf = cloneSkinned(template);
        leaf.position.copy(rest.pivot).negate();
        const holder = new THREE.Group();
        holder.add(leaf);
        holder.quaternion.copy(standLeaf(rest, target));
        const leafScale = scale * (0.85 + rand() * 0.3);
        holder.position.copy(center).addScaledVector(target, lift * leafScale);
        holder.scale.setScalar(leafScale);
        root.add(holder);
        plants.push(makeBendable(holder, center, rand() * 6.3, 1.25));
      }
    };

    for (let z = -ROOM_HALF_LENGTH + 2; z <= ROOM_HALF_LENGTH - 2; z += 7) {
      for (const side of [-1, 1]) {
        upright(elephant, side * (5.2 + rand() * 7), z + rand() * 3, 0.8 + rand() * 0.45, 0.7);
        upright(taro, side * (4.6 + rand() * 6), z + 3 + rand() * 2, 1.3 + rand() * 0.8, 1);
      }
    }
    const leaves = [monstera, banana, fanPalm];
    for (let z = -ROOM_HALF_LENGTH + 5; z <= ROOM_HALF_LENGTH - 5; z += 9) {
      for (const side of [-1, 1]) {
        const kind = leaves[Math.floor(rand() * leaves.length)];
        rosette(
          kind,
          side * (5 + rand() * 6),
          z + rand() * 4,
          4 + Math.floor(rand() * 3),
          kind === fanPalm ? 1.3 : 1.9,
          kind === monstera ? 0.38 : 0,
        );
      }
    }

    // Drifting pollen
    const POLLEN = 220;
    const pollenGeometry = new THREE.OctahedronGeometry(0.05, 0);
    const pollenMaterial = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
    const pollen = new THREE.InstancedMesh(pollenGeometry, pollenMaterial, POLLEN);
    const motes = Array.from({ length: POLLEN }, () => ({
      x: (rand() - 0.5) * 40, y: 0.5 + rand() * 7, z: (rand() - 0.5) * 92, rise: 0.08 + rand() * 0.14, phase: rand() * 6.3,
    }));
    root.add(pollen);
    ownGeometries.push(pollenGeometry);
    ownMaterials.push(pollenMaterial);

    const axis = new THREE.Vector3();
    const localAxis = new THREE.Vector3();
    const tilt = new THREE.Quaternion();
    const target = new THREE.Vector2();
    const away = new THREE.Vector2();
    const dummy = new THREE.Object3D();
    let gustZ = -80;
    let gustDirection = 1;
    let nextGust = 3;

    ctx.onUpdate((dt, elapsed) => {
      const step = Math.min(dt, 1 / 30);
      // A gust rolls down the garden every few seconds.
      nextGust -= step;
      if (nextGust <= 0) {
        gustDirection = rand() < 0.5 ? 1 : -1;
        gustZ = -70 * gustDirection;
        nextGust = 5 + rand() * 4;
      }
      gustZ += 11 * step * gustDirection;
      const windAngle = 0.4 * Math.sin(elapsed * 0.05);
      const windX = Math.cos(windAngle);
      const windZ = Math.sin(windAngle);
      const player = ctx.player?.position;

      for (const plant of plants) {
        const { base } = plant;
        const breeze = 0.05 + 0.04 * Math.sin(elapsed * 0.8 + base.x * 0.21 + base.z * 0.13 + plant.phase);
        const flutter = 0.025 * Math.sin(elapsed * 2.6 + plant.phase * 3);
        const gust = 0.22 * Math.exp(-(((base.z - gustZ) / 7) ** 2));
        const lean = (breeze + gust) * plant.give;
        target.set(windX * lean + windZ * flutter, windZ * lean - windX * flutter);
        if (player) {
          away.set(base.x - player.x, base.z - player.z);
          const distance = away.length();
          if (distance < PUSH_RADIUS && distance > 1e-3) {
            const push = (1 - distance / PUSH_RADIUS) ** 2 * 0.75 * plant.give;
            target.addScaledVector(away.divideScalar(distance), push);
          }
        }
        // Underdamped spring: leaves give way, then wobble back.
        plant.velocity.x += ((target.x - plant.bend.x) * 55 - plant.velocity.x * 5.5) * step;
        plant.velocity.y += ((target.y - plant.bend.y) * 55 - plant.velocity.y * 5.5) * step;
        plant.bend.addScaledVector(plant.velocity, step);

        const angle = plant.bend.length();
        if (angle < 1e-5) continue;
        // Tilt toward the bend direction: rotate about up × direction.
        axis.set(plant.bend.y / angle, 0, -plant.bend.x / angle);
        for (const b of plant.bones) {
          localAxis.copy(axis).applyQuaternion(b.parentRestInverse);
          tilt.setFromAxisAngle(localAxis, angle * b.share);
          b.bone.quaternion.copy(tilt).multiply(b.rest);
        }
      }

      for (let i = 0; i < POLLEN; i++) {
        const m = motes[i];
        m.y += m.rise * step;
        if (m.y > 8) m.y = 0.4;
        dummy.position.set(m.x + Math.sin(elapsed * 0.5 + m.phase) * 0.9, m.y, m.z + Math.cos(elapsed * 0.4 + m.phase) * 0.9);
        dummy.updateMatrix();
        pollen.setMatrixAt(i, dummy.matrix);
      }
      pollen.instanceMatrix.needsUpdate = true;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      for (const gltf of templates) disposeObject(gltf.scene);
      for (const geometry of ownGeometries) geometry.dispose();
      for (const material of ownMaterials) material.dispose();
      for (const tex of ownTextures) tex.dispose();
    });
  },
});
