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

    // ---- 24-fold radial girih tessellation + staggered dual muqarnas lattice
    const radialRepeats = float(24.0);
    const tierRepeats = float(10.0);
    const uCoord = theta.div(float(6.2831853)).add(0.5).mul(radialRepeats);
    const vCoord = rhoNorm.mul(tierRepeats);

    // Primary 8-point Rub el Hizb Islamic star lattice
    const cellA = fract(vec2(uCoord, vCoord)).sub(0.5);
    const idA = floor(vec2(uCoord, vCoord));
    const aA = abs(cellA);
    const pA = vec2(max(aA.x, aA.y), min(aA.x, aA.y));
    const sqA = max(pA.x, pA.y).sub(0.31);
    const rotA = pA.x.add(pA.y).mul(0.7071068).sub(0.31);
    const starA = min(sqA, rotA);
    const octA = max(sqA, rotA);

    // Staggered dual lattice (interlocking rosettes & kites between primary stars)
    const cellB = fract(vec2(uCoord.add(0.5), vCoord.add(0.5))).sub(0.5);
    const aB = abs(cellB);
    const pB = vec2(max(aB.x, aB.y), min(aB.x, aB.y));
    const sqB = max(pB.x, pB.y).sub(0.25);
    const rotB = pB.x.add(pB.y).mul(0.7071068).sub(0.25);
    const starB = min(sqB, rotB);

    // 16-fold Royal Shamsa sunburst rosette at the zenith crown
    const crownMask = smoothstep(float(0.26), float(0.06), rhoNorm);
    const petalWave = abs(cos(theta.mul(8.0).add(time.mul(0.04)))).mul(0.06)
      .add(abs(cos(theta.mul(16.0).sub(time.mul(0.03)))).mul(0.024));
    const shamsaRing = abs(rhoNorm.sub(float(0.15).add(petalWave)));
    const shamsaCore = abs(rhoNorm.sub(float(0.065).add(petalWave.mul(0.45))));
    const shamsaRays = pow(abs(cos(theta.mul(8.0))), float(18.0)).mul(crownMask);
    const shamsaLine = max(
      max(
        exp(shamsaRing.div(0.007).pow(2.0).negate()),
        exp(shamsaCore.div(0.006).pow(2.0).negate()),
      ),
      shamsaRays.mul(0.85),
    ).mul(smoothstep(float(0.34), float(0.14), rhoNorm));

    // Intricate interlacing strapwork & 24k gold filigree grout lines
    const lineA = exp(abs(starA).div(0.025).pow(2.0).negate());
    const innerLineA = exp(abs(octA.add(0.09)).div(0.020).pow(2.0).negate()).mul(0.85);
    const lineB = exp(abs(starB).div(0.023).pow(2.0).negate()).mul(0.9);
    const ribLine = exp(abs(cellA.x).div(0.015).pow(2.0).negate()).mul(0.28);
    const corniceFrieze = smoothstep(float(0.88), float(0.95), rhoNorm);
    const friezeArch = exp(abs(fract(uCoord.mul(2.0)).sub(0.5)).div(0.04).pow(2.0).negate()).mul(corniceFrieze);
    const goldGrouts = clamp(
      max(max(lineA, innerLineA), max(lineB, max(shamsaLine, max(ribLine, friezeArch)))),
      float(0.0),
      float(1.0),
    );

    // Per-tile deterministic hash for handcrafted Moroccan zellige color variation
    const hashDot = dot(idA, vec2(127.1, 311.7));
    const tileRand = fract(sin(hashDot).mul(43758.5453));
    const inStarA = step(starA, float(0.0));
    const inStarB = step(starB, float(0.0));

    // ---- Deep jewel-toned Moroccan Zellige palette tuned for ACES Filmic (Alhambra / Shah Mosque lusterware)
    const lapis = vec3(0.018, 0.055, 0.24);
    const turquoise = vec3(0.015, 0.26, 0.30);
    const emerald = vec3(0.012, 0.16, 0.12);
    const amethyst = vec3(0.11, 0.032, 0.22);
    const pearl = vec3(0.36, 0.31, 0.24);
    const gold = vec3(0.92, 0.62, 0.16);

    const fieldCol = mix(lapis, mix(emerald, amethyst, smoothstep(float(0.3), float(0.8), tileRand)), inStarB);
    const starCol = mix(turquoise, pearl, smoothstep(float(0.6), float(0.95), tileRand).mul(0.35));
    const baseTile = mix(fieldCol, starCol, inStarA);
    const enriched = mix(baseTile, mix(turquoise, gold, float(0.52)), crownMask.mul(0.55));

    // ---- True thin-film ceramic iridescence (rich metallic turquoise -> violet -> gold shimmer with view angle)
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(abs(dot(normalWorld, viewDir)), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(ndotv), 2.2);
    const iridPhase = tileRand.mul(0.45)
      .add(fresnel.mul(0.85))
      .add(rhoNorm.mul(0.6))
      .sub(time.mul(0.05));
    const spectrum = vec3(
      cos(iridPhase.mul(6.28318)).mul(0.5).add(0.5),
      cos(iridPhase.mul(6.28318).add(2.094)).mul(0.5).add(0.5),
      cos(iridPhase.mul(6.28318).add(4.188)).mul(0.5).add(0.5),
    );
    const luster = mix(enriched, enriched.mul(0.55).add(spectrum.mul(0.34)), float(0.22).add(fresnel.mul(0.55)));

    // Subtle alive portal shimmer pulsing through the gilded strapwork
    const breath = sin(time.mul(1.4).sub(rhoNorm.mul(6.0))).mul(0.5).add(0.5);
    const goldShimmer = gold.mul(float(1.05).add(breath.mul(0.38)).add(fresnel.mul(0.55)));
    let col = mix(luster, goldShimmer, goldGrouts);
    col = col.add(uAccentA.mul(inStarA.mul(0.08).mul(breath)));

    // ---- Sacred-geometry star-by-star dissolve as the player climbs closer (uReveal: 0 -> 1)
    // Uses continuous star SDF + scalloped radial petal wave (no boxy grid squares!):
    // the royal Shamsa crown blooms open first, then each interlocking Islamic star melts away in molten gold.
    const petalRipple = cos(theta.mul(12.0)).mul(0.035).add(sin(theta.mul(24.0).add(rhoNorm.mul(8.0))).mul(0.015));
    const starShape = clamp(starA.mul(0.35).add(starB.mul(0.20)), float(-0.14), float(0.14));
    const tileOrder = rhoNorm.mul(0.82)
      .add(petalRipple)
      .add(starShape)
      .add(tileRand.mul(0.06))
      .add(goldGrouts.mul(0.07));
    const wave = uReveal.mul(1.22);
    const dissolve = smoothstep(tileOrder.sub(0.065), tileOrder.add(0.065), wave);

    // Keep the lower golden arabesque cornice frieze glowing as a royal frame around the giant open portal
    const keepBorder = smoothstep(float(0.90), float(0.965), rhoNorm);
    const effectiveDissolve = dissolve.mul(float(1.0).sub(keepBorder.mul(0.88)));

    // Molten iridescent gold + portal-accent flare right along the dissolving geometric star rim
    const edgeGlow = smoothstep(float(0.0), float(0.45), effectiveDissolve)
      .mul(smoothstep(float(1.0), float(0.45), effectiveDissolve));
    const edgeColor = mix(gold, mix(uAccentA, uAccentB, float(0.35)), float(0.42)).mul(2.4);
    col = col.add(edgeColor.mul(edgeGlow));

    const closedAlpha = float(0.985).sub(inStarA.mul(0.03).mul(breath));
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
    // From the boardwalk, podium floor, and lower spiral (dist >= 20 m): full Arabic mosaic is intact (reveal = 0).
    // As you climb the upper half of the spiral (dist 20 m -> 8.5 m) or fly up toward the dome:
    // the Arabic geometric stars melt away in molten gold to reveal the live next room spanning the whole dome!
    const dx = pos.x - portal.position[0];
    const dy = (pos.y + 1.4) - portal.position[1];
    const dz = pos.z - portal.position[2];
    const dist = Math.hypot(dx, dy, dz);
    const t = THREE.MathUtils.clamp((20.0 - dist) / (20.0 - 8.5), 0, 1);
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
