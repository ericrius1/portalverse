import {
  LOOP_SECONDS,
  STEM_IDS,
  STEM_ROLES,
  PREVIEW_RADIUS,
  gateCloseness,
  loopOffset,
  mixVibes,
  motionMultiplier,
  muffleCutoff,
  phraseMultipliers,
  untilNextPhrase,
  vibeFor,
  type StemId,
} from './musicMix';
import musicAssets from './musicAssets.json';

/**
 * Portalverse's adaptive soundtrack: Suno Studio stems mixed live as the player moves.
 *
 * All stems run all the time, phase-locked to one bar grid, each through its own gain and
 * low-pass. The room the player is in sets the blend. Close to a gate you hear a faint,
 * muffled hint of the room beyond it; the change itself happens as you step through, with
 * a quick crossfade timed to the crossing. Every 4-bar phrase reshuffles which layers are
 * up, and the beat follows how fast the player is moving.
 *
 * Portals get a soft synthesized hum that swells with the screen warp, and a Suno-made
 * cosmic whoosh with a filter sweep on each crossing.
 */

type AssetEntry = { webm: string; m4a: string };
const ASSETS = musicAssets as Record<string, AssetEntry>;

export interface SoundtrackFrame {
  roomId: string;
  /** Room through the entrance gate (z = +gate) and through the exit gate (z = -gate). */
  previousRoomId: string | null;
  nextRoomId: string | null;
  /** Player's feet in room coordinates. */
  x: number;
  z: number;
  /** Distance of each gate from the room's centre along Z. */
  gateZ: number;
  /** 0..1 portal screen warp. */
  warp: number;
  /** 0..1 smoothed speed relative to a sprint. */
  moveNorm: number;
  fallen: boolean;
}

const MUSIC_LEVEL = 0.5;
/** Time constants (s) for stem gains: the crossfade on a room change, gate hints, phrase changes. */
const CROSSFADE_TC = 0.28;
const PREVIEW_TC = 0.35;
const PHRASE_TC = 0.8;
/** How long after a room change the fast crossfade glide applies. */
const CROSSFADE_SECONDS = 1.4;
const STORAGE_KEY = 'portalverse:music-muted';
/** Where the whoosh's bloom peaks, in seconds into the file. */
const WHOOSH_PEAK = 2.21;

interface StemChannel {
  id: StemId;
  gain: GainNode;
  filter: BiquadFilterNode;
  source?: AudioBufferSourceNode;
}

export class Soundtrack {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly musicBus: GainNode;
  private readonly musicFilter: BiquadFilterNode;
  /** Only the crossing sweep moves this one, so it never fights the warp filter. */
  private readonly sweepFilter: BiquadFilterNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbSend: GainNode;
  private readonly sfxBus: GainNode;
  private readonly humGain: GainNode;
  private readonly humFilter: BiquadFilterNode;
  private readonly channels = new Map<StemId, StemChannel>();
  private whoosh?: AudioBuffer;
  private readonly transportStart: number;
  private phrase: Record<StemId, number> = phraseMultipliers();
  private phraseTimer = 0;
  private lastFrameAt = 0;
  private lastWhooshAt = -Infinity;
  private currentRoom: string | null = null;
  private crossfadeUntil = 0;
  /** The room just left: no hint of it while the player is still at the gate they came in by. */
  private cameFrom: string | null = null;
  private started = false;
  private muted: boolean;
  private disposed = false;
  private readonly format: keyof AssetEntry;

