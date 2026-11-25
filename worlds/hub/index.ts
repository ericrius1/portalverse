import * as THREE from 'three/webgpu';
import type { WorldContext, WorldModule } from '@portalverse/core/types';
import {
  createMagicFountainPlumeMaterial,
  createMagicWaterPoolMaterial,
  createStudioGridFloorMaterial,
} from '@portalverse/core/shaders/portalShaders';
import {
  createMeadowBladeGeometry,
  createMeadowGroundMaterial,
  createWorldMeadowGrassMaterial,
  sampleMeadowHeight,
} from '@portalverse/core/shaders/meadowShaders';
import {
  createBloomingFlowerPortal,
  createMagicFountainPortal,
} from '@portalverse/core/engine/PortalMesh';

/** Deterministic PRNG so both Eric & JP see the exact same grass blades, wildflowers, and stars. */
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

/**
 * HUB STYLE 1: "Fountains of Light"
 * Hover high above a 5x5 geometric grid of glowing blue magic fountains erupting from
 * a shimmering twilight sky-pool. Fly down into any glowing plume or click to enter!
 */
function mountFountainsHub(ctx: WorldContext): void {
  const root = new THREE.Group();
  ctx.scene.add(root);

  ctx.scene.background = new THREE.Color('#040b1c');
  ctx.scene.fog = new THREE.FogExp2('#050d22', 0.0085);

  // Start soaring high above the glowing fountain grid looking down at the plumes
  ctx.configureSpawn({
    position: [0, 21, 30],
    yaw: 0,
    pitch: -0.46,
    flying: true,
  });

  // Twilight sky lighting
  const hemi = new THREE.HemisphereLight('#7dd3fc', '#0b1120', 1.15);
  const key = new THREE.DirectionalLight('#bae6fd', 1.5);
  key.position.set(18, 42, 24);
  root.add(hemi, key);

  // Luminous TSL magic water sky-pool beneath the grid
  const poolGeo = new THREE.PlaneGeometry(180, 180, 72, 72);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = createMagicWaterPoolMaterial('#031227', '#38bdf8');
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.position.y = -0.15;
  root.add(poolMesh);

  // Elevated stone-obsidian skywalk grid framing the 5x5 fountain basins
  const walkwayMat = new THREE.MeshStandardMaterial({
    color: 0x0c172c,
    roughness: 0.35,
    metalness: 0.65,
  });
  const walkGeos: THREE.BufferGeometry[] = [];
  const spacing = 14;
  for (let i = -2; i <= 2; i++) {
    const barGeoX = new THREE.BoxGeometry(74, 0.32, 1.35);
    const barX = new THREE.Mesh(barGeoX, walkwayMat);
    barX.position.set(0, 0.05, i * spacing + spacing * 0.5);
    root.add(barX);
    walkGeos.push(barGeoX);

    const barGeoZ = new THREE.BoxGeometry(1.35, 0.32, 74);
    const barZ = new THREE.Mesh(barGeoZ, walkwayMat);
    barZ.position.set(i * spacing + spacing * 0.5, 0.05, 0);
    root.add(barZ);
    walkGeos.push(barGeoZ);
  }

  // Ambient erupting blue magic fountains across the 5x5 grid (skipping the 3 hero portal cells)
  const heroCells = new Set(['-1,0', '1,0', '0,-1']);
  const ambientBasinGeo = new THREE.CylinderGeometry(2.1, 2.5, 0.65, 20);
  const ambientBasinMat = new THREE.MeshStandardMaterial({
    color: 0x0e1d36,
    roughness: 0.32,
    metalness: 0.6,
  });
  const ambientJetGeo = new THREE.CylinderGeometry(0.95, 0.36, 9.5, 16, 12, true);
  const ambientJets: Array<{ mesh: THREE.Mesh; phase: number; baseH: number }> = [];
  const ambientMaterials: THREE.Material[] = [ambientBasinMat];

  for (let gx = -2; gx <= 2; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      if (heroCells.has(`${gx},${gz}`)) continue;
      const x = gx * spacing;
      const z = gz * spacing;
      const phase = (gx * 0.9 + gz * 1.15) * 0.85;

      const basin = new THREE.Mesh(ambientBasinGeo, ambientBasinMat);
      basin.position.set(x, 0.32, z);
      root.add(basin);

      const { material: jetMat, uniforms } = createMagicFountainPlumeMaterial('#38bdf8', '#1d4ed8');
      uniforms.phase.value = phase;
      ambientMaterials.push(jetMat);

      const baseH = 0.65 + ((Math.abs(gx * 3 + gz * 5) % 4) * 0.18);
      const jet = new THREE.Mesh(ambientJetGeo, jetMat);
      jet.position.set(x, 0.5 + 4.75 * baseH, z);
      jet.scale.set(1, baseH, 1);
      root.add(jet);
      ambientJets.push({ mesh: jet, phase, baseH });
    }
  }

  // Rising blue magic mist motes drifting up above the fountain grid
  const rand = mulberry32(4201);
  const moteCount = 450;
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePositions[i * 3] = (rand() - 0.5) * 76;
    motePositions[i * 3 + 1] = rand() * 26;
    motePositions[i * 3 + 2] = (rand() - 0.5) * 76;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMat = new THREE.PointsMaterial({
    color: '#7dd3fc',
    size: 0.34,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  root.add(motes);

  // HERO PORTAL FOUNTAINS — huge glowing blue/accent magic plumes you can fly into OR click!
  const ericFountain = createMagicFountainPortal(
    {
      id: 'hub-fountain-eric',
      label: "Eric's Room",
      subtitle: 'ericrius1 · Click or Dive In',
      position: [-spacing, 0, 0],
      targetWorldId: 'eric-world',
      targetSpawnId: 'default',
      colorA: '#22d3ee',
      colorB: '#2563eb',
      triggerRadius: 4.5,
    },
    { plumeHeight: 16.5, phase: 0.3 },
  );
  ctx.registerCustomPortal(ericFountain);

  const jpFountain = createMagicFountainPortal(
    {
      id: 'hub-fountain-jp',
      label: "JP's Room",
      subtitle: 'jpwhitaker · Click or Dive In',
      position: [spacing, 0, 0],
      targetWorldId: 'jp-world',
      targetSpawnId: 'default',
      colorA: '#38bdf8',
      colorB: '#f59e0b',
      triggerRadius: 4.5,
    },
    { plumeHeight: 16.5, phase: 2.1 },
  );
  ctx.registerCustomPortal(jpFountain);

  // Third featured fountain lets you jump straight into the Solarpunk Meadow hub representation!
  const meadowFountain = createMagicFountainPortal(
    {
      id: 'hub-fountain-meadow',
      label: 'Solarpunk Meadow',
      subtitle: 'Switch Hub to Blooming Flowers',
      position: [0, 0, -spacing],
      targetWorldId: 'hub',
      targetHubStyle: 'meadow',
      colorA: '#34d399',
      colorB: '#38bdf8',
      triggerRadius: 4.2,
    },
    { plumeHeight: 14.5, phase: 4.0 },
  );
  ctx.registerCustomPortal(meadowFountain);

  ctx.onUpdate((dt, elapsed) => {
    // Choreographed wave pulsing across the 5x5 ambient fountain grid
    for (const item of ambientJets) {
      const wave = 0.72 + Math.sin(elapsed * 2.3 + item.phase) * 0.34;
      const hScale = item.baseH * wave;
      item.mesh.scale.set(1, hScale, 1);
      item.mesh.position.y = 0.4 + 4.75 * hScale;
    }

    // Float glowing blue water-magic sparks upward
    const attr = moteGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < moteCount; i++) {
      let y = attr.getY(i) + dt * (1.8 + (i % 5) * 0.35);
      if (y > 26) y = 0.5;
      attr.setY(i, y);
    }
    attr.needsUpdate = true;
  });

  ctx.onDispose(() => {
    ctx.scene.remove(root);
    poolGeo.dispose();
    poolMat.dispose();
    walkwayMat.dispose();
    walkGeos.forEach((g) => g.dispose());
    ambientBasinGeo.dispose();
    ambientJetGeo.dispose();
    ambientMaterials.forEach((m) => m.dispose());
    moteGeo.dispose();
    moteMat.dispose();
  });
}

