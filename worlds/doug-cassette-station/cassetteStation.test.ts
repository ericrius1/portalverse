import { describe, expect, it } from 'vitest';
import {
  CROSS_ROAD_HALF_WIDTH,
  EASTER_EGGS,
  ENTRANCE_Z,
  EXIT_Z,
  PEDESTRIAN_HALF_WIDTH,
  createStationCollider,
  stationHeight,
} from './terrain';
import {
  DISSOLVE_END_DIST,
  DISSOLVE_MID_DIST,
  DISSOLVE_START_DIST,
  TROLLEY_BOARDING_SECONDS,
  TROLLEY_STOP_X,
  WEATHER_CYCLE_SECONDS,
  computeDissolveFactors,
  createTrolleyState,
  getShopSchedule,
  sampleWorldCycle,
  stepTrolley,
  trolleyStatusLabel,
} from './worldState';

describe('Sector 9 Rain Corner perpendicular intersection & portal contract', () => {
  it('keeps entrance and exit portals completely flat at Y = 0', () => {
    for (const pz of [ENTRANCE_Z, EXIT_Z]) {
      for (const dx of [-4, -1.5, 0, 1.5, 4]) {
        for (const dz of [-2, 0, 2]) {
          expect(stationHeight(dx, pz + dz)).toBe(0);
        }
      }
    }
  });

  it('keeps both the N-S pedestrian crosswalk avenue and perpendicular E-W vehicle boulevard level at Y = 0', () => {
    for (let z = ENTRANCE_Z; z >= EXIT_Z; z -= 0.5) {
      expect(stationHeight(0, z)).toBe(0);
      expect(stationHeight(PEDESTRIAN_HALF_WIDTH - 0.1, z)).toBe(0);
      expect(stationHeight(-(PEDESTRIAN_HALF_WIDTH - 0.1), z)).toBe(0);
    }
    // Entire perpendicular East-West boulevard is level Y = 0 for trolleys & scooters
    for (let x = -34; x <= 34; x += 2) {
      expect(stationHeight(x, 0)).toBe(0);
      expect(stationHeight(x, CROSS_ROAD_HALF_WIDTH - 0.2)).toBe(0);
      expect(stationHeight(x, -(CROSS_ROAD_HALF_WIDTH - 0.2))).toBe(0);
    }
    // Four corner sidewalks gently step up to +0.14 m
    expect(stationHeight(8.5, 10)).toBeCloseTo(0.14, 4);
    expect(stationHeight(-8.5, -10)).toBeCloseTo(0.14, 4);
  });

  it('pushes players cleanly around corner buildings and streetlamp poles', () => {
    const collider = createStationCollider(
      [{ minX: 8.0, maxX: 12.0, minZ: 8, maxZ: 15, maxY: 4.4 }],
      [{ x: -5.0, z: 6.5, radius: 0.2, maxY: 6.4 }],
    );
    const [bx, bz] = collider.move([6.8, 0, 11], [7.85, 0, 11], 0.4, 1.7);
    expect(bx).toBeLessThanOrEqual(7.61);
    expect(bz).toBeCloseTo(11, 4);

    const [cx, cz] = collider.move([-4.0, 0, 6.5], [-4.75, 0, 6.5], 0.4, 1.7);
    expect(Math.hypot(cx - -5.0, cz - 6.5)).toBeGreaterThanOrEqual(0.59);
  });
});

describe('Neo-Tokyo day/night cycle, dynamic rain, and shop schedules', () => {
  it('cycles through dusk, midnight, predawn, and hazy static day with rain lulls', () => {
    const periods = new Set<string>();
    const weathers = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const snap = sampleWorldCycle((i / 60) * 160);
      periods.add(snap.period);
      weathers.add(snap.weather);
      expect(snap.staticReveal).toBeGreaterThanOrEqual(0.24);
      expect(snap.staticReveal).toBeLessThanOrEqual(1);
    }
    expect(periods).toEqual(new Set(['DUSK', 'MIDNIGHT', 'PREDAWN', 'HAZY_DAY']));
    expect(weathers).toEqual(new Set(['DOWNPOUR', 'DRIZZLE', 'STATIC_BREAK']));

    let wRainy = 0;
    for (let i = 0; i < 100; i++) {
      if (sampleWorldCycle((i / 100) * WEATHER_CYCLE_SECONDS).rainIntensity > 0.15) wRainy++;
    }
    expect(wRainy).toBeGreaterThan(55);
    expect(wRainy).toBeLessThan(85);
  });

  it('gives each of the 4 shops distinct schedule activities across periods', () => {
    expect(EASTER_EGGS).toHaveLength(5);
    expect(getShopSchedule('noodles', 'MIDNIGHT').status).toBe('RUSH');
    expect(getShopSchedule('optics', 'HAZY_DAY').status).toBe('OPEN');
    expect(getShopSchedule('analog', 'PREDAWN').status).toBe('RUSH');
    expect(getShopSchedule('conbini', 'HAZY_DAY').status).toBe('RUSH');
  });
});

describe('polygon-mesh distance dissolve and perpendicular Electro-Punk Trolley', () => {
  it('fades solid meshes into transparent polygon wireframes before disappearing', () => {
    const near = computeDissolveFactors(0);
    expect(near.solidOpacity).toBe(1);
    expect(near.wireOpacity).toBe(0);
    expect(near.visible).toBe(true);

    const mid = computeDissolveFactors((DISSOLVE_START_DIST + DISSOLVE_MID_DIST) * 0.5);
    expect(mid.solidOpacity).toBeGreaterThan(0);
    expect(mid.solidOpacity).toBeLessThan(1);
    expect(mid.wireOpacity).toBeGreaterThan(0.3);

    const ghost = computeDissolveFactors(DISSOLVE_MID_DIST + 1.5);
    expect(ghost.solidOpacity).toBe(0);
    expect(ghost.wireOpacity).toBeGreaterThan(0.15);
    expect(ghost.visible).toBe(true);

    const gone = computeDissolveFactors(DISSOLVE_END_DIST + 1);
    expect(gone.solidOpacity).toBe(0);
    expect(gone.wireOpacity).toBe(0);
    expect(gone.visible).toBe(false);
  });

  it('rolls the rare trolley perpendicular (East -> West along X), stops at the NE bus stop to board, and departs', () => {
    const trolley = createTrolleyState(0.5);
    expect(trolley.phase).toBe('OFFSCREEN');
    expect(trolleyStatusLabel(trolley)).toMatch(/^TROLLEY 0:/);

    stepTrolley(trolley, 0.6);
    expect(trolley.phase).toBe('APPROACHING');

    let arrived = false;
    let boarded = false;
    for (let i = 0; i < 400; i++) {
      stepTrolley(trolley, 0.1);
      if (trolley.arrivedEvent) arrived = true;
      if (trolley.boardedEvent) boarded = true;
      if (trolley.phase === 'BOARDING') {
        expect(trolley.x).toBeCloseTo(TROLLEY_STOP_X, 2);
      }
      if (trolley.phase === 'DEPARTING') break;
    }
    expect(arrived).toBe(true);
    expect(boarded).toBe(true);
    expect(trolley.phase).toBe('DEPARTING');
    expect(TROLLEY_BOARDING_SECONDS).toBeGreaterThan(5);
  });
});
