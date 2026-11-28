import type { AvatarController } from '@portalverse/core/engine/AvatarController';

export interface MobileControlsCallbacks {
  onOpenCharacters: () => void;
  onToggleCameraView: () => void;
  onOpenChat?: () => void;
  onToggleVoice?: () => void;
  onOpenMetaView?: () => void;
}

const STICK_MAX_RADIUS = 48;
const STICK_DEADZONE = 0.12;
const STICK_AUTO_SPRINT = 0.86;
const TOUCH_LOOK_SENSITIVITY = 0.0052;

/**
 * Multi-touch virtual controls for iPhone, iPad, and Android:
 * - Left thumbstick (floating capture in bottom-left quadrant) with auto-sprint rim
 * - Right viewport drag-look pad (independent pointerId for full multi-touch)
 * - Right-hand thumb-arc action buttons: Jump/Rise, Fly/Land, Boost, 1st/3rd View, Characters
 */
export class MobileControls {
  private readonly root: HTMLElement;
  private readonly lookZone: HTMLElement;
  private readonly stickZone: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly btnJump: HTMLButtonElement;
  private readonly btnFly: HTMLButtonElement;
  private readonly btnBoost: HTMLButtonElement;
  private readonly btnView: HTMLButtonElement;
  private readonly btnChar: HTMLButtonElement;
  private readonly btnChat: HTMLButtonElement | null;
  private readonly btnVoice: HTMLButtonElement | null;
  private readonly btnMeta: HTMLButtonElement | null;
  private readonly avatar: AvatarController;
  private readonly callbacks: MobileControlsCallbacks;

  private enabled = false;
  private inputLocked = false;
  private flying = false;

  private stickPointerId: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;

  private lookPointerId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;

  private jumpPointerId: number | null = null;
  private descendPointerId: number | null = null;
  private boostPointerId: number | null = null;

