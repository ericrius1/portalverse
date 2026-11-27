import { Color } from 'three/webgpu';
import { normalizeSkinAppearance, type SkinAppearance } from './appearance';

// Artist-authored albedo ramp. See assets/CREDITS.md for design research.
// Each stop changes chroma and hue as well as brightness; these are colors, not categories.
const PALETTE = ['#f6e4d5', '#ead1bb', '#dcb798', '#c99b75', '#b98962',
  '#a57450', '#8f6043', '#704831', '#513528', '#35251f'];

function toLab(hex: string): [number, number, number] {
  const { r, g, b } = new Color(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const STOPS = PALETTE.map(toLab);

/** Oklab interpolation keeps tone smooth; a restrained rose/gold axis adjusts undertone. */
export function skinColor(appearance?: Partial<SkinAppearance>): Color {
  const { skinTone, undertone } = normalizeSkinAppearance(appearance);
  const position = skinTone * (STOPS.length - 1);
  const i = Math.min(Math.floor(position), STOPS.length - 2);
  const t = position - i;
  const [L, a0, b0] = STOPS[i].map((v, axis) => v + (STOPS[i + 1][axis] - v) * t);
  const a = a0 - undertone * 0.012;
  const b = b0 + undertone * 0.018;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return new Color().setRGB(clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s));
}
