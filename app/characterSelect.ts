import * as THREE from 'three/webgpu';
import {
  CHARACTERS,
  normalizeSkinAppearance,
  skinColor,
  type SkinAppearance,
  getCharacterDefinition,
  type AvatarMotionState,
  type CharacterDefinition,
  type CharacterRig,
} from '@portalverse/core/characters';

export type PreviewPose = 'idle' | 'walk' | 'run' | 'jump' | 'fly' | 'boost';

export interface CharacterSelectCallbacks {
  getEquippedId: () => string;
  getAccentColor: () => string;
  getSkinAppearance: () => SkinAppearance;
  onSelect: (character: CharacterDefinition, switchToThirdPerson: boolean, appearance: SkinAppearance) => void;
  onClose: (relockPointer: boolean) => void;
}

function buildPreviewMotion(pose: PreviewPose, elapsed: number): AvatarMotionState {
  switch (pose) {
    case 'run':
      return { ...buildPreviewMotion('walk', elapsed), speed: 13, speedNorm: 1, forwardSpeed: 13, boost: 1 };
    case 'jump': {
      const phase = elapsed % 1.5;
      return { ...buildPreviewMotion('idle', elapsed), grounded: phase > 0.9,
        velocityY: phase <= 0.9 ? 7 - phase * 16 : 0,
        landImpact: phase > 0.9 ? Math.max(0, 1 - (phase - 0.9) * 8) : 0 };
    }
    case 'walk':
      return {
        speed: 8.6,
        speedNorm: 0.72,
        forwardSpeed: 8.6,
        strafeSpeed: 0,
        velocityY: 0,
        turnRate: Math.sin(elapsed * 0.9) * 0.35,
        grounded: true,
        isFlying: false,
        boost: 0,
        pitch: 0,
        landImpact: 0,
      };
    case 'fly':
      return {
        speed: 14.5,
        speedNorm: 1.05,
        forwardSpeed: 14.5,
        strafeSpeed: 0,
        velocityY: Math.sin(elapsed * 1.6) * 0.8,
        turnRate: Math.sin(elapsed * 1.1) * 0.65,
        grounded: false,
        isFlying: true,
        boost: 0.15,
        pitch: Math.sin(elapsed * 1.2) * 0.12,
        landImpact: 0,
      };
    case 'boost':
      return {
        speed: 28.0,
        speedNorm: 1.5,
        forwardSpeed: 28.0,
        strafeSpeed: 0,
        velocityY: Math.sin(elapsed * 2.2) * 0.6,
        turnRate: Math.sin(elapsed * 1.4) * 1.1,
        grounded: false,
        isFlying: true,
        boost: 1.0,
        pitch: 0.08,
        landImpact: 0,
      };
    case 'idle':
    default:
      return {
        speed: 0,
        speedNorm: 0,
        forwardSpeed: 0,
        strafeSpeed: 0,
        velocityY: 0,
        turnRate: 0,
        grounded: true,
        isFlying: false,
        boost: 0,
        pitch: 0,
        landImpact: 0,
      };
  }
}

/**
 * Interactive Character Select modal controller with a live WebGPU 3D turntable preview
 * supporting 360-degree drag orbit and live Idle / Walk / Fly / Boost animation preview.
 */
export class CharacterSelectScreen {
  private readonly canvas: HTMLCanvasElement;
  private readonly rosterEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly descEl: HTMLElement;
  private readonly controlsEl: HTMLElement;
  private readonly traitsEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly btnEquip: HTMLButtonElement;
  private readonly thirdPersonCheckbox: HTMLInputElement;
  private readonly poseButtons: HTMLButtonElement[];
  private readonly callbacks: CharacterSelectCallbacks;
  private readonly skinControls: HTMLElement;
  private readonly skinToneInput: HTMLInputElement;
  private readonly undertoneInput: HTMLInputElement;
  private readonly skinSwatch: HTMLElement;
  private readonly loadStatus: HTMLElement;
  private appearance: SkinAppearance;
  private rigReady = false;

  private previewedId: string;
  private pose: PreviewPose = 'idle';
  private open = false;

  // Lazy-initialized 3D preview stage
  private renderer: THREE.WebGPURenderer | null = null;
  private initPromise: Promise<void> | null = null;
  private previewReady = false;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
  private readonly stageRoot = new THREE.Group();
  private pedestalRingMat: THREE.MeshStandardMaterial | null = null;
  private rimLight: THREE.PointLight | null = null;
  private activeRig: CharacterRig | null = null;
  private activeRigId: string | null = null;

