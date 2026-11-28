import type { SpeechBubbleStyle } from '../types';
import { bubbleFontStack, createDefaultBubbleStyle } from './bubbleStyles';

export type BubbleContentMode = 'text' | 'voice' | 'typing';

export interface RenderSpeechBubbleOptions {
  mode: BubbleContentMode;
  text?: string;
  style: SpeechBubbleStyle;
  /** 0..1 live microphone amplitude when speaking. */
  voiceLevel?: number;
  /** Whether the speaker is also talking on voice while showing a text bubble. */
  speaking?: boolean;
  /** Elapsed time in seconds for animated shimmer / sparkles / voice bars / typing dots. */
  time?: number;
  /** Optional canvas width override (default 768 for crisp 3D sprites). */
  canvasWidth?: number;
  /**
   * Optional fixed canvas height (e.g. 384 for 3D WebGPU CanvasTextures so GPU texture
   * dimensions never change between messages). When set, the bubble anchors cleanly near the bottom.
   */
  fixedHeight?: number;
}

export interface RenderedBubbleMetrics {
  width: number;
  height: number;
  lineCount: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return [14, 24, 48];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function shiftHueRgb(hex: string): [string, string] {
  const [r, g, b] = hexToRgb(hex);
  const c1 = `rgb(${Math.min(255, Math.round(b * 0.75 + 65))}, ${Math.min(255, Math.round(r * 0.8 + 45))}, ${Math.min(255, Math.round(g * 0.85 + 75))})`;
  const c2 = `rgb(${Math.min(255, Math.round(g * 0.75 + 65))}, ${Math.min(255, Math.round(b * 0.8 + 55))}, ${Math.min(255, Math.round(r * 0.85 + 75))})`;
  return [c1, c2];
}

/** Pure word-wrapping helper (also usable headless without Canvas). */
export function wrapBubbleTextByChars(text: string, maxCharsPerLine = 28, maxLines = 4): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return [''];
  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  const pushWord = (word: string) => {
    const chars = Array.from(word);
    if (!current) {
      if (chars.length <= maxCharsPerLine) {
        current = word;
        return;
      }
      for (let i = 0; i < chars.length; i += maxCharsPerLine) {
        const chunk = chars.slice(i, i + maxCharsPerLine).join('');
        if (current) lines.push(current);
        current = chunk;
      }
      return;
    }
    if (Array.from(current).length + 1 + chars.length <= maxCharsPerLine) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = '';
      pushWord(word);
    }
  };

  for (const w of words) pushWord(w);
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = Array.from(kept[maxLines - 1]);
  kept[maxLines - 1] = `${last.slice(0, Math.max(1, maxCharsPerLine - 1)).join('').trimEnd()}…`;
  return kept;
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 4,
): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return [''];
  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  const breakLongWord = (word: string): void => {
    const chars = Array.from(word);
    let chunk = '';
    for (const ch of chars) {
      const next = chunk + ch;
      if (chunk && ctx.measureText(next).width > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else if (!current) {
      breakLongWord(word);
    } else {
      lines.push(current);
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        current = '';
        breakLongWord(word);
      }
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  let last = trimmed[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = Array.from(last).slice(0, -1).join('').trimEnd();
  }
  trimmed[maxLines - 1] = `${last}…`;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Shape Paths
// ---------------------------------------------------------------------------

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function traceChamferedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  chamfer: number,
): void {
  const c = Math.min(chamfer, w * 0.25, h * 0.35);
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

function tracePixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
): void {
  const s = step;
  const s2 = step * 2;
  ctx.beginPath();
  ctx.moveTo(x + s2, y);
  ctx.lineTo(x + w - s2, y);
  ctx.lineTo(x + w - s2, y + s);
  ctx.lineTo(x + w - s, y + s);
  ctx.lineTo(x + w - s, y + s2);
  ctx.lineTo(x + w, y + s2);
  ctx.lineTo(x + w, y + h - s2);
  ctx.lineTo(x + w - s, y + h - s2);
  ctx.lineTo(x + w - s, y + h - s);
  ctx.lineTo(x + w - s2, y + h - s);
  ctx.lineTo(x + w - s2, y + h);
  ctx.lineTo(x + s2, y + h);
  ctx.lineTo(x + s2, y + h - s);
  ctx.lineTo(x + s, y + h - s);
  ctx.lineTo(x + s, y + h - s2);
  ctx.lineTo(x, y + h - s2);
  ctx.lineTo(x, y + s2);
  ctx.lineTo(x + s, y + s2);
  ctx.lineTo(x + s, y + s);
  ctx.lineTo(x + s2, y + s);
  ctx.closePath();
}

function traceCloudShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w * 0.48;
  const ry = h * 0.45;
  const bumps = Math.max(12, Math.min(20, Math.round((w + h) / 48)));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2;
    pts.push({
      x: cx + Math.cos(a) * rx,
      y: cy + Math.sin(a) * ry,
    });
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < bumps; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % bumps];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    const dx = midX - cx;
    const dy = midY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const puff = 15 + ((i * 7) % 5) * 1.8;
    ctx.quadraticCurveTo(midX + (dx / dist) * puff, midY + (dy / dist) * puff, p1.x, p1.y);
  }
  ctx.closePath();
}

