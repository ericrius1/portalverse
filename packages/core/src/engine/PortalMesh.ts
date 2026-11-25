import * as THREE from 'three/webgpu';
import type { PortalDefinition, PortalVisualHandle } from '../types';
import {
  createEnergyRingMaterial,
  createMagicFountainPlumeMaterial,
  createPortalVortexMaterial,
} from '../shaders/portalShaders';
import { createBloomingPetalMaterial } from '../shaders/meadowShaders';
import { createFloatingLabel } from './signage';

/**
 * Classic glowing starlight archway portal (used inside Eric's Room, JP's Room,
 * dynamically spawned portals, and the Nexus hub style).
 */
export function createArchwayPortal(portal: PortalDefinition): PortalVisualHandle {
  const group = new THREE.Group();
  group.position.set(portal.position[0], portal.position[1], portal.position[2]);
  group.rotation.y = portal.yaw ?? 0;

  const colorA = portal.colorA ?? '#22d3ee';
  const colorB = portal.colorB ?? '#a855f7';

  // Sculpted outer portal frame
  const outerRingGeo = new THREE.TorusGeometry(1.95, 0.16, 20, 64);
  const { material: ringMat, hover: ringHover } = createEnergyRingMaterial(colorA, colorB);
  const outerRing = new THREE.Mesh(outerRingGeo, ringMat);
  outerRing.position.y = 2.25;
  group.add(outerRing);

  // Secondary rotating inner halo
  const haloGeo = new THREE.TorusGeometry(2.24, 0.045, 12, 64);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorA),
    transparent: true,
    opacity: 0.72,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = 2.25;
  group.add(halo);

  // Pedestal base
  const baseGeo = new THREE.CylinderGeometry(2.15, 2.55, 0.28, 32);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.35,
    metalness: 0.7,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.14;
  group.add(base);

  // Swirling WebGPU TSL portal vortex disk
  const vortexGeo = new THREE.CircleGeometry(1.86, 48);
  const { material: vortexMat, uniforms: vortexUniforms } = createPortalVortexMaterial(colorA, colorB);
  const vortex = new THREE.Mesh(vortexGeo, vortexMat);
  vortex.position.y = 2.25;
  vortex.userData.portalId = portal.id;
  group.add(vortex);

  // Soft local point light
  const light = new THREE.PointLight(new THREE.Color(colorA), 3.2, 12, 1.5);
  light.position.set(0, 2.25, 0.8);
  group.add(light);

  // Floating destination sign
  const label = createFloatingLabel({
    title: portal.label,
    subtitle: portal.subtitle ?? (portal.remoteUrl ? 'Federated Remote World' : 'Walk in or Click'),
    accentColor: colorA,
    width: 3.9,
  });
  label.sprite.position.set(0, 4.95, 0);
  group.add(label.sprite);

  // Invisible generous click target
  const hitGeo = new THREE.SphereGeometry(2.25, 14, 14);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.position.y = 2.25;
  group.add(hitMesh);

  let targetHover = 0;
  let currentHover = 0;

  return {
    portal,
    group,
    aperture: vortex,
    hitTargets: [hitMesh, vortex, outerRing],
    triggerCenter: new THREE.Vector3(portal.position[0], portal.position[1] + 2.0, portal.position[2]),
    triggerRadius: portal.triggerRadius ?? 2.35,
    setHovered: (h) => {
      targetHover = h ? 1 : 0;
    },
    setProximity: (p) => {
      vortexUniforms.proximity.value = p;
    },
    update: (dt, elapsed) => {
      currentHover += (targetHover - currentHover) * Math.min(1, dt * 8);
      vortexUniforms.hover.value = currentHover;
      ringHover.value = currentHover;
      halo.rotation.z = elapsed * 0.55;
      halo.rotation.y = Math.sin(elapsed * 0.9) * 0.18;
      halo.scale.setScalar(1 + currentHover * 0.08);
      label.sprite.position.y = 4.95 + Math.sin(elapsed * 2.0) * 0.12;
      light.intensity = 3.0 + currentHover * 2.5 + Math.sin(elapsed * 3.1) * 0.4;
    },
    dispose: () => {
      outerRingGeo.dispose();
      ringMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      baseGeo.dispose();
      baseMat.dispose();
      vortexGeo.dispose();
      vortexMat.dispose();
      hitGeo.dispose();
      hitMat.dispose();
      label.dispose();
    },
  };
}

