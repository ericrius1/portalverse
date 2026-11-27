import * as THREE from 'three/webgpu';
import { breathe, seededRandom } from '@portalverse/core/rooms/kit';
import {
  CASSETTE_ARCH_Z,
  CAT_BENCH_POS,
  CRT_NOOK_POS,
  PHONE_BOOTH_POS,
  RAMEN_KIOSK_POS,
  SHELTER_POS,
  VENDING_ROW_POS,
  stationHeight,
  type SolidBox,
  type SolidCylinder,
} from './terrain';
import { createHoloRibbonMaterial } from './shaders';

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

function makeCanvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Retro illuminated vending machine display texture with glowing rows of colorful drinks. */
function createVendingDisplayTexture(theme: 'matcha' | 'peach' | 'ramune'): THREE.CanvasTexture {
  return makeCanvasTexture(256, 384, (ctx, w, h) => {
    const bg = theme === 'matcha' ? '#e7f5e4' : theme === 'peach' ? '#ffecec' : '#e0f4ff';
    const header = theme === 'matcha' ? '#2d6a4f' : theme === 'peach' ? '#d6456b' : '#0284c7';
    const label = theme === 'matcha' ? 'WARM MATCHA' : theme === 'peach' ? 'PEACH FIZZ' : 'STAR RAMUNE';
    const cans =
      theme === 'matcha'
        ? ['#52b788', '#74c69d', '#d8f3dc', '#f4d35e', '#40916c']
        : theme === 'peach'
          ? ['#fb7185', '#fda4af', '#fde047', '#f472b6', '#fb923c']
          : ['#38bdf8', '#7dd3fc', '#a78bfa', '#5eead4', '#f8fafc'];

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Top illuminated header banner
    ctx.fillStyle = header;
    ctx.fillRect(10, 10, w - 20, 46);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, 41);

    // 4 shelves of tiny illuminated cans/bottles + glowing price strips
    for (let row = 0; row < 4; row++) {
      const sy = 76 + row * 72;
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(14, sy + 46, w - 28, 8);
      for (let col = 0; col < 5; col++) {
        const cx = 24 + col * 44;
        ctx.fillStyle = cans[(row + col) % cans.length];
        ctx.fillRect(cx, sy + 6, 30, 38);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(cx + 4, sy + 10, 7, 26);
        // Tiny glowing selection button
        ctx.fillStyle = row % 2 === 0 ? '#38bdf8' : '#fbbf24';
        ctx.fillRect(cx + 6, sy + 56, 18, 7);
      }
    }
  });
}

/** Retro CRT departure board texture for the station waiting shelter. */
function createDepartureBoardTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0d1522';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.fillStyle = '#5eead4';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('MIDNIGHT CASSETTE LINE', 28, 50);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('01  STARLIGHT EXP      02 MIN', 28, 104);
    ctx.fillStyle = '#f472b6';
    ctx.fillText('02  CLOUD OBSERVATORY  07 MIN', 28, 148);
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText('03  SOLARPUNK MEADOW   12 MIN', 28, 192);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px monospace';
    ctx.fillText('WEATHER: SOFT RAIN  •  BPM: 88  •  TAPE: B-MAJ', 28, 232);
  });
}

/** Creates a glowing neon sign texture (warm retro kanji/english café & lo-fi vibes). */
function createNeonSignTexture(title: string, subtitle: string, fg: string, accent: string): THREE.CanvasTexture {
  return makeCanvasTexture(384, 160, (ctx, w, h) => {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = fg;
    ctx.font = 'bold 54px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, 82);
    ctx.fillStyle = accent;
    ctx.font = 'bold 26px monospace';
    ctx.fillText(subtitle, w / 2, 128);
  });
}

/** Creates 4 distinct nostalgic CRT screen textures so walking up switches channels! */
export function createCrtChannelTextures(): THREE.CanvasTexture[] {
  const ch0 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    // Retro synthwave cyan/violet horizon grid & glowing sun
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#130b2e');
    g.addColorStop(0.55, '#4c1d6e');
    g.addColorStop(1, '#0c1829');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.arc(w / 2, 86, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    for (let y = 104; y < h; y += 14) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = -40; x <= w + 40; x += 28) {
      ctx.beginPath();
      ctx.moveTo(w / 2, 104);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });

  const ch1 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    // Cozy lo-fi audio spectrum & cassette label
    ctx.fillStyle = '#091522';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5eead4';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('CH-02  LO-FI RAIN FM', 20, 32);
    const bars = [48, 82, 110, 68, 96, 124, 78, 54, 92, 62];
    bars.forEach((bh, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? '#38bdf8' : '#f472b6';
      ctx.fillRect(22 + idx * 21, 166 - bh, 14, bh);
    });
  });

  const ch2 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    // Nostalgic pixel sleeping cat under a yellow moon
    ctx.fillStyle = '#111633';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(198, 48, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111633';
    ctx.beginPath();
    ctx.arc(206, 44, 18, 0, Math.PI * 2);
    ctx.fill();
    // Cute pixel cat silhouette
    ctx.fillStyle = '#fb923c';
    ctx.fillRect(64, 112, 92, 42);
    ctx.fillRect(58, 92, 34, 30);
    ctx.fillRect(58, 82, 10, 12);
    ctx.fillRect(82, 82, 10, 12);
    ctx.fillStyle = '#fef3c7';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('zZz...', 104, 88);
  });

  const ch3 = makeCanvasTexture(256, 192, (ctx, w, h) => {
    // Soft glowing green oscilloscope wave
    ctx.fillStyle = '#041a18';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x < w; x += 4) {
      const y = h / 2 + Math.sin(x * 0.08) * 34 + Math.cos(x * 0.19) * 14;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#99f6e4';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('SIGNAL LOCK: 88.0 BPM', 24, 30);
  });

  return [ch0, ch1, ch2, ch3];
}

