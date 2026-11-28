/** Dev-only, active-room shortcut. No panel exists until H is pressed. */
export function enableTuningShortcut(openPanel: () => () => void): () => void {
  let closePanel: (() => void) | undefined;
  function close() {
    closePanel?.();
    closePanel = undefined;
  }
  function toggle(event: KeyboardEvent) {
    if (event.code !== 'KeyH' || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') &&
        !target.closest('[data-visages-dev-controls]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (closePanel) close();
    else {
      if (document.pointerLockElement) document.exitPointerLock();
      closePanel = openPanel();
    }
  }
  window.addEventListener('keydown', toggle, { capture: true });
  return () => {
    window.removeEventListener('keydown', toggle, { capture: true });
    close();
  };
}