/**
 * Portal Representation 1: "Magic Fountain Portal"
 * Tall glowing blue magic water jet shooting up from an illuminated basin with
 * orbiting energy arcs and a wide dive/click target so players flying above can
 * either swoop right into the plume or click directly on it.
 */
export function createMagicFountainPortal(
  portal: PortalDefinition,
  options?: { plumeHeight?: number; phase?: number },
): PortalVisualHandle {
  const group = new THREE.Group();
  group.position.set(portal.position[0], portal.position[1], portal.position[2]);

  const plumeHeight = options?.plumeHeight ?? 14.5;
  const colorA = portal.colorA ?? '#38bdf8';
  const colorB = portal.colorB ?? '#60a5fa';

  // Sculpted dark marble fountain basin rim
  const basinGeo = new THREE.CylinderGeometry(3.4, 3.9, 0.9, 28);
  const basinMat = new THREE.MeshStandardMaterial({
    color: 0x0b1629,
    roughness: 0.3,
    metalness: 0.6,
  });
  const basin = new THREE.Mesh(basinGeo, basinMat);
  basin.position.y = 0.45;
  group.add(basin);

  // Glowing horizontal vortex pool inside the basin
  const poolGeo = new THREE.CircleGeometry(3.15, 40);
  const { material: vortexMat, uniforms: vortexUniforms } = createPortalVortexMaterial(colorA, colorB);
  const pool = new THREE.Mesh(poolGeo, vortexMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.94;
  group.add(pool);

  const windowMesh = new THREE.Mesh(poolGeo, vortexMat);
  windowMesh.position.set(0, 3.15, 1.8);
  group.rotation.y = portal.yaw ?? 0;
  group.add(windowMesh);

  // Luminous energy crown ring floating halfway up the magic jet
  const crownGeo = new THREE.TorusGeometry(2.35, 0.11, 14, 48);
  const { material: crownMat, hover: crownHover } = createEnergyRingMaterial(colorA, colorB);
  const crown = new THREE.Mesh(crownGeo, crownMat);
  crown.rotation.x = Math.PI / 2;
  crown.position.y = plumeHeight * 0.62;
  group.add(crown);

  // Primary vertical magic water column (open cylinder with TSL upward flow shader)
  const coreGeo = new THREE.CylinderGeometry(1.45, 0.62, plumeHeight, 24, 20, true);
  const { material: plumeMat, uniforms: plumeUniforms } = createMagicFountainPlumeMaterial(colorA, '#3b82f6');
  plumeUniforms.phase.value = options?.phase ?? 0;
  const corePlume = new THREE.Mesh(coreGeo, plumeMat);
  corePlume.position.y = plumeHeight * 0.5 + 0.8;
  group.add(corePlume);

  // Outer flaring magic spray veil
  const veilGeo = new THREE.CylinderGeometry(3.1, 1.15, plumeHeight * 0.86, 24, 16, true);
  const { material: veilMat, uniforms: veilUniforms } = createMagicFountainPlumeMaterial('#93c5fd', colorA);
  veilUniforms.phase.value = (options?.phase ?? 0) + 1.9;
  const outerVeil = new THREE.Mesh(veilGeo, veilMat);
  outerVeil.position.y = plumeHeight * 0.44 + 0.8;
  group.add(outerVeil);

  // Arcing glowing water ribbons cascading outward in 4 directions
  const arcGeos: THREE.BufferGeometry[] = [];
  const arcMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.0, 0),
      new THREE.Vector3(Math.cos(angle) * 0.9, plumeHeight * 0.68, Math.sin(angle) * 0.9),
      new THREE.Vector3(Math.cos(angle) * 2.5, plumeHeight * 0.86, Math.sin(angle) * 2.5),
      new THREE.Vector3(Math.cos(angle) * 3.1, 1.1, Math.sin(angle) * 3.1),
    ]);
    const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.14, 8, false);
    arcGeos.push(tubeGeo);
    const arc = new THREE.Mesh(tubeGeo, plumeMat);
    group.add(arc);
    arcMeshes.push(arc);
  }

  // Beacon light illuminating the jet
  const light = new THREE.PointLight(new THREE.Color(colorA), 7.5, 28, 1.4);
  light.position.set(0, plumeHeight * 0.65, 0);
  group.add(light);

  // High-visibility floating banner above the magic fountain
  const label = createFloatingLabel({
    title: portal.label,
    subtitle: portal.subtitle ?? 'Click or Dive Into Fountain',
    accentColor: colorA,
    width: 5.6,
  });
  label.sprite.position.set(0, plumeHeight + 2.4, 0);
  group.add(label.sprite);

  // Tall clickable cylinder enclosing the entire fountain jet & crown
  const hitGeo = new THREE.CylinderGeometry(3.5, 3.5, plumeHeight + 3.0, 16);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.position.y = plumeHeight * 0.5 + 1.0;
  group.add(hitMesh);

  let targetHover = 0;
  let currentHover = 0;
  const triggerCenter = new THREE.Vector3(
    portal.position[0],
    portal.position[1] + plumeHeight * 0.52,
    portal.position[2],
  );

  return {
    portal,
    group,
    aperture: windowMesh,
    hitTargets: [hitMesh, corePlume, outerVeil, pool, crown],
    triggerCenter,
    triggerRadius: portal.triggerRadius ?? 4.2,
    triggerYRange: [portal.position[1] - 0.5, portal.position[1] + plumeHeight + 1.5],
    setHovered: (h) => {
      targetHover = h ? 1 : 0;
    },
    setProximity: (p) => {
      vortexUniforms.proximity.value = p;
    },
    update: (dt, elapsed) => {
      currentHover += (targetHover - currentHover) * Math.min(1, dt * 8);
      vortexUniforms.hover.value = currentHover;
      plumeUniforms.hover.value = currentHover;
      veilUniforms.hover.value = currentHover;
      crownHover.value = currentHover;

      // Rhythmic fountain pulse (surging upward)
      const pulse = 1.0 + Math.sin(elapsed * 2.6 + (options?.phase ?? 0)) * 0.08 + currentHover * 0.14;
      corePlume.scale.set(1 + currentHover * 0.18, pulse, 1 + currentHover * 0.18);
      outerVeil.scale.set(1 + currentHover * 0.15, pulse * 0.98, 1 + currentHover * 0.15);
      outerVeil.rotation.y = elapsed * 0.45;
      crown.rotation.z = elapsed * 0.9;
      crown.position.y = plumeHeight * 0.62 + Math.sin(elapsed * 2.0 + (options?.phase ?? 0)) * 0.65;
      crown.scale.setScalar(1 + currentHover * 0.22);
      label.sprite.position.y = plumeHeight + 2.4 + Math.sin(elapsed * 1.8) * 0.25;
      light.intensity = 7.0 + currentHover * 6.0 + Math.sin(elapsed * 3.0) * 1.1;
    },
    dispose: () => {
      basinGeo.dispose();
      basinMat.dispose();
      poolGeo.dispose();
      vortexMat.dispose();
      crownGeo.dispose();
      crownMat.dispose();
      coreGeo.dispose();
      plumeMat.dispose();
      veilGeo.dispose();
      veilMat.dispose();
      arcGeos.forEach((g) => g.dispose());
      hitGeo.dispose();
      hitMat.dispose();
      label.dispose();
    },
  };
}

