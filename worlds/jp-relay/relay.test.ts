import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { threshold } from '@portalverse/core/portal/roomLayout';
import {
  GLYPH_PIXELS,
  RING_PIXELS,
  compileProgram,
  createLookScratch,
  createPlatterFrame,
  ease,
  headPixel,
  loopTime,
  sampleLook,
  samplePlatter,
  towerTiming,
  type ChaseProgram,
  type CompiledProgram,
  type TowerTiming,
} from './cues';
import { GLYPH, glyphAtlasPixels, glyphBit, glyphDensity, GLYPH_COUNT } from './glyphs';
import {
  MAX_PLATTERS,
  MIN_PLATTERS,
  PLATTER_GAP,
  PLATTER_HEIGHT,
  PLATTER_RADIUS,
  RACK_HALF,
  RackCollision,
  WALKWAY_HALF_LENGTH,
  WALKWAY_HALF_WIDTH,
  platterCenterY,
  rackField,
  rackHeight,
} from './layout';
import { BEAT, PROGRAM_MIX, RELAY, compiledPrograms, programFor } from './programs';

const FOOT = 0.3048;
const relay = compileProgram(RELAY, MAX_PLATTERS);
const scratch = createLookScratch();

/** Ring distance between two pixel positions, -128..128. */
function ringDelta(a: number, b: number): number {
  return ((a - b + RING_PIXELS * 1.5) % RING_PIXELS) - RING_PIXELS / 2;
}

/** The first loop time (to 1 ms) at which a platter's attribute reaches a value. */
function firstTime(program: CompiledProgram, platter: number, platters: number, slot: number, test: (v: number) => boolean): number {
  for (let ms = 0; ms < (program.length + program.rest) * 1000; ms++) {
    if (test(sampleLook(program, ms / 1000, platter, platters, scratch)[slot])) return ms / 1000;
  }
  return NaN;
}

