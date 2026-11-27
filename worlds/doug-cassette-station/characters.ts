import * as THREE from 'three/webgpu';
import { seededRandom } from '@portalverse/core/rooms/kit';
import {
  ANALOG_SHOP_POS,
  BUS_STOP_POS,
  CONBINI_POS,
  NOODLE_BAR_POS,
  OPTICS_SHOP_POS,
  SCOOTER_LANE_EAST_Z,
  SCOOTER_LANE_WEST_Z,
  TROLLEY_TRACK_Z,
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
import {
  createCurvedVisorGeo,
  createOrganicTailGeo,
  createScooterFairingGeo,
  createSculptedArmGeo,
  createSculptedHeadGeo,
  createSculptedLegGeo,
  createSculptedTorsoGeo,
  createStormCollarGeo,
} from './models';
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

/** Shared sculpted body geometries built once per mount for fast instanced-feel rendering. */
interface SharedCharGeos {
  head: THREE.BufferGeometry;
  neck: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  collar: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  visor: THREE.BufferGeometry;
  boot: THREE.BufferGeometry;
  foxTail: THREE.BufferGeometry;
  catTail: THREE.BufferGeometry;
  wolfTail: THREE.BufferGeometry;
  scooterFairing: THREE.BufferGeometry;
}

function createSharedGeos(res: ResourceBag): SharedCharGeos {
  return {
    head: res.geo(createSculptedHeadGeo()),
    neck: res.geo(new THREE.CylinderGeometry(0.055, 0.068, 0.14, 10)),
    torso: res.geo(createSculptedTorsoGeo()),
    collar: res.geo(createStormCollarGeo()),
    leg: res.geo(createSculptedLegGeo()),
    arm: res.geo(createSculptedArmGeo()),
    visor: res.geo(createCurvedVisorGeo()),
    boot: res.geo(new THREE.BoxGeometry(0.13, 0.13, 0.26)),
    foxTail: res.geo(createOrganicTailGeo(0.76, 0.12, 0.9)),
    catTail: res.geo(createOrganicTailGeo(0.68, 0.048, 1.2)),
    wolfTail: res.geo(createOrganicTailGeo(0.58, 0.105, 0.5)),
    scooterFairing: res.geo(createScooterFairingGeo()),
  };
}

/**
 * Builds a life-like, anatomically sculpted Cyberpunk Future-Punk or Bio-Engineered Animal-Hybrid
 * using smooth-shaded LatheGeometry anatomy, tailored storm-collar coat, curved LED visor,
 * sculpted species ears & organic TubeGeometry curved tails, ribbed translucent umbrella,
 * and a dual-layer glowing triangulated polygon-wireframe dissolve shell!
 */
export function buildCharacterModel(
  res: ResourceBag,
  geos: SharedCharGeos,
  palette: CharacterPalette,
): CharacterRig {
  const group = new THREE.Group();
  const solidMats: THREE.Material[] = [];
  const wireMats: THREE.MeshBasicMaterial[] = [];

  const registerMat = <T extends THREE.Material>(m: T): T => {
    m.transparent = true;
    solidMats.push(m);
    return res.mat(m);
  };

  const skinMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.65 }));
  const jacketMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.jacket, roughness: 0.48, metalness: 0.18 }));
  const accentMat = registerMat(new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 1.75,
    roughness: 0.22,
  }));
  const pantsMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.pants, roughness: 0.72 }));
  const hairMat = registerMat(new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.58 }));
  const innerEarMat = registerMat(new THREE.MeshStandardMaterial({ color: '#fda4af', roughness: 0.72 }));
  const chromeMat = registerMat(new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.9, roughness: 0.18 }));

  const addDualPart = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number],
    scale?: [number, number, number],
  ) => {
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
    wm.scale.copy(m.scale).multiplyScalar(1.028);
    parent.add(wm);
    wireMats.push(wMat);
    return m;
  };

  // Sculpted Anatomical Torso + Tailored Storm Collar + Belt + Glowing Lapels & Tech Pack
  addDualPart(group, geos.torso, jacketMat, [0, 1.13, 0]);
  addDualPart(group, geos.collar, jacketMat, [0, 1.38, -0.01]);
  addDualPart(group, res.geo(new THREE.TorusGeometry(0.165, 0.018, 6, 16).rotateX(Math.PI / 2)), accentMat, [0, 1.49, -0.01]);
  addDualPart(group, res.geo(new THREE.CylinderGeometry(0.168, 0.168, 0.055, 14)), chromeMat, [0, 0.96, 0], undefined, [1.08, 1, 0.7]);
  addDualPart(group, res.geo(new THREE.BoxGeometry(0.22, 0.3, 0.12)), jacketMat, [0, 1.18, -0.17]);
  addDualPart(group, res.geo(new THREE.BoxGeometry(0.18, 0.05, 0.13)), accentMat, [0, 1.24, -0.18]);

  // Sculpted Neck + Anatomical Head + Curved Wrap-Around LED Visor
  addDualPart(group, geos.neck, skinMat, [0, 1.46, 0]);
  addDualPart(group, geos.head, skinMat, [0, 1.62, 0.01]);
  addDualPart(group, geos.visor, accentMat, [0, 1.64, 0.02]);

  // Sculpted Articulated Legs + Cyber Platform Boots with Neon Sole Trim
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.11, 0.85, 0);
  addDualPart(leftLeg, geos.leg, pantsMat, [0, 0, 0]);
  addDualPart(leftLeg, geos.boot, jacketMat, [0, -0.78, 0.04]);
  addDualPart(leftLeg, res.geo(new THREE.BoxGeometry(0.135, 0.032, 0.265)), accentMat, [0, -0.83, 0.04]);
  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.11, 0.85, 0);
  addDualPart(rightLeg, geos.leg, pantsMat, [0, 0, 0]);
  addDualPart(rightLeg, geos.boot, jacketMat, [0, -0.78, 0.04]);
  addDualPart(rightLeg, res.geo(new THREE.BoxGeometry(0.135, 0.032, 0.265)), accentMat, [0, -0.83, 0.04]);
  group.add(leftLeg, rightLeg);

  // Sculpted Articulated Arms (Future-Punks sport a gleaming articulated chrome cyber-arm + wrist ring!)
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.27, 1.36, 0);
  addDualPart(leftArm, geos.arm, jacketMat, [0, 0, 0]);
  const rightArm = new THREE.Group();
  rightArm.position.set(0.27, 1.36, 0);
  addDualPart(rightArm, geos.arm, palette.species === 'future-punk' ? chromeMat : jacketMat, [0, 0, 0]);
  if (palette.species === 'future-punk') {
    addDualPart(rightArm, res.geo(new THREE.TorusGeometry(0.052, 0.014, 6, 12).rotateX(Math.PI / 2)), accentMat, [0, -0.45, 0]);
  }
  group.add(leftArm, rightArm);

  // Sculpted Species Hair, Ears & Organic Curved Tails!
  let tail: THREE.Mesh | null = null;
  if (palette.species === 'future-punk') {
    // Layered swept cyber-mohawk crest
    for (let s = 0; s < 5; s++) {
      addDualPart(
        group,
        res.geo(new THREE.ConeGeometry(0.048, 0.22 - s * 0.014, 6)),
        s % 2 === 0 ? accentMat : hairMat,
        [0, 1.81 - s * 0.018, 0.08 - s * 0.058],
        [-0.35 + s * 0.16, 0, 0],
      );
    }
  } else if (palette.species === 'kitsune-hybrid') {
    // Sculpted tufted fox ears with inner pinna + sinuous curved fox tail
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.068, 0.28, 7)), hairMat, [-0.1, 1.84, 0.01], [0.08, 0, 0.24]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.036, 0.18, 5)), innerEarMat, [-0.1, 1.82, 0.035], [0.08, 0, 0.24]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.068, 0.28, 7)), hairMat, [0.1, 1.84, 0.01], [0.08, 0, -0.24]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.036, 0.18, 5)), innerEarMat, [0.1, 1.82, 0.035], [0.08, 0, -0.24]);
    tail = addDualPart(group, geos.foxTail, hairMat, [0, 0.88, -0.14]);
  } else if (palette.species === 'neko-hybrid') {
    // Perky sculpted cat ears + glowing choker bell + graceful S-curved feline tail
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.058, 0.19, 6)), hairMat, [-0.1, 1.8, 0.02], [0.12, 0, 0.3]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.032, 0.13, 5)), innerEarMat, [-0.1, 1.79, 0.04], [0.12, 0, 0.3]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.058, 0.19, 6)), hairMat, [0.1, 1.8, 0.02], [0.12, 0, -0.3]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.032, 0.13, 5)), innerEarMat, [0.1, 1.79, 0.04], [0.12, 0, -0.3]);
    tail = addDualPart(group, geos.catTail, hairMat, [0, 0.88, -0.14]);
  } else if (palette.species === 'okami-hybrid') {
    // Tall wolf ears + tactical courier straps + thick curved wolf tail
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.064, 0.24, 6)), hairMat, [-0.1, 1.82, 0.0], [-0.06, 0, 0.16]);
    addDualPart(group, res.geo(new THREE.ConeGeometry(0.064, 0.24, 6)), hairMat, [0.1, 1.82, 0.0], [-0.06, 0, -0.16]);
    tail = addDualPart(group, geos.wolfTail, hairMat, [0, 0.88, -0.14]);
  } else {
    // Usagi bio-hybrid: articulated long sculpted bunny ears (one playfully cocked!) + cotton tail
    addDualPart(group, res.geo(new THREE.CapsuleGeometry(0.038, 0.34, 5, 8)), hairMat, [-0.085, 1.97, 0], [-0.1, 0, 0.16]);
    addDualPart(group, res.geo(new THREE.CapsuleGeometry(0.038, 0.34, 5, 8)), hairMat, [0.095, 1.95, 0.03], [0.22, 0, -0.26]);
    tail = addDualPart(group, res.geo(new THREE.SphereGeometry(0.11, 10, 8)), hairMat, [0, 0.86, -0.18]);
  }

  // Translucent Ribbed Neon Umbrella (with metallic shaft, ribs & glowing rim ring!)
  const umbrella = new THREE.Group();
  const umbShaft = new THREE.Mesh(res.geo(new THREE.CylinderGeometry(0.013, 0.013, 0.94, 6)), chromeMat);
  umbShaft.position.y = 0.47;
  const umbDomeMat = registerMat(new THREE.MeshStandardMaterial({
    color: palette.accent,
    emissive: palette.accent,
    emissiveIntensity: 0.45,
    roughness: 0.12,
    side: THREE.DoubleSide,
  }));
  const umbDome = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.64, 0.24, 12, 1, true)), umbDomeMat);
  umbDome.position.y = 0.86;
  const umbRim = new THREE.Mesh(res.geo(new THREE.TorusGeometry(0.635, 0.012, 5, 16).rotateX(Math.PI / 2)), accentMat);
  umbRim.position.y = 0.74;
  umbrella.add(umbShaft, umbDome, umbRim);
  umbrella.position.set(0.32, 1.14, 0.16);
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
        m.opacity = m === umbDomeMat ? f.solidOpacity * 0.38 : f.solidOpacity;
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
 * Builds an Akira-inspired Sculpted Neo-Futuristic Cyber-Scooter (oriented forward along +X
 * for the perpendicular East–West boulevard!), complete with curved monocoque fairing,
 * hubless glowing gyro-wheels, telescopic front fork, handlebars, volumetric headlight cone,
 * courier tail box, seated leaning rider, and matching polygon-wireframe dissolve!
 */
