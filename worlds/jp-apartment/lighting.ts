/** Room-local controls: never change the shared renderer's exposure. */
export const lightingDefaults = {
  city: 0.02,
  environment: 0.06,
  fill: 0.15,
  lamps: 1.01,
};
export type LoftLighting = typeof lightingDefaults;
type Key = keyof LoftLighting;
const storageKey = 'jp-loft.lighting.v1';
const ranges: Record<Key, number> = { city: 2, environment: 2, fill: 1.5, lamps: 3 };
const listeners = new Set<(settings: LoftLighting) => void>();

function load(): LoftLighting {
  const settings = { ...lightingDefaults };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    for (const key of Object.keys(settings) as Key[]) {
      const value = saved?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        settings[key] = Math.max(0, Math.min(ranges[key], value));
      }
    }
  } catch { /* Storage may be disabled; controls still work for this visit. */ }
  return settings;
}

let current = load();

/** Keep active and already-mounted preview instances in agreement. */
export function observeLighting(apply: (settings: LoftLighting) => void): () => void {
  listeners.add(apply);
  apply(current);
  return () => { listeners.delete(apply); };
}

function update(values: LoftLighting): void {
  current = { ...values };
  for (const apply of listeners) apply(current);
  try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Optional. */ }
}

/** Attached only while this room is active; returned cleanup removes all UI/listeners. */
export function mountLightingControls(): () => void {
  const host = document.createElement('aside');
  host.setAttribute('aria-label', 'Apartment lighting');
  host.style.cssText = 'position:fixed;top:76px;left:16px;z-index:25;width:min(290px,calc(100vw - 32px));color:#f8eadb;font:13px/1.4 system-ui;';
  const toggle = document.createElement('button');
  toggle.textContent = 'Apartment lighting · H';
  toggle.style.cssText = 'padding:9px 13px;border:1px solid #ffffff30;border-radius:10px;background:#171c28ed;color:inherit;font:inherit;cursor:pointer;';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.hidden = true;
  panel.style.cssText = 'margin-top:8px;padding:16px;border:1px solid #ffffff30;border-radius:12px;background:#171c28f5;max-height:calc(100dvh - 230px);overflow:auto;';
  const hint = document.createElement('p');
  hint.textContent = 'Saved on this browser. Changes affect only Apartment.';
  hint.style.cssText = 'margin:0 0 12px;color:#b8bfce;font-size:12px;';
  panel.append(hint);
  const fields: Array<() => void> = [];
  const labels: Record<Key, [string, string]> = {
    city: ['City brightness', 'The HDRI visible through the windows.'],
    environment: ['HDRI lighting', 'Environment light and reflections on surfaces.'],
    fill: ['Ambient fill', 'Soft room-wide light; lower for deeper shadows.'],
    lamps: ['Lamp light', 'Lampshade glow and warm light on nearby surfaces.'],
  };
  for (const key of Object.keys(labels) as Key[]) {
    const label = document.createElement('label');
    label.style.cssText = 'display:block;margin:12px 0;';
    label.title = labels[key][1];
    const caption = document.createElement('span');
    caption.textContent = labels[key][0];
    const value = document.createElement('output');
    value.style.cssText = 'float:right;font-variant-numeric:tabular-nums;color:#ffc68d;';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(ranges[key]);
    slider.step = '0.01';
    slider.setAttribute('aria-label', labels[key][0]);
    slider.style.cssText = 'display:block;width:100%;margin:8px 0;accent-color:#ffb36b;';
    slider.addEventListener('input', () => update({ ...current, [key]: Number(slider.value) }));
    fields.push(() => {
      slider.value = String(current[key]);
      value.value = current[key].toFixed(2);
    });
    label.append(caption, value, slider);
    panel.append(label);
  }
  const reset = document.createElement('button');
  reset.textContent = 'Reset to night lighting';
  reset.style.cssText = toggle.style.cssText;
  reset.addEventListener('click', () => update(lightingDefaults));
  panel.append(reset);
  const refresh = () => { for (const field of fields) field(); };
  const unsubscribe = observeLighting(refresh);
  function setOpen(open: boolean) {
    if (open && document.pointerLockElement) document.exitPointerLock();
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  host.addEventListener('pointerdown', event => event.stopPropagation());
  host.addEventListener('click', event => event.stopPropagation());
  host.addEventListener('keydown', event => event.stopPropagation());
  const shortcut = (event: KeyboardEvent) => {
    if (event.code !== 'KeyH' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) setOpen(panel.hidden);
  };
  window.addEventListener('keydown', shortcut, true);
  host.append(toggle, panel);
  document.body.append(host);
  return () => {
    unsubscribe();
    window.removeEventListener('keydown', shortcut, true);
    host.remove();
  };
}
