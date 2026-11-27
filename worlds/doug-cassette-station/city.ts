/// <reference types="vite/client" />
import * as THREE from 'three/webgpu';
import { breathe, disposeObject, loadGLB, seededRandom } from '@portalverse/core/rooms/kit';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  ANALOG_SHOP_POS,
  BUS_STOP_POS,
  CONBINI_POS,
  EASTER_EGGS,
  NOODLE_BAR_POS,
  OPTICS_SHOP_POS,
  TROLLEY_TRACK_Z,
  stationHeight,
  type SolidBox,
  type SolidCylinder,
} from './terrain';
import { createHoloRibbonMaterial } from './shaders';
import type { DissolveFactors, ShopId } from './worldState';

import noodleBarUrl from './assets/white_dragon_noodle_bar.glb?url';
import towerUrl from './assets/neo_tokyo_tower.glb?url';
import trolleyUrl from './assets/electro_trolley.glb?url';
import scooterUrl from './assets/cyber_scooter.glb?url';
import humanUrl from './assets/cyber_human.glb?url';

export interface BlenderAssetPack {
  noodleBar: GLTF;
  tower: GLTF;
  trolley: GLTF;
  scooter: GLTF;
  human: GLTF;
}

export async function loadBlenderAssets(): Promise<BlenderAssetPack> {
  const [noodleBar, tower, trolley, scooter, human] = await Promise.all([
    loadGLB(noodleBarUrl),
    loadGLB(towerUrl),
    loadGLB(trolleyUrl),
    loadGLB(scooterUrl),
    loadGLB(humanUrl),
  ]);
  return { noodleBar, tower, trolley, scooter, human };
}

export function disposeBlenderAssets(pack: BlenderAssetPack): void {
  disposeObject(pack.noodleBar.scene);
  disposeObject(pack.tower.scene);
  disposeObject(pack.trolley.scene);
  disposeObject(pack.scooter.scene);
  disposeObject(pack.human.scene);
}

export interface ResourceBag {
  geo: <T extends THREE.BufferGeometry>(g: T) => T;
  mat: <T extends THREE.Material>(m: T) => T;
  tex: <T extends THREE.Texture>(t: T) => T;
  dispose: () => void;
}

export function createResourceBag(): ResourceBag {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  return {
    geo<T extends THREE.BufferGeometry>(g: T): T {
      geos.push(g);
      return g;
    },
    mat<T extends THREE.Material>(m: T): T {
      mats.push(m);
      return m;
    },
    tex<T extends THREE.Texture>(t: T): T {
      texs.push(t);
      return t;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    },
  };
}

/**
 * Generates a rich procedural Blade Runner Neon-Rain Equirectangular Environment Map
 * so every metallic chrome counter, wet vinyl trenchcoat, beveled steel building,
 * scooter fairing, and trolley hull catches realistic warm-amber & cyan nighttime reflections!
 */
export function createNeonRainEnvTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Moody blue-violet wet night sky gradient down to warm neon-lit wet street bounce
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#101528');
    grad.addColorStop(0.35, '#1d223f');
    grad.addColorStop(0.5, '#3b243c');
    grad.addColorStop(0.62, '#1f293d');
    grad.addColorStop(1.0, '#0c101a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Bright specular neon reflection strips (warm noodle amber, crimson, electric cyan, soft magenta)
    const strips: Array<[number, number, number, number, string]> = [
      [35, 96, 95, 38, 'rgba(255, 168, 72, 0.85)'],
      [148, 86, 82, 42, 'rgba(244, 63, 94, 0.78)'],
      [252, 92, 92, 36, 'rgba(34, 211, 238, 0.85)'],
      [372, 88, 98, 40, 'rgba(244, 114, 182, 0.75)'],
      [110, 42, 290, 22, 'rgba(186, 230, 253, 0.35)'],
      [60, 165, 140, 28, 'rgba(251, 191, 36, 0.42)'],
      [260, 168, 160, 28, 'rgba(56, 189, 248, 0.44)'],
    ];
    for (const [x, y, w, h, col] of strips) {
      ctx.fillStyle = col;
      ctx.filter = 'blur(10px)';
      ctx.fillRect(x, y, w, h);
    }
    ctx.filter = 'none';
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Smooth vertical alpha-gradient texture for volumetric rain-mist light cones
 * (scooter headlights, trolley beams, overhead sodium streetlamps) so cones
 * dissolve softly into the rainy night air with zero hard geometric edges!
 */
export function createVolumetricConeTex(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // In ConeGeometry UV, V=1 (top of canvas y=0) is the sharp lamp apex, V=0 (bottom y=128) is the open wide base
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.42)');
    grad.addColorStop(0.68, 'rgba(255, 255, 255, 0.10)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function makeCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNeonSign(
  w: number,
  h: number,
  bg: string,
  border: string,
  lines: Array<{ text: string; color: string; size: number; y: number }>,
): THREE.CanvasTexture {
  return makeCanvasTexture(w, h, (ctx, cw, ch) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = border;
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, cw - 16, ch - 16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of lines) {
      ctx.fillStyle = l.color;
      ctx.shadowColor = l.color;
      ctx.shadowBlur = 14;
      ctx.font = `bold ${l.size}px monospace`;
      ctx.fillText(l.text, cw / 2, l.y);
    }
    ctx.shadowBlur = 0;
  });
}

function createVendingTex(title: string, headerCol: string, cans: string[]): THREE.CanvasTexture {
  return makeCanvasTexture(256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = headerCol;
    ctx.fillRect(10, 10, w - 20, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, 39);
    for (let r = 0; r < 4; r++) {
      const sy = 72 + r * 72;
      ctx.fillStyle = '#334155';
      ctx.fillRect(14, sy + 46, w - 28, 7);
      for (let c = 0; c < 5; c++) {
        const cx = 22 + c * 44;
        ctx.fillStyle = cans[(r + c) % cans.length];
        ctx.fillRect(cx, sy + 6, 30, 38);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(cx + 4, sy + 10, 6, 26);
        ctx.fillStyle = c % 2 === 0 ? '#22d3ee' : '#fbbf24';
        ctx.fillRect(cx + 6, sy + 56, 18, 6);
      }
    }
  });
}

