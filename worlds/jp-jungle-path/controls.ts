import { jungleDefaults, jungleRanges, observeJungleSettings, updateJungleSettings, type JungleKey } from './tuning';

/** Only the active room owns DOM controls. Leaving it removes every listener. */
export function mountJungleControls(): () => void {
  const host = document.createElement('aside');
  host.setAttribute('aria-label', 'Jungle controls');
  host.style.cssText = 'position:fixed;top:76px;left:16px;z-index:25;width:min(310px,calc(100vw - 32px));color:#e4f1df;font:13px/1.4 system-ui;';
  const toggle = document.createElement('button');
  toggle.textContent = 'Jungle controls · H';
  toggle.style.cssText = 'padding:9px 13px;border:1px solid #90b89155;border-radius:10px;background:#10271fed;color:inherit;font:inherit;cursor:pointer;';
  toggle.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('div');
  panel.style.cssText = 'margin-top:8px;padding:16px;border:1px solid #90b89144;border-radius:12px;background:#10271ff5;max-height:calc(100dvh - 230px);overflow:auto;';
  const hint = document.createElement('p');
  hint.textContent = 'Changes are saved in this browser.';
  hint.style.cssText = 'margin:0 0 12px;color:#adbfad;font-size:12px;';
  panel.append(hint);
  const labels: Record<JungleKey, [string, string]> = {
    pathDistance: ['Distance from path', 'Moves the whole hedge away from the path.'],
    layerGap: ['Gap between layers', 'Sets the first gap; later gaps grow outward.'],
    gapMultiplier: ['Gap multiplier', 'Adds outward growth to each successive gap.'],
    heightMultiplier: ['Height multiplier', 'Raises outer walls while keeping the front wall’s height.'],
    density: ['Density of leaves', 'Adds or removes leaves without changing their size.'],
  };
  const refreshers: Array<(settings: typeof jungleDefaults) => void> = [];
  for (const key of Object.keys(labels) as JungleKey[]) {
    const label = document.createElement('label');
    label.style.cssText = 'display:block;margin:14px 0;';
    const caption = document.createElement('span');
    caption.textContent = labels[key][0];
    const value = document.createElement('output');
    value.style.cssText = 'float:right;font-variant-numeric:tabular-nums;color:#bfd88e;';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(jungleRanges[key][0]);
    input.max = String(jungleRanges[key][1]);
    input.step = String(jungleRanges[key][2]);
    input.setAttribute('aria-label', labels[key][0]);
    input.style.cssText = 'display:block;width:100%;margin:8px 0;accent-color:#95bb63;';
    const detail = document.createElement('small');
    detail.textContent = labels[key][1];
    detail.id = `jungle-${key}-hint`;
    detail.style.cssText = 'display:block;color:#adbfad;font-size:11px;';
    input.setAttribute('aria-describedby', detail.id);
    input.addEventListener('input', () => updateJungleSettings({ [key]: Number(input.value) }));
    refreshers.push(settings => {
      input.value = String(settings[key]);
      value.value = key === 'density' ? `${Math.round(settings[key] * 100)}%`
        : `${settings[key].toFixed(2)}${key === 'pathDistance' || key === 'layerGap' ? ' m' : '×'}`;
      input.setAttribute('aria-valuetext', value.value);
    });
    label.append(caption, value, input, detail);
    panel.append(label);
  }
  const reset = document.createElement('button');
  reset.textContent = 'Reset to original look';
  reset.title = 'Restore the approved rolling hedges and spacing.';
  reset.style.cssText = toggle.style.cssText;
  reset.addEventListener('click', () => updateJungleSettings(jungleDefaults));
  panel.append(reset);
  const unsubscribe = observeJungleSettings(settings => refreshers.forEach(refresh => refresh(settings)));
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
    if (!event.repeat) setOpen(panel.hidden || !!document.pointerLockElement);
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
