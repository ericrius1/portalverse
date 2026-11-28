/** The approved 5df88bc composition is the exact reset preset. */
export const jungleDefaults = {
  pathDistance: 0.95,
  layerGap: 2,
  gapMultiplier: 1,
  heightMultiplier: 1,
  density: 1,
};
export type JungleSettings = typeof jungleDefaults;
export type JungleKey = keyof JungleSettings;
export const jungleRanges: Record<JungleKey, readonly [number, number, number]> = {
  pathDistance: [0.6, 8, 0.05],
  layerGap: [0.5, 4, 0.05],
  gapMultiplier: [1, 1.3, 0.01],
  heightMultiplier: [0.5, 2.5, 0.05],
  density: [0.25, 2, 0.05],
};

export function normalizeSettings(saved: unknown): JungleSettings {
  const result = { ...jungleDefaults };
  if (!saved || typeof saved !== 'object') return result;
  for (const key of Object.keys(result) as JungleKey[]) {
    const value = (saved as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    result[key] = Math.max(jungleRanges[key][0], Math.min(jungleRanges[key][1], value));
  }
  return result;
}

/** Keep the approved gentle progression; compound any extra outward growth. */
export function layerDepth(layer: number, settings: JungleSettings): number {
  let depth = settings.pathDistance;
  for (let gap = 0; gap < layer; gap++) {
    depth += settings.layerGap * (1 + gap * 0.15) * settings.gapMultiplier ** gap;
  }
  return depth;
}

/** Foreground stays put while successive crowns grow toward the requested height. */
export function layerHeightScale(layer: number, settings: JungleSettings): number {
  return 1 + (settings.heightMultiplier - 1) * layer / 6;
}

const storageKey = 'jp-jungle-path.tuning.v1';
function load(): JungleSettings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
  catch { return { ...jungleDefaults }; }
}
let current = load();
const listeners = new Set<(settings: JungleSettings) => void>();
export const getJungleSettings = (): JungleSettings => ({ ...current });

export function updateJungleSettings(values: Partial<JungleSettings>): void {
  current = normalizeSettings({ ...current, ...values });
  try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Optional. */ }
  for (const apply of listeners) apply({ ...current });
}

export function observeJungleSettings(apply: (settings: JungleSettings) => void): () => void {
  listeners.add(apply);
  apply({ ...current });
  return () => { listeners.delete(apply); };
}