/**
 * Create a curved organic botanical petal BufferGeometry hinged cleanly at its base (y = 0)
 * so pivoting around local X blooms the flower open and closed!
 */
function createSculptedPetalGeometry(length = 2.6, maxWidth = 1.15): THREE.BufferGeometry {
  const segU = 6;
  const segV = 10;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV; // 0 base .. 1 tip
    // Teardrop / lotus petal silhouette
    const widthProfile = Math.sin(Math.pow(v, 0.72) * Math.PI) * maxWidth;
    // Gentle outward cup arch along petal length
    const archZ = Math.sin(v * Math.PI * 0.85) * 0.48 - v * v * 0.35;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU; // 0..1 across
      const centered = u * 2 - 1;
      const x = centered * widthProfile * 0.5;
      // Cupped cross-section
      const cupZ = (1 - centered * centered) * 0.22 * Math.sin(v * Math.PI);
      const y = v * length;
      positions.push(x, y, archZ + cupZ);
      uvs.push(u, v);
    }
  }

  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * (segU + 1) + iu;
      const b = a + 1;
      const c = a + (segU + 1);
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Portal Representation 2: "Blooming Solarpunk Flower Portal"
 * Giant botanical flower rising from the lush meadow on a curved emerald stem.
 * Layered petals actively grow and bloom open outward, cradling a glowing TSL
 * portal nestled inside the heart of the blossom!
 */