function traceShoutBurst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w * 0.49;
  const ry = h * 0.47;
  const spikes = 16;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const isOuter = i % 2 === 0;
    const jitter = ((i * 13) % 5) * 0.018;
    const scale = isOuter ? 1.07 + jitter : 0.89 - jitter * 0.5;
    const px = cx + Math.cos(a) * rx * scale;
    const py = cy + Math.sin(a) * ry * scale;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceBubbleShape(
  ctx: CanvasRenderingContext2D,
  preset: SpeechBubbleStyle['preset'],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  switch (preset) {
    case 'thought':
      traceCloudShape(ctx, x, y, w, h);
      break;
    case 'cyber':
      traceChamferedRect(ctx, x, y, w, h, 26);
      break;
    case 'shout':
      traceShoutBurst(ctx, x, y, w, h);
      break;
    case 'pixel':
      tracePixelRect(ctx, x, y, w, h, 10);
      break;
    case 'parchment':
      traceRoundedRect(ctx, x, y, w, h, 18);
      break;
    case 'comic':
      traceRoundedRect(ctx, x, y, w, h, 36);
      break;
    case 'aurora':
    case 'glass':
    default:
      traceRoundedRect(ctx, x, y, w, h, 34);
      break;
  }
}

function drawTail(
  ctx: CanvasRenderingContext2D,
  style: SpeechBubbleStyle,
  cx: number,
  bottomY: number,
  fillStyle: string | CanvasGradient,
  strokeStyle: string,
  lineWidth: number,
): void {
  if (style.tail === 'none') return;

  if (style.tail === 'dots') {
    const dots = [
      { x: cx - 8, y: bottomY + 14, r: 12 },
      { x: cx - 22, y: bottomY + 34, r: 8 },
      { x: cx - 32, y: bottomY + 49, r: 5 },
    ];
    for (const d of dots) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.lineWidth = Math.max(3, lineWidth * 0.72);
      ctx.strokeStyle = strokeStyle;
      ctx.stroke();
    }
    return;
  }

  if (style.preset === 'pixel') {
    const s = 10;
    ctx.beginPath();
    ctx.moveTo(cx - s * 2, bottomY - 4);
    ctx.lineTo(cx + s, bottomY - 4);
    ctx.lineTo(cx + s, bottomY + s);
    ctx.lineTo(cx, bottomY + s);
    ctx.lineTo(cx, bottomY + s * 2);
    ctx.lineTo(cx - s, bottomY + s * 2);
    ctx.lineTo(cx - s, bottomY + s * 3);
    ctx.lineTo(cx - s * 2, bottomY + s * 3);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
    // Cover seam inside bubble
    ctx.fillStyle = fillStyle;
    ctx.fillRect(cx - s * 2 + 2, bottomY - 12, s * 3 - 4, 14);
    return;
  }

  ctx.beginPath();
  if (style.tail === 'sharp') {
    ctx.moveTo(cx - 22, bottomY - 5);
    ctx.lineTo(cx - 34, bottomY + 42);
    ctx.lineTo(cx + 14, bottomY - 5);
  } else {
    // Curved expressive tail
    ctx.moveTo(cx - 24, bottomY - 5);
    ctx.quadraticCurveTo(cx - 22, bottomY + 26, cx - 42, bottomY + 42);
    ctx.quadraticCurveTo(cx - 4, bottomY + 30, cx + 16, bottomY - 5);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = strokeStyle;
  ctx.stroke();
}