describe('cue scheduler', () => {
  it('lights the relay from the bottom up, one beat a platter', () => {
    const starts = Array.from({ length: 9 }, (_, k) => firstTime(relay, k, 9, 0, v => v > 0));
    expect(starts[0]).toBeCloseTo(0, 2);
    for (let k = 1; k < starts.length; k++) expect(starts[k] - starts[k - 1]).toBeCloseTo(BEAT, 2);
    // Nothing above a platter is lit before it is.
    const local = starts[3] + 0.001;
    expect(sampleLook(relay, local, 3, 9, scratch)[0]).toBeGreaterThan(0);
    expect(sampleLook(relay, local, 4, 9, scratch)[0]).toBe(0);
  });

  it('runs each platter a glyph behind the one below, at the same speed', () => {
    const timing: TowerTiming = { period: relay.length + relay.rest, offset: 0, angle: 0.37 };
    for (const time of [3, 9.5, 40.25, 1234.5]) {
      const heads = Array.from({ length: 6 }, (_, k) => headPixel(relay, timing, time, k, 1));
      for (let k = 1; k < heads.length; k++) expect(ringDelta(heads[k - 1], heads[k])).toBeCloseTo(GLYPH_PIXELS, 6);
      // A beat later, every head has moved the same distance.
      const later = Array.from({ length: 6 }, (_, k) => headPixel(relay, timing, time + BEAT, k, 1));
      const moved = heads.map((h, k) => ringDelta(later[k], h));
      for (const m of moved) expect(m).toBeCloseTo(moved[0], 6);
      expect(moved[0]).toBeCloseTo((RING_PIXELS * BEAT) / (8 * BEAT), 6);
    }
  });

  it('grows the tail after the tower is lit, bottom platter first', () => {
    const lit = firstTime(relay, 8, 9, 0, v => v >= 0.999);
    const tails = Array.from({ length: 9 }, (_, k) => firstTime(relay, k, 9, 1, v => v > 0));
    expect(tails[0]).toBeCloseTo(16 * BEAT, 2);
    expect(tails[0]).toBeGreaterThan(lit);
    for (let k = 1; k < tails.length; k++) expect(tails[k] - tails[k - 1]).toBeCloseTo(BEAT, 2);
    // Fully grown four beats after it starts, and still growing on the platter above.
    const grown = tails[0] + 4 * BEAT + 0.001;
    expect(sampleLook(relay, grown, 0, 9, scratch)[1]).toBeCloseTo(9, 6);
    expect(sampleLook(relay, grown, 1, 9, scratch)[1]).toBeLessThan(9);
    expect(sampleLook(relay, grown, 1, 9, scratch)[1]).toBeGreaterThan(0);
  });

  it('wraps every loop seamlessly, for every program and tower height', () => {
    for (const program of compiledPrograms()) {
      for (const platters of [MIN_PLATTERS, MAX_PLATTERS]) {
        const timing = towerTiming(program, 4242);
        for (let k = 0; k < platters; k++) {
          // Every fade has finished by the end of the loop, which matches its start.
          const end = Array.from(sampleLook(program, timing.period - 1e-6, k, platters, createLookScratch()));
          const start = Array.from(sampleLook(program, 0, k, platters, createLookScratch()));
          for (let i = 0; i < end.length; i++) expect(start[i]).toBeCloseTo(end[i], 9);
        }
      }
    }
  });

  it('crosses the wrap on the shared clock without a jump', () => {
    // A program whose first cue fades in smoothly from its GO at the wrap.
    const smooth = compileProgram({ ...RELAY, name: 'smooth', cues: RELAY.cues.map((cue, i) => (i === 0 ? { ...cue, easing: 'smooth' as const, fade: 2 } : cue)) }, MAX_PLATTERS);
    const timing = towerTiming(smooth, 4242);
    const wrapAt = 3 * timing.period - timing.offset;
    expect(loopTime(timing, wrapAt - 0.0005)).toBeGreaterThan(timing.period - 0.001);
    expect(loopTime(timing, wrapAt + 0.0005)).toBeLessThan(0.001);
    const before = createPlatterFrame();
    const after = createPlatterFrame();
    for (let k = 0; k < MAX_PLATTERS; k++) {
      samplePlatter(smooth, timing, wrapAt - 0.0005, k, MAX_PLATTERS, before, scratch);
      samplePlatter(smooth, timing, wrapAt + 0.0005, k, MAX_PLATTERS, after, scratch);
      expect(after.intensity).toBeCloseTo(before.intensity, 5);
      expect(after.tail).toBeCloseTo(before.tail, 6);
      expect(after.glyph).toBe(before.glyph);
      expect(Math.abs(ringDelta(after.head, before.head))).toBeLessThan(0.1);
    }
  });

  it('ends each loop where it starts: dark, with no tail', () => {
    for (const program of compiledPrograms()) {
      expect(program.settled[0]).toBe(0);
      expect(program.settled[1]).toBe(0);
      const out = sampleLook(program, 0, 0, MAX_PLATTERS, createLookScratch());
      expect(Array.from(out)).toEqual(Array.from(program.settled));
    }
  });

  it('crossfades the twist program\'s phase without moving the glyphs\' speed', () => {
    const twist = compiledPrograms()[PROGRAM_MIX.findIndex(entry => entry.program.name === 'twist')];
    const before = sampleLook(twist, 8 * BEAT - 0.01, 3, 9, createLookScratch())[3];
    const middle = sampleLook(twist, 14 * BEAT, 3, 9, createLookScratch())[3];
    const after = sampleLook(twist, 21 * BEAT, 3, 9, createLookScratch())[3];
    expect(before).toBe(0);
    expect(middle).toBeGreaterThan(0.5);
    expect(middle).toBeLessThan(1.5);
    expect(after).toBeCloseTo(2, 6);
  });

  it('is deterministic and spreads towers through their loops', () => {
    const a = createPlatterFrame();
    const b = createPlatterFrame();
    const timing = towerTiming(relay, 1017);
    samplePlatter(relay, timing, 77.7, 4, 11, a);
    samplePlatter(relay, towerTiming(relay, 1017), 77.7, 4, 11, b);
    expect(b).toEqual(a);
    const offsets = rackField().map(rack => towerTiming(relay, rack.seed).offset / towerTiming(relay, rack.seed).period);
    expect(new Set(offsets.map(o => o.toFixed(6))).size).toBe(offsets.length);
    // Roughly even across the loop: every quarter gets a fair share of towers.
    for (let q = 0; q < 4; q++) {
      const share = offsets.filter(o => o >= q / 4 && o < (q + 1) / 4).length / offsets.length;
      expect(share).toBeGreaterThan(0.1);
    }
  });

  it('rejects programs whose fades would still be running when the loop wraps', () => {
    const late: ChaseProgram = {
      ...RELAY,
      name: 'late',
      rest: 0,
      cues: [{ label: 'slow', hold: 4, fade: 3, delay: 0.5, look: { intensity: 1 } }],
    };
    expect(() => compileProgram(late, 13)).toThrow(/still fading/);
    expect(() => compileProgram({ ...RELAY, base: { ...RELAY.base, heads: 3 } }, 13)).toThrow(/heads/);
    expect(() => compileProgram({ ...RELAY, base: { ...RELAY.base, spacing: 4 } }, 13)).toThrow(/spacing/);
  });

  it('eases from 0 to 1, with a flicker on ignite', () => {
    for (const name of ['linear', 'smooth', 'in', 'out', 'ignite'] as const) expect(ease(name, 1)).toBe(1);
    expect(ease('smooth', 0)).toBe(0);
    expect(ease('ignite', 0.12)).toBeLessThan(0.2);
    expect(ease('ignite', 0.2)).toBeGreaterThan(0.5);
    expect(ease('snap', 0)).toBe(0);
    expect(ease('snap', 0.001)).toBe(1);
  });

  it('rejects invalid timing before it can produce NaN display coordinates', () => {
    expect(() => compileProgram({ ...RELAY, rest: Infinity }, 13)).toThrow(/rest/);
    expect(() => compileProgram({ ...RELAY, restJitter: -1 }, 13)).toThrow(/restJitter/);
    expect(() => compileProgram({ ...RELAY, cues: [], rest: 0 }, 13)).toThrow(/loop duration/);
    expect(() => compileProgram({ ...RELAY, cues: [{ ...RELAY.cues[0], fade: NaN }] }, 13)).toThrow(/finite/);
    expect(() => compileProgram(RELAY, 0)).toThrow(/maxPlatters/);
  });

  it('picks the relay for most towers', () => {
    const racks = rackField();
    const relays = racks.filter(rack => PROGRAM_MIX[programFor(rack.seed)].program === RELAY).length;
    expect(relays / racks.length).toBeGreaterThan(0.55);
    expect(new Set(racks.map(rack => programFor(rack.seed))).size).toBe(PROGRAM_MIX.length);
  });
});

