import * as THREE from 'three/webgpu';
import { seededRandom } from '@portalverse/core/rooms/kit';
import {
  ANALOG_SHOP_POS,
  BUS_STOP_POS,
  CONBINI_POS,
  NOODLE_BAR_POS,
  OPTICS_SHOP_POS,
  SCOOTER_LANE_NORTH_X,
  SCOOTER_LANE_SOUTH_X,
  TROLLEY_TRACK_X,
  stationHeight,
} from './terrain';
import {
  computeDissolveFactors,
  getShopSchedule,
  type CycleSnapshot,
  type DissolveFactors,
  type ShopId,
  type TrolleyState,
} from './worldState';
import type { ResourceBag } from './city';

export type CharacterSpecies = 'future-punk' | 'kitsune-hybrid' | 'neko-hybrid' | 'okami-hybrid' | 'usagi-hybrid';

export interface CharacterPalette {
  species: CharacterSpecies;
  skin: string;
  jacket: string;
  accent: string;
  pants: string;
  hair: string;
  wireColor: string;
}

export interface CharacterRig {
  group: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  tail: THREE.Mesh | null;
  umbrella: THREE.Group;
  applyDissolve: (factors: DissolveFactors) => void;
}

/**
 * Builds an articulated 3D Cyberpunk Future-Punk or Bio-Engineered Animal-Hybrid Human,
 * complete with:
 * - Species-distinct silhouette (spiked neon mohawk + chrome arm, tufted fox ears + lush tail,
 *   perky cat ears + swishing tail, wolf ears + visor, or tall articulated bunny ears)
 * - Pop-up translucent neon umbrella when raining
 * - Dual Solid + Translucent Glowing Polygon-Wireframe Shell for distance dissolve!
 */
