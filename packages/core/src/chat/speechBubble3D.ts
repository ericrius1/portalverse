import * as THREE from 'three/webgpu';
import type { SpeechBubbleStyle } from '../types';
import { computeBubbleDurationSeconds, createDefaultBubbleStyle } from './bubbleStyles';
import { renderSpeechBubbleToCanvas, type BubbleContentMode } from './speechBubbleCanvas';

export interface AvatarSpeechBubbleOptions {
  /** Base height above avatar feet (Y = 0) where the bubble rests (typically labelHeight + 0.72). */
  baseHeight: number;
  style?: SpeechBubbleStyle;
}

const VOICE_HOLD_SECONDS = 0.45;
const POP_IN_SECONDS = 0.24;
const FADE_OUT_SECONDS = 0.45;
const ANIMATED_REDRAW_INTERVAL = 1 / 12;
/** Fixed WebGPU-safe CanvasTexture dimensions (bubble bottom-anchors inside this frame). */
const SPRITE_CANVAS_W = 768;
const SPRITE_CANVAS_H = 400;

/**
 * Floating 3D WebGPU-safe speech bubble attached above an avatar.
 * Renders text chat bubbles, live voice-speaking equalizer bubbles, and typing bubbles
 * using the player's customized SpeechBubbleStyle.
 */
export class AvatarSpeechBubble {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private readonly canvas: HTMLCanvasElement | null;
  private readonly texture: THREE.CanvasTexture | null;

  private baseHeight: number;
  private style: SpeechBubbleStyle;

  private activeText: string | null = null;
  private textAge = 0;
  private textDuration = 6;

  private voiceSpeaking = false;
  private voiceHoldTimer = 0;
  private voiceLevel = 0;

  private typingActive = false;

  private currentMode: BubbleContentMode | null = null;
  private modeAge = 0;
  private redrawAccum = 0;
  private dirty = false;
  private worldWidth = 3.2;
  private worldHeight = 1.0;

  constructor(options: AvatarSpeechBubbleOptions) {
    this.baseHeight = options.baseHeight;
    this.style = options.style ? { ...options.style } : createDefaultBubbleStyle();

    let canvas: HTMLCanvasElement | null = null;
    let texture: THREE.CanvasTexture | null = null;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const el = document.createElement('canvas');
      if (typeof el.getContext === 'function' && el.getContext('2d')) {
        canvas = el;
        canvas.width = SPRITE_CANVAS_W;
        canvas.height = SPRITE_CANVAS_H;
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
      }
    }

