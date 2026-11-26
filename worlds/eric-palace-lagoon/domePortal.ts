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
  exp,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { PortalDefinition, PortalVisualHandle } from '@portalverse/core/types';
import { createPortalVortexMaterial } from '@portalverse/core/shaders/portalShaders';
import { PALACE, ROTUNDA } from './layout';
import { DOME_ARRIVAL_SPAWN, DOME_PORTAL_Y } from './path/curve';

/**
 * Full-dome exit portal for the Palace of Fine Arts rotunda.
 *
 * The entire inner dome vault (34 m wide, arching from y = 25.5 m to y = 42.6 m) is a giant custom
 * live portal aperture looking into the next room in the Portalverse loop. Draped inside it is a
 * procedural WebGPU TSL shell of iridescent Arabic / Moroccan zellige & girih geometric star tiles:
 * from the boardwalk and podium floor below, the dome gleams as a gilded cobalt-turquoise-emerald
 * mosaic vault; as you ascend the arching celestial sky-path (or fly up toward the dome), the tiles
 * dissolve radially tile-by-tile in a molten-gold wave from the crown rosette outward to reveal the
 * live destination world spanning the entire dome roof.
 */

const DOME_RADIUS = 17.15;
const MOSAIC_RADIUS = 16.90;
const DOME_BASE_OFFSET_Z = DOME_PORTAL_Y - (ROTUNDA.domeFoot + 0.1); // ~0.7 m below crossing plane -> y = 25.5 m
const CROSSING_RADIUS = 15.6;

/**
 * Create an inward-facing hemispherical dome geometry oriented in portal-local space:
 * local +Z points DOWN into the rotunda (toward the viewer), local -Z arches UP to the dome crown.
 * Winding is reversed so THREE.FrontSide faces INWARD (matching PortalPreviews' oneWay FrontSide).
 */
function createInwardDomeGeometry(radius: number, widthSegs: number, heightSegs: number): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(radius, widthSegs, heightSegs, 0, Math.PI * 2, 0, Math.PI * 0.495);
  // Rotate so the north pole (0, +R, 0) moves to (0, 0, -R) (world +Y when group.rotation.x = +PI/2)
  geo.rotateX(-Math.PI / 2);
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

