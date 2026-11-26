import { LAGOON, WATER_Y, lagoonSdf, terrainHeight } from '../layout';
import type { V3 } from '../timeOfDay';

/**
 * The lagoon's big birds, each a little state machine on the CPU (a dozen of them: nothing to it), written once a frame
 * into the storage buffer birds.wgsl draws them from (16 floats a bird, its `Bird`):
 *   great egrets  stalking the shallows along the banks, slow steps and long stillness, a strike now and then; up and
 *                 away when you come near (deep slow beats, the neck drawn in, the legs trailed), and one lifting off
 *                 of its own accord now and then; they circle round and come down with a flare elsewhere on the shore
 *   a great heron the statue on the far bank, warier than the egrets
 *   mute swans    a pair and one alone gliding the open water on long slow curves (their wakes: wake.wgsl), dabbling,
 *                 drifting away from someone wading out to them
 *   a peregrine   circling high over the murmuration at sunset, stooping through it now and then (flock.ts takes its
 *                 place: the flock's fear), gone as the light goes
 */

export const EGRET = 1, HERON = 2, SWAN = 3, FALCON = 4;
const WADE = 0, FLY = 1, SWIM = 2, SOAR = 3, STOOP = 4, CLIMB = 5;
export const BIRD_FLOATS = 16;

interface Big {
  sp: number;
  state: number;
  x: number; y: number; z: number;
  heading: number; pitch: number; bank: number;
  speed: number; vy: number;
  phase: number; amp: number; fold: number;
  neck: number; neckGoal: number;
  vis: number; size: number; variant: number;
  /** where it's going: a spot on the shore, the swan's circle (cx, cz, r, which way) */
  tx: number; tz: number;
  cx: number; cz: number; cr: number; spin: number; ang: number;
  /** timers: till it next does something, till it next lifts off of its own accord, a strike's */
  t: number; lift: number; strike: number;
  walk: number;
  id: number;
}

const turn = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

let seedState = 20261126;
function rnd(): number {
  seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0;
  return seedState / 4294967296;
}

/** The shallows a wader can stand in (water 6-28 cm deep), found once a session on a 1 m grid along the shore (a few
 *  ms the first time). */
const SHALLOWS: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let x = LAGOON.x - LAGOON.rx - 4; x <= LAGOON.x + LAGOON.rx + 4; x += 1.1) {
    for (let z = LAGOON.z - LAGOON.rz - 4; z <= LAGOON.z + LAGOON.rz + 4; z += 1.1) {
      // (only the band along the shore is worth the land's whole height function)
      const s = lagoonSdf(x, z);
      if (s < -0.5 || s > 4) continue;
      const d = WATER_Y - terrainHeight(x, z);
      if (d > 0.06 && d < 0.28) out.push([x, z]);
    }
  }
  return out;
})();

function shallowNear(x: number, z: number, rMin: number, rMax: number, avoid: V3 | null, avoidR: number): [number, number] {
  for (let i = 0; i < 60; i++) {
    const s = SHALLOWS[(rnd() * SHALLOWS.length) | 0];
    if (!s) break;
    const d = Math.hypot(s[0] - x, s[1] - z);
    if (d < rMin || d > rMax) continue;
    if (avoid && Math.hypot(s[0] - avoid[0], s[1] - avoid[2]) < avoidR) continue;
    return s;
  }
  return SHALLOWS.length ? SHALLOWS[(rnd() * SHALLOWS.length) | 0] : [LAGOON.x - LAGOON.rx + 2, LAGOON.z];
}

/** the west bank's shallows, within sight of the walk (x < 70, |z| < 60) */
function westShallow(): [number, number] {
  for (let i = 0; i < 200; i++) {
    const s = SHALLOWS[(rnd() * SHALLOWS.length) | 0];
    if (s && s[0] < LAGOON.x - 6 && Math.abs(s[1] + 4) < 58) return s;
  }
  return shallowNear(LAGOON.x, LAGOON.z, 0, 1e9, null, 0);
}

