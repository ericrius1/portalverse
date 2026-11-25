import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  vec3,
  vec4,
  float,
  uv,
  time,
  sin,
  cos,
  atan,
  length,
  mix,
  pow,
  dot,
  normalize,
  max,
  smoothstep,
  fract,
  abs,
  exp,
  clamp,
  positionLocal,
  positionWorld,
  normalWorld,
  cameraPosition,
} from 'three/tsl';

export interface PortalVortexUniforms {
  colorA: { value: THREE.Color };
  colorB: { value: THREE.Color };
  hover: { value: number };
  proximity: { value: number };
}

/**
 * Swirling WebGPU TSL portal event-horizon shader used inside arches, blooming
 * solarpunk petals, and magic fountain basins.
 */
export function createPortalVortexMaterial(
  hexA = '#22d3ee',
  hexB = '#a855f7',
): { material: THREE.MeshBasicNodeMaterial; uniforms: PortalVortexUniforms } {
  const colorA = uniform(new THREE.Color(hexA));
  const colorB = uniform(new THREE.Color(hexB));
  const hover = uniform(0.0);
  const proximity = uniform(0.0);

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;

  const vortexFn = Fn(() => {
    const centered = uv().sub(0.5).mul(2.0);
    const dist = length(centered);
    const angle = atan(centered.y, centered.x);

    const speed = float(1.8).add(hover.mul(1.6)).add(proximity.mul(2.4));
    const swirl = angle.add(dist.mul(5.2)).sub(time.mul(speed));
    const counterSwirl = angle.mul(3.0).sub(dist.mul(7.0)).add(time.mul(speed.mul(0.75)));

    const arms = sin(swirl.mul(3.0)).mul(0.5).add(0.5);
    const filaments = sin(counterSwirl.mul(2.0).add(sin(dist.mul(12.0).sub(time.mul(4.0))))).mul(0.5).add(0.5);
    const ripple = sin(dist.mul(18.0).sub(time.mul(5.5))).mul(0.5).add(0.5);

    const energy = arms.mul(0.55).add(filaments.mul(0.35)).add(ripple.mul(0.25));
    const coreGlow = exp(dist.negate().mul(2.4)).mul(1.35);
    const rimRing = smoothstep(float(0.62), float(0.92), dist).mul(smoothstep(float(1.0), float(0.84), dist));

    const mixed = mix(colorB, colorA, clamp(energy, 0.0, 1.0));
    const boost = float(1.15).add(hover.mul(0.45)).add(proximity.mul(0.7));
    const brightCore = vec3(0.96, 0.99, 1.0).mul(coreGlow.mul(0.75));
    const rimGlow = colorA.mul(rimRing.mul(2.4));

    const finalRgb = mixed.mul(boost.mul(float(0.65).add(energy.mul(0.65)))).add(brightCore).add(rimGlow);

    const alphaEdge = smoothstep(float(1.0), float(0.72), dist);
    const alpha = clamp(alphaEdge.mul(float(0.82).add(coreGlow.mul(0.2)).add(hover.mul(0.12))), 0.0, 1.0);

    return vec4(finalRgb, alpha);
  });

  const vortexOut = vortexFn();
  material.colorNode = vortexOut.xyz;
  material.opacityNode = vortexOut.w;

  return { material, uniforms: { colorA, colorB, hover, proximity } };
}

/**
 * Traveling holographic energy band shader for portal arches, astrolabes, and fountain rings.
 */
export function createEnergyRingMaterial(
  hexA = '#38bdf8',
  hexB = '#c084fc',
): { material: THREE.MeshStandardNodeMaterial; hover: { value: number } } {
  const colorA = uniform(new THREE.Color(hexA));
  const colorB = uniform(new THREE.Color(hexB));
  const hover = uniform(0.0);

  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.25,
    metalness: 0.65,
  });

  material.colorNode = vec4(mix(colorB, colorA, float(0.5)).mul(0.4), 1.0);
  material.emissiveNode = Fn(() => {
    const u = uv();
    const band1 = sin(u.x.mul(18.8495).sub(time.mul(3.4))).mul(0.5).add(0.5);
    const band2 = sin(u.x.mul(6.2831).add(time.mul(1.8))).mul(0.5).add(0.5);
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = max(dot(normalWorld, viewDir), 0.0);
    const fresnel = pow(float(1.0).sub(ndotv), 2.5);

    const pulse = pow(band1, 2.5).mul(0.85).add(band2.mul(0.35)).add(fresnel.mul(0.9));
    const col = mix(colorB, colorA, band2);
    return col.mul(pulse.mul(float(1.25).add(hover.mul(1.1))));
  })();

  return { material, hover };
}

/**
 * Glowing blue magic fountain plume shader — rising liquid magic arcs with upward-streaming
 * bioluminescent foam streaks, Fresnel glow, and vertex wave shimmer.
 */