  constructor(
    root: HTMLElement,
    avatar: AvatarController,
    callbacks: MobileControlsCallbacks,
  ) {
    this.root = root;
    this.avatar = avatar;
    this.callbacks = callbacks;

    this.lookZone = root.querySelector('#mobile-look-zone') as HTMLElement;
    this.stickZone = root.querySelector('#mobile-stick-zone') as HTMLElement;
    this.stickBase = root.querySelector('#mobile-stick-base') as HTMLElement;
    this.stickKnob = root.querySelector('#mobile-stick-knob') as HTMLElement;
    this.btnJump = root.querySelector('#btn-mobile-jump') as HTMLButtonElement;
    this.btnFly = root.querySelector('#btn-mobile-fly') as HTMLButtonElement;
    this.btnBoost = root.querySelector('#btn-mobile-boost') as HTMLButtonElement;
    this.btnView = root.querySelector('#btn-mobile-view') as HTMLButtonElement;
    this.btnChar = root.querySelector('#btn-mobile-char') as HTMLButtonElement;
    this.btnChat = root.querySelector('#btn-mobile-chat');
    this.btnVoice = root.querySelector('#btn-mobile-voice');
    this.btnMeta = root.querySelector('#btn-mobile-meta');

    this.bindEvents();
    this.syncLabels();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.classList.toggle('hidden', !enabled);
    this.avatar.setTouchLookHandled(enabled);
    document.body.classList.toggle('touch-ui-active', enabled);
    if (!enabled) this.releaseAllPointers();
  }

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
    this.root.classList.toggle('input-locked', locked);
    if (locked) this.releaseAllPointers();
  }

  setFlying(flying: boolean): void {
    if (this.flying === flying) return;
    this.flying = flying;
    // Release descend hold cleanly once landed so it doesn't linger
    if (!flying && this.descendPointerId !== null) {
      this.descendPointerId = null;
      this.avatar.setVirtualVertical(0);
      this.btnFly.classList.remove('active');
    }
    this.syncLabels();
  }

  setFirstPerson(firstPerson: boolean): void {
    this.btnView.textContent = firstPerson ? '3rd View' : '1st View';
    this.btnView.setAttribute('aria-pressed', String(!firstPerson));
  }

  setVoiceState(joined: boolean, muted: boolean, speaking: boolean): void {
    if (!this.btnVoice) return;
    this.btnVoice.textContent = !joined ? 'Mic' : muted ? 'Muted' : 'Mic On';
    this.btnVoice.setAttribute('aria-pressed', String(joined && !muted));
    this.btnVoice.classList.toggle('voice-speaking', joined && speaking);
  }

  private syncLabels(): void {
    this.root.classList.toggle('flying', this.flying);
    this.btnJump.textContent = this.flying ? 'Rise ↑' : 'Jump';
    this.btnFly.textContent = this.flying ? 'Land ↓' : 'Fly';
    this.btnBoost.textContent = this.flying ? 'Boost' : 'Sprint';
  }

  private bindEvents(): void {
    // --- Left Virtual Thumbstick ---
    this.stickZone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.inputLocked || this.stickPointerId !== null) return;
      e.preventDefault();
      this.stickPointerId = e.pointerId;
      this.stickZone.setPointerCapture?.(e.pointerId);

      const zoneRect = this.stickZone.getBoundingClientRect();
      // Anchor the floating stick near the initial touch point, kept comfortably inside the zone
      const localX = Math.max(58, Math.min(zoneRect.width - 58, e.clientX - zoneRect.left));
      const localY = Math.max(58, Math.min(zoneRect.height - 58, e.clientY - zoneRect.top));
      this.stickOriginX = zoneRect.left + localX;
      this.stickOriginY = zoneRect.top + localY;

      this.stickBase.style.left = `${localX}px`;
      this.stickBase.style.top = `${localY}px`;
      this.stickBase.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    });

    this.stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointerId) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    });

    const releaseStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointerId) return;
      this.resetStick();
    };
    this.stickZone.addEventListener('pointerup', releaseStick);
    this.stickZone.addEventListener('pointercancel', releaseStick);
    this.stickZone.addEventListener('lostpointercapture', releaseStick);

    // --- Right Multi-Touch Camera Look Pad ---
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.inputLocked || this.lookPointerId !== null) return;
      e.preventDefault();
      this.lookPointerId = e.pointerId;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
      this.lookZone.setPointerCapture?.(e.pointerId);
    });

    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointerId) return;
      e.preventDefault();
      const dx = e.clientX - this.lookLastX;
      const dy = e.clientY - this.lookLastY;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
      // Guard against occasional OS jump spikes
      if (Math.abs(dx) > 180 || Math.abs(dy) > 180) return;
      this.avatar.applyLookDelta(dx, dy, TOUCH_LOOK_SENSITIVITY);
    });

    const releaseLook = (e: PointerEvent) => {
      if (e.pointerId !== this.lookPointerId) return;
      this.lookPointerId = null;
    };
    this.lookZone.addEventListener('pointerup', releaseLook);
    this.lookZone.addEventListener('pointercancel', releaseLook);
    this.lookZone.addEventListener('lostpointercapture', releaseLook);

    // --- Jump / Mid-Air Fly / Rise Button ---
    this.btnJump.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.inputLocked) return;
      e.preventDefault();
      this.jumpPointerId = e.pointerId;
      this.btnJump.setPointerCapture?.(e.pointerId);
      this.btnJump.classList.add('active');
      this.avatar.setJumpHeld(true);
      if (!this.flying) {
        this.avatar.pressJumpOrFly();
      }
    });

    const releaseJump = (e: PointerEvent) => {
      if (e.pointerId !== this.jumpPointerId) return;
      this.jumpPointerId = null;
      this.btnJump.classList.remove('active');
      this.avatar.setJumpHeld(false);
    };
    this.btnJump.addEventListener('pointerup', releaseJump);
    this.btnJump.addEventListener('pointercancel', releaseJump);
    this.btnJump.addEventListener('lostpointercapture', releaseJump);

    // --- Fly Takeoff (on ground) / Hold to Descend & Land (in flight) ---
    this.btnFly.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.inputLocked) return;
      e.preventDefault();
      this.btnFly.setPointerCapture?.(e.pointerId);
      this.btnFly.classList.add('active');
      if (!this.flying) {
        this.avatar.toggleFlight();
        window.setTimeout(() => this.btnFly.classList.remove('active'), 160);
      } else {
        this.descendPointerId = e.pointerId;
        this.avatar.setVirtualVertical(-1);
      }
    });

    const releaseFly = (e: PointerEvent) => {
      if (e.pointerId !== this.descendPointerId) return;
      this.descendPointerId = null;
      this.btnFly.classList.remove('active');
      this.avatar.setVirtualVertical(0);
    };
    this.btnFly.addEventListener('pointerup', releaseFly);
    this.btnFly.addEventListener('pointercancel', releaseFly);
    this.btnFly.addEventListener('lostpointercapture', releaseFly);

    // --- Boost / Sprint Hold Button ---
    this.btnBoost.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.inputLocked) return;
      e.preventDefault();
      this.boostPointerId = e.pointerId;
      this.btnBoost.setPointerCapture?.(e.pointerId);
      this.btnBoost.classList.add('active');
      this.avatar.setVirtualBoost(true);
    });

    const releaseBoost = (e: PointerEvent) => {
      if (e.pointerId !== this.boostPointerId) return;
      this.boostPointerId = null;
      this.btnBoost.classList.remove('active');
      this.avatar.setVirtualBoost(false);
    };
    this.btnBoost.addEventListener('pointerup', releaseBoost);
    this.btnBoost.addEventListener('pointercancel', releaseBoost);
    this.btnBoost.addEventListener('lostpointercapture', releaseBoost);

    // --- Quick View & Character Select Buttons ---
    this.btnView.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.enabled || this.inputLocked) return;
      this.callbacks.onToggleCameraView();
    });

    this.btnChar.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.enabled || this.inputLocked) return;
      this.callbacks.onOpenCharacters();
    });

    this.btnChat?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.enabled || this.inputLocked) return;
      this.callbacks.onOpenChat?.();
    });

    this.btnVoice?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.enabled || this.inputLocked) return;
      this.callbacks.onToggleVoice?.();
    });

    this.btnMeta?.addEventListener('click', (e) => {
      e.preventDefault();
      if (!this.enabled || this.inputLocked) return;
      this.callbacks.onOpenMetaView?.();
    });

    window.addEventListener('blur', () => this.releaseAllPointers());
  }

  private updateStick(clientX: number, clientY: number): void {
    const rawDx = clientX - this.stickOriginX;
    const rawDy = clientY - this.stickOriginY;
    const dist = Math.hypot(rawDx, rawDy);
    const clampedDist = Math.min(dist, STICK_MAX_RADIUS);
    const angle = Math.atan2(rawDy, rawDx);
    const knobX = dist > 0.001 ? Math.cos(angle) * clampedDist : 0;
    const knobY = dist > 0.001 ? Math.sin(angle) * clampedDist : 0;
    this.stickKnob.style.transform = `translate3d(${knobX.toFixed(1)}px, ${knobY.toFixed(1)}px, 0)`;

    const normMag = clampedDist / STICK_MAX_RADIUS;
    if (normMag < STICK_DEADZONE) {
      this.stickBase.classList.remove('sprinting');
      this.avatar.setVirtualMove(0, 0, false);
      return;
    }

    const scaled = (normMag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    // Gentle response curve for precise walking near center, full speed at edge
    const curved = Math.pow(scaled, 1.25);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const strafe = dirX * curved;
    const forward = -dirY * curved;
    const autoSprint = normMag >= STICK_AUTO_SPRINT;

    this.stickBase.classList.toggle('sprinting', autoSprint);
    this.avatar.setVirtualMove(forward, strafe, autoSprint);
  }

  private resetStick(): void {
    this.stickPointerId = null;
    this.stickBase.classList.remove('active', 'sprinting');
    this.stickBase.style.left = '';
    this.stickBase.style.top = '';
    this.stickKnob.style.transform = 'translate3d(0, 0, 0)';
    this.avatar.setVirtualMove(0, 0, false);
  }

  private releaseCaptureSafe(el: HTMLElement, pointerId: number | null): void {
    if (pointerId === null) return;
    try {
      if (el.hasPointerCapture?.(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore if pointer already ended or capture is unsupported
    }
  }

  private releaseAllPointers(): void {
    this.releaseCaptureSafe(this.stickZone, this.stickPointerId);
    this.releaseCaptureSafe(this.lookZone, this.lookPointerId);
    this.releaseCaptureSafe(this.btnJump, this.jumpPointerId);
    this.releaseCaptureSafe(this.btnFly, this.descendPointerId);
    this.releaseCaptureSafe(this.btnBoost, this.boostPointerId);
    this.resetStick();
    this.lookPointerId = null;
    this.jumpPointerId = null;
    this.descendPointerId = null;
    this.boostPointerId = null;
    this.btnJump.classList.remove('active');
    this.btnFly.classList.remove('active');
    this.btnBoost.classList.remove('active');
    this.avatar.clearVirtualInputs();
  }
}
