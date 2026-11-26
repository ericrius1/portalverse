import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { button, folder, LevaPanel, useControls, useCreateStore } from 'leva';
import { defaults, type AbyssTuning, type NumericSetting, type TuningUniforms } from './tuning';

function exportPreset(tune: TuningUniforms) {
  const settings = Object.fromEntries(Object.entries(tune).map(([key, node]) => [key, node.value]));
  const json = JSON.stringify({ room: 'jp-abyss', version: 2, settings }, null, 2);
  const url = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jp-abyss-tuning.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Panel({ tune, apply, openEditor }: { openEditor: () => void; tune: TuningUniforms; apply: (values: Partial<AbyssTuning>) => void }) {
  const store = useCreateStore();
  const slider = (key: NumericSetting, label: string, min: number, max: number, step: number) => ({
    label, min, max, step, value: tune[key].value,
    onChange: (value: number) => { tune[key].value = value; },
  });
  const range = (low: NumericSetting, high: NumericSetting, label: string, min: number, max: number) => ({
    label, min, max, value: [tune[low].value, tune[high].value] as [number, number],
    onChange: ([a, b]: [number, number]) => { tune[low].value = a; tune[high].value = b; },
  });
  useControls(() => ({
    'Edit islands (I)': button(openEditor),
    Stones: folder({
      stoneBrightness: slider('stoneBrightness', 'Rock brightness', 0, 4, 0.05),
      glowBrightness: slider('glowBrightness', 'Glow brightness', 0, 5, 0.05),
      breathStrength: slider('breathStrength', 'Breathing strength', 0, 1, 0.01),
      breathSpeed: slider('breathSpeed', 'Breathing speed ×', 0, 4, 0.05),
      breathRandomness: slider('breathRandomness', 'Breathing randomness', 0, 1, 0.01),
    }),
    Smoke: folder({
      'Varied wisps': button(() => apply({
        pathWispMin: 1, pathWispMax: 14, strayWispMin: 2, strayWispMax: 24,
        lengthRandomness: 1, opacityMin: 0.06, opacityMax: 0.42,
        tailFalloffMin: 0.45, tailFalloffMax: 3.5, wispThinness: 0.65,
      })),
      pathLength: range('pathWispMin', 'pathWispMax', 'Path length range (m)', 0.1, 40),
      strayLength: range('strayWispMin', 'strayWispMax', 'Stray length range (m)', 0.1, 60),
      lengthRandomness: slider('lengthRandomness', 'Length randomness', 0, 1, 0.01),
      wispWidth: slider('wispWidth', 'Ribbon width ×', 0.1, 3, 0.05),
      wispThinness: slider('wispThinness', 'Wispiness variation', 0, 1, 0.01),
      opacity: range('opacityMin', 'opacityMax', 'Opacity range', 0, 1),
      tailFalloff: range('tailFalloffMin', 'tailFalloffMax', 'Tail falloff range', 0.1, 6),
    }),
    Footsteps: folder({
      fullPathWidth: {
        label: 'Full path width', value: tune.fullPathWidth.value,
        onChange: (value: boolean) => { tune.fullPathWidth.value = value; },
      },
      stepBrightness: slider('stepBrightness', 'Trail brightness', 0, 5, 0.05),
      stepFadeIn: slider('stepFadeIn', 'Fade-in time (s)', 0, 1.5, 0.01),
      stepNeighborDelay: slider('stepNeighborDelay', 'Neighbor delay (s)', 0, 0.6, 0.01),
      stepSeconds: slider('stepSeconds', 'Fade duration (s)', 0.1, 12, 0.1),
      stepFalloff: slider('stepFalloff', 'Fade curve', 0.1, 4, 0.05),
    }),
  }), { store });
  useControls({
    'Export JSON': button(() => exportPreset(tune)),
    'Reset to defaults': button(() => apply(defaults)),
  }, { store });
  return createElement(LevaPanel, {
    store, fill: true, hideCopyButton: true,
    titleBar: { title: 'Abyss tuning', drag: false, filter: false },
  });
}

export function mountTuningPanel(host: HTMLElement, tune: TuningUniforms, openEditor: () => void) {
  const root = createRoot(host);
  let revision = 0;
  function render() {
    root.render(createElement(Panel, { key: revision, tune, apply, openEditor }));
  }
  function apply({ fullPathWidth, ...values }: Partial<AbyssTuning>) {
    if (fullPathWidth !== undefined) tune.fullPathWidth.value = fullPathWidth;
    for (const [key, value] of Object.entries(values)) tune[key as NumericSetting].value = value;
    revision++;
    render();
  }
  render();
  return () => root.unmount();
}