function make(sp: number, id: number): Big {
  return {
    sp, state: WADE, x: 0, y: 0, z: 0, heading: rnd() * 6.283, pitch: 0, bank: 0, speed: 0, vy: 0,
    phase: rnd() * 6.283, amp: 0, fold: 1, neck: 0, neckGoal: 0, vis: 1, size: 0.92 + rnd() * 0.16, variant: 0,
    tx: 0, tz: 0, cx: 0, cz: 0, cr: 0, spin: 1, ang: 0, t: 2 + rnd() * 8, lift: 50 + rnd() * 120, strike: 0, walk: 0, id,
  };
}

export interface WaderFrame {
  dt: number;
  time: number;
  dusk: number;
  night: number;
  player: V3 | null;
  /** the murmuration's middle, for the falcon to circle over and stoop at */
  flock: V3;
  flockAloft: number;
}

export class Waders {
  readonly birds: Big[] = [];
  readonly data: Float32Array;
  /** the falcon (xyz) and how much the flock should fear it (0..1) */
  readonly falcon: [number, number, number, number] = [0, 200, 0, 0];
  /** the swans' indices (their wakes) */
  readonly swans: number[] = [];
  /** (dev: let the camera come close without flushing them) */
  tame = false;

  constructor() {
    for (let i = 0; i < 7; i++) {
      const b = make(EGRET, this.birds.length);
      const s = westShallow();
      b.x = s[0]; b.z = s[1]; b.y = terrainHeight(s[0], s[1]);
      b.heading = Math.atan2(LAGOON.z - b.z, LAGOON.x - b.x) + (rnd() - 0.5) * 2;
      this.birds.push(b);
    }
    {
      const b = make(HERON, this.birds.length);
      const s = shallowNear(LAGOON.x + LAGOON.rx, LAGOON.z - 20, 0, 40, null, 0);
      b.x = s[0]; b.z = s[1]; b.y = terrainHeight(s[0], s[1]);
      b.heading = Math.atan2(LAGOON.z - b.z, LAGOON.x - b.x);
      b.size = 1;
      this.birds.push(b);
    }
    // swans: a pair on one circle, one alone on another
    const circles: Array<[number, number, number, number]> = [[LAGOON.x - 8, LAGOON.z + 14, 13, 1], [LAGOON.x + 6, LAGOON.z - 38, 17, -1]];
    for (let i = 0; i < 3; i++) {
      const b = make(SWAN, this.birds.length);
      const c = circles[i < 2 ? 0 : 1];
      b.state = SWIM; b.cx = c[0]; b.cz = c[1]; b.cr = c[2]; b.spin = c[3];
      b.ang = rnd() * 6.283 + (i === 1 ? 0.25 : 0);
      if (i === 1) b.ang = this.birds[this.birds.length - 1].ang - 0.16;
      b.x = b.cx + Math.cos(b.ang) * b.cr; b.z = b.cz + Math.sin(b.ang) * b.cr; b.y = WATER_Y;
      b.neck = b.neckGoal = 0;
      b.size = i === 1 ? 0.9 : 1;
      this.swans.push(this.birds.length);
      this.birds.push(b);
    }
    {
      const b = make(FALCON, this.birds.length);
      b.state = SOAR; b.fold = 0; b.x = LAGOON.x; b.y = 65; b.z = LAGOON.z; b.cr = 38; b.speed = 13; b.t = 18 + rnd() * 10;
      b.neck = -1;
      this.birds.push(b);
    }
    this.data = new Float32Array(this.birds.length * BIRD_FLOATS);
  }

  get count(): number { return this.birds.length; }

  step(f: WaderFrame): void {
    const dt = Math.min(f.dt, 1 / 20);
    if (dt <= 0) return;
    let flying = 0;
    for (const b of this.birds) if ((b.sp === EGRET || b.sp === HERON) && b.state === FLY) flying++;
    for (const b of this.birds) {
      if (b.sp === SWAN) this.swim(b, dt, f);
      else if (b.sp === FALCON) this.hunt(b, dt, f);
      else if (b.state === WADE) this.wade(b, dt, f, flying);
      else this.flight(b, dt);
      b.neck += (b.neckGoal - b.neck) * Math.min(1, dt * (b.neckGoal > 1.5 ? 16 : b.neck > 1.5 ? 5 : 3));
    }
    this.write();
  }

