/** Portable, bounded appearance settings shared by profiles, portals and the server. */
export interface SkinAppearance {
  skinTone: number;
  undertone: number;
}

export const DEFAULT_SKIN_APPEARANCE: Readonly<SkinAppearance> = Object.freeze({
  skinTone: 0.52,
  undertone: 0.2,
});

export function normalizeSkinAppearance(value?: Partial<SkinAppearance> | null): SkinAppearance {
  const bounded = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    skinTone: bounded(value?.skinTone, DEFAULT_SKIN_APPEARANCE.skinTone, 0, 1),
    undertone: bounded(value?.undertone, DEFAULT_SKIN_APPEARANCE.undertone, -1, 1),
  };
}

/** Missing fields remain missing so older clients cannot reset a customized profile. */
export function sanitizeSkinAppearance(value: Record<string, unknown>): Partial<SkinAppearance> {
  const result: Partial<SkinAppearance> = {};
  for (const key of ['skinTone', 'undertone'] as const) {
    const v = value[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      result[key] = Math.max(key === 'skinTone' ? 0 : -1, Math.min(1, v));
    }
  }
  return result;
}
