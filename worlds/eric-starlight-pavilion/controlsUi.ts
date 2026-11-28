import {
  DANCE_BPS,
  DANCER_CONFIGS,
  type DancePerformer,
  type DanceStyle,
  type DancerId,
  type DancerMotionInput,
  type FlourishKind,
} from './dancers';

export interface DanceControllerCallbacks {
  getDancers: () => readonly DancePerformer[];
  getSelectedId: () => DancerId | null;
  getStyle: () => DanceStyle;
  getCombo: () => number;
  isOverdrive: () => boolean;
  onSelectDancer: (id: DancerId | null) => void;
  onFlourish: (kind: FlourishKind, isPerfectBeat: boolean) => void;
  onCastSpell: (slot: 1 | 2) => void;
  onCycleStyle: () => void;
  onTapWorld: (clientX: number, clientY: number) => void;
}

const STYLE_LABELS: Record<DanceStyle, string> = {
  waltz: 'Celestial Waltz',
  hypergroove: 'Neon Hypergroove',
  celestial: 'Frost Crystal Rave',
};

const SWIPE_MIN_DIST_PX = 44;
const SWIPE_MAX_MS = 380;

/**
 * Unified Phone-Swipe + Mouse/Trackpad-Swipe + Keyboard Dance Controller & Stage HUD.
 * Mounts its DOM cleanly inside `ctx.onActivate` and removes all DOM/listeners on deactivate.
 */
export class StarlightDanceUi {
  private readonly callbacks: DanceControllerCallbacks;
  private readonly hostEl: HTMLDivElement;
  private readonly gesturePad: HTMLDivElement;
  private readonly dragDot: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly comboValEl: HTMLSpanElement;
  private readonly styleLabelEl: HTMLSpanElement;
  private readonly beatRingEl: HTMLDivElement;
  private readonly controlBarEl: HTMLDivElement;
  private readonly spellBtn1: HTMLButtonElement;
  private readonly spellBtn2: HTMLButtonElement;
  private readonly spell1Fill: HTMLDivElement;
  private readonly spell2Fill: HTMLDivElement;
  private readonly spell1Name: HTMLSpanElement;
  private readonly spell2Name: HTMLSpanElement;
  private readonly btnWalkFree: HTMLButtonElement;
  private readonly btnStyle: HTMLButtonElement;
  private readonly hintLineEl: HTMLDivElement;
  private readonly dancerBtns = new Map<DancerId, HTMLButtonElement>();
  private readonly styleEl: HTMLStyleElement;

  // Input state
  private readonly keys = new Set<string>();
  private cameraOrbitYaw = 0;
  private cameraOrbitPitch = 0.28;
  private cameraOrbitDist = 7.4;

  // Pointer / touch gesture tracking
  private activePointers = new Map<number, { x: number; y: number; startX: number; startY: number; startTime: number }>();
  private primaryPointerId: number | null = null;
  private dragMoveX = 0;
  private dragMoveZ = 0;
  private swirlEnergy = 0;
  private lastDragAngle: number | null = null;
  private angularAccum = 0;
  private lastWheelFlourishAt = 0;
  private wheelAccumX = 0;
  private wheelAccumY = 0;
  private rightOrbiting = false;
  private lastOrbitX = 0;
  private lastOrbitY = 0;
  private bannerTimer = 0;
  private disposed = false;