  /**
   * `silent` runs everything at zero output (for automated tests), without touching the
   * player's saved mute preference.
   */
  constructor(opts: { muted?: boolean; silent?: boolean } = {}) {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    let stored = false;
    try { stored = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage unavailable */ }
    this.muted = opts.muted ?? stored;
    const probe = typeof Audio !== 'undefined' ? new Audio() : null;
    this.format = probe?.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';

    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    // A safety limiter only: high enough that the whoosh doesn't pump the music.
    limiter.threshold.value = -4;
    limiter.knee.value = 6;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    const output = ctx.createGain();
    output.gain.value = opts.silent ? 0 : 1;
    limiter.connect(output).connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(limiter);

    this.musicBus = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.Q.value = 0.5;
    this.sweepFilter = ctx.createBiquadFilter();
    this.sweepFilter.type = 'lowpass';
    this.sweepFilter.frequency.value = 20000;
    this.sweepFilter.Q.value = 0.7;
    this.musicBus.connect(this.musicFilter).connect(this.sweepFilter).connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = cosmicImpulse(ctx, 5.5);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.55;
    this.reverb.connect(reverbOut).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.06;
    this.sweepFilter.connect(this.reverbSend).connect(this.reverb);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    // The portal hum: a low D drone with a slowly beating fifth and a breath of filtered noise.
    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 300;
    this.humFilter.Q.value = 2;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humFilter.connect(this.humGain);
    this.humGain.connect(this.sfxBus);
    this.humGain.connect(this.reverb);
    for (const [freq, detune, level] of [[73.42, -4, 0.5], [73.42, 5, 0.5], [110.0, 2, 0.28], [146.83, -3, 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(this.humFilter);
      osc.start();
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, 4);
    noise.loop = true;
    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 900;
    noiseBand.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.12;
    noise.connect(noiseBand).connect(noiseGain).connect(this.humFilter);
    noise.start();

    for (const id of STEM_IDS) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 18000;
      filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      filter.connect(gain).connect(this.musicBus);
      this.channels.set(id, { id, gain, filter });
    }

    // Shared bar grid, a little in the future so the first stems land on a downbeat.
    this.transportStart = ctx.currentTime + 0.2;
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get isMuted(): boolean { return this.muted; }

  /** Fetch and decode every stem; each starts the moment it's ready, on the grid. */
  async load(priority: StemId[] = []): Promise<void> {
    const order = [...priority, ...STEM_IDS.filter(id => !priority.includes(id))];
    const tasks = order.map(async id => {
      const buffer = await this.decode(id);
      if (buffer && !this.disposed) this.startStem(id, buffer);
    });
    tasks.push(this.decode('portal-whoosh').then(b => { if (b) this.whoosh = b; }));
    await Promise.allSettled(tasks);
  }

  /** Call from a user gesture: browsers only let audio start after one. */
  start(): void {
    this.started = true;
    if (!this.muted && document.visibilityState === 'visible') void this.ctx.resume();
    this.applyMasterLevel(3);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch { /* storage unavailable */ }
    if (!muted && this.started && document.visibilityState === 'visible') void this.ctx.resume();
    this.applyMasterLevel(muted ? 0.4 : 2);
    if (muted) window.setTimeout(() => { if (this.muted) void this.ctx.suspend(); }, 600);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Feed the player's state; cheap to call every frame (it updates at ~15 Hz). */
  update(frame: SoundtrackFrame): void {
    if (this.disposed || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    if (now >= this.phraseTimer) {
      this.phrase = phraseMultipliers();
      this.phraseTimer = now + untilNextPhrase(now, this.transportStart) + 0.01;
    }
    if (frame.roomId !== this.currentRoom) this.enterRoom(frame.roomId);
    if (now - this.lastFrameAt < 1 / 15) return;
    this.lastFrameAt = now;

    // The gate the player is close to, if any (not the one they just came in by).
    const gates = [
      { id: frame.nextRoomId, distance: Math.hypot(frame.x, frame.z + frame.gateZ) },
      { id: frame.previousRoomId, distance: Math.hypot(frame.x, frame.z - frame.gateZ) },
    ];
    const back = gates.find(g => g.id === this.cameFrom);
    if (back && back.distance > PREVIEW_RADIUS) this.cameFrom = null;
    let neighbourId: string | null = null;
    let closeness = 0;
    for (const g of gates) {
      if (!g.id || g.id === this.cameFrom) continue;
      const c = gateCloseness(g.distance);
      if (c > closeness) { closeness = c; neighbourId = g.id; }
    }
    this.applyMix(frame.roomId, neighbourId, closeness, frame.moveNorm);

    // Near a portal: a gentle darkening, a little air, and the hum underneath.
    const w = Math.min(1, Math.max(0, frame.warp));
    const cutoff = frame.fallen ? 420 : 18000 * Math.pow(5000 / 18000, w);
    this.musicFilter.frequency.setTargetAtTime(cutoff, now, frame.fallen ? 0.6 : 0.15);
    this.musicBus.gain.setTargetAtTime(frame.fallen ? 0.55 : 1 - 0.12 * w, now, 0.2);
    this.reverbSend.gain.setTargetAtTime(0.06 + 0.22 * w, now, 0.2);
    this.humGain.gain.setTargetAtTime(0.09 * Math.pow(w, 1.6), now, 0.12);
    this.humFilter.frequency.setTargetAtTime(220 + 900 * w * w, now, 0.12);
  }

  /**
   * Switch to a room's blend with a quick crossfade, at the moment of the crossing (call it
   * from the crossing itself; update() also catches a change it hasn't been told about).
   */
  enterRoom(roomId: string): void {
    if (roomId === this.currentRoom) return;
    this.cameFrom = this.currentRoom;
    this.currentRoom = roomId;
    if (this.disposed) return;
    this.crossfadeUntil = this.ctx.currentTime + CROSSFADE_SECONDS;
    this.applyMix(roomId, null, 0, this.lastMoveNorm);
  }

  private lastMoveNorm = 0;

  private applyMix(roomId: string, neighbourId: string | null, closeness: number, moveNorm: number): void {
    this.lastMoveNorm = moveNorm;
    const now = this.ctx.currentTime;
    const crossfading = now < this.crossfadeUntil;
    const own = vibeFor(roomId);
    const mix = mixVibes(own, neighbourId ? vibeFor(neighbourId) : null, closeness);
    for (const channel of this.channels.values()) {
      const m = mix[channel.id];
      const level = m.level * this.phrase[channel.id] * motionMultiplier(STEM_ROLES[channel.id], moveNorm);
      const hint = !own[channel.id];
      const tc = crossfading ? CROSSFADE_TC : hint ? PREVIEW_TC : PHRASE_TC;
      channel.gain.gain.setTargetAtTime(level, now, tc);
      channel.filter.frequency.setTargetAtTime(muffleCutoff(m.muffle), now, crossfading ? 0.15 : 0.25);
    }
  }

  /** The cosmic whoosh as the player steps through a portal (or teleports). */
  playPortalWhoosh(): void {
    if (!this.whoosh || this.muted || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // One crossing can be reported twice (promotion, then the room change): play it once.
    if (now - this.lastWhooshAt < 1.2) return;
    this.lastWhooshAt = now;
    const rate = 0.86 + Math.random() * 0.22;
    // Start partway into the swell so the bloom lands just after the crossing.
    const offset = Math.max(0, WHOOSH_PEAK - 0.45 * rate);
    const src = ctx.createBufferSource();
    src.buffer = this.whoosh;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.45, now + 0.08);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.5;
    src.connect(gain).connect(pan);
    pan.connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    pan.connect(send).connect(this.reverb);
    src.start(now, offset);
    src.onended = () => { src.disconnect(); gain.disconnect(); pan.disconnect(); send.disconnect(); };

    // A quick DJ filter sweep on the music, timed to the crossing.
    const f = this.sweepFilter.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(20000, now);
    f.exponentialRampToValueAtTime(1600, now + 0.18);
    f.exponentialRampToValueAtTime(20000, now + 1.3);
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const c of this.channels.values()) c.source?.stop();
    void this.ctx.close();
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.ctx.suspend();
    else if (this.started && !this.muted) void this.ctx.resume();
  };

  private applyMasterLevel(seconds: number): void {
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.muted || !this.started ? 0 : MUSIC_LEVEL, now + seconds);
  }

  private async decode(id: string): Promise<AudioBuffer | null> {
    const entry = ASSETS[id];
    if (!entry) return null;
    try {
      const res = await fetch(entry[this.format]);
      if (!res.ok) throw new Error(`${res.status}`);
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn(`[soundtrack] couldn't load ${id}:`, err);
      return null;
    }
  }

  private startStem(id: StemId, buffer: AudioBuffer): void {
    const channel = this.channels.get(id);
    if (!channel || channel.source) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = Math.min(LOOP_SECONDS, buffer.duration);
    src.connect(channel.filter);
    const when = Math.max(this.ctx.currentTime + 0.05, this.transportStart);
    src.start(when, loopOffset(when, this.transportStart, src.loopEnd));
    channel.source = src;
  }
}

/** A dark, wide reverb tail made from decaying stereo noise. */
function cosmicImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Low-passed noise that darkens as it decays.
      const a = 0.12 + 0.6 * t;
      lp += (Math.random() * 2 - 1 - lp) * (1 - a);
      data[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
    }
  }
  return buffer;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
