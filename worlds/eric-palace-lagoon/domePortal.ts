import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  acos,
  atan,
  cameraPosition,
  clamp,
  cos,
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
  vec4,
} from 'three/tsl';
import type { PortalDefinition, PortalVisualHandle } from '@portalverse/core/types';
import { createEnergyRingMaterial, createPortalVortexMaterial } from '@portalverse/core/shaders/portalShaders';
import { createFloatingLabel } from '@portalverse/core/engine/signage';
import { PALACE, ROTUNDA } from './layout';
import { DOME_ARRIVAL_SPAWN, DOME_PORTAL_Y, PORTAL_THRESHOLD_FRAME } from './path/curve';

/**
 * Full-dome Alhambra Spanish-tile exit portal for the Palace of Fine Arts rotunda.
 *
 * The entire inner dome vault (34 m wide, arching from y = 25.5 m to y = 42.6 m) is a giant live
 * portal aperture looking into the next room in the Portalverse loop. Draped inside it is a
 * museum-grade Granada / Alhambra Nasrid ceramic zellige dome mosaic mapped via seamless
 * azimuthal equidistant projection (zero polar pinching or stretching):
 *   - From the colonnade, meadow, boardwalk, and lower spiral, the vault gleams as an ornate
 *     kiln-fired Spanish ceramic dome with glazed Fresnel luster and gilded filigree highlights.
 *   - As you ascend the fluid wooden spiral toward the summit, the tiles bloom open radially from
 *     the 16-pointed zenith rosette in a molten-gold wave to reveal the live next room overhead.
 *   - Right where the fluid spiral glides across DOME_PORTAL_Y (26.2 m) at dead center, an
 *     unmistakable glowing Portalverse threshold ring + floating destination sign frames the
 *     exact crossing point so you always know you are stepping straight into the next room.
 */

const DOME_RADIUS = 17.15;
const MOSAIC_RADIUS = 16.90;
const DOME_BASE_OFFSET_Z = DOME_PORTAL_Y - (ROTUNDA.domeFoot + 0.1); // ~0.7 m below crossing plane -> y = 25.5 m
const CROSSING_RADIUS = 15.6;

/**
 * Create an inward-facing hemispherical dome geometry oriented in portal-local space:
 * local +Z points DOWN into the rotunda (toward the viewer), local -Z arches UP to the dome crown.
 * Winding is reversed so THREE.FrontSide faces INWARD (matching PortalPreviews' oneWay FrontSide).
 *
 * UVs use azimuthal equidistant projection from the zenith crown (`u = 0.5 + 0.49 * rho * cos(theta)`,
 * `v = 0.5 + 0.49 * rho * sin(theta)`), eliminating polar pinching and UV seams entirely.
 */
function createInwardDomeGeometry(radius: number, widthSegs: number, heightSegs: number): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(radius, widthSegs, heightSegs, 0, Math.PI * 2, 0, Math.PI * 0.495);
  // Rotate so the north pole (0, +R, 0) moves to (0, 0, -R) (world +Y when group.rotation.x = +PI/2)
  geo.rotateX(-Math.PI / 2);

  // Assign seamless azimuthal equidistant UVs BEFORE translating by DOME_BASE_OFFSET_Z
  const posAttr = geo.getAttribute('position');
  const uvAttr = geo.getAttribute('uv');
  if (posAttr && uvAttr) {
    for (let i = 0; i < posAttr.count; i++) {
      const px = posAttr.getX(i);
      const py = posAttr.getY(i);
      const pz = posAttr.getZ(i);
      const len = Math.hypot(px, py, pz) || 1;
      const nx = px / len;
      const ny = py / len;
      const nz = pz / len;
      const rhoNorm = Math.acos(Math.min(1, Math.max(0, -nz))) / (Math.PI * 0.5);
      const theta = Math.atan2(ny, nx);
      const rUV = 0.488 * rhoNorm;
      uvAttr.setXY(i, 0.5 + rUV * Math.cos(theta), 0.5 + rUV * Math.sin(theta));
    }
    uvAttr.needsUpdate = true;
  }

  geo.translate(0, 0, DOME_BASE_OFFSET_Z);

  // Reverse triangle winding and invert normals so FrontSide faces the interior of the rotunda
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
 * Glazed Granada / Alhambra Spanish ceramic tile dome shader with kiln-fired Fresnel luster
 * and radial 16-petal molten-gold dissolve as the player climbs toward the portal threshold.
 */