  // ---------------------------------------------------------------- wading: stalking, striking, flushing
  private wade(b: Big, dt: number, f: WaderFrame, flying: number): void {
    const heron = b.sp === HERON;
    b.fold += (1 - b.fold) * Math.min(1, dt * 4);
    b.amp += (0 - b.amp) * Math.min(1, dt * 6);
    b.pitch *= 1 - Math.min(1, dt * 4);
    b.bank *= 1 - Math.min(1, dt * 4);
    b.y = terrainHeight(b.x, b.z);
    const sleepy = f.night > 0.88;
    // flushed: too close (a still player may come a little nearer)
    if (f.player && !this.tame) {
      const d = Math.hypot(f.player[0] - b.x, f.player[2] - b.z);
      const wary = heron ? 18 : 12.5;
      if (d < wary * (sleepy ? 0.7 : 1)) {
        b.neckGoal = 1;
        if (d < wary * (sleepy ? 0.55 : 0.8)) return this.takeOff(b, f.player);
      }
    }
    b.lift -= dt;
    if (b.lift < 0 && flying === 0 && !sleepy) return this.takeOff(b, null);
    b.t -= dt;
    b.strike -= dt;
    if (sleepy) { b.neckGoal = -1; b.walk = 0; return; }
    if (b.strike > 0) { b.neckGoal = b.strike > 0.25 ? 2 : 0.9; b.walk = 0; return; }
    if (b.t < 0) {
      // the next thing it does: a few steps along the shallows, a look round, a strike at a fish, or nothing
      const k = rnd();
      if (k < (heron ? 0.15 : 0.45)) {
        const s = shallowNear(b.x, b.z, 1, heron ? 3 : 5, f.player, 14);
        b.tx = s[0]; b.tz = s[1];
        b.walk = 1;
        b.neckGoal = 0.35;
        b.t = 4 + rnd() * 6;
      } else if (k < (heron ? 0.45 : 0.65)) {
        b.strike = 0.55 + rnd() * 0.3;
        b.t = 2 + rnd() * 3;
      } else {
        b.neckGoal = rnd() < 0.3 ? 1 : 0;
        b.t = (heron ? 6 : 3) + rnd() * 6;
      }
    }
    if (b.walk > 0) {
      const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
      const want = Math.atan2(dz, dx);
      const dh = turn(want - b.heading);
      b.heading = turn(b.heading + clamp(dh, -dt * 0.9, dt * 0.9));
      // (the slow high-stepping stalk: a step, a pause)
      const pace = (heron ? 0.1 : 0.16) * (0.5 + 0.5 * Math.max(0, Math.sin(f.time * 2.2 + b.id)));
      if (d < 0.15 || Math.abs(dh) > 0.6) { if (d < 0.15) b.walk = 0; b.speed = 0; }
      else b.speed = pace;
      b.x += Math.cos(b.heading) * b.speed * dt;
      b.z += Math.sin(b.heading) * b.speed * dt;
      b.phase += dt * (b.speed / 0.22) * Math.PI;
    } else b.speed = 0;
  }

  private takeOff(b: Big, from: V3 | null): void {
    b.state = FLY;
    b.walk = 0;
    b.strike = 0;
    const s = shallowNear(b.x, b.z, 28, 140, from, 40);
    b.tx = s[0]; b.tz = s[1];
    b.vy = 2.6;
    b.speed = 2.5;
    b.neckGoal = -1;
    if (from) b.heading = Math.atan2(b.z - from[2], b.x - from[0]);
    b.lift = 80 + rnd() * 140;
    b.t = 0;
  }

