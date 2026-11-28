import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  float,
  uv,
  time,
  sin,
  cos,
  abs,
  mix,
  clamp,
  smoothstep,
  pow,
  uniform,
  positionWorld,
  atan,
} from 'three/tsl';

/** 88 BPM in radians/sec for synchronized floor lighting pulses. */
const LOOM_RAD_PER_SEC = (88 / 60) * Math.PI * 2;

export interface StarlightFloorHandle {
  material: THREE.MeshBasicNodeMaterial;
  uPulsePos: { value: THREE.Vector2 };
  uPulseRadius: { value: number };
  uPulseStrength: { value: number };
  uPulseColor: { value: THREE.Color };
  uStyleMode: { value: number };
  uFrostAmount: { value: number };
  uOverdrive: { value: number };
  uBeatEnergy: { value: number };
}

/**
 * Reactive TSL WebGPU Starlight Dance Floor:
 * Deep obsidian mirror-tile stage with inlaid gold 8-point Alhambra star geometry,
 * 88 BPM radial beat pulses, frost crystal overlay (Ermelin Blizzard),
 * neon laser grid (Dex Hypergroove), and expanding spell/footstep shockwave rings.
 */
export function createStarlightFloorMaterial(): StarlightFloorHandle {
  const uPulsePos = uniform(new THREE.Vector2(0, 0));
  const uPulseRadius = uniform(0.0);
  const uPulseStrength = uniform(0.0);
  const uPulseColor = uniform(new THREE.Color('#2dd4bf'));
  const uStyleMode = uniform(0.0); // 0 = waltz (gold/teal), 1 = hypergroove (magenta/cyan), 2 = frost rave (ice/violet)
  const uFrostAmount = uniform(0.0);
  const uOverdrive = uniform(0.0);
  const uBeatEnergy = uniform(0.35);

  const material = new THREE.MeshBasicNodeMaterial();

  const floorFn = Fn(() => {
    const wp = positionWorld;
    const p = vec2(wp.x, wp.z);
    const r = p.length();
    const ang = atan(wp.z, wp.x);

    // 8-point celestial star & radial compass inlays
    const starWave = cos(ang.mul(8.0)).mul(0.5).add(0.5);
    const starBorder = abs(r.sub(float(5.8).add(starWave.mul(1.25))));
    const starLine = float(1.0).sub(smoothstep(float(0.04), float(0.16), starBorder));

    const innerRing = float(1.0).sub(smoothstep(float(0.03), float(0.12), abs(r.sub(3.1))));
    const outerRing = float(1.0).sub(smoothstep(float(0.05), float(0.20), abs(r.sub(10.35))));

    // Fine octagonal geometric tile lattice
    const gridA = abs(sin(wp.x.mul(1.45)).mul(sin(wp.z.mul(1.45))));
    const gridB = abs(sin(wp.x.add(wp.z).mul(1.025)).mul(sin(wp.x.sub(wp.z).mul(1.025))));
    const tileMask = smoothstep(float(0.05), float(0.28), gridA.min(gridB));

    // 88 BPM traveling beat wave outward from stage center
    const beatPhase = time.mul(LOOM_RAD_PER_SEC);
    const beatPulse = sin(r.mul(1.15).sub(beatPhase)).mul(0.5).add(0.5);
    const beatGlow = pow(beatPulse, 3.5).mul(uBeatEnergy).mul(float(1.0).sub(smoothstep(float(8.5), float(12.2), r)));

    // Palette blends by dance style mode
    const waltzA = vec3(0.95, 0.75, 0.32); // warm gold
    const waltzB = vec3(0.18, 0.85, 0.76); // aurora teal
    const grooveA = vec3(0.98, 0.24, 0.62); // laser magenta
    const grooveB = vec3(0.15, 0.86, 0.98); // electric cyan
    const frostA = vec3(0.62, 0.86, 1.0); // glacial ice
    const frostB = vec3(0.66, 0.45, 0.98); // alpine violet

    const tGroove = smoothstep(float(0.2), float(0.8), uStyleMode);
    const tFrost = smoothstep(float(1.2), float(1.8), uStyleMode);
    const accentA = mix(mix(waltzA, grooveA, tGroove), frostA, tFrost);
    const accentB = mix(mix(waltzB, grooveB, tGroove), frostB, tFrost);

    // Base midnight obsidian marble + specular shimmer
    const baseDark = mix(vec3(0.05, 0.065, 0.13), vec3(0.09, 0.115, 0.21), tileMask);
    const stageMask = float(1.0).sub(smoothstep(float(10.5), float(11.6), r));

    // Radiant spokes matching 8 pavilion columns
    const spoke = pow(abs(cos(ang.mul(4.0).add(0.3927))), 28.0);
    const spokeMask = spoke.mul(smoothstep(float(2.4), float(3.4), r)).mul(stageMask);

    let col = baseDark.add(accentB.mul(beatGlow.mul(0.45)));
    col = mix(col, accentA, clamp(starLine.add(innerRing.mul(0.85)).add(outerRing), 0.0, 1.0).mul(0.85));
    col = col.add(accentB.mul(spokeMask.mul(0.38)));

    // Expanding spell / beat-drop shockwave ripple
    const distPulse = p.sub(uPulsePos).length();
    const ringBand = float(1.0).sub(smoothstep(float(0.0), float(0.75), abs(distPulse.sub(uPulseRadius))));
    const ripple = ringBand.mul(uPulseStrength);
    col = col.add(uPulseColor.mul(ripple.mul(1.35)));

    // Frost crystal shimmer when Ermelin casts Blizzard
    const frostPattern = pow(abs(sin(wp.x.mul(3.8).add(wp.z.mul(2.1))).mul(cos(wp.z.mul(4.2).sub(wp.x.mul(1.9))))), 2.0);
    col = mix(col, vec3(0.75, 0.93, 1.0), frostPattern.mul(uFrostAmount).mul(0.68).mul(stageMask));

    // Starlight Overdrive golden rainbow crest
    const rainbow = vec3(
      sin(ang.mul(2.0).add(time.mul(3.2))).mul(0.5).add(0.5),
      sin(ang.mul(2.0).add(time.mul(3.2)).add(2.1)).mul(0.5).add(0.5),
      sin(ang.mul(2.0).add(time.mul(3.2)).add(4.2)).mul(0.5).add(0.5),
    );
    col = col.add(rainbow.mul(uOverdrive.mul(0.36)).mul(stageMask));

    return col;
  });

  material.colorNode = floorFn();
  return {
    material,
    uPulsePos,
    uPulseRadius,
    uPulseStrength,
    uPulseColor,
    uStyleMode,
    uFrostAmount,
    uOverdrive,
    uBeatEnergy,
  };
}

