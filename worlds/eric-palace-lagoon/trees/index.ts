import { Ref, generateMips, warmMips, type Kit, type StorageBuffer } from '@ericrius1/weft';
import { breathe } from '@portalverse/core/rooms/kit';
import type { RoomEnv, RoomFeature } from '../env';
import treesShader from './trees.wgsl';
import leavesShader from './leaves.wgsl';
import glowShader from './glow.wgsl';
import { LAYERS, SPECIES, speciesIndex, type Species } from './species';
import { PLACED, TREE_TRUNKS, understory, type Placed } from './placement';
import { CARD, type Grown } from './grow';

/**
 * The Palace Lagoon's grove: a magical Palace of Fine Arts' gardens. Monumental live oaks hung with lantern-fruit,
 * Italian cypresses framing the approach, weeping willows trailing their strands in the lagoon (their tips glowing
 * teal at night), jacarandas and cherries whose blossom catches the sunset and then glows violet and rose in the dark,
 * shedding glow-seeds that drift up on the wind; Monterey cypresses against the sunset on the far shore, ferns and
 * flowering shrubs under it all, and woods on the hills round the horizon.
 *
 * How (each file says more): species.ts the kinds; grow.ts grows each kind once (in grove.worker.ts) into a list of
 * bark vertices and a list of cards; placement.ts places every tree (and TREE_TRUNKS, for the room's collider);
 * leaves.wgsl draws the leaf atlas once; trees.wgsl draws a kind's bark and cards over its trees, each tree culled to
 * the view and its cards thinned with distance in the vertex shader; glow.wgsl the lanterns and the seeds.
 *
 * Draws, a kind at a time: into the scene and the reflection (opaque: bark, cards; glow: lanterns, seeds) and the key
 * light's shadow (bark, and the far level of the cards, alpha-tested). The woods are their own draws at their far
 * level only. Everything is declared once here; the meshes arrive from the worker and are bound through Refs.
 */
export { TREE_TRUNKS };

/** the leaf atlas's size a side */
const ATLAS = 512;
/** seeds rising from each glowing crown at once */
const SEEDS_PER = 36;
const ADD = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } as const;

/** each kind's far level: its outer cards grow as the rest shrink away, from .. to (m, over the tree's size) */
const LOD: Record<string, [number, number]> = {
  oak: [55, 115], cypress: [45, 95], monterey: [55, 115], willow: [50, 105], jacaranda: [45, 95], cherry: [40, 85],
  shrub: [20, 45], pine: [50, 100], fern: [12, 26],
};
/** past this (m) a small kind isn't drawn at all */
const REACH: Record<string, number> = { shrub: 160, fern: 45 };

/** (for measuring: `window.__groveOff = true` hides the whole grove) */
const groveOff = (): boolean => (globalThis as { __groveOff?: boolean }).__groveOff === true;

