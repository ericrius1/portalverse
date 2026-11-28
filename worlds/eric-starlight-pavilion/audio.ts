/**
 * Active-only procedural Web Audio synthesizer for Starlight Dance Pavilion.
 * Strictly tuned to Portalverse's G# minor / B major scale so every floor pad,
 * chime totem, geyser launch, beat drop, and character spell blends harmoniously
 * with the live soundtrack!
 */

// G# minor pentatonic / B major sparkling scale (Hz)
export const PAVILION_SCALE_HZ = [
  207.65, // G#3
  246.94, // B3
  277.18, // C#4
  311.13, // D#4
  369.99, // F#4
  415.30, // G#4
  493.88, // B4
  554.37, // C#5
  622.25, // D#5
  739.99, // F#5
  830.61, // G#5
  987.77, // B5
] as const;

export interface PavilionAudio {
  playTileNote: (index: number, comboBoost?: number) => void;
  playChimeTotem: (totemIdx: number) => void;
  playGeyserLaunch: () => void;
  playStyleSwitch: (styleIdx: number) => void;
  playSpell: (dancerId: 'soraya' | 'dex' | 'ermelin', slot: 1 | 2) => void;
  playFlourish: (kind: 'spin' | 'leap' | 'drop' | 'beat') => void;
  playOverdriveFanfare: () => void;
  dispose: () => void;
}

export function createPavilionAudio(): PavilionAudio {
  let ctx: AudioContext | null = null;
  let disposed = false;

  const ensure = (): AudioContext | null => {
    if (disposed || typeof window === 'undefined') return null;
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        ctx = new Ctor();
      } catch {
        return null;
      }
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  };

  const tone = (
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    vol = 0.08,
    delay = 0,
    endFreq?: number,
  ): void => {
    const ac = ensure();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  return {
    playTileNote(index: number, comboBoost = 0) {
      const f = PAVILION_SCALE_HZ[((index % PAVILION_SCALE_HZ.length) + PAVILION_SCALE_HZ.length) % PAVILION_SCALE_HZ.length];
      tone(f, 0.55, 'triangle', 0.065);
      tone(f * 2, 0.35, 'sine', 0.025 + Math.min(0.025, comboBoost * 0.004), 0.015);
    },

    playChimeTotem(totemIdx: number) {
      const roots = [311.13, 415.30, 493.88]; // D#4, G#4, B4
      const base = roots[totemIdx % roots.length];
      tone(base, 1.15, 'sine', 0.085, 0);
      tone(base * 1.5, 0.95, 'triangle', 0.055, 0.07);
      tone(base * 2.0, 0.85, 'sine', 0.045, 0.14);
      tone(base * 2.5, 0.7, 'sine', 0.03, 0.21);
    },

    playGeyserLaunch() {
      tone(155.56, 0.55, 'sine', 0.09, 0, 622.25);
      tone(311.13, 0.45, 'triangle', 0.055, 0.06, 987.77);
      tone(830.61, 0.5, 'sine', 0.04, 0.18);
    },

    playStyleSwitch(styleIdx: number) {
      const chords = [
        [207.65, 311.13, 415.3, 493.88], // G#m7 Waltz
        [155.56, 246.94, 369.99, 554.37], // Electric Hypergroove
        [246.94, 369.99, 493.88, 739.99], // Frost Crystal Rave
      ];
      const c = chords[styleIdx % chords.length];
      c.forEach((hz, i) => tone(hz, 0.65, i === 0 ? 'sawtooth' : 'triangle', i === 0 ? 0.035 : 0.05, i * 0.055));
    },

    playSpell(dancerId, slot) {
      if (dancerId === 'soraya') {
        if (slot === 1) {
          // Zellige Starburst: sparkling golden harp cascade
          [415.3, 493.88, 622.25, 830.61, 987.77].forEach((f, i) =>
            tone(f, 0.65, 'triangle', 0.065, i * 0.045),
          );
        } else {
          // Aurora Canopy: lush rising celestial pad
          [207.65, 311.13, 493.88, 622.25].forEach((f, i) =>
            tone(f, 1.35, 'sine', 0.055, i * 0.07, f * 1.12),
          );
        }
      } else if (dancerId === 'dex') {
        if (slot === 1) {
          // Prism Laser Nova: punchy synth drop + laser sweep
          tone(138.59, 0.42, 'sawtooth', 0.075, 0, 51.91);
          tone(987.77, 0.32, 'sawtooth', 0.04, 0.02, 246.94);
          tone(554.37, 0.36, 'square', 0.035, 0.08, 830.61);
        } else {
          // Holo-Clone Rush: rapid futuristic triplet pulses
          [311.13, 415.3, 622.25, 830.61].forEach((f, i) =>
            tone(f, 0.22, 'square', 0.04, i * 0.065),
          );
        }
      } else {
        if (slot === 1) {
          // Blizzard Ribbon Twirl: crystalline icy bell shimmer
          [739.99, 987.77, 830.61, 1108.73, 1244.51].forEach((f, i) =>
            tone(f, 0.72, 'sine', 0.05, i * 0.05),
          );
        } else {
          // Lantern Comet Ring: warm amber whistling chime comets
          [369.99, 493.88, 554.37, 739.99].forEach((f, i) =>
            tone(f, 0.55, 'triangle', 0.06, i * 0.075, f * 1.25),
          );
        }
      }
    },

    playFlourish(kind) {
      if (kind === 'spin') {
        tone(311.13, 0.26, 'sine', 0.055, 0, 622.25);
      } else if (kind === 'leap') {
        tone(246.94, 0.34, 'triangle', 0.06, 0, 739.99);
      } else if (kind === 'drop') {
        tone(155.56, 0.3, 'sawtooth', 0.06, 0, 77.78);
      } else {
        // Perfect Beat chime!
        tone(622.25, 0.35, 'sine', 0.065, 0);
        tone(987.77, 0.3, 'triangle', 0.045, 0.05);
      }
    },

    playOverdriveFanfare() {
      [207.65, 311.13, 415.3, 493.88, 622.25, 830.61, 987.77].forEach((f, i) =>
        tone(f, 1.1, 'triangle', 0.06, i * 0.065),
      );
    },

    dispose() {
      disposed = true;
      if (ctx) {
        ctx.close().catch(() => {});
        ctx = null;
      }
    },
  };
}