export function createMagicFountainPlumeMaterial(
  hexCore = '#38bdf8',
  hexGlow = '#60a5fa',
): {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: {
    colorCore: { value: THREE.Color };
    colorGlow: { value: THREE.Color };
    hover: { value: number };
    phase: { value: number };
  };
} {
  const colorCore = uniform(new THREE.Color(hexCore));
  const colorGlow = uniform(new THREE.Color(hexGlow));
  const hover = uniform(0.0);
  const phase = uniform(0.0);

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;

  material.positionNode = Fn(() => {
    const pos = positionLocal.toVar();
    const h = uv().y;
    const flutter = sin(h.mul(10.0).sub(time.mul(7.0)).add(phase)).mul(0.09).mul(h);
    const sway = cos(h.mul(6.0).sub(time.mul(4.5)).add(phase)).mul(0.07).mul(h);
    pos.x.addAssign(flutter);
    pos.z.addAssign(sway);
    return pos;
  })();

  const fragFn = Fn(() => {
    const u = uv();
    const flowY = u.y.mul(4.5).sub(time.mul(3.6)).add(phase);
    const streak1 = sin(u.x.mul(25.1327).add(sin(flowY.mul(2.0)))).mul(0.5).add(0.5);
    const streak2 = sin(flowY.mul(6.0).add(u.x.mul(12.566))).mul(0.5).add(0.5);
    const surge = sin(u.y.mul(5.0).sub(time.mul(5.2)).add(phase)).mul(0.5).add(0.5);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = max(abs(dot(normalWorld, viewDir)), 0.0);
    const fresnel = pow(float(1.0).sub(ndotv), 1.8);

    const fadeEnds = smoothstep(float(0.0), float(0.14), u.y).mul(smoothstep(float(1.0), float(0.72), u.y));
    const foam = pow(streak1.mul(streak2), 1.4).add(surge.mul(0.45)).add(fresnel.mul(0.8));

    const col = mix(colorGlow, colorCore, clamp(foam, 0.0, 1.0))
      .add(vec3(0.7, 0.93, 1.0).mul(pow(surge, 3.0).mul(0.65)))
      .mul(float(1.15).add(hover.mul(0.95)));

    const alpha = clamp(fadeEnds.mul(float(0.28).add(foam.mul(0.58)).add(hover.mul(0.2))), 0.0, 0.95);
    return vec4(col, alpha);
  });

  const fragOut = fragFn();
  material.colorNode = fragOut.xyz;
  material.opacityNode = fragOut.w;

  return { material, uniforms: { colorCore, colorGlow, hover, phase } };
}

/**
 * Luminous rippling water surface for the Fountains Grid sky-plaza basins.
 */
export function createMagicWaterPoolMaterial(hexDeep = '#041428', hexShimmer = '#38bdf8'): THREE.MeshStandardNodeMaterial {
  const deepCol = uniform(new THREE.Color(hexDeep));
  const shimmerCol = uniform(new THREE.Color(hexShimmer));

  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.12,
    metalness: 0.35,
  });

  material.positionNode = Fn(() => {
    const pos = positionLocal.toVar();
    const w1 = sin(pos.x.mul(0.35).add(time.mul(1.8))).mul(0.08);
    const w2 = cos(pos.z.mul(0.35).sub(time.mul(1.4))).mul(0.08);
    pos.y.addAssign(w1.add(w2));
    return pos;
  })();

  material.colorNode = Fn(() => {
    const p = positionWorld.xz;
    // Grid-aligned concentric fountain ripples every 14m
    const cell = fract(p.div(14.0).add(0.5)).sub(0.5);
    const ringDist = length(cell);
    const ripple = sin(ringDist.mul(36.0).sub(time.mul(4.5))).mul(0.5).add(0.5);
    const ringMask = exp(ringDist.negate().mul(4.5));
    const col = mix(deepCol, shimmerCol, ringMask.mul(ripple).mul(0.55));
    return vec4(col, 1.0);
  })();

  material.emissiveNode = Fn(() => {
    const p = positionWorld.xz;
    const cell = fract(p.div(14.0).add(0.5)).sub(0.5);
    const ringDist = length(cell);
    const ripple = pow(sin(ringDist.mul(32.0).sub(time.mul(4.5))).mul(0.5).add(0.5), 3.0);
    const ringGlow = exp(ringDist.negate().mul(5.2)).mul(ripple);

    // Subtle luminous basin grid lines
    const gridEdge = max(
      smoothstep(float(0.475), float(0.498), abs(cell.x)),
      smoothstep(float(0.475), float(0.498), abs(cell.y)),
    );

    return shimmerCol.mul(ringGlow.mul(1.35).add(gridEdge.mul(0.45)));
  })();

  return material;
}

/**
 * Architectural blueprint/studio grid floor for placeholder rooms & Nexus plaza.
 */
export function createStudioGridFloorMaterial(
  hexBase = '#090e1a',
  hexLine = '#22d3ee',
  cellSize = 2.0,
): THREE.MeshStandardNodeMaterial {
  const baseCol = uniform(new THREE.Color(hexBase));
  const lineCol = uniform(new THREE.Color(hexLine));
  const spacing = uniform(cellSize);

  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.42,
    metalness: 0.3,
  });

  material.colorNode = vec4(baseCol, 1.0);

  material.emissiveNode = Fn(() => {
    const p = positionWorld.xz;
    const g = abs(fract(p.div(spacing).add(0.5)).sub(0.5));
    const major = abs(fract(p.div(spacing.mul(4.0)).add(0.5)).sub(0.5));

    const minorLine = max(
      smoothstep(float(0.04), float(0.0), g.x),
      smoothstep(float(0.04), float(0.0), g.y),
    );
    const majorLine = max(
      smoothstep(float(0.025), float(0.0), major.x),
      smoothstep(float(0.025), float(0.0), major.y),
    );

    const radialDist = length(p);
    const radialPulse = sin(radialDist.mul(0.55).sub(time.mul(1.8))).mul(0.5).add(0.5);
    const fade = smoothstep(float(42.0), float(8.0), radialDist);

    const intensity = minorLine.mul(0.22).add(majorLine.mul(0.55)).mul(float(0.65).add(radialPulse.mul(0.35))).mul(fade);
    return lineCol.mul(intensity);
  })();

  return material;
}
