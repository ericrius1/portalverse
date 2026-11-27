import {
  BAR_SECONDS,
  LOOP_SECONDS,
  STEM_IDS,
  STEM_ROLES,
  loopOffset,
  motionMultiplier,
  nextBeat,
  nextPhraseStart,
  phraseMultipliers,
  stemsFor,
  vibeFor,
  type StemId,
} from './musicMix';
import musicAssets from './musicAssets.json';

/**
 * Portalverse's adaptive soundtrack: Suno Studio stems, all retuned into G-sharp minor at
 * 88 BPM, played as one "song" per room.
 *
 * A room's song is a deck: its stems start together from the top of the loop, each with
 * its own gain, through one deck filter. Only one room's song is heard at a time. Crossing
 * a portal is a DJ transition: the current deck's filter sweeps down under the cosmic
 * whoosh, and on the next beat the next room's song drops in from its top and its filter
 * opens back up. Every 4-bar phrase reshuffles which melodic layers are up, and the beat
 * follows how fast the player is moving. Portals also get a soft synthesized hum, tuned to
 * the same key, that swells with the screen warp.
 */

type AssetEntry = { webm: string; m4a: string };
const ASSETS = musicAssets as Record<string, AssetEntry>;

export interface SoundtrackFrame {
  roomId: string;
  /** 0..1 portal screen warp. */
  warp: number;
  /** 0..1 smoothed speed relative to a sprint. */
  moveNorm: number;
  fallen: boolean;
}

const MUSIC_LEVEL = 0.5;
const STORAGE_KEY = 'portalverse:music-muted';
/** Where the whoosh's bloom peaks, in seconds into the file. */
const WHOOSH_PEAK = 2.22;
/** The deck filter: wide open, and where a sweep bottoms out. */
const OPEN_HZ = 20000;
const SWEPT_HZ = 320;
/** The shortest sweep-out before the next song drops (it lands on the first beat after this). */
const MIN_SWEEP_SECONDS = 0.3;
/** How long the new song's filter takes to open after it drops. */
const OPEN_SECONDS = 1.6;
/** Time constant (s) for layer changes within a song. */
const LAYER_TC = 0.8;

interface DeckStem {
  gain: GainNode;
  source: AudioBufferSourceNode;
}

/** One room's song. */
interface Deck {
  roomId: string;
  /** Audio-clock time of the song's first downbeat. */
  start: number;
  out: GainNode;
  filter: BiquadFilterNode;
  stems: Map<StemId, DeckStem>;
  phrase: Record<StemId, number>;
  nextPhrase: number;
}