  /** flight from shore to shore: up, a long gentle curve over the water, down with a flare */
  private flight(b: Big, dt: number): void {
    const heron = b.sp === HERON;
    const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
    const ground = terrainHeight(b.x, b.z);
    const cruise = heron ? 7 : 7.5;
    const landing = d < 16;
    const flare = smooth(5, 0.6, d);
    const goalY = landing ? ground + Math.max(0, d - 1.2) * 0.42 : Math.max(ground, WATER_Y) + 7 + 2 * Math.sin(b.id + d * 0.05);
    const speed = landing ? mix(cruise, 1.2, flare) : cruise;
    const want = Math.atan2(dz, dx);
    const dh = clamp(turn(want - b.heading), -dt * 0.75, dt * 0.75);
    b.heading = turn(b.heading + dh);
    b.speed += (speed - b.speed) * Math.min(1, dt * 1.2);
    const vy = clamp((goalY - b.y) * 1.1, -2.2, 2.8);
    b.vy += (vy - b.vy) * Math.min(1, dt * 2.2);
    b.x += Math.cos(b.heading) * b.speed * dt;
    b.z += Math.sin(b.heading) * b.speed * dt;
    b.y += b.vy * dt;
    if (b.y < ground) b.y = ground;
    b.bank += (clamp((dh / dt) * b.speed * 0.12, -0.6, 0.6) - b.bank) * Math.min(1, dt * 2.5);
    const pitchGoal = clamp(Math.atan2(b.vy, Math.max(b.speed, 1)) * 0.7, -0.35, 0.35) + flare * 0.5;
    b.pitch += (pitchGoal - b.pitch) * Math.min(1, dt * 3);
    b.fold += (0 - b.fold) * Math.min(1, dt * 6);
    // deep slow beats; a glide on the way down; quick braking beats in the flare
    const gliding = landing && flare < 0.4 && b.vy < -0.3;
    const ampGoal = gliding ? 0.08 : flare > 0.4 ? 0.85 : b.vy > 0.5 ? 0.8 : 0.62;
    b.amp += (ampGoal - b.amp) * Math.min(1, dt * 3);
    const hz = (heron ? 2.0 : 2.4) * (flare > 0.4 ? 1.4 : 1);
    if (b.amp > 0.1) b.phase += dt * hz * 2 * Math.PI;
    else b.phase += turn(-b.phase) * Math.min(1, dt * 3);
    b.neckGoal = flare > 0.5 ? 0.6 : -1;
    if (d < 0.7 && b.y - ground < 0.25) {
      b.state = WADE;
      b.speed = 0;
      b.vy = 0;
      b.t = 3 + rnd() * 4;
      b.neckGoal = 1;
    }
  }

  // ---------------------------------------------------------------- the swans
  private swim(b: Big, dt: number, f: WaderFrame): void {
    b.fold = 0.9;
    b.amp = 0;
    let speed = 0.32;
    // round its circle, the circle itself drifting slowly over the lagoon
    let gx = 0, gz = 0;
    if (f.player) {
      const px = b.x - f.player[0], pz = b.z - f.player[2], d = Math.hypot(px, pz);
      if (d < 9) { gx = px / d; gz = pz / d; speed = 0.9; }
    }
    b.ang += (speed / b.cr) * b.spin * dt;
    const ox = Math.sin(f.time * 0.013 + b.id) * 6, oz = Math.cos(f.time * 0.011 + b.id * 2) * 9;
    let tx = b.cx + ox + Math.cos(b.ang) * b.cr, tz = b.cz + oz + Math.sin(b.ang) * b.cr;
    if (gx || gz) { tx = b.x + gx * 4; tz = b.z + gz * 4; }
    const want = Math.atan2(tz - b.z, tx - b.x);
    b.heading = turn(b.heading + clamp(turn(want - b.heading), -dt * 0.35, dt * 0.35));
    b.speed += (speed - b.speed) * Math.min(1, dt * 0.6);
    let nx = b.x + Math.cos(b.heading) * b.speed * dt, nz = b.z + Math.sin(b.heading) * b.speed * dt;
    if (lagoonSdf(nx, nz) > -5) { nx = b.x; nz = b.z; b.heading = turn(b.heading + dt * 0.8); }
    b.x = nx; b.z = nz;
    b.y = WATER_Y + Math.sin(f.time * 0.9 + b.id) * 0.012;
    // a dabble now and then, the head down to the water; else the neck's slow curve
    b.t -= dt;
    if (b.t < 0) { b.strike = rnd() < 0.35 ? 2.5 + rnd() * 2 : 0; b.t = 8 + rnd() * 14; }
    b.strike -= dt;
    b.neckGoal = b.strike > 0 ? 2 : 0.1 * Math.sin(f.time * 0.3 + b.id);
  }

