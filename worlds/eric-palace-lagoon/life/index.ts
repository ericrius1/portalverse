import type { Compute, RunEntry, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import type { FrameState, RoomEnv, RoomFeature } from '../env';
import { LAGOON, PALACE, lagoonSdf, terrainHeight } from '../layout';
import { TREE_TRUNKS } from '../trees';
import type { V3 } from '../timeOfDay';
import birdShader from './birds.wgsl';
import flockShader from './flock.wgsl';
import glowShader from './glow.wgsl';
import jellyShader from './jelly.wgsl';
import wakeShader from './wake.wgsl';
import { BIRD_FLOATS, Waders } from './waders';

/**
 * The Palace Lagoon's creatures, through the walk from sunset to night:
 *   sunset     a murmuration of starlings over the lagoon against the afterglow (GPU flocking, flock.wgsl: lobes that
 *              wander, merge and part; a swirl; a peregrine stooping through it and the flock flashing away from it in
 *              a dark wave), going down to roost on the far bank as the light goes, a stream at a time; great egrets
 *              and a heron stalking the shallows, up and away when you come near; swans gliding with their wakes
 *   blue hour  the last starlings pouring down into the roost; the egrets white in the last light; the first fireflies
 *   night      fireflies over the lawns round the rotunda and up among the trees, flashing together in rolling waves,
 *              parting round you; luminous moths spiralling in the drones' beams; lantern jellies drifting over the
 *              lagoon and under the dome, their light pooled on the water and mirrored in it
 * Everything that moves by itself is stepped once a frame (items: the flock's compute, the big birds' CPU state);
 * the fireflies, moths and jellies are functions of their homes and the clock, so every view draws the same ones.
 */

const FLOCK_N = 3072;
const BOID_FLOATS = 12;
/** the tiles of 256 others each bird looks at a step (of FLOCK_N / 256) */
const FLOCK_TILES = 4;
/** the vertex counts of birds.wgsl's two bodies: the starlings' few-vertex one and the full one */
const LOW_V = 102;
const FULL_V = 1176;
const FLIES = 2000;
const JELLIES = 30;
/** jelly.wgsl JELLY_V */
const JELLY_V = 2544;
const LAMPS = 8;
const MOTHS_PER_LAMP = 24;

/** the starlings' roost: the reed beds on the lagoon's far (east) bank */
const ROOST: V3 = [LAGOON.x + LAGOON.rx + 4, terrainHeight(LAGOON.x + LAGOON.rx + 4, LAGOON.z - 24) + 0.6, LAGOON.z - 24];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** where the fireflies live: the lawns round the rotunda (most), the banks' long grass, the trees, under the dome */
function fireflyHomes(): Float32Array {
  const r = rng(7);
  const out = new Float32Array(FLIES * 4);
  const [cx, cz] = PALACE.at;
  const trunks = TREE_TRUNKS;
  for (let i = 0; i < FLIES; i++) {
    let x = 0, z = 0, h = 0;
    for (let tries = 0; tries < 30; tries++) {
      const k = r();
      if (k < 0.62) {
        // the lawns round the podium, thickest just off it
        const a = r() * Math.PI * 2;
        const d = 30 + Math.pow(r(), 1.8) * 44;
        x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d; h = 0.25 + Math.pow(r(), 1.5) * 2.2;
      } else if (k < 0.78 && trunks.length) {
        const t = trunks[(r() * trunks.length) | 0];
        const a = r() * Math.PI * 2, d = t[2] + 0.5 + r() * 4;
        x = t[0] + Math.cos(a) * d; z = t[1] + Math.sin(a) * d; h = 1.5 + r() * 5;
      } else if (k < 0.93) {
        // the long grass along the lagoon's west bank
        x = LAGOON.x - LAGOON.rx - 2 + (r() - 0.5) * 14; z = LAGOON.z + (r() - 0.5) * 150; h = 0.3 + r() * 1.6;
      } else {
        // a few drifting in under the dome and the colonnade
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 30;
        x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d; h = 0.6 + r() * 4;
      }
      if (lagoonSdf(x, z) > 2) break;
    }
    out.set([x, h, z, r()], i * 4);
  }
  return out;
}

/** where the jellies drift: over the lagoon (most), along the rotunda's lagoon front, a few under the dome */
function jellyHomes(): Float32Array {
  const r = rng(31);
  const out = new Float32Array(JELLIES * 4);
  const [cx, cz] = PALACE.at;
  for (let i = 0; i < JELLIES; i++) {
    let x: number, z: number, h: number;
    if (i < 3) {
      const a = r() * Math.PI * 2, d = r() * 7;
      x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d; h = 19 + r() * 9;
    } else if (i < 9) {
      x = 24 + r() * 16; z = cz - 30 + r() * 46; h = 5 + r() * 9;
    } else {
      do {
        x = LAGOON.x + (r() - 0.5) * 2 * LAGOON.rx; z = LAGOON.z + (r() - 0.6) * 1.4 * LAGOON.rz;
      } while (lagoonSdf(x, z) > -6);
      h = 2.5 + Math.pow(r(), 1.4) * 15;
    }
    out.set([x, h, z, r()], i * 4);
  }
  return out;
}

/** the murmuration's first state: a ball of birds over the water, wheeling */
function flockStart(centre: V3, roost: number): Float32Array {
  const r = rng(99);
  const out = new Float32Array(FLOCK_N * BOID_FLOATS);
  const order = Array.from({ length: FLOCK_N }, (_, i) => (i + 0.5) / FLOCK_N);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < FLOCK_N; i++) {
    const seed = order[i];
    const u = r() * 2 - 1, a = r() * Math.PI * 2, d = Math.cbrt(r()) * 16;
    const s = Math.sqrt(1 - u * u);
    let x = centre[0] + Math.cos(a) * s * d, y = centre[1] + u * d * 0.5, z = centre[2] + Math.sin(a) * s * d;
    const vx = -Math.sin(a) * 12, vz = Math.cos(a) * 12;
    let vis = 1;
    if (seed < roost) { x = ROOST[0]; y = ROOST[1] + 0.5; z = ROOST[2]; vis = 0; }
    out.set([x, y, z, r() * 6.283, vx, 0, vz, 0, 0.5, 0, seed, vis], i * BOID_FLOATS);
  }
  return out;
}

