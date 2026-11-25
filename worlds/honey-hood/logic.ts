/** Layout and behaviour for the honey woods, with no renderer dependencies. */

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Spot {
  x: number;
  z: number;
}

type Rand = () => number;

const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- road and scenery

export const ROAD_HALF_WIDTH = 1.4;
/** Off the road, just outside the central corridor, where the road has swung the other way. */
export const HYDRANT: Spot = { x: 5.6, z: 1 };

/** The road's sideways position. It straightens out before reaching either portal. */
export function roadCenterX(z: number): number {
  const envelope = 1 - smooth(18, 34, Math.abs(z));
  return envelope * (-5.2 * Math.cos(((z - 1) * Math.PI) / 11) + 0.5 * Math.sin(z * 0.4));
}

/** Distance from a point to the middle of the road. */
export function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (let sample = z - 14; sample <= z + 14; sample += 0.2) {
    best = Math.min(best, Math.hypot(x - roadCenterX(sample), z - sample));
  }
  return best;
}

/** A ring of trees: two rows down each side and a row beyond each portal. */
export function treeSpots(rand: Rand): Array<Spot & { scale: number; drips: boolean }> {
  const trees: Array<Spot & { scale: number; drips: boolean }> = [];
  const add = (x: number, z: number, drips: boolean) =>
    trees.push({ x, z, drips, scale: 0.85 + rand() * 0.4 });
  for (const side of [-1, 1]) {
    for (let z = -45; z <= 45; z += 7.5) {
      add(side * (12.5 + rand() * 2.5), z + (rand() - 0.5) * 2, true);
      add(side * (20 + rand() * 11), z + 3.5 + (rand() - 0.5) * 4, false);
    }
    for (let x = -28; x <= 28; x += 7) {
      add(x + (rand() - 0.5) * 2, side * (50 + rand() * 6), Math.abs(x) <= 14);
    }
  }
  return trees;
}

export function goldenPlantSpots(rand: Rand, count = 120): Spot[] {
  const plants: Spot[] = [];
  while (plants.length < count) {
    const x = (rand() < 0.5 ? -1 : 1) * (4.6 + rand() * 6.8);
    const z = -43 + rand() * 86;
    if (roadDistance(x, z) <= ROAD_HALF_WIDTH + 0.6) continue;
    if (Math.hypot(x - HYDRANT.x, z - HYDRANT.z) <= 1.8) continue;
    plants.push({ x, z });
  }
  return plants;
}

// ---------------------------------------------------------------- honey

/** Seconds a puddle lasts from splash to gone. */
export const PUDDLE_LIFE = 3.5;
const HONEY_GRAVITY = 8;

export interface Drip {
  source: Point;
  phase: 'waiting' | 'falling' | 'puddle';
  /** Height of the falling drop. */
  y: number;
  speed: number;
  /** Seconds left to wait, or the puddle's age. */
  timer: number;
}

export function createDrip(source: Point, rand: Rand): Drip {
  return { source, phase: 'waiting', y: source.y, speed: 0, timer: rand() * 4 };
}

export function stepDrip(drip: Drip, dt: number, rand: Rand): void {
  if (drip.phase === 'waiting') {
    drip.timer -= dt;
    if (drip.timer <= 0) {
      drip.phase = 'falling';
      drip.y = drip.source.y;
      drip.speed = 0;
    }
  } else if (drip.phase === 'falling') {
    drip.speed += HONEY_GRAVITY * dt;
    drip.y = Math.max(0, drip.y - drip.speed * dt);
    if (drip.y === 0) {
      drip.phase = 'puddle';
      drip.timer = 0;
    }
  } else {
    drip.timer += dt;
    if (drip.timer >= PUDDLE_LIFE) {
      drip.phase = 'waiting';
      drip.timer = 0.2 + rand() * 1.4;
    }
  }
}

/** Puddle size from 0 to 1: it spreads on impact, sits, then soaks away. */
export function puddleSize(age: number): number {
  return smooth(0, 0.6, age) * (1 - smooth(PUDDLE_LIFE - 1.4, PUDDLE_LIFE, age));
}

// ---------------------------------------------------------------- bee and birds

/** Highest point a player on foot reaches: a held jump (3.5 m) plus the avatar (about 2 m). */
export const JUMP_REACH = 5.5;
/** How far the bee model hangs below its origin. */
export const BEE_BELOW = 3.2;
export const BEE_HOVER_Y = 9;
/** The mouth's offset from the bee's origin. */
export const MOUTH_FORWARD = 1.75;
export const MOUTH_UP = 1.2;
export const BEE_MOUTH = Math.hypot(MOUTH_FORWARD, MOUTH_UP);

