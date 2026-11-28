import * as THREE from 'three/webgpu';
import type { WorldManifest } from '../types';

export type FlurryStyle = 'snow' | 'bubbles' | 'spores' | 'sparks' | 'stardust' | 'ash';

export interface SnowglobeFlurryConfig {
  colorA: string;
  colorB: string;
  style: FlurryStyle;
  /** Default vertical drift velocity (+ rises like bubbles/spores, - falls like snow). */
  fallSpeed: number;
}

export interface SnowglobeDiorama {
  group: THREE.Group;
  flurry: SnowglobeFlurryConfig;
  update: (dt: number, elapsed: number) => void;
  dispose: () => void;
}

/** Interior diorama radius inside a standard SNOWGLOBE_RADIUS (2.65) glass dome. */
export const DIORAMA_GROUND_Y = -0.52;
export const DIORAMA_CAP_RADIUS = 2.24;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class DioramaBuilder {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly updaters: Array<(dt: number, elapsed: number) => void> = [];

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  onUpdate(fn: (dt: number, elapsed: number) => void): void {
    this.updaters.push(fn);
  }

  /** Standard curved bowl cap + flat stage floor nestled cleanly inside the lower glass hemisphere. */
  addStageDisc(topColor: string, rimColor: string, emissiveHex?: string, emissiveIntensity = 0.25): THREE.Mesh {
    const disc = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(DIORAMA_CAP_RADIUS, DIORAMA_CAP_RADIUS * 0.86, 0.34, 36)),
      this.mat(
        new THREE.MeshStandardMaterial({
          color: topColor,
          emissive: emissiveHex ?? topColor,
          emissiveIntensity,
          roughness: 0.62,
          metalness: 0.14,
        }),
      ),
    );
    disc.position.y = DIORAMA_GROUND_Y - 0.17;
    this.group.add(disc);

    const trim = new THREE.Mesh(
      this.geo(new THREE.TorusGeometry(DIORAMA_CAP_RADIUS - 0.04, 0.045, 8, 40)),
      this.mat(
        new THREE.MeshStandardMaterial({
          color: rimColor,
          emissive: rimColor,
          emissiveIntensity: 0.45,
          roughness: 0.35,
          metalness: 0.5,
        }),
      ),
    );
    trim.rotation.x = Math.PI / 2;
    trim.position.y = DIORAMA_GROUND_Y + 0.01;
    this.group.add(trim);
    return disc;
  }

  finish(flurry: SnowglobeFlurryConfig): SnowglobeDiorama {
    return {
      group: this.group,
      flurry,
      update: (dt, elapsed) => {
        for (const fn of this.updaters) fn(dt, elapsed);
      },
      dispose: () => {
        for (const g of this.geometries) g.dispose();
        for (const m of this.materials) m.dispose();
      },
    };
  }
}

/**
 * Crafts a bespoke, animated miniature 3D diorama world inside each snowglobe
 * matching the iconic landmarks, palette, and particle atmosphere of each room
 * in `registry.json` (plus an automatic accent-matched diorama for any future
 * community-submitted world).
 */