/** Distant skyscraper window grid texture (subtle nostalgic twilight lights). */
function createSkylineWindowTexture(): THREE.CanvasTexture {
  return makeCanvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#13172c';
    ctx.fillRect(0, 0, w, h);
    const rand = seededRandom(4049);
    const cols = ['#fde68a', '#7dd3fc', '#fbcfe8', '#5eead4', '#fb923c'];
    for (let y = 12; y < h - 12; y += 14) {
      for (let x = 10; x < w - 10; x += 14) {
        if (rand() < 0.34) {
          ctx.fillStyle = cols[Math.floor(rand() * cols.length)];
          ctx.globalAlpha = 0.45 + rand() * 0.5;
          ctx.fillRect(x, y, 7, 6);
        }
      }
    }
    ctx.globalAlpha = 1;
  });
}

export interface SceneryResult {
  solids: { boxes: SolidBox[]; cylinders: SolidCylinder[] };
  cassetteReels: THREE.Mesh[];
  lanternPivots: Array<{ pivot: THREE.Group; phase: number }>;
  norenCurtains: Array<{ mesh: THREE.Mesh; phase: number }>;
  steamPuffs: Array<{ mesh: THREE.Mesh; baseX: number; baseY: number; baseZ: number; phase: number }>;
  catGroup: THREE.Group;
  catTail: THREE.Mesh;
  catHalo: THREE.Mesh;
  mainCrtScreen: THREE.Mesh;
  crtTextures: THREE.CanvasTexture[];
  vendingDrinkHolos: THREE.Group[];
  phoneRingMesh: THREE.Mesh;
  monorailTrain: THREE.Group;
}