export class Soundtrack {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly musicBus: GainNode;
  private readonly musicFilter: BiquadFilterNode;
  private readonly reverb: ConvolverNode;
  private readonly sfxBus: GainNode;
  private readonly humGain: GainNode;
  private readonly humFilter: BiquadFilterNode;
  private readonly buffers = new Map<StemId, AudioBuffer>();
  private whoosh?: AudioBuffer;
  private deck: Deck | null = null;
  private currentRoom: string | null = null;
  private moveNorm = 0;
  private lastFrameAt = 0;
  private lastWhooshAt = -Infinity;
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
    // A safety limiter only, high enough that the whoosh doesn't pump the music.
    const limiter = ctx.createDynamicsCompressor();
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
    this.musicFilter.frequency.value = OPEN_HZ;
    this.musicFilter.Q.value = 0.5;
    this.musicBus.connect(this.musicFilter).connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = cosmicImpulse(ctx, 5);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.5;
    this.reverb.connect(reverbOut).connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    // The portal hum: a soft G-sharp drone with its fifth (D-sharp), in the music's key.
    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 300;
    this.humFilter.Q.value = 1.5;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humFilter.connect(this.humGain);
    this.humGain.connect(this.sfxBus);
    this.humGain.connect(this.reverb);
    for (const [freq, detune, level] of [[103.83, -4, 0.5], [103.83, 5, 0.5], [155.56, 2, 0.25], [207.65, -3, 0.1]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(this.humFilter);
      osc.start();
    }

    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get isMuted(): boolean { return this.muted; }

  /** Fetch and decode every stem (the given ones first) and the whoosh. */
  async load(priority: StemId[] = []): Promise<void> {
    const prioritySet = new Set<StemId>(priority);
    const rest = STEM_IDS.filter(id => !prioritySet.has(id));
    const loadStem = async (id: StemId) => {
      if (this.disposed) return;
      const buffer = await this.decode(id);
      if (!buffer || this.disposed) return;
      this.buffers.set(id, buffer);
      // A stem the playing song wanted but didn't have yet joins it on its grid.
      if (this.deck) this.addStem(this.deck, id, this.ctx.currentTime + 0.05);
    };
    // Fetch the starting room's stems + portal whoosh first so slow connections stay responsive,
    // then trickle the remaining stems one at a time so they don't starve room teleports.
    await Promise.allSettled([
      ...priority.map(loadStem),
      this.decode('portal-whoosh').then(b => { if (b) this.whoosh = b; }),
    ]);
    for (const id of rest) {
      if (this.disposed) return;
      await loadStem(id).catch(() => {});
    }
  }

  /** Call from a user gesture: browsers only let audio start after one. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.muted && document.visibilityState === 'visible') void this.ctx.resume();
    if (this.currentRoom && !this.deck) this.deck = this.createDeck(this.currentRoom, this.ctx.currentTime + 0.1, false);
    this.applyMasterLevel(2);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch { /* storage unavailable */ }
    if (!muted && this.started && document.visibilityState === 'visible') void this.ctx.resume();
    this.applyMasterLevel(muted ? 0.4 : 1.5);
    if (muted) window.setTimeout(() => { if (this.muted) void this.ctx.suspend(); }, 600);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * The player is now in `roomId`. Call it at the crossing itself: the current song
   * sweeps out and this room's song drops in on the next beat.
   */
  enterRoom(roomId: string): void {
    if (roomId === this.currentRoom) return;
    this.currentRoom = roomId;
    if (!this.started || this.disposed) return;
    const now = this.ctx.currentTime;
    const old = this.deck;
    if (!old) {
      this.deck = this.createDeck(roomId, now + 0.05, false);
      return;
    }
    const drop = nextBeat(now, old.start, MIN_SWEEP_SECONDS);
    this.retire(old, now, drop);
    this.deck = this.createDeck(roomId, drop, true);
  }

  /** Feed the player's state; cheap to call every frame (it updates at ~15 Hz). */
  update(frame: SoundtrackFrame): void {
    if (this.disposed) return;
    if (frame.roomId !== this.currentRoom) this.enterRoom(frame.roomId);
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastFrameAt < 1 / 15) return;
    this.lastFrameAt = now;
    this.moveNorm = frame.moveNorm;

    const deck = this.deck;
    if (deck && now >= deck.start) {
      if (now >= deck.nextPhrase) {
        deck.phrase = phraseMultipliers();
        deck.nextPhrase = nextPhraseStart(now, deck.start);
      }
      const vibe = vibeFor(deck.roomId);
      for (const [id, stem] of deck.stems) {
        stem.gain.gain.setTargetAtTime(this.stemLevel(vibe[id] ?? 0, id, deck.phrase), now, LAYER_TC);
      }
    }

