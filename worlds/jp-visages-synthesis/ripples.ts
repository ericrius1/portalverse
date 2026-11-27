import { COBBLE_TEX_SIZE, STONE_NOISE_SIZE } from './textures';

export const RIPPLE_CAPACITY = 12;
export const RIPPLE_LIFETIME = 3;
export interface Ripple { x: number; z: number; born: number; strength: number }
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Match repeat + bilinear sampling used by the liquid's shader textures. */
export function sampleChannel(data: Uint8Array, size: number, u: number, v: number, channel: number): number {
  const x = (u - Math.floor(u)) * size - 0.5, y = (v - Math.floor(v)) * size - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const read = (a: number, b: number) => data[(((b + size) % size) * size + (a + size) % size) * 4 + channel] / 255;
  return (read(ix, iy) * (1 - fx) + read(ix + 1, iy) * fx) * (1 - fy)
    + (read(ix, iy + 1) * (1 - fx) + read(ix + 1, iy + 1) * fx) * fy;
}

/** CPU counterpart of poolRaw: footsteps only disturb visible liquid. */
export function poolCoverage(x: number, z: number, noise: Uint8Array, cobble: Uint8Array): number {
  const sample = (u: number, v: number, c: number) => sampleChannel(noise, STONE_NOISE_SIZE, u, v, c);
  const br = sample(x * .024, z * .024, 0), bg = sample(x * .024, z * .024, 1);
  const mr = sample(x * .11 + .31, z * .11 + .17, 0);
  const wx = (bg - .5) * .12, wz = (mr - .5) * .12;
  const a = sample(x * .036 + wx, z * .036 + wz, 0);
  const b = sample(x * .072 + .42 - wx * .6, z * .072 + .81 - wz * .6, 1);
  const edge = sampleChannel(cobble, COBBLE_TEX_SIZE, x * .165 + (br - .5) * .032, z * .165 + (bg - .5) * .032, 0);
  // Only use the unambiguous central road for the small mortar-wicking term.
  const path = 1 - smooth(4.45, 5.95, Math.abs(x));
  const creep = (1 - smooth(.06, .21, edge)) * path * .034;
  const clear = smooth(2.4, 7.6, Math.hypot(x, z - 36.25)) * smooth(2.4, 7.6, Math.hypot(x, z + 36.25));
  const corridor = 1 - smooth(8.5, 22, Math.abs(x));
  return smooth(.542, .58, (a * .62 + b * .38) * (.64 + corridor * .36) * (.56 + clear * .44) + creep);
}

/** Bounded footstep history; ripple origins never move after emission. */
export class RippleTrail {
  readonly impacts: Ripple[] = Array.from({ length: RIPPLE_CAPACITY }, () => ({ x: 0, z: 0, born: -100, strength: 0 }));
  private last?: { x: number; z: number; grounded: boolean };
  private travelled = 0;
  private lastStep = -100;
  private next = 0;
  private side = 1;
  reset() {
    this.last = undefined;
    this.travelled = 0;
    this.lastStep = -100;
    for (const impact of this.impacts) impact.strength = 0;
  }
  update(x: number, y: number, z: number, ground: number, now: number, wet: (x: number, z: number) => boolean) {
    const grounded = Math.abs(y - ground) < .12;
    const previous = this.last;
    this.last = { x, z, grounded };
    if (!previous) return;
    const dx = x - previous.x, dz = z - previous.z, distance = Math.hypot(dx, dz);
    if (!grounded || distance > 3) { this.travelled = 0; return; }
    this.travelled += distance;
    const landed = !previous.grounded;
    if (!landed && (this.travelled < .85 || now - this.lastStep < .18)) return;
    if (!landed && distance < .001) return;
    this.travelled = 0;
    this.lastStep = now;
    const scale = distance > .001 ? .16 * this.side / distance : 0;
    const px = x - dz * scale, pz = z + dx * scale;
    this.side *= -1;
    if (!wet(px, pz)) return;
    Object.assign(this.impacts[this.next], { x: px, z: pz, born: now, strength: landed ? 1 : .75 });
    this.next = (this.next + 1) % RIPPLE_CAPACITY;
  }
}