export function createCrtTextures(): THREE.CanvasTexture[] {
  const ch0 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#090d1a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(w / 2, 82, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    for (let y = 102; y < h; y += 14) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let x = -40; x <= w + 40; x += 26) {
      ctx.beginPath(); ctx.moveTo(w / 2, 102); ctx.lineTo(x, h); ctx.stroke();
    }
  });
  const ch1 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#07131d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('SKY STATIC // CH-88', 18, 30);
    const rand = seededRandom(888);
    for (let i = 0; i < 320; i++) {
      ctx.fillStyle = i % 3 === 0 ? '#22d3ee' : i % 3 === 1 ? '#f472b6' : '#e2e8f0';
      ctx.globalAlpha = 0.25 + rand() * 0.65;
      ctx.fillRect(rand() * w, 44 + rand() * (h - 52), 4 + rand() * 10, 3);
    }
    ctx.globalAlpha = 1;
  });
  const ch2 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#120b24';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f472b6';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('VOIGHT-KAMPFF EYE', 24, 30);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(w / 2, 110, 44, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#10b981';
    ctx.beginPath(); ctx.arc(w / 2, 110, 18, 0, Math.PI * 2); ctx.fill();
  });
  const ch3 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#061a18';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x < w; x += 4) {
      const y = 104 + Math.sin(x * 0.09) * 32 + Math.cos(x * 0.22) * 14;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('SECTOR 09 • 88 BPM', 28, 30);
  });
  return [ch0, ch1, ch2, ch3];
}

/** Boosts PBR envMapIntensity on imported Blender StandardMaterials for rich wet-night sheen. */
function enhancePbrSheen(obj: THREE.Object3D, envIntensity = 1.45): void {
  obj.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.envMapIntensity = envIntensity;
      }
    }
  });
}

export interface ElectroTrolleyRig {
  group: THREE.Group;
  doorLeft: THREE.Object3D | null;
  doorRight: THREE.Object3D | null;
  sparkMesh: THREE.Mesh;
  applyDissolve: (factors: DissolveFactors) => void;
}

export interface CityBuildResult {
  solids: { boxes: SolidBox[]; cylinders: SolidCylinder[] };
  trolley: ElectroTrolleyRig;
  busSignCanvas: HTMLCanvasElement;
  busSignTex: THREE.CanvasTexture;
  shopSignMats: Record<ShopId, THREE.MeshBasicMaterial>;
  steamPuffs: Array<{ mesh: THREE.Mesh; baseX: number; baseY: number; baseZ: number; phase: number; speed: number }>;
  holoOptics: THREE.Group[];
  opticsDrone: THREE.Group;
  mainCrtScreen: THREE.Mesh;
  crtTextures: THREE.CanvasTexture[];
  vendingDrinkHolos: THREE.Group[];
  playerNoodleBowl: THREE.Group;
  trafficLights: Array<{ red: THREE.MeshStandardMaterial; green: THREE.MeshStandardMaterial }>;
  easterEggVisuals: Array<{ id: string; group: THREE.Group; halo: THREE.Mesh }>;
  catMochiTail: THREE.Mesh;
}

/**
 * Builds the Blade Runner / Neo-Tokyo Street Corner powered by Blender 5.3 GLB Hero Assets:
 * - `white_dragon_noodle_bar.glb` bathed in warm golden-amber Blade Runner counter lighting
 * - 8 instanced `neo_tokyo_tower.glb` brutalist megastructures with 3D balconies, ACs, pipes & beacons
 * - `electro_trolley.glb` gliding perpendicular East -> West with real animated doors & wireframe dissolve
 * - Kuro Cyber-Optics, Analog Ghost CRT Shrine, Gekko Mart 24H Conbini, Covered Bus Stop & 5 Easter Eggs
 */
