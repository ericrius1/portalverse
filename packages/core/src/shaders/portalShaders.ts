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
 * Swirling WebGPU TSL portal event-horizon shader shown inside a portal opening
 * until a live destination view or snapshot replaces it.
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
 * Traveling holographic energy band shader for portal rings.
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
 * Architectural blueprint/studio grid floor (Eric's room).
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