  private orbitYaw = Math.PI + 0.42; // Show character 3/4 front-facing (character faces -Z)
  private orbitPitch = 0.16;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private rafId = 0;
  private lastTime = 0;
  private elapsed = 0;

  constructor(modal: HTMLElement, callbacks: CharacterSelectCallbacks) {
    this.callbacks = callbacks;
    this.appearance = normalizeSkinAppearance(callbacks.getSkinAppearance());
    this.skinControls = modal.querySelector('#character-skin-controls') as HTMLElement;
    this.skinToneInput = modal.querySelector('#character-skin-tone') as HTMLInputElement;
    this.undertoneInput = modal.querySelector('#character-undertone') as HTMLInputElement;
    this.skinSwatch = modal.querySelector('#character-skin-swatch') as HTMLElement;
    this.loadStatus = modal.querySelector('#character-load-status') as HTMLElement;
    this.canvas = modal.querySelector('#character-preview-canvas') as HTMLCanvasElement;
    this.rosterEl = modal.querySelector('#character-roster') as HTMLElement;
    this.nameEl = modal.querySelector('#character-detail-name') as HTMLElement;
    this.titleEl = modal.querySelector('#character-detail-title') as HTMLElement;
    this.descEl = modal.querySelector('#character-detail-desc') as HTMLElement;
    this.controlsEl = modal.querySelector('#character-controls-info') as HTMLElement;
    this.traitsEl = modal.querySelector('#character-detail-traits') as HTMLElement;
    this.countEl = modal.querySelector('#character-roster-count') as HTMLElement;
    this.btnEquip = modal.querySelector('#btn-equip-character') as HTMLButtonElement;
    this.thirdPersonCheckbox = modal.querySelector('#character-third-person-toggle') as HTMLInputElement;
    this.poseButtons = Array.from(modal.querySelectorAll<HTMLButtonElement>('[data-preview-pose]'));

    this.previewedId = getCharacterDefinition(callbacks.getEquippedId()).id;

    this.setupStageScene();
    this.bindEvents();
    this.renderRoster();
    this.syncDetails();
  }