export function buildCyberScooter(
  res: ResourceBag,
  geos: SharedCharGeos,
  riderPalette: CharacterPalette,
): {
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
  const bodyMat = reg(new THREE.MeshStandardMaterial({ color: '#182235', roughness: 0.24, metalness: 0.82 }));
  const tireMat = reg(new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.85 }));
  const chromeMat = reg(new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.2, metalness: 0.9 }));
  const neonMat = reg(new THREE.MeshStandardMaterial({ color: riderPalette.accent, emissive: riderPalette.accent, emissiveIntensity: 2.3 }));
  const tailMat = reg(new THREE.MeshStandardMaterial({ color: '#f43f5e', emissive: '#e11d48', emissiveIntensity: 2.3 }));
  const beamMat = res.mat(new THREE.MeshBasicMaterial({
    color: riderPalette.accent,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));

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

  // Sculpted curved monocoque fairing (points forward along +X!)
  addPart(geos.scooterFairing, bodyMat, [0, 0.04, 0]);
  // Telescopic chrome front fork & handlebars
  addPart(res.geo(new THREE.CylinderGeometry(0.032, 0.028, 0.72, 8)), chromeMat, [0.7, 0.56, 0.14], [0, 0, 0.34]);
  addPart(res.geo(new THREE.CylinderGeometry(0.032, 0.028, 0.72, 8)), chromeMat, [0.7, 0.56, -0.14], [0, 0, 0.34]);
  addPart(res.geo(new THREE.CylinderGeometry(0.024, 0.024, 0.68, 8).rotateX(Math.PI / 2)), chromeMat, [0.54, 0.94, 0]);
  // Hubless thick rubber tires + inner glowing neon gyro rims!
  const tireGeo = res.geo(new THREE.TorusGeometry(0.28, 0.085, 10, 20));
  const rimGeo = res.geo(new THREE.TorusGeometry(0.21, 0.028, 8, 20));
  for (const wx of [0.84, -0.76]) {
    addPart(tireGeo, tireMat, [wx, 0.32, 0]);
    addPart(rimGeo, neonMat, [wx, 0.32, 0]);
  }
  // Headlight bar + volumetric road beam + red LED tail strip + compact rear courier box
  addPart(res.geo(new THREE.BoxGeometry(0.12, 0.1, 0.44)), neonMat, [0.94, 0.58, 0]);
  addPart(res.geo(new THREE.BoxGeometry(0.1, 0.1, 0.42)), tailMat, [-0.9, 0.62, 0]);
  addPart(res.geo(new THREE.BoxGeometry(0.38, 0.34, 0.44)), bodyMat, [-0.66, 0.88, 0]);
  const beam = new THREE.Mesh(res.geo(new THREE.ConeGeometry(0.68, 3.6, 12, 1, true).rotateZ(Math.PI / 2)), beamMat);
  beam.position.set(2.7, 0.42, 0);
  group.add(beam);

  // Seated cyber-rider rotated to face +X, leaning smoothly into the handlebars
  const rider = buildCharacterModel(res, geos, riderPalette);
  rider.umbrella.visible = false;
  rider.group.rotation.y = Math.PI / 2;
  rider.group.position.set(-0.08, 0.16, 0);
  rider.leftLeg.rotation.x = -0.92;
  rider.rightLeg.rotation.x = -0.92;
  rider.leftArm.rotation.x = -1.02;
  rider.rightArm.rotation.x = -1.02;
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
      beamMat.opacity = f.solidOpacity * 0.14;
      rider.applyDissolve(f);
    },
  };
}

