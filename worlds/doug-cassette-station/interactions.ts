import * as THREE from 'three/webgpu';
import { seededRandom } from '@portalverse/core/rooms/kit';
import {
  CASSETTE_SPOTS,
  CAT_BENCH_POS,
  CRT_NOOK_POS,
  PHONE_BOOTH_POS,
  SYNTH_PADS,
  VENDING_ROW_POS,
  stationHeight,
} from './terrain';
import { createHoloKoiMaterial, type WetPromenadeHandle } from './shaders';
import type { ResourceBag, SceneryResult } from './scenery';

// ---------------------------------------------------------------------------
// Pure testable interaction state helpers
// ---------------------------------------------------------------------------

export interface CassetteState {
  id: string;
  title: string;
  spot: string;
  x: number;
  y: number;
  z: number;
  color: string;
  found: boolean;
  pulse: number;
}

export const CASSETTE_TRIGGER_RADIUS = 1.8;

/** Checks if the player discovers a hidden nostalgic cassette tape. */
export function stepCassette(
  c: CassetteState,
  player: { x: number; y: number; z: number } | null,
  dt: number,
): boolean {
  let newlyFound = false;
  if (!c.found && player) {
    const dist = Math.hypot(player.x - c.x, player.z - c.z);
    if (dist < CASSETTE_TRIGGER_RADIUS && Math.abs(player.y - c.y) < 1.9) {
      c.found = true;
      c.pulse = 1.0;
      newlyFound = true;
    }
  }
  if (c.found) {
    c.pulse = Math.max(0.45, c.pulse - dt * 0.25);
  }
  return newlyFound;
}

export interface SynthPadState {
  x: number;
  z: number;
  freq: number;
  glow: number;
  cooldown: number;
}

/** Triggers a recessed neon glass synth tile when the player steps across it. */
export function stepSynthPad(
  pad: SynthPadState,
  player: { x: number; y: number; z: number } | null,
  dt: number,
): boolean {
  pad.cooldown = Math.max(0, pad.cooldown - dt);
  pad.glow = Math.max(0, pad.glow - dt * 0.85);
  if (player && pad.cooldown <= 0 && player.y < 0.75) {
    const d = Math.hypot(player.x - pad.x, player.z - pad.z);
    if (d < 1.15) {
      pad.glow = 1.0;
      pad.cooldown = 1.05;
      return true;
    }
  }
  return false;
}

export interface CrtChannelState {
  channel: number;
  channelCount: number;
  cooldown: number;
}