/**
 * HUB STYLE 2: "Solarpunk Meadow"
 * Modeled directly on the World project's grass & wildflower aesthetic (`blade.wgsl`,
 * `wind.wgsl`, `sheen.wgsl`, `canopy.wgsl`, `kinds.ts`, `species.ts`) with lush wind-swept
 * instanced grass, California wildflower drifts, sunlit solarpunk arches, and giant
 * blooming flowers that unfurl to reveal portals nestled inside their petals!
 */
function mountSolarpunkMeadowHub(ctx: WorldContext): void {
  const root = new THREE.Group();
  ctx.scene.add(root);

  ctx.scene.background = new THREE.Color('#8ecae6');
  ctx.scene.fog = new THREE.Fog('#c8e8f5', 38, 125);
  ctx.setTerrainHeight(sampleMeadowHeight);

  const startY = sampleMeadowHeight(0, 15.5);
  ctx.configureSpawn({
    position: [0, startY, 15.5],
    yaw: 0,
    pitch: -0.06,
    flying: false,
  });

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

  // Rolling painted meadow terrain matching sampleMeadowHeight
  const terrainGeo = new THREE.PlaneGeometry(150, 150, 96, 96);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, sampleMeadowHeight(x, z));
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
    const y = sampleMeadowHeight(x, z);

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
    let heightScale = 0.72 + rand() * 0.58;
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
    const x = drift.x + Math.cos(spreadA) * spreadR;
    const z = drift.z + Math.sin(spreadA) * spreadR;
    const y = sampleMeadowHeight(x, z);
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
    const ay = sampleMeadowHeight(ax, az);

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

  // ---------------------------------------------------------------------------
  // GIANT BLOOMING PORTAL FLOWERS — petals grow & unfurl to reveal portals!
  // ---------------------------------------------------------------------------
  const ericY = sampleMeadowHeight(-8.5, -2.5);
  const ericFlower = createBloomingFlowerPortal(
    {
      id: 'hub-flower-eric',
      label: "Eric's Room",
      subtitle: 'ericrius1 · Enter Blooming Lotus',
      position: [-8.5, ericY, -2.5],
      yaw: 0.45,
      targetWorldId: 'eric-world',
      targetSpawnId: 'default',
      colorA: '#22d3ee',
      colorB: '#818cf8',
      triggerRadius: 2.9,
    },
    {
      stemHeight: 3.6,
      petalBaseColor: '#0ea5e9',
      petalTipColor: '#e0f2fe',
      petalCount: 8,
      phase: 0.2,
    },
  );
  ctx.registerCustomPortal(ericFlower);

  const jpY = sampleMeadowHeight(8.5, -2.5);
  const jpFlower = createBloomingFlowerPortal(
    {
      id: 'hub-flower-jp',
      label: "JP's Room",
      subtitle: 'jpwhitaker · Enter Sun Blossom',
      position: [8.5, jpY, -2.5],
      yaw: -0.45,
      targetWorldId: 'jp-world',
      targetSpawnId: 'default',
      colorA: '#f59e0b',
      colorB: '#fb7185',
      triggerRadius: 2.9,
    },
    {
      stemHeight: 3.8,
      petalBaseColor: '#f97316',
      petalTipColor: '#fef08a',
      petalCount: 9,
      phase: 1.7,
    },
  );
  ctx.registerCustomPortal(jpFlower);

  // Center-back giant azure water-lily bloom switching to the Magic Fountains Hub!
  const ftnY = sampleMeadowHeight(0, -10.5);
  const fountainsFlower = createBloomingFlowerPortal(
    {
      id: 'hub-flower-fountains',
      label: 'Magic Fountains Hub',
      subtitle: 'Switch Hub to Sky Fountains Grid',
      position: [0, ftnY, -10.5],
      yaw: 0,
      targetWorldId: 'hub',
      targetHubStyle: 'fountains',
      colorA: '#38bdf8',
      colorB: '#c084fc',
      triggerRadius: 2.9,
    },
    {
      stemHeight: 4.1,
      petalBaseColor: '#6366f1',
      petalTipColor: '#bae6fd',
      petalCount: 8,
      phase: 3.2,
    },
  );
  ctx.registerCustomPortal(fountainsFlower);

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

