import type {
  BubbleEffect,
  BubbleFontStyle,
  BubbleTailStyle,
  SpeechBubbleStyle,
} from '@portalverse/core/types';
import {
  BUBBLE_COLOR_PALETTES,
  BUBBLE_EFFECTS,
  BUBBLE_FLAIR_BADGES,
  BUBBLE_FONT_STYLES,
  BUBBLE_PRESETS,
  BUBBLE_TAIL_STYLES,
  getBubblePreset,
  renderSpeechBubbleToCanvas,
  type BubbleContentMode,
} from '@portalverse/core/chat';

export interface BubbleCustomizerCallbacks {
  getCurrentStyle: () => SpeechBubbleStyle;
  getAvatarColor: () => string;
  onSave: (style: SpeechBubbleStyle, sampleText?: string) => void;
  onClose: (relockPointer: boolean) => void;
}

const TAIL_LABELS: Record<BubbleTailStyle, string> = {
  curved: 'Curved',
  sharp: 'Sharp',
  dots: 'Thought Dots',
  none: 'Floating',
};

const FONT_LABELS: Record<BubbleFontStyle, string> = {
  sans: 'Modern',
  comic: 'Comic',
  mono: 'Cyber Mono',
  serif: 'Arcane Serif',
};

const EFFECT_LABELS: Record<BubbleEffect, string> = {
  none: 'Clean',
  glow: 'Neon Glow',
  shimmer: 'Shimmer',
  sparkle: 'Sparkle',
  pulse: 'Pulse',
};

/**
 * Interactive Speech Bubble Studio modal with live 2D/3D canvas preview
 * (Text, Voice Waveform, and Typing modes), 8 presets, color palettes,
 * tail shapes, fonts, animation effects, and flair badges.
 */
export class BubbleCustomizerModal {
  private readonly previewCanvas: HTMLCanvasElement;
  private readonly sampleInput: HTMLInputElement;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly presetGrid: HTMLElement;
  private readonly paletteRow: HTMLElement;
  private readonly bgColorInput: HTMLInputElement;
  private readonly accentColorInput: HTMLInputElement;
  private readonly textColorInput: HTMLInputElement;
  private readonly matchAvatarBtn: HTMLButtonElement;
  private readonly tailGroup: HTMLElement;
  private readonly fontGroup: HTMLElement;
  private readonly effectGroup: HTMLElement;
  private readonly badgeGroup: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly callbacks: BubbleCustomizerCallbacks;

  private draft: SpeechBubbleStyle;
  private previewMode: BubbleContentMode = 'text';
  private open = false;
  private rafId = 0;
  private startTime = 0;

  constructor(modalRoot: HTMLElement, callbacks: BubbleCustomizerCallbacks) {
    this.callbacks = callbacks;
    this.draft = { ...callbacks.getCurrentStyle() };

    this.previewCanvas = modalRoot.querySelector('#bubble-preview-canvas') as HTMLCanvasElement;
    this.sampleInput = modalRoot.querySelector('#bubble-sample-input') as HTMLInputElement;
    this.modeButtons = Array.from(modalRoot.querySelectorAll<HTMLButtonElement>('[data-bubble-preview-mode]'));
    this.presetGrid = modalRoot.querySelector('#bubble-preset-grid') as HTMLElement;
    this.paletteRow = modalRoot.querySelector('#bubble-palette-row') as HTMLElement;
    this.bgColorInput = modalRoot.querySelector('#bubble-bg-color') as HTMLInputElement;
    this.accentColorInput = modalRoot.querySelector('#bubble-accent-color') as HTMLInputElement;
    this.textColorInput = modalRoot.querySelector('#bubble-text-color') as HTMLInputElement;
    this.matchAvatarBtn = modalRoot.querySelector('#btn-bubble-match-avatar') as HTMLButtonElement;
    this.tailGroup = modalRoot.querySelector('#bubble-tail-group') as HTMLElement;
    this.fontGroup = modalRoot.querySelector('#bubble-font-group') as HTMLElement;
    this.effectGroup = modalRoot.querySelector('#bubble-effect-group') as HTMLElement;
    this.badgeGroup = modalRoot.querySelector('#bubble-badge-group') as HTMLElement;
    this.saveBtn = modalRoot.querySelector('#btn-save-bubble-style') as HTMLButtonElement;

    this.buildStaticControls();
    this.bindEvents();
  }

