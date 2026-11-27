import type { CycleSnapshot, TrolleyState } from './worldState';
import { trolleyStatusLabel } from './worldState';
import type { TalkableNpc } from './characters';

/**
 * Active-only procedural Cyberpunk Rain & Neo-Tokyo Soundscape:
 * - Dynamic pink-filtered rain ambience whose volume swells/fades smoothly with live `rainIntensity`
 * - Distant electric trolley ding & rail chime when arriving/boarding
 * - Noodle sizzle, CRT static click, vending jingle, dialogue synth blip, and Easter egg chime
 * All tuned to Portalverse's shared B major / G# minor key.
 */
export interface NeoTokyoAudio {
  setRainLevel: (rain01: number) => void;
  playTrolleyBell: () => void;
  playNoodleOrder: () => void;
  playVendingJingle: () => void;
  playCrtClick: () => void;
  playDialogueBlip: () => void;
  playEasterEggChime: () => void;
  playPuddleStep: () => void;
  dispose: () => void;
}

export function createNeoTokyoAudio(): NeoTokyoAudio {
  let ctx: AudioContext | null = null;
  let rainSource: AudioBufferSourceNode | null = null;
  let rainGain: GainNode | null = null;
  let desiredRain = 0.8;
  let disposed = false;

  const ensureContext = (): AudioContext | null => {
    if (disposed || typeof window === 'undefined') return null;
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    if (ctx.state === 'running' && !rainSource) {
      try {
        const len = ctx.sampleRate * 3;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.996 * b0 + white * 0.03;
          b1 = 0.984 * b1 + white * 0.033;
          b2 = 0.945 * b2 + white * 0.05;
          data[i] = (b0 + b1 + b2 + white * 0.015) * 0.42;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1050;
        filter.Q.value = 0.5;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(Math.max(0.002, desiredRain * 0.03), ctx.currentTime + 1.0);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        rainSource = src;
        rainGain = gain;
      } catch {
        // Ignore constrained Web Audio environments
      }
    }
    return ctx.state === 'running' ? ctx : null;
  };

  const unlock = () => {
    ensureContext();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  const playTone = (freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0) => {
    const audio = ensureContext();
    if (!audio) return;
    const now = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  };

  return {
    setRainLevel(rain01: number) {
      desiredRain = Math.max(0, Math.min(1, rain01));
      if (rainGain && ctx && ctx.state === 'running') {
        rainGain.gain.setTargetAtTime(Math.max(0.001, desiredRain * 0.032), ctx.currentTime, 0.35);
      }
    },
    playTrolleyBell() {
      // Classic metallic twin streetcar ding in B major
      playTone(987.77, 0.9, 0.06, 'triangle', 0);
      playTone(1479.98, 0.7, 0.03, 'sine', 0.01);
      playTone(987.77, 1.1, 0.06, 'triangle', 0.28);
    },
    playNoodleOrder() {
      playTone(554.37, 0.45, 0.045, 'sine', 0);
      playTone(739.99, 0.55, 0.045, 'sine', 0.1);
      playTone(987.77, 0.75, 0.05, 'triangle', 0.2);
    },
    playVendingJingle() {
      playTone(622.25, 0.25, 0.045, 'triangle', 0);
      playTone(739.99, 0.25, 0.045, 'triangle', 0.09);
      playTone(987.77, 0.55, 0.05, 'sine', 0.18);
    },
    playCrtClick() {
      playTone(165, 0.07, 0.05, 'square', 0);
      playTone(1244.5, 0.2, 0.025, 'sine', 0.04);
    },
    playDialogueBlip() {
      playTone(622.25, 0.14, 0.03, 'sine', 0);
      playTone(830.61, 0.18, 0.024, 'triangle', 0.05);
    },
    playEasterEggChime() {
      playTone(493.88, 1.1, 0.055, 'sine', 0);
      playTone(622.25, 1.1, 0.05, 'sine', 0.09);
      playTone(739.99, 1.2, 0.05, 'sine', 0.18);
      playTone(987.77, 1.4, 0.055, 'triangle', 0.27);
    },
    playPuddleStep() {
      playTone(370, 0.15, 0.022, 'sine', 0);
      playTone(554.37, 0.2, 0.015, 'sine', 0.04);
    },
    dispose() {
      disposed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
      if (rainSource) {
        try { rainSource.stop(); } catch { /* ignore */ }
        rainSource = null;
      }
      if (ctx) {
        ctx.close().catch(() => {});
        ctx = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Sleek Active-Only Neo-Tokyo Street HUD:
// - Compact Status Pill (Clock • Weather • Trolley Countdown • Easter Eggs)
// - Floating NPC Dialogue Terminal Card (with [F] Next Line cycling)
// - Auto-fading Lore / Easter Egg Discovery Toast
// ---------------------------------------------------------------------------

export interface NeoTokyoHud {
  updateStatus: (cycle: CycleSnapshot, trolley: TrolleyState, eggsFound: number, eggsTotal: number) => void;
  setDialogue: (npc: TalkableNpc | null, routine: string, lineText: string, lineIdx: number, lineTotal: number) => void;
  showToast: (text: string) => void;
  dispose: () => void;
}

export function createNeoTokyoHud(): NeoTokyoHud {
  if (typeof document === 'undefined') {
    return { updateStatus() {}, setDialogue() {}, showToast() {}, dispose() {} };
  }

  // 1. Compact Street Clock / Weather / Trolley Chip (tucked neatly below the toolbar on all viewport sizes)
  const chip = document.createElement('div');
  Object.assign(chip.style, {
    position: 'fixed',
    left: '16px',
    top: '116px',
    padding: '6px 12px',
    borderRadius: '999px',
    background: 'rgba(10, 14, 28, 0.72)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(34, 211, 238, 0.35)',
    color: '#e0f2fe',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11.5px',
    letterSpacing: '0.04em',
    pointerEvents: 'none',
    zIndex: '40',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
  });
  document.body.appendChild(chip);

  // 2. NPC Cyberpunk Dialogue Card (appears cleanly when standing near any NPC)
  const dialog = document.createElement('div');
  Object.assign(dialog.style, {
    position: 'fixed',
    left: '50%',
    bottom: '92px',
    transform: 'translateX(-50%) translateY(12px)',
    maxWidth: '520px',
    width: 'calc(100% - 32px)',
    padding: '12px 16px',
    borderRadius: '14px',
    background: 'rgba(9, 13, 26, 0.84)',
    backdropFilter: 'blur(14px)',
    border: '1px solid rgba(244, 114, 182, 0.48)',
    color: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13.5px',
    lineHeight: '1.45',
    boxShadow: '0 10px 32px rgba(0, 0, 0, 0.45)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 240ms ease, transform 240ms ease',
    zIndex: '44',
  });
  const dHeader = document.createElement('div');
  Object.assign(dHeader.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '10px',
    marginBottom: '4px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11.5px',
  });
  const dName = document.createElement('span');
  dName.style.color = '#22d3ee';
  dName.style.fontWeight = '700';
  const dRoutine = document.createElement('span');
  dRoutine.style.color = '#f472b6';
  dHeader.append(dName, dRoutine);

  const dBody = document.createElement('div');
  dBody.style.color = '#f1f5f9';
  const dHint = document.createElement('div');
  Object.assign(dHint.style, {
    marginTop: '6px',
    fontSize: '11px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#94a3b8',
  });
  dialog.append(dHeader, dBody, dHint);
  document.body.appendChild(dialog);

  // 3. Discovery / Lore Toast (slightly above the dialogue area)
  const toast = document.createElement('div');
  toast.setAttribute('aria-live', 'polite');
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    top: '74px',
    transform: 'translateX(-50%) translateY(-8px)',
    maxWidth: '540px',
    padding: '9px 16px',
    borderRadius: '999px',
    background: 'rgba(12, 18, 34, 0.85)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(250, 204, 21, 0.55)',
    color: '#fefce8',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12.5px',
    textAlign: 'center',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 280ms ease, transform 280ms ease',
    zIndex: '46',
  });
  document.body.appendChild(toast);

  let toastTimer: number | null = null;
  let lastStatusStr = '';
  let lastNpcId: string | null = null;
  let lastLineIdx = -1;

  return {
    updateStatus(cycle, trolley, eggsFound, eggsTotal) {
      const wLabel = cycle.weather === 'DOWNPOUR' ? 'RAIN' : cycle.weather === 'DRIZZLE' ? 'DRIZZLE' : 'STATIC SKY';
      const nextStr = `${cycle.clockLabel} ${cycle.period} • ${wLabel} • ${trolleyStatusLabel(trolley)} • SECRETS ${eggsFound}/${eggsTotal}`;
      if (nextStr !== lastStatusStr) {
        lastStatusStr = nextStr;
        chip.textContent = nextStr;
      }
    },
    setDialogue(npc, routine, lineText, lineIdx, lineTotal) {
      if (!npc) {
        if (lastNpcId !== null) {
          lastNpcId = null;
          lastLineIdx = -1;
          dialog.style.opacity = '0';
          dialog.style.transform = 'translateX(-50%) translateY(12px)';
        }
        return;
      }
      if (lastNpcId !== npc.id || lastLineIdx !== lineIdx) {
        lastNpcId = npc.id;
        lastLineIdx = lineIdx;
        dName.textContent = `${npc.name} · ${npc.speciesLabel}`;
        dRoutine.textContent = routine;
        dBody.textContent = `"${lineText}"`;
        dHint.textContent = lineTotal > 1 ? `[F] Talk more (${lineIdx + 1}/${lineTotal}) • ${npc.role}` : npc.role;
      }
      dialog.style.opacity = '1';
      dialog.style.transform = 'translateX(-50%) translateY(0)';
    },
    showToast(text) {
      toast.textContent = text;
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-8px)';
        toastTimer = null;
      }, 4200);
    },
    dispose() {
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      chip.remove();
      dialog.remove();
      toast.remove();
    },
  };
}