/**
 * HUB STYLE 3: "Starlight Nexus"
 * Classic floating obsidian starlight courtyard with glowing portal archways.
 */
function mountNexusHub(ctx: WorldContext): void {
  const root = new THREE.Group();
  ctx.scene.add(root);

  ctx.scene.background = new THREE.Color('#050816');
  ctx.scene.fog = new THREE.FogExp2('#050816', 0.011);

  ctx.configureSpawn({
    position: [0, 0, 12],
    yaw: 0,
    pitch: -0.08,
    flying: false,
  });

  const hemi = new THREE.HemisphereLight('#a5b4fc', '#0f172a', 1.1);
  const key = new THREE.DirectionalLight('#e0e7ff', 1.4);
  key.position.set(14, 28, 18);
  root.add(hemi, key);

  const floorGeo = new THREE.CylinderGeometry(36, 32, 1.0, 64);
  const floorMat = createStudioGridFloorMaterial('#090d1f', '#818cf8', 2.5);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.5;
  root.add(floor);
  ctx.addPlatform({ minX: -36, maxX: 36, minZ: -36, maxZ: 36, topY: 0 });

  // Floating obsidian monoliths orbiting the plaza edge
  const monoGeo = new THREE.OctahedronGeometry(1.1, 0);
  const monoMat = new THREE.MeshStandardMaterial({
    color: '#1e1b4b',
    emissive: '#4f46e5',
    emissiveIntensity: 0.45,
    roughness: 0.25,
    metalness: 0.8,
  });
  const monoliths: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Mesh(monoGeo, monoMat);
    m.position.set(Math.cos(a) * 20, 4.2 + (i % 3) * 1.1, Math.sin(a) * 20);
    m.scale.set(1, 2.2, 1);
    root.add(m);
    monoliths.push(m);
  }

  // Starfield dome
  const rand = mulberry32(9911);
  const starPos = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * 0.85 + 0.1);
    const r = 110 + rand() * 35;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#e0e7ff', size: 0.55 });
  root.add(new THREE.Points(starGeo, starMat));

  ctx.addPortal({
    id: 'hub-nexus-eric',
    label: "Eric's Room",
    subtitle: 'ericrius1 · Cyan Workshop',
    position: [-8.5, 0, -4],
    yaw: 0.42,
    targetWorldId: 'eric-world',
    targetSpawnId: 'default',
    colorA: '#22d3ee',
    colorB: '#3b82f6',
  });

  ctx.addPortal({
    id: 'hub-nexus-jp',
    label: "JP's Room",
    subtitle: 'jpwhitaker · Solar Studio',
    position: [8.5, 0, -4],
    yaw: -0.42,
    targetWorldId: 'jp-world',
    targetSpawnId: 'default',
    colorA: '#f59e0b',
    colorB: '#ec4899',
  });

  ctx.onUpdate((_, elapsed) => {
    monoliths.forEach((m, i) => {
      m.rotation.y = elapsed * 0.35 + i;
      m.position.y = 4.2 + (i % 3) * 1.1 + Math.sin(elapsed * 1.2 + i) * 0.5;
    });
  });

  ctx.onDispose(() => {
    ctx.scene.remove(root);
    floorGeo.dispose();
    floorMat.dispose();
    monoGeo.dispose();
    monoMat.dispose();
    starGeo.dispose();
    starMat.dispose();
  });
}

const hubWorld: WorldModule = {
  manifest: {
    id: 'hub',
    name: 'Portal Hub',
    owner: 'Shared Metaverse',
    author: 'Eric & JP',
    description:
      'Switchable metaverse gateway — soar above Magic Fountains, wander the Blooming Solarpunk Meadow, or step through Nexus Arches.',
    accentColor: '#38bdf8',
    kind: 'local',
    allowFlight: true,
    spawns: {
      default: { position: [0, 21, 30], yaw: 0, pitch: -0.46, flying: true },
      'from-eric': { position: [-6, 1.5, 13], yaw: -0.3 },
      'from-jp': { position: [6, 1.5, 13], yaw: 0.3 },
    },
  },
  mount(ctx) {
    if (ctx.hubStyle === 'meadow') {
      mountSolarpunkMeadowHub(ctx);
    } else if (ctx.hubStyle === 'nexus') {
      mountNexusHub(ctx);
    } else {
      mountFountainsHub(ctx);
    }
  },
};

export default hubWorld;