export function createLife(env: RoomEnv): RoomFeature {
  const { kit, scene, refl, world } = env;
  const proj = env.projection.bindings;

  // ---------------------------------------------------------------- the murmuration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sim: UniformBuffer<any> = kit.uniforms(flockShader.structs.Sim, 'life.flock.sim');
  const start = flockStart([56, 38, -32], 0);
  const boids = kit.pingpong((i) => kit.storage({ label: `life.flock.boids${i}`, size: start.byteLength, usage: ['storage', 'copy-dst'], data: start }), 'life.flock');
  const flockBirds = kit.storage({ label: 'life.flock.birds', size: FLOCK_N * BIRD_FLOATS * 4, usage: ['storage', 'copy-dst', 'copy-src'] });
  const step: Compute = kit.compute(flockShader, {
    label: 'life.flock.step',
    entry: 'stepFlock',
    bind: { G: world.G, sim, prev: boids.read, next: boids.write, flock: flockBirds },
    threads: [FLOCK_N],
    enabled: () => on() && flockActive,
  });
  let flockActive = true;
  let roostedFor = 0;
  let started = false;

  // ---------------------------------------------------------------- the big birds
  const waders = new Waders();
  const bigBirds: StorageBuffer = kit.storage({ label: 'life.birds', size: waders.data.byteLength, usage: ['storage', 'copy-dst'] });
  bigBirds.write(waders.data);

  // ---------------------------------------------------------------- the lights of the night
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const life: UniformBuffer<any> = kit.uniforms(glowShader.structs.Life, 'life.glow');
  const flies = kit.storage({ label: 'life.fireflies', size: FLIES * 16, usage: ['storage', 'copy-dst'], data: fireflyHomes() });
  const lampData = new Float32Array(LAMPS * 12);
  const lamps = kit.storage({ label: 'life.lamps', size: lampData.byteLength, usage: ['storage', 'copy-dst'] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jellyU: UniformBuffer<any> = kit.uniforms(jellyShader.structs.Jelly, 'life.jelly');
  const homes = kit.storage({ label: 'life.jellies', size: JELLIES * 16, usage: ['storage', 'copy-dst'], data: jellyHomes() });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeU: UniformBuffer<any> = kit.uniforms(wakeShader.structs.Wake, 'life.wake');
  wakeU.set({ first: waders.swans[0], count: waders.swans.length });

  let fliesOn = false, mothsOn = false, jelliesOn = false, lampCount = 0;
  /** (dev: everything off, to measure what it costs) */
  const dev = { off: false };
  const on = () => !dev.off;
  const flockSeen = () => on() && roostedFor < 6;

  const draws: Array<{ ready(): Promise<unknown> }> = [];
  const add = 'add' as const;
  for (const [pass, tag] of [[refl, 'refl'], [scene, 'main']] as const) {
    draws.push(pass.draw(birdShader, {
      label: `life.starlings.${tag}`, phase: 'opaque', bind: { ...world, ...proj, birds: flockBirds },
      count: LOW_V, instances: FLOCK_N, cull: 'none', constants: { LOW: 1, MIN_PX: 2.0 }, enabled: flockSeen,
    }));
    draws.push(pass.draw(birdShader, {
      label: `life.birds.${tag}`, phase: 'opaque', bind: { ...world, ...proj, birds: bigBirds },
      count: FULL_V, instances: waders.count, cull: 'none', constants: { LOW: 0, MIN_PX: 1.2 }, enabled: on,
    }));
    draws.push(pass.draw(glowShader, {
      label: `life.fireflies.${tag}`, phase: 'glow', vertex: 'vsFly', fragment: 'fsGlow', bind: { ...world, L: life, flies },
      count: 6, instances: FLIES, blend: add, depthWrite: false, cull: 'none', enabled: () => on() && fliesOn,
    }));
    draws.push(pass.draw(glowShader, {
      label: `life.moths.${tag}`, phase: 'glow', vertex: 'vsMoth', fragment: 'fsGlow', bind: { ...world, L: life, lamps },
      count: 6, instances: LAMPS * MOTHS_PER_LAMP, blend: add, depthWrite: false, cull: 'none',
      constants: { MOTHS_PER_LAMP }, enabled: () => on() && mothsOn,
    }));
    draws.push(pass.draw(jellyShader, {
      label: `life.jellies.${tag}`, phase: 'glow', bind: { ...world, J: jellyU, homes },
      count: JELLY_V, instances: JELLIES, blend: add, depthWrite: false, cull: 'none', enabled: () => on() && jelliesOn,
    }));
    if (pass === scene) {
      draws.push(pass.draw(jellyShader, {
        label: 'life.jellies.pool', phase: 'glow', vertex: 'vsPool', fragment: 'fsPool', bind: { ...world, J: jellyU, homes },
        count: 6, instances: JELLIES, blend: add, depthWrite: false, cull: 'none', enabled: () => on() && jelliesOn,
      }));
      draws.push(pass.draw(wakeShader, {
        label: 'life.wakes', phase: 'glow', bind: { ...world, birds: bigBirds, W: wakeU },
        count: 6, instances: waders.swans.length, blend: add, depthWrite: false, cull: 'none', enabled: on,
      }));
    }
  }

  // ---------------------------------------------------------------- once a frame
  let time = 0;
  let stepN = 0;
  const centre: V3 = [56, 38, -32];
  const items: RunEntry[] = [step, boids.swap];

  function direct(t: number, dusk: number, dt: number, player: V3 | null): number {
    // the flock's lobes wandering over the lagoon, against the afterglow from the walk, merging and parting
    // (on the line to the setting sun from the walk's sunset end, high enough to clear the trees)
    centre[0] = 56 + 14 * Math.sin(t * 0.031);
    centre[1] = 38 + 6 * Math.sin(t * 0.047 + 1);
    centre[2] = -32 + 16 * Math.sin(t * 0.023 + 2);
    const split = smooth(0.6, 0.95, Math.sin(t * 0.017 + 0.5));
    const roost = smooth(0.34, 0.62, dusk);
    sim.set({
      time: t,
      dt,
      count: FLOCK_N,
      roost,
      att0: [centre[0], centre[1], centre[2], 15],
      att1: [centre[0] + split * 16 * Math.cos(t * 0.05), centre[1] + split * 6, centre[2] + split * 20 * Math.sin(t * 0.05), 10],
      att2: [centre[0] - split * 18 * Math.cos(t * 0.04 + 1), centre[1] - split * 4, centre[2] - split * 15 * Math.sin(t * 0.04 + 1), 9],
      falcon: waders.falcon,
      player: player ? [player[0], player[1] + 1, player[2], 1] : [0, -1000, 0, 0],
      roostAt: [ROOST[0], ROOST[1], ROOST[2], 3.5],
      swirl: [3.2 * Math.sin(t * 0.035), split, 0, 0],
      tileStart: (stepN++ * FLOCK_TILES) % (FLOCK_N / 256),
      tiles: FLOCK_TILES,
    });
    return roost;
  }

  function lampsFrom(night: number): void {
    lampCount = 0;
    lampData.fill(0);
    if (night > 0.3) {
      for (const p of env.projection.projectors) {
        if (lampCount >= LAMPS || !(p.power > 0)) continue;
        const ax = p.target[0] - p.position[0], ay = p.target[1] - p.position[1], az = p.target[2] - p.position[2];
        const reach = Math.hypot(ax, ay, az) || 1;
        const o = lampCount * 12;
        lampData.set([p.position[0], p.position[1], p.position[2], p.power, ax / reach, ay / reach, az / reach, reach, p.tint[0], p.tint[1], p.tint[2], 0], o);
        lampCount++;
      }
    }
    lamps.write(lampData);
  }

  if (import.meta.env.DEV) (window as unknown as { life: unknown }).life = { waders, centre, sim, flockBirds, dev };

  return {
    ready: Promise.all([step.ready(), ...draws.map((d) => d.ready())]).then(() => undefined),

    frame(state: FrameState): void {
      const d = state.dusk;
      const pl = state.player;
      const flyK = smooth(0.4, 0.75, d), mothK = smooth(0.45, 0.8, d), jellyK = smooth(0.5, 0.88, d);
      fliesOn = flyK > 0.001;
      mothsOn = mothK > 0.001 && lampCount > 0;
      jelliesOn = jellyK > 0.001;
      life.set({ player: pl ? [pl[0], pl[1], pl[2], 1] : [0, -1000, 0, 0], show: [flyK, mothK, lampCount, 0] });
      jellyU.set({ show: [jellyK, JELLIES, 0, 0] });
    },

    items(state: FrameState): readonly RunEntry[] {
      const dt = Math.min(Math.max(state.dt, 0), 1 / 15);
      time += dt;
      const roost = direct(time, state.dusk, dt, state.player);
      if (!started) {
        // (come in from the night side: the starlings already down in the roost)
        started = true;
        if (roost > 0) {
          const s = flockStart(centre, roost);
          boids.a.write(s);
          boids.b.write(s);
        }
      }
      roostedFor = roost >= 0.999 ? roostedFor + dt : 0;
      flockActive = roostedFor < 8;
      waders.step({ dt, time, dusk: state.dusk, night: state.tod.night, player: state.player, flock: centre, flockAloft: 1 - roost });
      bigBirds.write(waders.data);
      lampsFrom(state.tod.night);
      return items;
    },
  };
}