    this.canvas = canvas;
    this.texture = texture;
    this.material = new THREE.SpriteMaterial({
      ...(texture ? { map: texture } : {}),
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.visible = false;
    this.sprite.position.set(0, this.baseHeight, 0);
    this.sprite.renderOrder = 20;
  }

  getActiveMode(): BubbleContentMode | null {
    return this.currentMode;
  }

  getActiveText(): string | null {
    return this.activeText;
  }

  getStyle(): SpeechBubbleStyle {
    return { ...this.style };
  }

  setBaseHeight(height: number): void {
    this.baseHeight = height;
    this.sprite.position.y = height + this.worldHeight * 0.42;
  }

  setStyle(style: SpeechBubbleStyle): void {
    this.style = { ...style };
    if (this.currentMode) this.dirty = true;
  }

  showText(text: string, style?: SpeechBubbleStyle, durationSeconds?: number): void {
    const clean = text.trim();
    if (!clean) return;
    if (style) this.style = { ...style };
    this.activeText = clean;
    this.textAge = 0;
    this.textDuration = durationSeconds ?? computeBubbleDurationSeconds(clean);
    this.typingActive = false;
    this.currentMode = 'text';
    this.modeAge = 0;
    this.dirty = true;
    this.redraw(0);
  }

  setVoiceState(speaking: boolean, level: number, style?: SpeechBubbleStyle): void {
    if (style) this.style = { ...style };
    this.voiceLevel = Math.max(0, Math.min(1, level));
    if (speaking) {
      this.voiceSpeaking = true;
      this.voiceHoldTimer = VOICE_HOLD_SECONDS;
      if (!this.activeText && this.currentMode !== 'voice') {
        this.currentMode = 'voice';
        this.modeAge = 0;
        this.dirty = true;
      }
    } else if (this.voiceHoldTimer <= 0) {
      this.voiceSpeaking = false;
    }
  }

  setTyping(typing: boolean, style?: SpeechBubbleStyle): void {
    if (style) this.style = { ...style };
    if (this.typingActive === typing) return;
    this.typingActive = typing;
    if (typing && !this.activeText && !this.voiceSpeaking) {
      this.currentMode = 'typing';
      this.modeAge = 0;
      this.dirty = true;
    }
  }

  update(dt: number, elapsed: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1);

    if (this.voiceHoldTimer > 0) {
      this.voiceHoldTimer = Math.max(0, this.voiceHoldTimer - step);
      if (this.voiceHoldTimer === 0) {
        this.voiceSpeaking = false;
        this.voiceLevel = 0;
      }
    }

    if (this.activeText !== null) {
      this.textAge += step;
      if (this.textAge >= this.textDuration) {
        this.activeText = null;
        this.dirty = true;
      }
    }

    const nextMode: BubbleContentMode | null =
      this.activeText !== null
        ? 'text'
        : this.voiceSpeaking
          ? 'voice'
          : this.typingActive
            ? 'typing'
            : null;

    if (nextMode !== this.currentMode) {
      this.currentMode = nextMode;
      this.modeAge = 0;
      this.dirty = true;
    }

    if (!this.currentMode) {
      this.sprite.visible = false;
      this.material.opacity = 0;
      return;
    }

    this.modeAge += step;
    const needsAnimation =
      this.currentMode === 'voice' ||
      this.currentMode === 'typing' ||
      this.voiceSpeaking ||
      this.style.effect === 'shimmer' ||
      this.style.effect === 'sparkle' ||
      this.style.preset === 'aurora';

    if (needsAnimation) {
      this.redrawAccum += step;
      if (this.redrawAccum >= ANIMATED_REDRAW_INTERVAL) {
        this.redrawAccum = 0;
        this.dirty = true;
      }
    }

    if (this.dirty) {
      this.redraw(elapsed);
    }

    // Spring pop-in scale + smooth fade-out near expiration
    const popT = Math.min(1, this.modeAge / POP_IN_SECONDS);
    // Overshoot ease-out back
    const inv = 1 - popT;
    const popScale = 1 - inv * inv * inv + Math.sin(popT * Math.PI) * 0.08 * (1 - popT * 0.5);

    let fadeAlpha = Math.min(1, popT * 1.4);
    if (this.currentMode === 'text') {
      const remaining = this.textDuration - this.textAge;
      if (remaining < FADE_OUT_SECONDS) {
        fadeAlpha = Math.max(0, remaining / FADE_OUT_SECONDS);
      }
    } else if (this.currentMode === 'voice' && this.voiceHoldTimer < 0.2) {
      fadeAlpha = Math.max(0, this.voiceHoldTimer / 0.2);
    }

    const pulseScale =
      this.style.effect === 'pulse'
        ? 1 + Math.sin(elapsed * 5.2) * 0.035
        : this.currentMode === 'voice'
          ? 1 + this.voiceLevel * 0.06
          : 1;

    const scale = Math.max(0.01, popScale * pulseScale);
    this.sprite.scale.set(this.worldWidth * scale, this.worldHeight * scale, 1);

    const bob = Math.sin(elapsed * 2.4) * 0.045;
    this.sprite.position.y = this.baseHeight + this.worldHeight * 0.42 + bob;
    this.material.opacity = fadeAlpha;
    this.sprite.visible = fadeAlpha > 0.01;
  }

  private redraw(elapsed: number): void {
    this.dirty = false;
    if (!this.currentMode) return;

    if (this.canvas && this.texture) {
      const metrics = renderSpeechBubbleToCanvas(this.canvas, {
        mode: this.currentMode,
        text: this.activeText ?? undefined,
        style: this.style,
        voiceLevel: this.voiceLevel,
        speaking: this.voiceSpeaking,
        time: elapsed,
        canvasWidth: SPRITE_CANVAS_W,
        fixedHeight: SPRITE_CANVAS_H,
      });
      const baseW = this.currentMode === 'text' ? 3.45 : this.currentMode === 'voice' ? 2.85 : 2.55;
      this.worldWidth = baseW;
      this.worldHeight = baseW * (metrics.height / metrics.width);
      this.texture.needsUpdate = true;
    } else {
      this.worldWidth = this.currentMode === 'text' ? 3.2 : 2.4;
      this.worldHeight = 1.65;
    }
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
  }
}