function createAlhambraMosaicMaterial(
  colorA: string,
  colorB: string,
  mosaicTexture: THREE.Texture | null,
) {
  const uReveal = uniform(0.0);
  const uAccentA = uniform(new THREE.Color(colorA));
  const uAccentB = uniform(new THREE.Color(colorB));

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.FrontSide;
  material.fog = false;

  const mosaicFn = Fn(() => {
    const lp = positionLocal.sub(vec3(0.0, 0.0, DOME_BASE_OFFSET_Z));
    const nDir = normalize(lp);
    const theta = atan(nDir.y, nDir.x);
    const elev = clamp(nDir.z.negate(), float(0.0), float(1.0));
    const rhoNorm = clamp(acos(elev).div(float(1.5707963)), float(0.0), float(1.0));

    // Sample the high-detail Alhambra Spanish ceramic tile dome texture (or warm cobalt/gold fallback if unavailable)
    const sampled = mosaicTexture
      ? texture(mosaicTexture, uv()).xyz
      : mix(vec3(0.06, 0.16, 0.40), vec3(0.86, 0.66, 0.24), smoothstep(float(0.35), float(0.05), rhoNorm));

    // Warm kiln-fired ceramic glaze sheen + subtle golden highlight on bright gilded tilework
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(abs(dot(normalWorld, viewDir)), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(ndotv), 2.4);
    const breath = sin(time.mul(1.2).sub(rhoNorm.mul(5.5))).mul(0.5).add(0.5);
    const warmth = clamp(sampled.x.sub(sampled.z), float(0.0), float(1.0));
    const goldLuster = vec3(1.0, 0.78, 0.34).mul(warmth.mul(float(0.16).add(breath.mul(0.10)).add(fresnel.mul(0.28))));
    const glazeSheen = mix(vec3(0.95, 0.88, 0.76), uAccentA, float(0.22)).mul(fresnel.mul(0.18));

    // Gently boost contrast & richness for ACES Filmic so the Granada cobalt/turquoise/gold gleams vibrantly
    let col = sampled.mul(float(1.08)).add(goldLuster).add(glazeSheen);

    // ---- Radial 16-petal Alhambra zenith dissolve as you ascend the wooden spiral (uReveal: 0 -> 1)
    const petalWave = cos(theta.mul(16.0)).mul(0.032).add(sin(theta.mul(8.0).add(rhoNorm.mul(6.0))).mul(0.018));
    // Gold filigree melts slightly after ceramic infill so the gilded tracery sparkles along the dissolving edge
    const goldDelay = warmth.mul(0.055);
    const tileOrder = rhoNorm.mul(0.84).add(petalWave).add(goldDelay);
    const wave = uReveal.mul(1.24);
    const dissolve = smoothstep(tileOrder.sub(0.07), tileOrder.add(0.07), wave);

    // Preserve the gilded perimeter cornice band framing the open sky portal
    const keepBorder = smoothstep(float(0.91), float(0.97), rhoNorm);
    const effectiveDissolve = dissolve.mul(float(1.0).sub(keepBorder.mul(0.90)));

    // Molten 24k gold + destination portal accent glow right along the dissolving petal rim
    const edgeGlow = smoothstep(float(0.0), float(0.45), effectiveDissolve)
      .mul(smoothstep(float(1.0), float(0.45), effectiveDissolve));
    const edgeColor = mix(vec3(1.0, 0.74, 0.22), mix(uAccentA, uAccentB, float(0.35)), float(0.38)).mul(2.2);
    col = col.add(edgeColor.mul(edgeGlow));

    const alpha = clamp(float(0.99).mul(float(1.0).sub(effectiveDissolve)), float(0.0), float(1.0));
    return vec4(col, alpha);
  });

  const out = mosaicFn();
  material.colorNode = out.xyz;
  material.opacityNode = out.w;

  return { material, uReveal };
}

export interface DomePortalHandle extends PortalVisualHandle {
  /** Set 0..1 proximity reveal manually from the room's player coordinates. */
  setPlayerPosition: (pos: THREE.Vector3 | null) => void;
}

/**
 * Create the Palace Lagoon's giant Alhambra dome-roof exit portal + unmistakable summit threshold gateway.
 */