export async function buildStationScenery(
  root: THREE.Group,
  res: ResourceBag,
  groundMat: THREE.MeshBasicNodeMaterial,
): Promise<SceneryResult> {
  const rand = seededRandom(199808);
  const solids: { boxes: SolidBox[]; cylinders: SolidCylinder[] } = { boxes: [], cylinders: [] };

  // 1. Rain-slicked wet promenade & slightly raised side platforms
  const floorGeo = res.geo(new THREE.PlaneGeometry(118, 118, 96, 96));
  floorGeo.rotateX(-Math.PI / 2);
  const fPos = floorGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < fPos.count; i++) {
    fPos.setY(i, stationHeight(fPos.getX(i), fPos.getZ(i)));
  }
  floorGeo.computeVertexNormals();
  const floorMesh = new THREE.Mesh(floorGeo, groundMat);
  floorMesh.name = 'wet-promenade';
  root.add(floorMesh);

  // Subtle weathered wooden railway ties recessed down the center of the wet walk
  const tieGeo = res.geo(new THREE.BoxGeometry(5.6, 0.03, 0.32));
  const tieMat = res.mat(new THREE.MeshStandardMaterial({ color: '#33292b', roughness: 0.72, metalness: 0.08 }));
  const tieCount = 46;
  const ties = new THREE.InstancedMesh(tieGeo, tieMat, tieCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < tieCount; i++) {
    const z = -31.5 + i * 1.4;
    dummy.position.set(0, 0.015, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    ties.setMatrixAt(i, dummy.matrix);
  }
  ties.instanceMatrix.needsUpdate = true;
  root.add(ties);

  await breathe();

  // Shared materials
  const cedarMat = res.mat(new THREE.MeshStandardMaterial({ color: '#4c342b', roughness: 0.82 }));
  const darkMetalMat = res.mat(new THREE.MeshStandardMaterial({ color: '#242b3c', roughness: 0.45, metalness: 0.65 }));
  const slateMat = res.mat(new THREE.MeshStandardMaterial({ color: '#2b3347', roughness: 0.75 }));
  const glassCanopyMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#93c5fd',
    transparent: true,
    opacity: 0.24,
    roughness: 0.12,
    metalness: 0.1,
    side: THREE.DoubleSide,
  }));
  const warmBulbMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#fef3c7',
    emissive: '#fbbf24',
    emissiveIntensity: 2.0,
    roughness: 0.2,
  }));
  const cyanNeonMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#a5f3fc',
    emissive: '#22d3ee',
    emissiveIntensity: 2.0,
    roughness: 0.2,
  }));
  const pinkNeonMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#fbcfe8',
    emissive: '#f472b6',
    emissiveIntensity: 1.9,
    roughness: 0.2,
  }));

  // 2. Giant Floating Holographic Cassette Archway centerpiece spanning the central promenade
  const archGroup = new THREE.Group();
  archGroup.position.set(0, 0, CASSETTE_ARCH_Z);
  const pillarGeo = res.geo(new THREE.BoxGeometry(0.45, 5.8, 0.45));
  for (const sx of [-5.2, 5.2]) {
    const p = new THREE.Mesh(pillarGeo, darkMetalMat);
    p.position.set(sx, 2.9, 0);
    const strip = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.08, 5.2, 0.08)), sx < 0 ? cyanNeonMat : pinkNeonMat);
    strip.position.set(sx - Math.sign(sx) * 0.24, 2.9, 0);
    archGroup.add(p, strip);
    solids.cylinders.push({ x: sx, z: CASSETTE_ARCH_Z, radius: 0.45, maxY: 6.0 });
  }
  // Translucent Cassette Shell top beam
  const shellGeo = res.geo(new THREE.BoxGeometry(10.8, 2.2, 0.65));
  const shellMat = res.mat(createHoloRibbonMaterial('#22d3ee', '#f472b6'));
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.set(0, 6.2, 0);
  const shellFrame = new THREE.Mesh(res.geo(new THREE.BoxGeometry(10.9, 0.14, 0.72)), cyanNeonMat);
  shellFrame.position.set(0, 5.1, 0);
  const shellTop = new THREE.Mesh(res.geo(new THREE.BoxGeometry(10.9, 0.14, 0.72)), pinkNeonMat);
  shellTop.position.set(0, 7.3, 0);
  archGroup.add(shell, shellFrame, shellTop);

  // Two spinning holographic tape reels inside the giant cassette beam!
  const cassetteReels: THREE.Mesh[] = [];
  const reelGeo = res.geo(new THREE.TorusGeometry(0.62, 0.11, 8, 6));
  for (const rx of [-2.1, 2.1]) {
    const reel = new THREE.Mesh(reelGeo, rx < 0 ? cyanNeonMat : warmBulbMat);
    reel.position.set(rx, 6.2, 0);
    archGroup.add(reel);
    cassetteReels.push(reel);
  }
  root.add(archGroup);

  // 3. Utility Poles & Overhead Warm Glowing Paper Lantern Strings (`chōchin`)
  const lanternPivots: SceneryResult['lanternPivots'] = [];
  const poleGeo = res.geo(new THREE.CylinderGeometry(0.11, 0.15, 6.2, 8));
  const lanternGeo = res.geo(new THREE.SphereGeometry(0.24, 12, 10));
  const lanternAmberMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#ffedd5',
    emissive: '#fb923c',
    emissiveIntensity: 1.85,
    roughness: 0.35,
  }));
  const lanternCoralMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#ffe4e6',
    emissive: '#fb7185',
    emissiveIntensity: 1.65,
    roughness: 0.35,
  }));
  const lanternMintMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#ccfbf1',
    emissive: '#2dd4bf',
    emissiveIntensity: 1.55,
    roughness: 0.35,
  }));
  const lanternMats = [lanternAmberMat, lanternCoralMat, lanternAmberMat, lanternMintMat];

  const poleZs = [24, 12, -10, -24];
  for (let pzIdx = 0; pzIdx < poleZs.length; pzIdx++) {
    const pz = poleZs[pzIdx];
    for (const side of [-1, 1]) {
      const px = side * 6.4;
      const pole = new THREE.Mesh(poleGeo, darkMetalMat);
      pole.position.set(px, 3.1, pz);
      root.add(pole);
      solids.cylinders.push({ x: px, z: pz, radius: 0.25, maxY: 6.2 });
    }
    // Draped catenary lantern string across the promenade
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      const x = -6.4 + u * 12.8;
      const sag = Math.sin(u * Math.PI) * 0.78;
      pts.push(new THREE.Vector3(x, 5.75 - sag, pz));
    }
    const wireGeo = res.geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.018, 5, false));
    root.add(new THREE.Mesh(wireGeo, darkMetalMat));

    for (let k = 1; k < 8; k++) {
      const pt = pts[k];
      const pivot = new THREE.Group();
      pivot.position.copy(pt);
      const lMesh = new THREE.Mesh(lanternGeo, lanternMats[(k + pzIdx) % lanternMats.length]);
      lMesh.scale.set(0.85, 1.25, 0.85);
      lMesh.position.y = -0.34;
      const cap = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 8)), darkMetalMat);
      cap.position.y = -0.06;
      pivot.add(lMesh, cap);
      root.add(pivot);
      lanternPivots.push({ pivot, phase: k * 0.7 + pzIdx * 1.3 });
    }
  }

  await breathe();

  // 4. Cozy Rain-Sheltered Waiting Gazebo, Departure Board & Sleeping Calico Cat (`SHELTER_POS`)
  const shelterGroup = new THREE.Group();
  const sY = stationHeight(SHELTER_POS.x, SHELTER_POS.z);
  shelterGroup.position.set(SHELTER_POS.x, sY, SHELTER_POS.z);

  // Slanted wooden roof + translucent glass skylight eaves
  const roof = new THREE.Mesh(res.geo(new THREE.BoxGeometry(3.4, 0.16, 6.2)), cedarMat);
  roof.position.set(0, 3.35, 0);
  roof.rotation.z = -0.12;
  const eave = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.1, 0.05, 6.2)), glassCanopyMat);
  eave.position.set(2.05, 3.12, 0);
  eave.rotation.z = -0.12;
  shelterGroup.add(roof, eave);
  for (const [px, pz] of [[-1.35, -2.7], [-1.35, 2.7], [1.1, -2.7], [1.1, 2.7]] as const) {
    const post = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.18, 3.35, 0.18)), cedarMat);
    post.position.set(px, 1.65, pz);
    shelterGroup.add(post);
  }
  // Back frosted-glass & wood slat windbreak
  const backPanel = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.12, 2.7, 5.4)), glassCanopyMat);
  backPanel.position.set(-1.35, 1.5, 0);
  shelterGroup.add(backPanel);

  // Warm Edison bulbs under shelter ceiling
  for (const bz of [-1.8, 0, 1.8]) {
    const bulb = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.1, 8, 8)), warmBulbMat);
    bulb.position.set(0.1, 3.08, bz);
    shelterGroup.add(bulb);
  }

  // Glowing Retro CRT Departure Board mounted inside the shelter
  const boardTex = res.tex(createDepartureBoardTexture());
  const boardFrame = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.16, 1.25, 2.35)), darkMetalMat);
  boardFrame.position.set(-1.12, 2.15, -0.3);
  const boardScreen = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(2.18, 1.08)),
    res.mat(new THREE.MeshBasicMaterial({ map: boardTex })),
  );
  boardScreen.position.set(-1.02, 2.15, -0.3);
  boardScreen.rotation.y = Math.PI / 2;
  shelterGroup.add(boardFrame, boardScreen);

  // Wooden slatted waiting bench + umbrella stand with colorful folded umbrellas
  const benchSeat = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.75, 0.1, 3.2)), cedarMat);
  benchSeat.position.set(0.35, 0.56, 0.2);
  const benchBack = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.1, 0.52, 3.2)), cedarMat);
  benchBack.position.set(-0.02, 0.88, 0.2);
  for (const lz of [-1.3, 1.3]) {
    const leg = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.68, 0.56, 0.14)), darkMetalMat);
    leg.position.set(0.35, 0.28, 0.2 + lz);
    shelterGroup.add(leg);
  }
  shelterGroup.add(benchSeat, benchBack);

  const standTub = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.24, 0.22, 0.62, 12, 1, true)), darkMetalMat);
  standTub.position.set(0.45, 0.31, 2.25);
  shelterGroup.add(standTub);
  const umbCols = ['#fb7185', '#38bdf8', '#fde047'];
  umbCols.forEach((col, i) => {
    const umb = new THREE.Mesh(
      res.geo(new THREE.ConeGeometry(0.08, 0.78, 8)),
      res.mat(new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 })),
    );
    umb.position.set(0.42 + (i - 1) * 0.08, 0.55, 2.22 + (i % 2) * 0.06);
    umb.rotation.z = (i - 1) * 0.12;
    shelterGroup.add(umb);
  });
  root.add(shelterGroup);
  solids.boxes.push({
    minX: SHELTER_POS.x - 1.6,
    maxX: SHELTER_POS.x + 1.0,
    minZ: SHELTER_POS.z - 2.9,
    maxZ: SHELTER_POS.z + 2.9,
    maxY: 3.4,
  });

  // Sleeping Calico Cat curled peacefully on the warm waiting bench!
  const catGroup = new THREE.Group();
  catGroup.position.set(CAT_BENCH_POS.x - 0.52, sY + 0.66, CAT_BENCH_POS.z + 0.35);
  const catCreamMat = res.mat(new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.85 }));
  const catOrangeMat = res.mat(new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.85 }));
  const catDarkMat = res.mat(new THREE.MeshStandardMaterial({ color: '#27272a', roughness: 0.85 }));
  const catBody = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.22, 12, 10)), catCreamMat);
  catBody.scale.set(1.25, 0.68, 1.05);
  const catSpot = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.14, 10, 8)), catOrangeMat);
  catSpot.position.set(-0.08, 0.06, 0.06);
  const catHead = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.13, 10, 8)), catCreamMat);
  catHead.position.set(0.2, 0.1, 0.06);
  for (const ez of [-0.06, 0.06]) {
    const ear = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.045, 0.1, 4)), ez < 0 ? catOrangeMat : catDarkMat);
    ear.position.set(0.2, 0.22, 0.06 + ez);
    catGroup.add(ear);
  }
  const catTail = new THREE.Mesh(res.geo(new THREE.CapsuleGeometry(0.032, 0.28, 5, 8)), catOrangeMat);
  catTail.position.set(-0.24, 0.02, 0.16);
  catTail.rotation.set(0.3, 0.4, Math.PI / 2.2);
  const catHalo = new THREE.Mesh(
    res.geo(new THREE.RingGeometry(0.26, 0.34, 18).rotateX(-Math.PI / 2)),
    res.mat(new THREE.MeshBasicMaterial({
      color: '#fde047',
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })),
  );
  catHalo.position.y = -0.02;
  catGroup.add(catBody, catSpot, catHead, catTail, catHalo);
  root.add(catGroup);

  // 5. Row of 3 Nostalgic Glowing Vintage Vending Machines (`VENDING_ROW_POS`)
  const vendingDrinkHolos: THREE.Group[] = [];
  const vThemes: Array<{ theme: 'matcha' | 'peach' | 'ramune'; shell: string; glow: string; dz: number }> = [
    { theme: 'matcha', shell: '#e2efe6', glow: '#4ade80', dz: -1.65 },
    { theme: 'peach', shell: '#fde8ec', glow: '#fb7185', dz: 0 },
    { theme: 'ramune', shell: '#e0f2fe', glow: '#38bdf8', dz: 1.65 },
  ];
  const vY = stationHeight(VENDING_ROW_POS.x, VENDING_ROW_POS.z);
  const vAwning = new THREE.Mesh(res.geo(new THREE.BoxGeometry(2.4, 0.1, 5.4)), glassCanopyMat);
  vAwning.position.set(VENDING_ROW_POS.x - 0.3, vY + 2.75, VENDING_ROW_POS.z);
  vAwning.rotation.z = 0.1;
  root.add(vAwning);

  for (const v of vThemes) {
    const vg = new THREE.Group();
    vg.position.set(VENDING_ROW_POS.x, vY, VENDING_ROW_POS.z + v.dz);
    const body = new THREE.Mesh(
      res.geo(new THREE.BoxGeometry(1.1, 2.35, 1.38)),
      res.mat(new THREE.MeshStandardMaterial({ color: v.shell, roughness: 0.42 })),
    );
    body.position.y = 1.18;
    const dispTex = res.tex(createVendingDisplayTexture(v.theme));
    const display = new THREE.Mesh(
      res.geo(new THREE.PlaneGeometry(1.16, 1.52)),
      res.mat(new THREE.MeshBasicMaterial({ map: dispTex })),
    );
    display.position.set(-0.56, 1.44, 0);
    display.rotation.y = -Math.PI / 2;
    const tray = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.12, 0.34, 0.94)), darkMetalMat);
    tray.position.set(-0.54, 0.34, 0);
    vg.add(body, display, tray);

    // Floating holographic dispensed drink cup/can (pops up when player approaches!)
    const holoCup = new THREE.Group();
    const cupMat = res.mat(new THREE.MeshBasicMaterial({
      color: v.glow,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    }));
    const can = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 12)), cupMat);
    const ring = new THREE.Mesh(res.geo(new THREE.RingGeometry(0.15, 0.21, 18).rotateX(-Math.PI / 2)), cupMat);
    ring.position.y = -0.16;
    holoCup.add(can, ring);
    holoCup.position.set(-0.95, 1.05, 0);
    holoCup.visible = false;
    vg.add(holoCup);
    vendingDrinkHolos.push(holoCup);

    root.add(vg);
  }
  solids.boxes.push({
    minX: VENDING_ROW_POS.x - 0.7,
    maxX: VENDING_ROW_POS.x + 0.7,
    minZ: VENDING_ROW_POS.z - 2.5,
    maxZ: VENDING_ROW_POS.z + 2.5,
    maxY: 2.5,
  });

  await breathe();

  // 6. Warm Steaming Ramen & Matcha Tea Kiosk (`RAMEN_KIOSK_POS`)
  const kioskY = stationHeight(RAMEN_KIOSK_POS.x, RAMEN_KIOSK_POS.z);
  const kioskGroup = new THREE.Group();
  kioskGroup.position.set(RAMEN_KIOSK_POS.x, kioskY, RAMEN_KIOSK_POS.z);

  const kBack = new THREE.Mesh(res.geo(new THREE.BoxGeometry(2.6, 3.1, 5.2)), cedarMat);
  kBack.position.set(-0.5, 1.55, 0);
  const kCounter = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.85, 1.02, 5.0)), res.mat(new THREE.MeshStandardMaterial({ color: '#8f6241', roughness: 0.65 })));
  kCounter.position.set(1.15, 0.52, 0);
  const kRoof = new THREE.Mesh(res.geo(new THREE.BoxGeometry(3.8, 0.22, 5.8)), darkMetalMat);
  kRoof.position.set(0.3, 3.22, 0);
  kRoof.rotation.z = -0.14;
  kioskGroup.add(kBack, kCounter, kRoof);

  // Glowing neon kiosk sign (`24H TEA & RAMEN`)
  const kioskSignTex = res.tex(createNeonSignTexture('24H TEA', 'MATCHA • NOODLES', '#fbbf24', '#5eead4'));
  const kioskSign = new THREE.Mesh(
    res.geo(new THREE.PlaneGeometry(2.6, 1.05)),
    res.mat(new THREE.MeshBasicMaterial({ map: kioskSignTex })),
  );
  kioskSign.position.set(1.65, 3.55, 0);
  kioskSign.rotation.y = Math.PI / 2;
  kioskGroup.add(kioskSign);

  // Swaying fabric noren curtains hanging under the eave
  const norenCurtains: SceneryResult['norenCurtains'] = [];
  const norenMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1e3a5f', roughness: 0.88, side: THREE.DoubleSide }));
  const norenAccentMat = res.mat(new THREE.MeshStandardMaterial({ color: '#b91c48', roughness: 0.88, side: THREE.DoubleSide }));
  for (let i = 0; i < 4; i++) {
    const cur = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(0.95, 0.82)), i % 2 === 0 ? norenMat : norenAccentMat);
    cur.position.set(1.55, 2.55, -1.65 + i * 1.1);
    cur.rotation.y = Math.PI / 2;
    kioskGroup.add(cur);
    norenCurtains.push({ mesh: cur, phase: i * 0.9 });
  }

  // Wooden stools & steaming ceramic bowls on the counter
  const steamPuffs: SceneryResult['steamPuffs'] = [];
  const steamGeo = res.geo(new THREE.SphereGeometry(0.06, 7, 6));
  const steamMat = res.mat(new THREE.MeshBasicMaterial({ color: '#fff7ed', transparent: true, opacity: 0.34, depthWrite: false }));
  const bowlGeo = res.geo(new THREE.CylinderGeometry(0.16, 0.09, 0.14, 12));
  const bowlMat = res.mat(new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.25 }));

  for (const sz of [-1.4, 0, 1.4]) {
    const stoolTop = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12)), cedarMat);
    stoolTop.position.set(2.05, 0.65, sz);
    const stoolLeg = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.05, 0.07, 0.64, 8)), darkMetalMat);
    stoolLeg.position.set(2.05, 0.32, sz);
    kioskGroup.add(stoolTop, stoolLeg);

    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.set(1.18, 1.1, sz);
    kioskGroup.add(bowl);

    for (let s = 0; s < 3; s++) {
      const puff = new THREE.Mesh(steamGeo, steamMat);
      kioskGroup.add(puff);
      steamPuffs.push({ mesh: puff, baseX: 1.18, baseY: 1.24, baseZ: sz, phase: s * 2.1 + sz });
    }
  }
  root.add(kioskGroup);
  solids.boxes.push({
    minX: RAMEN_KIOSK_POS.x - 1.9,
    maxX: RAMEN_KIOSK_POS.x + 1.7,
    minZ: RAMEN_KIOSK_POS.z - 2.7,
    maxZ: RAMEN_KIOSK_POS.z + 2.7,
    maxY: 3.4,
  });

  // 7. Stacked Retro 1990s CRT Television Shrine (`CRT_NOOK_POS`)
  const crtY = stationHeight(CRT_NOOK_POS.x, CRT_NOOK_POS.z);
  const crtGroup = new THREE.Group();
  crtGroup.position.set(CRT_NOOK_POS.x, crtY, CRT_NOOK_POS.z);
  const crtTextures = createCrtChannelTextures();
  crtTextures.forEach(t => res.tex(t));

  const crtPlasticMat = res.mat(new THREE.MeshStandardMaterial({ color: '#33394a', roughness: 0.62 }));
  const beigePlasticMat = res.mat(new THREE.MeshStandardMaterial({ color: '#b5afa2', roughness: 0.68 }));
  const crateMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.72 }));

  // Milk crate pedestals
  for (const cz of [-1.1, 0, 1.1]) {
    const crate = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.95, 0.45, 0.95)), crateMat);
    crate.position.set(0, 0.22, cz);
    crtGroup.add(crate);
  }

  let mainCrtScreen!: THREE.Mesh;
  const crtSpecs = [
    { x: 0, y: 0.9, z: 0, w: 1.05, h: 0.84, d: 0.92, rotY: -0.05, ch: 0, isMain: true, beige: false },
    { x: 0.08, y: 0.84, z: -1.12, w: 0.82, h: 0.72, d: 0.78, rotY: 0.14, ch: 1, isMain: false, beige: true },
    { x: 0.06, y: 0.84, z: 1.12, w: 0.86, h: 0.72, d: 0.78, rotY: -0.18, ch: 2, isMain: false, beige: false },
    { x: 0.04, y: 1.66, z: -0.45, w: 0.78, h: 0.66, d: 0.72, rotY: 0.08, ch: 3, isMain: false, beige: true },
    { x: 0.05, y: 1.62, z: 0.56, w: 0.72, h: 0.6, d: 0.68, rotY: -0.1, ch: 1, isMain: false, beige: false },
  ];
  for (const c of crtSpecs) {
    const tv = new THREE.Group();
    tv.position.set(c.x, c.y, c.z);
    tv.rotation.y = c.rotY;
    const caseMesh = new THREE.Mesh(res.geo(new THREE.BoxGeometry(c.d, c.h, c.w)), c.beige ? beigePlasticMat : crtPlasticMat);
    const scrMat = res.mat(new THREE.MeshBasicMaterial({ map: crtTextures[c.ch] }));
    const scr = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(c.w * 0.82, c.h * 0.76)), scrMat);
    scr.position.set(-c.d * 0.505, 0.02, 0);
    scr.rotation.y = -Math.PI / 2;
    tv.add(caseMesh, scr);
    if (c.isMain) mainCrtScreen = scr;
    crtGroup.add(tv);
  }
  // Translucent rain canopy over the CRT shrine
  const crtCanopy = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.8, 0.08, 3.6)), glassCanopyMat);
  crtCanopy.position.set(-0.1, 2.52, 0);
  crtCanopy.rotation.z = 0.08;
  crtGroup.add(crtCanopy);
  root.add(crtGroup);
  solids.boxes.push({
    minX: CRT_NOOK_POS.x - 0.75,
    maxX: CRT_NOOK_POS.x + 0.75,
    minZ: CRT_NOOK_POS.z - 1.75,
    maxZ: CRT_NOOK_POS.z + 1.75,
    maxY: 2.4,
  });

  // 8. Glowing Nostalgic Red Payphone Booth in the Rain (`PHONE_BOOTH_POS`)
  const pbY = stationHeight(PHONE_BOOTH_POS.x, PHONE_BOOTH_POS.z);
  const pbGroup = new THREE.Group();
  pbGroup.position.set(PHONE_BOOTH_POS.x, pbY, PHONE_BOOTH_POS.z);
  const redBoothMat = res.mat(new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.36 }));
  const pbBase = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.35, 0.14, 1.35)), redBoothMat);
  pbBase.position.y = 0.07;
  const pbRoof = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.42, 0.24, 1.42)), redBoothMat);
  pbRoof.position.y = 2.65;
  for (const [cx, cz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) {
    const p = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.11, 2.55, 0.11)), redBoothMat);
    p.position.set(cx, 1.35, cz);
    pbGroup.add(p);
  }
  const pbGlass = new THREE.Mesh(res.geo(new THREE.BoxGeometry(1.18, 2.35, 1.18)), glassCanopyMat);
  pbGlass.position.y = 1.35;
  const pbLight = new THREE.Mesh(res.geo(new THREE.SphereGeometry(0.14, 10, 8)), warmBulbMat);
  pbLight.position.y = 2.38;
  const pbUnit = new THREE.Mesh(res.geo(new THREE.BoxGeometry(0.24, 0.56, 0.34)), darkMetalMat);
  pbUnit.position.set(-0.35, 1.45, 0);
  const phoneRingMesh = new THREE.Mesh(
    res.geo(new THREE.RingGeometry(0.95, 1.12, 24).rotateX(-Math.PI / 2)),
    res.mat(new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })),
  );
  phoneRingMesh.position.y = 0.06;
  pbGroup.add(pbBase, pbRoof, pbGlass, pbLight, pbUnit, phoneRingMesh);
  root.add(pbGroup);
  solids.boxes.push({
    minX: PHONE_BOOTH_POS.x - 0.75,
    maxX: PHONE_BOOTH_POS.x + 0.75,
    minZ: PHONE_BOOTH_POS.z - 0.75,
    maxZ: PHONE_BOOTH_POS.z + 0.75,
    maxY: 2.7,
  });

  // 9. Glowing Moss & Cyber-Bonsai Planters flanking the promenade
  const planterBoxGeo = res.geo(new THREE.BoxGeometry(1.5, 0.55, 2.2));
  const mossMoundGeo = res.geo(new THREE.SphereGeometry(0.65, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55));
  const glowMossMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#22c55e',
    emissive: '#10b981',
    emissiveIntensity: 0.42,
    roughness: 0.82,
  }));
  const pineCanopyMat = res.mat(new THREE.MeshStandardMaterial({
    color: '#1e6b52',
    emissive: '#0d4a3a',
    emissiveIntensity: 0.24,
    roughness: 0.8,
  }));
  const planterCoords: Array<[number, number]> = [
    [-6.6, 22.0],
    [6.6, 22.0],
    [6.6, 6.2],
    [-6.6, -19.5],
    [6.6, -13.5],
    [6.6, -22.5],
  ];
  for (const [px, pz] of planterCoords) {
    const py = stationHeight(px, pz);
    const pg = new THREE.Group();
    pg.position.set(px, py, pz);
    const box = new THREE.Mesh(planterBoxGeo, slateMat);
    box.position.y = 0.28;
    const moss = new THREE.Mesh(mossMoundGeo, glowMossMat);
    moss.scale.set(0.95, 0.45, 1.35);
    moss.position.y = 0.52;
    const trunk = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.08, 0.14, 1.4, 7)), cedarMat);
    trunk.position.set(0, 1.1, 0);
    trunk.rotation.z = (px < 0 ? -0.22 : 0.22);
    const pad1 = new THREE.Mesh(res.geo(new THREE.DodecahedronGeometry(0.62, 1)), pineCanopyMat);
    pad1.scale.set(1.3, 0.52, 1.15);
    pad1.position.set(px < 0 ? 0.25 : -0.25, 1.75, 0.2);
    const pad2 = new THREE.Mesh(res.geo(new THREE.DodecahedronGeometry(0.46, 1)), pineCanopyMat);
    pad2.scale.set(1.2, 0.48, 1.1);
    pad2.position.set(px < 0 ? -0.15 : 0.15, 2.1, -0.3);
    pg.add(box, moss, trunk, pad1, pad2);
    root.add(pg);
    solids.boxes.push({ minX: px - 0.8, maxX: px + 0.8, minZ: pz - 1.15, maxZ: pz + 1.15, maxY: 1.2 });
  }

  await breathe();

  // 10. Distant Misty Twilight Cyber-Skyline & Elevated Glass Viaduct with Gliding Commuter Train!
  const skylineTex = res.tex(createSkylineWindowTexture());
  const towerMat = res.mat(new THREE.MeshBasicMaterial({ map: skylineTex }));
  const holoSignMats = [
    res.mat(new THREE.MeshBasicMaterial({ map: res.tex(createNeonSignTexture('LO-FI', 'BLUE HOUR 88', '#38bdf8', '#f472b6')) })),
    res.mat(new THREE.MeshBasicMaterial({ map: res.tex(createNeonSignTexture('DREAM', 'MIDNIGHT LINE', '#f472b6', '#fde047')) })),
    res.mat(new THREE.MeshBasicMaterial({ map: res.tex(createNeonSignTexture('RAIN', 'STATION 09', '#5eead4', '#fbbf24')) })),
  ];

  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    // Leave portal sightlines at +/-Z open & serene while framing east/west/diagonal skyline
    if (Math.abs(Math.cos(ang)) < 0.34) continue;
    const dist = 42 + rand() * 24;
    const tx = Math.cos(ang) * dist;
    const tz = Math.sin(ang) * dist;
    const tw = 5 + rand() * 6;
    const th = 16 + rand() * 26;
    const tower = new THREE.Mesh(res.geo(new THREE.BoxGeometry(tw, th, tw)), towerMat);
    tower.position.set(tx, th * 0.5 - 2, tz);
    root.add(tower);

    // Occasional nostalgic neon rooftop billboard facing inward
    if (i % 3 === 0) {
      const bill = new THREE.Mesh(res.geo(new THREE.PlaneGeometry(6.5, 2.7)), holoSignMats[i % holoSignMats.length]);
      bill.position.set(tx, th - 1.5, tz);
      bill.lookAt(0, th - 2, 0);
      root.add(bill);
    }
  }

  // Elevated Glass Monorail Viaduct crossing the misty skyline at Z = -52, Y = 11.5
  const viaduct = new THREE.Mesh(res.geo(new THREE.BoxGeometry(110, 0.7, 2.2)), darkMetalMat);
  viaduct.position.set(0, 11.2, -52);
  const viaductRail = new THREE.Mesh(res.geo(new THREE.BoxGeometry(110, 0.14, 0.14)), cyanNeonMat);
  viaductRail.position.set(0, 11.65, -50.9);
  root.add(viaduct, viaductRail);

  // Sleek Glowing Twilight Commuter Train (glides silently across the viaduct!)
  const monorailTrain = new THREE.Group();
  monorailTrain.position.set(-60, 12.4, -52);
  const carBodyMat = res.mat(new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.35, metalness: 0.6 }));
  for (let c = 0; c < 4; c++) {
    const cx = c * 6.8;
    const car = new THREE.Mesh(res.geo(new THREE.BoxGeometry(6.2, 1.85, 1.9)), carBodyMat);
    car.position.x = cx;
    const winStrip = new THREE.Mesh(res.geo(new THREE.BoxGeometry(5.5, 0.72, 1.96)), warmBulbMat);
    winStrip.position.set(cx, 0.22, 0);
    const accentStripe = new THREE.Mesh(res.geo(new THREE.BoxGeometry(6.22, 0.12, 1.94)), cyanNeonMat);
    accentStripe.position.set(cx, -0.45, 0);
    monorailTrain.add(car, winStrip, accentStripe);
  }
  root.add(monorailTrain);

  return {
    solids,
    cassetteReels,
    lanternPivots,
    norenCurtains,
    steamPuffs,
    catGroup,
    catTail,
    catHalo,
    mainCrtScreen,
    crtTextures,
    vendingDrinkHolos,
    phoneRingMesh,
    monorailTrain,
  };
}