describe('glyphs', () => {
  it('draws the slashed zero with a slash from bottom left to top right', () => {
    expect(glyphBit(GLYPH.slashedZero, 5, 2)).toBe(true);
    expect(glyphBit(GLYPH.slashedZero, 2, 5)).toBe(true);
    expect(glyphBit(GLYPH.slashedZero, 2, 2)).toBe(false);
    expect(glyphBit(GLYPH.zero, 5, 2)).toBe(false);
    expect(glyphDensity(GLYPH.block)).toBe(1);
    expect(glyphAtlasPixels().length).toBe(8 * 8 * GLYPH_COUNT * 4);
  });
});

describe('rack field', () => {
  const racks = rackField();

  it('builds racks to the brief: 4 ft square, 10 to 20 ft tall, 4 in platters 12 in apart', () => {
    expect(RACK_HALF * 2).toBeCloseTo(4 * FOOT, 9);
    expect(PLATTER_HEIGHT).toBeCloseTo(FOOT / 3, 9);
    expect(PLATTER_GAP).toBeCloseTo(FOOT, 9);
    expect(platterCenterY(1) - platterCenterY(0)).toBeCloseTo(PLATTER_HEIGHT + PLATTER_GAP, 9);
    // Each 8 × 8 module on the rim is square: 256 LEDs round, 8 up.
    expect((2 * Math.PI * PLATTER_RADIUS) / 256).toBeCloseTo(PLATTER_HEIGHT / 8, 9);
    expect(PLATTER_RADIUS).toBeLessThan(RACK_HALF - 0.05);
    for (const rack of racks) {
      expect(rack.platters).toBeGreaterThanOrEqual(MIN_PLATTERS);
      expect(rack.platters).toBeLessThanOrEqual(MAX_PLATTERS);
      expect(rack.height).toBeGreaterThanOrEqual(10 * FOOT);
      expect(rack.height).toBeLessThanOrEqual(20 * FOOT);
      expect(rack.height).toBeCloseTo(rackHeight(rack.platters), 9);
      expect(platterCenterY(rack.platters - 1) + PLATTER_HEIGHT / 2).toBeLessThan(rack.height);
    }
    expect(racks.length).toBeGreaterThan(100);
    expect(racks.length).toBeLessThan(220);
  });

  it('keeps the walkway and both portals clear, and racks apart', () => {
    for (const rack of racks) {
      expect(Math.abs(rack.x) - RACK_HALF).toBeGreaterThan(WALKWAY_HALF_WIDTH + 5);
    }
    for (let i = 0; i < racks.length; i++) {
      for (let j = i + 1; j < racks.length; j++) {
        const gap = Math.max(Math.abs(racks[i].x - racks[j].x), Math.abs(racks[i].z - racks[j].z));
        expect(gap).toBeGreaterThan(RACK_HALF * 2 + 1);
      }
    }
    expect(WALKWAY_HALF_LENGTH).toBeGreaterThan(Math.abs(threshold('entrance').position[2]));
    expect(racks).toEqual(rackField());
  });

  it('is flat at y = 0 all along the route and through both portals', () => {
    const collision = new RackCollision(racks);
    for (let z = -WALKWAY_HALF_LENGTH; z <= WALKWAY_HALF_LENGTH; z += 0.5) {
      for (const x of [-WALKWAY_HALF_WIDTH, 0, WALKWAY_HALF_WIDTH]) {
        expect(collision.heightAt(x, z, 0)).toBe(0);
        expect(collision.move([x, 0, z], [x, 0, z - 0.3], 0.35)).toEqual([x, z - 0.3]);
      }
    }
  });

  it('stops walkers at a rack and lets fliers land on its lid', () => {
    const collision = new RackCollision(racks);
    const rack = racks[0];
    const side = rack.x - RACK_HALF - 0.5;
    const [x] = collision.move([side, 0, rack.z], [rack.x - RACK_HALF, 0, rack.z], 0.35);
    expect(x).toBeCloseTo(rack.x - RACK_HALF - 0.35, 6);
    // Above the lid nothing pushes, and coming down onto it you stand on it.
    expect(collision.move([rack.x, rack.height + 1, rack.z], [rack.x + 0.1, rack.height + 1, rack.z], 0.35)).toEqual([rack.x + 0.1, rack.z]);
    expect(collision.heightAt(rack.x, rack.z, rack.height + 0.4)).toBeCloseTo(rack.height, 9);
    // Standing beside it, the lid isn't a step up.
    expect(collision.heightAt(rack.x, rack.z, 0)).toBe(0);
  });
});

