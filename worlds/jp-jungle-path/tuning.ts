export const gapCurves = {
  gradual: 'Gradual',
  even: 'Even gaps',
  'back-loaded': 'Widen at the back',
  early: 'Widen near the path',
} as const;
export const heightCurves = {
  gradual: 'Gradual rise',
  'back-loaded': 'Back-loaded rise',
  steep: 'Steep back rise',
  terraces: 'Terraces',
} as const;
export interface JungleSettings {
  pupilsOnly: boolean;
  peripheralEyes: boolean;
  pathDistance: number;
  layerGap: number;
  gapMultiplier: number;
  heightNear: number;
  heightFar: number;
  densityNear: number;
  densityFar: number;
  leafDepthVariation: number;
  leafSizeNear: number;
  leafSizeFar: number;
  gapCurve: keyof typeof gapCurves;
  heightCurve: keyof typeof heightCurves;
}
export type JungleKey = Exclude<keyof JungleSettings, 'gapCurve' | 'heightCurve' | 'pupilsOnly' | 'peripheralEyes'>;
/** Fixed geometry reference; keeps existing instance transforms and collision stable. */
export const jungleOriginal: JungleSettings = {
  pupilsOnly: false, peripheralEyes: false,
  pathDistance: 0.95, layerGap: 2, gapMultiplier: 1,
  heightNear: 3.6, heightFar: 11.64,
  densityNear: 1, densityFar: 1, leafDepthVariation: 0,
  leafSizeNear: 1, leafSizeFar: 1, gapCurve: 'gradual', heightCurve: 'gradual',
};
/** JP's selected values from the 2026-11-28 1:28 AM screenshots. */
export const jungleDefaults: JungleSettings = {
  pupilsOnly: false, peripheralEyes: true,
  pathDistance: 5,
  layerGap: 1.3,
  gapMultiplier: 1.3,
  heightNear: 0.5,
  heightFar: 14.83,
  densityNear: 2,
  densityFar: 0.25,
  leafDepthVariation: 0.45,
  leafSizeNear: 0.2,
  leafSizeFar: 1.5,
  gapCurve: 'gradual',
  heightCurve: 'terraces',
};
export const jungleRanges: Record<JungleKey, readonly [number, number, number]> = {
  pathDistance: [0.6, 8, 0.05],
  layerGap: [0.5, 4, 0.05],
  gapMultiplier: [1, 1.3, 0.01],
  heightNear: [0.5, 30, 0.01],
  heightFar: [0.5, 30, 0.01],
  densityNear: [0.25, 2, 0.05],
  densityFar: [0.25, 2, 0.05],
  leafDepthVariation: [0, 1, 0.05],
  leafSizeNear: [0.2, 1.5, 0.05],
  leafSizeFar: [0.2, 1.5, 0.05],
};

export function normalizeSettings(saved: unknown): JungleSettings {
  const result = { ...jungleDefaults };
  if (!saved || typeof saved !== 'object') return result;
  const values = saved as Record<string, unknown>;
  for (const key of ['pupilsOnly', 'peripheralEyes'] as const) {
    if (typeof values[key] === 'boolean') result[key] = values[key];
  }
  // Convert the old rise multiplier into the same endpoint heights.
  const legacyHeight = typeof values.heightMultiplier === 'number' && Number.isFinite(values.heightMultiplier)
    ? 3.6 + 8.04 * Math.max(0.5, Math.min(2.5, values.heightMultiplier)) : undefined;
  for (const key of Object.keys(jungleRanges) as JungleKey[]) {
    // Preserve the previous single-density setting at both endpoints.
    const value = values[key] ?? (key === 'densityNear' || key === 'densityFar' ? values.density
      : key === 'heightFar' ? legacyHeight : key === 'heightNear' && legacyHeight !== undefined ? 3.6 : undefined);
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    result[key] = Math.max(jungleRanges[key][0], Math.min(jungleRanges[key][1], value));
  }
  if (typeof values.gapCurve === 'string' && Object.hasOwn(gapCurves, values.gapCurve)) {
    result.gapCurve = values.gapCurve as JungleSettings['gapCurve'];
  }
  if (typeof values.heightCurve === 'string' && Object.hasOwn(heightCurves, values.heightCurve)) {
    result.heightCurve = values.heightCurve as JungleSettings['heightCurve'];
  }
  return result;
}

/** Gap curves change where widening happens; the multiplier adds compounding. */
export function layerDepth(layer: number, settings: JungleSettings): number {
  let depth = settings.pathDistance;
  for (let gap = 0; gap < layer; gap++) {
    const t = gap / 5;
    const widening = settings.gapCurve === 'even' ? 0
      : settings.gapCurve === 'back-loaded' ? t * t
      : settings.gapCurve === 'early' ? Math.sqrt(t) : t;
    depth += settings.layerGap * (1 + 0.75 * widening) * settings.gapMultiplier ** gap;
  }
  return depth;
}

/** Change the tier rise, not the whole wall. Rolling crown amplitude stays intact. */
export function layerHeightOffset(layer: number, settings: JungleSettings): number {
  const t = layer / 6;
  const rise = settings.heightCurve === 'back-loaded' ? t * t
    : settings.heightCurve === 'steep' ? t * t * t
    : settings.heightCurve === 'terraces' ? Math.floor(layer / 2) / 3 : t;
  return settings.heightNear + (settings.heightFar - settings.heightNear) * rise - (3.6 + 8.04 * t);
}

export function layerLeafSize(layer: number, settings: JungleSettings): number {
  return settings.leafSizeNear + (settings.leafSizeFar - settings.leafSizeNear) * layer / 6;
}

export function layerDensity(layer: number, settings: JungleSettings): number {
  return settings.densityNear + (settings.densityFar - settings.densityNear) * layer / 6;
}

/** Maximum movement normal to the screen, bounded by its nearest layer gap. */
export function leafDepthAmplitude(layer: number, settings: JungleSettings): number {
  const ahead = layer > 0 ? layerDepth(layer, settings) - layerDepth(layer - 1, settings) : Infinity;
  const behind = layer < 6 ? layerDepth(layer + 1, settings) - layerDepth(layer, settings) : Infinity;
  return Math.min(ahead, behind) * 0.4 * settings.leafDepthVariation;
}

/** Separate deterministic noise leaves placement, colour, and size streams unchanged. */
export function leafDepthSample(index: number, layer: number, side: number): number {
  let hash = Math.imul(index + 1, 374761393) ^ Math.imul(layer + 1, 668265263) ^ Math.imul(side, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}

export function sameFoliageShape(a: JungleSettings, b: JungleSettings): boolean {
  return a.heightNear === b.heightNear && a.heightFar === b.heightFar && a.heightCurve === b.heightCurve
    && a.densityNear === b.densityNear && a.densityFar === b.densityFar
    && a.leafDepthVariation === b.leafDepthVariation
    && a.leafSizeNear === b.leafSizeNear && a.leafSizeFar === b.leafSizeFar;
}

// Start this chosen composition on reload; retain earlier experiments under v1.
const storageKey = 'jp-jungle-path.tuning.v3';
function load(): JungleSettings {
  if (import.meta.env.PROD) return { ...jungleDefaults };
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