  constructor(callbacks: DanceControllerCallbacks) {
    this.callbacks = callbacks;

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = STARLIGHT_HUD_CSS;
    document.head.appendChild(this.styleEl);

    this.hostEl = document.createElement('div');
    this.hostEl.className = 'slp-hud';

    // Full-screen transparent gesture capture layer (active ONLY while controlling a dancer!)
    this.gesturePad = document.createElement('div');
    this.gesturePad.className = 'slp-gesture-pad hidden';
    this.dragDot = document.createElement('div');
    this.dragDot.className = 'slp-drag-dot hidden';
    this.gesturePad.appendChild(this.dragDot);

    // Celebratory floating move/spell/overdrive banner
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'slp-banner hidden';

    // Top-center stage status pill (Groove style + live 88 BPM beat ring + Combo)
    const topBar = document.createElement('div');
    topBar.className = 'slp-top-pill';

    this.beatRingEl = document.createElement('div');
    this.beatRingEl.className = 'slp-beat-ring';
    this.beatRingEl.title = '88 BPM Beat Pulse — tap Space on the glow for a Perfect Beat!';

    this.btnStyle = document.createElement('button');
    this.btnStyle.type = 'button';
    this.btnStyle.className = 'slp-style-btn';
    this.btnStyle.title = 'Switch Dance Groove & Light Show (G)';
    this.styleLabelEl = document.createElement('span');
    this.styleLabelEl.textContent = STYLE_LABELS.waltz;
    this.btnStyle.append('♪ ', this.styleLabelEl);
    this.btnStyle.addEventListener('click', () => this.callbacks.onCycleStyle());

    const comboWrap = document.createElement('div');
    comboWrap.className = 'slp-combo';
    comboWrap.innerHTML = `<span class="slp-combo-lbl">GROOVE</span>`;
    this.comboValEl = document.createElement('span');
    this.comboValEl.className = 'slp-combo-val';
    this.comboValEl.textContent = '×1';
    comboWrap.appendChild(this.comboValEl);

    topBar.append(this.beatRingEl, this.btnStyle, comboWrap);

    // Bottom floating Dance Stage Dock (Dancer Switcher + Spells + Walk Free)
    const dock = document.createElement('div');
    dock.className = 'slp-dock';

    const rosterRow = document.createElement('div');
    rosterRow.className = 'slp-roster';
    DANCER_CONFIGS.forEach((cfg, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slp-dancer-btn';
      btn.style.setProperty('--d-accent', cfg.auraHex);
      btn.innerHTML = `
        <span class="slp-dancer-key">${idx + 1}</span>
        <img class="slp-dancer-img" src="${cfg.portraitUrl}" alt="${cfg.spec.name}" />
        <span class="slp-dancer-meta">
          <span class="slp-dancer-name">${cfg.spec.name.split(' ')[0]}</span>
          <span class="slp-dancer-role">${cfg.roleTag}</span>
        </span>
      `;
      btn.addEventListener('click', () => {
        const cur = this.callbacks.getSelectedId();
        this.callbacks.onSelectDancer(cur === cfg.id ? null : cfg.id);
      });
      rosterRow.appendChild(btn);
      this.dancerBtns.set(cfg.id, btn);
    });

    // Active Takeover Spell & Control Row (hidden until a dancer is selected)
    this.controlBarEl = document.createElement('div');
    this.controlBarEl.className = 'slp-control-row hidden';

    const makeSpellBtn = (slot: 1 | 2, hotkey: string) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slp-spell-btn';
      const fill = document.createElement('div');
      fill.className = 'slp-spell-cd';
      const key = document.createElement('span');
      key.className = 'slp-spell-key';
      key.textContent = hotkey;
      const name = document.createElement('span');
      name.className = 'slp-spell-name';
      name.textContent = `Spell ${slot}`;
      btn.append(fill, key, name);
      btn.addEventListener('click', () => this.callbacks.onCastSpell(slot));
      return { btn, fill, name };
    };

    const s1 = makeSpellBtn(1, 'Q');
    const s2 = makeSpellBtn(2, 'E');
    this.spellBtn1 = s1.btn;
    this.spell1Fill = s1.fill;
    this.spell1Name = s1.name;
    this.spellBtn2 = s2.btn;
    this.spell2Fill = s2.fill;
    this.spell2Name = s2.name;

    const btnSpin = document.createElement('button');
    btnSpin.type = 'button';
    btnSpin.className = 'slp-mini-btn';
    btnSpin.textContent = '↻ Spin';
    btnSpin.addEventListener('click', () => this.callbacks.onFlourish('spin_left', false));

    const btnLeap = document.createElement('button');
    btnLeap.type = 'button';
    btnLeap.className = 'slp-mini-btn';
    btnLeap.textContent = '↑ Leap';
    btnLeap.addEventListener('click', () => this.callbacks.onFlourish('leap', false));

    this.btnWalkFree = document.createElement('button');
    this.btnWalkFree.type = 'button';
    this.btnWalkFree.className = 'slp-exit-btn';
    this.btnWalkFree.textContent = 'Walk Free (Esc)';
    this.btnWalkFree.addEventListener('click', () => this.callbacks.onSelectDancer(null));

    this.controlBarEl.append(this.spellBtn1, this.spellBtn2, btnSpin, btnLeap, this.btnWalkFree);

    this.hintLineEl = document.createElement('div');
    this.hintLineEl.className = 'slp-hint';
    this.hintLineEl.textContent = 'Click or tap Soraya, Dex, or Ermelin (or press 1 / 2 / 3) to take over dancing!';

