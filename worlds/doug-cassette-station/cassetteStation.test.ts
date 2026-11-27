import { describe, expect, it } from 'vitest';
import {
  CASSETTE_SPOTS,
  CRT_NOOK_POS,
  ENTRANCE_Z,
  EXIT_Z,
  PROMENADE_HALF_WIDTH,
  SYNTH_PADS,
  createStationCollider,
  stationHeight,
} from './terrain';
import { stepCassette, stepCrtChannel, stepSynthPad } from './interactions';

describe('doug-cassette-station terrain & layout contract', () => {
  it('keeps entrance and exit portals completely flat at Y = 0', () => {
    for (const pz of [ENTRANCE_Z, EXIT_Z]) {
      for (const dx of [-4, -1.5, 0, 1.5, 4]) {
        for (const dz of [-2, 0, 2]) {
          expect(stationHeight(dx, pz + dz)).toBe(0);
        }
      }
    }
  });

  it('maintains a clear, level central promenade from entrance to exit with gentle side curbs', () => {
    for (let z = ENTRANCE_Z; z >= EXIT_Z; z -= 0.5) {
      expect(stationHeight(0, z)).toBe(0);
      expect(stationHeight(PROMENADE_HALF_WIDTH - 0.1, z)).toBe(0);
      expect(stationHeight(-(PROMENADE_HALF_WIDTH - 0.1), z)).toBe(0);
    }
    // Side station platform gently steps up to +0.12m
    expect(stationHeight(7.5, 0)).toBeCloseTo(0.12, 4);
  });

  it('pushes players smoothly out of kiosk/vending boxes and utility poles', () => {
    const collider = createStationCollider(
      [{ minX: 6.7, maxX: 8.1, minZ: 12, maxZ: 17, maxY: 2.5 }],
      [{ x: -6.4, z: 12, radius: 0.25, maxY: 6.2 }],
    );
    const [bx, bz] = collider.move([5.5, 0, 14], [6.6, 0, 14], 0.4, 1.7);
    expect(bx).toBeLessThanOrEqual(6.31);
    expect(bz).toBeCloseTo(14, 4);

    const [cx, cz] = collider.move([-5, 0, 12], [-6.1, 0, 12], 0.4, 1.7);
    expect(Math.hypot(cx - -6.4, cz - 12)).toBeGreaterThanOrEqual(0.64);
  });
});

describe('doug-cassette-station interactive experiences', () => {
  it('triggers recessed neon synth pads on step and respects cooldown', () => {
    expect(SYNTH_PADS).toHaveLength(5);
    const pad = { x: 0, z: 10, freq: 493.88, glow: 0, cooldown: 0 };
    expect(stepSynthPad(pad, { x: 4, y: 0, z: 10 }, 0.016)).toBe(false);
    expect(stepSynthPad(pad, { x: 0.2, y: 0, z: 10.1 }, 0.016)).toBe(true);
    expect(pad.glow).toBe(1);
    expect(stepSynthPad(pad, { x: 0.2, y: 0, z: 10.1 }, 0.016)).toBe(false);
    stepSynthPad(pad, null, 1.2);
    expect(stepSynthPad(pad, { x: 0.2, y: 0, z: 10.1 }, 0.016)).toBe(true);
  });

  it('discovers hidden cassette tapes once and keeps them pulsing', () => {
    expect(CASSETTE_SPOTS).toHaveLength(5);
    const c = {
      id: 'blue-hour',
      title: 'Side A: Blue Hour Rain',
      spot: 'by the bench',
      x: -5.4,
      y: 0.95,
      z: 14.2,
      color: '#38bdf8',
      found: false,
      pulse: 0,
    };
    expect(stepCassette(c, { x: -5.2, y: 0.1, z: 14.0 }, 0.016)).toBe(true);
    expect(c.found).toBe(true);
    expect(stepCassette(c, { x: -5.2, y: 0.1, z: 14.0 }, 0.016)).toBe(false);
  });

  it('cycles CRT shrine channels when approached', () => {
    const crt = { channel: 0, channelCount: 4, cooldown: 0 };
    expect(stepCrtChannel(crt, { x: CRT_NOOK_POS.x - 1.5, y: 0.1, z: CRT_NOOK_POS.z }, 0.016)).toBe(true);
    expect(crt.channel).toBe(1);
    expect(stepCrtChannel(crt, { x: CRT_NOOK_POS.x - 1.5, y: 0.1, z: CRT_NOOK_POS.z }, 0.016)).toBe(false);
  });
});
