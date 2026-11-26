import type { ChestEncounter } from './encounter';
import type { WorldContext } from '@portalverse/core';
import { readPath, type IslandPath } from './islands';
import type { TuningUniforms } from './tuning';

const draftKey = 'jp-abyss.island-path.v1';
export function loadDraft() {
  try { return readPath(JSON.parse(localStorage.getItem(draftKey) ?? 'null')); }
  catch { return undefined; }
}

/** Installed only while Abyss is active in a dev build. */
export function enableTuningShortcut(tune: TuningUniforms, path: IslandPath, encounter: ChestEncounter, ctx: WorldContext) {
  let host: HTMLElement | undefined;
  let unmount: (() => void) | undefined;
  let selected = path.entries.length ? String(path.entries.length - 1) : 'chest';

  function close() {
    unmount?.();
    unmount = undefined;
    host?.remove();
    host = undefined;
  }

  function open(editor: boolean) {
    close();
    if (document.pointerLockElement) document.exitPointerLock();
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', editor ? 'Island editor' : 'Abyss tuning');
    panel.style.cssText = 'position:fixed;top:76px;left:16px;width:min(340px,calc(100vw - 32px));max-height:calc(100dvh - 96px);overflow:auto;z-index:25';
    document.body.append(panel);
    host = panel;
    const opening = editor ? import('./islandEditor').then(({ mountEditor }) => {
      if (host !== panel || !ctx.player) return;
      unmount = mountEditor(panel, ctx.scene, ctx.player, path, encounter, selected, i => { selected = i; }, () => {
        localStorage.setItem(draftKey, JSON.stringify(path.snapshot(encounter.placement())));
      }, close);
    }) : import('./tuningPanel').then(({ mountTuningPanel }) => {
      if (host === panel) unmount = mountTuningPanel(panel, tune, () => open(true));
    });
    void opening.catch(error => {
      if (host === panel) close();
      console.error('Could not open Abyss controls', error);
    });
  }

  function toggle(event: KeyboardEvent) {
    if (!['KeyH', 'KeyI'].includes(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') && !host?.contains(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    const editor = event.code === 'KeyI';
    if (host?.getAttribute('aria-label') === (editor ? 'Island editor' : 'Abyss tuning')) close();
    else open(editor);
  }

  window.addEventListener('keydown', toggle, true);
  return () => {
    window.removeEventListener('keydown', toggle, true);
    close();
  };
}