    dock.append(this.controlBarEl, rosterRow, this.hintLineEl);
    this.hostEl.append(this.gesturePad, this.bannerEl, topBar, dock);
    document.body.appendChild(this.hostEl);

    this.bindEvents();
  }

  getCameraOrbit(): { yaw: number; pitch: number; dist: number } {
    return { yaw: this.cameraOrbitYaw, pitch: this.cameraOrbitPitch, dist: this.cameraOrbitDist };
  }

  /** Compute desired world-space dancer movement from keyboard + phone/mouse drag relative to camera orbit! */
  getMotionInput(): DancerMotionInput {
    let localX = 0;
    let localZ = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) localX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) localX += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) localZ -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) localZ += 1;

    localX += this.dragMoveX;
    localZ += this.dragMoveZ;

    const len = Math.hypot(localX, localZ);
    if (len > 1) {
      localX /= len;
      localZ /= len;
    }

    // Rotate input by current dance camera orbit yaw so "up/W" always moves away from the viewer!
    const cosY = Math.cos(this.cameraOrbitYaw);
    const sinY = Math.sin(this.cameraOrbitYaw);
    const worldX = localX * cosY + localZ * sinY;
    const worldZ = -localX * sinY + localZ * cosY;

    return {
      moveX: worldX,
      moveZ: worldZ,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      swirlIntensity: this.swirlEnergy,
    };
  }

  flashBanner(text: string, colorHex = '#fbbf24'): void {
    this.bannerEl.textContent = text;
    this.bannerEl.style.setProperty('--slp-banner-color', colorHex);
    this.bannerEl.classList.remove('hidden');
    this.bannerEl.classList.remove('pop');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('pop');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.bannerEl.classList.add('hidden');
    }, 1850);
  }

  syncSelection(selectedId: DancerId | null): void {
    const takingOver = selectedId !== null;
    this.gesturePad.classList.toggle('hidden', !takingOver);
    this.controlBarEl.classList.toggle('hidden', !takingOver);
    this.hostEl.classList.toggle('is-controlling', takingOver);

    for (const [id, btn] of this.dancerBtns) {
      btn.classList.toggle('active', id === selectedId);
    }

    if (selectedId) {
      const cfg = DANCER_CONFIGS.find((c) => c.id === selectedId)!;
      this.spell1Name.textContent = cfg.spells[0].name;
      this.spellBtn1.title = `${cfg.spells[0].name}: ${cfg.spells[0].shortDesc}`;
      this.spellBtn1.style.setProperty('--sp-accent', cfg.spells[0].accentHex);

      this.spell2Name.textContent = cfg.spells[1].name;
      this.spellBtn2.title = `${cfg.spells[1].name}: ${cfg.spells[1].shortDesc}`;
      this.spellBtn2.style.setProperty('--sp-accent', cfg.spells[1].accentHex);

      this.hintLineEl.textContent =
        'Swipe / drag screen or use WASD to dance · Swipe ↑ Leap · Swipe ←/→ Spin · Swipe ↓ Bass Drop · Q / E Spells';
      // Release pointer lock cleanly so swipe & tap gestures work smoothly immediately
      if (document.pointerLockElement) {
        try { document.exitPointerLock(); } catch { /* ignore */ }
      }
    } else {
      this.keys.clear();
      this.dragMoveX = 0;
      this.dragMoveZ = 0;
      this.swirlEnergy = 0;
      this.dragDot.classList.add('hidden');
      this.hintLineEl.textContent =
        'Click or tap Soraya, Dex, or Ermelin (or press 1 / 2 / 3) to take over dancing!';
    }

    window.dispatchEvent(new CustomEvent('portalverse:room-capture', { detail: { active: takingOver } }));
  }

  updateHud(dt: number, elapsed: number): void {
    this.swirlEnergy = Math.max(0, this.swirlEnergy - dt * 1.45);
    this.wheelAccumX *= Math.exp(-dt * 7);
    this.wheelAccumY *= Math.exp(-dt * 7);

    // Pulse 88 BPM beat indicator
    const beatFrac = (elapsed * DANCE_BPS) % 1;
    const beatPop = Math.pow(Math.max(0, 1 - Math.abs(beatFrac - 0.5) * 2), 3);
    this.beatRingEl.style.transform = `scale(${(0.88 + beatPop * 0.38).toFixed(3)})`;
    this.beatRingEl.classList.toggle('on-beat', beatFrac < 0.16 || beatFrac > 0.84);

    this.styleLabelEl.textContent = STYLE_LABELS[this.callbacks.getStyle()];
    const combo = this.callbacks.getCombo();
    this.comboValEl.textContent = this.callbacks.isOverdrive() ? `★ ×${combo}` : `×${combo}`;
    this.comboValEl.classList.toggle('overdrive', this.callbacks.isOverdrive());

    const selId = this.callbacks.getSelectedId();
    if (selId) {
      const dancer = this.callbacks.getDancers().find((d) => d.config.id === selId);
      if (dancer) {
        const cd1 = dancer.spellCooldowns[0] / dancer.config.spells[0].cooldownSec;
        const cd2 = dancer.spellCooldowns[1] / dancer.config.spells[1].cooldownSec;
        this.spell1Fill.style.transform = `scaleX(${Math.max(0, Math.min(1, cd1)).toFixed(3)})`;
        this.spell2Fill.style.transform = `scaleX(${Math.max(0, Math.min(1, cd2)).toFixed(3)})`;
        this.spellBtn1.disabled = cd1 > 0.02;
        this.spellBtn2.disabled = cd2 > 0.02;
      }
    }
  }

  private isOnBeat(elapsedSec: number): boolean {
    const frac = (elapsedSec * DANCE_BPS) % 1;
    return frac < 0.22 || frac > 0.78;
  }

  private shouldIgnoreKey(e: KeyboardEvent): boolean {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLSelectElement
    ) {
      return true;
    }
    // Never steal keys when Portalverse dialogue or a modal is open
    const dlg = document.getElementById('dialogue-overlay');
    if (dlg && !dlg.classList.contains('hidden')) return true;
    if (document.querySelector('.modal-backdrop:not(.hidden)')) return true;
    return false;
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (this.disposed || this.shouldIgnoreKey(e)) return;
    const sel = this.callbacks.getSelectedId();

    // Hot-select dancer 1 / 2 / 3 anytime in the pavilion (when no modal/dialogue open)
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'Digit1') {
        e.preventDefault();
        this.callbacks.onSelectDancer('soraya');
        return;
      }
      if (e.code === 'Digit2') {
        e.preventDefault();
        this.callbacks.onSelectDancer('dex');
        return;
      }
      if (e.code === 'Digit3') {
        e.preventDefault();
        this.callbacks.onSelectDancer('ermelin');
        return;
      }
    }

    if (!sel) return;

    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onSelectDancer(null);
      return;
    }

    this.keys.add(e.code);

    if (e.repeat) return;

    if (e.code === 'KeyQ' || e.code === 'KeyZ') {
      e.preventDefault();
      this.callbacks.onCastSpell(1);
    } else if (e.code === 'KeyE' || e.code === 'KeyX') {
      e.preventDefault();
      this.callbacks.onCastSpell(2);
    } else if (e.code === 'KeyG') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onCycleStyle();
    } else if (e.code === 'Space') {
      e.preventDefault();
      const perfect = this.isOnBeat(performance.now() / 1000);
      this.callbacks.onFlourish('leap', perfect);
    } else if (e.code === 'KeyF') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onFlourish('spin_left', this.isOnBeat(performance.now() / 1000));
    } else if (e.code === 'KeyC') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onFlourish('drop', this.isOnBeat(performance.now() / 1000));
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  // Click on 3D viewport when NOT yet controlling a dancer to pick a dancer or tap an interactive prop
  private readonly handleViewportClick = (e: MouseEvent): void => {
    if (this.disposed || this.callbacks.getSelectedId() !== null) return;
    if (document.pointerLockElement) return;
    const target = e.target as HTMLElement | null;
    if (!target || target.closest('.slp-hud, #hud, .modal-backdrop, #dialogue-overlay')) return;
    this.callbacks.onTapWorld(e.clientX, e.clientY);
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (this.disposed || this.callbacks.getSelectedId() === null) return;
    e.preventDefault();
    this.gesturePad.setPointerCapture?.(e.pointerId);

    // Right mouse button (or Alt+drag) orbits the dance camera smoothly
    if (e.button === 2 || e.altKey) {
      this.rightOrbiting = true;
      this.lastOrbitX = e.clientX;
      this.lastOrbitY = e.clientY;
      return;
    }

    this.activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
    });

    if (this.activePointers.size === 1) {
      this.primaryPointerId = e.pointerId;
      this.lastDragAngle = null;
      this.angularAccum = 0;
      this.dragDot.style.left = `${e.clientX}px`;
      this.dragDot.style.top = `${e.clientY}px`;
      this.dragDot.classList.remove('hidden');
    } else {
      // Multi-touch (2 fingers on phone): switch cleanly to camera orbit!
      this.dragMoveX = 0;
      this.dragMoveZ = 0;
      this.dragDot.classList.add('hidden');
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (this.disposed) return;

    if (this.rightOrbiting) {
      const dx = e.clientX - this.lastOrbitX;
      const dy = e.clientY - this.lastOrbitY;
      this.lastOrbitX = e.clientX;
      this.lastOrbitY = e.clientY;
      this.cameraOrbitYaw -= dx * 0.006;
      this.cameraOrbitPitch = Math.max(0.12, Math.min(0.85, this.cameraOrbitPitch + dy * 0.005));
      return;
    }

    const pt = this.activePointers.get(e.pointerId);
    if (!pt) return;

    const prevX = pt.x;
    const prevY = pt.y;
    pt.x = e.clientX;
    pt.y = e.clientY;

    // Two-finger touch drag on phone orbits the dance camera!
    if (this.activePointers.size >= 2) {
      const dx = pt.x - prevX;
      const dy = pt.y - prevY;
      this.cameraOrbitYaw -= dx * 0.0045;
      this.cameraOrbitPitch = Math.max(0.12, Math.min(0.85, this.cameraOrbitPitch + dy * 0.004));
      return;
    }

    if (e.pointerId !== this.primaryPointerId) return;

    // Continuous steering vector from touch/drag origin
    const dx = pt.x - pt.startX;
    const dy = pt.y - pt.startY;
    const dist = Math.hypot(dx, dy);

    this.dragDot.style.left = `${pt.x}px`;
    this.dragDot.style.top = `${pt.y}px`;

    if (dist > 14) {
      const scale = Math.min(1, (dist - 14) / 76);
      this.dragMoveX = (dx / dist) * scale;
      this.dragMoveZ = (dy / dist) * scale;

      // Detect circular swirling gesture for freestyle tornado twirl!
      const ang = Math.atan2(dy, dx);
      if (this.lastDragAngle !== null && dist > 26) {
        let dAng = ang - this.lastDragAngle;
        if (dAng > Math.PI) dAng -= Math.PI * 2;
        if (dAng < -Math.PI) dAng += Math.PI * 2;
        this.angularAccum += Math.abs(dAng);
        if (this.angularAccum > 2.4) {
          this.swirlEnergy = Math.min(1, this.swirlEnergy + 0.55);
          this.angularAccum = 0;
          this.callbacks.onFlourish('twirl', false);
        }
      }
      this.lastDragAngle = ang;
    }
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (this.rightOrbiting && (e.button === 2 || e.buttons === 0)) {
      this.rightOrbiting = false;
    }

    const pt = this.activePointers.get(e.pointerId);
    this.activePointers.delete(e.pointerId);

    if (pt && e.pointerId === this.primaryPointerId) {
      const dtMs = performance.now() - pt.startTime;
      const dx = pt.x - pt.startX;
      const dy = pt.y - pt.startY;
      const dist = Math.hypot(dx, dy);

      if (dist < 14 && dtMs < 260) {
        // Quick tap on a dancer or interactive stage prop!
        this.callbacks.onTapWorld(e.clientX, e.clientY);
      } else if (dist >= SWIPE_MIN_DIST_PX && dtMs <= SWIPE_MAX_MS) {
        // Crisp directional swipe flourish!
        const perfect = this.isOnBeat(performance.now() / 1000);
        if (Math.abs(dx) >= Math.abs(dy)) {
          this.callbacks.onFlourish(dx < 0 ? 'spin_left' : 'spin_right', perfect);
        } else if (dy < 0) {
          this.callbacks.onFlourish('leap', perfect);
        } else {
          this.callbacks.onFlourish('drop', perfect);
        }
      }

      this.primaryPointerId = null;
      this.dragMoveX = 0;
      this.dragMoveZ = 0;
      this.lastDragAngle = null;
      this.dragDot.classList.add('hidden');
    }
  };

  private readonly handleWheel = (e: WheelEvent): void => {
    if (this.disposed || this.callbacks.getSelectedId() === null) return;
    e.preventDefault();

    // Pinch-zoom (ctrlKey on trackpad) adjusts dance camera distance
    if (e.ctrlKey) {
      this.cameraOrbitDist = Math.max(4.6, Math.min(12.5, this.cameraOrbitDist + e.deltaY * 0.015));
      return;
    }

    // Two-finger trackpad swipes trigger fun instant dance flourishes!
    this.wheelAccumX += e.deltaX;
    this.wheelAccumY += e.deltaY;
    const now = performance.now();
    if (now - this.lastWheelFlourishAt < 460) return;

    if (Math.abs(this.wheelAccumX) > 65 && Math.abs(this.wheelAccumX) > Math.abs(this.wheelAccumY)) {
      this.lastWheelFlourishAt = now;
      const dir = this.wheelAccumX > 0 ? 'spin_right' : 'spin_left';
      this.wheelAccumX = 0;
      this.wheelAccumY = 0;
      this.callbacks.onFlourish(dir, this.isOnBeat(now / 1000));
    } else if (Math.abs(this.wheelAccumY) > 75) {
      this.lastWheelFlourishAt = now;
      const kind: FlourishKind = this.wheelAccumY < 0 ? 'leap' : 'drop';
      this.wheelAccumX = 0;
      this.wheelAccumY = 0;
      this.callbacks.onFlourish(kind, this.isOnBeat(now / 1000));
    }
  };

  private readonly handleContextMenu = (e: MouseEvent): void => {
    if (this.callbacks.getSelectedId() !== null) e.preventDefault();
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown, true);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('click', this.handleViewportClick);
    this.gesturePad.addEventListener('pointerdown', this.handlePointerDown);
    this.gesturePad.addEventListener('pointermove', this.handlePointerMove);
    this.gesturePad.addEventListener('pointerup', this.handlePointerUp);
    this.gesturePad.addEventListener('pointercancel', this.handlePointerUp);
    this.gesturePad.addEventListener('wheel', this.handleWheel, { passive: false });
    this.gesturePad.addEventListener('contextmenu', this.handleContextMenu);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.bannerTimer);
    window.dispatchEvent(new CustomEvent('portalverse:room-capture', { detail: { active: false } }));
    window.removeEventListener('keydown', this.handleKeyDown, true);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('click', this.handleViewportClick);
    this.gesturePad.removeEventListener('pointerdown', this.handlePointerDown);
    this.gesturePad.removeEventListener('pointermove', this.handlePointerMove);
    this.gesturePad.removeEventListener('pointerup', this.handlePointerUp);
    this.gesturePad.removeEventListener('pointercancel', this.handlePointerUp);
    this.gesturePad.removeEventListener('wheel', this.handleWheel);
    this.gesturePad.removeEventListener('contextmenu', this.handleContextMenu);
    this.hostEl.remove();
    this.styleEl.remove();
  }
}