export function createDomePortal(
  gate: PortalDefinition,
  mosaicTexture: THREE.Texture | null = null,
): DomePortalHandle {
  const portal: PortalDefinition = {
    ...gate,
    position: [PALACE.at[0], DOME_PORTAL_Y, PALACE.at[1]],
    yaw: 0,
    triggerRadius: CROSSING_RADIUS,
    oneWay: true,
    colorA: gate.colorA ?? '#22d3ee',
    colorB: gate.colorB ?? '#f59e0b',
  };

  const group = new THREE.Group();
  group.position.set(portal.position[0], portal.position[1], portal.position[2]);
  // Rotate +PI/2 around X so local +Z points DOWN into the rotunda and local -Z points UP into the dome vault.
  // Looking straight up through the dome maps directly to looking forward (-Z) into the next room, right-side up!
  group.rotation.x = Math.PI / 2;

  // 1. Live destination aperture spanning the entire inner dome vault
  const apertureGeo = createInwardDomeGeometry(DOME_RADIUS, 72, 36);
  const { material: vortexMat, uniforms: vortexUniforms } = createPortalVortexMaterial(portal.colorA, portal.colorB);
  vortexMat.side = THREE.FrontSide;
  const aperture = new THREE.Mesh(apertureGeo, vortexMat);
  aperture.userData.portalId = portal.id;
  aperture.userData.oneWay = true;
  aperture.userData.routeGate = true;
  aperture.userData.useFullOrientation = true;
  group.add(aperture);

  // 2. High-detail Alhambra / Granada Spanish ceramic tile dome shell that blooms open as you climb
  const mosaicGeo = createInwardDomeGeometry(MOSAIC_RADIUS, 72, 36);
  const { material: mosaicMat, uReveal } = createAlhambraMosaicMaterial(portal.colorA!, portal.colorB!, mosaicTexture);
  const mosaic = new THREE.Mesh(mosaicGeo, mosaicMat);
  mosaic.renderOrder = 12;
  group.add(mosaic);

  // 3. Sculpted gilded cornice torus + shimmering inner energy halo framing the dome springline (y = 25.5 m)
  const ringGeo = new THREE.TorusGeometry(17.02, 0.24, 16, 96);
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#eab308'),
    emissive: new THREE.Color('#d97706'),
    emissiveIntensity: 0.45,
    roughness: 0.28,
    metalness: 0.85,
  });
  const corniceRing = new THREE.Mesh(ringGeo, ringMat);
  corniceRing.position.z = DOME_BASE_OFFSET_Z;
  group.add(corniceRing);

  const haloGeo = new THREE.TorusGeometry(16.62, 0.085, 12, 96);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(portal.colorA),
    transparent: true,
    opacity: 0.58,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.z = DOME_BASE_OFFSET_Z + 0.05;
  group.add(halo);

  // 4. UNMISTAKABLE PORTAL THRESHOLD GATEWAY standing right across the fluid wooden spiral at y = 26.2 m!
  // Undo parent +PI/2 X rotation so this child sits in standard upright world space (+Y up, -Z forward).
  const thresholdFrame = PORTAL_THRESHOLD_FRAME;
  const thresholdGroup = new THREE.Group();
  thresholdGroup.rotation.x = -Math.PI / 2;
  // Convert world offset from portal center into parent-rotated local coords:
  // parent rotates (lx, ly, lz) -> world (lx, -lz, ly), so world (dx, dy, dz) -> local (dx, dz, -dy).
  const tDx = thresholdFrame.p[0] - portal.position[0];
  const tDy = thresholdFrame.p[1] - portal.position[1];
  const tDz = thresholdFrame.p[2] - portal.position[2];
  thresholdGroup.position.set(tDx, tDz, -tDy);
  group.add(thresholdGroup);

  const gatewayRig = new THREE.Group();
  gatewayRig.rotation.y = Math.atan2(-thresholdFrame.t[0], -thresholdFrame.t[1]);
  thresholdGroup.add(gatewayRig);

  const gateR = 2.55;
  const gateRingGeo = new THREE.TorusGeometry(gateR, 0.14, 20, 72);
  const { material: gateRingMat, hover: gateRingHover } = createEnergyRingMaterial(portal.colorA, portal.colorB);
  const gateRing = new THREE.Mesh(gateRingGeo, gateRingMat);
  gateRing.position.y = gateR;
  gatewayRig.add(gateRing);

  const gateHaloGeo = new THREE.TorusGeometry(gateR + 0.30, 0.048, 12, 72);
  const gateHaloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(portal.colorA),
    transparent: true,
    opacity: 0.82,
  });
  const gateHalo = new THREE.Mesh(gateHaloGeo, gateHaloMat);
  gateHalo.position.y = gateR;
  gatewayRig.add(gateHalo);

  // Translucent luminous inner rim so the center stays crystal clear to gaze right into the blazing live next room
  const veilGeo = new THREE.RingGeometry(gateR - 0.65, gateR - 0.06, 64);
  const veilMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(portal.colorA),
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const veil = new THREE.Mesh(veilGeo, veilMat);
  veil.position.y = gateR;
  veil.renderOrder = 14;
  gatewayRig.add(veil);

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
  gatewayRig.add(sill);

  // Crisp floating destination sign hovering above the portal ring showing the next room's name
  const destLabel = createFloatingLabel({
    title: gate.label || 'Next Room',
    subtitle: 'Walk Through → Next Room',
    accentColor: portal.colorA,
  });
  destLabel.sprite.position.set(0, gateR * 2 + 0.85, 0);
  gatewayRig.add(destLabel.sprite);

  // Local warm + portal-accent light washing the wooden spiral planks at the threshold
  const gateLight = new THREE.PointLight(new THREE.Color(portal.colorA), 4.5, 22, 1.4);
  gateLight.position.set(0, gateR, 1.2);
  gatewayRig.add(gateLight);

  // Subtle warm-gold interior light washing the upper dome cornice
  const domeLight = new THREE.PointLight(new THREE.Color('#fbbf24'), 4.0, 34, 1.4);
  domeLight.position.set(0, 0, DOME_BASE_OFFSET_Z + 3.5);
  group.add(domeLight);

  let targetReveal = 0;
  let currentReveal = 0;

  const updateRevealFromPos = (pos: THREE.Vector3 | null) => {
    if (!pos) {
      targetReveal = 0;
      return;
    }
    // Start blooming the Alhambra mosaic open slightly earlier (dist 24 m -> 9 m) so as you glide
    // around the upper wooden spiral toward the glowing gateway ring, the live destination world is blazing ahead!
    const dx = pos.x - portal.position[0];
    const dy = (pos.y + 1.4) - portal.position[1];
    const dz = pos.z - portal.position[2];
    const dist = Math.hypot(dx, dy, dz);
    const t = THREE.MathUtils.clamp((24.0 - dist) / (24.0 - 9.0), 0, 1);
    targetReveal = t * t * (3 - 2 * t);
  };

  return {
    portal,
    group,
    passage: true,
    aperture,
    triggerCenter: new THREE.Vector3(portal.position[0], portal.position[1], portal.position[2]),
    triggerRadius: CROSSING_RADIUS,
    openingRadius: CROSSING_RADIUS,
    portalCenterY: 0,
    useFullOrientation: true,
    arrivalSpawn: DOME_ARRIVAL_SPAWN,
    setPlayerPosition: updateRevealFromPos,
    setProximity: (p) => {
      vortexUniforms.proximity.value = p;
      gateRingHover.value = 0.25 + p * 0.95;
      if (p > targetReveal) targetReveal = p;
    },
    update: (dt, elapsed) => {
      const k = dt > 0 ? Math.min(1, dt * 4.5) : 1;
      currentReveal += (targetReveal - currentReveal) * k;
      uReveal.value = currentReveal;
      halo.rotation.z = elapsed * 0.14;
      haloMat.opacity = 0.42 + currentReveal * 0.45 + Math.sin(elapsed * 2.1) * 0.08;
      ringMat.emissiveIntensity = 0.38 + currentReveal * 0.65 + Math.sin(elapsed * 1.7) * 0.08;
      domeLight.intensity = 3.5 + currentReveal * 4.0 + Math.sin(elapsed * 2.4) * 0.4;

      // Animate the summit threshold gateway ring & shimmer so entering the portal feels magnetic & unmistakable
      gateHalo.rotation.z = elapsed * 0.65;
      gateHalo.rotation.y = Math.sin(elapsed * 0.95) * 0.14;
      gateHaloMat.opacity = 0.68 + currentReveal * 0.28 + Math.sin(elapsed * 3.0) * 0.08;
      veilMat.opacity = 0.18 + currentReveal * 0.26 + Math.sin(elapsed * 2.8) * 0.06;
      sillMat.emissiveIntensity = 0.75 + currentReveal * 0.9 + Math.sin(elapsed * 2.6) * 0.15;
      gateLight.intensity = 3.8 + currentReveal * 4.2 + Math.sin(elapsed * 3.1) * 0.5;
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
      veilGeo.dispose();
      veilMat.dispose();
      sillGeo.dispose();
      sillMat.dispose();
      destLabel.dispose();
    },
  };
}