export function buildSnowglobeDiorama(manifest: WorldManifest): SnowglobeDiorama {
  const b = new DioramaBuilder();
  const id = manifest.id;
  const gY = DIORAMA_GROUND_Y;

  if (id === 'eric-starlight-pavilion') {
    b.addStageDisc('#14102b', '#fbbf24', '#3b1d5e', 0.55);

    // Radiant Art-Deco golden starburst dance floor & festival gazebo
    const goldMat = b.mat(
      new THREE.MeshStandardMaterial({
        color: '#fbbf24',
        emissive: '#d97706',
        emissiveIntensity: 0.72,
        metalness: 0.8,
        roughness: 0.22,
      }),
    );
    const floorStar = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(1.32, 1.38, 0.1, 8)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#312e81', emissive: '#6366f1', emissiveIntensity: 0.55 })),
    );
    floorStar.position.y = gY + 0.06;
    b.group.add(floorStar);

    // Art-Deco pavilion pillars & open celestial halo crown
    const colGeo = b.geo(new THREE.CylinderGeometry(0.055, 0.07, 1.48, 8));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const col = new THREE.Mesh(colGeo, goldMat);
      col.position.set(Math.cos(a) * 1.18, gY + 0.78, Math.sin(a) * 1.18);
      b.group.add(col);
    }
    const crownRing = new THREE.Mesh(b.geo(new THREE.TorusGeometry(1.18, 0.065, 10, 32)), goldMat);
    crownRing.rotation.x = Math.PI / 2;
    crownRing.position.y = gY + 1.52;
    const crownSpire = new THREE.Mesh(
      b.geo(new THREE.OctahedronGeometry(0.28, 0)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#fef08a' })),
    );
    crownSpire.position.y = gY + 1.82;
    b.group.add(crownRing, crownSpire);

    // Three starlight dancers (Soraya, Dex, Ermelin) bobbing in 88 BPM harmony on stage
    const dancerGroup = new THREE.Group();
    const dancerColors = ['#f2b866', '#ff2a85', '#818cf8'];
    const bodyGeo = b.geo(new THREE.CapsuleGeometry(0.11, 0.28, 5, 10));
    const dancers: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const d = new THREE.Mesh(
        bodyGeo,
        b.mat(
          new THREE.MeshStandardMaterial({
            color: dancerColors[i],
            emissive: dancerColors[i],
            emissiveIntensity: 0.85,
          }),
        ),
      );
      d.position.set(Math.cos(a) * 0.48, gY + 0.36, Math.sin(a) * 0.48);
      dancerGroup.add(d);
      dancers.push(d);
    }
    b.group.add(dancerGroup);

    b.onUpdate((_dt, elapsed) => {
      const beat = (elapsed * 88 * Math.PI * 2) / 60;
      dancerGroup.rotation.y = elapsed * 0.65;
      crownSpire.rotation.y = elapsed * 1.1;
      for (let i = 0; i < dancers.length; i++) {
        dancers[i].position.y = gY + 0.36 + Math.abs(Math.sin(beat * 0.5 + i * 1.05)) * 0.18;
      }
    });

    return b.finish({ colorA: '#fde68a', colorB: '#c084fc', style: 'stardust', fallSpeed: 0.24 });
  }

  if (id === 'jp-world') {
    b.addStageDisc('#4d8b3f', '#eab308', '#2c5e22', 0.35);

    // Rolling emerald meadow hillock
    const hill = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(1.75, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#65a34e', emissive: '#2d5a20', emissiveIntensity: 0.3, roughness: 0.8 })),
    );
    hill.scale.set(1.0, 0.32, 1.0);
    hill.position.set(0, gY - 0.1, 0);
    b.group.add(hill);

    // Brass solarpunk arches
    const brassMat = b.mat(
      new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#ca8a04', emissiveIntensity: 0.55, metalness: 0.75, roughness: 0.25 }),
    );
    const archGeo = b.geo(new THREE.TorusGeometry(0.82, 0.06, 10, 28, Math.PI));
    for (const z of [-0.55, 0.55]) {
      const arch = new THREE.Mesh(archGeo, brassMat);
      arch.position.set(0, gY + 0.28, z);
      b.group.add(arch);
    }

    // Mini glowing golden sun high inside the dome
    const miniSun = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.28, 16, 16)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#fef08a' })),
    );
    miniSun.position.set(0.65, gY + 1.75, -0.55);
    b.group.add(miniSun);

    // Scattered swaying wildflowers
    const rand = mulberry32(101);
    const flowerColors = ['#fde047', '#f472b6', '#c084fc', '#fb923c', '#ffffff'];
    const flowerGeo = b.geo(new THREE.DodecahedronGeometry(0.11, 0));
    const flowerGroup = new THREE.Group();
    for (let i = 0; i < 24; i++) {
      const a = rand() * Math.PI * 2;
      const r = 0.35 + rand() * 1.45;
      const fMat = b.mat(
        new THREE.MeshStandardMaterial({
          color: flowerColors[i % flowerColors.length],
          emissive: flowerColors[i % flowerColors.length],
          emissiveIntensity: 0.45,
          roughness: 0.5,
        }),
      );
      const fl = new THREE.Mesh(flowerGeo, fMat);
      fl.position.set(Math.cos(a) * r, gY + 0.38 + (1 - r / 1.9) * 0.22, Math.sin(a) * r);
      flowerGroup.add(fl);
    }
    b.group.add(flowerGroup);

    b.onUpdate((_dt, elapsed) => {
      flowerGroup.rotation.z = Math.sin(elapsed * 1.8) * 0.04;
      miniSun.scale.setScalar(1 + Math.sin(elapsed * 2.2) * 0.06);
    });

    return b.finish({ colorA: '#fef08a', colorB: '#bef264', style: 'spores', fallSpeed: 0.14 });
  }

  if (id === 'jp-garden') {
    b.addStageDisc('#d48470', '#f08a9b', '#7a3e38', 0.3);

    // Oversized sculptural pastel tropical fronds swaying in the breeze
    const palette = ['#f08a9b', '#6ee7b7', '#2dd4bf', '#fda4af', '#34d399', '#f9a8d4'];
    const leafGeo = b.geo(new THREE.ConeGeometry(0.42, 1.55, 5));
    leafGeo.scale(1.0, 1.0, 0.22);
    const fronds: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const dist = 0.55 + (i % 2) * 0.5;
      const col = palette[i % palette.length];
      const frond = new THREE.Mesh(
        leafGeo,
        b.mat(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.38, roughness: 0.45 })),
      );
      frond.position.set(Math.cos(angle) * dist, gY + 0.72 + (i % 3) * 0.18, Math.sin(angle) * dist);
      frond.rotation.y = -angle + Math.PI / 2;
      frond.rotation.z = 0.32 + (i % 2) * 0.18;
      b.group.add(frond);
      fronds.push(frond);
    }

    b.onUpdate((_dt, elapsed) => {
      for (let i = 0; i < fronds.length; i++) {
        fronds[i].rotation.x = Math.sin(elapsed * 1.5 + i * 0.7) * 0.12;
      }
    });

    return b.finish({ colorA: '#fbcfe8', colorB: '#6ee7b7', style: 'spores', fallSpeed: -0.18 });
  }

  if (id === 'fishpond') {
    b.addStageDisc('#0d9488', '#14b8a6', '#0f766e', 0.55);

    // Curved volcanic basalt kuapā seawall arc
    const basaltMat = b.mat(new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.9 }));
    const wall = new THREE.Mesh(b.geo(new THREE.TorusGeometry(1.48, 0.16, 8, 28, Math.PI * 1.15)), basaltMat);
    wall.rotation.x = Math.PI / 2;
    wall.rotation.z = 0.3;
    wall.position.y = gY + 0.1;
    b.group.add(wall);

    // Green fluted Koʻolau volcanic peaks in back
    const cliffMat = b.mat(
      new THREE.MeshStandardMaterial({ color: '#15803d', emissive: '#14532d', emissiveIntensity: 0.35, roughness: 0.75 }),
    );
    const peakGeo = b.geo(new THREE.ConeGeometry(0.65, 1.55, 6));
    for (const [px, pz, sy] of [
      [-0.75, -0.85, 0.92],
      [0.0, -1.05, 1.18],
      [0.8, -0.82, 0.85],
    ]) {
      const peak = new THREE.Mesh(peakGeo, cliffMat);
      peak.position.set(px, gY + 0.72 * sy, pz);
      peak.scale.set(1, sy, 0.85);
      b.group.add(peak);
    }

    // Two leaning coastal coconut palms
    const trunkMat = b.mat(new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.85 }));
    const palmMat = b.mat(new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#166534', emissiveIntensity: 0.3 }));
    const trunkGeo = b.geo(new THREE.CylinderGeometry(0.05, 0.08, 1.05, 7));
    const crownGeo = b.geo(new THREE.DodecahedronGeometry(0.32, 0));
    for (const [px, pz, lean] of [
      [-1.08, 0.52, -0.26],
      [1.02, 0.45, 0.24],
    ]) {
      const palm = new THREE.Group();
      palm.position.set(px, gY + 0.12, pz);
      palm.rotation.z = lean;
      const tr = new THREE.Mesh(trunkGeo, trunkMat);
      tr.position.y = 0.5;
      const cr = new THREE.Mesh(crownGeo, palmMat);
      cr.scale.set(1.2, 0.5, 1.2);
      cr.position.y = 1.02;
      palm.add(tr, cr);
      b.group.add(palm);
    }

    // Tiny circling reef fish
    const fishPivot = new THREE.Group();
    fishPivot.position.y = gY + 0.14;
    const fishMat = b.mat(new THREE.MeshBasicMaterial({ color: '#fb923c' }));
    const fishGeo = b.geo(new THREE.ConeGeometry(0.08, 0.24, 5));
    fishGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(fishGeo, fishMat);
      const a = (i / 4) * Math.PI * 2;
      f.position.set(Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72);
      f.rotation.y = -a;
      fishPivot.add(f);
    }
    b.group.add(fishPivot);

    b.onUpdate((_dt, elapsed) => {
      fishPivot.rotation.y = elapsed * 0.85;
    });

    return b.finish({ colorA: '#5eead4', colorB: '#fef9c3', style: 'bubbles', fallSpeed: 0.22 });
  }

  if (id === 'jp-reef') {
    b.addStageDisc('#c2a173', '#22b8cf', '#0e4a5c', 0.4);

    // Vibrant coral towers
    const coralSpecs: Array<[number, number, number, string]> = [
      [-1.0, -0.4, 0.85, '#fb7185'],
      [-0.45, -0.95, 1.05, '#f97316'],
      [0.75, -0.75, 0.95, '#c084fc'],
      [1.1, 0.35, 0.72, '#f43f5e'],
      [-0.85, 0.75, 0.68, '#fbbf24'],
    ];
    const coralGeo = b.geo(new THREE.ConeGeometry(0.26, 1.0, 6));
    for (const [cx, cz, h, hex] of coralSpecs) {
      const c = new THREE.Mesh(
        coralGeo,
        b.mat(new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.45, roughness: 0.6 })),
      );
      c.position.set(cx, gY + h * 0.45, cz);
      c.scale.set(1, h, 1);
      b.group.add(c);
    }

    // Floating bioluminescent jellyfish
    const jellyMat = b.mat(
      new THREE.MeshStandardMaterial({
        color: '#67e8f9',
        emissive: '#22d3ee',
        emissiveIntensity: 1.1,
        transparent: true,
        opacity: 0.85,
      }),
    );
    const jelly = new THREE.Mesh(b.geo(new THREE.SphereGeometry(0.32, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), jellyMat);
    jelly.position.set(-0.2, gY + 1.35, 0.15);
    b.group.add(jelly);

    // Gliding miniature manta ray silhouette
    const mantaPivot = new THREE.Group();
    mantaPivot.position.y = gY + 1.55;
    const manta = new THREE.Mesh(
      b.geo(new THREE.OctahedronGeometry(0.34, 0)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#0284c7', emissiveIntensity: 0.6 })),
    );
    manta.scale.set(1.6, 0.16, 0.9);
    manta.position.set(0.85, 0, 0);
    mantaPivot.add(manta);
    b.group.add(mantaPivot);

    b.onUpdate((_dt, elapsed) => {
      jelly.position.y = gY + 1.35 + Math.sin(elapsed * 2.1) * 0.16;
      jelly.scale.set(1 + Math.sin(elapsed * 2.1) * 0.1, 1 - Math.sin(elapsed * 2.1) * 0.08, 1 + Math.sin(elapsed * 2.1) * 0.1);
      mantaPivot.rotation.y = elapsed * 0.6;
    });

    return b.finish({ colorA: '#67e8f9', colorB: '#bae6fd', style: 'bubbles', fallSpeed: 0.34 });
  }

  if (id === 'jp-apartment') {
    b.addStageDisc('#5c3d28', '#f4a259', '#3b2416', 0.35);

    // Night skyline silhouettes with glowing amber windows behind the loft
    const bldgMat = b.mat(new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.7 }));
    const winMat = b.mat(new THREE.MeshBasicMaterial({ color: '#fde68a' }));
    const winGeo = b.geo(new THREE.BoxGeometry(0.12, 0.1, 0.04));
    for (const [bx, bz, bh] of [
      [-0.95, -0.88, 1.35],
      [-0.25, -1.08, 1.75],
      [0.52, -0.96, 1.48],
      [1.1, -0.68, 1.15],
    ]) {
      const tower = new THREE.Mesh(b.geo(new THREE.BoxGeometry(0.46, bh, 0.38)), bldgMat);
      tower.position.set(bx, gY + bh * 0.5, bz);
      b.group.add(tower);
      for (let wy = 0.3; wy < bh - 0.15; wy += 0.32) {
        const w = new THREE.Mesh(winGeo, winMat);
        w.position.set(bx, gY + wy, bz + 0.2);
        b.group.add(w);
      }
    }

    // Warm glowing loft lamp & cozy sofa + tiny golden shiba
    const lampShade = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.24, 14, 14)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#fcd34d' })),
    );
    lampShade.position.set(-0.75, gY + 1.05, 0.35);
    const lampStem = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.03, 0.04, 1.0, 8)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#eab308', metalness: 0.8 })),
    );
    lampStem.position.set(-0.75, gY + 0.5, 0.35);
    b.group.add(lampStem, lampShade);

    const sofa = new THREE.Mesh(
      b.geo(new THREE.BoxGeometry(1.05, 0.34, 0.48)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#c2410c', emissive: '#7c2d12', emissiveIntensity: 0.3 })),
    );
    sofa.position.set(0.35, gY + 0.2, 0.42);
    b.group.add(sofa);

    // Tiny golden shiba bobbing happily
    const shiba = new THREE.Mesh(
      b.geo(new THREE.BoxGeometry(0.24, 0.26, 0.34)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#b45309', emissiveIntensity: 0.35 })),
    );
    shiba.position.set(-0.15, gY + 0.18, 0.82);
    b.group.add(shiba);

    b.onUpdate((_dt, elapsed) => {
      shiba.position.y = gY + 0.18 + Math.abs(Math.sin(elapsed * 2.8)) * 0.08;
      lampShade.scale.setScalar(1 + Math.sin(elapsed * 1.9) * 0.04);
    });

    return b.finish({ colorA: '#fde68a', colorB: '#fb923c', style: 'stardust', fallSpeed: -0.14 });
  }

  if (id === 'jp-abyss') {
    b.addStageDisc('#061a1d', '#3ff2c8', '#0d5e52', 0.85);

    // Stepped ancient floating monoliths arching across the glowing abyss chasm
    const stoneMat = b.mat(new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.85, metalness: 0.15 }));
    const glowMat = b.mat(new THREE.MeshBasicMaterial({ color: '#3ff2c8' }));
    const stones: THREE.Group[] = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const x = Math.sin(t * Math.PI * 1.35 - 0.5) * 0.72;
      const z = 1.15 - t * 2.3;
      const y = gY + 0.38 + Math.sin(t * Math.PI) * 0.62;
      const sg = new THREE.Group();
      sg.position.set(x, y, z);
      const slab = new THREE.Mesh(b.geo(new THREE.CylinderGeometry(0.34, 0.22, 0.24, 6)), stoneMat);
      const under = new THREE.Mesh(b.geo(new THREE.CylinderGeometry(0.24, 0.14, 0.08, 6)), glowMat);
      under.position.y = -0.14;
      sg.add(slab, under);
      b.group.add(sg);
      stones.push(sg);
    }

    // Dark jagged spires rising from the edge of the murk
    const spireGeo = b.geo(new THREE.ConeGeometry(0.18, 1.75, 5));
    for (const [sx, sz, s] of [
      [-1.2, -0.5, 1.0],
      [1.22, -0.35, 1.15],
      [1.05, 0.78, 0.78],
    ]) {
      const sp = new THREE.Mesh(spireGeo, stoneMat);
      sp.position.set(sx, gY + 0.8 * s, sz);
      sp.scale.setScalar(s);
      b.group.add(sp);
    }

    b.onUpdate((_dt, elapsed) => {
      for (let i = 0; i < stones.length; i++) {
        stones[i].position.y += Math.sin(elapsed * 1.4 + i * 0.8) * 0.0012;
      }
    });

    return b.finish({ colorA: '#3ff2c8', colorB: '#99f6e4', style: 'spores', fallSpeed: 0.2 });
  }

  if (id === 'jp-visage' || id.startsWith('jp-visages')) {
    b.addStageDisc('#141118', '#d11824', '#380910', 0.55);

    // Glistening crimson pool along the central avenue
    const pool = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.65, 0.65, 0.03, 24)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#991b1b', emissive: '#b91c1c', emissiveIntensity: 0.65, roughness: 0.12 })),
    );
    pool.scale.set(0.65, 1, 2.25);
    pool.position.set(0, gY + 0.02, 0);
    b.group.add(pool);

    // Opposing rows of sculpted ancient stone visages with glossy obsidian eyes
    const faceMat = b.mat(new THREE.MeshStandardMaterial({ color: '#cbd5e1', emissive: '#334155', emissiveIntensity: 0.22, roughness: 0.82 }));
    const eyeMat = b.mat(new THREE.MeshStandardMaterial({ color: '#020617', roughness: 0.05, metalness: 0.9 }));
    const headGeo = b.geo(new THREE.BoxGeometry(0.42, 0.82, 0.44));
    const eyeGeo = b.geo(new THREE.SphereGeometry(0.065, 10, 10));
    for (const side of [-1, 1]) {
      for (const z of [-0.88, 0.0, 0.88]) {
        const head = new THREE.Mesh(headGeo, faceMat);
        head.position.set(side * 1.05, gY + 0.45, z);
        const e1 = new THREE.Mesh(eyeGeo, eyeMat);
        const e2 = new THREE.Mesh(eyeGeo, eyeMat);
        e1.position.set(-side * 0.2, 0.12, -0.1);
        e2.position.set(-side * 0.2, 0.12, 0.1);
        head.add(e1, e2);
        b.group.add(head);
      }
    }

    // Pale crescent moon sphere high in the dome
    const moon = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.22, 14, 14)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#e2e8f0' })),
    );
    moon.position.set(0, gY + 1.82, -0.65);
    b.group.add(moon);

    return b.finish({ colorA: '#fca5a5', colorB: '#cbd5e1', style: 'ash', fallSpeed: -0.15 });
  }

  if (id === 'eric-palace-lagoon') {
    b.addStageDisc('#d99345', '#f2b866', '#854d1b', 0.48);

    // Classical Palace of Fine Arts rotunda dome & slender colonnade
    const stoneMat = b.mat(
      new THREE.MeshStandardMaterial({ color: '#f3d0a4', emissive: '#92400e', emissiveIntensity: 0.28, roughness: 0.55 }),
    );
    const domeMat = b.mat(
      new THREE.MeshStandardMaterial({ color: '#e08b55', emissive: '#b45309', emissiveIntensity: 0.35, roughness: 0.42 }),
    );

    const rotunda = new THREE.Group();
    rotunda.position.set(0, gY + 0.05, -0.2);
    const plinth = new THREE.Mesh(b.geo(new THREE.CylinderGeometry(1.05, 1.15, 0.18, 24)), stoneMat);
    plinth.position.y = 0.09;
    rotunda.add(plinth);

    const colGeo = b.geo(new THREE.CylinderGeometry(0.06, 0.07, 0.92, 8));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const col = new THREE.Mesh(colGeo, stoneMat);
      col.position.set(Math.cos(a) * 0.82, 0.62, Math.sin(a) * 0.82);
      rotunda.add(col);
    }
    const cornice = new THREE.Mesh(b.geo(new THREE.CylinderGeometry(0.95, 0.95, 0.14, 24)), stoneMat);
    cornice.position.y = 1.12;
    const dome = new THREE.Mesh(b.geo(new THREE.SphereGeometry(0.84, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), domeMat);
    dome.position.y = 1.16;
    rotunda.add(cornice, dome);
    b.group.add(rotunda);

    // Warm golden sunset halo orb
    const sunOrb = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.3, 14, 14)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#fde68a' })),
    );
    sunOrb.position.set(-0.85, gY + 1.65, -0.75);
    b.group.add(sunOrb);

    b.onUpdate((_dt, elapsed) => {
      rotunda.rotation.y = Math.sin(elapsed * 0.35) * 0.15;
    });

    return b.finish({ colorA: '#fde68a', colorB: '#fdba74', style: 'stardust', fallSpeed: -0.15 });
  }

  if (id === 'laser-lab') {
    b.addStageDisc('#090514', '#ff2a85', '#2a0826', 0.65);

    // Crisscrossing glowing neon laser beams
    const pinkLaser = b.mat(new THREE.MeshBasicMaterial({ color: '#ff2a85' }));
    const cyanLaser = b.mat(new THREE.MeshBasicMaterial({ color: '#22d3ee' }));
    const beamGeo = b.geo(new THREE.CylinderGeometry(0.024, 0.024, 2.75, 6));
    const laserFan = new THREE.Group();
    laserFan.position.y = gY + 0.92;
    for (let i = 0; i < 6; i++) {
      const beam = new THREE.Mesh(beamGeo, i % 2 === 0 ? pinkLaser : cyanLaser);
      beam.rotation.z = -0.85 + i * 0.34;
      beam.rotation.y = i * 0.52;
      laserFan.add(beam);
    }
    b.group.add(laserFan);

    // Floating spinning refractive diamond prism
    const prism = new THREE.Mesh(
      b.geo(new THREE.OctahedronGeometry(0.48, 0)),
      b.mat(
        new THREE.MeshStandardMaterial({
          color: '#f472b6',
          emissive: '#ec4899',
          emissiveIntensity: 1.15,
          roughness: 0.1,
          metalness: 0.8,
        }),
      ),
    );
    prism.position.set(0, gY + 1.05, 0);
    b.group.add(prism);

    b.onUpdate((_dt, elapsed) => {
      prism.rotation.y = elapsed * 1.4;
      prism.rotation.x = elapsed * 0.7;
      laserFan.rotation.y = Math.sin(elapsed * 0.9) * 0.45;
    });

    return b.finish({ colorA: '#ff2a85', colorB: '#38bdf8', style: 'sparks', fallSpeed: 0.12 });
  }

  if (id === 'alpine-sled') {
    b.addStageDisc('#dbeafe', '#818cf8', '#4f46e5', 0.35);

    // Twin alpenglow peaks
    const peakMat = b.mat(
      new THREE.MeshStandardMaterial({ color: '#a5b4fc', emissive: '#4338ca', emissiveIntensity: 0.32, roughness: 0.65 }),
    );
    const capMat = b.mat(new THREE.MeshStandardMaterial({ color: '#f8fafc', emissive: '#c7d2fe', emissiveIntensity: 0.3 }));
    for (const [px, pz, s] of [
      [-0.65, -0.75, 1.05],
      [0.62, -0.88, 1.25],
    ]) {
      const mtn = new THREE.Mesh(b.geo(new THREE.ConeGeometry(0.75, 1.45, 5)), peakMat);
      mtn.position.set(px, gY + 0.68 * s, pz);
      mtn.scale.setScalar(s);
      const snowCap = new THREE.Mesh(b.geo(new THREE.ConeGeometry(0.32, 0.56, 5)), capMat);
      snowCap.position.set(px, gY + 1.14 * s, pz);
      snowCap.scale.setScalar(s);
      b.group.add(mtn, snowCap);
    }

    // Frosted alpine fir trees & tiny warm sled-trail lanterns
    const firMat = b.mat(new THREE.MeshStandardMaterial({ color: '#166534', emissive: '#064e3b', emissiveIntensity: 0.3 }));
    const firGeo = b.geo(new THREE.ConeGeometry(0.28, 0.78, 7));
    for (const [tx, tz, s] of [
      [-1.1, 0.45, 0.95],
      [-0.78, 0.82, 0.75],
      [0.98, 0.5, 0.9],
      [0.72, 0.92, 0.72],
    ]) {
      const tree = new THREE.Mesh(firGeo, firMat);
      tree.position.set(tx, gY + 0.36 * s, tz);
      tree.scale.setScalar(s);
      b.group.add(tree);
    }

    const lanternMat = b.mat(new THREE.MeshBasicMaterial({ color: '#fde68a' }));
    const lanternGeo = b.geo(new THREE.SphereGeometry(0.09, 8, 8));
    for (const [lx, lz] of [
      [-0.36, 0.75],
      [0.36, 0.75],
      [-0.36, 0.05],
      [0.36, 0.05],
    ]) {
      const l = new THREE.Mesh(lanternGeo, lanternMat);
      l.position.set(lx, gY + 0.34, lz);
      b.group.add(l);
    }

    return b.finish({ colorA: '#ffffff', colorB: '#e0e7ff', style: 'snow', fallSpeed: -0.45 });
  }

  if (id === 'eric-biolum-grove') {
    b.addStageDisc('#08211f', '#34d399', '#065f46', 0.65);

    // Towering redwood trunks
    const barkMat = b.mat(new THREE.MeshStandardMaterial({ color: '#451a03', roughness: 0.9 }));
    const trunkGeo = b.geo(new THREE.CylinderGeometry(0.14, 0.22, 1.85, 8));
    for (const [tx, tz, sy] of [
      [-1.02, -0.32, 1.05],
      [1.04, -0.25, 0.95],
      [-0.55, -0.95, 1.15],
      [0.62, -0.9, 1.08],
    ]) {
      const tr = new THREE.Mesh(trunkGeo, barkMat);
      tr.position.set(tx, gY + 0.9 * sy, tz);
      tr.scale.y = sy;
      b.group.add(tr);
    }

    // Glowing emerald & cyan mushrooms
    const mushCaps: THREE.Mesh[] = [];
    const capGeo = b.geo(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55));
    const stemGeo = b.geo(new THREE.CylinderGeometry(0.05, 0.07, 0.28, 7));
    const stemMat = b.mat(new THREE.MeshStandardMaterial({ color: '#a7f3d0', emissive: '#10b981', emissiveIntensity: 0.4 }));
    for (const [mx, mz, s, hex] of [
      [-0.55, 0.55, 1.0, '#34d399'],
      [0.52, 0.48, 1.15, '#22d3ee'],
      [0.05, 0.85, 0.78, '#a78bfa'],
      [-0.12, -0.15, 0.92, '#34d399'],
    ] as const) {
      const st = new THREE.Mesh(stemGeo, stemMat);
      st.position.set(mx, gY + 0.14 * s, mz);
      st.scale.setScalar(s);
      const cap = new THREE.Mesh(capGeo, b.mat(new THREE.MeshBasicMaterial({ color: hex })));
      cap.position.set(mx, gY + 0.26 * s, mz);
      cap.scale.setScalar(s);
      b.group.add(st, cap);
      mushCaps.push(cap);
    }

    // Miniature curved aurora curtain high inside the glass
    const aurora = new THREE.Mesh(
      b.geo(new THREE.TorusGeometry(1.18, 0.14, 8, 32, Math.PI * 0.9)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.55 })),
    );
    aurora.position.set(0, gY + 1.48, -0.2);
    aurora.rotation.z = 0.2;
    b.group.add(aurora);

    b.onUpdate((_dt, elapsed) => {
      aurora.rotation.y = Math.sin(elapsed * 0.75) * 0.28;
      for (let i = 0; i < mushCaps.length; i++) {
        mushCaps[i].scale.y = 0.9 + Math.sin(elapsed * 2.2 + i) * 0.12;
      }
    });

    return b.finish({ colorA: '#34d399', colorB: '#a78bfa', style: 'spores', fallSpeed: 0.22 });
  }

  if (id === 'eric-sun-observatory') {
    b.addStageDisc('#f59e0b', '#fde68a', '#b45309', 0.55);

    // White marble plaza & sunset cloud puffs
    const marble = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(1.15, 1.05, 0.18, 28)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.35 })),
    );
    marble.position.y = gY + 0.14;
    b.group.add(marble);

    const cloudMat = b.mat(new THREE.MeshStandardMaterial({ color: '#fed7aa', emissive: '#f97316', emissiveIntensity: 0.35 }));
    const puffGeo = b.geo(new THREE.SphereGeometry(0.42, 12, 10));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const puff = new THREE.Mesh(puffGeo, cloudMat);
      puff.scale.set(1.2, 0.55, 1.0);
      puff.position.set(Math.cos(a) * 1.38, gY + 0.06, Math.sin(a) * 1.38);
      b.group.add(puff);
    }

    // Spinning interlocking brass armillary rings & glowing sun core
    const brassMat = b.mat(
      new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#d97706', emissiveIntensity: 0.65, metalness: 0.85, roughness: 0.22 }),
    );
    const armillary = new THREE.Group();
    armillary.position.set(0, gY + 1.25, 0);
    const r1 = new THREE.Mesh(b.geo(new THREE.TorusGeometry(0.95, 0.045, 8, 36)), brassMat);
    const r2 = new THREE.Mesh(b.geo(new THREE.TorusGeometry(0.74, 0.04, 8, 32)), brassMat);
    const r3 = new THREE.Mesh(b.geo(new THREE.TorusGeometry(0.52, 0.035, 8, 28)), brassMat);
    r2.rotation.x = Math.PI / 3;
    r3.rotation.y = Math.PI / 3;
    const sunCore = new THREE.Mesh(
      b.geo(new THREE.OctahedronGeometry(0.26, 1)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#fffbeb' })),
    );
    armillary.add(r1, r2, r3, sunCore);
    b.group.add(armillary);

    b.onUpdate((_dt, elapsed) => {
      r1.rotation.y = elapsed * 0.55;
      r2.rotation.z = elapsed * 0.78;
      r3.rotation.x = elapsed * 1.05;
    });

    return b.finish({ colorA: '#fef08a', colorB: '#fb923c', style: 'stardust', fallSpeed: -0.14 });
  }

  if (id === 'honey-hood') {
    b.addStageDisc('#d97706', '#fbbf24', '#92400e', 0.45);

    // Golden honey-dripping trees
    const trunkMat = b.mat(new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.85 }));
    const honeyMat = b.mat(new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#d97706', emissiveIntensity: 0.45, roughness: 0.25 }));
    const trunkGeo = b.geo(new THREE.CylinderGeometry(0.09, 0.14, 0.9, 7));
    const canopyGeo = b.geo(new THREE.DodecahedronGeometry(0.45, 0));
    for (const [tx, tz] of [
      [-1.02, -0.42],
      [1.05, -0.32],
      [-0.68, 0.72],
    ]) {
      const tr = new THREE.Mesh(trunkGeo, trunkMat);
      tr.position.set(tx, gY + 0.45, tz);
      const ca = new THREE.Mesh(canopyGeo, honeyMat);
      ca.position.set(tx, gY + 1.02, tz);
      b.group.add(tr, ca);
    }

    // Iconic red fire hydrant
    const hydrant = new THREE.Mesh(
      b.geo(new THREE.CylinderGeometry(0.11, 0.13, 0.36, 8)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#991b1b', emissiveIntensity: 0.35 })),
    );
    hydrant.position.set(0.82, gY + 0.2, 0.75);
    b.group.add(hydrant);

    // Chunky miniature golden bumblebee in a blue jacket hovering in the center!
    const bee = new THREE.Group();
    bee.position.set(0, gY + 1.08, 0.12);
    const jacket = new THREE.Mesh(
      b.geo(new THREE.CapsuleGeometry(0.24, 0.22, 6, 12)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#2563eb', emissive: '#1d4ed8', emissiveIntensity: 0.4 })),
    );
    const head = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.22, 12, 12)),
      b.mat(new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#ca8a04', emissiveIntensity: 0.45 })),
    );
    head.position.y = 0.32;
    const wingMat = b.mat(new THREE.MeshBasicMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.75 }));
    const wingGeo = b.geo(new THREE.SphereGeometry(0.18, 8, 8));
    const wl = new THREE.Mesh(wingGeo, wingMat);
    wl.scale.set(1.3, 0.25, 0.7);
    wl.position.set(-0.32, 0.12, -0.14);
    const wr = wl.clone();
    wr.position.x = 0.32;
    bee.add(jacket, head, wl, wr);
    b.group.add(bee);

    b.onUpdate((_dt, elapsed) => {
      bee.position.y = gY + 1.08 + Math.sin(elapsed * 2.8) * 0.12;
      bee.rotation.y = Math.sin(elapsed * 0.9) * 0.4;
      wl.rotation.z = Math.sin(elapsed * 18) * 0.35;
      wr.rotation.z = -Math.sin(elapsed * 18) * 0.35;
    });

    return b.finish({ colorA: '#fde047', colorB: '#fb923c', style: 'stardust', fallSpeed: -0.2 });
  }

  if (id === 'doug-cassette-station') {
    b.addStageDisc('#0f232c', '#5eead4', '#0e4246', 0.55);

    // Translucent retro cassette-tape archway with spinning twin reels
    const cassMat = b.mat(
      new THREE.MeshStandardMaterial({
        color: '#2dd4bf',
        emissive: '#14b8a6',
        emissiveIntensity: 0.85,
        transparent: true,
        opacity: 0.82,
      }),
    );
    const cassette = new THREE.Mesh(b.geo(new THREE.BoxGeometry(1.75, 1.05, 0.22)), cassMat);
    cassette.position.set(0, gY + 0.78, -0.45);
    b.group.add(cassette);

    const reelMat = b.mat(new THREE.MeshBasicMaterial({ color: '#f472b6' }));
    const reelGeo = b.geo(new THREE.TorusGeometry(0.22, 0.045, 8, 16));
    const reelL = new THREE.Mesh(reelGeo, reelMat);
    reelL.position.set(-0.42, gY + 0.84, -0.32);
    const reelR = new THREE.Mesh(reelGeo, reelMat);
    reelR.position.set(0.42, gY + 0.84, -0.32);
    b.group.add(reelL, reelR);

    // Warm glowing amber tea-stall lantern
    const lantern = new THREE.Mesh(
      b.geo(new THREE.SphereGeometry(0.18, 10, 10)),
      b.mat(new THREE.MeshBasicMaterial({ color: '#fb923c' })),
    );
    lantern.position.set(-1.05, gY + 0.55, 0.58);
    b.group.add(lantern);

    // Tiny holographic koi gliding overhead inside the rain dome
    const koiPivot = new THREE.Group();
    koiPivot.position.y = gY + 1.52;
    const koiGeo = b.geo(new THREE.ConeGeometry(0.1, 0.36, 6));
    koiGeo.rotateX(Math.PI / 2);
    const koi1 = new THREE.Mesh(koiGeo, b.mat(new THREE.MeshBasicMaterial({ color: '#5eead4' })));
    koi1.position.set(0.75, 0, 0);
    const koi2 = new THREE.Mesh(koiGeo, b.mat(new THREE.MeshBasicMaterial({ color: '#f472b6' })));
    koi2.position.set(-0.75, 0.14, 0);
    koi2.rotation.y = Math.PI;
    koiPivot.add(koi1, koi2);
    b.group.add(koiPivot);

    b.onUpdate((_dt, elapsed) => {
      reelL.rotation.z = -elapsed * 2.2;
      reelR.rotation.z = -elapsed * 2.2;
      koiPivot.rotation.y = elapsed * 0.72;
    });

    return b.finish({ colorA: '#5eead4', colorB: '#f472b6', style: 'sparks', fallSpeed: -0.38 });
  }

  // Graceful procedural fallback diorama for any newly added or custom community room!
  const accent = manifest.accentColor || '#38bdf8';
  const rand = mulberry32(hashString(id));
  b.addStageDisc('#131b31', accent, accent, 0.32);

  const portalRing = new THREE.Mesh(
    b.geo(new THREE.TorusGeometry(0.85, 0.075, 10, 32)),
    b.mat(new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.95, metalness: 0.5, roughness: 0.25 })),
  );
  portalRing.position.set(0, gY + 0.96, 0);
  b.group.add(portalRing);

  const spireGeo = b.geo(new THREE.OctahedronGeometry(0.32, 0));
  const spireMat = b.mat(new THREE.MeshStandardMaterial({ color: '#f8fafc', emissive: accent, emissiveIntensity: 0.55 }));
  const shards: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rand() * 0.4;
    const shard = new THREE.Mesh(spireGeo, spireMat);
    shard.position.set(Math.cos(a) * 1.15, gY + 0.48 + (i % 2) * 0.3, Math.sin(a) * 1.15);
    shard.scale.set(0.7, 1.3, 0.7);
    b.group.add(shard);
    shards.push(shard);
  }

  b.onUpdate((_dt, elapsed) => {
    portalRing.rotation.y = elapsed * 0.45;
    for (let i = 0; i < shards.length; i++) {
      shards[i].rotation.y = elapsed * 0.8 + i;
    }
  });

  return b.finish({ colorA: '#ffffff', colorB: accent, style: 'stardust', fallSpeed: -0.22 });
}