/**
 * Twilight celestial aurora nebula sky dome (fog-exempt) so the pavilion feels
 * suspended inside an enchanted nocturnal star-garden.
 */
export function createStarlightSkyMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.side = THREE.BackSide;
  material.fog = false;

  const skyFn = Fn(() => {
    const p = uv();
    const h = clamp(p.y, 0.0, 1.0);
    const az = p.x.mul(Math.PI * 2);

    const horizon = vec3(0.14, 0.11, 0.28);
    const mid = vec3(0.06, 0.08, 0.21);
    const zenith = vec3(0.02, 0.03, 0.10);
    let col = mix(horizon, mid, smoothstep(float(0.45), float(0.66), h));
    col = mix(col, zenith, smoothstep(float(0.64), float(0.95), h));

    // Sweeping ribbon aurora bands
    const bandA = sin(az.mul(3.0).add(time.mul(0.24)).add(sin(h.mul(8.0)).mul(0.6))).mul(0.5).add(0.5);
    const bandB = cos(az.mul(5.0).sub(time.mul(0.18)).add(h.mul(5.0))).mul(0.5).add(0.5);
    const auroraEnv = smoothstep(float(0.52), float(0.68), h).mul(float(1.0).sub(smoothstep(float(0.76), float(0.94), h)));
    const tealRibbon = vec3(0.16, 0.88, 0.78).mul(pow(bandA, 4.0)).mul(auroraEnv).mul(0.48);
    const roseRibbon = vec3(0.95, 0.34, 0.68).mul(pow(bandB, 5.0)).mul(auroraEnv).mul(0.32);
    const goldDust = vec3(0.98, 0.80, 0.42).mul(pow(bandA.mul(bandB), 3.0)).mul(auroraEnv).mul(0.35);

    // Subtle procedural star glints
    const starGrid = sin(az.mul(47.0)).mul(sin(h.mul(73.0)));
    const twinkle = sin(time.mul(2.4).add(az.mul(19.0))).mul(0.35).add(0.65);
    const stars = smoothstep(float(0.965), float(0.998), abs(starGrid)).mul(smoothstep(float(0.53), float(0.66), h)).mul(twinkle);

    return col.add(tealRibbon).add(roseRibbon).add(goldDust).add(vec3(0.92, 0.96, 1.0).mul(stars.mul(0.85)));
  });

  material.colorNode = skyFn();
  return material;
}

/** Luminous stone-and-brass promenade strip linking entrance (+36.25) to exit (-36.25). */
export function createPromenadeWalkMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const walkFn = Fn(() => {
    const wp = positionWorld;
    const edge = float(1.0).sub(smoothstep(float(0.05), float(0.18), abs(abs(wp.x).sub(3.05))));
    const centerThread = float(1.0).sub(smoothstep(float(0.02), float(0.09), abs(wp.x)));
    const tile = abs(sin(wp.x.mul(1.2)).mul(sin(wp.z.mul(0.9))));
    const stone = mix(vec3(0.08, 0.10, 0.19), vec3(0.13, 0.16, 0.27), smoothstep(float(0.1), float(0.85), tile));
    const pulse = sin(wp.z.mul(0.35).sub(time.mul(2.8))).mul(0.5).add(0.5);
    const gold = vec3(0.94, 0.76, 0.36);
    const teal = vec3(0.20, 0.86, 0.80);
    const trim = mix(stone, gold, edge.mul(0.85));
    return trim.add(teal.mul(centerThread.mul(0.28 + 0.25 * 0)).add(teal.mul(centerThread.mul(pulse).mul(0.38))));
  });
  material.colorNode = walkFn();
  return material;
}
