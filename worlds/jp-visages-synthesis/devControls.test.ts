import { describe, expect, it, vi, afterEach } from 'vitest';
import { DEFAULT_TUNING, normalizeTuning, readTuning } from './devControls';

afterEach(() => vi.unstubAllGlobals());

describe('local Visages tuning', () => {
  it('keeps defaults for missing, corrupt and inaccessible local settings', () => {
    expect(normalizeTuning(null)).toEqual(DEFAULT_TUNING);
    vi.stubGlobal('localStorage', { getItem: () => '{invalid' });
    expect(readTuning()).toEqual(DEFAULT_TUNING);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readTuning()).toEqual(DEFAULT_TUNING);
  });

  it('bounds brightness and accepts only full hex colors', () => {
    expect(normalizeTuning({ roomBrightness: 999, bloodBrightness: -1, bloodColor: 'red' }))
      .toEqual({ roomBrightness: 2, bloodBrightness: 0.2, bloodColor: DEFAULT_TUNING.bloodColor });
    expect(normalizeTuning({ roomBrightness: NaN, bloodBrightness: '2', bloodColor: '#ABCDEF' }))
      .toEqual({ roomBrightness: 1, bloodBrightness: 1, bloodColor: '#abcdef' });
  });
});
