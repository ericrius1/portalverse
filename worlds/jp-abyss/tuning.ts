import { uniform } from 'three/tsl';
import { MathUtils } from 'three/webgpu';

/** The original stone and smoke settings, with a quick rise and a longer footstep afterglow. */
const numericDefaults = {
  stoneBrightness: 1,
  glowBrightness: 1,
  breathStrength: 0.3,
  breathSpeed: 1,
  breathRandomness: 0,
  pathWispMin: 4,
  pathWispMax: 10,
  strayWispMin: 8,
  strayWispMax: 17,
  lengthRandomness: 1,
  wispWidth: 1,
  wispThinness: 0,
  opacityMin: 0.32,
  opacityMax: 0.32,
  tailFalloffMin: 1,
  tailFalloffMax: 1,
  stepBrightness: 0.5,
  stepFadeIn: 0.62,
  stepNeighborDelay: 0.08,
  stepSeconds: 4.3,
  stepFalloff: 1.5,
};

export const defaults = { ...numericDefaults, fullPathWidth: true };
export type AbyssTuning = typeof defaults;
export type NumericSetting = keyof typeof numericDefaults;
type NumericUniforms = Record<NumericSetting, ReturnType<typeof floatUniform>>;
export type TuningUniforms = ReturnType<typeof tuningUniforms>;

const floatUniform = (value: number) => uniform(value);

export function tuningUniforms() {
  const numbers = Object.fromEntries(Object.entries(numericDefaults).map(([key, value]) => [key, floatUniform(value)])) as NumericUniforms;
  return { ...numbers, fullPathWidth: { value: defaults.fullPathWidth } };
}

/** Resume the fade-in from the current glow when a step overlaps an earlier one. */
export function retriggerStep(now: number, previous: number, fadeIn: number, fadeOut: number, curve: number) {
  const age = now - previous;
  if (age < fadeIn) return previous;
  const remaining = (1 - MathUtils.smoothstep(age - fadeIn, 0, fadeOut)) ** curve;
  return now - remaining * fadeIn;
}

/** Horizontal foot travel only. A levitating surface or a camera turn cannot light a resting stone. */
export class WalkSteps {
  private x = NaN;
  private z = NaN;
  private lastMotion = -Infinity;
  private distance = 0;

  reset() {
    this.x = NaN;
    this.lastMotion = -Infinity;
    this.distance = 0;
  }

  update(feet: { x: number; z: number } | undefined, now: number): boolean {
    if (!feet) {
      this.reset();
      return false;
    }
    if (Number.isNaN(this.x)) {
      this.x = feet.x;
      this.z = feet.z;
      return false;
    }
    const travel = Math.hypot(feet.x - this.x, feet.z - this.z);
    if (travel < 0.02) return false;
    this.x = feet.x;
    this.z = feet.z;
    this.distance += travel;
    const resumed = now - this.lastMotion > 0.18;
    this.lastMotion = now;
    if (!resumed && this.distance < 0.8) return false;
    this.distance = 0;
    return true;
  }
}