  // ---------------------------------------------------------------- the falcon
  private hunt(b: Big, dt: number, f: WaderFrame): void {
    const [fx, fy, fz] = f.flock;
    const away = f.dusk > 0.42 || f.flockAloft < 0.25;
    b.vis += ((away ? 0 : 1) - b.vis) * Math.min(1, dt * 0.25);
    b.fold += ((b.state === STOOP ? 0.62 : 0) - b.fold) * Math.min(1, dt * 3);
    b.t -= dt;
    let tx: number, ty: number, tz: number, speed: number;
    if (b.state === STOOP) {
      // down at the flock's middle from above, at speed, and on through
      tx = fx; ty = fy - 25; tz = fz; speed = 34;
      if (b.t < 0 || b.y < fy - 18) { b.state = CLIMB; b.t = 9; }
    } else if (b.state === CLIMB) {
      tx = fx + Math.cos(f.time * 0.1) * 60; ty = fy + 38; tz = fz + Math.sin(f.time * 0.1) * 60; speed = 15;
      if (b.t < 0 || b.y > fy + 32) { b.state = SOAR; b.t = 22 + rnd() * 20; }
    } else {
      // circling high over the flock
      b.ang += dt * 13 / b.cr;
      tx = fx + Math.cos(b.ang) * b.cr; ty = fy + 36; tz = fz + Math.sin(b.ang) * b.cr; speed = 13;
      if (b.t < 0 && !away) { b.state = STOOP; b.t = 4.5; }
    }
    if (away) { ty = 140; speed = 14; }
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
    const want = Math.atan2(dz, dx);
    const rate = b.state === STOOP ? 2.4 : 1.0;
    const dh = clamp(turn(want - b.heading), -dt * rate, dt * rate);
    b.heading = turn(b.heading + dh);
    b.speed += (speed - b.speed) * Math.min(1, dt * (b.state === STOOP ? 2.5 : 1));
    const flat = Math.hypot(dx, dz);
    const vyGoal = b.state === STOOP ? clamp((dy / Math.max(flat, 1)) * b.speed, -30, 5) : clamp(dy * 0.6, -6, 6);
    b.vy += (vyGoal - b.vy) * Math.min(1, dt * 2.5);
    b.x += Math.cos(b.heading) * b.speed * dt;
    b.z += Math.sin(b.heading) * b.speed * dt;
    b.y += b.vy * dt;
    b.bank += (clamp((dh / dt) * b.speed * 0.08, -0.9, 0.9) - b.bank) * Math.min(1, dt * 3);
    b.pitch += (clamp(Math.atan2(b.vy, Math.max(b.speed, 1)), -1.2, 0.5) - b.pitch) * Math.min(1, dt * 4);
    const beating = b.state === CLIMB || Math.sin(f.time * 0.4 + 1.3) > 0.6;
    b.amp += ((beating ? 0.7 : b.state === STOOP ? 0 : 0.05) - b.amp) * Math.min(1, dt * 4);
    if (b.amp > 0.06) b.phase += dt * 5.5 * 2 * Math.PI;
    else b.phase += turn(-b.phase) * Math.min(1, dt * 3);
    const near = Math.hypot(b.x - fx, b.y - fy, b.z - fz);
    const fear = b.state === STOOP ? 1 : b.state === CLIMB ? 0.3 : 0.08;
    this.falcon[0] = b.x; this.falcon[1] = b.y; this.falcon[2] = b.z;
    this.falcon[3] = b.vis * fear * (near < 60 ? 1 : 0.3);
  }

  private write(): void {
    const D = this.data;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const o = i * BIRD_FLOATS;
      const posture = b.sp === SWAN ? 2 : b.state === WADE ? 1 : 0;
      D[o] = b.x; D[o + 1] = b.y; D[o + 2] = b.z; D[o + 3] = b.heading;
      D[o + 4] = b.pitch; D[o + 5] = b.bank; D[o + 6] = b.sp; D[o + 7] = b.size;
      D[o + 8] = b.phase; D[o + 9] = b.amp; D[o + 10] = b.fold; D[o + 11] = b.sp === FALCON ? 0.04 : 0.1;
      D[o + 12] = b.neck; D[o + 13] = b.variant; D[o + 14] = posture * 1000 + Math.min(b.speed, 99); D[o + 15] = b.vis;
    }
  }
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