  show(): void {
    this.draft = { ...this.callbacks.getCurrentStyle() };
    this.open = true;
    this.startTime = performance.now();
    this.syncControls();
    this.renderPreview(0);
    this.startLoop();
  }

  hide(): void {
    this.open = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private buildStaticControls(): void {
    // 1. Preset gallery
    this.presetGrid.innerHTML = '';
    for (const preset of BUBBLE_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bubble-preset-card';
      btn.dataset.presetId = preset.id;
      btn.style.setProperty('--preset-bg', preset.style.bgColor);
      btn.style.setProperty('--preset-accent', preset.style.accentColor);
      btn.style.setProperty('--preset-text', preset.style.textColor);

      const chip = document.createElement('span');
      chip.className = `bubble-preset-chip bubble-preset-${preset.id}`;
      chip.textContent = preset.style.badge ? `${preset.style.badge} Hi!` : 'Hi!';

      const meta = document.createElement('span');
      meta.className = 'bubble-preset-meta';

      const name = document.createElement('span');
      name.className = 'bubble-preset-name';
      name.textContent = preset.name;

      const tagline = document.createElement('span');
      tagline.className = 'bubble-preset-tag';
      tagline.textContent = preset.tagline;

      meta.append(name, tagline);
      btn.append(chip, meta);
      btn.addEventListener('click', () => {
        this.draft = { ...getBubblePreset(preset.id).style };
        this.syncControls();
        this.renderPreview((performance.now() - this.startTime) / 1000);
      });
      this.presetGrid.appendChild(btn);
    }

    // 2. Quick color palettes
    this.paletteRow.innerHTML = '';
    for (const pal of BUBBLE_COLOR_PALETTES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bubble-palette-swatch';
      btn.title = pal.name;
      btn.setAttribute('aria-label', pal.name);
      btn.style.background = `linear-gradient(135deg, ${pal.bgColor} 52%, ${pal.accentColor} 52%)`;
      btn.style.borderColor = pal.accentColor;
      btn.addEventListener('click', () => {
        this.draft = {
          ...this.draft,
          bgColor: pal.bgColor,
          accentColor: pal.accentColor,
          textColor: pal.textColor,
        };
        this.syncControls();
      });
      this.paletteRow.appendChild(btn);
    }

    // 3. Tail pills
    this.tailGroup.innerHTML = '';
    for (const tail of BUBBLE_TAIL_STYLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bubble-pill-opt';
      btn.dataset.tail = tail;
      btn.textContent = TAIL_LABELS[tail];
      btn.addEventListener('click', () => {
        this.draft = { ...this.draft, tail };
        this.syncControls();
      });
      this.tailGroup.appendChild(btn);
    }

    // 4. Font pills
    this.fontGroup.innerHTML = '';
    for (const font of BUBBLE_FONT_STYLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `bubble-pill-opt bubble-font-${font}`;
      btn.dataset.font = font;
      btn.textContent = FONT_LABELS[font];
      btn.addEventListener('click', () => {
        this.draft = { ...this.draft, font };
        this.syncControls();
      });
      this.fontGroup.appendChild(btn);
    }

    // 5. Effect pills
    this.effectGroup.innerHTML = '';
    for (const effect of BUBBLE_EFFECTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bubble-pill-opt';
      btn.dataset.effect = effect;
      btn.textContent = EFFECT_LABELS[effect];
      btn.addEventListener('click', () => {
        this.draft = { ...this.draft, effect };
        this.syncControls();
      });
      this.effectGroup.appendChild(btn);
    }

    // 6. Flair badges
    this.badgeGroup.innerHTML = '';
    for (const badge of BUBBLE_FLAIR_BADGES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bubble-badge-opt';
      btn.dataset.badge = badge;
      btn.textContent = badge || 'None';
      btn.title = badge ? `Use ${badge} flair` : 'No flair icon';
      btn.addEventListener('click', () => {
        if (badge) {
          this.draft = { ...this.draft, badge };
        } else {
          const { badge: _dropped, ...rest } = this.draft;
          this.draft = rest;
        }
        this.syncControls();
      });
      this.badgeGroup.appendChild(btn);
    }
  }

  private bindEvents(): void {
    for (const btn of this.modeButtons) {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.bubblePreviewMode as BubbleContentMode;
        if (mode === 'text' || mode === 'voice' || mode === 'typing') {
          this.previewMode = mode;
          this.syncControls();
        }
      });
    }

