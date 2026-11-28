import { MathUtils, type Fog } from 'three/webgpu';
import { WATER_FOG_FAR, WATER_FOG_NEAR } from './water';

const DEFAULT_DENSITY = 0.46;
// Start everyone at the approved setting rather than an earlier tuning value.
const STORAGE_KEY = 'jp-reef.fog-density.v2';
const listeners = new Set<(density: number) => void>();
let density = DEFAULT_DENSITY;
if (import.meta.env.DEV) try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null && Number.isFinite(Number(saved))) density = MathUtils.clamp(Number(saved), 0, 1.5);
} catch { /* Storage is optional. */ }

/** 100% reproduces CollectivSea; lower values reduce haze even at arm's length. */
export function applyFogDensity(fog: Fog, amount: number): void {
  // Keep the same fog object/type, so sliders do not recompile portal shaders.
  // Move the negative near range toward zero as haze falls, and extend visibility.
  fog.near = WATER_FOG_NEAR * amount;
  fog.far = amount > 0 ? WATER_FOG_FAR / amount : 1e6;
}

export function bindFogDensity(fog: Fog): () => void {
  const apply = (value: number) => applyFogDensity(fog, value);
  listeners.add(apply);
  apply(density);
  return () => { listeners.delete(apply); };
}

/** Only the active room owns UI; mounted previews share the chosen density. */
export function mountFogControls(): () => void {
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Reef atmosphere');
  panel.style.cssText = 'position:fixed;top:80px;left:16px;z-index:25;width:230px;padding:12px 16px;border:1px solid #ffffff30;border-radius:12px;background:#142c36e8;color:#e3fffa;font:13px/1.4 system-ui;';
  const label = document.createElement('label');
  label.textContent = 'Fog density';
  const value = document.createElement('output');
  value.style.cssText = 'float:right;font-variant-numeric:tabular-nums;color:#8ce6dc;';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '150';
  slider.step = '1';
  slider.setAttribute('aria-label', 'Fog density');
  slider.style.cssText = 'display:block;width:100%;margin:10px 0 0;accent-color:#67d7d1;';
  const refresh = (amount: number) => {
    slider.value = String(Math.round(amount * 100));
    value.value = `${slider.value}%`;
  };
  refresh(density);
  listeners.add(refresh);
  slider.addEventListener('input', () => {
    density = Number(slider.value) / 100;
    for (const apply of listeners) apply(density);
    try { localStorage.setItem(STORAGE_KEY, String(density)); } catch { /* Optional. */ }
  });
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  panel.addEventListener('click', event => event.stopPropagation());
  panel.addEventListener('keydown', event => event.stopPropagation());
  label.append(value, slider);
  panel.append(label);
  document.body.append(panel);
  return () => { listeners.delete(refresh); panel.remove(); };
}
