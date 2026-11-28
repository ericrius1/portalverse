import { describe, expect, it, vi } from 'vitest';
import {
  AvatarSpeechBubble,
  BUBBLE_PRESETS,
  BUBBLE_PRESET_IDS,
  bubbleFontStack,
  computeBubbleDurationSeconds,
  createDefaultBubbleStyle,
  getBubblePreset,
  renderSpeechBubbleToCanvas,
  sanitizeBubbleBadge,
  sanitizeSpeechBubbleStyle,
  wrapBubbleTextByChars,
} from '../chat';

describe('speech bubble styles & sanitization', () => {
  it('exposes 8 distinct customizable presets with valid hex colors', () => {
    expect(BUBBLE_PRESETS).toHaveLength(8);
    expect(new Set(BUBBLE_PRESET_IDS).size).toBe(8);
    for (const preset of BUBBLE_PRESETS) {
      expect(preset.style.bgColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.style.accentColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.style.textColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(getBubblePreset(preset.id).id).toBe(preset.id);
      expect(bubbleFontStack(preset.style.font).length).toBeGreaterThan(5);
    }
  });

  it('uses avatar accent color for default glass bubble style', () => {
    const style = createDefaultBubbleStyle('#f472b6');
    expect(style.preset).toBe('glass');
    expect(style.accentColor).toBe('#f472b6');
  });

  it('sanitizes untrusted styles, normalizes 3-digit hex, and falls back safely on bad fields', () => {
    expect(sanitizeSpeechBubbleStyle(null)).toBeNull();
    expect(sanitizeSpeechBubbleStyle('comic')).toBeNull();
    expect(sanitizeSpeechBubbleStyle([])).toBeNull();

    const clean = sanitizeSpeechBubbleStyle({
      preset: 'cyber',
      bgColor: '#012',
      accentColor: 'url(javascript:alert(1))',
      textColor: '#FFF',
      tail: 'invalid-tail',
      font: 'mono',
      effect: 'sparkle',
      badge: '<script>⚡🔥✨🌟extra</script>',
    });
    expect(clean).not.toBeNull();
    expect(clean!.preset).toBe('cyber');
    expect(clean!.bgColor).toBe('#001122');
    // Falls back to cyber preset accent when invalid
    expect(clean!.accentColor).toBe(getBubblePreset('cyber').style.accentColor);
    expect(clean!.textColor).toBe('#ffffff');
    expect(clean!.tail).toBe('sharp');
    expect(clean!.font).toBe('mono');
    expect(clean!.effect).toBe('sparkle');
    expect(clean!.badge).not.toMatch(/[<>]/);
    expect(Array.from(clean!.badge ?? '').length).toBeLessThanOrEqual(4);
  });

  it('strips control chars and caps flair badge length', () => {
    expect(sanitizeBubbleBadge('  ✨  ')).toBe('✨');
    expect(sanitizeBubbleBadge('<>` \u0000 ')).toBeUndefined();
    expect(sanitizeBubbleBadge('🐝🐉⚡🔥💫')).toBe('🐝🐉⚡🔥');
  });

  it('wraps long text cleanly and scales bubble lifetime with length', () => {
    const lines = wrapBubbleTextByChars('Portalverse WebRTC customizable speech bubbles look super awesome in 3D space!', 20, 3);
    expect(lines.length).toBe(3);
    expect(lines[2].endsWith('…')).toBe(true);

    const shortDur = computeBubbleDurationSeconds('hi');
    const longDur = computeBubbleDurationSeconds('A'.repeat(200));
    expect(shortDur).toBeGreaterThanOrEqual(5);
    expect(longDur).toBeGreaterThan(shortDur);
    expect(longDur).toBeLessThanOrEqual(11.5);
  });
});

describe('AvatarSpeechBubble (headless 3D lifecycle)', () => {
  it('transitions cleanly across typing, voice speaking, and text chat bubbles and expires', () => {
    const style = getBubblePreset('comic').style;
    const bubble = new AvatarSpeechBubble({ baseHeight: 2.5, style });

    expect(bubble.getActiveMode()).toBeNull();
    expect(bubble.sprite.visible).toBe(false);

    // Typing mode
    bubble.setTyping(true, style);
    bubble.update(0.05, 0.05);
    expect(bubble.getActiveMode()).toBe('typing');
    expect(bubble.sprite.visible).toBe(true);

    // Voice speaking overrides typing
    bubble.setVoiceState(true, 0.72, style);
    bubble.update(0.05, 0.1);
    expect(bubble.getActiveMode()).toBe('voice');
    expect(bubble.sprite.visible).toBe(true);

    // Text message overrides voice & clears typing
    bubble.showText('Hey there!', getBubblePreset('shout').style, 1.0);
    bubble.update(0.05, 0.15);
    expect(bubble.getActiveMode()).toBe('text');
    expect(bubble.getActiveText()).toBe('Hey there!');
    expect(bubble.getStyle().preset).toBe('shout');

    // Expire voice hold and text bubble
    bubble.setVoiceState(false, 0);
    for (let i = 0; i < 20; i++) {
      bubble.update(0.08, 0.2 + i * 0.08);
    }
    expect(bubble.getActiveMode()).toBeNull();
    expect(bubble.sprite.visible).toBe(false);

    bubble.dispose();
  });

  it('keeps 3D speech bubble world framing compact and preserves exact fixedHeight on 4-line thought/shout text', () => {
    const style = getBubblePreset('thought').style;
    const bubble = new AvatarSpeechBubble({ baseHeight: 2.06, style });
    bubble.showText(
      "The big window's latched. Sealed. I checked. But there's a draft, cold and sweet, like pine needles and warm honey. Mandu lies in it with his nose up like it's a radio.",
      style,
      6,
    );
    bubble.update(0.3, 0.3);

    // Compact world dimensions ensure the full bubble stays well below the top HUD at talking distance
    expect(bubble.sprite.scale.x).toBeLessThanOrEqual(2.2);
    expect(bubble.sprite.scale.y).toBeLessThanOrEqual(1.2);
    const bubbleTopY = bubble.sprite.position.y + bubble.sprite.scale.y * 0.5;
    expect(bubbleTopY).toBeLessThan(3.25);

    // Verify fixedHeight never mutates canvas dimensions (WebGPU CanvasTexture safety) even on long 4-line text
    const noopGradient = { addColorStop: vi.fn() };
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'round',
      lineCap: 'round',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetY: 0,
      globalAlpha: 1,
      textAlign: 'center',
      textBaseline: 'middle',
      measureText: (s: string) => ({ width: s.length * 16 }),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      clip: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      createLinearGradient: vi.fn(() => noopGradient),
      createRadialGradient: vi.fn(() => noopGradient),
    } as unknown as CanvasRenderingContext2D;
    const fakeCanvas = {
      width: 864,
      height: 448,
      getContext: () => ctx,
    } as unknown as HTMLCanvasElement;

    for (const presetId of ['thought', 'shout', 'comic', 'parchment'] as const) {
      const metrics = renderSpeechBubbleToCanvas(fakeCanvas, {
        mode: 'text',
        text: "The big window's latched. Sealed. I checked. But there's a draft, cold and sweet, like pine needles and warm honey. Mandu lies in it with his nose up like it's a radio.",
        style: getBubblePreset(presetId).style,
        canvasWidth: 864,
        fixedHeight: 448,
      });
      expect(metrics.width).toBe(864);
      expect(metrics.height).toBe(448);
      expect(fakeCanvas.height).toBe(448);
    }

    bubble.dispose();
  });
});
