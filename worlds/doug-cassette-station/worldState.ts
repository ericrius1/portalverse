/**
 * Pure, testable simulation engine for Sector 9 Rain Corner (`doug-cassette-station`):
 * - Day/night cycle (dusk -> midnight -> pre-dawn -> hazy static-sky day)
 * - Dynamic rain weather (rains ~70% of the time, with misty breaks revealing the static sky)
 * - Shop schedules & routines
 * - Distance-based solid -> transparent polygon-wireframe dissolve curve
 * - Rare Electro-Punk Trolley arrival, boarding, and departure state machine
 */

export type TimePeriod = 'DUSK' | 'MIDNIGHT' | 'PREDAWN' | 'HAZY_DAY';
export type WeatherPhase = 'DOWNPOUR' | 'DRIZZLE' | 'STATIC_BREAK';
export type ShopId = 'noodles' | 'optics' | 'analog' | 'conbini';
export type ShopStatus = 'RUSH' | 'OPEN' | 'LATE_SHIFT' | 'PREP';

/** Full day/night cycle duration in seconds (~2.5 minutes so visitors witness rich transitions). */
export const DAY_CYCLE_SECONDS = 150;
/** Full weather cycle duration in seconds (~92 seconds; rains ~68% of the time, clears into static mist ~32%). */
export const WEATHER_CYCLE_SECONDS = 92;

