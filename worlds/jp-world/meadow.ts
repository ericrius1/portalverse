import * as THREE from 'three/webgpu';
import type { WorldContext } from '@portalverse/core/types';
import {
  createMeadowBladeGeometry,
  createMeadowGroundMaterial,
  createWorldMeadowGrassMaterial,
  sampleMeadowHeight,
} from '@portalverse/core/shaders/meadowShaders';
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function srgbToLinear(c: number): number {
  return Math.pow(c, 2.2);
}

export function meadowHeight(x: number, z: number): number {
  return sampleMeadowHeight(x, z) * THREE.MathUtils.smoothstep(Math.abs(x), 3, 8);
}

export function mountMeadow(ctx: WorldContext): void {
  const root = new THREE.Group();
  ctx.scene.add(root);

  ctx.scene.background = new THREE.Color('#8ecae6');
  ctx.scene.fog = new THREE.Fog('#c8e8f5', 38, 125);
  ctx.setTerrainHeight(meadowHeight);

  // Golden California afternoon sun + warm green sky bounce
  const sunDir = new THREE.Vector3(0.55, 0.52, -0.65).normalize();
  const hemi = new THREE.HemisphereLight('#e0f4ff', '#4d7c2b', 1.35);
  const sun = new THREE.DirectionalLight('#fff2d6', 2.4);
  sun.position.copy(sunDir).multiplyScalar(65);
  root.add(hemi, sun);

  // Glowing golden sun disc in the sky
  const sunDiscGeo = new THREE.SphereGeometry(5.5, 24, 24);
  const sunDiscMat = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
  const sunDisc = new THREE.Mesh(sunDiscGeo, sunDiscMat);
  sunDisc.position.copy(sunDir).multiplyScalar(145);
  root.add(sunDisc);

  // Rolling painted meadow terrain matching meadowHeight
  const terrainGeo = new THREE.PlaneGeometry(150, 150, 96, 96);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, meadowHeight(x, z));
  }
  terrainGeo.computeVertexNormals();
  const terrainMat = createMeadowGroundMaterial();
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  root.add(terrainMesh);

  // ---------------------------------------------------------------------------
  // INSTANCED WORLD-STYLE MEADOW GRASS (26,000 tapered Bezier-elastica blades)
  // Exact species palette from `/world/web/src/meadow/kinds.ts`
  // ---------------------------------------------------------------------------
  const rand = mulberry32(20261125);
  const BLADE_COUNT = 26000;
  const baseBlade = createMeadowBladeGeometry(5);
  const grassGeo = new THREE.InstancedBufferGeometry();
  grassGeo.index = baseBlade.index;
  grassGeo.attributes.position = baseBlade.attributes.position;
  grassGeo.attributes.uv = baseBlade.attributes.uv;
  grassGeo.instanceCount = BLADE_COUNT;

  const aRoot = new Float32Array(BLADE_COUNT * 4);
  const aBlade = new Float32Array(BLADE_COUNT * 4);
  const aRootCol = new Float32Array(BLADE_COUNT * 3);
  const aTipCol = new Float32Array(BLADE_COUNT * 3);

  // Grass kinds directly inspired by Eric's `world/web/src/meadow/kinds.ts`
  const kinds = [
    // meadow (Yorkshire fog / velvet grass: dark root, bright yellow-green tip)
    { height: 0.62, width: 0.068, lean: 0.34, root: [0.15, 0.25, 0.08], tip: [0.44, 0.56, 0.2], weight: 0.42 },
    // annual California grassland (knee high, fresh yellow-green)
    { height: 0.78, width: 0.062, lean: 0.48, root: [0.16, 0.27, 0.08], tip: [0.52, 0.6, 0.21], weight: 0.34 },
    // cured golden oat grass accents (sun-kissed straw gold)
    { height: 0.85, width: 0.052, lean: 0.42, root: [0.36, 0.36, 0.16], tip: [0.86, 0.76, 0.46], weight: 0.14 },
    // soft lush park clover-edge grass
    { height: 0.42, width: 0.072, lean: 0.52, root: [0.18, 0.32, 0.1], tip: [0.34, 0.5, 0.17], weight: 0.1 },
  ];

  const portalSpots: Array<[number, number]> = [
    [-8.5, -2.5],
    [8.5, -2.5],
    [0, -10.5],
  ];

  for (let i = 0; i < BLADE_COUNT; i++) {
    // Concentrate lush blade density near the glade & paths while carpeting out to 54m
    const u = rand();
    const radius = Math.pow(u, 0.62) * 52;
    const angle = rand() * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = meadowHeight(x, z);

    // Pick grass kind using organic spatial clump waves
    const clumpBias = Math.sin(x * 0.14) * Math.cos(z * 0.12) * 0.5 + 0.5;
    let pick = rand();
    if (clumpBias > 0.72 && rand() < 0.35) pick = 0.84; // golden oat drifts
    let kind = kinds[0];
    let acc = 0;
    for (const k of kinds) {
      acc += k.weight;
      if (pick <= acc) {
        kind = k;
        break;
      }
    }

    // Slightly shorter grass right under the giant flower stems & spawn path
    let heightScale = (0.72 + rand() * 0.58) * THREE.MathUtils.smoothstep(Math.abs(x), 1.8, 3.8);
    for (const [px, pz] of portalSpots) {
      const d = Math.hypot(x - px, z - pz);
      if (d < 2.2) heightScale *= 0.55;
    }

    const h = kind.height * heightScale;
    const w = kind.width * (0.85 + rand() * 0.35);
    const facing = rand() * Math.PI * 2;
    const restLean = kind.lean * (0.65 + rand() * 0.7);
    const rnd = rand();

    aRoot[i * 4] = x;
    aRoot[i * 4 + 1] = y - 0.03;
    aRoot[i * 4 + 2] = z;
    aRoot[i * 4 + 3] = h;

    aBlade[i * 4] = w;
    aBlade[i * 4 + 1] = facing;
    aBlade[i * 4 + 2] = restLean;
    aBlade[i * 4 + 3] = rnd;

    const tint = 0.88 + rand() * 0.24;
    aRootCol[i * 3] = srgbToLinear(kind.root[0] * tint);
    aRootCol[i * 3 + 1] = srgbToLinear(kind.root[1] * tint);
    aRootCol[i * 3 + 2] = srgbToLinear(kind.root[2] * tint);

    aTipCol[i * 3] = srgbToLinear(kind.tip[0] * tint);
    aTipCol[i * 3 + 1] = srgbToLinear(kind.tip[1] * tint);
    aTipCol[i * 3 + 2] = srgbToLinear(kind.tip[2] * tint);
  }

  grassGeo.setAttribute('aRoot', new THREE.InstancedBufferAttribute(aRoot, 4));
  grassGeo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(aBlade, 4));
  grassGeo.setAttribute('aRootCol', new THREE.InstancedBufferAttribute(aRootCol, 3));
  grassGeo.setAttribute('aTipCol', new THREE.InstancedBufferAttribute(aTipCol, 3));
  // Generous bounding sphere so frustum culling never clips blades at edges
  grassGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 75);

  const grassMat = createWorldMeadowGrassMaterial(sunDir);
  const grassMesh = new THREE.Mesh(grassGeo, grassMat);
  grassMesh.frustumCulled = false;
  root.add(grassMesh);

  // ---------------------------------------------------------------------------
  // CALIFORNIA WILDFLOWER DRIFTS (from `/world/web/src/meadow/species.ts`)
  // Clustered drifts of California poppies, sky lupine, oxeye daisies,
  // buttercups, checkerbloom, blue-eyed grass, and Indian paintbrush!
  // ---------------------------------------------------------------------------
  const wildflowerPalette: Array<{ col: [number, number, number]; eye: [number, number, number]; height: number; size: number }> = [
    { col: [1.0, 0.5, 0.04], eye: [0.98, 0.78, 0.14], height: 0.56, size: 0.22 }, // California poppy
    { col: [0.99, 0.98, 0.95], eye: [0.98, 0.72, 0.06], height: 0.72, size: 0.2 }, // Oxeye daisy
    { col: [0.34, 0.36, 0.9], eye: [0.97, 0.95, 0.92], height: 0.76, size: 0.23 }, // Sky lupine
    { col: [1.0, 0.84, 0.06], eye: [0.85, 0.68, 0.08], height: 0.48, size: 0.16 }, // California buttercup
    { col: [0.94, 0.42, 0.72], eye: [0.98, 0.92, 0.94], height: 0.58, size: 0.19 }, // Checkerbloom
    { col: [0.42, 0.38, 0.92], eye: [0.98, 0.86, 0.22], height: 0.42, size: 0.15 }, // Blue-eyed grass
    { col: [0.94, 0.26, 0.12], eye: [0.98, 0.52, 0.18], height: 0.62, size: 0.18 }, // Indian paintbrush
  ];

  // Generate 18 natural flower drift centers around the meadow
  const drifts = Array.from({ length: 18 }, () => {
    const r = 4 + rand() * 34;
    const a = rand() * Math.PI * 2;
    return {
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      spread: 2.5 + rand() * 4.5,
      speciesIdx: Math.floor(rand() * wildflowerPalette.length),
    };
  });

  const FLOWER_COUNT = 1600;
  // Multi-petal blossom star head geometry (6 petals around a raised cup)
  const flowerHeadGeo = new THREE.CylinderGeometry(1.0, 0.32, 0.36, 6, 1, false);
  const flowerHeadMat = new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const flowerEyeGeo = new THREE.SphereGeometry(0.36, 8, 6);
  const flowerEyeMat = new THREE.MeshStandardMaterial({ roughness: 0.4 });
  const flowerStemGeo = new THREE.CylinderGeometry(0.018, 0.024, 1.0, 5);
  const flowerStemMat = new THREE.MeshStandardMaterial({ color: '#3b6e24', roughness: 0.8 });

  const flowerHeads = new THREE.InstancedMesh(flowerHeadGeo, flowerHeadMat, FLOWER_COUNT);
  const flowerEyes = new THREE.InstancedMesh(flowerEyeGeo, flowerEyeMat, FLOWER_COUNT);
  const flowerStems = new THREE.InstancedMesh(flowerStemGeo, flowerStemMat, FLOWER_COUNT);

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const flowerMeta: Array<{ x: number; y: number; z: number; h: number; sz: number; rot: number; phase: number }> = [];

  for (let i = 0; i < FLOWER_COUNT; i++) {
    const drift = drifts[i % drifts.length];
    const spreadR = Math.pow(rand(), 0.7) * drift.spread;
    const spreadA = rand() * Math.PI * 2;
    const driftX = drift.x + Math.cos(spreadA) * spreadR;
    const x = driftX + (driftX < 0 ? -2 : 2);
    const z = drift.z + Math.sin(spreadA) * spreadR;
    const y = meadowHeight(x, z);
    const sp = wildflowerPalette[rand() < 0.8 ? drift.speciesIdx : Math.floor(rand() * wildflowerPalette.length)];
    const h = sp.height * (0.78 + rand() * 0.45);
    const sz = sp.size * (0.8 + rand() * 0.5);
    const rot = rand() * Math.PI * 2;
    const phase = x * 0.22 + z * 0.14 + rand() * 0.8;

    flowerMeta.push({ x, y, z, h, sz, rot, phase });

    dummy.position.set(x, y + h * 0.5, z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    flowerStems.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, y + h, z);
    dummy.rotation.set(0.22, rot, 0);
    dummy.scale.set(sz, sz, sz);
    dummy.updateMatrix();
    flowerHeads.setMatrixAt(i, dummy.matrix);
    flowerEyes.setMatrixAt(i, dummy.matrix);

    tmpColor.setRGB(sp.col[0], sp.col[1], sp.col[2], THREE.SRGBColorSpace);
    flowerHeads.setColorAt(i, tmpColor);
    tmpColor.setRGB(sp.eye[0], sp.eye[1], sp.eye[2], THREE.SRGBColorSpace);
    flowerEyes.setColorAt(i, tmpColor);
  }
  flowerStems.instanceMatrix.needsUpdate = true;
  flowerHeads.instanceMatrix.needsUpdate = true;
  flowerEyes.instanceMatrix.needsUpdate = true;
  if (flowerHeads.instanceColor) flowerHeads.instanceColor.needsUpdate = true;
  if (flowerEyes.instanceColor) flowerEyes.instanceColor.needsUpdate = true;
  root.add(flowerStems, flowerHeads, flowerEyes);

  // Subtle Solarpunk Architecture on the distant meadow ridge (ivory solar-ribbed pavilion arches)
  const archMat = new THREE.MeshStandardMaterial({
    color: '#f5f0e6',
    roughness: 0.4,
    metalness: 0.12,
  });
  const solarGoldMat = new THREE.MeshStandardMaterial({
    color: '#d97706',
    roughness: 0.28,
    metalness: 0.72,
  });
  const solarpunkGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI * 0.82 + i * 0.41;
    const dist = 26;
    const ax = Math.cos(angle) * dist;
    const az = Math.sin(angle) * dist - 6;
    const ay = meadowHeight(ax, az);

    const archGeo = new THREE.TorusGeometry(4.2, 0.28, 12, 32, Math.PI);
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(ax, ay - 0.3, az);
    arch.lookAt(0, ay + 2, 0);
    root.add(arch);
    solarpunkGeos.push(archGeo);

    const trimGeo = new THREE.TorusGeometry(3.85, 0.08, 8, 32, Math.PI);
    const trim = new THREE.Mesh(trimGeo, solarGoldMat);
    trim.position.copy(arch.position);
    trim.rotation.copy(arch.rotation);
    root.add(trim);
    solarpunkGeos.push(trimGeo);
  }

  // Sunlit floating pollen motes drifting over the meadow
  const pollenCount = 320;
  const pollenPos = new Float32Array(pollenCount * 3);
  for (let i = 0; i < pollenCount; i++) {
    pollenPos[i * 3] = (rand() - 0.5) * 60;
    pollenPos[i * 3 + 1] = 0.8 + rand() * 8.5;
    pollenPos[i * 3 + 2] = (rand() - 0.5) * 60;
  }
  const pollenGeo = new THREE.BufferGeometry();
  pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPos, 3));
  const pollenMat = new THREE.PointsMaterial({
    color: '#fef08a',
    size: 0.16,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pollen = new THREE.Points(pollenGeo, pollenMat);
  root.add(pollen);

  ctx.onUpdate((dt, elapsed) => {
    // Gentle breeze nodding on the wildflower heads (lagging a beat behind the grass waves!)
    const swayTime = elapsed * 1.55 - 0.25;
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const m = flowerMeta[i];
      const wave = Math.sin(m.phase - swayTime) * 0.14;
      dummy.position.set(m.x + wave * 0.22, m.y + m.h, m.z + wave * 0.14);
      dummy.rotation.set(0.2 + wave * 0.6, m.rot, wave * 0.35);
      dummy.scale.set(m.sz, m.sz, m.sz);
      dummy.updateMatrix();
      flowerHeads.setMatrixAt(i, dummy.matrix);
      flowerEyes.setMatrixAt(i, dummy.matrix);
    }
    flowerHeads.instanceMatrix.needsUpdate = true;
    flowerEyes.instanceMatrix.needsUpdate = true;

    // Drift golden pollen gently along the wind vector
    const pAttr = pollenGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pollenCount; i++) {
      let x = pAttr.getX(i) + dt * 0.65;
      let y = pAttr.getY(i) + Math.sin(elapsed * 1.2 + i) * dt * 0.18;
      let z = pAttr.getZ(i) + dt * 0.42;
      if (x > 30) x = -30;
      if (z > 30) z = -30;
      pAttr.setXYZ(i, x, y, z);
    }
    pAttr.needsUpdate = true;
  });

  ctx.onDispose(() => {
    ctx.scene.remove(root);
    sunDiscGeo.dispose();
    sunDiscMat.dispose();
    terrainGeo.dispose();
    terrainMat.dispose();
    baseBlade.dispose();
    grassGeo.dispose();
    grassMat.dispose();
    flowerHeadGeo.dispose();
    flowerHeadMat.dispose();
    flowerEyeGeo.dispose();
    flowerEyeMat.dispose();
    flowerStemGeo.dispose();
    flowerStemMat.dispose();
    archMat.dispose();
    solarGoldMat.dispose();
    solarpunkGeos.forEach((g) => g.dispose());
    pollenGeo.dispose();
    pollenMat.dispose();
  });
}