describe('mount', () => {
  it('builds the room, samples every platter each frame, and disposes everything', async () => {
    const { default: room } = await import('./index');
    const scene = new THREE.Scene();
    const updates: Array<(dt: number, elapsed: number) => void> = [];
    const cleanups: Array<() => void> = [];
    let terrain: ((x: number, z: number, fromY?: number) => number) | undefined;
    const disposed = new Set<unknown>();
    await room.mount({
      mode: 'preview',
      player: null,
      scene,
      renderer: {} as never,
      gpu: null,
      addGpuLayer: () => false,
      addPortal: () => { throw new Error('unused'); },
      registerCustomPortal: () => {},
      onActivate: () => {},
      breathe: async () => {},
      onUpdate: fn => updates.push(fn),
      onDispose: fn => cleanups.push(fn),
      addPlatform: () => {},
      setTerrainHeight: fn => { terrain = fn; },
      allowFalling: () => {},
      setCollider: () => {},
      setWalkBounds: () => {},
      configureSpawn: () => {},
      enterPortal: () => {},
    });
    expect(terrain?.(0, 35.75, 0)).toBe(0);
    expect(scene.fog).toBeInstanceOf(THREE.Fog);

    const meshes: THREE.Mesh[] = [];
    scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    // Floor, and two of each (above the floor and its reflection): rims, faces, cages, spindles, haze.
    expect(meshes.length).toBe(11);
    const rims = meshes.find(m => m.geometry.getAttribute('aChase'))!;
    const chase = rims.geometry.getAttribute('aChase').array as Float32Array;
    const style = rims.geometry.getAttribute('aStyle').array as Float32Array;
    const styleAttribute = rims.geometry.getAttribute('aStyle') as THREE.InstancedBufferAttribute;
    const styleVersion = styleAttribute.version;
    expect(chase.length / 4).toBe(rackField().reduce((n, rack) => n + rack.platters, 0));

    for (let frame = 0; frame < 60; frame++) updates.forEach(fn => fn(1 / 60, 30 + frame / 60));
    // The built-in programs animate heads/tails, but keep glyph/falloff/spacing fixed.
    // Float32 rounding must not turn a constant falloff into an upload every frame.
    expect(styleAttribute.version).toBe(styleVersion);
    let lit = 0;
    for (let i = 0; i < chase.length; i += 4) {
      expect(chase[i]).toBeGreaterThanOrEqual(0);
      expect(chase[i]).toBeLessThan(RING_PIXELS);
      expect(chase[i + 2]).toBeGreaterThanOrEqual(0);
      expect(chase[i + 2]).toBeLessThanOrEqual(1);
      expect(Math.abs(chase[i + 3])).toBe(1);
      expect([1, 2, 4, 8]).toContain(style[i + 1]);
      if (chase[i + 2] > 0.5) lit++;
    }
    // The field is never all dark, nor all lit.
    expect(lit).toBeGreaterThan(chase.length / 4 / 5);
    expect(lit).toBeLessThan(chase.length / 4);

    for (const mesh of meshes) {
      mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.geometry));
      const material = mesh.material as THREE.Material;
      material.addEventListener('dispose', () => disposed.add(material));
    }
    cleanups.forEach(fn => fn());
    for (const mesh of meshes) {
      expect(disposed.has(mesh.geometry)).toBe(true);
      expect(disposed.has(mesh.material)).toBe(true);
    }
    expect(scene.children.length).toBe(0);
    expect(scene.fog).toBeNull();
  });
});