    // Near a portal: the music darkens a little and the hum rises underneath.
    const w = Math.min(1, Math.max(0, frame.warp));
    const cutoff = frame.fallen ? 420 : OPEN_HZ * Math.pow(6000 / OPEN_HZ, w);
    this.musicFilter.frequency.setTargetAtTime(cutoff, now, frame.fallen ? 0.6 : 0.15);
    this.musicBus.gain.setTargetAtTime(frame.fallen ? 0.55 : 1 - 0.1 * w, now, 0.2);
    this.humGain.gain.setTargetAtTime(0.08 * Math.pow(w, 1.6), now, 0.12);
    this.humFilter.frequency.setTargetAtTime(220 + 900 * w * w, now, 0.12);
  }

  /** The cosmic whoosh as the player steps through a portal (or teleports). */
  playPortalWhoosh(): void {
    if (!this.whoosh || this.muted || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // One crossing can be reported twice (promotion, then the room change): play it once.
    if (now - this.lastWhooshAt < 1.2) return;
    this.lastWhooshAt = now;
    // Pitch variations on chord tones of G-sharp minor: as tuned (D-sharp), down to
    // G-sharp, or an octave down.
    const rates = [1, 1, 0.667, 0.5];
    const rate = rates[Math.floor(Math.random() * rates.length)];
    // Start partway into the swell so the bloom lands around the drop.
    const offset = Math.max(0, WHOOSH_PEAK - 0.45 * rate);
    const src = ctx.createBufferSource();
    src.buffer = this.whoosh;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.42, now + 0.08);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.4;
    src.connect(gain).connect(pan);
    pan.connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.3;
    pan.connect(send).connect(this.reverb);
    src.start(now, offset);
    src.onended = () => { src.disconnect(); gain.disconnect(); pan.disconnect(); send.disconnect(); };
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx.close();
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') void this.ctx.suspend();
    else if (this.started && !this.muted) void this.ctx.resume();
  };

  private stemLevel(vibeLevel: number, id: StemId, phrase: Record<StemId, number>): number {
    return vibeLevel * phrase[id] * motionMultiplier(STEM_ROLES[id], this.moveNorm);
  }

  /** A room's song, starting from the top at `when`; `sweptIn` opens its filter from closed. */
  private createDeck(roomId: string, when: number, sweptIn: boolean): Deck {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.9;
    const out = ctx.createGain();
    filter.connect(out).connect(this.musicBus);
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.setValueAtTime(0, when);
    if (sweptIn) {
      filter.frequency.setValueAtTime(SWEPT_HZ, ctx.currentTime);
      filter.frequency.setValueAtTime(SWEPT_HZ, when);
      filter.frequency.exponentialRampToValueAtTime(OPEN_HZ, when + OPEN_SECONDS);
      out.gain.linearRampToValueAtTime(1, when + 0.03);
    } else {
      filter.frequency.value = OPEN_HZ;
      out.gain.linearRampToValueAtTime(1, when + 1.5);
    }
    // The drop plays every layer of the song; phrase variation starts with the next phrase.
    const phrase = Object.fromEntries(STEM_IDS.map(id => [id, 1])) as Record<StemId, number>;
    const deck: Deck = { roomId, start: when, out, filter, stems: new Map(), phrase, nextPhrase: nextPhraseStart(when, when) };
    for (const id of stemsFor(vibeFor(roomId))) this.addStem(deck, id, when);
    return deck;
  }

  /** Start one of a song's stems at `when`, on the song's grid. */
  private addStem(deck: Deck, id: StemId, when: number): void {
    const level = vibeFor(deck.roomId)[id] ?? 0;
    const buffer = this.buffers.get(id);
    if (!buffer || level <= 0 || deck.stems.has(id)) return;
    const at = Math.max(when, deck.start);
    const late = at > deck.start;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.min(LOOP_SECONDS, buffer.duration);
    const gain = this.ctx.createGain();
    const target = this.stemLevel(level, id, deck.phrase);
    gain.gain.setValueAtTime(late ? 0 : target, this.ctx.currentTime);
    // A stem that finished loading after its song started fades in over a bar.
    if (late) {
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(target, at + BAR_SECONDS);
    }
    source.connect(gain).connect(deck.filter);
    source.start(at, loopOffset(at, deck.start, source.loopEnd));
    deck.stems.set(id, { gain, source });
  }

  /** Sweep a song out by `drop`, then stop and free it. */
  private retire(deck: Deck, now: number, drop: number): void {
    const f = deck.filter.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(Math.max(SWEPT_HZ, Math.min(OPEN_HZ, f.value)), now);
    f.exponentialRampToValueAtTime(SWEPT_HZ, drop);
    const g = deck.out.gain;
    const level = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(level, now);
    g.setValueAtTime(level, Math.max(now, drop - 0.06));
    g.linearRampToValueAtTime(0, drop + 0.04);
    for (const stem of deck.stems.values()) stem.source.stop(Math.max(drop + 0.1, deck.start + 0.01));
    window.setTimeout(() => { deck.filter.disconnect(); deck.out.disconnect(); }, (drop - now + 0.5) * 1000);
  }

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
      const a = 0.12 + 0.6 * t;
      lp += (Math.random() * 2 - 1 - lp) * (1 - a);
      data[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
    }
  }
  return buffer;
}