function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const inner = radius * 0.28;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? radius : inner;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMicIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  // Capsule
  traceRoundedRect(ctx, -6, -15, 12, 19, 6);
  ctx.fill();
  // Stand arc
  ctx.beginPath();
  ctx.arc(0, -1, 11, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  // Stem + foot
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.lineTo(0, 16);
  ctx.moveTo(-6, 16);
  ctx.lineTo(6, 16);
  ctx.stroke();
  ctx.restore();
}

function drawEqualizerBars(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  level: number,
  time: number,
  accent: string,
  textColor: string,
  compact = false,
): void {
  const barCount = compact ? 4 : 7;
  const barW = compact ? 6 : 12;
  const gap = compact ? 5 : 10;
  const maxH = compact ? 26 : 52;
  const minH = compact ? 7 : 12;
  const totalW = barCount * barW + (barCount - 1) * gap;
  const startX = cx - totalW / 2;

  for (let i = 0; i < barCount; i++) {
    const normCenter = 1 - Math.abs(i - (barCount - 1) / 2) / ((barCount - 1) / 2 + 0.4);
    const wave = 0.5 + 0.5 * Math.sin(time * (7.5 + i * 1.4) + i * 1.15);
    const amp = Math.min(1, 0.18 + level * 0.95 * (0.55 + 0.45 * wave) * (0.65 + 0.35 * normCenter));
    const h = minH + (maxH - minH) * amp;
    const x = startX + i * (barW + gap);
    const y = cy - h / 2;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, textColor);
    grad.addColorStop(1, accent);
    ctx.fillStyle = grad;
    traceRoundedRect(ctx, x, y, barW, h, barW / 2);
    ctx.fill();
  }
}

/**
 * Draws a customizable Portalverse speech bubble onto any HTMLCanvasElement.
 * Shared 1:1 between 3D world avatar sprites and the Bubble Customizer preview.
 */
