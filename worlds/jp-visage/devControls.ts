import { Color, SRGBColorSpace } from 'three/webgpu';
import { DEFAULT_TUNING, type VisagesTuning } from './tuning';
const STORAGE_KEY = 'portalverse.dev.visages-lighting.v2';

export function normalizeTuning(value: unknown): VisagesTuning {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<VisagesTuning>;
  const brightness = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0.2, Math.min(2, n)) : fallback;
  return {
    roomBrightness: brightness(v.roomBrightness, DEFAULT_TUNING.roomBrightness),
    bloodBrightness: brightness(v.bloodBrightness, DEFAULT_TUNING.bloodBrightness),
    bloodColor: typeof v.bloodColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.bloodColor) ? v.bloodColor.toLowerCase() : DEFAULT_TUNING.bloodColor,
  };
}

export function readTuning(): VisagesTuning {
  try { return normalizeTuning(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_TUNING }; }
}

/** Loaded only by import.meta.env.DEV; panel exists only while this room is active. */
export function mountDevControls(initial: VisagesTuning, apply: (value: VisagesTuning) => void): () => void {
  let settings = { ...initial };
  const panel = document.createElement('details');
  panel.open = true;
  panel.dataset.visagesDevControls = '';
  panel.style.cssText = 'position:fixed;left:16px;top:110px;z-index:70;width:270px;max-width:calc(100vw - 32px);padding:14px;border:1px solid #52606d;border-radius:12px;background:#111923ed;color:#e3eaf0;font:13px/1.5 system-ui;pointer-events:auto;box-shadow:0 6px 28px #0008';
  const heading = document.createElement('summary');
  heading.textContent = 'Visage · dev controls';
  heading.style.cssText = 'cursor:pointer;font-weight:600';
  panel.append(heading);
  const hint = document.createElement('p');
  hint.textContent = 'H hides these controls. Changes save in this browser only.';
  hint.style.cssText = 'color:#abb8c4;margin:8px 0 12px';
  panel.append(hint);

  const refresh: Array<() => void> = [];
  const save = () => {
    settings = normalizeTuning(settings);
    apply({ ...settings });
    for (const update of refresh) update();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* optional */ }
  };
  function slider(title: string, min: number, max: number, step: number, read: () => number, write: (n: number) => void, display: (n: number) => string) {
    const label = document.createElement('label');
    label.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:4px;margin:12px 0';
    const name = document.createElement('span');
    name.textContent = title;
    const output = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
    input.style.cssText = 'grid-column:1 / -1;width:100%;accent-color:#b6d0e3';
    input.setAttribute('aria-label', title);
    input.addEventListener('input', () => { write(Number(input.value)); save(); });
    refresh.push(() => { input.value = String(read()); output.textContent = display(read()); });
    label.append(name, output, input);
    panel.append(label);
  }
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  slider('Room brightness', 0.2, 2, 0.05, () => settings.roomBrightness, n => { settings.roomBrightness = n; }, percent);
  slider('Blood brightness', 0.2, 2, 0.05, () => settings.bloodBrightness, n => { settings.bloodBrightness = n; }, percent);
  slider('Blood hue', 0, 359, 1,
    () => Math.round(new Color(settings.bloodColor).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace).h * 360) % 360,
    n => {
      const c = new Color(settings.bloodColor);
      const hsl = c.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
      settings.bloodColor = '#' + c.setHSL(n / 360, hsl.s, hsl.l, SRGBColorSpace).getHexString();
    }, n => `${n}°`);
  const colorLabel = document.createElement('label');
  colorLabel.style.cssText = 'display:flex;align-items:center;gap:12px;margin:12px 0';
  const colorName = document.createElement('span');
  colorName.textContent = 'Blood color';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.setAttribute('aria-label', 'Blood color');
  const hex = document.createElement('output');
  picker.addEventListener('input', () => { settings.bloodColor = picker.value; save(); });
  refresh.push(() => { picker.value = settings.bloodColor; hex.textContent = settings.bloodColor; });
  colorLabel.append(colorName, picker, hex);
  panel.append(colorLabel);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset to defaults';
  reset.style.cssText = 'padding:6px 10px;border:1px solid #71818d;border-radius:6px;background:#273442;color:inherit;cursor:pointer';
  reset.addEventListener('click', () => { settings = { ...DEFAULT_TUNING }; save(); reset.blur(); });
  panel.append(reset);
  // Pointer input belongs to these controls. Let keyup reach the game so held
  // movement keys are always released when focus moves into the panel.
  for (const event of ['pointerdown', 'click', 'keydown']) panel.addEventListener(event, e => e.stopPropagation());
  for (const update of refresh) update();
  document.body.append(panel);
  return () => panel.remove();
}
