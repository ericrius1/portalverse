import * as THREE from 'three/webgpu';
import type { WorldContext } from '@portalverse/core/types';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import {
  createMagicFountainPlumeMaterial,
  createMagicWaterPoolMaterial,
  createStudioGridFloorMaterial,
} from '@portalverse/core/shaders/portalShaders';
import { mountMeadow, meadowHeight } from '../jp-world/meadow';
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
      if (gx === 0 || heroCells.has(`${gx},${gz}`)) continue;
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
      position: [7, 0, -spacing],
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
  mountMeadow(ctx);
  const ericY = meadowHeight(-8.5, -2.5);
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

  const jpY = meadowHeight(8.5, -2.5);
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
  const ftnY = meadowHeight(6, -10.5);
  const fountainsFlower = createBloomingFlowerPortal(
    {
      id: 'hub-flower-fountains',
      label: 'Magic Fountains Hub',
      subtitle: 'Switch Hub to Sky Fountains Grid',
      position: [6, ftnY, -10.5],
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
    position: [0, 0, 35.75],
    yaw: 0,
    pitch: -0.08,
    flying: false,
  });

  const hemi = new THREE.HemisphereLight('#a5b4fc', '#0f172a', 1.1);
  const key = new THREE.DirectionalLight('#e0e7ff', 1.4);
  key.position.set(14, 28, 18);
  root.add(hemi, key);

  const floorGeo = new THREE.CylinderGeometry(42, 38, 1.0, 64);
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
    subtitle: 'jpwhitaker · Solarpunk Meadow',
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

export default defineRoom('hub', {
  mount(ctx) {
    if (ctx.hubStyle === 'meadow') {
      mountSolarpunkMeadowHub(ctx);
    } else if (ctx.hubStyle === 'nexus') {
      mountNexusHub(ctx);
    } else {
      mountFountainsHub(ctx);
    }
  },
});