export async function buildNeoTokyoCorner(
  root: THREE.Group,
  res: ResourceBag,
  assets: BlenderAssetPack,
  streetMat: THREE.MeshBasicNodeMaterial,
): Promise<CityBuildResult> {
  const rand = seededRandom(204911);
  const solids: { boxes: SolidBox[]; cylinders: SolidCylinder[] } = { boxes: [], cylinders: [] };

  // 1. Wet Perpendicular Intersection & Raised Corner Sidewalks
  const floorGeo = res.geo(new THREE.PlaneGeometry(118, 118, 108, 108));
  floorGeo.rotateX(-Math.PI / 2);
  const fPos = floorGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < fPos.count; i++) {
    fPos.setY(i, stationHeight(fPos.getX(i), fPos.getZ(i)));
  }
  floorGeo.computeVertexNormals();
  const floorMesh = new THREE.Mesh(floorGeo, streetMat);
  floorMesh.name = 'neo-tokyo-intersection';
  root.add(floorMesh);

  // Moody Local Blade Runner PointLights bathing wet metal, leather stools, concrete, and NPCs!
  const noodleWarmLight = new THREE.PointLight('#ff9e4a', 18, 20, 1.5);
  noodleWarmLight.position.set(NOODLE_BAR_POS.x + 2.4, 2.7, NOODLE_BAR_POS.z);
  const opticsCyanLight = new THREE.PointLight('#22d3ee', 12, 18, 1.5);
  opticsCyanLight.position.set(BUS_STOP_POS.x, 2.8, BUS_STOP_POS.z + 1.2);
  const analogPinkLight = new THREE.PointLight('#f472b6', 11, 16, 1.5);
  analogPinkLight.position.set(ANALOG_SHOP_POS.x + 2.5, 2.6, ANALOG_SHOP_POS.z);
  const conbiniGoldLight = new THREE.PointLight('#fde047', 12, 17, 1.5);
  conbiniGoldLight.position.set(CONBINI_POS.x - 2.4, 2.7, CONBINI_POS.z);
  const crosswalkSodium = new THREE.PointLight('#ffcf96', 14, 24, 1.4);
  crosswalkSodium.position.set(0, 6.2, 0);
  root.add(noodleWarmLight, opticsCyanLight, analogPinkLight, conbiniGoldLight, crosswalkSodium);

  const darkSteelMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1b2232', roughness: 0.36, metalness: 0.78, envMapIntensity: 1.4 }));
  const concreteMat = res.mat(new THREE.MeshStandardMaterial({ color: '#222838', roughness: 0.78, envMapIntensity: 1.1 }));
  const chromeMat = res.mat(new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.16, metalness: 0.94, envMapIntensity: 1.6 }));
  const glassMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#93c5fd',
    transparent: true,
    opacity: 0.24,
    roughness: 0.12,
    side: THREE.DoubleSide,
  }));
  const cyanNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#a5f3fc', emissive: '#22d3ee', emissiveIntensity: 2.3 }));
  const pinkNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fbcfe8', emissive: '#f43f5e', emissiveIntensity: 2.2 }));
  const amberNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#f59e0b', emissiveIntensity: 2.1 }));
  const emeraldNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#a7f3d0', emissive: '#10b981', emissiveIntensity: 2.0 }));

  const steamPuffs: CityBuildResult['steamPuffs'] = [];
  const steamGeo = res.geo(new THREE.SphereGeometry(0.13, 8, 6));
  const steamMat = res.mat(new THREE.MeshBasicMaterial({ color: '#f1f5f9', transparent: true, opacity: 0.24, depthWrite: false }));
  const addSteamEmitter = (parent: THREE.Object3D, bx: number, by: number, bz: number, count = 4, speed = 0.55) => {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(steamGeo, steamMat);
      parent.add(m);
      steamPuffs.push({ mesh: m, baseX: bx, baseY: by, baseZ: bz, phase: i / count + rand() * 0.2, speed });
    }
  };

  // Raised Chrome East–West Tram Rails + Overhead Electrified Catenary Wire
  const railGeo = res.geo(new THREE.BoxGeometry(74, 0.04, 0.08));
  for (const rz of [TROLLEY_TRACK_Z - 0.65, TROLLEY_TRACK_Z + 0.65]) {
    const rail = new THREE.Mesh(railGeo, chromeMat);
    rail.position.set(0, 0.02, rz);
    root.add(rail);
  }
  const catenary = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.024, 0.024, 74, 6).rotateZ(Math.PI / 2)), darkSteelMat);
  catenary.position.set(0, 4.3, TROLLEY_TRACK_Z);
  root.add(catenary);

  await breathe();

  // =========================================================================
  // 2. NW CORNER — BLENDER HERO: WHITE DRAGON NOODLE BAR (`white_dragon_noodle_bar.glb`)
  // =========================================================================
  const noodleY = stationHeight(NOODLE_BAR_POS.x, NOODLE_BAR_POS.z);
  const noodleGroup = new THREE.Group();
  noodleGroup.position.set(NOODLE_BAR_POS.x, noodleY, NOODLE_BAR_POS.z);

  const noodleModel = assets.noodleBar.scene.clone(true);
  enhancePbrSheen(noodleModel, 1.65);
  noodleGroup.add(noodleModel);

  // Dual glowing Blade Runner WHITE DRAGON neon signboards mounted cleanly on the Blender sign frame
  const noodleSignTex = res.tex(createNeonSign(512, 192, '#14080e', '#f43f5e', [
    { text: '龍 麺   WHITE DRAGON', color: '#fb7185', size: 42, y: 66 },
    { text: 'NOODLE BAR • TWO! TWO! FOUR!', color: '#fde047', size: 22, y: 132 },
  ]));
  const noodleSignMat = res.mat(new THREE.MeshBasicMaterial({ map: noodleSignTex }));
  const noodleSignEast = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(5.0, 1.65)), noodleSignMat);
  noodleSignEast.position.set(3.76, 4.15, 0);
  noodleSignEast.rotation.y = Math.PI / 2;
  const noodleSignSouth = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(4.2, 1.45)), noodleSignMat);
  noodleSignSouth.position.set(0.65, 4.18, 3.88);
  // Warm illuminated Japanese wall menu board mounted flush on the South concrete wall
  const menuWallTex = res.tex(createNeonSign(256, 320, '#140c08', '#f59e0b', [
    { text: '本日メニュー', color: '#fde047', size: 28, y: 48 },
    { text: '特製味噌 ¥880', color: '#fb7185', size: 26, y: 112 },
    { text: '黒ニンニク ¥920', color: '#f8fafc', size: 24, y: 168 },
    { text: '合成豚骨 ¥960', color: '#f8fafc', size: 24, y: 222 },
    { text: 'OPEN 24H', color: '#22d3ee', size: 22, y: 278 },
  ]));
  const menuWallMesh = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(1.18, 1.48)),
    res.mat(new THREE.MeshBasicMaterial({ map: menuWallTex })),
  );
  menuWallMesh.position.set(-0.55, 1.82, 3.86);
  // Illuminated kitchen back-wall menu calligraphy strip behind Chef Kenta
  const kitchenMenuTex = res.tex(createNeonSign(512, 128, '#26140a', '#fbbf24', [
    { text: '龍麺 • 味噌 • 醤油 • 塩 • 辛味 • 餃子 • 清酒', color: '#fef3c7', size: 28, y: 66 },
  ]));
  const kitchenMenuMesh = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(5.2, 0.72)),
    res.mat(new THREE.MeshBasicMaterial({ map: kitchenMenuTex })),
  );
  kitchenMenuMesh.position.set(0.02, 2.02, 0);
  kitchenMenuMesh.rotation.y = Math.PI / 2;
  noodleGroup.add(noodleSignEast, noodleSignSouth, menuWallMesh, kitchenMenuMesh);

  // Rising atmospheric steam billowing from the Blender copper stockpots & counter ramen bowls!
  addSteamEmitter(noodleGroup, 0.95, 1.46, -0.4, 5, 0.72);
  addSteamEmitter(noodleGroup, 0.95, 1.46, 0.7, 4, 0.65);
  for (const sy of [-1.56, 0.52, 1.56]) {
    addSteamEmitter(noodleGroup, 1.98, 1.28, sy, 3, 0.58);
  }

  // Interactive Player Noodle Bowl (appears when you step up to order!)
  const playerNoodleBowl = new THREE.Group();
  const bowlGeo = res.geo(new THREE.CylinderGeometry(0.16, 0.09, 0.13, 16));
  const pBowl = new THREE.Mesh(bowlGeo, res.mat(new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.22 })));
  const pBroth = new THREE.Mesh(
    res.geo(new THREE.CircleGeometry(0.14, 14).rotateX(-Math.PI / 2)),
    res.mat(new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#b45309', emissiveIntensity: 0.55 })),
  );
  pBroth.position.y = 0.06;
  const chop = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.008, 0.006, 0.34, 6)), amberNeonMat);
  chop.position.set(0.05, 0.1, 0.04);
  chop.rotation.z = 0.45;
  playerNoodleBowl.add(pBowl, pBroth, chop);
  playerNoodleBowl.position.set(1.98, 1.16, -0.52);
  playerNoodleBowl.visible = false;
  noodleGroup.add(playerNoodleBowl);

  root.add(noodleGroup);
  solids.boxes.push({ minX: NOODLE_BAR_POS.x - 3.0, maxX: NOODLE_BAR_POS.x + 2.38, minZ: NOODLE_BAR_POS.z - 3.8, maxZ: NOODLE_BAR_POS.z + 3.8, maxY: 4.3 });

  await breathe();

  // =========================================================================
  // 3. NE CORNER — COVERED BUS STOP & KURO'S CYBER-OPTICS CLINIC
  // =========================================================================
  const busY = stationHeight(BUS_STOP_POS.x, BUS_STOP_POS.z);
  const busGroup = new THREE.Group();
  busGroup.position.set(BUS_STOP_POS.x, busY, BUS_STOP_POS.z);

  const busRoof = new THREE.Mesh(res.geo(new THREE.BoxGeometry(5.8, 0.15, 2.5)), darkSteelMat);
  busRoof.position.set(0, 3.05, 0);
  const busRoofGlow = new THREE.Mesh(res.geo(new THREE.BoxGeometry(5.8, 0.09, 0.09)), cyanNeonMat);
  busRoofGlow.position.set(0, 3.02, 1.24);
  const busBackGlass = new THREE.Mesh(res.geo(new THREE.BoxGeometry(5.2, 2.75, 0.08)), glassMat);
  busBackGlass.position.set(0, 1.5, -1.05);
  for (const bx of [-2.5, 2.5]) {
    const p = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.14, 3.05, 0.14)), darkSteelMat);
    p.position.set(bx, 1.52, -1.05);
    busGroup.add(p);
  }
  const busBench = new THREE.Mesh(res.geo(new THREE.BoxGeometry(3.4, 0.1, 0.62)), darkSteelMat);
  busBench.position.set(0, 0.54, -0.58);
  const busPole = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.07, 0.08, 3.6, 10)), chromeMat);
  busPole.position.set(-2.95, 1.8, 0.8);
  const busBeacon = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16).rotateX(Math.PI / 2)), cyanNeonMat);
  busBeacon.position.set(-2.95, 3.3, 0.8);
  busGroup.add(busRoof, busRoofGlow, busBackGlass, busBench, busPole, busBeacon);

  const busSignCanvas = document.createElement('canvas');
  busSignCanvas.width = 512;
  busSignCanvas.height = 192;
  const busSignTex = res.tex(new THREE.CanvasTexture(busSignCanvas));
  busSignTex.colorSpace = THREE.SRGBColorSpace;
  const busSign = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(2.8, 1.02)),
    res.mat(new THREE.MeshBasicMaterial({ map: busSignTex })),
  );
  busSign.position.set(0, 2.15, -0.95);
  busGroup.add(busSign);
  root.add(busGroup);
  solids.boxes.push({ minX: BUS_STOP_POS.x - 2.8, maxX: BUS_STOP_POS.x + 2.8, minZ: BUS_STOP_POS.z - 1.25, maxZ: BUS_STOP_POS.z - 0.8, maxY: 3.1 });

  // Kuro's Cyber-Optics & Bio-Mod Clinic
  const opticsY = stationHeight(OPTICS_SHOP_POS.x, OPTICS_SHOP_POS.z);
  const opticsGroup = new THREE.Group();
  opticsGroup.position.set(OPTICS_SHOP_POS.x, opticsY, OPTICS_SHOP_POS.z);

  const opticsShell = new THREE.Mesh(res.geo(new THREE.BoxGeometry(3.8, 4.4, 6.2)), concreteMat);
  opticsShell.position.set(0.8, 2.2, 0);
  const opticsWindow = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(5.0, 2.3)), glassMat);
  opticsWindow.position.set(-1.12, 1.85, 0);
  opticsWindow.rotation.y = -Math.PI / 2;
  const opticsBacklit = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(4.9, 2.2)), res.mat(new THREE.MeshBasicMaterial({ color: '#082f49' })));
  opticsBacklit.position.set(-0.65, 1.85, 0);
  opticsBacklit.rotation.y = -Math.PI / 2;
  const opticsAwning = new THREE.Mesh(res.geo(new THREE.BoxGeometry(2.4, 0.14, 6.6)), darkSteelMat);
  opticsAwning.position.set(-1.7, 3.35, 0);
  opticsAwning.rotation.z = 0.14;
  opticsGroup.add(opticsShell, opticsWindow, opticsBacklit, opticsAwning);

  const opticsSignTex = res.tex(createNeonSign(512, 192, '#04141f', '#22d3ee', [
    { text: '黒目義体  KURO OPTICS', color: '#22d3ee', size: 40, y: 66 },
    { text: 'CYBER-EYES • BIO-MOD CLINIC', color: '#5eead4', size: 22, y: 132 },
  ]));
  const opticsSignMat = res.mat(new THREE.MeshBasicMaterial({ map: opticsSignTex }));
  const opticsSign = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(4.4, 1.5)), opticsSignMat);
  opticsSign.position.set(-2.9, 4.05, 0);
  opticsSign.rotation.y = -Math.PI / 2;
  opticsGroup.add(opticsSign);

  const holoOptics: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const eyeG = new THREE.Group();
    const sclera = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.24, 14, 10)), res.mat(new THREE.MeshBasicMaterial({ color: '#22d3ee', wireframe: true, transparent: true, opacity: 0.72 })));
    const iris = new THREE.Mesh(res.geo(new THREE.TorusGeometry(0.14, 0.035, 8, 18)), i === 1 ? emeraldNeonMat : cyanNeonMat);
    iris.position.z = 0.2;
    eyeG.add(sclera, iris);
    eyeG.position.set(-0.92, 1.85, -1.5 + i * 1.5);
    eyeG.rotation.y = -Math.PI / 2;
    opticsGroup.add(eyeG);
    holoOptics.push(eyeG);
  }
  const opticsDrone = new THREE.Group();
  opticsDrone.add(
    new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.22, 12, 10)), darkSteelMat),
    new THREE.Mesh(res.geo(new THREE.TorusGeometry(0.32, 0.03, 6, 18).rotateX(Math.PI / 2)), cyanNeonMat),
    new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.08, 8, 6)), emeraldNeonMat).translateX(-0.2),
  );
  opticsDrone.position.set(OPTICS_SHOP_POS.x - 2.9, opticsY + 2.1, OPTICS_SHOP_POS.z + 1.6);
  root.add(opticsGroup, opticsDrone);
  solids.boxes.push({ minX: OPTICS_SHOP_POS.x - 1.25, maxX: OPTICS_SHOP_POS.x + 2.8, minZ: OPTICS_SHOP_POS.z - 3.2, maxZ: OPTICS_SHOP_POS.z + 3.2, maxY: 4.4 });

  // =========================================================================
  // 4. SW CORNER — ANALOG GHOST CRT & CASSETTE SHOP
  // =========================================================================
  const analogY = stationHeight(ANALOG_SHOP_POS.x, ANALOG_SHOP_POS.z);
  const analogGroup = new THREE.Group();
  analogGroup.position.set(ANALOG_SHOP_POS.x, analogY, ANALOG_SHOP_POS.z);

  const analogShell = new THREE.Mesh(res.geo(new THREE.BoxGeometry(3.6, 4.2, 6.2)), concreteMat);
  analogShell.position.set(-0.9, 2.1, 0);
  const analogAwning = new THREE.Mesh(res.geo(new THREE.BoxGeometry(2.6, 0.14, 6.6)), darkSteelMat);
  analogAwning.position.set(1.6, 3.25, 0);
  analogAwning.rotation.z = -0.12;
  analogGroup.add(analogShell, analogAwning);

  const analogSignTex = res.tex(createNeonSign(512, 192, '#160921', '#f472b6', [
    { text: '磁気幽霊  ANALOG GHOST', color: '#f472b6', size: 38, y: 66 },
    { text: 'CASSETTES • CRT • STATIC TAPE', color: '#38bdf8', size: 22, y: 132 },
  ]));
  const analogSignMat = res.mat(new THREE.MeshBasicMaterial({ map: analogSignTex }));
  const analogSign = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(4.4, 1.5)), analogSignMat);
  analogSign.position.set(2.9, 3.95, 0);
  analogSign.rotation.y = Math.PI / 2;
  analogGroup.add(analogSign);

  const crtTextures = createCrtTextures();
  crtTextures.forEach(t => res.tex(t));
  const crateMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.65 }));
  for (const cz of [-1.2, 0, 1.2]) {
    const crate = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.9, 0.42, 0.9)), crateMat);
    crate.position.set(1.5, 0.21, cz);
    analogGroup.add(crate);
  }
  let mainCrtScreen!: THREE.Mesh;
  const crtSpecs = [
    { z: 0, y: 0.85, w: 1.0, h: 0.8, ch: 1, main: true },
    { z: -1.15, y: 0.8, w: 0.82, h: 0.68, ch: 0, main: false },
    { z: 1.15, y: 0.8, w: 0.84, h: 0.68, ch: 2, main: false },
    { z: -0.5, y: 1.58, w: 0.76, h: 0.62, ch: 3, main: false },
    { z: 0.55, y: 1.54, w: 0.72, h: 0.58, ch: 0, main: false },
  ];
  for (const c of crtSpecs) {
    const tv = new THREE.Group();
    tv.position.set(1.48, c.y, c.z);
    const body = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.84, c.h, c.w)), darkSteelMat);
    const scr = new THREE.Mesh(
      res.geo(new THREE.PlaneGeometry(c.w * 0.82, c.h * 0.76)),
      res.mat(new THREE.MeshBasicMaterial({ map: crtTextures[c.ch] })),
    );
    scr.position.set(0.425, 0, 0);
    scr.rotation.y = Math.PI / 2;
    tv.add(body, scr);
    if (c.main) mainCrtScreen = scr;
    analogGroup.add(tv);
  }
  root.add(analogGroup);
  solids.boxes.push({ minX: ANALOG_SHOP_POS.x - 2.7, maxX: ANALOG_SHOP_POS.x + 2.05, minZ: ANALOG_SHOP_POS.z - 3.2, maxZ: ANALOG_SHOP_POS.z + 3.2, maxY: 4.2 });

  // =========================================================================
  // 5. SE CORNER — GEKKO MART 24H CONBINI & VENDING ALCOVE
  // =========================================================================
  const conbiniY = stationHeight(CONBINI_POS.x, CONBINI_POS.z);
  const conbiniGroup = new THREE.Group();
  conbiniGroup.position.set(CONBINI_POS.x, conbiniY, CONBINI_POS.z);

  const conbiniShell = new THREE.Mesh(res.geo(new THREE.BoxGeometry(3.8, 4.3, 7.0)), concreteMat);
  conbiniShell.position.set(0.9, 2.15, 0);
  const conbiniAwning = new THREE.Mesh(res.geo(new THREE.BoxGeometry(2.6, 0.16, 7.2)), darkSteelMat);
  conbiniAwning.position.set(-1.6, 3.25, 0);
  conbiniAwning.rotation.z = 0.1;
  const conbiniStripe = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.1, 0.14, 7.2)), amberNeonMat);
  conbiniStripe.position.set(-2.85, 3.08, 0);
  conbiniGroup.add(conbiniShell, conbiniAwning, conbiniStripe);

  const conbiniSignTex = res.tex(createNeonSign(512, 192, '#141108', '#fbbf24', [
    { text: '月光マート  GEKKO 24H', color: '#fde047', size: 40, y: 66 },
    { text: 'SYNTH-SNACKS • HOT MATCHA', color: '#5eead4', size: 22, y: 132 },
  ]));
  const conbiniSignMat = res.mat(new THREE.MeshBasicMaterial({ map: conbiniSignTex }));
  const conbiniSign = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(4.6, 1.5)), conbiniSignMat);
  conbiniSign.position.set(-2.9, 3.92, 0);
  conbiniSign.rotation.y = -Math.PI / 2;
  conbiniGroup.add(conbiniSign);

  const vendingDrinkHolos: THREE.Group[] = [];
  const vSpecs = [
    { title: 'HOT MATCHA', head: '#059669', glow: '#34d399', cans: ['#34d399', '#6ee7b7', '#fde047', '#10b981'], dz: -2.0 },
    { title: 'PEACH FIZZ', head: '#e11d48', glow: '#fb7185', cans: ['#fb7185', '#f472b6', '#fde047', '#fb923c'], dz: 0 },
    { title: 'CHROME SODA', head: '#0284c7', glow: '#38bdf8', cans: ['#38bdf8', '#22d3ee', '#a78bfa', '#f8fafc'], dz: 2.0 },
  ];
  for (const v of vSpecs) {
    const vg = new THREE.Group();
    vg.position.set(-1.3, 0, v.dz);
    const body = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.05, 2.35, 1.48)), darkSteelMat);
    body.position.y = 1.18;
    const screen = new THREE.Mesh(
      res.geo(new THREE.PlaneGeometry(1.26, 1.56)),
      res.mat(new THREE.MeshBasicMaterial({ map: res.tex(createVendingTex(v.title, v.head, v.cans)) })),
    );
    screen.position.set(-0.535, 1.42, 0);
    screen.rotation.y = -Math.PI / 2;
    vg.add(body, screen);

    const holo = new THREE.Group();
    const hMat = res.mat(new THREE.MeshBasicMaterial({ color: v.glow, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending }));
    holo.add(
      new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 12)), hMat),
      new THREE.Mesh(res.geo(new THREE.RingGeometry(0.16, 0.22, 16).rotateX(-Math.PI / 2)), hMat).translateY(-0.16),
    );
    holo.position.set(-0.98, 1.0, 0);
    holo.visible = false;
    vg.add(holo);
    vendingDrinkHolos.push(holo);
    conbiniGroup.add(vg);
  }
  root.add(conbiniGroup);
  solids.boxes.push({ minX: CONBINI_POS.x - 1.95, maxX: CONBINI_POS.x + 2.8, minZ: CONBINI_POS.z - 3.6, maxZ: CONBINI_POS.z + 3.6, maxY: 4.3 });

  await breathe();

  // =========================================================================
  // 6. BLENDER HERO: ELECTRO-PUNK TROLLEY (`electro_trolley.glb`) + WIREFRAME DISSOLVE
  // =========================================================================
  const trolleyGroup = new THREE.Group();
  trolleyGroup.position.set(34.5, 0, TROLLEY_TRACK_Z);

  const trolleySolid = assets.trolley.scene.clone(true);
  const tSolidMats: THREE.Material[] = [];
  trolleySolid.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const cloned = (mesh.material as THREE.Material).clone();
    cloned.transparent = true;
    if (cloned instanceof THREE.MeshStandardMaterial) cloned.envMapIntensity = 1.65;
    res.mat(cloned);
    mesh.material = cloned;
    tSolidMats.push(cloned);
  });
  const doorLeft = trolleySolid.getObjectByName('DoorLeft') ?? null;
  const doorRight = trolleySolid.getObjectByName('DoorRight') ?? null;
  trolleyGroup.add(trolleySolid);

  // Matching translucent glowing cyan polygon-wireframe dissolve shell!
  const tWireMat = res.mat(new THREE.MeshBasicMaterial({
    color: '#22d3ee',
    wireframe: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const trolleyWire = assets.trolley.scene.clone(true);
  trolleyWire.scale.setScalar(1.012);
  trolleyWire.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.material = tWireMat;
  });
  trolleyGroup.add(trolleyWire);

  // Sweeping soft-faded volumetric headlight beams projecting westward (-X) across the wet crosswalk!
  const coneFadeTex = res.tex(createVolumetricConeTex());
  const tBeamMat = res.mat(new THREE.MeshBasicMaterial({
    color: '#fef3c7',
    map: coneFadeTex,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  for (const lz of [-0.76, 0.76]) {
    const cone = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.95, 5.2, 20, 1, true).rotateZ(-Math.PI / 2)), tBeamMat);
    cone.position.set(-7.1, 0.84, lz);
    trolleyGroup.add(cone);
  }

  const sparkMesh = new THREE.Mesh(
    res.geo(new THREE.OctahedronGeometry(0.36, 0)),
    res.mat(new THREE.MeshBasicMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending })),
  );
  sparkMesh.position.set(0, 4.32, 0);
  trolleyGroup.add(sparkMesh);
  root.add(trolleyGroup);

  const trolley: ElectroTrolleyRig = {
    group: trolleyGroup,
    doorLeft,
    doorRight,
    sparkMesh,
    applyDissolve(f: DissolveFactors) {
      trolleyGroup.visible = f.visible;
      trolleySolid.visible = f.solidOpacity > 0.02;
      for (const m of tSolidMats) m.opacity = f.solidOpacity;
      trolleyWire.visible = f.wireOpacity > 0.02;
      tWireMat.opacity = f.wireOpacity;
      tBeamMat.opacity = f.solidOpacity * 0.24;
    },
  };

  await breathe();

  // =========================================================================
  // 7. BLENDER HERO: 8 LAYERED NEO-TOKYO MEGABUILDING TOWERS (`neo_tokyo_tower.glb`)
  // =========================================================================
  const towerSpecs: Array<{ x: number; z: number; sy: number; rotY: number; vSign?: [string, string, string] }> = [
    { x: -17.8, z: -15.0, sy: 1.05, rotY: 0, vSign: ['龍麺', '#fb7185', '#fde047'] },
    { x: 18.0, z: -16.8, sy: 1.12, rotY: Math.PI, vSign: ['義体', '#22d3ee', '#34d399'] },
    { x: -17.8, z: 15.0, sy: 0.96, rotY: 0, vSign: ['記憶', '#f472b6', '#22d3ee'] },
    { x: 18.0, z: 15.0, sy: 1.02, rotY: Math.PI, vSign: ['月光', '#fde047', '#f43f5e'] },
    { x: -32.2, z: -13.5, sy: 0.92, rotY: 0 },
    { x: -32.2, z: 13.5, sy: 1.0, rotY: Math.PI },
    { x: 32.2, z: -13.5, sy: 0.98, rotY: Math.PI },
    { x: 32.2, z: 13.5, sy: 0.88, rotY: 0 },
  ];

  for (const t of towerSpecs) {
    const tMesh = assets.tower.scene.clone(true);
    enhancePbrSheen(tMesh, 1.35);
    tMesh.position.set(t.x, 0, t.z);
    tMesh.scale.set(1, t.sy, 1);
    tMesh.rotation.y = t.rotY;
    root.add(tMesh);

    if (t.vSign) {
      const [kanji, c1, c2] = t.vSign;
      const signX = t.x + (t.x < 0 ? 6.6 : -6.6);
      const vTex = res.tex(createNeonSign(160, 448, '#090b16', c1, [
        { text: kanji[0] || '電', color: c1, size: 78, y: 115 },
        { text: kanji[1] || '脳', color: c2, size: 78, y: 235 },
        { text: 'S-09', color: '#ffffff', size: 36, y: 365 },
      ]));
      const vMesh = new THREE.Mesh(
        res.geo(new THREE.BoxGeometry(0.24, 6.2, 2.0)),
        res.mat(new THREE.MeshBasicMaterial({ map: vTex })),
      );
      vMesh.position.set(signX, 9.8, t.z + (t.z < 0 ? 3.5 : -3.5));
      root.add(vMesh);
    }
  }

  // Towering Blade Runner holographic sky-billboards overhanging the corner
  const skyBillTexA = res.tex(createNeonSign(512, 256, '#05101f', '#22d3ee', [
    { text: 'OFF-WORLD COLONIES', color: '#22d3ee', size: 38, y: 80 },
    { text: 'A NEW LIFE AWAITS • SECTOR 09', color: '#f472b6', size: 22, y: 152 },
    { text: 'ALL THOSE MOMENTS...', color: '#94a3b8', size: 18, y: 208 },
  ]));
  const holoBillA = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(11.5, 5.4)),
    res.mat(new THREE.MeshBasicMaterial({ map: skyBillTexA, transparent: true, opacity: 0.74, side: THREE.DoubleSide })),
  );
  holoBillA.position.set(-10.8, 13.8, -8.5);
  holoBillA.rotation.y = Math.PI * 0.35;
  root.add(holoBillA);

  const skyRibbon = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(16, 2.2)),
    res.mat(createHoloRibbonMaterial('#22d3ee', '#f43f5e')),
  );
  skyRibbon.position.set(0, 11.4, -15.5);
  root.add(skyRibbon);

  // 4 Intersection Streetlamps, Soft Rain-Mist Light Cones, Glowing Crosswalk Bollards & Traffic Signals
  const trafficLights: CityBuildResult['trafficLights'] = [];
  const poleGeo = res.geo(new THREE.CylinderGeometry(0.09, 0.13, 6.4, 10));
  const bollardGeo = res.geo(new THREE.CylinderGeometry(0.11, 0.13, 0.88, 10));
  const lampConeGeo = res.geo(new THREE.ConeGeometry(2.3, 5.8, 22, 1, true));
  const lampConeMat = res.mat(new THREE.MeshBasicMaterial({
    color: '#ffd699',
    map: coneFadeTex,
    transparent: true,
    opacity: 0.13,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  for (const [px, pz] of [[-5.0, -6.5], [5.0, -6.5], [-5.0, 6.5], [5.0, 6.5]] as const) {
    const py = stationHeight(px, pz);
    const pole = new THREE.Mesh(poleGeo, darkSteelMat);
    pole.position.set(px, py + 3.2, pz);
    const arm = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.8, 0.12, 0.12)), darkSteelMat);
    arm.position.set(px - Math.sign(px) * 0.9, py + 6.1, pz);
    const lamp = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.55, 0.1, 0.28)), amberNeonMat);
    lamp.position.set(px - Math.sign(px) * 1.65, py + 6.02, pz);
    const mistCone = new THREE.Mesh(lampConeGeo, lampConeMat);
    mistCone.position.set(px - Math.sign(px) * 1.65, py + 3.1, pz);
    root.add(pole, arm, lamp, mistCone);
    solids.cylinders.push({ x: px, z: pz, radius: 0.2, maxY: 6.4 });

    const bol = new THREE.Mesh(bollardGeo, darkSteelMat);
    bol.position.set(px - Math.sign(px) * 0.7, py + 0.44, pz);
    const bolRing = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10)), cyanNeonMat);
    bolRing.position.set(px - Math.sign(px) * 0.7, py + 0.74, pz);
    root.add(bol, bolRing);

    const sigBox = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.32, 0.78, 0.32)), darkSteelMat);
    sigBox.position.set(px - Math.sign(px) * 0.35, py + 3.85, pz);
    const redMat = res.mat(new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 1.6 }));
    const greenMat = res.mat(new THREE.MeshStandardMaterial({ color: '#10b981', emissive: '#10b981', emissiveIntensity: 0.2 }));
    const redLed = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.09, 8, 6)), redMat);
    redLed.position.set(px - Math.sign(px) * 0.35, py + 4.02, pz + (pz > 0 ? 0.16 : -0.16));
    const greenLed = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.09, 8, 6)), greenMat);
    greenLed.position.set(px - Math.sign(px) * 0.35, py + 3.68, pz + (pz > 0 ? 0.16 : -0.16));
    root.add(sigBox, redLed, greenLed);
    trafficLights.push({ red: redMat, green: greenMat });
  }

  for (const cz of [12, 6, -6, -12]) {
    const pts = [new THREE.Vector3(-12, 7.6, cz), new THREE.Vector3(0, 6.9, cz + 0.6), new THREE.Vector3(12, 7.8, cz)];
    root.add(new THREE.Mesh(res.geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.022, 4, false)), darkSteelMat));
  }

  const grateGeo = res.geo(new THREE.BoxGeometry(0.85, 0.04, 0.85));
  for (const [gx, gz] of [[-5.6, -7.8], [5.6, 8.2], [-5.6, 8.8], [11.5, -7.2]] as const) {
    const gy = stationHeight(gx, gz);
    const grate = new THREE.Mesh(grateGeo, darkSteelMat);
    grate.position.set(gx, gy + 0.02, gz);
    root.add(grate);
    addSteamEmitter(root, gx, gy + 0.12, gz, 4, 0.45);
  }

  // =========================================================================
  // 8. FIVE HIDDEN BLADE RUNNER & NEO-TOKYO EASTER EGG PROPS
  // =========================================================================
  const easterEggVisuals: CityBuildResult['easterEggVisuals'] = [];
  let catMochiTail!: THREE.Mesh;

  for (const egg of EASTER_EGGS) {
    const ey = stationHeight(egg.x, egg.z);
    const g = new THREE.Group();
    g.position.set(egg.x, ey, egg.z);

    const halo = new THREE.Mesh(
      res.geo(new THREE.RingGeometry(0.24, 0.32, 20).rotateX(-Math.PI / 2)),
      res.mat(new THREE.MeshBasicMaterial({
        color: egg.color,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })),
    );
    halo.position.y = 0.04;
    g.add(halo);

    if (egg.id === 'origami-unicorn') {
      const foilMat = res.mat(new THREE.MeshStandardMaterial({ color: '#f1f5f9', emissive: '#94a3b8', emissiveIntensity: 0.5, metalness: 0.92, roughness: 0.18, flatShading: true }));
      const body = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.14, 0.34, 4).rotateZ(Math.PI / 2)), foilMat);
      body.position.y = 0.28;
      const neck = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.08, 0.24, 4)), foilMat);
      neck.position.set(0.12, 0.42, 0);
      neck.rotation.z = -0.35;
      const horn = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.022, 0.16, 4)), cyanNeonMat);
      horn.position.set(0.2, 0.54, 0);
      horn.rotation.z = -0.65;
      g.add(body, neck, horn);
    } else if (egg.id === 'dead-channel-tape') {
      const tape = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.4, 0.24, 0.07)), cyanNeonMat);
      tape.position.y = 0.48;
      g.add(tape);
    } else if (egg.id === 'ocular-scanner') {
      const base = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.36, 0.24, 0.32)), darkSteelMat);
      base.position.y = 0.4;
      const lens = new THREE.Mesh(res.geo(new THREE.TorusGeometry(0.1, 0.03, 8, 16)), emeraldNeonMat);
      lens.position.set(-0.18, 0.44, 0);
      lens.rotation.y = Math.PI / 2;
      g.add(base, lens);
    } else if (egg.id === 'trolley-pass-404') {
      const card = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.28, 0.02, 0.18)), pinkNeonMat);
      card.position.y = 0.58;
      g.add(card);
    } else {
      const furMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.82 }));
      const patchMat = res.mat(new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.82 }));
      const cBody = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.22, 12, 10)), furMat);
      cBody.scale.set(1.2, 0.68, 1.0);
      cBody.position.y = 0.16;
      const cHead = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.13, 10, 8)), patchMat);
      cHead.position.set(0.2, 0.24, 0.04);
      const earTag = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.035, 6, 5)), amberNeonMat);
      earTag.position.set(0.22, 0.36, 0.09);
      catMochiTail = new THREE.Mesh(res.geo(new THREE.CapsuleGeometry(0.03, 0.26, 4, 6)), patchMat);
      catMochiTail.position.set(-0.24, 0.14, 0.12);
      catMochiTail.rotation.set(0.2, 0.3, Math.PI / 2.2);
      g.add(cBody, cHead, earTag, catMochiTail);
    }

    root.add(g);
    easterEggVisuals.push({ id: egg.id, group: g, halo });
  }

  return {
    solids,
    trolley,
    busSignCanvas,
    busSignTex,
    shopSignMats: {
      noodles: noodleSignMat,
      optics: opticsSignMat,
      analog: analogSignMat,
      conbini: conbiniSignMat,
    },
    steamPuffs,
    holoOptics,
    opticsDrone,
    mainCrtScreen,
    crtTextures,
    vendingDrinkHolos,
    playerNoodleBowl,
    trafficLights,
    easterEggVisuals,
    catMochiTail,
  };
}
