import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import catalog from '../../../../registry.json';
import type { PortalVisualHandle, RegistryFile } from '../types';
import { ROUTE_LENGTH, RUN_SPEED, WARP_RADIUS, routeGates, threshold } from '../portal/roomLayout';
import { createArchwayPortal } from '../engine/PortalMesh';
import { carryThroughPortal, crossingYawDelta } from '../engine/portalCrossing';
import {
  WARP_SPEED_BOOST,
  portalWarp,
  smoothSpeed,
  warpFalloff,
  warpSpeedFactor,
} from '../engine/portalWarp';

const rooms = (catalog as unknown as RegistryFile).worlds.filter(room => room.kind === 'local');
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function gates(roomId: string): PortalVisualHandle[] {
  return routeGates(roomId, rooms).map(g => createArchwayPortal(g, { passage: true, routeGate: true }));
}

describe('warp zone', () => {
  it('fades from nothing at the circle to full strength at the centre', () => {
    expect(warpFalloff(0)).toBe(1);
    expect(warpFalloff(WARP_RADIUS)).toBe(0);
    expect(warpFalloff(WARP_RADIUS + 3)).toBe(0);
    expect(warpFalloff(WARP_RADIUS * 0.95)).toBeLessThan(0.01); // eases in at the edge
    let previous = 1;
    for (let d = 0.25; d <= WARP_RADIUS; d += 0.25) {
      const value = warpFalloff(d);
      expect(value).toBeLessThan(previous);
      previous = value;
    }
  });

  it('measures flat distance on the floor, ignoring height', () => {
    const exit = gates('eric-world').find(g => g.portal.id === 'exit')!;
    const z = exit.triggerCenter.z;
    expect(portalWarp([exit], v(0, 0, z))).toBe(1);
    expect(portalWarp([exit], v(0, 6, z))).toBe(1); // flying over the threshold
    expect(portalWarp([exit], v(0, 0, z + 3))).toBeCloseTo(portalWarp([exit], v(3, 0, z)));
    expect(portalWarp([exit], v(0, 0, z + WARP_RADIUS + 0.1))).toBe(0);
  });

  it('takes the strongest nearby portal, including links to other servers', () => {
    const [entrance, exit] = gates('eric-world');
    const remote = createArchwayPortal(
      { id: 'friend', label: 'Friend', position: [10, 0, 0], targetWorldId: 'x', remoteUrl: 'https://friend.example/' },
      { passage: true },
    );
    const handles = [entrance, exit, remote];
    expect(portalWarp(handles, v(0, 0, 0))).toBe(0); // mid-room, far from every portal
    expect(portalWarp(handles, v(10, 0, 1))).toBeCloseTo(warpFalloff(1));
    expect(portalWarp(handles, v(0, 0, exit.triggerCenter.z + 1))).toBeCloseTo(warpFalloff(1));
  });

  it('gives the same warp on both sides of every route crossing', () => {
    for (const room of rooms) {
      for (const gate of routeGates(room.id, rooms)) {
        const arrival = threshold(gate.targetSpawnId as 'entrance' | 'exit');
        const origin = v(...gate.position);
        const landing = v(...arrival.position);
        const yawDelta = crossingYawDelta(gate.yaw ?? 0, 1, arrival.yaw);
        for (const [dx, dz] of [[0, 0], [0.5, 2], [-1.2, -3], [2, 4.4], [0, 6]]) {
          const feet = origin.clone().add(v(dx, 0, dz));
          const there = carryThroughPortal(feet.clone(), origin, yawDelta, landing);
          expect(portalWarp(gates(gate.targetWorldId), there)).toBeCloseTo(portalWarp(gates(room.id), feet), 6);
        }
      }
    }
  });
});

describe('warp speed boost', () => {
  const FRAME = 1 / 60;
  /** Run `seconds` of frames, with `speedAt(t)` the character's speed; returns factors per frame. */
  function simulate(seconds: number, speedAt: (t: number) => number): number[] {
    let smoothed = 0;
    const factors: number[] = [];
    for (let t = 0; t < seconds; t += FRAME) {
      smoothed = smoothSpeed(smoothed, speedAt(t), FRAME);
      factors.push(warpSpeedFactor(smoothed));
    }
    return factors;
  }
  const settled = (factors: number[]) => {
    const tail = factors.slice(-60); // the last second
    return tail.reduce((sum, f) => sum + f, 0) / tail.length;
  };

  it('adds nothing standing still and the full 20% at a sprint', () => {
    expect(settled(simulate(3, () => 0))).toBe(1);
    expect(settled(simulate(3, () => RUN_SPEED))).toBeCloseTo(1 + WARP_SPEED_BOOST, 2);
  });

  it('counts a walk for less than a run, and a stop-start walk for less again but more than standing', () => {
    const walk = settled(simulate(3, () => 8.2));
    const stutter = settled(simulate(3, t => (t % 0.4 < 0.15 ? 8.2 : 0)));
    const run = settled(simulate(3, () => RUN_SPEED));
    expect(walk).toBeCloseTo(1 + WARP_SPEED_BOOST * (8.2 / RUN_SPEED), 2);
    expect(stutter).toBeLessThan(walk);
    expect(stutter).toBeGreaterThan(1.02);
    expect(run).toBeGreaterThan(walk);
  });

  it('never jumps between frames, even when the character starts or stops instantly', () => {
    const factors = simulate(3, t => (t < 1 || t > 2 ? 0 : RUN_SPEED));
    const biggestStep = Math.max(...factors.slice(1).map((f, i) => Math.abs(f - factors[i])));
    expect(biggestStep).toBeLessThan(0.01);
  });

  it('smooths the same at any frame rate', () => {
    const at = (fps: number) => {
      let smoothed = 0;
      for (let i = 0; i < fps * 0.5; i++) smoothed = smoothSpeed(smoothed, RUN_SPEED, 1 / fps);
      return smoothed;
    };
    expect(at(30)).toBeCloseTo(at(144), 6);
  });
});

it('keeps the route geometry this file assumes', () => {
  expect(ROUTE_LENGTH).toBeGreaterThan(2 * WARP_RADIUS); // zones at each end of a room never overlap
});