// ------------------------------------------------------------------ grown once a session, in a worker
let grownOnce: Promise<Grown[]> | null = null;
function grownKinds(): Promise<Grown[]> {
  return (grownOnce ??= new Promise<Grown[]>((resolve, reject) => {
    const worker = new Worker(new URL('./grove.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ grown?: Grown[]; error?: string }>) => {
      worker.terminate();
      if (event.data.grown) resolve(event.data.grown);
      else reject(new Error(event.data.error ?? 'the grove did not grow'));
    };
    worker.onerror = event => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({});
  }));
}

/** a point of a kind's (m) placed for tree t, as trees.wgsl's place() */
function placeAt(t: Placed, x: number, y: number, z: number): [number, number, number] {
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  return [t.x + (x * c - z * s) * t.s, t.y + y * t.sy * t.s, t.z + (x * s + z * c) * t.s];
}

/** the crown's middle (m up) and its radius, as grow.ts crownLobes makes it */
function crownOf(S: Species): [number, number] {
  const yb = S.base * S.h;
  const cy = S.shape === 'shrub' ? S.h * 0.5 : (yb + S.h) / 2;
  const ry = S.shape === 'shrub' ? S.h * 0.5 : (S.h - yb) / 2;
  return [cy, Math.max(S.r, ry) * 0.85];
}

/** trees as trees.wgsl reads them: two vec4s each */
function treeData(list: Placed[]): Float32Array {
  const d = new Float32Array(Math.max(1, list.length) * 8);
  list.forEach((t, i) => d.set([t.x, t.y, t.z, t.s, t.yaw, t.sy, t.seed, t.woods ? 1 : 0], i * 8));
  return d;
}

export function createGrove(env: RoomEnv): RoomFeature {
  const { kit, scene, refl, shadow, world } = env;
  const lit = { ...world, ...env.projection.bindings };

  // ---- the leaf atlas, drawn once its shader's compiled, then its mips
  const atlas = kit.texture({ label: 'grove.leaves', format: 'rgba8unorm', size: [ATLAS, ATLAS, LAYERS], mips: 'full', view: '2d-array', usage: ['sample', 'storage', 'render'] });
  const bake = kit.compute(leavesShader, { label: 'grove.leaves', threads: [ATLAS, ATLAS, LAYERS], bind: { leafOut: atlas } as never });

  // ---- each kind: its trees (here now), its mesh (from the worker), its light
  const grown: (Grown | null)[] = SPECIES.map(() => null);
  const meshes: { cards: StorageBuffer; bark: StorageBuffer }[] = [];
  const dummy = kit.storage({ label: 'grove.none', size: CARD * 4 * 6 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lights: ({ set(v: any): unknown } | null)[] = SPECIES.map(() => null);
  let loaded = false;
  /** the shrubs' and ferns' trees, filled when the understory's placed */
  const lowSets: { name: string; inst: { buf: StorageBuffer; n: number } }[] = [];

  SPECIES.forEach((S, si) => {
    const low = S.shape === 'shrub' || S.shape === 'fern';
    const heroes = PLACED.filter(t => t.species === S.name && !t.woods);
    const woods = PLACED.filter(t => t.species === S.name && t.woods);
    // (the shrubs and ferns are placed a little later: understory())
    if (!heroes.length && !woods.length && !low) return;
    const [lodFrom, lodTo] = LOD[S.name] ?? [50, 100];
    const sp = kit.uniforms(treesShader.structs.Species, `grove.${S.name}`).set({
      leaf: S.leafCol, glowLeaves: S.glowLeaves, lit: S.leafLit, gloss: S.gloss, through: S.through, moss: S.moss,
      bark: S.bark, height: S.h, bloom: S.bloom, glow: S.glow, tipGlow: S.tipGlow, reach: REACH[S.name] ?? 0,
      bound: [S.h * 0.5, Math.hypot(S.r, S.h * 0.5) * 1.15 + 1, lodFrom, lodTo],
    } as never);
    lights[si] = sp;
    const mesh = {
      cards: new Ref(() => meshes[si]?.cards ?? dummy),
      bark: new Ref(() => meshes[si]?.bark ?? dummy),
    };
    const cardCount = (far: boolean) => () => {
      const g = grown[si];
      return g ? (far ? g.farCards : g.cardCount) * 6 : 0;
    };
    const barkCount = (trunk: boolean) => () => {
      const g = grown[si];
      return g ? (trunk ? g.trunkVerts : g.barkCount) : 0;
    };
    const on = () => loaded && !groveOff();
    for (const [set, list] of [['hero', heroes], ['woods', woods]] as const) {
      if (!list.length && !(low && set === 'hero')) continue;
      const inst = { buf: kit.storage({ label: `grove.${S.name}.${set}`, data: treeData(list), usage: ['storage', 'copy-dst'] }), n: list.length };
      if (low && set === 'hero') lowSets.push({ name: S.name, inst });
      const trees = new Ref(() => inst.buf);
      const n = () => inst.n;
      const far = set === 'woods';
      const bind = { ...lit, S: sp, trees, cards: mesh.cards, bark: mesh.bark, leafTex: atlas };
      for (const [pass, tag] of [[scene, 'main'], [refl, 'refl']] as const) {
        // (the mirror: no ferns, no shrubs' or woods' bark: too low or too far to see in the water)
        const skipBark = tag === 'refl' && (low || far);
        if (!(tag === 'refl' && S.shape === 'fern')) {
          pass.draw(treesShader, {
            label: `grove.${S.name}.${set}.leaves.${tag}`, vertex: 'vsLeaf', fragment: 'fsLeaf', bind: bind as never,
            count: cardCount(far), instances: n, cull: 'none', enabled: on, phase: 'opaque',
          });
        }
        if (!skipBark && S.shape !== 'fern') {
          pass.draw(treesShader, {
            label: `grove.${S.name}.${set}.bark.${tag}`, vertex: 'vsBark', fragment: 'fsBark', bind: bind as never,
            count: barkCount(far), instances: n, cull: 'none', enabled: on, phase: 'opaque',
          });
        }
      }
      if (!far && S.shape !== 'fern') {
        const sbind = { S: sp, trees, cards: mesh.cards, bark: mesh.bark, leafTex: atlas };
        shadow.draw(treesShader, {
          label: `grove.${S.name}.bark.shadow`, vertex: 'vsBarkShadow', fragment: null, bind: sbind as never,
          count: barkCount(false), instances: n, cull: 'none', enabled: on,
        });
        shadow.draw(treesShader, {
          label: `grove.${S.name}.leaves.shadow`, vertex: 'vsLeafShadow', fragment: 'fsLeafShadow', bind: sbind as never,
          count: cardCount(true), instances: n, cull: 'none', enabled: on,
        });
      }
    }
  });

  // ---- the lanterns and the seeds: where they are is known now (the lanterns' places on each tree when it's grown)
  const heroes = PLACED.filter(t => !t.woods);
  const lanternTrees = heroes.filter(t => (SPECIES[speciesIndex(t.species)].lanterns ?? 0) > 0);
  const lanternCount = lanternTrees.reduce((n, t) => n + (SPECIES[speciesIndex(t.species)].lanterns ?? 0), 0);
  const lanterns = kit.storage({ label: 'grove.lanterns', size: Math.max(1, lanternCount) * 32, usage: ['storage', 'copy-dst'] });
  const seedTrees = heroes.filter(t => SPECIES[speciesIndex(t.species)].seeds);
  const emitData = new Float32Array(Math.max(1, seedTrees.length) * 8);
  seedTrees.forEach((t, i) => {
    const S = SPECIES[speciesIndex(t.species)];
    const [cy, cr] = crownOf(S);
    const glow = S.name === 'willow' ? S.tipGlow : S.glow;
    emitData.set([...placeAt(t, 0, cy, 0), cr * t.s, glow[0], glow[1], glow[2], 0], i * 8);
  });
  const emitters = kit.storage({ label: 'grove.emitters', data: emitData, usage: ['storage', 'copy-dst'] });
  const glowBind = { G: world.G, lanterns, emitters };
  for (const [pass, tag] of [[scene, 'main'], [refl, 'refl']] as const) {
    if (lanternCount > 0) {
      pass.draw(glowShader, {
        label: `grove.lanterns.${tag}`, vertex: 'vsLantern', fragment: 'fsGlow', bind: glowBind as never, count: 6, instances: lanternCount,
        cull: 'none', depthWrite: false, blend: ADD, phase: 'glow', enabled: () => loaded && !groveOff(),
      });
    }
    if (seedTrees.length > 0) {
      pass.draw(glowShader, {
        label: `grove.seeds.${tag}`, vertex: 'vsSeed', fragment: 'fsGlow', bind: glowBind as never, count: 6, instances: seedTrees.length * SEEDS_PER,
        cull: 'none', depthWrite: false, blend: ADD, phase: 'glow', constants: { EMITTERS: seedTrees.length }, enabled: () => !groveOff(),
      });
    }
  }

  const ready = (async () => {
    const [kinds, under] = await Promise.all([
      grownKinds(),
      understory(),
      // (the mips' pipelines warmed first: a mip fill whose pipeline isn't ready leaves the mips empty, and far crowns bare)
      Promise.all([kit.ready([bake]), warmMips(kit, ['rgba8unorm'])]).then(() => {
        kit.run([bake]);
        generateMips(kit, atlas);
      }),
    ]);
    // the meshes up, a kind at a time with a breath between
    for (const g of kinds) {
      const si = speciesIndex(g.name);
      const cards = upload(kit, `grove.${g.name}.cards`, g.cards);
      const bark = upload(kit, `grove.${g.name}.bark`, g.bark);
      meshes[si] = { cards, bark };
      grown[si] = g;
      lights[si]?.set({ farCards: g.farCards, trunkVerts: g.trunkVerts });
      await breathe();
    }
    // the lanterns where they hang on each tree
    const ld = new Float32Array(Math.max(1, lanternCount) * 8);
    let k = 0;
    let seed = 1;
    for (const t of lanternTrees) {
      const S = SPECIES[speciesIndex(t.species)];
      const g = grown[speciesIndex(t.species)];
      if (!g) continue;
      const col = S.name === 'oak' ? [1.6, 0.85, 0.36] : [S.glow[0] * 0.7 + 0.5, S.glow[1] * 0.7 + 0.35, S.glow[2] * 0.7 + 0.25];
      for (let j = 0; j < g.lanterns.length / 4 && k < lanternCount; j++, k++) {
        const p = placeAt(t, g.lanterns[j * 4], g.lanterns[j * 4 + 1], g.lanterns[j * 4 + 2]);
        seed = (seed * 16807) % 2147483647;
        ld.set([p[0], p[1], p[2], g.lanterns[j * 4 + 3] * t.s, col[0], col[1], col[2], seed / 2147483647], k * 8);
      }
    }
    lanterns.write(ld);
    for (const { name, inst } of lowSets) {
      const list = under.filter(t => t.species === name);
      inst.buf = kit.storage({ label: `grove.${name}.hero`, data: treeData(list), usage: ['storage', 'copy-dst'] });
      inst.n = list.length;
    }
    loaded = true;
  })();

  return { ready };
}

function upload(kit: Kit, label: string, data: Float32Array): StorageBuffer {
  const buf = kit.storage({ label, size: Math.max(16, data.byteLength), usage: ['storage', 'copy-dst'] });
  if (data.byteLength) buf.write(data);
  return buf;
}