  private setupStageScene(): void {
    this.scene.add(this.stageRoot);

    const hemi = new THREE.HemisphereLight('#c8e6ff', '#1e1b4b', 1.35);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#fff5e4', 2.2);
    key.position.set(3.5, 5.2, 4.4);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#7dd3fc', 0.95);
    fill.position.set(-4.2, 2.5, 2.2);
    this.scene.add(fill);

    this.rimLight = new THREE.PointLight('#38bdf8', 2.6, 12);
    this.rimLight.position.set(-1.6, 2.6, -3.4);
    this.scene.add(this.rimLight);

    // Subtle cosmic turntable pedestal under Y = 0
    const discGeo = new THREE.CylinderGeometry(1.15, 1.24, 0.08, 48);
    const discMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.45,
      metalness: 0.6,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = -0.045;
    this.scene.add(disc);

    const ringGeo = new THREE.TorusGeometry(1.18, 0.025, 12, 64);
    this.pedestalRingMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      emissive: '#38bdf8',
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.3,
    });
    const ring = new THREE.Mesh(ringGeo, this.pedestalRingMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.005;
    this.scene.add(ring);
  }

  private bindEvents(): void {
    const updateSkin = () => {
      this.appearance = normalizeSkinAppearance({
        skinTone: Number(this.skinToneInput.value) / 100,
        undertone: Number(this.undertoneInput.value) / 100,
      });
      this.activeRig?.setSkinAppearance?.(this.appearance);
      this.syncSkinControls();
    };
    this.skinToneInput.addEventListener('input', updateSkin);
    this.undertoneInput.addEventListener('input', updateSkin);
    for (const btn of this.poseButtons) {
      btn.addEventListener('click', () => {
        const nextPose = btn.dataset.previewPose as PreviewPose | undefined;
        if (!nextPose) return;
        this.setPose(nextPose);
      });
    }

    this.btnEquip.addEventListener('click', () => {
      this.equipPreviewed();
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.canvas.setPointerCapture?.(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.orbitYaw -= dx * 0.011;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.007, -0.35, 0.72);
    });
    const stopDrag = () => {
      this.dragging = false;
    };
    this.canvas.addEventListener('pointerup', stopDrag);
    this.canvas.addEventListener('pointercancel', stopDrag);

    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      // Range controls retain their native arrow-key behavior.
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
        e.preventDefault();
        this.stepSelection(1);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
        e.preventDefault();
        this.stepSelection(-1);
      } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
        if (document.activeElement instanceof HTMLButtonElement && document.activeElement !== this.btnEquip) {
          return;
        }
        e.preventDefault();
        this.equipPreviewed();
      }
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.appearance = normalizeSkinAppearance(this.callbacks.getSkinAppearance());
    this.previewedId = getCharacterDefinition(this.callbacks.getEquippedId()).id;
    this.orbitYaw = Math.PI + 0.42;
    this.orbitPitch = 0.16;
    this.renderRoster();
    this.syncDetails();
    this.mountPreviewRig(this.previewedId);
    void this.ensureRendererAndStart();
  }

  hide(): void {
    this.open = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private setPose(pose: PreviewPose): void {
    this.pose = pose;
    for (const btn of this.poseButtons) {
      const active = btn.dataset.previewPose === pose;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  private stepSelection(delta: number): void {
    const idx = CHARACTERS.findIndex((c) => c.id === this.previewedId);
    const nextIdx = (idx + delta + CHARACTERS.length) % CHARACTERS.length;
    this.selectPreview(CHARACTERS[nextIdx].id);
  }

  private selectPreview(id: string): void {
    const def = getCharacterDefinition(id);
    this.previewedId = def.id;
    this.orbitYaw = Math.PI + 0.42;
    this.renderRoster();
    this.syncDetails();
    this.mountPreviewRig(def.id);
  }

  private equipPreviewed(): void {
    if (!this.rigReady) return;
    const def = getCharacterDefinition(this.previewedId);
    this.callbacks.onSelect(def, this.thirdPersonCheckbox.checked, { ...this.appearance });
    this.renderRoster();
    this.syncDetails();
    this.callbacks.onClose(true);
  }

  private mountPreviewRig(id: string): void {
    const def = getCharacterDefinition(id);
    if (this.pedestalRingMat) {
      this.pedestalRingMat.color.set(def.accentColor);
      this.pedestalRingMat.emissive.set(def.accentColor);
    }
    if (this.rimLight) {
      this.rimLight.color.set(def.accentColor);
    }
    if (this.activeRigId === def.id && this.activeRig) {
      this.activeRig.setAccentColor?.(this.callbacks.getAccentColor());
      this.activeRig.setSkinAppearance?.(this.appearance);
      return;
    }
    if (this.activeRig) {
      this.stageRoot.remove(this.activeRig.group);
      this.activeRig.dispose();
      this.activeRig = null;
    }
    const rig = def.createRig({ accentColor: this.callbacks.getAccentColor(), ...this.appearance });
    this.stageRoot.add(rig.group);
    this.activeRig = rig;
    this.activeRigId = def.id;
    this.rigReady = !rig.ready;
    this.btnEquip.disabled = !this.rigReady;
    this.loadStatus.textContent = rig.ready ? 'Loading character…' : '';
    void rig.ready?.then(() => {
      if (this.activeRig !== rig) return;
      this.rigReady = true;
      this.btnEquip.disabled = false;
      this.loadStatus.textContent = '';
    }, () => {
      if (this.activeRig !== rig) return;
      this.loadStatus.textContent = 'Character could not load. Choose another character and try again.';
    });
  }

  private renderRoster(): void {
    const equippedId = getCharacterDefinition(this.callbacks.getEquippedId()).id;
    this.countEl.textContent = `${CHARACTERS.length} playable · more coming soon`;
    this.rosterEl.innerHTML = '';

    for (const char of CHARACTERS) {
      const card = document.createElement('button');
      card.type = 'button';
      const isSelected = char.id === this.previewedId;
      const isEquipped = char.id === equippedId;
      card.className = `character-card${isSelected ? ' selected' : ''}${isEquipped ? ' equipped' : ''}`;
      card.style.setProperty('--char-accent', char.accentColor);
      card.innerHTML = `
        <span class="character-card-swatch" style="background:${char.accentColor};box-shadow:0 0 14px ${char.accentColor}"></span>
        <span class="character-card-body">
          <span class="character-card-row">
            <span class="character-card-name">${escapeHtml(char.name)}</span>
            ${isEquipped ? '<span class="character-badge-equipped">Equipped</span>' : ''}
          </span>
          <span class="character-card-sub">${escapeHtml(char.title)} · ${escapeHtml(char.species)}</span>
          <span class="character-card-tagline">${escapeHtml(char.tagline)}</span>
        </span>
      `;
      card.addEventListener('click', () => {
        this.selectPreview(char.id);
      });
      card.addEventListener('dblclick', () => {
        this.selectPreview(char.id);
        this.equipPreviewed();
      });
      this.rosterEl.appendChild(card);
    }
  }

  private syncSkinControls(): void {
    this.skinToneInput.value = String(Math.round(this.appearance.skinTone * 100));
    this.undertoneInput.value = String(Math.round(this.appearance.undertone * 100));
    const hex = `#${skinColor(this.appearance).getHexString()}`;
    this.skinSwatch.style.background = hex;
    this.skinToneInput.style.background = `linear-gradient(to right, ${Array.from({ length: 11 }, (_, i) =>
      `#${skinColor({ ...this.appearance, skinTone: i / 10 }).getHexString()}`).join(', ')})`;
    this.undertoneInput.style.background = `linear-gradient(to right, ${[-1, 0, 1].map((undertone) =>
      `#${skinColor({ ...this.appearance, undertone }).getHexString()}`).join(', ')})`;
    this.skinToneInput.setAttribute('aria-valuetext', `${this.skinToneInput.value} percent`);
    this.undertoneInput.setAttribute('aria-valuetext', this.appearance.undertone === 0 ? 'Balanced' :
      `${Math.abs(Number(this.undertoneInput.value))} percent ${this.appearance.undertone < 0 ? 'rosy' : 'golden'}`);
  }

  private syncDetails(): void {
    const def = getCharacterDefinition(this.previewedId);
    const equippedId = getCharacterDefinition(this.callbacks.getEquippedId()).id;
    this.skinControls.hidden = !def.supportsSkinTone;
    this.syncSkinControls();
    this.nameEl.textContent = def.name;
    this.titleEl.textContent = `${def.title} · ${def.species}`;
    this.descEl.textContent = def.backstory || def.description;
    this.controlsEl.hidden = def.thirdPersonMovement !== 'adventure';
    this.traitsEl.innerHTML = def.traits
      .map((t) => `<span class="character-trait">${escapeHtml(t)}</span>`)
      .join('');
    this.btnEquip.textContent =
      def.id === equippedId ? `Continue as ${def.name}` : `Play as ${def.name}`;
  }

  private async ensureRendererAndStart(): Promise<void> {
    if (!this.renderer) {
      try {
        const renderer = new THREE.WebGPURenderer({
          canvas: this.canvas,
          antialias: true,
          alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        this.renderer = renderer;
        this.initPromise = renderer.init().then(() => {
          this.previewReady = true;
        });
      } catch (err) {
        console.warn('Character preview renderer unavailable:', err);
        return;
      }
    }
    try {
      await this.initPromise;
    } catch (err) {
      console.warn('Character preview init failed:', err);
      return;
    }
    if (!this.open || !this.previewReady) return;
    this.resizePreview();
    if (!this.rafId) {
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private resizePreview(): void {
    if (!this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(160, Math.round(rect.width || 340));
    const h = Math.max(160, Math.round(rect.height || 340));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private readonly tick = (now: number): void => {
    if (!this.open || !this.renderer || !this.previewReady) {
      this.rafId = 0;
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    // Gentle auto-orbit when user isn't dragging
    if (!this.dragging) {
      this.orbitYaw += dt * 0.34;
    }

    const motion = buildPreviewMotion(this.pose, this.elapsed);
    this.activeRig?.update(dt, this.elapsed, motion);

    // Lift character subtly above the pedestal when previewing flight/boost
    const flyLift = this.pose === 'fly' || this.pose === 'boost' ? 0.36
      : this.pose === 'jump' ? Math.max(0, Math.sin(Math.min(this.elapsed % 1.5, 0.9) / 0.9 * Math.PI)) * 0.45 : 0;
    this.stageRoot.position.y += (flyLift - this.stageRoot.position.y) * Math.min(1, dt * 8);

    const baseRadius = this.pose === 'fly' || this.pose === 'boost' ? 4.55 : 3.78;
    // Give slightly extra pullback on wide mobile preview frames so tall heads/wings never clip.
    const wideBoost = this.camera.aspect > 1.25 ? 1 + Math.min(0.16, (this.camera.aspect - 1.25) * 0.18) : 1;
    const radius = baseRadius * wideBoost;
    const targetY = 0.94 + this.stageRoot.position.y * 0.65;
    this.camera.position.set(
      Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * radius,
      targetY + Math.sin(this.orbitPitch) * radius,
      Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * radius,
    );
    this.camera.lookAt(0, targetY, 0);

    const rect = this.canvas.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      (Math.abs(this.camera.aspect - rect.width / rect.height) > 0.02 ||
        Math.abs(this.canvas.width - Math.round(rect.width * Math.min(window.devicePixelRatio || 1, 2))) > 4 ||
        this.canvas.width < 10)
    ) {
      this.resizePreview();
    }

    this.renderer.render(this.scene, this.camera);
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