/** Procedural iridescent Arabic / Moroccan zellige & girih dome mosaic shader with tile-by-tile proximity fade. */
function createArabicMosaicMaterial(colorA: string, colorB: string) {
  const uReveal = uniform(0.0);
  const uAccentA = uniform(new THREE.Color(colorA));
  const uAccentB = uniform(new THREE.Color(colorB));

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.FrontSide;
  material.fog = false;

  const mosaicFn = Fn(() => {
    // Local dome coordinates (crown at z = DOME_BASE_OFFSET_Z - R, base cornice at z = DOME_BASE_OFFSET_Z)
    const lp = positionLocal.sub(vec3(0.0, 0.0, DOME_BASE_OFFSET_Z));
    const nDir = normalize(lp);
    const theta = atan(nDir.y, nDir.x); // -pi .. pi around dome
    const elev = clamp(nDir.z.negate(), float(0.0), float(1.0)); // 0 at base, 1 at crown
    const rho = acos(elev); // 0 at crown, pi/2 at base
    const rhoNorm = clamp(rho.div(float(1.5707963)), float(0.0), float(1.0));

    // ---- 16-fold radial girih tessellation + staggered dual muqarnas lattice
    const radialRepeats = float(16.0);
    const tierRepeats = float(7.0);
    const uCoord = theta.div(float(6.2831853)).add(0.5).mul(radialRepeats);
    const vCoord = rhoNorm.mul(tierRepeats);

    // Primary star lattice
    const cellA = fract(vec2(uCoord, vCoord)).sub(0.5);
    const idA = floor(vec2(uCoord, vCoord));
    const aA = abs(cellA);
    const pA = vec2(max(aA.x, aA.y), min(aA.x, aA.y));
    // 8-point Rub el Hizb Islamic star SDF (union of square and 45°-rotated square)
    const sqA = max(pA.x, pA.y).sub(0.30);
    const rotA = pA.x.add(pA.y).mul(0.7071068).sub(0.30);
    const starA = min(sqA, rotA);
    const octA = max(sqA, rotA);

    // Staggered dual lattice (interlocking rosettes & kites between primary stars)
    const cellB = fract(vec2(uCoord.add(0.5), vCoord.add(0.5))).sub(0.5);
    const aB = abs(cellB);
    const pB = vec2(max(aB.x, aB.y), min(aB.x, aB.y));
    const sqB = max(pB.x, pB.y).sub(0.24);
    const rotB = pB.x.add(pB.y).mul(0.7071068).sub(0.24);
    const starB = min(sqB, rotB);

    // 16-fold Royal Shamsa sunburst rosette at the zenith crown
    const crownMask = smoothstep(float(0.26), float(0.08), rhoNorm);
    const petalWave = abs(cos(theta.mul(8.0).add(time.mul(0.04)))).mul(0.065)
      .add(abs(cos(theta.mul(16.0).sub(time.mul(0.03)))).mul(0.025));
    const shamsaRing = abs(rhoNorm.sub(float(0.14).add(petalWave)));
    const shamsaCore = abs(rhoNorm.sub(float(0.06).add(petalWave.mul(0.45))));
    const shamsaLine = max(
      exp(shamsaRing.div(0.008).pow(2.0).negate()),
      exp(shamsaCore.div(0.007).pow(2.0).negate()),
    ).mul(smoothstep(float(0.34), float(0.16), rhoNorm));

    // Intricate interlacing strapwork & gold filigree grout lines
    const lineA = exp(abs(starA).div(0.024).pow(2.0).negate());
    const innerLineA = exp(abs(octA.add(0.085)).div(0.020).pow(2.0).negate()).mul(0.8);
    const lineB = exp(abs(starB).div(0.022).pow(2.0).negate()).mul(0.85);
    const ribLine = exp(abs(cellA.x).div(0.016).pow(2.0).negate()).mul(0.32);
    const corniceFrieze = smoothstep(float(0.88), float(0.95), rhoNorm);
    const friezeArch = exp(abs(fract(uCoord.mul(2.0)).sub(0.5)).div(0.04).pow(2.0).negate()).mul(corniceFrieze);
    const goldGrouts = clamp(
      max(max(lineA, innerLineA), max(lineB, max(shamsaLine, max(ribLine, friezeArch)))),
      float(0.0),
      float(1.0),
    );

    // Per-tile deterministic hash for rich handcrafted zellige color variation & staggered tile dissolve
    const hashDot = dot(idA, vec2(127.1, 311.7));
    const tileRand = fract(sin(hashDot).mul(43758.5453));
    const inStarA = step(starA, float(0.0));
    const inStarB = step(starB, float(0.0));

    // ---- Handcrafted Moroccan Zellige palette: lapis, turquoise, emerald, ivory-pearl, 24k gold
    const lapis = vec3(0.055, 0.14, 0.44);
    const turquoise = vec3(0.06, 0.54, 0.58);
    const emerald = vec3(0.04, 0.36, 0.28);
    const amethyst = vec3(0.24, 0.10, 0.42);
    const ivory = vec3(0.88, 0.80, 0.64);
    const gold = vec3(1.0, 0.78, 0.30);

    const fieldCol = mix(lapis, mix(emerald, amethyst, smoothstep(float(0.3), float(0.8), tileRand)), inStarB);
    const starCol = mix(turquoise, ivory, smoothstep(float(0.55), float(0.92), tileRand).mul(0.45));
    const baseTile = mix(fieldCol, starCol, inStarA);
    // Warm sunlit-gold enrichment near the crown shamsa and cornice frieze
    const enriched = mix(baseTile, mix(turquoise, gold, float(0.48)), crownMask.mul(0.55));

    // ---- True thin-film ceramic iridescence (shifts across turquoise -> violet -> gold with view angle)
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(abs(dot(normalWorld, viewDir)), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(ndotv), 2.4);
    const iridPhase = tileRand.mul(0.45)
      .add(fresnel.mul(0.95))
      .add(rhoNorm.mul(0.55))
      .sub(time.mul(0.045));
    const spectrum = vec3(
      cos(iridPhase.mul(6.28318)).mul(0.5).add(0.5),
      cos(iridPhase.mul(6.28318).add(2.094)).mul(0.5).add(0.5),
      cos(iridPhase.mul(6.28318).add(4.188)).mul(0.5).add(0.5),
    );
    const luster = mix(enriched, enriched.mul(0.52).add(spectrum.mul(0.68)), float(0.28).add(fresnel.mul(0.58)));

    // Subtle alive portal shimmer pulsing softly through the star filigree even from far below
    const breath = sin(time.mul(1.4).sub(rhoNorm.mul(6.0))).mul(0.5).add(0.5);
    const goldShimmer = gold.mul(float(1.15).add(breath.mul(0.45)).add(fresnel.mul(0.6)));
    let col = mix(luster, goldShimmer, goldGrouts);
    col = col.add(uAccentA.mul(inStarA.mul(0.14).mul(breath)));

    // ---- Sacred-geometry tile-by-tile dissolve as the player climbs closer (uReveal: 0 -> 1)
    // Crown shamsa dissolves first, rippling outward down the tiers; individual tiles staggered by tileRand;
    // star centers open a beat before their surrounding gold strapwork.
    const tileOrder = rhoNorm.mul(0.76)
      .add(tileRand.mul(0.20))
      .add(goldGrouts.mul(0.08))
      .sub(inStarA.mul(0.04));
    const wave = uReveal.mul(1.24);
    const dissolve = smoothstep(tileOrder.sub(0.075), tileOrder.add(0.075), wave);

    // Keep the lower golden arabesque cornice frieze glowing as a royal frame around the giant open portal
    const keepBorder = smoothstep(float(0.89), float(0.96), rhoNorm);
    const effectiveDissolve = dissolve.mul(float(1.0).sub(keepBorder.mul(0.88)));

    // Molten iridescent gold + portal-accent flare right along the dissolving tile rim
    const edgeGlow = smoothstep(float(0.0), float(0.45), effectiveDissolve)
      .mul(smoothstep(float(1.0), float(0.45), effectiveDissolve));
    const edgeColor = mix(gold, mix(uAccentA, uAccentB, float(0.35)), float(0.42)).mul(2.8);
    col = col.add(edgeColor.mul(edgeGlow));

    // When fully closed (uReveal = 0), tiny jewel star-pinholes still breathe softly;
    // as uReveal -> 1, the entire dome tiles fade away cleanly to alpha = 0 to reveal the live next room!
    const closedAlpha = float(0.97).sub(inStarA.mul(0.05).mul(breath));
    const alpha = clamp(closedAlpha.mul(float(1.0).sub(effectiveDissolve)), float(0.0), float(1.0));

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
 * Create the Palace Lagoon's giant dome-roof exit portal replacing the standard route gate ring.
 */
export function createDomePortal(gate: PortalDefinition): DomePortalHandle {
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

  // 2. Iridescent Arabic / Moroccan geometric mosaic shell that dissolves tile-by-tile as you get closer
  const mosaicGeo = createInwardDomeGeometry(MOSAIC_RADIUS, 72, 36);
  const { material: mosaicMat, uReveal } = createArabicMosaicMaterial(portal.colorA!, portal.colorB!);
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

  // Subtle warm-gold interior light washing the upper dome cornice
  const domeLight = new THREE.PointLight(new THREE.Color('#fbbf24'), 4.0, 32, 1.4);
  domeLight.position.set(0, 0, DOME_BASE_OFFSET_Z + 3.5);
  group.add(domeLight);

  let targetReveal = 0;
  let currentReveal = 0;

  const updateRevealFromPos = (pos: THREE.Vector3 | null) => {
    if (!pos) {
      targetReveal = 0;
      return;
    }
    // Distance from the dome crossing center (0, 26.2, -14):
    // From the boardwalk / podium floor (dist >= 27 m): mosaic is 100% intact (reveal = 0).
    // As you climb the trippy spiral arch (dist 26 m -> 9.5 m) or fly up toward the dome:
    // the Arabic geometric tiles fade away tile-by-tile to reveal the live next room across the whole dome!
    const dx = pos.x - portal.position[0];
    const dy = (pos.y + 1.4) - portal.position[1];
    const dz = pos.z - portal.position[2];
    const dist = Math.hypot(dx, dy, dz);
    const t = THREE.MathUtils.clamp((26.5 - dist) / (26.5 - 9.5), 0, 1);
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
      // Fallback if room's onUpdate hasn't pushed player position yet
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
    },
  };
}
