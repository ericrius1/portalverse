import type {
  BubbleEffect,
  BubbleFontStyle,
  BubblePresetId,
  BubbleTailStyle,
  SpeechBubbleStyle,
} from '../types';

export interface BubblePresetDefinition {
  id: BubblePresetId;
  name: string;
  tagline: string;
  style: SpeechBubbleStyle;
}

export const MAX_CHAT_MESSAGE_LENGTH = 240;
export const MAX_BUBBLE_BADGE_LENGTH = 4;

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS_RE = /[\u0000-\u001f\u007f-\u009f<>`\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

export const BUBBLE_PRESETS: readonly BubblePresetDefinition[] = [
  {
    id: 'glass',
    name: 'Portal Glass',
    tagline: 'Frosted sapphire glass with luminous rim',
    style: {
      preset: 'glass',
      bgColor: '#0a1328',
      accentColor: '#38bdf8',
      textColor: '#f8fafc',
      tail: 'curved',
      font: 'sans',
      effect: 'glow',
    },
  },
  {
    id: 'comic',
    name: 'Pop Comic',
    tagline: 'Bold ink outline, halftone dots & comic punch',
    style: {
      preset: 'comic',
      bgColor: '#fffbeb',
      accentColor: '#f59e0b',
      textColor: '#111827',
      tail: 'sharp',
      font: 'comic',
      effect: 'none',
    },
  },
  {
    id: 'thought',
    name: 'Thought Cloud',
    tagline: 'Puffy scalloped daydream cloud & floating dots',
    style: {
      preset: 'thought',
      bgColor: '#f5f3ff',
      accentColor: '#a78bfa',
      textColor: '#2e1065',
      tail: 'dots',
      font: 'sans',
      effect: 'sparkle',
      badge: '☁️',
    },
  },
  {
    id: 'cyber',
    name: 'Neon Cyber',
    tagline: 'Chamfered HUD brackets, scanlines & electric glow',
    style: {
      preset: 'cyber',
      bgColor: '#060c1a',
      accentColor: '#22d3ee',
      textColor: '#cffafe',
      tail: 'sharp',
      font: 'mono',
      effect: 'shimmer',
      badge: '⚡',
    },
  },
  {
    id: 'shout',
    name: 'Action Shout',
    tagline: 'Explosive jagged comic burst for big energy',
    style: {
      preset: 'shout',
      bgColor: '#fef08a',
      accentColor: '#ef4444',
      textColor: '#18181b',
      tail: 'sharp',
      font: 'comic',
      effect: 'pulse',
      badge: '🔥',
    },
  },
  {
    id: 'pixel',
    name: 'Retro 8-Bit',
    tagline: 'Stepped pixel-art RPG dialogue box',
    style: {
      preset: 'pixel',
      bgColor: '#111827',
      accentColor: '#34d399',
      textColor: '#ecfdf5',
      tail: 'sharp',
      font: 'mono',
      effect: 'none',
    },
  },
  {
    id: 'parchment',
    name: 'Arcane Scroll',
    tagline: 'Gilded royal filigree & storybook calligraphy',
    style: {
      preset: 'parchment',
      bgColor: '#291d12',
      accentColor: '#eab308',
      textColor: '#fef3c7',
      tail: 'curved',
      font: 'serif',
      effect: 'shimmer',
      badge: '✨',
    },
  },
  {
    id: 'aurora',
    name: 'Prism Aurora',
    tagline: 'Iridescent celestial gradient & twinkling stars',
    style: {
      preset: 'aurora',
      bgColor: '#130c2e',
      accentColor: '#e879f9',
      textColor: '#fdf4ff',
      tail: 'curved',
      font: 'sans',
      effect: 'sparkle',
      badge: '💫',
    },
  },
] as const;

export const BUBBLE_PRESET_IDS: readonly BubblePresetId[] = BUBBLE_PRESETS.map((p) => p.id);
export const BUBBLE_TAIL_STYLES: readonly BubbleTailStyle[] = ['curved', 'sharp', 'dots', 'none'];
export const BUBBLE_FONT_STYLES: readonly BubbleFontStyle[] = ['sans', 'comic', 'mono', 'serif'];
export const BUBBLE_EFFECTS: readonly BubbleEffect[] = ['none', 'glow', 'shimmer', 'sparkle', 'pulse'];

export const BUBBLE_FLAIR_BADGES: readonly string[] = [
  '',
  '✨',
  '🔥',
  '⚡',
  '💫',
  '☁️',
  '🎵',
  '🐝',
  '🐉',
  '🌙',
  '❤️',
  '🎉',
];

export interface BubbleColorPalette {
  name: string;
  bgColor: string;
  accentColor: string;
  textColor: string;
}

export const BUBBLE_COLOR_PALETTES: readonly BubbleColorPalette[] = [
  { name: 'Portal Cyan', bgColor: '#0a1328', accentColor: '#38bdf8', textColor: '#f8fafc' },
  { name: 'Comic Pop', bgColor: '#fffbeb', accentColor: '#f59e0b', textColor: '#111827' },
  { name: 'Lavender Mist', bgColor: '#f5f3ff', accentColor: '#a78bfa', textColor: '#2e1065' },
  { name: 'Hyper Pink', bgColor: '#1f0922', accentColor: '#f472b6', textColor: '#fdf2f8' },
  { name: 'Emerald Pulse', bgColor: '#061a14', accentColor: '#34d399', textColor: '#ecfdf5' },
  { name: 'Solar Flare', bgColor: '#fef08a', accentColor: '#ef4444', textColor: '#18181b' },
  { name: 'Royal Gold', bgColor: '#291d12', accentColor: '#eab308', textColor: '#fef3c7' },
  { name: 'Cloud White', bgColor: '#ffffff', accentColor: '#0ea5e9', textColor: '#0f172a' },
];

const PRESET_MAP = new Map<BubblePresetId, BubblePresetDefinition>(
  BUBBLE_PRESETS.map((p) => [p.id, p]),
);
const TAIL_SET = new Set<string>(BUBBLE_TAIL_STYLES);
const FONT_SET = new Set<string>(BUBBLE_FONT_STYLES);
const EFFECT_SET = new Set<string>(BUBBLE_EFFECTS);

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return null;
  const hex = trimmed.slice(1).toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

export function sanitizeBubbleBadge(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(UNSAFE_CHARS_RE, '').trim();
  if (!cleaned) return undefined;
  const sliced = Array.from(cleaned).slice(0, MAX_BUBBLE_BADGE_LENGTH).join('').trim();
  return sliced || undefined;
}

export function getBubblePreset(id?: string): BubblePresetDefinition {
  if (id && PRESET_MAP.has(id as BubblePresetId)) {
    return PRESET_MAP.get(id as BubblePresetId)!;
  }
  return BUBBLE_PRESETS[0];
}

export function createDefaultBubbleStyle(accentColor?: string, preset: BubblePresetId = 'glass'): SpeechBubbleStyle {
  const base = getBubblePreset(preset).style;
  const safeAccent = normalizeHexColor(accentColor);
  return {
    ...base,
    ...(safeAccent && preset === 'glass' ? { accentColor: safeAccent } : {}),
  };
}

/**
 * Validates and normalizes an untrusted SpeechBubbleStyle object.
 * Returns null if the input is not an object; otherwise fills any missing or
 * invalid fields from the resolved preset defaults so peers always render safely.
 */
export function sanitizeSpeechBubbleStyle(
  value: unknown,
  fallbackAccent?: string,
): SpeechBubbleStyle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const presetDef =
    typeof raw.preset === 'string' && PRESET_MAP.has(raw.preset as BubblePresetId)
      ? PRESET_MAP.get(raw.preset as BubblePresetId)!
      : BUBBLE_PRESETS[0];
  const base = presetDef.style;

  const bgColor = normalizeHexColor(raw.bgColor) ?? base.bgColor;
  const accentColor =
    normalizeHexColor(raw.accentColor) ??
    (presetDef.id === 'glass' ? normalizeHexColor(fallbackAccent) : null) ??
    base.accentColor;
  const textColor = normalizeHexColor(raw.textColor) ?? base.textColor;
  const tail: BubbleTailStyle =
    typeof raw.tail === 'string' && TAIL_SET.has(raw.tail) ? (raw.tail as BubbleTailStyle) : base.tail;
  const font: BubbleFontStyle =
    typeof raw.font === 'string' && FONT_SET.has(raw.font) ? (raw.font as BubbleFontStyle) : base.font;
  const effect: BubbleEffect =
    typeof raw.effect === 'string' && EFFECT_SET.has(raw.effect)
      ? (raw.effect as BubbleEffect)
      : base.effect;
  const badge = raw.badge === undefined ? undefined : sanitizeBubbleBadge(raw.badge);

  const result: SpeechBubbleStyle = {
    preset: presetDef.id,
    bgColor,
    accentColor,
    textColor,
    tail,
    font,
    effect,
  };
  if (badge) result.badge = badge;
  return result;
}

export function bubbleFontStack(font: BubbleFontStyle): string {
  switch (font) {
    case 'comic':
      return '"Comic Sans MS", "Chalkboard SE", "Marker Felt", "Trebuchet MS", cursive, sans-serif';
    case 'mono':
      return 'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
    case 'serif':
      return '"Cormorant Garamond", Georgia, "Times New Roman", serif';
    case 'sans':
    default:
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif';
  }
}

/** Suggested 3D display lifetime in seconds, scaled gently by message length. */
export function computeBubbleDurationSeconds(text: string): number {
  const len = Array.from(text.trim()).length;
  return Math.min(11.5, Math.max(5.2, 4.4 + len * 0.055));
}