// ---------------------------------------------------------------------------
// Living Street Population: 4-Corner Shopkeepers, Diners, Bus-Stop Commuters,
// Perpendicular E-W & N-S Strolling Pedestrians, and Perpendicular Cyber-Scooters!
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
  const geos = createSharedGeos(res);
  const npcs: TalkableNpc[] = [];

  // 1. Named Shopkeepers Attached to Each Corner Shop
  const chefKenta = buildCharacterModel(res, geos, {
    species: 'future-punk',
    skin: '#e0b899',
    jacket: '#f8fafc',
    accent: '#ef4444',
    pants: '#1e293b',
    hair: '#334155',
    wireColor: '#fb7185',
  });
  chefKenta.umbrella.visible = false;
  chefKenta.group.position.set(NOODLE_BAR_POS.x + 0.85, stationHeight(NOODLE_BAR_POS.x, NOODLE_BAR_POS.z), NOODLE_BAR_POS.z);
  chefKenta.group.rotation.y = Math.PI / 2;
  root.add(chefKenta.group);
  npcs.push({
    id: 'chef-kenta',
    name: 'Chef Kenta',
    role: 'White Dragon Noodle Bar',
    speciesLabel: 'Cyborg Chef',
    shopId: 'noodles',
    getPosition: () => ({ x: NOODLE_BAR_POS.x + 2.5, y: 0.14, z: NOODLE_BAR_POS.z }),
    getRoutine: (c) => getShopSchedule('noodles', c.period).activity,
    lines: [
      'He say you Brade Runna! Sit down, eat — two! Two! Four! Hot miso cuts right through the acid rain.',
      'Watch the Line 09 Electro-Trolley cross the boulevard right out front — past Block 32 it turns straight into glowing polygons.',
      'Someone left a silver foil origami unicorn by my corner stool earlier. Keep your eyes open, traveler.',
      'When the rain breaks, look straight up. That ain\'t clouds behind the smog — that\'s a dead television channel.',
    ],
  });

  const drSable = buildCharacterModel(res, geos, {
    species: 'kitsune-hybrid',
    skin: '#f1d2be',
    jacket: '#0f172a',
    accent: '#22d3ee',
    pants: '#1e293b',
    hair: '#f97316',
    wireColor: '#22d3ee',
  });
  const sableBaseX = OPTICS_SHOP_POS.x - 2.15;
  const sableBaseZ = OPTICS_SHOP_POS.z + 0.6;
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
      'I tested a customer\'s baseline outside with my Voight scanner earlier. Left it humming near the NE clinic steps.',
      'Bio-hybrids run half this district now. Better night vision than baseline humans, and our ears double as rain antennas.',
    ],
  });

  const mina9 = buildCharacterModel(res, geos, {
    species: 'future-punk',
    skin: '#e8c4b0',
    jacket: '#3b0764',
    accent: '#f472b6',
    pants: '#0f172a',
    hair: '#22d3ee',
    wireColor: '#f472b6',
  });
  const minaX = ANALOG_SHOP_POS.x + 2.4;
  const minaZ = ANALOG_SHOP_POS.z - 1.2;
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
      'I recorded forty minutes of dead-channel sky snow onto a chrome cassette at 88 BPM. Hid it right behind the south crate.',
      'Look east and west down the boulevard — scooters and trolleys materialize right out of polygon wireframes.',
      'Rain makes magnetic tape sing warmer. Honestly? I wouldn\'t trade this corner for an off-world colony.',
    ],
  });

  const baku = buildCharacterModel(res, geos, {
    species: 'okami-hybrid',
    skin: '#d9b092',
    jacket: '#1e3a5f',
    accent: '#fbbf24',
    pants: '#1e293b',
    hair: '#94a3b8',
    wireColor: '#fbbf24',
  });
  const bakuX = CONBINI_POS.x - 2.35;
  const bakuZ = CONBINI_POS.z - 1.4;
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
      'Cross the Shibuya crosswalk north to grab noodles at White Dragon or watch the Line 09 Electro-Trolley roll through!',
      'Every time the rain stops and the static sky shows through, customers buy twice as many peach sodas. Calms the nerves.',
    ],
  });

  // 2. Seated Noodle Bar Patrons at White Dragon
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
        'My cat whiskers tingle right before the Electro-Trolley glides across the crosswalk.',
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
        'I delivered packages on a gyro-scooter up and down the East–West boulevard all shift. Nothing beats hot broth!',
        'Watch the boulevard edges — past Block 32 every rider dissolves straight into glowing wireframe triangles!',
      ],
    },
  ];
  const seatedRigs: CharacterRig[] = [];
  for (const s of seatedSpecs) {
    const rig = buildCharacterModel(res, geos, {
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
    const sx = NOODLE_BAR_POS.x + 2.68;
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

  // 3. NE Bus Stop Waiting Commuters (step South into the perpendicular East–West Electro-Punk Trolley!)
  interface Commuter {
    rig: CharacterRig;
    waitX: number;
    waitZ: number;
    state: 'WAITING' | 'BOARDING' | 'GONE' | 'ARRIVING';
    timer: number;
  }
  const commuters: Commuter[] = [
    {
      rig: buildCharacterModel(res, geos, {
        species: 'usagi-hybrid',
        skin: '#f3d6c4',
        jacket: '#172554',
        accent: '#f472b6',
        pants: '#1e293b',
        hair: '#f8fafc',
        wireColor: '#f472b6',
      }),
      waitX: BUS_STOP_POS.x - 0.9,
      waitZ: BUS_STOP_POS.z + 0.35,
      state: 'WAITING',
      timer: 0,
    },
    {
      rig: buildCharacterModel(res, geos, {
        species: 'future-punk',
        skin: '#d9ae90',
        jacket: '#1f2937',
        accent: '#34d399',
        pants: '#0f172a',
        hair: '#fde047',
        wireColor: '#34d399',
      }),
      waitX: BUS_STOP_POS.x + 1.1,
      waitZ: BUS_STOP_POS.z + 0.35,
      state: 'WAITING',
      timer: 0,
    },
  ];
  for (const c of commuters) {
    c.rig.group.position.set(c.waitX, stationHeight(c.waitX, c.waitZ), c.waitZ);
    c.rig.group.rotation.y = 0; // facing +Z toward the perpendicular tram rails!
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
      'Line 09 rolls right across the avenue sparking cyan whenever it comes through.',
      'Found a dropped Trolley Pass #404 on the bench here — stamped "Destination: Beyond Block 32."',
      'Watch closely when the trolley leaves westward — the whole streetcar dissolves into glowing cyan polygons!',
    ],
  });

  // 4. 14 Strolling Street Pedestrians (8 along the perpendicular East–West boulevard sidewalks + 6 along the N–S alley!)
  interface Walker {
    rig: CharacterRig;
    axis: 'x' | 'z';
    lane: number;
    pos: number;
    dir: number;
    speed: number;
    phase: number;
    name: string;
    speciesLabel: string;
    line: string;
  }
  const walkerPalettes: Array<CharacterPalette & { name: string; speciesLabel: string; line: string }> = [
    { species: 'future-punk', skin: '#e6be9e', jacket: '#1e293b', accent: '#22d3ee', pants: '#0f172a', hair: '#f43f5e', wireColor: '#22d3ee', name: 'Vex', speciesLabel: 'Future-Punk', line: 'Rain\'s warm tonight — good night for chrome boots and synth-bass.' },
    { species: 'kitsune-hybrid', skin: '#f3d1bc', jacket: '#31102f', accent: '#fb923c', pants: '#1e293b', hair: '#fb923c', wireColor: '#fb923c', name: 'Kiko', speciesLabel: 'Kitsune Bio-Hybrid', line: 'If you hear buzzing overhead, that\'s just the static sky bleeding through.' },
    { species: 'neko-hybrid', skin: '#e8c3ac', jacket: '#0f292e', accent: '#5eead4', pants: '#0f172a', hair: '#c084fc', wireColor: '#5eead4', name: 'Tama', speciesLabel: 'Neko Bio-Hybrid', line: 'Watch the edge of the boulevard — everyone turns to polygons past the towers!' },
    { species: 'okami-hybrid', skin: '#cfa488', jacket: '#27272a', accent: '#fde047', pants: '#18181b', hair: '#64748b', wireColor: '#fde047', name: 'Fen', speciesLabel: 'Okami Bio-Hybrid', line: 'Heading to White Dragon before Kenta sells out of spicy miso.' },
    { species: 'usagi-hybrid', skin: '#f4d8c8', jacket: '#1e1b4b', accent: '#f472b6', pants: '#1e293b', hair: '#e0f2fe', wireColor: '#f472b6', name: 'Yuki-B', speciesLabel: 'Usagi Bio-Hybrid', line: 'My bio-ears fold back automatically when the rain hits downpour mode.' },
    { species: 'future-punk', skin: '#d8ad8e', jacket: '#064e3b', accent: '#34d399', pants: '#0f172a', hair: '#38bdf8', wireColor: '#34d399', name: 'Zero', speciesLabel: 'Future-Punk', line: 'Saw a holographic koi swim straight through the static cloud layer!' },
  ];

  const walkers: Walker[] = [];
  for (let i = 0; i < 14; i++) {
    const p = walkerPalettes[i % walkerPalettes.length];
    const rig = buildCharacterModel(res, geos, p);
    const axis: 'x' | 'z' = i < 8 ? 'x' : 'z';
    const side = i % 2 === 0 ? -1 : 1;
    const lane = axis === 'x' ? side * (6.75 + (i % 3) * 0.45) : side * (4.15 + (i % 2) * 0.45);
    const dir = i % 4 < 2 ? -1 : 1;
    const pos = -28 + (i / 14) * 56;
    const wx = axis === 'x' ? pos : lane;
    const wz = axis === 'x' ? lane : pos;
    rig.group.position.set(wx, stationHeight(wx, wz), wz);
    root.add(rig.group);
    walkers.push({
      rig,
      axis,
      lane,
      pos,
      dir,
      speed: 1.55 + rand() * 0.9,
      phase: rand() * Math.PI * 2,
      name: p.name,
      speciesLabel: p.speciesLabel,
      line: p.line,
    });
    if (i < 4) {
      const wRef = walkers[i];
      npcs.push({
        id: `walker-${i}`,
        name: wRef.name,
        role: 'Sector 9 Passerby',
        speciesLabel: wRef.speciesLabel,
        getPosition: () => wRef.rig.group.position,
        getRoutine: (c) => (c.rainIntensity > 0.35 ? 'Hurrying along the rainy boulevard' : 'Strolling under the static sky break'),
        lines: [wRef.line, 'Portal\'s open at either end of the pedestrian avenue — safe travels across the loop.'],
      });
    }
  }

  // 5. Six Neo-Futuristic Cyber-Scooters cruising PERPENDICULAR East <-> West across the boulevard!
  interface ScooterUnit {
    mesh: { group: THREE.Group; applyDissolve: (f: DissolveFactors) => void };
    x: number;
    z: number;
    dir: number; // +1 = Eastbound (+X), -1 = Westbound (-X)
    speed: number;
  }
  const scooters: ScooterUnit[] = [];
  const scooterPalettes: CharacterPalette[] = [
    { species: 'future-punk', skin: '#e6be9e', jacket: '#0f172a', accent: '#22d3ee', pants: '#1e293b', hair: '#f43f5e', wireColor: '#22d3ee' },
    { species: 'kitsune-hybrid', skin: '#f3d1bc', jacket: '#2e1065', accent: '#f472b6', pants: '#0f172a', hair: '#fb923c', wireColor: '#f472b6' },
    { species: 'neko-hybrid', skin: '#ecc6b0', jacket: '#083344', accent: '#fde047', pants: '#1e293b', hair: '#5eead4', wireColor: '#fde047' },
    { species: 'usagi-hybrid', skin: '#f4d8c8', jacket: '#3b0764', accent: '#34d399', pants: '#0f172a', hair: '#f8fafc', wireColor: '#34d399' },
    { species: 'okami-hybrid', skin: '#cfa488', jacket: '#1f2937', accent: '#fb923c', pants: '#0f172a', hair: '#94a3b8', wireColor: '#fb923c' },
    { species: 'future-punk', skin: '#e6be9e', jacket: '#172554', accent: '#38bdf8', pants: '#0f172a', hair: '#f472b6', wireColor: '#38bdf8' },
  ];
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 === 0 ? -1 : 1;
    const sz = dir < 0 ? SCOOTER_LANE_WEST_Z : SCOOTER_LANE_EAST_Z;
    const sc = buildCyberScooter(res, geos, scooterPalettes[i]);
    const sx = -31 + i * 11;
    sc.group.position.set(sx, 0, sz);
    sc.group.rotation.y = dir > 0 ? 0 : Math.PI; // forward nose along +X or -X!
    root.add(sc.group);
    scooters.push({ mesh: sc, x: sx, z: sz, dir, speed: 6.4 + (i % 3) * 1.15 });
  }

  const update = (dt: number, elapsed: number, cycle: CycleSnapshot, trolley: TrolleyState) => {
    const safeDt = Math.min(dt, 0.1);
    const openUmbrellas = cycle.rainIntensity > 0.32;

    // 1. Shopkeepers' scheduled animations
    const kentaSpeed = cycle.period === 'MIDNIGHT' || cycle.period === 'DUSK' ? 5.2 : 2.6;
    chefKenta.rightArm.rotation.x = -0.9 + Math.sin(elapsed * kentaSpeed) * 0.35;
    chefKenta.leftArm.rotation.x = -0.7 + Math.cos(elapsed * kentaSpeed * 0.8) * 0.2;
    chefKenta.group.position.z = NOODLE_BAR_POS.z + Math.sin(elapsed * 0.65) * 1.25;

    const sableOut = openUmbrellas ? 0 : 0.75;
    drSable.group.position.x = sableBaseX - sableOut;
    drSable.umbrella.visible = openUmbrellas;
    if (drSable.tail) drSable.tail.rotation.y = Math.sin(elapsed * 2.5) * 0.32;
    drSable.rightArm.rotation.x = -0.45 + Math.sin(elapsed * 2.2) * 0.18;

    const beat = Math.sin(elapsed * (88 / 60) * Math.PI * 2);
    mina9.group.position.y = stationHeight(minaX, minaZ) + Math.max(0, beat) * 0.04;
    mina9.umbrella.visible = openUmbrellas;
    mina9.leftArm.rotation.x = -0.5 + beat * 0.12;

    baku.group.position.z = bakuZ + Math.sin(elapsed * 0.55) * 1.1;
    baku.umbrella.visible = openUmbrellas;
    baku.rightArm.rotation.x = -0.6 + Math.sin(elapsed * 3.1) * 0.25;
    if (baku.tail) baku.tail.rotation.y = Math.sin(elapsed * 3.0) * 0.28;

    seatedRigs.forEach((r, idx) => {
      r.rightArm.rotation.x = -0.95 + Math.sin(elapsed * 2.4 + idx) * 0.22;
      if (r.tail) r.tail.rotation.y = Math.sin(elapsed * 2.8 + idx) * 0.35;
    });

    // 2. Bus Stop Commuters stepping South (+Z) into the open perpendicular Electro-Punk Trolley!
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
        c.rig.group.rotation.y = 0;
        c.rig.leftLeg.rotation.x = 0;
        c.rig.rightLeg.rotation.x = 0;
        if (c.rig.tail) c.rig.tail.rotation.y = Math.sin(elapsed * 2.6 + idx) * 0.25;
      } else if (c.state === 'BOARDING') {
        const targetZ = TROLLEY_TRACK_Z - 0.5;
        const dz = targetZ - c.rig.group.position.z;
        if (Math.abs(dz) > 0.15) {
          c.rig.group.position.z += Math.sign(dz) * safeDt * 1.8;
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
          c.state = 'ARRIVING';
          c.rig.group.position.set(25, stationHeight(25, c.waitZ), c.waitZ);
          c.rig.group.visible = true;
        }
      } else if (c.state === 'ARRIVING') {
        const dx = c.waitX - c.rig.group.position.x;
        if (Math.abs(dx) > 0.2) {
          c.rig.group.position.x += Math.sign(dx) * safeDt * 2.1;
          c.rig.group.position.y = stationHeight(c.rig.group.position.x, c.rig.group.position.z);
          c.rig.group.rotation.y = -Math.PI / 2;
          const stride = Math.sin(elapsed * 8.0 + idx) * 0.52;
          c.rig.leftLeg.rotation.x = stride;
          c.rig.rightLeg.rotation.x = -stride;
          c.rig.applyDissolve(computeDissolveFactors(c.rig.group.position.x));
        } else {
          c.state = 'WAITING';
          c.rig.applyDissolve({ solidOpacity: 1, wireOpacity: 0, visible: true });
        }
      }
    });

    // 3. Strolling Pedestrians along BOTH the East–West Boulevard & North–South Pedestrian Alley
    for (const w of walkers) {
      w.pos += w.dir * w.speed * safeDt;
      if (w.pos > 33.2) w.pos = -33.2;
      if (w.pos < -33.2) w.pos = 33.2;

      const wx = w.axis === 'x' ? w.pos : w.lane;
      const wz = w.axis === 'x' ? w.lane : w.pos;
      w.rig.group.position.set(wx, stationHeight(wx, wz), wz);
      w.rig.group.rotation.y = w.axis === 'x'
        ? (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2)
        : (w.dir > 0 ? 0 : Math.PI);

      const stride = Math.sin(elapsed * w.speed * 4.2 + w.phase) * 0.58;
      w.rig.leftLeg.rotation.x = stride;
      w.rig.rightLeg.rotation.x = -stride;
      w.rig.leftArm.rotation.x = -stride * 0.65;
      w.rig.rightArm.rotation.x = openUmbrellas ? -0.9 : stride * 0.65;
      w.rig.umbrella.visible = openUmbrellas;
      if (w.rig.tail) w.rig.tail.rotation.y = Math.sin(elapsed * 3.8 + w.phase) * 0.35;

      // Smoothly dissolve into glowing translucent polygon wireframe near rendering edge!
      w.rig.applyDissolve(computeDissolveFactors(w.pos));
    }

    // 4. Perpendicular East <-> West Neo-Futuristic Scooters dissolving into polygon meshes at |x| > 18.5 m!
    for (const s of scooters) {
      s.x += s.dir * s.speed * safeDt;
      if (s.x > 33.8) s.x = -33.8;
      if (s.x < -33.8) s.x = 33.8;
      s.mesh.group.position.set(s.x, 0.02 + Math.sin(elapsed * 8.0 + s.z) * 0.014, s.z);
      s.mesh.applyDissolve(computeDissolveFactors(s.x));
    }
  };

  return { npcs, update };
}