export interface CycleSnapshot {
  /** Normalized 0..1 time of day (0 = dusk, 0.28 = deep midnight, 0.62 = pre-dawn, 0.82 = hazy static day). */
  dayPhase: number;
  period: TimePeriod;
  /** 0 = deep midnight, 1 = hazy overcast day peak. */
  daylight: number;
  /** Formatted 24h cyberpunk street clock string, e.g. "23:42". */
  clockLabel: string;
  /** 0..1 rain intensity (0 = misty static break, 0.45 = drizzle, 1.0 = heavy Neo-Tokyo downpour). */
  rainIntensity: number;
  weather: WeatherPhase;
  /** 0..1 visibility of the eerie dead-channel static sky behind the wispy clouds. */
  staticReveal: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Samples the continuous day/night and rain/static-sky cycle at `elapsed` seconds.
 * Starts at ~21:15 (lush rainy Blade Runner neon evening) so first arrival feels immediately iconic,
 * then drifts smoothly through deep midnight, misty static breaks, pre-dawn, and hazy static day.
 */
export function sampleWorldCycle(elapsed: number): CycleSnapshot {
  // Start near late dusk / early neon night (dayPhase ~0.12)
  const dayPhase = (((elapsed / DAY_CYCLE_SECONDS) + 0.12) % 1 + 1) % 1;

  // Map dayPhase to 24h clock: 0.0 -> 18:00, 0.25 -> 00:00, 0.5 -> 06:00, 0.75 -> 12:00
  const totalMinutes = Math.floor(((dayPhase * 24 + 18) % 24) * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');

  // Daylight curve: dim at midnight (~0.25), peaks gently in hazy static afternoon (~0.75)
  const sunWave = Math.sin((dayPhase - 0.5) * Math.PI * 2) * 0.5 + 0.5;
  const daylight = Math.pow(sunWave, 1.35);

  let period: TimePeriod = 'MIDNIGHT';
  if (dayPhase < 0.16) period = 'DUSK';
  else if (dayPhase < 0.48) period = 'MIDNIGHT';
  else if (dayPhase < 0.66) period = 'PREDAWN';
  else period = 'HAZY_DAY';

  // Rain weather: rains heavily most of the time (~70%), then eases into wispy misty breaks (~30%)
  const wPhase = (((elapsed / WEATHER_CYCLE_SECONDS) + 0.08) % 1 + 1) % 1;
  let rainIntensity: number;
  if (wPhase < 0.48) {
    // Heavy rain plateau with gentle gusts
    rainIntensity = 0.82 + 0.18 * Math.sin(wPhase * Math.PI * 6);
  } else if (wPhase < 0.68) {
    // Easing down to light drizzle
    rainIntensity = 0.82 * (1 - smoothstep(0.48, 0.68, wPhase)) + 0.14;
  } else if (wPhase < 0.88) {
    // Misty rain lull — static sky peeks clearly through thin wispy clouds!
    rainIntensity = 0.04 * (1 - smoothstep(0.68, 0.76, wPhase));
  } else {
    // Storm clouds rolling back in
    rainIntensity = smoothstep(0.88, 1.0, wPhase) * 0.85;
  }

  let weather: WeatherPhase = 'DOWNPOUR';
  if (rainIntensity < 0.12) weather = 'STATIC_BREAK';
  else if (rainIntensity < 0.52) weather = 'DRIZZLE';

  // Static sky is always subtly perceptible between clouds, and shines unmistakably during rain lulls & hazy day
  const staticReveal = Math.min(1, Math.max(0.24, (1 - rainIntensity * 0.68) * 0.78 + daylight * 0.28));

  return {
    dayPhase,
    period,
    daylight,
    clockLabel: `${hh}:${mm}`,
    rainIntensity,
    weather,
    staticReveal,
  };
}

export interface ShopScheduleInfo {
  status: ShopStatus;
  signIntensity: number;
  activity: string;
}

/** Returns each street-corner shop's current schedule state and routine description. */
export function getShopSchedule(shop: ShopId, period: TimePeriod): ShopScheduleInfo {
  switch (shop) {
    case 'noodles':
      if (period === 'DUSK' || period === 'MIDNIGHT') {
        return { status: 'RUSH', signIntensity: 1.35, activity: 'Serving steaming bowls in the rain rush' };
      }
      if (period === 'PREDAWN') {
        return { status: 'LATE_SHIFT', signIntensity: 1.0, activity: 'Simmering dashi for the dawn shift' };
      }
      return { status: 'PREP', signIntensity: 0.72, activity: 'Chopping scallions & wiping down the counter' };

    case 'optics':
      if (period === 'HAZY_DAY' || period === 'DUSK') {
        return { status: 'OPEN', signIntensity: 1.25, activity: 'Calibrating off-world cyber-ocular lenses' };
      }
      if (period === 'MIDNIGHT') {
        return { status: 'LATE_SHIFT', signIntensity: 1.1, activity: 'Running black-market firmware patches' };
      }
      return { status: 'PREP', signIntensity: 0.65, activity: 'Diagnostics on hovering iris drones' };

    case 'analog':
      if (period === 'MIDNIGHT' || period === 'PREDAWN') {
        return { status: 'RUSH', signIntensity: 1.35, activity: 'Recording dead-channel sky static to chrome tape' };
      }
      if (period === 'DUSK') {
        return { status: 'OPEN', signIntensity: 1.15, activity: 'Splicing bootleg synth-cassettes' };
      }
      return { status: 'PREP', signIntensity: 0.78, activity: 'Degaussing stacked 1990s CRT monitors' };

    case 'conbini':
      if (period === 'PREDAWN' || period === 'HAZY_DAY') {
        return { status: 'RUSH', signIntensity: 1.25, activity: 'Restocking warm matcha & onigiri for commuters' };
      }
      return { status: 'OPEN', signIntensity: 1.15, activity: '24H neon checkout & sweeping wet puddles' };
  }
}

/**
 * Distance-based polygon-mesh dissolve curve:
 * - Inside |z| <= 18.5m: 100% solid shaded character/vehicle, 0% wireframe dissolve.
 * - Between 18.5m and 26.0m: solid smoothly fades down while translucent cyan/magenta polygon mesh rises!
 * - Between 26.0m and 32.5m: translucent polygon wireframe flickers and fades cleanly out to 0!
 */
export interface DissolveFactors {
  solidOpacity: number;
  wireOpacity: number;
  visible: boolean;
}

export const DISSOLVE_START_DIST = 18.5;
export const DISSOLVE_MID_DIST = 25.0;
export const DISSOLVE_END_DIST = 32.2;

export function computeDissolveFactors(distanceFromCorner: number): DissolveFactors {
  const d = Math.abs(distanceFromCorner);
  if (d <= DISSOLVE_START_DIST) {
    return { solidOpacity: 1, wireOpacity: 0, visible: true };
  }
  if (d >= DISSOLVE_END_DIST) {
    return { solidOpacity: 0, wireOpacity: 0, visible: false };
  }
  const solidOpacity = 1 - smoothstep(DISSOLVE_START_DIST, DISSOLVE_MID_DIST, d);
  // Wireframe mesh peaks right as solid dissolves away, then ghosts out smoothly
  const wireIn = smoothstep(DISSOLVE_START_DIST - 0.5, DISSOLVE_MID_DIST - 1.0, d);
  const wireOut = 1 - smoothstep(DISSOLVE_MID_DIST + 0.5, DISSOLVE_END_DIST, d);
  const wireOpacity = Math.max(0, Math.min(0.88, wireIn * wireOut * 0.92));
  return { solidOpacity, wireOpacity, visible: solidOpacity > 0.01 || wireOpacity > 0.01 };
}

// ---------------------------------------------------------------------------
// Rare Electro-Punk Trolley State Machine
// ---------------------------------------------------------------------------

export type TrolleyPhase = 'OFFSCREEN' | 'APPROACHING' | 'BOARDING' | 'DEPARTING';

export const TROLLEY_STOP_Z = -1.0;
export const TROLLEY_SPAWN_Z = 34.0;
export const TROLLEY_DESPAWN_Z = -34.0;
export const TROLLEY_INTERVAL_SECONDS = 44;
export const TROLLEY_BOARDING_SECONDS = 8.5;

export interface TrolleyState {
  phase: TrolleyPhase;
  z: number;
  speed: number;
  timer: number;
  doorOpen: number; // 0 = closed, 1 = open
  boardedEvent: boolean;
  arrivedEvent: boolean;
  departedEvent: boolean;
}

export function createTrolleyState(initialWait = 16): TrolleyState {
  return {
    phase: 'OFFSCREEN',
    z: TROLLEY_SPAWN_Z,
    speed: 0,
    timer: initialWait,
    doorOpen: 0,
    boardedEvent: false,
    arrivedEvent: false,
    departedEvent: false,
  };
}

/**
 * Advances the rare Electro-Punk Trolley:
 * waits offscreen -> glides in along the sunken street rails -> stops smoothly at the bus stop ->
 * opens doors & picks up waiting passengers -> closes doors and vanishes into the polygon mist!
 */
export function stepTrolley(t: TrolleyState, dt: number): void {
  t.boardedEvent = false;
  t.arrivedEvent = false;
  t.departedEvent = false;

  if (t.phase === 'OFFSCREEN') {
    t.timer -= dt;
    t.z = TROLLEY_SPAWN_Z;
    t.speed = 0;
    t.doorOpen = 0;
    if (t.timer <= 0) {
      t.phase = 'APPROACHING';
      t.z = TROLLEY_SPAWN_Z;
      t.speed = 8.5;
    }
    return;
  }

  if (t.phase === 'APPROACHING') {
    const distLeft = t.z - TROLLEY_STOP_Z;
    // Smooth braking curve into the bus stop
    const targetSpeed = Math.max(1.2, Math.min(9.0, distLeft * 0.72));
    t.speed += (targetSpeed - t.speed) * Math.min(1, dt * 3.5);
    t.z -= t.speed * dt;
    if (t.z <= TROLLEY_STOP_Z) {
      t.z = TROLLEY_STOP_Z;
      t.speed = 0;
      t.phase = 'BOARDING';
      t.timer = TROLLEY_BOARDING_SECONDS;
      t.arrivedEvent = true;
    }
    return;
  }

  if (t.phase === 'BOARDING') {
    const prevTimer = t.timer;
    t.timer -= dt;
    // Doors open promptly, then close smoothly in the final 1.4 seconds
    const wantOpen = t.timer > 1.4 ? 1 : 0;
    t.doorOpen += (wantOpen - t.doorOpen) * Math.min(1, dt * 4.5);
    // Trigger passenger boarding mid-stop
    if (prevTimer > TROLLEY_BOARDING_SECONDS * 0.55 && t.timer <= TROLLEY_BOARDING_SECONDS * 0.55) {
      t.boardedEvent = true;
    }
    if (t.timer <= 0) {
      t.doorOpen = 0;
      t.phase = 'DEPARTING';
      t.speed = 0.8;
      t.departedEvent = true;
    }
    return;
  }

  // DEPARTING
  t.speed = Math.min(10.5, t.speed + dt * 3.8);
  t.z -= t.speed * dt;
  if (t.z <= TROLLEY_DESPAWN_Z) {
    t.phase = 'OFFSCREEN';
    t.z = TROLLEY_SPAWN_Z;
    t.speed = 0;
    t.timer = TROLLEY_INTERVAL_SECONDS;
  }
}

/** Human-readable countdown for the cyber bus stop sign & HUD chip. */
export function trolleyStatusLabel(t: TrolleyState): string {
  if (t.phase === 'BOARDING') return 'BOARDING NOW';
  if (t.phase === 'APPROACHING') return 'ARRIVING';
  if (t.phase === 'DEPARTING') return 'DEPARTING';
  const secs = Math.max(0, Math.ceil(t.timer));
  return `TROLLEY 0:${String(secs).padStart(2, '0')}`;
}
