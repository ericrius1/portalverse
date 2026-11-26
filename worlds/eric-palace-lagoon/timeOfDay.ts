/**
 * The walk from sunset to night: everything in the room's light that changes as a viewer goes from the entrance
 * (dusk 0: golden sunset over the lagoon) through luminous blue hour to the exit portal in the rotunda's far arch
 * (dusk 1: velvety night, waxing gibbous moon up over the lagoon, Milky Way and 360° aurora curtains all around).
 *
 * One function of `dusk`, so every view (the room you're in, its portal previews from the rooms on either side) gets
 * its own sky from where its eye is (layout.ts `duskAt`).
 *
 * The key light (what casts the baked shadow) is the sun while it's up, fades to zero as the sun slips under the
 * horizon, then returns as crisp silver-blue moonlight from the east across the lagoon: its direction swaps while
 * `keyColor` is zero so the swap is never seen.
 */
export type V3 = [number, number, number];
export type V4 = [number, number, number, number];

export interface TimeOfDay {
  /** the key light (unit, toward it) and its colour (linear): the sun, then the moon */
  keyDir: V3;
  keyColor: V3;
  /** the sun itself, below the horizon once it's set (the afterglow sits over it) */
  sunDir: V3;
  moonDir: V3;
  moonLit: number;
  skyZenith: V3;
  skyHorizon: V3;
  /** the afterglow low over where the sun went down */
  glow: V3;
  ambSky: V3;
  ambGround: V3;
  haze: number;
  /** 0 daylight .. 1 dark: the floodlights, the lanterns, every glowing thing */
  night: number;
  stars: number;
  aurora: number;
  /** rgb: Belt of Venus / anti-solar twilight arch tint; w: cloud cover (0..1) */
  skyTint: V4;
  /** x: Milky Way strength (0..1); y: crepuscular sunset rays (0..1); z: aurora reach (0..1); w: moon earthshine (0..1) */
  skyExtra: V4;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixN = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (x: number, y: number, z: number): V3 => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

/** a direction from its compass bearing (radians: 0 toward -z, the way the walk goes, positive toward +x) and altitude */
export function bearing(az: number, alt: number): V3 {
  return unit(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
}

const DEG = Math.PI / 180;
/** the sun goes down ahead and to the right of the walk, over the lagoon (so the water holds the afterglow) */
const SUN_AZ = 42 * DEG;
/** the moon rises in the east-southeast over the lagoon (~120 deg from the sun: a ~68% waxing gibbous illuminating the Palace's lagoon front) */
const MOON_AZ = 162 * DEG;

/** Keyframes of the sky along the walk (dusk: 0 rich golden sunset, 0.28 fiery civil twilight, 0.56 deep sapphire blue hour, 0.82 early aurora night, 1.0 full aurora night). */
interface Key {
  d: number;
  zenith: V3;
  horizon: V3;
  glow: V3;
  ambSky: V3;
  ambGround: V3;
  venusTint: V3;
  cloudCover: number;
}
const KEYS: Key[] = [
  {
    // Rich golden sunset tuned for ACES Filmic (exposure 1.05): cobalt-indigo vault down to molten apricot-amber horizon
    d: 0.0,
    zenith: [0.036, 0.095, 0.34],
    horizon: [0.76, 0.31, 0.14],
    glow: [1.75, 0.56, 0.14],
    ambSky: [0.22, 0.25, 0.40],
    ambGround: [0.14, 0.09, 0.048],
    venusTint: [0.82, 0.34, 0.48],
    cloudCover: 0.62,
  },
  {
    // Civil twilight: sun slipping under the lagoon horizon, flamingo-coral & tangerine afterglow, Belt of Venus peak
    d: 0.28,
    zenith: [0.022, 0.048, 0.195],
    horizon: [0.54, 0.19, 0.15],
    glow: [1.35, 0.34, 0.11],
    ambSky: [0.105, 0.125, 0.235],
    ambGround: [0.052, 0.038, 0.028],
    venusTint: [0.78, 0.28, 0.52],
    cloudCover: 0.58,
  },
  {
    // Deep blue hour: velvet royal-sapphire sky, plum-amber western ember, first bright stars & aurora beginning to stir
    d: 0.56,
    zenith: [0.008, 0.018, 0.074],
    horizon: [0.115, 0.072, 0.15],
    glow: [0.34, 0.095, 0.07],
    ambSky: [0.044, 0.062, 0.122],
    ambGround: [0.018, 0.016, 0.018],
    venusTint: [0.30, 0.15, 0.38],
    cloudCover: 0.36,
  },
  {
    // Early aurora night: Milky Way blooming, aurora sweeping toward overhead, clouds parting
    d: 0.82,
    zenith: [0.0036, 0.0078, 0.028],
    horizon: [0.022, 0.038, 0.064],
    glow: [0.036, 0.018, 0.028],
    ambSky: [0.028, 0.045, 0.076],
    ambGround: [0.011, 0.012, 0.015],
    venusTint: [0.06, 0.14, 0.16],
    cloudCover: 0.20,
  },
  {
    // Full aurora night: deep midnight sapphire vault, readable aurora-kissed moonlight on the Palace
    d: 1.0,
    zenith: [0.0024, 0.0056, 0.020],
    horizon: [0.013, 0.030, 0.048],
    glow: [0.008, 0.011, 0.020],
    ambSky: [0.026, 0.046, 0.070],
    ambGround: [0.010, 0.013, 0.015],
    venusTint: [0.03, 0.15, 0.14],
    cloudCover: 0.15,
  },
];

export function timeOfDay(dusk: number): TimeOfDay {
  const d = Math.min(1, Math.max(0, dusk));
  let k = 0;
  while (k < KEYS.length - 2 && d > KEYS[k + 1].d) k++;
  const a = KEYS[k], b = KEYS[k + 1];
  const t = smoothstep(a.d, b.d, d);

  // the sun from +4.2 deg at the entrance down to -11 deg at night; sets cleanly around dusk ~0.27
  const sunAltDeg = mixN(4.2, -11.0, smoothstep(0.0, 0.78, d));
  const sunDir = bearing(SUN_AZ, sunAltDeg * DEG);
  const sunUp = 1 - smoothstep(0.04, 0.30, d);

  // the moon climbs in the east-southeast from 12 deg to 34 deg, visible as a pale twilight gibbous then bright at night
  const moonDir = bearing(MOON_AZ, mixN(12.0, 34.0, smoothstep(0.15, 1.0, d)) * DEG);
  const moonLit = smoothstep(0.18, 0.74, d);
  const moonKeyLit = smoothstep(0.34, 0.78, d);

  // silent key swap while keyColor is [0, 0, 0] (d in [0.30, 0.34])
  const sunKey = d < 0.32;
  const keyDir = sunKey ? sunDir : moonDir;
  const keyColor: V3 = sunKey
    ? scale3([2.95, 1.48, 0.66], sunUp)
    : scale3([0.22, 0.28, 0.42], moonKeyLit);

  const night = smoothstep(0.14, 0.68, d);
  const stars = smoothstep(0.24, 0.88, d);
  const milkyWay = smoothstep(0.44, 0.92, d);
  const aurora = smoothstep(0.42, 0.90, d);
  const auroraReach = smoothstep(0.44, 0.96, d);
  const crepuscular = (1 - smoothstep(0.22, 0.56, d)) * (0.65 + 0.35 * smoothstep(0.0, 0.16, d));
  const earthshine = smoothstep(0.42, 0.86, d);

  const venus = mix3(a.venusTint, b.venusTint, t);
  const cloudCover = mixN(a.cloudCover, b.cloudCover, t);

  return {
    keyDir,
    keyColor,
    sunDir,
    moonDir,
    moonLit,
    skyZenith: mix3(a.zenith, b.zenith, t),
    skyHorizon: mix3(a.horizon, b.horizon, t),
    glow: mix3(a.glow, b.glow, t),
    ambSky: mix3(a.ambSky, b.ambSky, t),
    ambGround: mix3(a.ambGround, b.ambGround, t),
    haze: mixN(0.00115, 0.0017, d),
    night,
    stars,
    aurora,
    skyTint: [venus[0], venus[1], venus[2], cloudCover],
    skyExtra: [milkyWay, crepuscular, auroraReach, earthshine],
  };
}

/**
 * The room's Globals fields (shaders/common.wgsl) for one view's time of day: the renderer calls this per view and
 * sets what it returns. Fields appended to the end of Globals for the sky are filled here automatically.
 */
export function skyGlobals(tod: TimeOfDay): Record<string, number | V3 | V4> {
  return {
    sunDir: tod.keyDir,
    sunColor: tod.keyColor,
    skyZenith: tod.skyZenith,
    skyHorizon: tod.skyHorizon,
    ambSky: tod.ambSky,
    ambGround: tod.ambGround,
    haze: tod.haze,
    night: tod.night,
    trueSun: tod.sunDir,
    aurora: tod.aurora,
    glow: tod.glow,
    stars: tod.stars,
    moonDir: tod.moonDir,
    moonLit: tod.moonLit,
    skyTint: tod.skyTint,
    skyExtra: tod.skyExtra,
  };
}