    this.bgColorInput.addEventListener('input', () => {
      this.draft = { ...this.draft, bgColor: this.bgColorInput.value };
    });
    this.accentColorInput.addEventListener('input', () => {
      this.draft = { ...this.draft, accentColor: this.accentColorInput.value };
    });
    this.textColorInput.addEventListener('input', () => {
      this.draft = { ...this.draft, textColor: this.textColorInput.value };
    });

    this.matchAvatarBtn.addEventListener('click', () => {
      this.draft = { ...this.draft, accentColor: this.callbacks.getAvatarColor() };
      this.syncControls();
    });

    this.saveBtn.addEventListener('click', () => {
      this.callbacks.onSave({ ...this.draft }, this.sampleInput.value.trim());
      this.callbacks.onClose(false);
    });
  }

  private syncControls(): void {
    for (const btn of this.modeButtons) {
      const active = btn.dataset.bubblePreviewMode === this.previewMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }

    this.presetGrid.querySelectorAll<HTMLButtonElement>('.bubble-preset-card').forEach((btn) => {
      const active = btn.dataset.presetId === this.draft.preset;
      btn.classList.toggle('selected', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    this.bgColorInput.value = this.draft.bgColor;
    this.accentColorInput.value = this.draft.accentColor;
    this.textColorInput.value = this.draft.textColor;

    this.tailGroup.querySelectorAll<HTMLButtonElement>('[data-tail]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tail === this.draft.tail);
    });
    this.fontGroup.querySelectorAll<HTMLButtonElement>('[data-font]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.font === this.draft.font);
    });
    this.effectGroup.querySelectorAll<HTMLButtonElement>('[data-effect]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.effect === this.draft.effect);
    });
    const currentBadge = this.draft.badge ?? '';
    this.badgeGroup.querySelectorAll<HTMLButtonElement>('[data-badge]').forEach((btn) => {
      btn.classList.toggle('active', (btn.dataset.badge ?? '') === currentBadge);
    });
  }

  private startLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    let lastDraw = 0;
    const tick = (now: number) => {
      if (!this.open) return;
      this.rafId = requestAnimationFrame(tick);
      if (now - lastDraw < 33) return;
      lastDraw = now;
      this.renderPreview((now - this.startTime) / 1000);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private renderPreview(elapsed: number): void {
    const sample = this.sampleInput.value.trim() || 'Meet me by the portal!';
    const syntheticVoice = 0.48 + 0.36 * Math.sin(elapsed * 4.2) * Math.cos(elapsed * 2.1);
    renderSpeechBubbleToCanvas(this.previewCanvas, {
      mode: this.previewMode,
      text: sample,
      style: this.draft,
      voiceLevel: Math.max(0.15, Math.min(1, syntheticVoice)),
      speaking: this.previewMode === 'voice',
      time: elapsed,
      canvasWidth: 720,
      fixedHeight: 320,
    });
  }
}