export function buildCharacterModel(res: ResourceBag, palette: CharacterPalette): CharacterRig {
  const group = new THREE.Group();
  const solidMats: THREE.Material[] = [];
  const wireMats: THREE.MeshBasicMaterial[] = [];

  const registerMat = <T extends THREE.Material>(m: T): T => {
    m.transparent = true;
    solidMats.push(m);
    return res.mat(m);
  };

  const skinMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.72 }));
  const jacketMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.jacket, roughness: 0.58 }));
  const accentMat = registerMat(new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 1.6,
    roughness: 0.25,
  }));
  const pantsMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.pants, roughness: 0.78 }));
  const hairMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.65 }));
  const chromeMat = registerMat(new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.88, roughness: 0.22 }));

  const addDualPart = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    parent.add(m);

    const wMat = res.mat(new THREE.MeshBasicMaterial({
      color: palette.wireColor,
      wireframe: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const wm = new THREE.Mesh(geo, wMat);
    wm.position.copy(m.position);
    wm.rotation.copy(m.rotation);
    wm.scale.copy(m.scale).multiplyScalar(1.03);
    parent.add(wm);
    wireMats.push(wMat);
    return m;
  };

  // Torso + Popped-Collar Cyber Jacket + Glowing Trim
  addDualPart(group, res.geo(new THREE.BoxGeometry(0.46, 0.56, 0.26)), jacketMat, [0, 1.12, 0]);
  addDualPart(group, res.geo(new THREE.CylinderGeometry(0.19, 0.21, 0.14, 10, 1, true)), jacketMat, [0, 1.42, 0]);
  addDualPart(group, res.geo(new THREE.BoxGeometry(0.48, 0.06, 0.28)), accentMat, [0, 1.37, 0]);
  // Cybernetic chest strip / backpack battery
  addDualPart(group, res.geo(new THREE.BoxGeometry(0.24, 0.28, 0.14)), accentMat, [0, 1.16, -0.18]);

  // Head + Glowing Cyber Visor
  addDualPart(group, res.geo(new THREE.SphereGeometry(0.17, 10, 8)), skinMat, [0, 1.58, 0]);
  addDualPart(group, res.geo(new THREE.BoxGeometry(0.26, 0.07, 0.14)), accentMat, [0, 1.6, 0.12]);

  // Articulated Legs
  const legGeo = res.geo(new THREE.CylinderGeometry(0.085, 0.07, 0.78, 7));
  const bootGeo = res.geo(new THREE.BoxGeometry(0.14, 0.12, 0.24));
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.12, 0.82, 0);
  addDualPart(leftLeg, legGeo, pantsMat, [0, -0.39, 0]);
  addDualPart(leftLeg, bootGeo, accentMat, [0, -0.76, 0.04]);
  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.12, 0.82, 0);
  addDualPart(rightLeg, legGeo, pantsMat, [0, -0.39, 0]);
  addDualPart(rightLeg, bootGeo, accentMat, [0, -0.76, 0.04]);
  group.add(leftLeg, rightLeg);

  // Articulated Arms (Future-punks get a gleaming chrome prosthetic right arm!)
  const armGeo = res.geo(new THREE.CylinderGeometry(0.065, 0.055, 0.56, 7));
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.3, 1.34, 0);
  addDualPart(leftArm, armGeo, jacketMat, [0, -0.26, 0]);
  const rightArm = new THREE.Group();
  rightArm.position.set(0.3, 1.34, 0);
  addDualPart(rightArm, armGeo, palette.species === 'future-punk' ? chromeMat : jacketMat, [0, -0.26, 0]);
  group.add(leftArm, rightArm);

  // Species-specific silhouette features!
  let tail: THREE.Mesh | null = null;
  if (palette.species === 'future-punk') {
    // Tall glowing cyber-mohawk spikes
    for (let s = 0; s < 4; s++) {
      addDualPart(group, res.geo(new THREE.ConeGeometry(0.055, 0.22, 5)), s % 2 === 0 ? accentMat : hairMat, [0, 1.78, 0.09 - s * 0.075], [-0.25 + s * 0.14, 0, 0]);
    }
  } else if (palette.species === 'kitsune-hybrid') {
    // Tall tufted fox ears + lush glowing-tip fox tail
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.075, 0.28, 5)), hairMat, [-0.11, 1.82, 0.02], [0, 0, 0.22]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.075, 0.28, 5)), hairMat, [0.11, 1.82, 0.02], [0, 0, -0.22]);
    tail = addDualPart(group, res.geo(new THREE.ConeGeometry(0.14, 0.68, 7)), hairMat, [0, 0.85, -0.34], [-1.15, 0, 0]);
    addDualPart(group, res.geo(new THREE.SphereGeometry(0.07, 6, 5)), accentMat, [0, 0.68, -0.62]);
  } else if (palette.species === 'neko-hybrid') {
    // Perky cat ears + curved swishing feline tail
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.065, 0.19, 4)), hairMat, [-0.11, 1.78, 0.03], [0.1, 0, 0.28]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.065, 0.19, 4)), hairMat, [0.11, 1.78, 0.03], [0.1, 0, -0.28]);
    tail = addDualPart(group, res.geo(new THREE.CapsuleGeometry(0.036, 0.56, 4, 6)), hairMat, [0, 0.84, -0.3], [-0.95, 0, 0]);
  } else if (palette.species === 'okami-hybrid') {
    // Upright wolf ears + bushy wolf tail
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.07, 0.24, 5)), hairMat, [-0.12, 1.8, 0], [-0.08, 0, 0.14]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.07, 0.24, 5)), hairMat, [0.12, 1.8, 0], [-0.08, 0, -0.14]);
    tail = addDualPart(group, res.geo(new THREE.CapsuleGeometry(0.09, 0.44, 5, 7)), hairMat, [0, 0.82, -0.32], [-1.1, 0, 0]);
  } else {
    // Usagi-hybrid: long articulated cyber-bunny ears + fluffy cotton tail!
    addDualPart(group, res.geo(new THREE.CapsuleGeometry(0.042, 0.34, 4, 6)), hairMat, [-0.09, 1.94, 0], [-0.12, 0, 0.16]);
    addDualPart(group, res.geo(new THREE.CapsuleGeometry(0.042, 0.34, 4, 6)), hairMat, [0.09, 1.94, 0], [-0.12, 0, -0.22]);
    tail = addDualPart(group, res.geo(new THREE.SphereGeometry(0.11, 8, 6)), hairMat, [0, 0.84, -0.22]);
  }

  // Translucent neon rain umbrella held in right hand (opens automatically when raining!)
  const umbrella = new THREE.Group();
  const umbShaft = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.014, 0.014, 0.92, 6)), chromeMat);
  umbShaft.position.y = 0.46;
  const umbDomeMat = registerMat(new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.45,
    roughness: 0.15,
    side: THREE.DoubleSide,
  }));
  const umbDome = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.62, 0.26, 10, 1, true)), umbDomeMat);
  umbDome.position.y = 0.84;
  umbrella.add(umbShaft, umbDome);
  umbrella.position.set(0.32, 1.12, 0.16);
  group.add(umbrella);

  return {
    group,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    tail,
    umbrella,
    applyDissolve(f: DissolveFactors) {
      group.visible = f.visible;
      for (const m of solidMats) {
        m.opacity = m === umbDomeMat ? f.solidOpacity * 0.42 : f.solidOpacity;
        m.visible = f.solidOpacity > 0.02;
      }
      for (const wm of wireMats) {
        wm.opacity = f.wireOpacity;
        wm.visible = f.wireOpacity > 0.02;
      }
    },
  };
}

