import * as THREE from 'three/webgpu';
import { breathe, seededRandom } from '@portalverse/core/rooms/kit';
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
import { createTrolleyHullGeo } from './models';
import type { DissolveFactors, ShopId } from './worldState';

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

function createBuildingFacadeTexture(seed: number, accentA: string, accentB: string): THREE.CanvasTexture {
  const rand = seededRandom(seed);
  return makeCanvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0b0e1a';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 24) {
      ctx.fillStyle = '#151b2e';
      ctx.fillRect(0, y, w, 4);
      for (let x = 10; x < w - 12; x += 22) {
        const lit = rand();
        if (lit < 0.36) {
          ctx.fillStyle = lit < 0.14 ? accentA : lit < 0.26 ? accentB : '#fef3c7';
          ctx.globalAlpha = 0.4 + rand() * 0.55;
          ctx.fillRect(x, y + 6, 13, 13);
        } else {
          ctx.fillStyle = '#101524';
          ctx.globalAlpha = 1;
          ctx.fillRect(x, y + 6, 13, 13);
        }
      }
    }
    ctx.globalAlpha = 1;
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

export interface ElectroTrolleyRig {
  group: THREE.Group;
  doorLeft: THREE.Mesh;
  doorRight: THREE.Mesh;
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
  lanternPivots: Array<{ pivot: THREE.Group; phase: number }>;
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
 * Builds the dense Perpendicular Neo-Tokyo Blade Runner Street Corner:
 * - Wet East–West Boulevard (with gleaming tram rails & Shibuya zebra crosswalk along Z)
 * - NW Corner: White Dragon Open-Air Noodle Bar (facing the intersection & crosswalk!)
 * - NE Corner: Covered Electro-Punk Bus Stop (right beside the perpendicular tram tracks) + Kuro Cyber-Optics
 * - SW Corner: Analog Ghost 90s CRT & Cassette Shop
 * - SE Corner: Gekko Mart 24H Conbini & Illuminated Vending Alcove + Bio-Cat Mochi-X
 * - Sculpted, beveled Electro-Punk Trolley running East -> West with scissor pantograph, interior seats,
 *   volumetric headlights, bogies, sliding doors & translucent cyan polygon-wireframe dissolve shell
 * - Towering vertical Neo-Tokyo megastructures with exterior AC units, conduits, neon blade signs & cables
 */
export async function buildNeoTokyoCorner(
  root: THREE.Group,
  res: ResourceBag,
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

  // Shared materials
  const darkSteelMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1b2232', roughness: 0.42, metalness: 0.74 }));
  const concreteMat = res.mat(new THREE.MeshStandardMaterial({ color: '#222838', roughness: 0.86 }));
  const darkWoodMat = res.mat(new THREE.MeshStandardMaterial({ color: '#3b251e', roughness: 0.76 }));
  const chromeMat = res.mat(new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.2, metalness: 0.92 }));
  const glassMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#93c5fd',
    transparent: true,
    opacity: 0.24,
    roughness: 0.12,
    side: THREE.DoubleSide,
  }));
  const cyanNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#a5f3fc', emissive: '#22d3ee', emissiveIntensity: 2.2 }));
  const pinkNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fbcfe8', emissive: '#f43f5e', emissiveIntensity: 2.1 }));
  const amberNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fef3c7', emissive: '#f59e0b', emissiveIntensity: 2.0 }));
  const emeraldNeonMat = res.mat(new THREE.MeshStandardMaterial({ color: '#a7f3d0', emissive: '#10b981', emissiveIntensity: 2.0 }));

  const steamPuffs: CityBuildResult['steamPuffs'] = [];
  const steamGeo = res.geo(new THREE.SphereGeometry(0.12, 8, 6));
  const steamMat = res.mat(new THREE.MeshBasicMaterial({ color: '#e2e8f0', transparent: true, opacity: 0.22, depthWrite: false }));
  const addSteamEmitter = (parent: THREE.Object3D, bx: number, by: number, bz: number, count = 4, speed = 0.55) => {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(steamGeo, steamMat);
      parent.add(m);
      steamPuffs.push({ mesh: m, baseX: bx, baseY: by, baseZ: bz, phase: i / count + rand() * 0.2, speed });
    }
  };

  // Raised Gleaming Chrome Tram Rails running PERPENDICULAR East–West along Z = TROLLEY_TRACK_Z!
  const railGeo = res.geo(new THREE.BoxGeometry(74, 0.04, 0.08));
  for (const rz of [TROLLEY_TRACK_Z - 0.65, TROLLEY_TRACK_Z + 0.65]) {
    const rail = new THREE.Mesh(railGeo, chromeMat);
    rail.position.set(0, 0.02, rz);
    root.add(rail);
  }
  // Overhead electrified East–West trolley contact wire + cross-suspensions!
  const catenary = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.024, 0.024, 74, 6).rotateZ(Math.PI / 2)), darkSteelMat);
  catenary.position.set(0, 4.3, TROLLEY_TRACK_Z);
  root.add(catenary);

  await breathe();

  // =========================================================================
  // 2. NW CORNER — WHITE DRAGON NOODLE BAR (Iconic Blade Runner open counter!)
  // =========================================================================
  const noodleY = stationHeight(NOODLE_BAR_POS.x, NOODLE_BAR_POS.z);
  const noodleGroup = new THREE.Group();
  noodleGroup.position.set(NOODLE_BAR_POS.x, noodleY, NOODLE_BAR_POS.z);

  const kitchenBox = new THREE.Mesh(res.geo(new THREE.BoxGeometry(3.4, 4.4, 7.6)), concreteMat);
  kitchenBox.position.set(-1.3, 2.2, 0);
  const kitchenGlow = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(6.4, 1.95)),
    res.mat(new THREE.MeshBasicMaterial({ color: '#ffedd5' })),
  );
  kitchenGlow.position.set(0.42, 2.08, 0);
  kitchenGlow.rotation.y = Math.PI / 2;

  // Open outdoor chrome & dark-cedar noodle counter facing +X toward the pedestrian crosswalk!
  const counterBase = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.08, 1.02, 7.0)), darkWoodMat);
  counterBase.position.set(1.75, 0.51, 0);
  const counterTop = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.26, 0.08, 7.2)), chromeMat);
  counterTop.position.set(1.78, 1.05, 0);
  const footRail = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.03, 0.03, 7.0, 8).rotateX(Math.PI / 2)), chromeMat);
  footRail.position.set(2.35, 0.2, 0);

  // Overhanging corrugated neon rain canopy sheltering seated diners
  const noodleCanopy = new THREE.Mesh(res.geo(new THREE.BoxGeometry(4.8, 0.18, 8.2)), darkSteelMat);
  noodleCanopy.position.set(1.4, 3.45, 0);
  noodleCanopy.rotation.z = -0.14;
  const canopyTrim = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.1, 0.12, 8.2)), pinkNeonMat);
  canopyTrim.position.set(3.72, 3.1, 0);
  noodleGroup.add(kitchenBox, kitchenGlow, counterBase, counterTop, footRail, noodleCanopy, canopyTrim);

  // Dual-sided WHITE DRAGON signage (facing +X into alley AND +Z across the perpendicular boulevard!)
  const noodleSignTex = res.tex(createNeonSign(512, 192, '#14080e', '#f43f5e', [
    { text: '龍 麺   WHITE DRAGON', color: '#fb7185', size: 42, y: 66 },
    { text: 'NOODLE BAR • TWO! TWO! FOUR!', color: '#fde047', size: 22, y: 132 },
  ]));
  const noodleSignMat = res.mat(new THREE.MeshBasicMaterial({ map: noodleSignTex }));
  const noodleSignEast = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(4.8, 1.65)), noodleSignMat);
  noodleSignEast.position.set(3.78, 4.15, 0);
  noodleSignEast.rotation.y = Math.PI / 2;
  const noodleSignSouth = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(4.4, 1.5)), noodleSignMat);
  noodleSignSouth.position.set(1.4, 4.15, 4.12);
  noodleGroup.add(noodleSignEast, noodleSignSouth);

  // 6 Detailed Chrome Pedestal Counter Stools + Steaming Bowls + Condiment Jars!
  const stoolSeatMat = res.mat(new THREE.MeshStandardMaterial({ color: '#e11d48', emissive: '#9f1239', emissiveIntensity: 0.48, roughness: 0.28 }));
  const stoolSeatGeo = res.geo(new THREE.CylinderGeometry(0.24, 0.22, 0.11, 16));
  const stoolStemGeo = res.geo(new THREE.CylinderGeometry(0.04, 0.048, 0.68, 10));
  const stoolBaseGeo = res.geo(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 14));
  const bowlGeo = res.geo(new THREE.CylinderGeometry(0.16, 0.09, 0.13, 14));
  const bowlMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.28 }));
  const brothMat = res.mat(new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#b45309', emissiveIntensity: 0.4 }));

  for (let i = 0; i < 6; i++) {
    const sz = -2.6 + i * 1.04;
    const base = new THREE.Mesh(stoolBaseGeo, chromeMat);
    base.position.set(2.68, 0.02, sz);
    const stem = new THREE.Mesh(stoolStemGeo, chromeMat);
    stem.position.set(2.68, 0.36, sz);
    const seat = new THREE.Mesh(stoolSeatGeo, stoolSeatMat);
    seat.position.set(2.68, 0.72, sz);
    noodleGroup.add(base, stem, seat);

    if (i === 1 || i === 3 || i === 4) {
      const bowl = new THREE.Mesh(bowlGeo, bowlMat);
      bowl.position.set(1.98, 1.15, sz);
      const broth = new THREE.Mesh(res.geo(new THREE.CircleGeometry(0.14, 12).rotateX(-Math.PI / 2)), brothMat);
      broth.position.set(1.98, 1.21, sz);
      noodleGroup.add(bowl, broth);
      addSteamEmitter(noodleGroup, 1.98, 1.28, sz, 3, 0.62);
    }
  }

  // Sizzling copper broth cauldron behind the counter
  const wok = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.46, 0.35, 0.38, 16)), res.mat(new THREE.MeshStandardMaterial({ color: '#b45309', metalness: 0.82, roughness: 0.28 })));
  wok.position.set(0.95, 1.14, -0.4);
  noodleGroup.add(wok);
  addSteamEmitter(noodleGroup, 0.95, 1.42, -0.4, 5, 0.75);

  const playerNoodleBowl = new THREE.Group();
  const pBowl = new THREE.Mesh(bowlGeo, res.mat(new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.25 })));
  const pBroth = new THREE.Mesh(res.geo(new THREE.CircleGeometry(0.14, 12).rotateX(-Math.PI / 2)), brothMat);
  pBroth.position.y = 0.06;
  const chop = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.008, 0.006, 0.34, 6)), amberNeonMat);
  chop.position.set(0.05, 0.1, 0.04);
  chop.rotation.z = 0.45;
  playerNoodleBowl.add(pBowl, pBroth, chop);
  playerNoodleBowl.position.set(1.98, 1.15, -0.52);
  playerNoodleBowl.visible = false;
  noodleGroup.add(playerNoodleBowl);

  // Swaying ribbed red chōchin lanterns
  const lanternPivots: CityBuildResult['lanternPivots'] = [];
  const lanternGeo = res.geo(new THREE.SphereGeometry(0.23, 12, 10));
  const redLanternMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fecdd3', emissive: '#ef4444', emissiveIntensity: 2.0 }));
  for (let i = 0; i < 5; i++) {
    const piv = new THREE.Group();
    piv.position.set(3.4, 3.04, -2.8 + i * 1.4);
    const l = new THREE.Mesh(lanternGeo, redLanternMat);
    l.scale.set(0.84, 1.28, 0.84);
    l.position.y = -0.32;
    const cap = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 8)), darkSteelMat);
    cap.position.y = -0.05;
    piv.add(l, cap);
    noodleGroup.add(piv);
    lanternPivots.push({ pivot: piv, phase: i * 0.9 });
  }
  root.add(noodleGroup);
  solids.boxes.push({ minX: NOODLE_BAR_POS.x - 3.0, maxX: NOODLE_BAR_POS.x + 2.35, minZ: NOODLE_BAR_POS.z - 3.8, maxZ: NOODLE_BAR_POS.z + 3.8, maxY: 4.2 });

  await breathe();

  // =========================================================================
  // 3. NE CORNER — COVERED ELECTRO-PUNK BUS STOP (Facing Perpendicular Tracks!)
  //    & KURO'S CYBER-OPTICS CLINIC right behind it
  // =========================================================================
  const busY = stationHeight(BUS_STOP_POS.x, BUS_STOP_POS.z);
  const busGroup = new THREE.Group();
  busGroup.position.set(BUS_STOP_POS.x, busY, BUS_STOP_POS.z);

  // Sleek cantilevered glass-and-steel shelter facing +Z toward the East–West trolley rails!
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

  // Live dynamic countdown display facing straight out toward the player & crosswalk (+Z)!
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

  // Kuro's Cyber-Optics & Bio-Mod Clinic (`黒目義体`) right behind the NE plaza
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
  // 4. SW CORNER — ANALOG GHOST CRT & CASSETTE SHOP (`磁気幽霊`)
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
  const crateMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.72 }));
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
  // 5. SE CORNER — GEKKO MART 24H CONBINI & VENDING ALCOVE (`月光マート`)
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
  // 6. SCULPTED HIGH-DETAIL ELECTRO-PUNK TROLLEY (Running PERPENDICULAR East -> West!)
  // =========================================================================
  const trolleyGroup = new THREE.Group();
  trolleyGroup.position.set(34.5, 0, TROLLEY_TRACK_Z);
  const tSolidMats: THREE.Material[] = [];
  const tWireMats: THREE.MeshBasicMaterial[] = [];

  const addTrolleyPart = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number], wireColor = '#22d3ee') => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    trolleyGroup.add(m);
    if (!tSolidMats.includes(mat)) {
      mat.transparent = true;
      tSolidMats.push(mat);
    }
    const wMat = res.mat(new THREE.MeshBasicMaterial({
      color: wireColor,
      wireframe: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const wm = new THREE.Mesh(geo, wMat);
    wm.position.copy(m.position);
    wm.rotation.copy(m.rotation);
    wm.scale.setScalar(1.015);
    trolleyGroup.add(wm);
    tWireMats.push(wMat);
    return m;
  };

  const tBodyMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1b2436', roughness: 0.3, metalness: 0.76 }));
  const tStripeMat = res.mat(new THREE.MeshStandardMaterial({ color: '#f43f5e', emissive: '#e11d48', emissiveIntensity: 1.6 }));
  const tCyanMat = res.mat(new THREE.MeshStandardMaterial({ color: '#a5f3fc', emissive: '#22d3ee', emissiveIntensity: 2.1 }));
  const tWinMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fef08a', emissive: '#f59e0b', emissiveIntensity: 1.45 }));
  const tDoorMat = res.mat(new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#0284c7', emissiveIntensity: 0.95 }));
  const tBeamMat = res.mat(new THREE.MeshBasicMaterial({ color: '#fef3c7', transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));

  // Sculpted beveled rounded-roof tram hull (length along X!)
  addTrolleyPart(res.geo(createTrolleyHullGeo()), tBodyMat, [0, 0.08, 0], undefined, '#22d3ee');
  // Neon lower racing trim & upper roofline cyan light tubes
  addTrolleyPart(res.geo(new THREE.BoxGeometry(8.95, 0.2, 2.52)), tStripeMat, [0, 0.85, 0], undefined, '#f43f5e');
  addTrolleyPart(res.geo(new THREE.BoxGeometry(8.95, 0.12, 2.48)), tCyanMat, [0, 2.7, 0], undefined, '#22d3ee');
  // 5 Framed Illuminated Passenger Window Bays on both sides (+Z and -Z)
  for (let w = -2; w <= 2; w++) {
    if (w === 0) continue; // middle bay is the sliding bi-parting doors!
    addTrolleyPart(res.geo(new THREE.BoxGeometry(1.38, 0.96, 2.54)), tWinMat, [w * 1.72, 1.85, 0], undefined, '#fde047');
  }
  // Westbound (-X) front panoramic LED headsign + dual projector headlamps + volumetric light beam!
  addTrolleyPart(res.geo(new THREE.BoxGeometry(0.16, 0.36, 1.75)), tCyanMat, [-4.54, 2.46, 0], undefined, '#22d3ee');
  for (const lz of [-0.72, 0.72]) {
    addTrolleyPart(res.geo(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 12).rotateZ(Math.PI / 2)), tWinMat, [-4.54, 0.92, lz], undefined, '#fde047');
    const cone = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.85, 4.6, 12, 1, true).rotateZ(-Math.PI / 2)), tBeamMat);
    cone.position.set(-6.85, 0.78, lz);
    trolleyGroup.add(cone);
  }
  // Rear (+X) red brake light bar
  addTrolleyPart(res.geo(new THREE.BoxGeometry(0.14, 0.2, 1.9)), tStripeMat, [4.54, 0.95, 0], undefined, '#f43f5e');

  // Underbody steel rail bogies & 4 wheelsets riding cleanly on the East–West rails!
  const wheelGeo = res.geo(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 14).rotateX(Math.PI / 2));
  for (const bx of [-2.8, 2.8]) {
    addTrolleyPart(res.geo(new THREE.BoxGeometry(1.85, 0.32, 1.65)), darkSteelMat, [bx, 0.34, 0], undefined, '#38bdf8');
    for (const wx of [-0.62, 0.62]) {
      for (const wz of [-0.66, 0.66]) {
        addTrolleyPart(wheelGeo, chromeMat, [bx + wx, 0.32, wz], undefined, '#22d3ee');
      }
    }
  }

  // Rooftop capacitor pods + articulated Diamond Scissor Pantograph reaching overhead wire!
  addTrolleyPart(res.geo(new THREE.BoxGeometry(1.8, 0.36, 1.4)), darkSteelMat, [-2.2, 3.02, 0], undefined, '#22d3ee');
  addTrolleyPart(res.geo(new THREE.BoxGeometry(1.8, 0.36, 1.4)), darkSteelMat, [2.2, 3.02, 0], undefined, '#22d3ee');
  addTrolleyPart(res.geo(new THREE.BoxGeometry(0.09, 1.0, 0.09)), chromeMat, [-0.24, 3.32, 0], [0, 0, -0.45], '#22d3ee');
  addTrolleyPart(res.geo(new THREE.BoxGeometry(0.09, 1.0, 0.09)), chromeMat, [0.24, 3.32, 0], [0, 0, 0.45], '#22d3ee');
  addTrolleyPart(res.geo(new THREE.BoxGeometry(0.09, 1.0, 0.09)), chromeMat, [-0.24, 3.92, 0], [0, 0, 0.45], '#22d3ee');
  addTrolleyPart(res.geo(new THREE.BoxGeometry(0.09, 1.0, 0.09)), chromeMat, [0.24, 3.92, 0], [0, 0, -0.45], '#22d3ee');
  addTrolleyPart(res.geo(new THREE.BoxGeometry(0.24, 0.1, 1.65)), tCyanMat, [0, 4.28, 0], undefined, '#22d3ee');

  // Bi-parting sliding electro-doors on the North (-Z) side facing the Bus Stop!
  const doorGeo = res.geo(new THREE.BoxGeometry(0.86, 2.02, 0.14));
  const doorLeft = addTrolleyPart(doorGeo, tDoorMat, [-0.45, 1.46, -1.24], undefined, '#5eead4');
  const doorRight = addTrolleyPart(doorGeo, tDoorMat, [0.45, 1.46, -1.24], undefined, '#5eead4');

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
      for (const m of tSolidMats) {
        m.opacity = f.solidOpacity;
        m.visible = f.solidOpacity > 0.02;
      }
      for (const wm of tWireMats) {
        wm.opacity = f.wireOpacity;
        wm.visible = f.wireOpacity > 0.02;
      }
      tBeamMat.opacity = f.solidOpacity * 0.14;
    },
  };

  await breathe();

  // =========================================================================
  // 7. TOWERING BLADE RUNNER CORNER MEGABUILDINGS + EXTERIOR GREEBLES (ACs, PIPES, NEON)
  // =========================================================================
  const facadeMats = [
    res.mat(new THREE.MeshBasicMaterial({ map: res.tex(createBuildingFacadeTexture(101, '#22d3ee', '#f43f5e')) })),
    res.mat(new THREE.MeshBasicMaterial({ map: res.tex(createBuildingFacadeTexture(202, '#fbbf24', '#c084fc')) })),
    res.mat(new THREE.MeshBasicMaterial({ map: res.tex(createBuildingFacadeTexture(303, '#34d399', '#38bdf8')) })),
  ];

  // Frame ALL FOUR corner quadrants cleanly (leaving both the N-S pedestrian alley AND E-W vehicle boulevard wide open!)
  const buildingSpecs: Array<{ x: number; z: number; w: number; h: number; d: number; m: number; vSign?: [string, string, string] }> = [
    // Inner 4 corner towers directly behind the 4 shops
    { x: -17.5, z: -15.0, w: 11.5, h: 34, d: 13.5, m: 0, vSign: ['龍麺', '#fb7185', '#fde047'] },
    { x: 17.8, z: -16.5, w: 11.5, h: 36, d: 13.5, m: 2, vSign: ['義体', '#22d3ee', '#34d399'] },
    { x: -17.5, z: 15.0, w: 11.5, h: 30, d: 13.5, m: 1, vSign: ['記憶', '#f472b6', '#22d3ee'] },
    { x: 17.8, z: 15.0, w: 11.5, h: 32, d: 13.5, m: 0, vSign: ['月光', '#fde047', '#f43f5e'] },
    // Flanking canyon towers along the perpendicular East–West boulevard!
    { x: -32.0, z: -13.5, w: 12.0, h: 28, d: 12.0, m: 2 },
    { x: -32.0, z: 13.5, w: 12.0, h: 31, d: 12.0, m: 0 },
    { x: 32.0, z: -13.5, w: 12.0, h: 30, d: 12.0, m: 1 },
    { x: 32.0, z: 13.5, w: 12.0, h: 27, d: 12.0, m: 2 },
  ];

  const acUnitGeo = res.geo(new THREE.BoxGeometry(0.95, 0.7, 0.65));
  for (const b of buildingSpecs) {
    const mesh = new THREE.Mesh(res.geo(new THREE.BoxGeometry(b.w, b.h, b.d)), facadeMats[b.m]);
    mesh.position.set(b.x, b.h * 0.5, b.z);
    root.add(mesh);

    // Exterior metal AC units & rooftop antenna spires for gritty Neo-Tokyo architectural density
    const faceX = b.x + (b.x < 0 ? b.w * 0.5 + 0.3 : -(b.w * 0.5 + 0.3));
    for (let u = 0; u < 3; u++) {
      const ac = new THREE.Mesh(acUnitGeo, darkSteelMat);
      ac.position.set(faceX, 6.5 + u * 4.2, b.z + (u - 1) * 3.2);
      root.add(ac);
    }

    if (b.vSign) {
      const [kanji, c1, c2] = b.vSign;
      const signX = b.x + (b.x < 0 ? b.w * 0.5 + 1.15 : -(b.w * 0.5 + 1.15));
      const vTex = res.tex(createNeonSign(160, 448, '#090b16', c1, [
        { text: kanji[0] || '電', color: c1, size: 78, y: 115 },
        { text: kanji[1] || '脳', color: c2, size: 78, y: 235 },
        { text: 'S-09', color: '#ffffff', size: 36, y: 365 },
      ]));
      const vMesh = new THREE.Mesh(
        res.geo(new THREE.BoxGeometry(0.24, 6.2, 2.0)),
        res.mat(new THREE.MeshBasicMaterial({ map: vTex })),
      );
      vMesh.position.set(signX, 9.8, b.z + (b.z < 0 ? 3.5 : -3.5));
      root.add(vMesh);
    }
  }

  // Towering Blade Runner holographic sky-billboards overhanging the perpendicular boulevard!
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

  // 4 Intersection Corner Streetlamps, Glowing Crosswalk Bollards, Traffic Signals & Overhead Cables!
  const trafficLights: CityBuildResult['trafficLights'] = [];
  const poleGeo = res.geo(new THREE.CylinderGeometry(0.09, 0.13, 6.4, 10));
  const bollardGeo = res.geo(new THREE.CylinderGeometry(0.11, 0.13, 0.88, 10));
  for (const [px, pz] of [[-5.0, -6.5], [5.0, -6.5], [-5.0, 6.5], [5.0, 6.5]] as const) {
    const py = stationHeight(px, pz);
    const pole = new THREE.Mesh(poleGeo, darkSteelMat);
    pole.position.set(px, py + 3.2, pz);
    const arm = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.8, 0.12, 0.12)), darkSteelMat);
    arm.position.set(px - Math.sign(px) * 0.9, py + 6.1, pz);
    const lamp = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.55, 0.1, 0.28)), amberNeonMat);
    lamp.position.set(px - Math.sign(px) * 1.65, py + 6.02, pz);
    root.add(pole, arm, lamp);
    solids.cylinders.push({ x: px, z: pz, radius: 0.2, maxY: 6.4 });

    // Illuminated cyber safety bollard on each crosswalk corner
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

  // Crisscrossed overhead power wires spanning across the corner
  for (const cz of [12, 6, -6, -12]) {
    const pts = [new THREE.Vector3(-12, 7.6, cz), new THREE.Vector3(0, 6.9, cz + 0.6), new THREE.Vector3(12, 7.8, cz)];
    root.add(new THREE.Mesh(res.geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.022, 4, false)), darkSteelMat));
  }

  // Sidewalk storm grates with rising warm steam
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
      const foilMat = res.mat(new THREE.MeshStandardMaterial({ color: '#f1f5f9', emissive: '#94a3b8', emissiveIntensity: 0.5, metalness: 0.9, roughness: 0.2, flatShading: true }));
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
      const furMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.85 }));
      const patchMat = res.mat(new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.85 }));
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
    lanternPivots,
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
