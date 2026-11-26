import type { TuningUniforms } from './tuning';

/** Installed only while Abyss is active in a dev build. */
export function enableTuningShortcut(tune: TuningUniforms) {
  let host: HTMLElement | undefined;
  let unmount: (() => void) | undefined;

  function close() {
    unmount?.();
    unmount = undefined;
    host?.remove();
    host = undefined;
  }

  function toggle(event: KeyboardEvent) {
    if (event.code !== 'KeyH' || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') && !host?.contains(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (host) {
      close();
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Abyss tuning');
    panel.style.cssText = 'position:fixed;top:76px;left:16px;width:min(370px,calc(100vw - 32px));max-height:calc(100dvh - 96px);overflow:auto;z-index:25';
    document.body.append(panel);
    host = panel;
    void import('./tuningPanel').then(({ mountTuningPanel }) => {
      if (host === panel) unmount = mountTuningPanel(panel, tune);
    }).catch(error => {
      if (host === panel) close();
      console.error('Could not open Abyss tuning', error);
    });
  }

  window.addEventListener('keydown', toggle, true);
  return () => {
    window.removeEventListener('keydown', toggle, true);
    close();
  };
}