export function createBloomingFlowerPortal(
  portal: PortalDefinition,
  options?: {
    stemHeight?: number;
    petalBaseColor?: string;
    petalTipColor?: string;
    petalCount?: number;
    phase?: number;
  },
): PortalVisualHandle {
  const group = new THREE.Group();
  group.position.set(portal.position[0], portal.position[1], portal.position[2]);
  group.rotation.y = portal.yaw ?? 0;

  const stemHeight = options?.stemHeight ?? 3.6;
  const colorA = portal.colorA ?? '#22d3ee';
  const colorB = portal.colorB ?? '#fde047';
  const petalBase = options?.petalBaseColor ?? colorA;
  const petalTip = options?.petalTipColor ?? '#fef9c3';
  const outerCount = options?.petalCount ?? 8;
  const phase = options?.phase ?? 0;

  // Curved organic emerald stem
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.3, 0),
    new THREE.Vector3(0.22, stemHeight * 0.45, -0.25),
    new THREE.Vector3(-0.08, stemHeight * 0.85, -0.1),
    new THREE.Vector3(0, stemHeight, 0),
  ]);
  const stemGeo = new THREE.TubeGeometry(stemCurve, 20, 0.24, 12, false);
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x2f6f34,
    roughness: 0.72,
    metalness: 0.05,
  });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  group.add(stem);

  // Two lush basal leaves curling out from the stem
  const leafGeo = createSculptedPetalGeometry(2.3, 0.95);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x3b863e,
    roughness: 0.65,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 2; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(0, stemHeight * (0.28 + i * 0.22), 0);
    leaf.rotation.y = i * Math.PI + 0.55;
    leaf.rotation.x = 1.05;
    group.add(leaf);
  }

  // Blossom head assembly — tilted slightly forward toward the viewer so you can look straight into the petals!
  const blossomHead = new THREE.Group();
  blossomHead.position.set(0, stemHeight, 0);
  blossomHead.rotation.x = 0.78; // Opens forward & slightly upward like a giant sun-greeting bloom
  group.add(blossomHead);

  // Calyx / golden-green sepal cup behind the portal
  const calyxGeo = new THREE.CylinderGeometry(1.15, 0.45, 0.65, 16);
  const calyxMat = new THREE.MeshStandardMaterial({
    color: 0x365314,
    roughness: 0.6,
  });
  const calyx = new THREE.Mesh(calyxGeo, calyxMat);
  calyx.position.y = -0.32;
  blossomHead.add(calyx);

  // Swirling TSL portal cradled right inside the flower's heart!
  const vortexGeo = new THREE.CircleGeometry(1.68, 48);
  const { material: vortexMat, uniforms: vortexUniforms } = createPortalVortexMaterial(colorA, colorB);
  const vortex = new THREE.Mesh(vortexGeo, vortexMat);
  vortex.position.set(0, stemHeight + 0.65, 0.85);
  group.add(vortex);

  // Golden stamen/pollen halo ringing the portal inside the petals
  const stamenRingGeo = new THREE.TorusGeometry(1.72, 0.06, 10, 48);
  const stamenMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: new THREE.Color(colorA),
    emissiveIntensity: 0.9,
    roughness: 0.35,
  });
  const stamenRing = new THREE.Mesh(stamenRingGeo, stamenMat);
  stamenRing.rotation.x = Math.PI / 2;
  stamenRing.position.y = 0.2;
  blossomHead.add(stamenRing);

  // Two concentric rings of animated blooming petals
  const outerPetalGeo = createSculptedPetalGeometry(2.75, 1.38);
  const innerPetalGeo = createSculptedPetalGeometry(2.15, 1.08);
  const { material: outerPetalMat, uniforms: outerPetalUniforms } = createBloomingPetalMaterial(petalBase, petalTip);
  const { material: innerPetalMat, uniforms: innerPetalUniforms } = createBloomingPetalMaterial(colorB, '#ffffff');

  const outerPivots: THREE.Group[] = [];
  const innerPivots: THREE.Group[] = [];

  for (let i = 0; i < outerCount; i++) {
    const angle = (i / outerCount) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.rotation.y = angle;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.05, 1.12);
    const petal = new THREE.Mesh(outerPetalGeo, outerPetalMat);
    pivot.add(petal);
    holder.add(pivot);
    blossomHead.add(holder);
    outerPivots.push(pivot);
  }

  for (let i = 0; i < outerCount; i++) {
    const angle = ((i + 0.5) / outerCount) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.rotation.y = angle;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.14, 0.95);
    const petal = new THREE.Mesh(innerPetalGeo, innerPetalMat);
    pivot.add(petal);
    holder.add(pivot);
    blossomHead.add(holder);
    innerPivots.push(pivot);
  }

  // Warm blossom light
  const light = new THREE.PointLight(new THREE.Color(colorA), 3.6, 15, 1.4);
  light.position.set(0, 0.9, 0.4);
  blossomHead.add(light);

  // Floating sign above the giant blooming portal flower
  const label = createFloatingLabel({
    title: portal.label,
    subtitle: portal.subtitle ?? 'Click or Enter Blooming Portal',
    accentColor: colorA,
    bgColor: 'rgba(15, 31, 20, 0.84)',
    width: 4.1,
  });
  label.sprite.position.set(0, stemHeight + 3.45, 0);
  group.add(label.sprite);

  // Generous clickable sphere centered on the blossom head
  const hitGeo = new THREE.SphereGeometry(2.8, 16, 16);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.position.set(0, stemHeight + 0.2, 0.35);
  group.add(hitMesh);

  let targetHover = 0;
  let currentHover = 0;
  let currentProximity = 0;
  let growProgress = 0; // Smoothly grows & blooms open when the meadow mounts!

  const triggerCenter = new THREE.Vector3(
    portal.position[0],
    portal.position[1] + stemHeight + 0.1,
    portal.position[2],
  );

  return {
    portal,
    group,
    aperture: vortex,
    hitTargets: [hitMesh, vortex, blossomHead],
    triggerCenter,
    triggerRadius: portal.triggerRadius ?? 2.85,
    setHovered: (h) => {
      targetHover = h ? 1 : 0;
    },
    setProximity: (p) => {
      currentProximity = p;
      vortexUniforms.proximity.value = p;
    },
    update: (dt, elapsed) => {
      growProgress = Math.min(1, growProgress + dt * 0.55);
      // Smooth ease-out cubic growth curve
      const easedGrow = 1 - Math.pow(1 - growProgress, 3);
      group.scale.setScalar(0.35 + 0.65 * easedGrow);

      currentHover += (targetHover - currentHover) * Math.min(1, dt * 7);
      vortexUniforms.hover.value = currentHover;

      // Living bloom breathing + opening wide on hover / proximity
      const breath = Math.sin(elapsed * 1.15 + phase) * 0.08;
      const bloomOpen = easedGrow * (0.78 + breath + currentHover * 0.28 + currentProximity * 0.22);

      // Rotate petals outward from closed bud (0.18 rad) to lush open bloom (~1.18 rad)
      const outerTilt = 0.22 + bloomOpen * 0.92;
      const innerTilt = 0.14 + bloomOpen * 0.68;

      for (let i = 0; i < outerPivots.length; i++) {
        outerPivots[i].rotation.x = outerTilt + Math.sin(elapsed * 1.6 + phase + i * 0.7) * 0.035;
      }
      for (let i = 0; i < innerPivots.length; i++) {
        innerPivots[i].rotation.x = innerTilt + Math.cos(elapsed * 1.8 + phase + i * 0.8) * 0.03;
      }

      // Gentle breeze sway of the blossom head (nodding softly like the meadow wind)
      blossomHead.rotation.z = Math.sin(elapsed * 0.9 + phase) * 0.055;
      vortex.scale.setScalar(0.45 + 0.55 * easedGrow + currentHover * 0.1);
      outerPetalUniforms.bloomGlow.value = 0.28 + currentHover * 0.6 + currentProximity * 0.45;
      innerPetalUniforms.bloomGlow.value = 0.42 + currentHover * 0.7 + currentProximity * 0.5;
      label.sprite.position.y = stemHeight + 3.45 + Math.sin(elapsed * 1.7 + phase) * 0.15;
      light.intensity = 3.2 + currentHover * 3.0 + currentProximity * 2.0;
    },
    dispose: () => {
      stemGeo.dispose();
      stemMat.dispose();
      leafGeo.dispose();
      leafMat.dispose();
      calyxGeo.dispose();
      calyxMat.dispose();
      vortexGeo.dispose();
      vortexMat.dispose();
      stamenRingGeo.dispose();
      stamenMat.dispose();
      outerPetalGeo.dispose();
      innerPetalGeo.dispose();
      outerPetalMat.dispose();
      innerPetalMat.dispose();
      hitGeo.dispose();
      hitMat.dispose();
      label.dispose();
    },
  };
}
