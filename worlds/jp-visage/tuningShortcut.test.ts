import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableTuningShortcut } from './tuningShortcut';
import { DEFAULT_TUNING } from './tuning';

afterEach(() => vi.unstubAllGlobals());

describe('Visages approved tuning and shortcut', () => {
  it('ships the approved colors and brightness without browser storage', () => {
    expect(DEFAULT_TUNING).toEqual({ roomBrightness: 0.5, bloodBrightness: 0.55, bloodColor: '#86090b' });
  });

  it('starts hidden, toggles on H, releases the pointer and cleans up on leaving', () => {
    const windowTarget = new EventTarget();
    const exitPointerLock = vi.fn();
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', { pointerLockElement: {}, exitPointerLock });
    vi.stubGlobal('HTMLElement', class {});
    const close = vi.fn();
    const open = vi.fn(() => close);
    const cleanup = enableTuningShortcut(open);
    const press = (code: string, repeat = false, ctrlKey = false) => {
      const event = new Event('keydown', { cancelable: true });
      Object.assign(event, { code, repeat, ctrlKey, altKey: false, metaKey: false });
      windowTarget.dispatchEvent(event);
    };
    expect(open).not.toHaveBeenCalled();
    press('KeyI');
    press('KeyH', false, true);
    expect(open).not.toHaveBeenCalled();
    press('KeyH');
    expect(open).toHaveBeenCalledTimes(1);
    expect(exitPointerLock).toHaveBeenCalledTimes(1);
    press('KeyH', true);
    expect(close).not.toHaveBeenCalled();
    press('KeyH');
    expect(close).toHaveBeenCalledTimes(1);
    press('KeyH');
    expect(open).toHaveBeenCalledTimes(2);
    cleanup();
    expect(close).toHaveBeenCalledTimes(2);
    press('KeyH');
    expect(open).toHaveBeenCalledTimes(2);
  });
});
