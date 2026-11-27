import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  acos,
  cameraPosition,
  clamp,
  dot,
  float,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import type { PortalDefinition, PortalVisualHandle } from '@portalverse/core/types';
import { createEnergyRingMaterial, createPortalVortexMaterial } from '@portalverse/core/shaders/portalShaders';
import { createFloatingLabel } from '@portalverse/core/engine/signage';
import { PALACE, ROTUNDA } from './layout';
import { DOME_ARRIVAL_SPAWN, PORTAL_THRESHOLD_FRAME } from './path/curve';

/**
 * Palace Lagoon summit exit portal + Alhambra / Granada Spanish-tile dome vault.
 *
 * The entire inner rotunda dome vault (34 m wide, arching from y = 25.5 m to y = 42.4 m) stays
 * lined with an opaque, museum-grade Granada / Alhambra Nasrid ceramic zellige dome mosaic mapped
 * via seamless azimuthal equidistant projection (zero polar pinching or UV seams).
 *
 * Right at the summit of the fluid wooden spiral (PORTAL_THRESHOLD_FRAME, y = 26.2 m), an upright
 * glowing circular portal ring frames the live perspective-correct aperture into the next room—
 * keeping the destination view strictly inside the circular portal while the entire surrounding
 * vault remains the glazed Granada ceramic tilework.
 */

const MOSAIC_RADIUS = 16.90;
const DOME_SPRING_Y = ROTUNDA.domeFoot + 0.1; // 25.5 m
const GATE_RADIUS = 2.55;

/**
 * Create an inward-facing Y-up hemispherical dome geometry (crown at y = +R, springline at y = 0).
 * Winding and normals are inverted so THREE.FrontSide faces inward into the rotunda while remaining
 * culled from outside the Palace's stone dome.
 *
 * UVs use azimuthal equidistant projection from the zenith crown (`u = 0.5 + 0.488 * rho * cos(theta)`,
 * `v = 0.5 + 0.488 * rho * sin(theta)`), eliminating polar pinching and UV seams entirely.
 */