/**
 * Builds a sleek Neo-Futuristic Cyber-Scooter with glowing twin hover-wheel rings,
 * curved neon front fairing, headlight, magenta tail-light, rider, and polygon dissolve shell!
 */
export function buildCyberScooter(res: ResourceBag, riderPalette: CharacterPalette): {
  group: THREE.Group;
  applyDissolve: (factors: DissolveFactors) => void;
} {
  const group = new THREE.Group();
  const solidMats: THREE.Material[] = [];
  const wireMats: THREE.MeshBasicMaterial[] = [];

  const reg = <T extends THREE.Material>(m: T): T => {
    m.transparent = true;
    solidMats.push(m);
    return res.mat(m);
  };
  const bodyMat = reg(new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.28, metalness: 0.78 }));
  const neonMat = reg(new THREE.MeshStandardMaterial({ color: riderPalette.accent, emissive: riderPalette.accent, emissiveIntensity: 2.2 }));
  const tailMat = reg(new THREE.MeshStandardMaterial({ color: '#f43f5e', emissive: '#e11d48', emissiveIntensity: 2.2 }));

  const addPart = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot?: [number, number, number]) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    group.add(m);
    const wm = res.mat(new THREE.MeshBasicMaterial({
      color: riderPalette.wireColor,
      wireframe: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const wMesh = new THREE.Mesh(geo, wm);
    wMesh.position.copy(m.position);
    wMesh.rotation.copy(m.rotation);
    wMesh.scale.setScalar(1.03);
    group.add(wMesh);
    wireMats.push(wm);
  };

  // Chassis deck + angled cyber-shield fairing + glowing wheels
  addPart(res.geo(new THREE.BoxGeometry(0.56, 0.24, 1.55)), bodyMat, [0, 0.42, 0]);
  addPart(res.geo(new THREE.BoxGeometry(0.46, 0.72, 0.22)), bodyMat, [0, 0.85, 0.62], [-0.32, 0, 0]);
  addPart(res.geo(new THREE.BoxGeometry(0.52, 0.08, 0.14)), neonMat, [0, 0.96, 0.75]); // headlight bar
  addPart(res.geo(new THREE.BoxGeometry(0.48, 0.08, 0.12)), tailMat, [0, 0.54, -0.78]); // magenta taillight
  addPart(res.geo(new THREE.TorusGeometry(0.24, 0.06, 8, 16).rotateY(Math.PI / 2)), neonMat, [0, 0.26, 0.64]);
  addPart(res.geo(new THREE.TorusGeometry(0.24, 0.06, 8, 16).rotateY(Math.PI / 2)), neonMat, [0, 0.26, -0.62]);

  // Seated cyber-rider leaning forward over the handlebars
  const rider = buildCharacterModel(res, riderPalette);
  rider.umbrella.visible = false;
  rider.group.position.set(0, 0.12, -0.14);
  rider.leftLeg.rotation.x = -0.85;
  rider.rightLeg.rotation.x = -0.85;
  rider.leftArm.rotation.x = -0.95;
  rider.rightArm.rotation.x = -0.95;
  group.add(rider.group);

  return {
    group,
    applyDissolve(f: DissolveFactors) {
      group.visible = f.visible;
      for (const m of solidMats) {
        m.opacity = f.solidOpacity;
        m.visible = f.solidOpacity > 0.02;
      }
      for (const wm of wireMats) {
        wm.opacity = f.wireOpacity;
        wm.visible = f.wireOpacity > 0.02;
      }
      rider.applyDissolve(f);
    },
  };
}

// ---------------------------------------------------------------------------
// Living Street Population: Named Shopkeepers, Diners, Commuters, Pedestrians & Scooters
// ---------------------------------------------------------------------------

export interface TalkableNpc {
  id: string;
  name: string;
  role: string;
  speciesLabel: string;
  shopId?: ShopId;
  getPosition: () => { x: number; y: number; z: number };
  getRoutine: (cycle: CycleSnapshot, trolley: TrolleyState) => string;
  lines: ReadonlyArray<string>;
}

export interface StreetLifeHandle {
  npcs: TalkableNpc[];
  update: (dt: number, elapsed: number, cycle: CycleSnapshot, trolley: TrolleyState) => void;
}

export function buildStreetLife(root: THREE.Group, res: ResourceBag): StreetLifeHandle {
  const rand = seededRandom(204977);
  const npcs: TalkableNpc[] = [];

  // -------------------------------------------------------------------------
  // 1. Named Shopkeepers Attached to Each Corner Shop (with live routines!)
  // -------------------------------------------------------------------------
  const chefKenta = buildCharacterModel(res, {
    species: 'future-punk',
    skin: '#e0b899',
    jacket: '#f8fafc',
    accent: '#ef4444',
    pants: '#1e293b',
    hair: '#334155',
    wireColor: '#fb7185',
  });
  chefKenta.umbrella.visible = false;
  chefKenta.group.position.set(NOODLE_BAR_POS.x + 0.72, stationHeight(NOODLE_BAR_POS.x, NOODLE_BAR_POS.z), NOODLE_BAR_POS.z);
  chefKenta.group.rotation.y = Math.PI / 2;
  root.add(chefKenta.group);
  npcs.push({
    id: 'chef-kenta',
    name: 'Chef Kenta',
    role: 'White Dragon Noodle Bar',
    speciesLabel: 'Cyborg Chef',
    shopId: 'noodles',
    getPosition: () => ({ x: NOODLE_BAR_POS.x + 2.3, y: 0.14, z: NOODLE_BAR_POS.z }),
    getRoutine: (c) => getShopSchedule('noodles', c.period).activity,
    lines: [
      'He say you Brade Runna! Sit down, eat — two! Two! Four! Hot miso cuts right through the acid rain.',
      'Ever notice how folks riding the Line 09 trolley vanish into glowing wireframes past Block 32? Same faces walk back twenty minutes later.',
      'Someone left a silver origami unicorn on my north bench earlier. Keep your eyes open, traveler.',
      'When the rain pauses, look straight up. That ain\'t clouds behind the smog — that\'s a dead television channel.',
    ],
  });

  const drSable = buildCharacterModel(res, {
    species: 'kitsune-hybrid',
    skin: '#f1d2be',
    jacket: '#0f172a',
    accent: '#22d3ee',
    pants: '#1e293b',
    hair: '#f97316',
    wireColor: '#22d3ee',
  });
  const sableBaseX = OPTICS_SHOP_POS.x - 2.1;
  const sableBaseZ = OPTICS_SHOP_POS.z - 0.6;
  drSable.group.position.set(sableBaseX, stationHeight(sableBaseX, sableBaseZ), sableBaseZ);
  drSable.group.rotation.y = -Math.PI / 2;
  root.add(drSable.group);
  npcs.push({
    id: 'dr-sable',
    name: 'Dr. Sable',
    role: 'Kuro Cyber-Optics & Bio-Mod',
    speciesLabel: 'Kitsune Bio-Hybrid',
    shopId: 'optics',
    getPosition: () => drSable.group.position,
    getRoutine: (c) => getShopSchedule('optics', c.period).activity,
    lines: [
      'Fresh off-world ocular implants — guarantee they let you see past the rain haze. Though you might not like what\'s behind it.',
      'My gen-4 fox ears pick up a 60-hertz hum every time the sky cracks open into static snow.',
      'I tested a customer\'s baseline outside with my Voight scanner earlier. Left it humming by the north planter.',
      'Bio-hybrids run half this district now. Better night vision than baseline humans, and our ears double as rain antennas.',
    ],
  });

  const mina9 = buildCharacterModel(res, {
    species: 'future-punk',
    skin: '#e8c4b0',
    jacket: '#3b0764',
    accent: '#f472b6',
    pants: '#0f172a',
    hair: '#22d3ee',
    wireColor: '#f472b6',
  });
  const minaX = ANALOG_SHOP_POS.x + 2.4;
  const minaZ = ANALOG_SHOP_POS.z + 1.4;
  mina9.group.position.set(minaX, stationHeight(minaX, minaZ), minaZ);
  mina9.group.rotation.y = Math.PI / 2.2;
  root.add(mina9.group);
  npcs.push({
    id: 'mina-9',
    name: 'Mina-9',
    role: 'Analog Ghost Cassettes & CRTs',
    speciesLabel: 'Synth Future-Punk',
    shopId: 'analog',
    getPosition: () => mina9.group.position,
    getRoutine: (c) => getShopSchedule('analog', c.period).activity,
    lines: [
      'Step right up to my CRT stack — they auto-tune to Sector 9\'s stray frequencies. Channel 2 is literally the sky.',
      'I recorded forty minutes of dead-channel sky snow onto a chrome cassette at 88 BPM. Hid it right behind the north crate.',
      'Everyone thinks this corner is just one block of Neo-Tokyo. Truth is, the portals at either end are the only real exits.',
      'Rain makes the magnetic tape sing warmer. Honestly? I wouldn\'t trade this corner for an off-world colony.',
    ],
  });

  const baku = buildCharacterModel(res, {
    species: 'okami-hybrid',
    skin: '#d9b092',
    jacket: '#1e3a5f',
    accent: '#fbbf24',
    pants: '#1e293b',
    hair: '#94a3b8',
    wireColor: '#fbbf24',
  });
  const bakuX = CONBINI_POS.x - 2.3;
  const bakuZ = CONBINI_POS.z + 1.8;
  baku.group.position.set(bakuX, stationHeight(bakuX, bakuZ), bakuZ);
  baku.group.rotation.y = -Math.PI / 2.2;
  root.add(baku.group);
  npcs.push({
    id: 'baku',
    name: 'Baku',
    role: 'Gekko Mart 24H Night Clerk',
    speciesLabel: 'Okami Bio-Hybrid',
    shopId: 'conbini',
    getPosition: () => baku.group.position,
    getRoutine: (c) => getShopSchedule('conbini', c.period).activity,
    lines: [
      'Welcome to Gekko 24H! Step up to the glowing vending machines — hot matcha\'s free if you catch the hologram.',
      'Mochi-X is snoozing under my south awning again. Little bio-cat hates wet paws, loves neon heat lamps.',
      'Every time the rain stops and the static sky shows through, customers buy twice as many peach sodas. Calms the nerves.',
      'Wait by the glass shelter up north if you want to see the Line 09 Electro-Trolley roll in with its pantograph sparking!',
    ],
  });

  // -------------------------------------------------------------------------
  // 2. Seated Noodle Bar Patrons (blade runner counter bustle!)
  // -------------------------------------------------------------------------
  const seatedSpecs: Array<{ name: string; species: CharacterSpecies; speciesLabel: string; seatIdx: number; jacket: string; accent: string; hair: string; lines: string[] }> = [
    {
      name: 'Nyx',
      species: 'neko-hybrid',
      speciesLabel: 'Neko Bio-Hybrid',
      seatIdx: 1,
      jacket: '#1e1b4b',
      accent: '#38bdf8',
      hair: '#e2e8f0',
      lines: [
        'Best midnight ramen in Sector 9. You can sit right on the chrome stool next to me — Kenta serves fast.',
        'My cat whiskers tingle right before the Electro-Trolley rounds the corner.',
      ],
    },
    {
      name: 'Riku-4',
      species: 'usagi-hybrid',
      speciesLabel: 'Usagi Bio-Hybrid',
      seatIdx: 4,
      jacket: '#3f1d38',
      accent: '#5eead4',
      hair: '#fbcfe8',
      lines: [
        'I delivered packages on a gyro-scooter all shift. Nothing beats steaming broth while the neon drips.',
        'Don\'t follow the scooters past the crosswalk mist — past Block 32 you turn straight into wireframe triangles!',
      ],
    },
  ];
  const seatedRigs: CharacterRig[] = [];
  for (const s of seatedSpecs) {
    const rig = buildCharacterModel(res, {
      species: s.species,
      skin: '#eccab4',
      jacket: s.jacket,
      accent: s.accent,
      pants: '#0f172a',
      hair: s.hair,
      wireColor: s.accent,
    });
    rig.umbrella.visible = false;
    const sz = NOODLE_BAR_POS.z - 2.6 + s.seatIdx * 1.04;
    const sx = NOODLE_BAR_POS.x + 2.55;
    rig.group.position.set(sx, stationHeight(sx, sz) + 0.08, sz);
    rig.group.rotation.y = -Math.PI / 2;
    rig.leftLeg.rotation.x = -1.25;
    rig.rightLeg.rotation.x = -1.25;
    rig.leftArm.rotation.x = -0.8;
    rig.rightArm.rotation.x = -0.9;
    root.add(rig.group);
    seatedRigs.push(rig);
    npcs.push({
      id: `diner-${s.name.toLowerCase()}`,
      name: s.name,
      role: 'White Dragon Diner',
      speciesLabel: s.speciesLabel,
      getPosition: () => rig.group.position,
      getRoutine: () => 'Slurping hot noodles under the rain canopy',
      lines: s.lines,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Bus Stop Waiting Commuters (board the Electro-Punk Trolley & respawn!)
  // -------------------------------------------------------------------------
  interface Commuter {
    rig: CharacterRig;
    waitX: number;
    waitZ: number;
    state: 'WAITING' | 'BOARDING' | 'GONE' | 'ARRIVING';
    timer: number;
  }
  const commuters: Commuter[] = [
    {
      rig: buildCharacterModel(res, {
        species: 'usagi-hybrid',
        skin: '#f3d6c4',
        jacket: '#172554',
        accent: '#f472b6',
        pants: '#1e293b',
        hair: '#f8fafc',
        wireColor: '#f472b6',
      }),
      waitX: BUS_STOP_POS.x + 0.35,
      waitZ: BUS_STOP_POS.z - 0.85,
      state: 'WAITING',
      timer: 0,
    },
    {
      rig: buildCharacterModel(res, {
        species: 'future-punk',
        skin: '#d9ae90',
        jacket: '#1f2937',
        accent: '#34d399',
        pants: '#0f172a',
        hair: '#fde047',
        wireColor: '#34d399',
      }),
      waitX: BUS_STOP_POS.x + 0.35,
      waitZ: BUS_STOP_POS.z + 0.95,
      state: 'WAITING',
      timer: 0,
    },
  ];
  for (const c of commuters) {
    c.rig.group.position.set(c.waitX, stationHeight(c.waitX, c.waitZ), c.waitZ);
    c.rig.group.rotation.y = -Math.PI / 2;
    root.add(c.rig.group);
  }
  npcs.push({
    id: 'commuter-sora',
    name: 'Sora-7',
    role: 'Line 09 Trolley Commuter',
    speciesLabel: 'Usagi Bio-Hybrid',
    getPosition: () => commuters[0].rig.group.position,
    getRoutine: (_c, t) => (t.phase === 'BOARDING' ? 'Boarding the Electro-Punk Trolley!' : 'Waiting under the glass shelter for Line 09'),
    lines: [
      'Line 09 is rare, but it always rolls through sparking neon when you least expect it.',
      'Found a dropped Trolley Pass #404 on the bench here — it says the destination is "Beyond Block 32."',
      'Watch closely when the trolley leaves — the whole streetcar dissolves into glowing cyan polygons!',
    ],
  });

  // -------------------------------------------------------------------------
  // 4. 12 Ambient Strolling Street Pedestrians (Future-Punks & Bio-Hybrids)
  //    walking back & forth along both sidewalks and dissolving into polygons!
  // -------------------------------------------------------------------------
  interface Walker {
    rig: CharacterRig;
    x: number;
    z: number;
    dir: number; // +1 or -1 along Z
    speed: number;
    phase: number;
    name: string;
    speciesLabel: string;
    line: string;
  }
  const walkerPalettes: Array<CharacterPalette & { name: string; speciesLabel: string; line: string }> = [
    { species: 'future-punk', skin: '#e6be9e', jacket: '#1e293b', accent: '#22d3ee', pants: '#0f172a', hair: '#f43f5e', wireColor: '#22d3ee', name: 'Vex', speciesLabel: 'Future-Punk', line: 'Rain\'s warm tonight — good night for chrome boots and synth-bass.' },
    { species: 'kitsune-hybrid', skin: '#f3d1bc', jacket: '#31102f', accent: '#fb923c', pants: '#1e293b', hair: '#fb923c', wireColor: '#fb923c', name: 'Kiko', speciesLabel: 'Kitsune Bio-Hybrid', line: 'If you hear buzzing overhead, that\'s just the static sky bleeding through.' },
    { species: 'neko-hybrid', skin: '#e8c3ac', jacket: '#0f292e', accent: '#5eead4', pants: '#0f172a', hair: '#c084fc', wireColor: '#5eead4', name: 'Tama', speciesLabel: 'Neko Bio-Hybrid', line: 'Watch the edge of the street — everyone turns to polygons past the crosswalk!' },
    { species: 'okami-hybrid', skin: '#cfa488', jacket: '#27272a', accent: '#fde047', pants: '#18181b', hair: '#64748b', wireColor: '#fde047', name: 'Fen', speciesLabel: 'Okami Bio-Hybrid', line: 'Heading to White Dragon before Kenta sells out of spicy miso.' },
    { species: 'usagi-hybrid', skin: '#f4d8c8', jacket: '#1e1b4b', accent: '#f472b6', pants: '#1e293b', hair: '#e0f2fe', wireColor: '#f472b6', name: 'Yuki-B', speciesLabel: 'Usagi Bio-Hybrid', line: 'My bio-ears fold down automatically when the rain hits downpour mode.' },
    { species: 'future-punk', skin: '#d8ad8e', jacket: '#064e3b', accent: '#34d399', pants: '#0f172a', hair: '#38bdf8', wireColor: '#34d399', name: 'Zero', speciesLabel: 'Future-Punk', line: 'Saw a floating hologram koi swim right through the static cloud layer!' },
  ];

  const walkers: Walker[] = [];
  for (let i = 0; i < 12; i++) {
    const p = walkerPalettes[i % walkerPalettes.length];
    const rig = buildCharacterModel(res, p);
    const side = i % 2 === 0 ? -1 : 1;
    const laneX = side * (5.25 + (i % 3) * 0.45);
    const dir = (i % 4 < 2) ? -1 : 1;
    const z = -28 + (i / 12) * 56;
    rig.group.position.set(laneX, stationHeight(laneX, z), z);
    root.add(rig.group);
    walkers.push({
      rig,
      x: laneX,
      z,
      dir,
      speed: 1.55 + rand() * 0.9,
      phase: rand() * Math.PI * 2,
      name: p.name,
      speciesLabel: p.speciesLabel,
      line: p.line,
    });
    // Make first 4 walkers directly chatty too
    if (i < 4) {
      const wRef = walkers[i];
      npcs.push({
        id: `walker-${i}`,
        name: wRef.name,
        role: 'Sector 9 Passerby',
        speciesLabel: wRef.speciesLabel,
        getPosition: () => wRef.rig.group.position,
        getRoutine: (c) => (c.rainIntensity > 0.35 ? 'Hurrying through the neon rain' : 'Strolling under the static sky break'),
        lines: [wRef.line, 'Portal\'s open at either end of the street — safe travels across the loop.'],
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. Four Neo-Futuristic Cyber-Scooters zipping along the wet road!
  // -------------------------------------------------------------------------
  interface ScooterUnit {
    mesh: { group: THREE.Group; applyDissolve: (f: DissolveFactors) => void };
    x: number;
    z: number;
    dir: number;
    speed: number;
  }
  const scooters: ScooterUnit[] = [];
  const scooterPalettes: CharacterPalette[] = [
    { species: 'future-punk', skin: '#e6be9e', jacket: '#0f172a', accent: '#22d3ee', pants: '#1e293b', hair: '#f43f5e', wireColor: '#22d3ee' },
    { species: 'kitsune-hybrid', skin: '#f3d1bc', jacket: '#2e1065', accent: '#f472b6', pants: '#0f172a', hair: '#fb923c', wireColor: '#f472b6' },
    { species: 'neko-hybrid', skin: '#ecc6b0', jacket: '#083344', accent: '#fde047', pants: '#1e293b', hair: '#5eead4', wireColor: '#fde047' },
    { species: 'usagi-hybrid', skin: '#f4d8c8', jacket: '#3b0764', accent: '#34d399', pants: '#0f172a', hair: '#f8fafc', wireColor: '#34d399' },
  ];
  for (let i = 0; i < 4; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    const sx = dir < 0 ? SCOOTER_LANE_NORTH_X : SCOOTER_LANE_SOUTH_X;
    const sc = buildCyberScooter(res, scooterPalettes[i]);
    const sz = -30 + i * 16;
    sc.group.position.set(sx, 0, sz);
    sc.group.rotation.y = dir < 0 ? Math.PI : 0;
    root.add(sc.group);
    scooters.push({ mesh: sc, x: sx, z: sz, dir, speed: 6.2 + (i % 2) * 1.4 });
  }

  const update = (dt: number, elapsed: number, cycle: CycleSnapshot, trolley: TrolleyState) => {
    const safeDt = Math.min(dt, 0.1);
    const openUmbrellas = cycle.rainIntensity > 0.32;

    // 1. Shopkeepers' live schedule animations
    // Chef Kenta stirs wok & wipes counter energetically during rush
    const kentaSpeed = cycle.period === 'MIDNIGHT' || cycle.period === 'DUSK' ? 5.2 : 2.6;
    chefKenta.rightArm.rotation.x = -0.9 + Math.sin(elapsed * kentaSpeed) * 0.35;
    chefKenta.leftArm.rotation.x = -0.7 + Math.cos(elapsed * kentaSpeed * 0.8) * 0.2;
    chefKenta.group.position.z = NOODLE_BAR_POS.z + Math.sin(elapsed * 0.65) * 1.25;

    // Dr. Sable steps outside to inspect the calibration drone during rain breaks!
    const sableOut = openUmbrellas ? 0 : 0.75;
    drSable.group.position.x = sableBaseX - sableOut;
    drSable.umbrella.visible = openUmbrellas;
    if (drSable.tail) drSable.tail.rotation.y = Math.sin(elapsed * 2.5) * 0.32;
    drSable.rightArm.rotation.x = -0.45 + Math.sin(elapsed * 2.2) * 0.18;

    // Mina-9 bobs rhythmically to 88 BPM synth-tape beats
    const beat = Math.sin(elapsed * (88 / 60) * Math.PI * 2);
    mina9.group.position.y = stationHeight(minaX, minaZ) + Math.max(0, beat) * 0.04;
    mina9.umbrella.visible = openUmbrellas;
    mina9.leftArm.rotation.x = -0.5 + beat * 0.12;

    // Baku sweeps / paces gently outside Gekko Mart
    baku.group.position.z = bakuZ + Math.sin(elapsed * 0.55) * 1.1;
    baku.umbrella.visible = openUmbrellas;
    baku.rightArm.rotation.x = -0.6 + Math.sin(elapsed * 3.1) * 0.25;
    if (baku.tail) baku.tail.rotation.y = Math.sin(elapsed * 3.0) * 0.28;

    // Seated noodle patrons bob & swish tails
    seatedRigs.forEach((r, idx) => {
      r.rightArm.rotation.x = -0.95 + Math.sin(elapsed * 2.4 + idx) * 0.22;
      if (r.tail) r.tail.rotation.y = Math.sin(elapsed * 2.8 + idx) * 0.35;
    });

    // 2. Bus Stop Commuters boarding & alighting the Electro-Punk Trolley!
    commuters.forEach((c, idx) => {
      c.rig.umbrella.visible = openUmbrellas && c.state !== 'GONE';
      if (trolley.arrivedEvent && c.state === 'WAITING') {
        c.state = 'BOARDING';
      }
      if (trolley.departedEvent && c.state === 'BOARDING') {
        c.state = 'GONE';
        c.timer = 9 + idx * 5;
      }

      if (c.state === 'WAITING') {
        c.rig.group.visible = true;
        c.rig.group.position.set(c.waitX, stationHeight(c.waitX, c.waitZ), c.waitZ);
        c.rig.group.rotation.y = -Math.PI / 2;
        c.rig.leftLeg.rotation.x = 0;
        c.rig.rightLeg.rotation.x = 0;
        if (c.rig.tail) c.rig.tail.rotation.y = Math.sin(elapsed * 2.6 + idx) * 0.25;
      } else if (c.state === 'BOARDING') {
        // Walk from shelter straight into the open trolley doorway!
        const targetX = TROLLEY_TRACK_X + 0.6;
        const dx = targetX - c.rig.group.position.x;
        if (Math.abs(dx) > 0.15) {
          c.rig.group.position.x += Math.sign(dx) * safeDt * 1.8;
          c.rig.group.position.y = stationHeight(c.rig.group.position.x, c.rig.group.position.z);
          const stride = Math.sin(elapsed * 9.0 + idx) * 0.55;
          c.rig.leftLeg.rotation.x = stride;
          c.rig.rightLeg.rotation.x = -stride;
        } else {
          c.state = 'GONE';
          c.timer = 14 + idx * 6;
          c.rig.group.visible = false;
        }
      } else if (c.state === 'GONE') {
        c.rig.group.visible = false;
        c.timer -= safeDt;
        if (c.timer <= 0 && trolley.phase === 'OFFSCREEN') {
          // New passenger strolls back up to the bus stop out of the street mist!
          c.state = 'ARRIVING';
          c.rig.group.position.set(c.waitX, stationHeight(c.waitX, 24), 24);
          c.rig.group.visible = true;
        }
      } else if (c.state === 'ARRIVING') {
        const dz = c.waitZ - c.rig.group.position.z;
        if (Math.abs(dz) > 0.2) {
          c.rig.group.position.z += Math.sign(dz) * safeDt * 2.1;
          c.rig.group.position.y = stationHeight(c.rig.group.position.x, c.rig.group.position.z);
          c.rig.group.rotation.y = Math.PI;
          const stride = Math.sin(elapsed * 8.0 + idx) * 0.52;
          c.rig.leftLeg.rotation.x = stride;
          c.rig.rightLeg.rotation.x = -stride;
          c.rig.applyDissolve(computeDissolveFactors(c.rig.group.position.z));
        } else {
          c.state = 'WAITING';
          c.rig.applyDissolve({ solidOpacity: 1, wireOpacity: 0, visible: true });
        }
      }
    });

    // 3. Strolling Street Pedestrians (dissolving cleanly into glowing polygon meshes at street edges!)
    for (const w of walkers) {
      w.z += w.dir * w.speed * safeDt;
      if (w.z > 33.0) w.z = -33.0;
      if (w.z < -33.0) w.z = 33.0;

      w.rig.group.position.set(w.x, stationHeight(w.x, w.z), w.z);
      w.rig.group.rotation.y = w.dir > 0 ? 0 : Math.PI;
      const stride = Math.sin(elapsed * w.speed * 4.2 + w.phase) * 0.58;
      w.rig.leftLeg.rotation.x = stride;
      w.rig.rightLeg.rotation.x = -stride;
      w.rig.leftArm.rotation.x = -stride * 0.65;
      w.rig.rightArm.rotation.x = openUmbrellas ? -0.9 : stride * 0.65;
      w.rig.umbrella.visible = openUmbrellas;
      if (w.rig.tail) w.rig.tail.rotation.y = Math.sin(elapsed * 3.8 + w.phase) * 0.35;

      // Apply transparent glowing polygon-wireframe mesh dissolve near rendering edge!
      w.rig.applyDissolve(computeDissolveFactors(w.z));
    }

    // 4. Neo-Futuristic Scooters zipping through the street & dissolving into polygon meshes!
    for (const s of scooters) {
      s.z += s.dir * s.speed * safeDt;
      if (s.z > 33.5) s.z = -33.5;
      if (s.z < -33.5) s.z = 33.5;
      s.mesh.group.position.set(s.x, 0.02 + Math.sin(elapsed * 8.0 + s.x) * 0.015, s.z);
      s.mesh.applyDissolve(computeDissolveFactors(s.z));
    }
  };

  return { npcs, update };
}