export function renderSpeechBubbleToCanvas(
  canvas: HTMLCanvasElement,
  options: RenderSpeechBubbleOptions,
): RenderedBubbleMetrics {
  const ctx = canvas.getContext('2d');
  const style = options.style ?? createDefaultBubbleStyle();
  const time = options.time ?? 0;
  const canvasW = options.canvasWidth ?? 768;

  if (!ctx) {
    return { width: canvasW, height: 240, lineCount: 1 };
  }

  const baseFontSize = style.font === 'serif' ? 36 : style.font === 'mono' ? 31 : 33;
  const fontWeight = style.font === 'comic' ? '800' : style.font === 'serif' ? '600' : '700';
  const fontStack = bubbleFontStack(style.font);

  // Generous outer margins so cloud puffs, shout burst spikes, drop shadows, and tails never clip.
  const outerMarginX = style.preset === 'shout' || style.preset === 'thought' ? 56 : 44;
  const outerMarginTop = style.preset === 'shout' || style.preset === 'thought' ? 52 : 40;
  const tailSpace = style.tail === 'none' ? 34 : style.tail === 'dots' ? 72 : 62;

  const badgeText = style.badge?.trim() || '';
  let fontSize = baseFontSize;
  let fontDecl = `${fontWeight} ${fontSize}px ${fontStack}`;
  let lineHeight = Math.round(fontSize * 1.28);
  let padSide = style.preset === 'shout' || style.preset === 'thought' ? 62 : 44;
  let padVert = style.preset === 'shout' || style.preset === 'thought' ? 40 : 30;

  let lines: string[] = [];
  let boxW = 300;
  let boxH = 120;

  if (options.mode === 'voice') {
    boxW = badgeText ? 340 : 292;
    boxH = 114;
    lines = [''];
  } else if (options.mode === 'typing') {
    boxW = 200;
    boxH = 98;
    lines = [''];
  } else {
    const rawText = options.text?.trim() || '…';
    const displayText = badgeText ? `${badgeText} ${rawText}` : rawText;
    const speakingReserve = options.speaking ? 54 : 0;
    const minBoxW = style.preset === 'shout' ? 270 : 210;
    const maxAllowedBoxH = options.fixedHeight
      ? Math.max(106, options.fixedHeight - outerMarginTop - tailSpace)
      : Infinity;

    // Auto-scale font size down when needed so 3-4 line messages always fit strictly inside
    // fixedHeight without clipping cloud puffs, shout spikes, or mutating WebGPU texture height.
    for (let attempt = 0; attempt < 8; attempt++) {
      fontDecl = `${fontWeight} ${fontSize}px ${fontStack}`;
      lineHeight = Math.round(fontSize * 1.26);
      padSide = style.preset === 'shout' || style.preset === 'thought'
        ? Math.max(46, Math.round(fontSize * 1.65))
        : Math.max(36, Math.round(fontSize * 1.3));
      padVert = style.preset === 'shout' || style.preset === 'thought'
        ? Math.max(28, Math.round(fontSize * 1.05))
        : Math.max(22, Math.round(fontSize * 0.86));

      ctx.font = fontDecl;
      const maxTextW = Math.max(180, canvasW - (outerMarginX + padSide) * 2 - speakingReserve);
      lines = wrapCanvasText(ctx, displayText, maxTextW, 4);
      let widest = 0;
      for (const line of lines) {
        widest = Math.max(widest, ctx.measureText(line).width);
      }
      boxW = Math.min(
        canvasW - outerMarginX * 2,
        Math.max(minBoxW, Math.ceil(widest + padSide * 2 + speakingReserve)),
      );
      boxH = Math.max(102, lines.length * lineHeight + padVert * 2);
      if (boxH <= maxAllowedBoxH || fontSize <= 20) break;
      fontSize = Math.max(20, fontSize - 2);
    }
  }

  const naturalH = Math.max(196, Math.ceil(outerMarginTop + boxH + tailSpace));
  const canvasH = options.fixedHeight ?? naturalH;
  if (canvas.width !== canvasW) canvas.width = canvasW;
  if (canvas.height !== canvasH) canvas.height = canvasH;

  ctx.clearRect(0, 0, canvasW, canvasH);

  const bx = Math.round((canvasW - boxW) / 2);
  const by = options.fixedHeight
    ? Math.max(outerMarginTop, canvasH - tailSpace - boxH)
    : outerMarginTop;
  const cx = canvasW / 2;

  // Build fill style per preset
  let fillStyle: string | CanvasGradient = style.bgColor;
  if (style.preset === 'glass') {
    const grad = ctx.createLinearGradient(bx, by, bx, by + boxH);
    grad.addColorStop(0, rgba(mixHex(style.bgColor, '#ffffff', 0.14), 0.9));
    grad.addColorStop(1, rgba(style.bgColor, 0.88));
    fillStyle = grad;
  } else if (style.preset === 'aurora') {
    const shift = Math.sin(time * 1.1) * 0.08;
    const richGrad = ctx.createLinearGradient(bx, by, bx + boxW, by + boxH);
    richGrad.addColorStop(0, rgba(style.bgColor, 0.94));
    richGrad.addColorStop(0.5 + shift, mixHex(style.bgColor, style.accentColor, 0.34));
    richGrad.addColorStop(1, rgba(style.bgColor, 0.96));
    fillStyle = richGrad;
  } else if (style.preset === 'parchment') {
    const grad = ctx.createRadialGradient(cx, by + boxH * 0.42, 10, cx, by + boxH * 0.5, boxW * 0.65);
    grad.addColorStop(0, mixHex(style.bgColor, style.accentColor, 0.14));
    grad.addColorStop(1, style.bgColor);
    fillStyle = grad;
  } else if (style.preset === 'cyber') {
    const grad = ctx.createLinearGradient(bx, by, bx + boxW, by + boxH);
    grad.addColorStop(0, rgba(style.bgColor, 0.94));
    grad.addColorStop(1, rgba(mixHex(style.bgColor, style.accentColor, 0.12), 0.94));
    fillStyle = grad;
  }

  const borderColor =
    style.preset === 'comic' || style.preset === 'shout' ? '#111827' : style.accentColor;
  const borderWidth =
    style.preset === 'comic' || style.preset === 'shout'
      ? 7
      : style.preset === 'pixel'
        ? 6
        : 5;

  // Hard comic shadow for comic / shout / pixel
  if (style.preset === 'comic' || style.preset === 'shout') {
    ctx.save();
    ctx.translate(9, 10);
    traceBubbleShape(ctx, style.preset, bx, by, boxW, boxH);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.68)';
    ctx.fill();
    ctx.restore();
  } else if (style.preset === 'pixel') {
    ctx.save();
    ctx.translate(8, 8);
    traceBubbleShape(ctx, style.preset, bx, by, boxW, boxH);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fill();
    ctx.restore();
  }

  // Tail behind main bubble body so outline joins seamlessly
  ctx.save();
  if (style.effect === 'glow' || style.preset === 'cyber' || style.preset === 'aurora') {
    ctx.shadowColor = style.accentColor;
    ctx.shadowBlur = style.effect === 'glow' ? 24 : 14;
  }
  drawTail(ctx, style, cx, by + boxH, fillStyle, borderColor, borderWidth);
  ctx.restore();

  // Main body fill & outer glow
  ctx.save();
  traceBubbleShape(ctx, style.preset, bx, by, boxW, boxH);
  if (style.effect === 'glow') {
    ctx.shadowColor = style.accentColor;
    ctx.shadowBlur = 28;
  } else if (style.preset === 'glass' || style.preset === 'aurora' || style.preset === 'cyber') {
    ctx.shadowColor = style.accentColor;
    ctx.shadowBlur = 14;
  } else {
    ctx.shadowColor = 'rgba(2, 6, 23, 0.45)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
  }
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.restore();

  // Clipped interior styling & animated shimmer
  ctx.save();
  traceBubbleShape(ctx, style.preset, bx, by, boxW, boxH);
  ctx.clip();

  if (style.preset === 'glass') {
    // Top glass refraction highlight
    const sheen = ctx.createLinearGradient(bx, by, bx, by + boxH * 0.45);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(bx, by, boxW, boxH * 0.45);
  } else if (style.preset === 'comic') {
    // Comic Ben-Day halftone dots in the corner
    ctx.fillStyle = rgba(style.accentColor, 0.26);
    const spacing = 14;
    for (let gy = by + boxH - 54; gy < by + boxH; gy += spacing) {
      for (let gx = bx + boxW - 140; gx < bx + boxW; gx += spacing) {
        const t = ((gx - (bx + boxW - 140)) / 140 + (gy - (by + boxH - 54)) / 54) * 0.5;
        const r = Math.max(1.2, t * 4.2);
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Inner colorful accent rim
    traceRoundedRect(ctx, bx + 9, by + 9, boxW - 18, boxH - 18, 28);
    ctx.lineWidth = 4;
    ctx.strokeStyle = rgba(style.accentColor, 0.75);
    ctx.stroke();
  } else if (style.preset === 'cyber') {
    // Subtle scanlines
    ctx.fillStyle = rgba(style.accentColor, 0.08);
    for (let sy = by; sy < by + boxH; sy += 7) {
      ctx.fillRect(bx, sy, boxW, 2);
    }
    // Tactical corner ticks
    ctx.strokeStyle = style.accentColor;
    ctx.lineWidth = 5;
    const len = 24;
    // Top-left & bottom-right brackets
    ctx.beginPath();
    ctx.moveTo(bx + 14, by + 32);
    ctx.lineTo(bx + 14, by + 14);
    ctx.lineTo(bx + 14 + len, by + 14);
    ctx.moveTo(bx + boxW - 14 - len, by + boxH - 14);
    ctx.lineTo(bx + boxW - 14, by + boxH - 14);
    ctx.lineTo(bx + boxW - 14, by + boxH - 32);
    ctx.stroke();
  } else if (style.preset === 'shout') {
    // Accent energy ring inside starburst
    ctx.strokeStyle = rgba(style.accentColor, 0.55);
    ctx.lineWidth = 10;
    traceShoutBurst(ctx, bx + 10, by + 10, boxW - 20, boxH - 20);
    ctx.stroke();
  } else if (style.preset === 'pixel') {
    // Classic 8-bit inner bevel highlight & shadow
    ctx.fillStyle = rgba('#ffffff', 0.16);
    ctx.fillRect(bx + 20, by + 8, boxW - 40, 6);
    ctx.fillStyle = rgba(style.accentColor, 0.22);
    ctx.fillRect(bx + 20, by + boxH - 14, boxW - 40, 6);
  } else if (style.preset === 'parchment') {
    // Ornate inner hairline border + corner diamonds
    traceRoundedRect(ctx, bx + 13, by + 13, boxW - 26, boxH - 26, 11);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = rgba(style.accentColor, 0.65);
    ctx.stroke();
    const corners: Array<[number, number]> = [
      [bx + 24, by + 24],
      [bx + boxW - 24, by + 24],
      [bx + 24, by + boxH - 24],
      [bx + boxW - 24, by + boxH - 24],
    ];
    for (const [fx, fy] of corners) {
      drawFourPointStar(ctx, fx, fy, 8, style.accentColor, 0.9);
    }
  } else if (style.preset === 'thought') {
    // Soft cloud highlight on top edge
    const cloudGlow = ctx.createLinearGradient(bx, by, bx, by + boxH * 0.5);
    cloudGlow.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    cloudGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = cloudGlow;
    ctx.fillRect(bx, by, boxW, boxH * 0.5);
  } else if (style.preset === 'aurora') {
    // Diagonal iridescent ribbon
    const [h1, h2] = shiftHueRgb(style.accentColor);
    const waveOffset = Math.sin(time * 1.4) * 36;
    const ribbon = ctx.createLinearGradient(bx + waveOffset, by, bx + boxW + waveOffset, by + boxH);
    ribbon.addColorStop(0, 'rgba(255,255,255,0)');
    ribbon.addColorStop(0.35, h1);
    ribbon.addColorStop(0.65, h2);
    ribbon.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = ribbon;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.globalAlpha = 1;
  }

  // Shimmer sweep effect
  if (style.effect === 'shimmer') {
    const sweep = ((time * 0.45) % 1.6) - 0.3;
    const sx = bx + sweep * (boxW + 160) - 80;
    const shim = ctx.createLinearGradient(sx - 60, by, sx + 60, by + boxH);
    shim.addColorStop(0, 'rgba(255, 255, 255, 0)');
    shim.addColorStop(0.5, rgba(style.accentColor, 0.26));
    shim.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shim;
    ctx.fillRect(bx, by, boxW, boxH);
  }

  ctx.restore();

  // Crisp outer border stroke
  ctx.save();
  traceBubbleShape(ctx, style.preset, bx, by, boxW, boxH);
  if (style.preset === 'aurora') {
    const [h1, h2] = shiftHueRgb(style.accentColor);
    const bGrad = ctx.createLinearGradient(bx, by, bx + boxW, by + boxH);
    bGrad.addColorStop(0, style.accentColor);
    bGrad.addColorStop(0.5, h1);
    bGrad.addColorStop(1, h2);
    ctx.strokeStyle = bGrad;
  } else {
    ctx.strokeStyle = borderColor;
  }
  ctx.lineWidth = borderWidth;
  ctx.lineJoin = style.preset === 'pixel' ? 'miter' : 'round';
  ctx.stroke();
  ctx.restore();

  // Cover top seam of tail cleanly for curved/sharp tails
  if (style.tail === 'curved' || style.tail === 'sharp') {
    ctx.save();
    ctx.fillStyle = fillStyle;
    ctx.fillRect(cx - 22, by + boxH - 12, 36, 11);
    ctx.restore();
  }

  // Top accent bar for Portal Glass & Cyber
  if (style.preset === 'glass' || style.preset === 'cyber') {
    ctx.save();
    const barW = Math.min(110, boxW * 0.3);
    traceRoundedRect(ctx, cx - barW / 2, by + 9, barW, 5, 2.5);
    ctx.fillStyle = style.accentColor;
    ctx.fill();
    ctx.restore();
  }

  // Sparkle effect stars around outer corners
  if (style.effect === 'sparkle') {
    const stars: Array<[number, number, number, number]> = [
      [bx + 18, by + 12, 13, 0],
      [bx + boxW - 16, by + 16, 11, 1.8],
      [bx + boxW - 26, by + boxH - 14, 10, 3.4],
      [bx + 26, by + boxH - 16, 9, 5.1],
    ];
    for (const [sx, sy, sr, ph] of stars) {
      const twinkle = 0.45 + 0.55 * Math.sin(time * 3.8 + ph);
      drawFourPointStar(ctx, sx, sy, sr * (0.7 + 0.35 * twinkle), style.accentColor, 0.55 + 0.45 * twinkle);
      drawFourPointStar(ctx, sx, sy, sr * 0.42, '#ffffff', 0.75 * twinkle);
    }
  }

  // Content rendering
  const contentCy = by + boxH / 2;

  if (options.mode === 'voice') {
    const level = Math.max(0, Math.min(1, options.voiceLevel ?? 0.5));
    if (badgeText) {
      ctx.font = `700 32px ${bubbleFontStack(style.font)}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = style.textColor;
      ctx.fillText(badgeText, bx + 54, contentCy);
    }
    const micX = badgeText ? bx + 106 : bx + 64;
    drawMicIcon(ctx, micX, contentCy, 1.15, style.accentColor);
    drawEqualizerBars(ctx, cx + (badgeText ? 48 : 30), contentCy, level, time, style.accentColor, style.textColor, false);
  } else if (options.mode === 'typing') {
    const dotR = 10;
    const gap = 30;
    for (let i = 0; i < 3; i++) {
      const bounce = Math.sin(time * 5.2 - i * 0.85);
      const dy = Math.min(0, -bounce * 9);
      const alpha = 0.5 + 0.5 * Math.max(0, bounce);
      ctx.beginPath();
      ctx.arc(cx + (i - 1) * gap, contentCy + dy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = mixHex(style.accentColor, style.textColor, 0.35);
      ctx.globalAlpha = alpha;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.font = fontDecl;
    ctx.fillStyle = style.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textCenterX = options.speaking ? cx - 22 : cx;
    const totalTextH = lines.length * lineHeight;
    const firstLineY = contentCy - totalTextH / 2 + lineHeight / 2;

    if (style.preset === 'glass' || style.preset === 'cyber' || style.preset === 'aurora') {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 4;
    }
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textCenterX, firstLineY + i * lineHeight, boxW - padSide * 1.6);
    }
    ctx.shadowBlur = 0;

    if (options.speaking) {
      drawEqualizerBars(
        ctx,
        bx + boxW - padSide * 0.65 - 8,
        contentCy,
        Math.max(0.25, options.voiceLevel ?? 0.6),
        time,
        style.accentColor,
        style.textColor,
        true,
      );
    }
  }

  return { width: canvasW, height: canvasH, lineCount: lines.length };
}
