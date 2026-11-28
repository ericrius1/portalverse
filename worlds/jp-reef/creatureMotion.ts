import type * as THREE from 'three/webgpu';
import { abs, float, mix, positionLocal, pow, sign, sin, smoothstep, vec3 } from 'three/tsl';

/** Bounded drift with no respawning seam, also deterministic in portal previews. */
export function jellyHeight(base: number, drift: number, phase: number, elapsed: number): number {
  return base + Math.sin(elapsed * drift * 0.35 + phase) * 2
    + Math.sin(elapsed * 2.1 + phase) * 0.12;
}

export function turtleSwim(clock: THREE.Node<'float'>) {
  const p = positionLocal;
  // The unrigged asset faces -X; flippers extend along +/-Z, below its shell.
  const fin = smoothstep(0.22, 0.4, abs(p.z))
    .mul(float(1).sub(smoothstep(0.08, 0.18, p.y)));
  const stroke = clock.mul(2.4).add(p.x.mul(3));
  return p.add(vec3(
    sin(stroke.add(1.2)).mul(fin).mul(0.035),
    sin(stroke).mul(fin).mul(0.11),
    sin(stroke.add(0.8)).mul(fin).mul(sign(p.z)).mul(0.035),
  ));
}

export function raySwim(clock: THREE.Node<'float'>) {
  const p = positionLocal;
  const wing = pow(smoothstep(0.07, 0.4, abs(p.z)), 1.4);
  const stroke = clock.mul(2).sub(abs(p.z).mul(4)).add(p.x.mul(3));
  const tail = smoothstep(0.35, 1.15, p.x);
  return p.add(vec3(0,
    sin(stroke).mul(wing).mul(0.14),
    sin(clock.mul(2).sub(p.x.mul(5))).mul(tail).mul(0.055),
  ));
}

/** A soft envelope on every edge, plus a fade before intersecting the surface. */
export function shaftEnvelope(u: THREE.Node<'float'>, v: THREE.Node<'float'>, height: THREE.Node<'float'>) {
  const edge = sin(u.mul(Math.PI));
  const sides = edge.mul(edge);
  const bottom = smoothstep(0, 0.35, v);
  const top = float(1).sub(smoothstep(0.68, 1, v));
  const surface = float(1).sub(smoothstep(21, 25.5, height));
  // Broad, softly varying width rather than a solid rectangular strip.
  return sides.mul(bottom).mul(top).mul(surface).mul(mix(float(0.65), float(1), sin(v.mul(Math.PI))));
}
