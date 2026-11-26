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