/** Cycles the retro CRT television channel when the player approaches the CRT shrine. */
export function stepCrtChannel(
  state: CrtChannelState,
  player: { x: number; y: number; z: number } | null,
  dt: number,
): boolean {
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (player && state.cooldown <= 0) {
    const d = Math.hypot(player.x - CRT_NOOK_POS.x, player.z - CRT_NOOK_POS.z);
    if (d < 2.65) {
      state.channel = (state.channel + 1) % state.channelCount;
      state.cooldown = 3.2;
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Calming procedural Web Audio lo-fi rain & Rhodes/chime synth (active-only!)
// Tuned to Portalverse's B major / G# minor soundtrack key!
// ---------------------------------------------------------------------------

interface StationAudio {
  playRhodesNote: (freq: number, volume?: number) => void;
  playVendingJingle: () => void;
  playPhoneMelody: () => void;
  playCrtClick: () => void;
  playCatPurrChime: () => void;
  playCassetteFanfare: () => void;
  playPuddleStep: () => void;
  dispose: () => void;
}

function createStationAudio(): StationAudio {
  let ctx: AudioContext | null = null;
  let rainSource: AudioBufferSourceNode | null = null;
  let rainGain: GainNode | null = null;
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
    // Start a super-gentle, deeply calming pink-filtered rain bed once audio unlocks
    if (ctx.state === 'running' && !rainSource) {
      try {
        const len = ctx.sampleRate * 3;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.997 * b0 + white * 0.029;
          b1 = 0.985 * b1 + white * 0.032;
          b2 = 0.95 * b2 + white * 0.048;
          data[i] = (b0 + b1 + b2 + white * 0.015) * 0.45;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1150;
        filter.Q.value = 0.55;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.026, ctx.currentTime + 1.4);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        rainSource = src;
        rainGain = gain;
      } catch {
        // Ignore audio setup errors in constrained environments
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

  const playTone = (freq: number, duration: number, volume: number, type: OscillatorType = 'sine', delay = 0) => {
    const audio = ensureContext();
    if (!audio) return;
    const now = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + 0.04);
  };

  return {
    playRhodesNote(freq: number, volume = 0.075) {
      playTone(freq, 1.5, volume, 'sine', 0);
      playTone(freq * 2, 0.5, volume * 0.22, 'triangle', 0.005);
      playTone(freq * 0.5, 1.3, volume * 0.35, 'sine', 0);
    },
    playVendingJingle() {
      playTone(622.25, 0.25, 0.045, 'triangle', 0);
      playTone(739.99, 0.25, 0.045, 'triangle', 0.09);
      playTone(987.77, 0.55, 0.05, 'sine', 0.18);
    },
    playPhoneMelody() {
      // Soft dreamy lo-fi payphone chime in B major
      playTone(830.61, 0.5, 0.042, 'sine', 0);
      playTone(739.99, 0.5, 0.04, 'sine', 0.16);
      playTone(622.25, 0.6, 0.042, 'sine', 0.32);
      playTone(987.77, 0.9, 0.045, 'sine', 0.48);
    },
    playCrtClick() {
      playTone(185, 0.08, 0.05, 'square', 0);
      playTone(1244.5, 0.22, 0.028, 'sine', 0.04);
    },
    playCatPurrChime() {
      playTone(493.88, 0.7, 0.045, 'sine', 0);
      playTone(622.25, 0.85, 0.042, 'sine', 0.12);
    },
    playCassetteFanfare() {
      playTone(493.88, 1.1, 0.055, 'sine', 0);
      playTone(622.25, 1.1, 0.05, 'sine', 0.09);
      playTone(739.99, 1.2, 0.05, 'sine', 0.18);
      playTone(987.77, 1.45, 0.055, 'triangle', 0.27);
    },
    playPuddleStep() {
      playTone(370, 0.16, 0.025, 'sine', 0);
      playTone(554.37, 0.22, 0.018, 'sine', 0.04);
    },
    dispose() {
      disposed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
      if (rainGain && ctx) {
        try {
          rainGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        } catch {
          // ignore
        }
      }
      if (rainSource) {
        try {
          rainSource.stop();
        } catch {
          // ignore
        }
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
// Unobtrusive lo-fi glassmorphic discovery toast (active room only)
// ---------------------------------------------------------------------------

interface StationToast {
  show: (text: string) => void;
  dispose: () => void;
}

function createStationToast(): StationToast {
  if (typeof document === 'undefined') return { show() {}, dispose() {} };
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '84px',
    transform: 'translateX(-50%) translateY(10px)',
    padding: '10px 18px',
    borderRadius: '999px',
    background: 'rgba(13, 18, 36, 0.78)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(94, 234, 212, 0.45)',
    color: '#f0fdfa',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    fontWeight: '500',
    letterSpacing: '0.02em',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.35)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 320ms ease, transform 320ms ease',
    zIndex: '45',
  });
  document.body.appendChild(el);

  let timer: number | null = null;
  return {
    show(text: string) {
      el.textContent = text;
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(10px)';
        timer = null;
      }, 3600);
    },
    dispose() {
      if (timer !== null) window.clearTimeout(timer);
      el.remove();
    },
  };
}

export interface StationInteractionsHandle {
  update: (dt: number, elapsed: number, playerPos: THREE.Vector3 | null) => void;
  activate: () => () => void;
}

export function buildStationInteractions(
  root: THREE.Group,
  res: ResourceBag,
  scenery: SceneryResult,
  promenade: WetPromenadeHandle,
): StationInteractionsHandle {
  const rand = seededRandom(88420);
  const dummy = new THREE.Object3D();
  let audio: StationAudio | null = null;
  let toast: StationToast | null = null;

  // -------------------------------------------------------------------------
  // 1. 9 Floating Holographic Koi Fish swimming through the misty air overhead!
  // -------------------------------------------------------------------------
  interface HoloKoi {
    group: THREE.Group;
    centerX: number;
    centerZ: number;
    baseY: number;
    rx: number;
    rz: number;
    speed: number;
    phase: number;
    dir: number;
  }
  const kois: HoloKoi[] = [];
  const koiColors = ['#22d3ee', '#fb923c', '#f472b6', '#5eead4', '#fde047'];

  // Sculpted stylized koi geometry (body + dorsal + fanned tail along -Z..+Z)
  const koiBodyGeo = res.geo(new THREE.SphereGeometry(0.24, 12, 10));
  koiBodyGeo.scale(0.65, 0.85, 2.3);
  const koiTailGeo = res.geo(new THREE.ConeGeometry(0.32, 0.62, 5));
  koiTailGeo.rotateX(Math.PI / 2);
  koiTailGeo.scale(0.22, 1.1, 1);
  koiTailGeo.translate(0, 0, -0.68);
  const koiFinGeo = res.geo(new THREE.PlaneGeometry(0.42, 0.24));
  koiFinGeo.rotateX(-Math.PI / 2);

  for (let i = 0; i < 9; i++) {
    const mat = res.mat(createHoloKoiMaterial(koiColors[i % koiColors.length], i * 1.1));
    const kg = new THREE.Group();
    const body = new THREE.Mesh(koiBodyGeo, mat);
    const tail = new THREE.Mesh(koiTailGeo, mat);
    const finL = new THREE.Mesh(koiFinGeo, mat);
    finL.position.set(-0.24, -0.04, 0.08);
    finL.rotation.z = 0.28;
    const finR = new THREE.Mesh(koiFinGeo, mat);
    finR.position.set(0.24, -0.04, 0.08);
    finR.rotation.z = -0.28;
    kg.add(body, tail, finL, finR);
    const sc = 0.82 + rand() * 0.55;
    kg.scale.setScalar(sc);
    root.add(kg);

    kois.push({
      group: kg,
      centerX: (rand() - 0.5) * 6,
      centerZ: -18 + i * 4.5,
      baseY: 3.4 + rand() * 3.4,
      rx: 4.5 + rand() * 4.5,
      rz: 5.5 + rand() * 6.5,
      speed: 0.22 + rand() * 0.18,
      phase: rand() * Math.PI * 2,
      dir: i % 2 === 0 ? 1 : -1,
    });
  }

  // -------------------------------------------------------------------------
  // 2. 1,600 Calming Diagonal Twilight Raindrops + Floating Warm Fireflies
  // -------------------------------------------------------------------------
  const RAIN_COUNT = 1600;
  const rainGeo = res.geo(new THREE.CylinderGeometry(0.008, 0.008, 0.62, 4));
  const rainMat = res.mat(new THREE.MeshBasicMaterial({
    color: '#bae6fd',
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
  rainMesh.frustumCulled = false;
  const rainData = Array.from({ length: RAIN_COUNT }, () => ({
    x: (rand() - 0.5) * 44,
    y: rand() * 14,
    z: (rand() - 0.5) * 68,
    speed: 7.5 + rand() * 3.2,
  }));
  root.add(rainMesh);

  // Floating twilight bokeh / moss firefly motes drifting slowly above the wet puddles
  const MOTE_COUNT = 110;
  const moteGeo = res.geo(new THREE.OctahedronGeometry(0.055, 0));
  const moteMat = res.mat(new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const motes = new THREE.InstancedMesh(moteGeo, moteMat, MOTE_COUNT);
  motes.frustumCulled = false;
  const moteColors = ['#5eead4', '#fde047', '#f472b6', '#38bdf8'];
  const moteData = Array.from({ length: MOTE_COUNT }, (_, i) => {
    motes.setColorAt(i, new THREE.Color(moteColors[i % moteColors.length]));
    return {
      x: (rand() - 0.5) * 24,
      y: 0.4 + rand() * 5.2,
      z: (rand() - 0.5) * 56,
      phase: rand() * Math.PI * 2,
      speed: 0.35 + rand() * 0.45,
    };
  });
  if (motes.instanceColor) motes.instanceColor.needsUpdate = true;
  root.add(motes);

  // -------------------------------------------------------------------------
  // 3. Five Recessed Neon Glass Lo-Fi Synth Pads along the Promenade
  // -------------------------------------------------------------------------
  interface PadVisual {
    state: SynthPadState;
    padMat: THREE.MeshStandardMaterial;
    beam: THREE.Mesh;
    beamMat: THREE.MeshBasicMaterial;
  }
  const padVisuals: PadVisual[] = [];
  const padGeo = res.geo(new THREE.BoxGeometry(1.5, 0.05, 1.5));
  const beamGeo = res.geo(new THREE.CylinderGeometry(0.68, 0.76, 3.2, 16, 1, true));

  for (const s of SYNTH_PADS) {
    const padMat = res.mat(new THREE.MeshStandardMaterial({
      color: s.color,
      emissive: s.color,
      emissiveIntensity: 0.38,
      roughness: 0.2,
      metalness: 0.15,
    }));
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(s.x, 0.025, s.z);
    const beamMat = res.mat(new THREE.MeshBasicMaterial({
      color: s.color,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(s.x, 1.65, s.z);
    root.add(pad, beam);
    padVisuals.push({
      state: { x: s.x, z: s.z, freq: s.freq, glow: 0, cooldown: 0 },
      padMat,
      beam,
      beamMat,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Five Nostalgic Glowing Cassette Collectibles hidden around the station
  // -------------------------------------------------------------------------
  const cassettes: CassetteState[] = CASSETTE_SPOTS.map(c => ({
    ...c,
    y: stationHeight(c.x, c.z) + 0.95,
    found: false,
    pulse: 0,
  }));
  const cassBodyGeo = res.geo(new THREE.BoxGeometry(0.46, 0.28, 0.07));
  const cassReelGeo = res.geo(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 10).rotateX(Math.PI / 2));
  const cassHaloGeo = res.geo(new THREE.RingGeometry(0.3, 0.38, 20).rotateX(-Math.PI / 2));
  const cassVisuals: Array<{ group: THREE.Group; mat: THREE.MeshStandardMaterial; halo: THREE.Mesh }> = [];

  for (const c of cassettes) {
    const g = new THREE.Group();
    g.position.set(c.x, c.y, c.z);
    const mat = res.mat(new THREE.MeshStandardMaterial({
      color: c.color,
      emissive: c.color,
      emissiveIntensity: 0.85,
      roughness: 0.25,
    }));
    const body = new THREE.Mesh(cassBodyGeo, mat);
    const rL = new THREE.Mesh(cassReelGeo, res.mat(new THREE.MeshBasicMaterial({ color: '#0f172a' })));
    rL.position.set(-0.11, 0, 0);
    const rR = new THREE.Mesh(cassReelGeo, res.mat(new THREE.MeshBasicMaterial({ color: '#0f172a' })));
    rR.position.set(0.11, 0, 0);
    const halo = new THREE.Mesh(
      cassHaloGeo,
      res.mat(new THREE.MeshBasicMaterial({
        color: c.color,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })),
    );
    halo.position.y = -0.78;
    g.add(body, rL, rR, halo);
    root.add(g);
    cassVisuals.push({ group: g, mat, halo });
  }

  // Interactive states for vending row, CRT shrine, payphone, sleeping cat, and puddle footsteps
  const crtState: CrtChannelState = { channel: 0, channelCount: scenery.crtTextures.length, cooldown: 0 };
  let vendingCooldown = 0;
  let vendingGlowTimer = 0;
  let phoneCooldown = 0;
  let phonePulse = 0;
  let catCooldown = 0;
  let catHappy = 0;
  let prevStepX = 0;
  let prevStepZ = 0;
  let stepAccum = 0;

  const update = (dt: number, elapsed: number, playerPos: THREE.Vector3 | null) => {
    const safeDt = Math.min(dt, 0.1);

    // Update wet puddle player glow & expanding puddle step ripples
    promenade.uRippleAge.value = Math.min(10, promenade.uRippleAge.value + safeDt);
    if (playerPos) {
      promenade.uPlayerPos.value.copy(playerPos);
      const moved = Math.hypot(playerPos.x - prevStepX, playerPos.z - prevStepZ);
      prevStepX = playerPos.x;
      prevStepZ = playerPos.z;
      if (playerPos.y < 0.25) {
        stepAccum += moved;
        if (stepAccum > 2.35) {
          stepAccum = 0;
          promenade.uRippleOrigin.value.set(playerPos.x, playerPos.z);
          promenade.uRippleAge.value = 0;
          audio?.playPuddleStep();
        }
      }
    } else {
      promenade.uPlayerPos.value.set(0, -100, 0);
    }

    // 1. Spin giant cassette arch reels, sway paper lanterns & noren curtains, animate steam & monorail
    for (const reel of scenery.cassetteReels) {
      reel.rotation.z -= safeDt * 0.9;
    }
    for (const l of scenery.lanternPivots) {
      l.pivot.rotation.z = Math.sin(elapsed * 1.4 + l.phase) * 0.08;
      l.pivot.rotation.x = Math.cos(elapsed * 1.1 + l.phase) * 0.04;
    }
    for (const n of scenery.norenCurtains) {
      n.mesh.rotation.z = Math.sin(elapsed * 1.8 + n.phase) * 0.07;
    }
    for (const sp of scenery.steamPuffs) {
      const cycle = (elapsed * 0.48 + sp.phase) % 1;
      sp.mesh.position.set(
        sp.baseX + Math.sin(elapsed * 1.7 + sp.phase) * 0.05,
        sp.baseY + cycle * 0.58,
        sp.baseZ + Math.cos(elapsed * 1.4 + sp.phase) * 0.04,
      );
      sp.mesh.scale.setScalar(0.45 + Math.sin(cycle * Math.PI) * 0.95);
    }

    // Silent elevated twilight commuter train gliding across the skyline every ~24s
    const trainCycle = (elapsed * 0.045) % 1;
    scenery.monorailTrain.position.x = -75 + trainCycle * 150;

    // 2. Swim holographic koi overhead in graceful looping curves
    for (const k of kois) {
      const a = elapsed * k.speed * k.dir + k.phase;
      const x = k.centerX + Math.cos(a) * k.rx;
      const z = k.centerZ + Math.sin(a) * k.rz;
      const y = k.baseY + Math.sin(a * 2.0 + k.phase) * 0.55;
      const vx = -Math.sin(a) * k.rx * k.dir;
      const vz = Math.cos(a) * k.rz * k.dir;
      k.group.position.set(x, y, z);
      k.group.rotation.y = Math.atan2(vx, vz);
      k.group.rotation.z = Math.sin(a) * 0.14;
    }

    // 3. Gentle diagonal twilight rain + drifting firefly bokeh motes
    for (let i = 0; i < RAIN_COUNT; i++) {
      const r = rainData[i];
      r.y -= r.speed * safeDt;
      r.x += 0.95 * safeDt;
      if (r.y < 0.1) {
        r.y = 12.5 + rand() * 2.0;
        r.x = (rand() - 0.5) * 44;
      }
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(0, 0, -0.1);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      rainMesh.setMatrixAt(i, dummy.matrix);
    }
    rainMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = moteData[i];
      const mx = m.x + Math.sin(elapsed * m.speed + m.phase) * 0.7;
      const my = m.y + Math.cos(elapsed * m.speed * 0.8 + m.phase) * 0.35;
      const mz = m.z + Math.cos(elapsed * m.speed * 0.6 + m.phase) * 0.6;
      const pulse = 0.65 + Math.sin(elapsed * 2.8 + m.phase) * 0.35;
      dummy.position.set(mx, my, mz);
      dummy.rotation.set(elapsed + m.phase, elapsed * 0.7, 0);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      motes.setMatrixAt(i, dummy.matrix);
    }
    motes.instanceMatrix.needsUpdate = true;

    // 4. Recessed Neon Lo-Fi Synth Pads
    for (const pv of padVisuals) {
      const hit = stepSynthPad(pv.state, playerPos, safeDt);
      if (hit) {
        audio?.playRhodesNote(pv.state.freq);
        promenade.uRippleOrigin.value.set(pv.state.x, pv.state.z);
        promenade.uRippleAge.value = 0;
      }
      pv.padMat.emissiveIntensity = 0.38 + pv.state.glow * 2.4;
      pv.beamMat.opacity = pv.state.glow * 0.34;
      pv.beam.scale.set(1 + (1 - pv.state.glow) * 0.25, 0.3 + pv.state.glow * 0.9, 1 + (1 - pv.state.glow) * 0.25);
    }

    // 5. Hidden Cassette Collectibles
    const foundNow = cassettes.filter(c => c.found).length;
    cassettes.forEach((c, idx) => {
      const newly = stepCassette(c, playerPos, safeDt);
      if (newly) {
        const count = foundNow + 1;
        audio?.playCassetteFanfare();
        toast?.show(
          count === cassettes.length
            ? `All ${cassettes.length} Midnight Mixtapes collected — side B complete!`
            : `Found Mixtape (${count}/${cassettes.length}): ${c.title}`,
        );
      }
      const vis = cassVisuals[idx];
      vis.group.rotation.y = elapsed * (c.found ? 1.8 : 0.75) + idx;
      vis.group.position.y = c.y + Math.sin(elapsed * 2.1 + idx) * 0.1 + (c.found ? 0.25 : 0);
      vis.mat.emissiveIntensity = 0.8 + Math.sin(elapsed * 3.0 + idx) * 0.2 + c.pulse * 1.4;
      vis.halo.scale.setScalar(c.found ? 1.45 + Math.sin(elapsed * 3.5) * 0.15 : 1.0);
    });

    // 6. Interactive Landmarks: Vending Row, CRT Channel Switch, Red Payphone, Sleeping Cat!
    vendingCooldown = Math.max(0, vendingCooldown - safeDt);
    vendingGlowTimer = Math.max(0, vendingGlowTimer - safeDt);
    if (playerPos && vendingCooldown <= 0) {
      const dv = Math.hypot(playerPos.x - VENDING_ROW_POS.x, playerPos.z - VENDING_ROW_POS.z);
      if (dv < 2.85) {
        vendingCooldown = 5.0;
        vendingGlowTimer = 4.2;
        audio?.playVendingJingle();
        toast?.show('Vending machine chimes — warm matcha & peach fizz dispensed!');
      }
    }
    scenery.vendingDrinkHolos.forEach((holo, i) => {
      holo.visible = vendingGlowTimer > 0;
      if (holo.visible) {
        holo.rotation.y = elapsed * 2.2 + i;
        holo.position.y = 0.95 + Math.sin(elapsed * 3.5 + i) * 0.08;
      }
    });

    if (stepCrtChannel(crtState, playerPos, safeDt)) {
      const mat = scenery.mainCrtScreen.material as THREE.MeshBasicMaterial;
      mat.map = scenery.crtTextures[crtState.channel];
      mat.needsUpdate = true;
      audio?.playCrtClick();
      toast?.show(`CRT Shrine tuned to Channel 0${crtState.channel + 1}`);
    }

    phoneCooldown = Math.max(0, phoneCooldown - safeDt);
    phonePulse = Math.max(0, phonePulse - safeDt * 0.55);
    if (playerPos && phoneCooldown <= 0) {
      const dp = Math.hypot(playerPos.x - PHONE_BOOTH_POS.x, playerPos.z - PHONE_BOOTH_POS.z);
      if (dp < 2.35) {
        phoneCooldown = 6.0;
        phonePulse = 1.0;
        audio?.playPhoneMelody();
        toast?.show('The rainy payphone hums a soft midnight melody...');
      }
    }
    scenery.phoneRingMesh.scale.setScalar(1.0 + phonePulse * 0.75 + Math.sin(elapsed * 2.0) * 0.05);
    (scenery.phoneRingMesh.material as THREE.MeshBasicMaterial).opacity = 0.24 + phonePulse * 0.55;

    catCooldown = Math.max(0, catCooldown - safeDt);
    catHappy = Math.max(0, catHappy - safeDt * 0.5);
    if (playerPos && catCooldown <= 0) {
      const dc = Math.hypot(playerPos.x - CAT_BENCH_POS.x, playerPos.z - CAT_BENCH_POS.z);
      if (dc < 2.45) {
        catCooldown = 6.5;
        catHappy = 1.0;
        audio?.playCatPurrChime();
        toast?.show('The station calico purrs softly under the lantern light');
      }
    }
    // Gentle sleeping breathing + happy tail sway
    scenery.catGroup.scale.set(1, 1 + Math.sin(elapsed * 2.2) * 0.04 + catHappy * 0.08, 1);
    scenery.catTail.rotation.y = 0.4 + Math.sin(elapsed * (2.0 + catHappy * 5.0)) * (0.16 + catHappy * 0.28);
    (scenery.catHalo.material as THREE.MeshBasicMaterial).opacity = catHappy * 0.65;
  };

  const activate = () => {
    audio = createStationAudio();
    toast = createStationToast();
    return () => {
      audio?.dispose();
      audio = null;
      toast?.dispose();
      toast = null;
    };
  };

  return { update, activate };
}
