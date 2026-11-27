/** Layout and behaviour for Frostfire Hollow, with no renderer dependencies. */

export interface Spot {
  x: number;
  z: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smooth = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- layout

/** Where the path splits (south) and rejoins (north), around the hole. */
export const FORK_Z = 16;
/** How far each arm swings out from the middle. */
export const ARM_SWING = 12.5;
export const PATH_HALF_WIDTH = 3;
/** Width of the rocky bank from the path's edge down to the lakes. */
export const BANK = 1.4;
/** The lakes' surface, lava or ice. Always just a short hop below the path. */
export const LAKE_Y = -0.6;

/** The monster's hole, in the middle of the cave. */
export const HOLE_RADIUS = 7;
/** Outer edge of the raised rocky rim around the hole. */
export const RIM_RADIUS = 8.3;
export const RIM_Y = 0.45;
/** The pool the monster lives in. */
export const POOL_Y = -0.9;

/** Cave walls: an ellipse on the floor. Players are kept inside `WALK_*`. */
export const CAVE_RX = 27;
export const CAVE_RZ = 45;
export const WALK_RX = 23.5;
export const WALK_RZ = 42;
export const CEILING_Y = 18;

/** Arm centre line: x as a function of z, for the west (-1) and east (+1) arms. */
export function armX(side: -1 | 1, z: number): number {
  if (Math.abs(z) >= FORK_Z) return 0;
  return side * ARM_SWING * Math.cos((Math.PI * z) / (2 * FORK_Z));
}

/** Where the trunk's hills start: flat from the fork out past the switch pads. */
const TRUNK_FLAT = 22.5;

/**
 * Rolling hills along each stretch of path, up to about 1.8 m: zero at both portals, at both
 * forks and around the switches. Every stretch rolls differently.
 */
function trunkHill(z: number): number {
  const u = clamp01((Math.abs(z) - TRUNK_FLAT) / (36.25 - TRUNK_FLAT));
  const envelope = Math.sin(Math.PI * u);
  return z > 0
    ? envelope * (0.95 + 0.45 * Math.sin(u * 9 + 0.3) + 0.15 * Math.sin(u * 17))
    : envelope * (0.7 + 0.45 * Math.sin(u * 7 + 2) + 0.15 * Math.sin(u * 13 + 1));
}

function armHill(side: -1 | 1, z: number): number {
  const c = Math.cos((Math.PI * z) / (2 * FORK_Z));
  const roll = side < 0
    ? 1.05 + 0.5 * Math.sin(z * 0.42) + 0.22 * Math.sin(z * 0.9 + 1)
    : 0.9 + 0.5 * Math.sin(z * 0.36 + 2) + 0.22 * Math.sin(z * 0.85);
  return c * roll;
}

/** Nearest point on the path: its distance and the path's walking height there. */
export function pathAt(x: number, z: number): { distance: number; height: number } {
  let distance = Infinity;
  let height = 0;
  // The two straight stretches.
  for (const sign of [-1, 1]) {
    const nz = sign * Math.min(46, Math.max(FORK_Z, sign * z));
    const d = Math.hypot(x, z - nz);
    if (d < distance) {
      distance = d;
      height = trunkHill(nz);
    }
  }
  // The arms, sampled along their length.
  for (const side of [-1, 1] as const) {
    if (side * x < -2) continue;
    for (let s = -FORK_Z; s <= FORK_Z; s += 0.5) {
      const d = Math.hypot(x - armX(side, s), z - s);
      if (d < distance) {
        distance = d;
        height = armHill(side, s);
      }
    }
  }
  return { distance, height };
}

/** The two linked switches, one at each fork, set just off the path's edge. */
export interface SwitchSpot {
  /** The pressure plate you step on. */
  plate: Spot;
  /** The pedestal with the toggle, behind the plate. */
  pedestal: Spot;
  /** Yaw the toggle faces (towards the path). */
  yaw: number;
}
export const PLATE_RADIUS = 0.75;
export const PLATE_TOP = 0.08;
export const SWITCHES: SwitchSpot[] = [
  { plate: { x: -3.25, z: 19.5 }, pedestal: { x: -4.75, z: 19.5 }, yaw: Math.PI / 2 },
  { plate: { x: 3.25, z: -19.5 }, pedestal: { x: 4.75, z: -19.5 }, yaw: -Math.PI / 2 },
];
const PAD_RADIUS = 2.6;

/** Rocky islands poking out of the lakes, walkable. */
export const ISLANDS: Array<Spot & { r: number; h: number }> = [
  { x: -13, z: 27, r: 2.6, h: 0.15 },
  { x: 12, z: 30, r: 3.2, h: 0.05 },
  { x: 17, z: 8, r: 2.2, h: 0.2 },
  { x: -18, z: -4, r: 3, h: 0.1 },
  { x: -10, z: -29, r: 2.8, h: 0.18 },
  { x: 14, z: -27, r: 2.4, h: 0.1 },
];

/** Ellipse value: 1 on the walk boundary. */
const caveE = (x: number, z: number) => (x / WALK_RX) ** 2 + (z / WALK_RZ) ** 2;

export type Surface = 'path' | 'lake' | 'rim' | 'wall';

/** What's underfoot and how high it is (the walking surface, not the rocks drawn on it). */
export function groundAt(x: number, z: number): { y: number; surface: Surface } {
  const r = Math.hypot(x, z);
  if (r < RIM_RADIUS) return { y: RIM_Y, surface: 'rim' };

  const { distance, height } = pathAt(x, z);
  let y = LAKE_Y;
  let surface: Surface = 'lake';
  if (distance <= PATH_HALF_WIDTH) {
    y = height;
    surface = 'path';
  } else if (distance < PATH_HALF_WIDTH + BANK) {
    y = LAKE_Y + (height - LAKE_Y) * (1 - smooth(PATH_HALF_WIDTH, PATH_HALF_WIDTH + BANK, distance));
    surface = 'path';
  }
  for (const s of SWITCHES) {
    const d = Math.hypot(x - (s.plate.x + s.pedestal.x) / 2, z - s.plate.z);
    if (d < PAD_RADIUS) {
      const t = 1 - smooth(PAD_RADIUS - 0.7, PAD_RADIUS, d);
      y = y + (0 - y) * t;
      if (t > 0.5) surface = 'path';
    }
  }
  for (const island of ISLANDS) {
    const d = Math.hypot(x - island.x, z - island.z);
    if (d < island.r) {
      const iy = LAKE_Y + (island.h - LAKE_Y) * (1 - smooth(island.r * 0.6, island.r, d));
      if (iy > y) {
        y = iy;
        if (d < island.r * 0.8) surface = 'path';
      }
    }
  }
  // Shallow shores count as dry ground: only the flat lake itself is lava or ice.
  if (surface === 'lake' && y > LAKE_Y + 0.08) surface = 'path';
  const e = caveE(x, z);
  if (e > 0.88) {
    const wy = (e - 0.88) * 14;
    if (wy > y) {
      y = wy;
      surface = 'wall';
    }
  }
  return { y, surface };
}

export function walkHeight(x: number, z: number): number {
  return groundAt(x, z).y;
}

/** Keep a point out of the hole and inside the cave walls. */
export function confine(x: number, z: number, radius: number): [number, number] {
  const keepOut = RIM_RADIUS + radius;
  const r = Math.hypot(x, z);
  if (r < keepOut) {
    if (r < 1e-6) return [0, keepOut];
    x *= keepOut / r;
    z *= keepOut / r;
  }
  const e = Math.sqrt(caveE(x, z));
  if (e > 1) {
    x /= e;
    z /= e;
  }
  return [x, z];
}

// ---------------------------------------------------------------- fire and ice

export const FREEZE_SECONDS = 4;
export const GUST_SECONDS = 5;

export interface Climate {
  /** 'fire' or 'ice': what the switches say. */
  mode: 'fire' | 'ice';
  /** 0 is all lava, 1 is all ice. Eases toward the mode. */
  frost: number;
  /** Seconds of cold gust left. */
  gust: number;
  /** Where the last flip came from: the path knits together outward from here. */
  origin: Spot;
}

export function createClimate(): Climate {
  return { mode: 'fire', frost: 0, gust: 0, origin: { x: 0, z: FORK_Z } };
}

export function flip(climate: Climate, origin?: Spot): void {
  if (origin) climate.origin = { x: origin.x, z: origin.z };
  climate.mode = climate.mode === 'fire' ? 'ice' : 'fire';
  climate.gust = climate.mode === 'ice' ? GUST_SECONDS : 0;
}

export function stepClimate(climate: Climate, dt: number): void {
  const target = climate.mode === 'ice' ? 1 : 0;
  const rate = dt / FREEZE_SECONDS;
  climate.frost += Math.max(-rate, Math.min(rate, target - climate.frost));
  climate.gust = Math.max(0, climate.gust - dt);
}

/** A stage of the change, 0..1, for effects that happen in part of it. */
export const stage = (frost: number, from: number, to: number) => smooth(from, to, frost);

/** How hard the gust blows right now, 0..1: a sharp rise, then a long fade. */
export function gustStrength(climate: Climate): number {
  if (climate.gust <= 0) return 0;
  const t = 1 - climate.gust / GUST_SECONDS;
  return smooth(0, 0.06, t) * (1 - smooth(0.25, 1, t));
}

/** The gust blows out of the hollow, towards whoever is standing there. */
export function gustDirection(x: number, z: number): [number, number] {
  const len = Math.hypot(x, z);
  if (len < 1) return [0, 1];
  return [x / len, z / len];
}

// ---------------------------------------------------------------- pressure plates

export interface Plates {
  /** Which plate (index) the player is standing on, or -1. */
  on: number;
}

export function createPlates(): Plates {
  return { on: -1 };
}

/** Returns true when the player has just stepped onto a plate (a flip). */
export function stepPlates(plates: Plates, feet: { x: number; y: number; z: number } | null): boolean {
  let on = -1;
  if (feet) {
    SWITCHES.forEach((s, i) => {
      const d = Math.hypot(feet.x - s.plate.x, feet.z - s.plate.z);
      if (d < PLATE_RADIUS && feet.y < PLATE_TOP + 0.35) on = i;
    });
  }
  const stepped = on >= 0 && plates.on !== on;
  plates.on = on;
  return stepped;
}

// ---------------------------------------------------------------- slipping and wind

/** How quickly your velocity follows what you're trying to do, per second. */
const GRIP_GROUND = 40;
const GRIP_ICE = 0.9;
/** Speed the gust pushes at its strongest (walking is 8.2 m/s). */
export const GUST_PUSH = 4.5;
/** Feet this far above the ground count as airborne. */
const AIRBORNE = 0.35;
/** Flying this far above the ground ignores the ice and wind. */
const FLYING = 2;

export interface Slide {
  vx: number;
  vz: number;
  /** Whether the last surface underfoot was ice. */
  onIce: boolean;
}

export function createSlide(): Slide {
  return { vx: 0, vz: 0, onIce: false };
}

export function iceUnderfoot(frost: number, x: number, y: number, z: number): boolean {
  if (frost < 0.6) return false;
  const g = groundAt(x, z);
  return g.surface === 'lake' && y - g.y < 0.15;
}

/**
 * One step of the player's feet, `from` to `to`, made slippery on ice and pushed by the gust.
 * Returns where the step ends, kept out of the hole and inside the cave.
 */
export function slideStep(
  slide: Slide,
  climate: Climate,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  radius: number,
  dt: number,
  shove: readonly [number, number] = [0, 0],
): [number, number] {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const above = from[1] - walkHeight(from[0], from[2]);
  // Spawns and portal hops jump a long way in one step: never carry momentum across them.
  if (Math.hypot(dx, dz) > 3 || above > FLYING || dt <= 0) {
    slide.vx = dx / Math.max(dt, 1e-3);
    slide.vz = dz / Math.max(dt, 1e-3);
    slide.onIce = false;
    return confine(to[0], to[2], radius);
  }
  if (above < AIRBORNE) slide.onIce = iceUnderfoot(climate.frost, from[0], from[1], from[2]);

  const wantX = dx / dt;
  const wantZ = dz / dt;
  const grip = slide.onIce ? GRIP_ICE : GRIP_GROUND;
  const follow = 1 - Math.exp(-grip * dt);
  slide.vx += (wantX - slide.vx) * follow;
  slide.vz += (wantZ - slide.vz) * follow;

  let x = from[0] + slide.vx * dt;
  let z = from[2] + slide.vz * dt;
  const push = gustStrength(climate) * GUST_PUSH;
  if (push > 0) {
    const [gx, gz] = gustDirection(from[0], from[2]);
    x += gx * push * dt;
    z += gz * push * dt;
  }
  x += shove[0] * dt;
  z += shove[1] * dt;
  const [cx, cz] = confine(x, z, radius);
  // Bumping into the rim or a wall stops the slide in that direction.
  if (cx !== x || cz !== z) {
    slide.vx = (cx - from[0]) / dt;
    slide.vz = (cz - from[2]) / dt;
  }
  return [cx, cz];
}

// ---------------------------------------------------------------- the monster

/** His body's radius at the waterline: he stays this far inside the hole's edge. */
export const MONSTER_RADIUS = 2.6;
/** Kept back from the edge so his arms reach over the rim rather than through it. */
export const MONSTER_REACH = HOLE_RADIUS - MONSTER_RADIUS - 1;
export const MONSTER_MAX_SPEED = 2.6;
export const MONSTER_ACCEL = 3.2;

export interface Monster {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Body yaw (0 faces +z). */
  yaw: number;
  /** Head yaw relative to the world, turning ahead of the body. */
  headYaw: number;
  /** Height of the bob above the pool. */
  bob: number;
}

export function createMonster(): Monster {
  return { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, headYaw: 0, bob: 0 };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Follow the player (or drift when there's none) with a top speed and some momentum. */
export function stepMonster(m: Monster, dt: number, elapsed: number, player: Spot | null): void {
  let tx: number;
  let tz: number;
  if (player) {
    const d = Math.hypot(player.x, player.z);
    const reach = Math.min(MONSTER_REACH, d);
    tx = d > 1e-6 ? (player.x / d) * reach : 0;
    tz = d > 1e-6 ? (player.z / d) * reach : 0;
  } else {
    tx = Math.sin(elapsed * 0.13) * MONSTER_REACH * 0.7;
    tz = Math.cos(elapsed * 0.09) * MONSTER_REACH * 0.7;
  }

  // Steer towards an arrival speed that slows near the target, capped at max speed.
  const ex = tx - m.x;
  const ez = tz - m.z;
  const dist = Math.hypot(ex, ez);
  const want = Math.min(MONSTER_MAX_SPEED, Math.sqrt(2 * MONSTER_ACCEL * 0.6 * dist));
  const wx = dist > 1e-6 ? (ex / dist) * want : 0;
  const wz = dist > 1e-6 ? (ez / dist) * want : 0;
  let ax = wx - m.vx;
  let az = wz - m.vz;
  const a = Math.hypot(ax, az);
  const maxDv = MONSTER_ACCEL * dt;
  if (a > maxDv) {
    ax *= maxDv / a;
    az *= maxDv / a;
  }
  m.vx += ax;
  m.vz += az;
  const speed = Math.hypot(m.vx, m.vz);
  if (speed > MONSTER_MAX_SPEED) {
    m.vx *= MONSTER_MAX_SPEED / speed;
    m.vz *= MONSTER_MAX_SPEED / speed;
  }
  m.x += m.vx * dt;
  m.z += m.vz * dt;
  const r = Math.hypot(m.x, m.z);
  if (r > MONSTER_REACH) {
    m.x *= MONSTER_REACH / r;
    m.z *= MONSTER_REACH / r;
    // Lose the outward part of the velocity at the wall.
    const nx = m.x / MONSTER_REACH;
    const nz = m.z / MONSTER_REACH;
    const out = m.vx * nx + m.vz * nz;
    if (out > 0) {
      m.vx -= out * nx;
      m.vz -= out * nz;
    }
  }

  // Face the player: the head first, the body a beat behind.
  const lookX = player ? player.x - m.x : tx - m.x + Math.sin(elapsed * 0.3);
  const lookZ = player ? player.z - m.z : tz - m.z + 1;
  const face = Math.atan2(lookX, lookZ);
  m.headYaw += wrap(face - m.headYaw) * (1 - Math.exp(-4 * dt));
  m.yaw += wrap(face - m.yaw) * (1 - Math.exp(-1.6 * dt));
  m.bob = Math.sin(elapsed * 1.35) * 0.22 + Math.sin(elapsed * 0.53 + 1) * 0.08;
}

// ---------------------------------------------------------------- the yell

/** He only yells at players this close to him (metres, from his middle). */
export const YELL_RANGE = 13;
/** Draws breath, roars, then settles: under three seconds in all. */
export const YELL_WINDUP = 0.6;
export const YELL_ROAR = 1.4;
export const YELL_SETTLE = 0.5;
export const YELL_SECONDS = YELL_WINDUP + YELL_ROAR + YELL_SETTLE;
/** Speed of the blast at its strongest; it fades over `YELL_PUSH_SECONDS`, shoving you a few metres. */
export const YELL_PUSH = 14;
export const YELL_PUSH_SECONDS = 0.9;

export interface Yell {
  /** Seconds into the current yell, or -1 when quiet. */
  t: number;
  /** Seconds until he may yell again. */
  cooldown: number;
  /** Direction of the blast (from him towards the player), fixed when the roar starts. */
  dir: [number, number];
}

export function createYell(rand: () => number): Yell {
  return { t: -1, cooldown: 2.5 + rand() * 3, dir: [0, 1] };
}

/** 0..1 phases of the yell, for the face and effects. */
export function yellPhase(y: Yell): { windup: number; roar: number; open: number } {
  if (y.t < 0) return { windup: 0, roar: 0, open: 0 };
  const windup = smooth(0, YELL_WINDUP, y.t);
  const roarT = y.t - YELL_WINDUP;
  const roar = roarT < 0 ? 0 : roarT < YELL_ROAR ? 1 : 1 - smooth(YELL_ROAR, YELL_ROAR + YELL_SETTLE, roarT);
  const open = Math.max(windup * 0.35, roar);
  return { windup, roar, open };
}

/**
 * Advance the yell. He yells at random times while the player is close. Returns the shove the
 * blast gives the player this frame (m/s, room coordinates).
 */
export function stepYell(y: Yell, dt: number, rand: () => number, m: Monster, player: Spot | null): [number, number] {
  const near = !!player && Math.hypot(player.x - m.x, player.z - m.z) < YELL_RANGE;
  if (y.t < 0) {
    if (near) y.cooldown -= dt;
    if (near && y.cooldown <= 0) y.t = 0;
    return [0, 0];
  }
  const before = y.t;
  y.t += dt;
  if (before < YELL_WINDUP && y.t >= YELL_WINDUP && player) {
    const dx = player.x - m.x;
    const dz = player.z - m.z;
    const len = Math.hypot(dx, dz) || 1;
    y.dir = [dx / len, dz / len];
  }
  if (y.t >= YELL_SECONDS) {
    y.t = -1;
    y.cooldown = 5 + rand() * 7;
    return [0, 0];
  }
  const roarT = y.t - YELL_WINDUP;
  if (roarT < 0 || roarT > YELL_PUSH_SECONDS || !player) return [0, 0];
  // Only players still in front of him and in range get blown away.
  if (Math.hypot(player.x - m.x, player.z - m.z) > YELL_RANGE + 7) return [0, 0];
  const strength = YELL_PUSH * (1 - roarT / YELL_PUSH_SECONDS);
  return [y.dir[0] * strength, y.dir[1] * strength];
}

// ---------------------------------------------------------------- catching fire

/** Seconds you keep burning after stepping off the lava. */
export const BURN_AFTER = 2.5;

export interface Burn {
  /** 0..1, how much you're on fire. */
  level: number;
  /** Seconds left before the flames start dying down. */
  left: number;
}

export function createBurn(): Burn {
  return { level: 0, left: 0 };
}

export function onLava(frost: number, x: number, y: number, z: number): boolean {
  if (frost > 0.3) return false;
  const g = groundAt(x, z);
  return g.surface === 'lake' && y - g.y < 0.2;
}

export function stepBurn(b: Burn, dt: number, frost: number, feet: { x: number; y: number; z: number } | null): void {
  if (feet && onLava(frost, feet.x, feet.y, feet.z)) b.left = BURN_AFTER;
  else b.left = Math.max(0, b.left - dt);
  // Ice puts you out quickly.
  const target = b.left > 0 && frost < 0.5 ? 1 : 0;
  const rate = target > b.level ? 4 : frost > 0.5 ? 3 : 0.8;
  b.level += Math.max(-rate * dt, Math.min(rate * dt, target - b.level));
}

// ---------------------------------------------------------------- path tiles

/** Basalt column tops making up the path: hex cells, broken apart over the lava, knitting together into ice. */
export const TILE_RADIUS = 0.5;

export interface Tile {
  x: number;
  z: number;
  /** Walking height there (the tile's top when knitted). */
  h: number;
  /** Size, in hex radii: big slabs, middling stones and small chips. */
  size: number;
  /** Seeded scatter for the broken look, -1..1. */
  jx: number;
  jz: number;
  tilt: number;
  spin: number;
  /** Up (+) or down (-) when broken, metres. */
  lift: number;
  shrink: number;
}

export function pathTiles(rand: () => number): Tile[] {
  const cells: Spot[] = [];
  const dx = Math.sqrt(3) * TILE_RADIUS;
  const dz = 1.5 * TILE_RADIUS;
  let row = 0;
  for (let z = -42; z <= 42; z += dz, row++) {
    for (let x = -16 + (row % 2) * dx * 0.5; x <= 16; x += dx) {
      const g = groundAt(x, z);
      if (g.surface !== 'path' || g.y < -0.05) continue;
      const { distance } = pathAt(x, z);
      const onPad = SWITCHES.some(s => Math.hypot(x - (s.plate.x + s.pedestal.x) / 2, z - s.plate.z) < 2.2);
      if (distance > PATH_HALF_WIDTH + 0.2 && !onPad) continue;
      cells.push({ x, z });
    }
  }
  // Merge neighbouring cells into slabs of mixed sizes: a few big ones, more middling, many small.
  const order = cells.map((_, i) => i).sort(() => rand() - 0.5);
  const taken = new Uint8Array(cells.length);
  const tiles: Tile[] = [];
  // Bucket cells by grid square so finding neighbours stays cheap.
  const key = (x: number, z: number) => `${Math.round(x / dx)},${Math.round(z / dz)}`;
  const buckets = new Map<string, number[]>();
  cells.forEach((cell, i) => {
    const k = key(cell.x, cell.z);
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  });
  const neighbours = (i: number, within: number) => {
    const found: number[] = [];
    const cx = Math.round(cells[i].x / dx);
    const cz = Math.round(cells[i].z / dz);
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        for (const j of buckets.get(`${cx + a},${cz + b}`) ?? []) {
          if (!taken[j] && j !== i && Math.hypot(cells[j].x - cells[i].x, cells[j].z - cells[i].z) < within) found.push(j);
        }
      }
    }
    return found;
  };
  for (const i of order) {
    if (taken[i]) continue;
    taken[i] = 1;
    const roll = rand();
    let group = [i];
    let size = 1;
    if (roll < 0.22) {
      const around = neighbours(i, dx * 1.05);
      if (around.length >= 5) {
        group = group.concat(around);
        size = 2.6 + rand() * 0.25;
      }
    } else if (roll < 0.55) {
      const around = neighbours(i, dx * 1.05).slice(0, 2);
      if (around.length) {
        group = group.concat(around);
        size = around.length === 2 ? 1.75 : 1.45;
      }
    }
    for (const j of group) taken[j] = 1;
    const x = group.reduce((a, j) => a + cells[j].x, 0) / group.length;
    const z = group.reduce((a, j) => a + cells[j].z, 0) / group.length;
    tiles.push({
      x, z,
      // A hair of height difference between slabs, so overlapping tops never flicker.
      h: walkHeight(x, z) + (tiles.length % 5) * 0.006,
      size: group.length === 1 ? 0.85 + rand() * 0.3 : size,
      jx: rand() * 2 - 1, jz: rand() * 2 - 1,
      tilt: rand() * 2 - 1, spin: rand() * 2 - 1,
      lift: (rand() - 0.6) * 0.32 / Math.sqrt(size), shrink: rand(),
    });
  }
  return tiles;
}

/** How far a tile at (x, z) has knitted into the ice path (0 broken, 1 joined), as a wave from the flip. */
export function tileKnit(climate: Climate, x: number, z: number): number {
  const d = Math.hypot(x - climate.origin.x, z - climate.origin.z);
  return smooth(0, 1, climate.frost * 2 - d / 70);
}