const STARLIGHT_HUD_CSS = `
.slp-hud {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 28;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.slp-gesture-pad {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  touch-action: none;
  cursor: grab;
  z-index: 1;
}
.slp-gesture-pad:active { cursor: grabbing; }
.slp-drag-dot {
  position: fixed;
  width: 56px;
  height: 56px;
  margin-left: -28px;
  margin-top: -28px;
  border-radius: 50%;
  border: 2px solid rgba(251, 191, 36, 0.85);
  background: radial-gradient(circle, rgba(45, 212, 191, 0.35), rgba(251, 191, 36, 0.08));
  box-shadow: 0 0 22px rgba(45, 212, 191, 0.55);
  pointer-events: none;
}
.slp-top-pill {
  position: fixed;
  top: max(70px, calc(58px + env(safe-area-inset-top)));
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(8, 12, 28, 0.78);
  border: 1.5px solid rgba(251, 191, 36, 0.42);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: #f8fafc;
  box-shadow: 0 10px 28px rgba(2, 6, 23, 0.5);
}
.slp-beat-ring {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #2dd4bf;
  background: rgba(45, 212, 191, 0.25);
  transition: background 80ms ease, border-color 80ms ease;
}
.slp-beat-ring.on-beat {
  border-color: #fbbf24;
  background: #fbbf24;
  box-shadow: 0 0 14px #fbbf24;
}
.slp-style-btn {
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(30, 41, 59, 0.65);
  color: #fef3c7;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.slp-style-btn:hover { border-color: #fbbf24; }
.slp-combo {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}
.slp-combo-lbl {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #94a3b8;
}
.slp-combo-val {
  font-size: 14px;
  font-weight: 900;
  color: #38bdf8;
}
.slp-combo-val.overdrive {
  color: #fbbf24;
  text-shadow: 0 0 12px rgba(251, 191, 36, 0.85);
}
.slp-banner {
  position: fixed;
  top: max(122px, calc(108px + env(safe-area-inset-top)));
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  padding: 7px 18px;
  border-radius: 999px;
  background: rgba(6, 10, 24, 0.86);
  border: 1.5px solid var(--slp-banner-color, #fbbf24);
  color: #f8fafc;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.03em;
  box-shadow: 0 0 24px color-mix(in srgb, var(--slp-banner-color, #fbbf24) 45%, transparent);
  pointer-events: none;
}
.slp-banner.pop {
  animation: slpBannerPop 0.28s cubic-bezier(0.22, 1.35, 0.36, 1);
}
@keyframes slpBannerPop {
  from { opacity: 0; transform: translateX(-50%) scale(0.84) translateY(8px); }
  to { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
}
.slp-dock {
  position: fixed;
  left: 50%;
  bottom: max(56px, calc(18px + env(safe-area-inset-bottom)));
  transform: translateX(-50%);
  z-index: 4;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: min(680px, calc(100vw - 20px));
}
.slp-hud.is-controlling .slp-dock {
  bottom: max(18px, calc(14px + env(safe-area-inset-bottom)));
}
.slp-roster {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.slp-dancer-btn {
  --d-accent: #fbbf24;
  appearance: none;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 6px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in srgb, var(--d-accent) 45%, rgba(255,255,255,0.18));
  background: rgba(8, 13, 30, 0.84);
  color: #f8fafc;
  cursor: pointer;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: transform 0.12s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}
.slp-dancer-btn:hover {
  transform: translateY(-2px);
  border-color: var(--d-accent);
}
.slp-dancer-btn.active {
  border-color: var(--d-accent);
  background: color-mix(in srgb, var(--d-accent) 24%, rgba(8, 13, 30, 0.92));
  box-shadow: 0 0 22px color-mix(in srgb, var(--d-accent) 52%, transparent);
}
.slp-dancer-key {
  position: absolute;
  top: -5px;
  left: -3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--d-accent);
  color: #060914;
  font-size: 10.5px;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.slp-dancer-img {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid var(--d-accent);
}
.slp-dancer-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.15;
}
.slp-dancer-name { font-size: 13px; font-weight: 800; }
.slp-dancer-role { font-size: 10.5px; color: #cbd5e1; }
.slp-control-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}
.slp-spell-btn {
  --sp-accent: #fbbf24;
  appearance: none;
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 15px;
  border-radius: 13px;
  border: 1.5px solid var(--sp-accent);
  background: color-mix(in srgb, var(--sp-accent) 20%, rgba(7, 11, 26, 0.9));
  color: #f8fafc;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 0 18px color-mix(in srgb, var(--sp-accent) 36%, transparent);
  transition: transform 0.1s ease;
}
.slp-spell-btn:active { transform: scale(0.95); }
.slp-spell-btn:disabled { opacity: 0.6; cursor: wait; }
.slp-spell-cd {
  position: absolute;
  inset: 0;
  background: rgba(2, 6, 23, 0.65);
  transform-origin: left center;
  transform: scaleX(0);
  pointer-events: none;
}
.slp-spell-key {
  position: relative;
  z-index: 1;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--sp-accent);
  color: #060914;
  font-size: 11px;
  font-weight: 900;
}
.slp-spell-name { position: relative; z-index: 1; }
.slp-mini-btn, .slp-exit-btn {
  appearance: none;
  padding: 9px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.85);
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.slp-exit-btn {
  border-color: rgba(251, 113, 133, 0.5);
  color: #fecdd3;
}
.slp-hint {
  font-size: 11.5px;
  color: #cbd5e1;
  background: rgba(6, 10, 24, 0.72);
  padding: 4px 12px;
  border-radius: 999px;
  text-align: center;
  max-width: 100%;
}
.slp-hud .hidden { display: none !important; }
@media (max-width: 720px) {
  .slp-dancer-role { display: none; }
  .slp-dancer-img { width: 32px; height: 32px; }
  .slp-spell-btn { padding: 8px 11px; font-size: 12px; }
  .slp-hint { font-size: 10.5px; }
}
`;