const CHASE_SPEED = 11;
const CRUISE_SPEED = 7;
const BIRD_SPEED = 4;
/** Birds stay over the open middle of the room, clear of trunks and branches. */
const BIRD_HALF_X = 5.2;
const BIRD_HALF_Z = 27;
const CHEW_SECONDS = 1.1;

export interface Bird extends Point {
  vx: number;
  vz: number;
}

export interface Hunt {
  mode: 'patrol' | 'hunting' | 'eating';
  bee: Point;
  /** Facing angle around Y; 0 faces +Z. */
  yaw: number;
  bird: Bird | null;
  /** Seconds until the next bird, or until the current mouthful is gone. */
  timer: number;
  clock: number;
}

function patrolPoint(clock: number): Point {
  return {
    x: 5 * Math.sin(clock * 0.23),
    y: BEE_HOVER_Y + 0.25 + 0.25 * Math.sin(clock * 1.7),
    z: 19 * Math.sin(clock * 0.15),
  };
}

export function createHunt(rand: Rand): Hunt {
  return { mode: 'patrol', bee: patrolPoint(0), yaw: 0, bird: null, timer: 3 + rand() * 3, clock: 0 };
}

function moveToward(from: Point, to: Point, step: number): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  const k = length > step ? step / length : 1;
  from.x += dx * k;
  from.y += dy * k;
  from.z += dz * k;
  return length * (1 - k);
}

function turnToward(hunt: Hunt, yaw: number, dt: number): void {
  const delta = Math.atan2(Math.sin(yaw - hunt.yaw), Math.cos(yaw - hunt.yaw));
  hunt.yaw += delta * Math.min(1, dt * 8);
}

/** A bird appears at the far side of the bee, so there is always a chase. */
function spawnBird(bee: Point, rand: Rand): Bird {
  const heading = rand() * Math.PI * 2;
  return {
    x: (rand() * 2 - 1) * BIRD_HALF_X,
    y: BEE_HOVER_Y + MOUTH_UP + 0.3 + rand() * 1.4,
    z: (bee.z > 0 ? -1 : 1) * (8 + rand() * 16),
    vx: Math.sin(heading) * BIRD_SPEED,
    vz: Math.cos(heading) * BIRD_SPEED,
  };
}

/** Fly straight, turning back at the edges of the open air. */
function flyBird(bird: Bird, dt: number): void {
  if (Math.abs(bird.x + bird.vx * dt) > BIRD_HALF_X) bird.vx = -bird.vx;
  if (Math.abs(bird.z + bird.vz * dt) > BIRD_HALF_Z) bird.vz = -bird.vz;
  bird.x += bird.vx * dt;
  bird.z += bird.vz * dt;
}

/** Advance the bee and any bird. Returns what happened on this step. */
export function stepHunt(hunt: Hunt, dt: number, rand: Rand): 'spawn' | 'eat' | null {
  hunt.clock += dt;

  if (hunt.mode === 'eating') {
    hunt.timer -= dt;
    if (hunt.timer <= 0) {
      hunt.mode = 'patrol';
      hunt.bird = null;
      hunt.timer = 4 + rand() * 5;
    }
    return null;
  }

  if (hunt.mode === 'hunting' && hunt.bird) {
    const bird = hunt.bird;
    flyBird(bird, dt);
    const yaw = Math.atan2(bird.x - hunt.bee.x, bird.z - hunt.bee.z);
    turnToward(hunt, yaw, dt);
    // Where the bee must be for its mouth to meet the bird.
    const target = {
      x: bird.x - Math.sin(yaw) * MOUTH_FORWARD,
      y: Math.max(BEE_HOVER_Y, bird.y - MOUTH_UP),
      z: bird.z - Math.cos(yaw) * MOUTH_FORWARD,
    };
    if (moveToward(hunt.bee, target, CHASE_SPEED * dt) < 0.35) {
      hunt.yaw = yaw;
      hunt.mode = 'eating';
      hunt.timer = CHEW_SECONDS;
      return 'eat';
    }
    return null;
  }

  const point = patrolPoint(hunt.clock);
  const ahead = patrolPoint(hunt.clock + 1);
  turnToward(hunt, Math.atan2(ahead.x - hunt.bee.x, ahead.z - hunt.bee.z), dt * 0.4);
  moveToward(hunt.bee, point, CRUISE_SPEED * dt);
  hunt.timer -= dt;
  if (hunt.timer <= 0) {
    hunt.mode = 'hunting';
    hunt.bird = spawnBird(hunt.bee, rand);
    return 'spawn';
  }
  return null;
}