function createInwardDomeGeometry(radius: number, widthSegs: number, heightSegs: number): THREE.SphereGeometry {
  // Extend slightly past the equator (0.506 * PI) so the dome tucks cleanly behind the gilded cornice ring.
  const geo = new THREE.SphereGeometry(radius, widthSegs, heightSegs, 0, Math.PI * 2, 0, Math.PI * 0.506);

  const posAttr = geo.getAttribute('position');
  const uvAttr = geo.getAttribute('uv');
  if (posAttr && uvAttr) {
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const py = posAttr.getY(i);
      const pz = posAttr.getZ(i);
      const len = Math.hypot(px, py, pz) || 1;
      const ny = py / len;
      const rhoNorm = Math.acos(Math.min(1, Math.max(0, ny))) / (Math.PI * 0.5);
      const theta = Math.atan2(pz, px);
      const rUV = 0.488 * rhoNorm;
      uvAttr.setXY(i, 0.5 + rUV * Math.cos(theta), 0.5 + rUV * Math.sin(theta));
    }
    uvAttr.needsUpdate = true;
  }

  // Reverse triangle winding and invert normals so FrontSide faces the interior of the rotunda.
  const idx = geo.getIndex();
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i + 2 < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    idx.needsUpdate = true;
  }
  const norm = geo.getAttribute('normal');
  if (norm) {
    for (let i = 0; i < norm.count; i++) {
      norm.setXYZ(i, -norm.getX(i), -norm.getY(i), -norm.getZ(i));
    }
    norm.needsUpdate = true;
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Opaque glazed Granada / Alhambra Spanish ceramic tile dome shader with kiln-fired Fresnel luster
 * and subtle gilded filigree shimmer that warms softly as you climb into the dome.
 */
function createAlhambraMosaicMaterial(
  colorA: string,
  mosaicTexture: THREE.Texture | null,
) {
  const uWarmth = uniform(0.0);
  const uAccentA = uniform(new THREE.Color(colorA));

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = false;
  material.depthWrite = true;
  material.side = THREE.FrontSide;
  material.fog = false;

  const mosaicFn = Fn(() => {
    const nDir = normalize(positionLocal);
    const elev = clamp(nDir.y, float(0.0), float(1.0));
    const rhoNorm = clamp(acos(elev).div(float(1.5707963)), float(0.0), float(1.0));

    // Sample the high-detail Alhambra Spanish ceramic tile dome texture (or cobalt/gold fallback if unavailable)
    const sampled = mosaicTexture
      ? texture(mosaicTexture, uv()).xyz
      : mix(vec3(0.06, 0.16, 0.40), vec3(0.86, 0.66, 0.24), smoothstep(float(0.35), float(0.05), rhoNorm));

    // Warm kiln-fired ceramic glaze sheen + subtle golden highlight on bright gilded tilework
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(abs(dot(normalWorld, viewDir)), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(ndotv), 2.4);
    const breath = sin(time.mul(1.2).sub(rhoNorm.mul(5.5))).mul(0.5).add(0.5);
    const warmth = clamp(sampled.x.sub(sampled.z), float(0.0), float(1.0));
    const goldLuster = vec3(1.0, 0.78, 0.34).mul(
      warmth.mul(float(0.14).add(breath.mul(0.08)).add(uWarmth.mul(0.10)).add(fresnel.mul(0.24))),
    );
    const glazeSheen = mix(vec3(0.95, 0.88, 0.76), uAccentA, float(0.16)).mul(fresnel.mul(0.16));

    // Gently boost richness for ACES Filmic so Granada cobalt, turquoise, ivory, and gold gleam vibrantly
    return sampled.mul(float(1.06)).add(goldLuster).add(glazeSheen);
  });

  material.colorNode = mosaicFn();

  return { material, uWarmth };
}

export interface DomePortalHandle extends PortalVisualHandle {
  /** Update subtle dome gilding warmth from the room's player coordinates. */
  setPlayerPosition: (pos: THREE.Vector3 | null) => void;
}

/**
 * Create the Palace Lagoon's summit circular exit portal framed inside the solid Alhambra ceramic tile dome.
 */
export function createDomePortal(
  gate: PortalDefinition,
  mosaicTexture: THREE.Texture | null = null,
): DomePortalHandle {
  const thresholdFrame = PORTAL_THRESHOLD_FRAME;
  const gatewayYaw = Math.atan2(-thresholdFrame.t[0], -thresholdFrame.t[1]);

  const portal: PortalDefinition = {
    ...gate,
    position: [thresholdFrame.p[0], thresholdFrame.p[1], thresholdFrame.p[2]],
    yaw: gatewayYaw,
    triggerRadius: GATE_RADIUS,
    oneWay: true,
    colorA: gate.colorA ?? '#22d3ee',
    colorB: gate.colorB ?? '#f59e0b',
  };

  // Root group sits upright at the spiral summit threshold facing back along the approach (+Z local -> approaching walker).
  const group = new THREE.Group();
  group.position.set(portal.position[0], portal.position[1], portal.position[2]);
  group.rotation.y = gatewayYaw;

  // 1. Live destination aperture strictly inside the circular portal ring
  const apertureGeo = new THREE.CircleGeometry(GATE_RADIUS - 0.08, 64);
  const { material: vortexMat, uniforms: vortexUniforms } = createPortalVortexMaterial(portal.colorA, portal.colorB);
  vortexMat.side = THREE.FrontSide;
  const aperture = new THREE.Mesh(apertureGeo, vortexMat);
  aperture.position.y = GATE_RADIUS;
  aperture.userData.portalId = portal.id;
  aperture.userData.oneWay = true;
  aperture.userData.routeGate = true;
  group.add(aperture);

  // 2. Sculpted glowing summit portal ring + rotating outer halo + threshold sill + floating destination label
  const gateRingGeo = new THREE.TorusGeometry(GATE_RADIUS, 0.14, 20, 72);
  const { material: gateRingMat, hover: gateRingHover } = createEnergyRingMaterial(portal.colorA, portal.colorB);
  const gateRing = new THREE.Mesh(gateRingGeo, gateRingMat);
  gateRing.position.y = GATE_RADIUS;
  group.add(gateRing);

  const gateHaloGeo = new THREE.TorusGeometry(GATE_RADIUS + 0.30, 0.048, 12, 72);
  const gateHaloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(portal.colorA),
    transparent: true,
    opacity: 0.82,
  });
  const gateHalo = new THREE.Mesh(gateHaloGeo, gateHaloMat);
  gateHalo.position.y = GATE_RADIUS;
  group.add(gateHalo);

  // Glowing golden threshold sill bar flush on the wooden spiral planks right at the crossing line
  const sillGeo = new THREE.BoxGeometry(3.4, 0.06, 0.36);
  const sillMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fbbf24'),
    emissive: new THREE.Color(portal.colorA),
    emissiveIntensity: 0.9,
    roughness: 0.25,
    metalness: 0.75,
  });
  const sill = new THREE.Mesh(sillGeo, sillMat);
  sill.position.y = 0.03;
  group.add(sill);

  // Crisp floating destination sign hovering above the portal ring showing the next room's name
  const destLabel = createFloatingLabel({
    title: gate.label || 'Next Room',
    subtitle: 'Walk Through → Next Room',
    accentColor: portal.colorA,
  });
  destLabel.sprite.position.set(0, GATE_RADIUS * 2 + 0.85, 0);
  group.add(destLabel.sprite);

  // Local portal-accent light washing the wooden spiral planks at the threshold
  const gateLight = new THREE.PointLight(new THREE.Color(portal.colorA), 4.5, 22, 1.4);
  gateLight.position.set(0, GATE_RADIUS, 1.2);
  group.add(gateLight);

  // 3. Solid Alhambra / Granada Spanish ceramic tile dome vault covering the entire rotunda ceiling outside the portal
  const domeVault = new THREE.Group();
  domeVault.rotation.y = -gatewayYaw;
  const dx = PALACE.at[0] - portal.position[0];
  const dy = DOME_SPRING_Y - portal.position[1];
  const dz = PALACE.at[1] - portal.position[2];
  const cosY = Math.cos(-gatewayYaw);
  const sinY = Math.sin(-gatewayYaw);
  domeVault.position.set(dx * cosY + dz * sinY, dy, -dx * sinY + dz * cosY);
  group.add(domeVault);

  const mosaicGeo = createInwardDomeGeometry(MOSAIC_RADIUS, 72, 36);
  const { material: mosaicMat, uWarmth } = createAlhambraMosaicMaterial(portal.colorA!, mosaicTexture);
  const mosaic = new THREE.Mesh(mosaicGeo, mosaicMat);
  domeVault.add(mosaic);

  // Sculpted gilded cornice torus + subtle inner halo framing the dome springline (y = 25.5 m)
  const ringGeo = new THREE.TorusGeometry(17.02, 0.24, 16, 96);
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#eab308'),
    emissive: new THREE.Color('#d97706'),
    emissiveIntensity: 0.45,
    roughness: 0.28,
    metalness: 0.85,
  });
  const corniceRing = new THREE.Mesh(ringGeo, ringMat);
  corniceRing.rotation.x = Math.PI / 2;
  domeVault.add(corniceRing);

  const haloGeo = new THREE.TorusGeometry(16.62, 0.085, 12, 96);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#fbbf24'),
    transparent: true,
    opacity: 0.42,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.05;
  domeVault.add(halo);

  // Subtle warm-gold interior light washing the upper dome cornice
  const domeLight = new THREE.PointLight(new THREE.Color('#fbbf24'), 4.0, 34, 1.4);
  domeLight.position.set(0, 3.5, 0);
  domeVault.add(domeLight);

  let targetWarmth = 0;
  let currentWarmth = 0;

  const updateProximityFromPos = (pos: THREE.Vector3 | null) => {
    if (!pos) {
      targetWarmth = 0;
      return;
    }
    const px = pos.x - portal.position[0];
    const py = (pos.y + 1.4) - (portal.position[1] + GATE_RADIUS);
    const pz = pos.z - portal.position[2];
    const dist = Math.hypot(px, py, pz);
    const t = THREE.MathUtils.clamp((24.0 - dist) / (24.0 - 6.0), 0, 1);
    targetWarmth = t * t * (3 - 2 * t);
  };

  return {
    portal,
    group,
    passage: true,
    aperture,
    triggerCenter: new THREE.Vector3(portal.position[0], portal.position[1] + GATE_RADIUS, portal.position[2]),
    triggerRadius: GATE_RADIUS,
    openingRadius: GATE_RADIUS,
    portalCenterY: GATE_RADIUS,
    arrivalSpawn: DOME_ARRIVAL_SPAWN,
    setPlayerPosition: updateProximityFromPos,
    setProximity: (p) => {
      vortexUniforms.proximity.value = p;
      gateRingHover.value = 0.25 + p * 0.95;
      if (p > targetWarmth) targetWarmth = p;
    },
    update: (dt, elapsed) => {
      const k = dt > 0 ? Math.min(1, dt * 4.5) : 1;
      currentWarmth += (targetWarmth - currentWarmth) * k;
      uWarmth.value = currentWarmth;

      halo.rotation.z = elapsed * 0.14;
      haloMat.opacity = 0.34 + currentWarmth * 0.28 + Math.sin(elapsed * 2.1) * 0.06;
      ringMat.emissiveIntensity = 0.38 + currentWarmth * 0.45 + Math.sin(elapsed * 1.7) * 0.08;
      domeLight.intensity = 3.5 + currentWarmth * 2.5 + Math.sin(elapsed * 2.4) * 0.4;

      gateHalo.rotation.z = elapsed * 0.65;
      gateHalo.rotation.y = Math.sin(elapsed * 0.95) * 0.14;
      gateHaloMat.opacity = 0.68 + currentWarmth * 0.28 + Math.sin(elapsed * 3.0) * 0.08;
      sillMat.emissiveIntensity = 0.75 + currentWarmth * 0.9 + Math.sin(elapsed * 2.6) * 0.15;
      gateLight.intensity = 3.8 + currentWarmth * 4.2 + Math.sin(elapsed * 3.1) * 0.5;
    },
    dispose: () => {
      apertureGeo.dispose();
      vortexMat.dispose();
      mosaicGeo.dispose();
      mosaicMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      gateRingGeo.dispose();
      gateRingMat.dispose();
      gateHaloGeo.dispose();
      gateHaloMat.dispose();
      sillGeo.dispose();
      sillMat.dispose();
      destLabel.dispose();
    },
  };
}
