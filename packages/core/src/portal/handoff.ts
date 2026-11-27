import { sanitizeSkinAppearance } from '../characters/appearance';
import type {
  PortalDefinition,
  PortalHandoffPayload,
  SpawnPoint,
  Vec3Tuple,
} from '../types';

/*
 * Portal handoff: the small, signed-by-nobody payload a traveler carries when
 * they step through a federated portal into another Portalverse server.
 *
 * Everything here runs in both the browser and Node, and every decoder treats
 * its input as hostile (it arrives from a URL anyone can craft).
 */

const MAX_ENCODED_HANDOFF_LENGTH = 8192;
const MAX_URL_LENGTH = 2048;
const DEFAULT_PLAYER_COLOR = '#38bdf8';
const DEFAULT_RETURN_POSITION: Vec3Tuple = [0, 0, -6];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_CHARS = /[\u0000-\u001f\u007f-\u009f<>`\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

// ---------------------------------------------------------------------------
// Shared sanitizers (also used by the server protocol layer)
// ---------------------------------------------------------------------------

/** Returns the id if it is a safe slug-ish identifier (1-64 chars), else null. */
export function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Strips control characters, angle brackets, backticks and bidi/zero-width
 * characters, collapses whitespace and truncates to `maxLength` code points.
 * Returns null when nothing printable remains.
 */
export function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(UNSAFE_TEXT_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const truncated = Array.from(cleaned).slice(0, maxLength).join('').trim();
  return truncated || null;
}

/** Accepts `#rgb` or `#rrggbb`; returns normalized lowercase `#rrggbb` or null. */
export function sanitizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;
  const hex = trimmed.slice(1).toLowerCase();
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  }
  return `#${hex}`;
}

/**
 * Returns the normalized absolute URL when it is plain `http:`/`https:` with
 * no embedded credentials, else null. Rejects `javascript:`, `data:`, `file:`…
 */
export function sanitizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url.toString();
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizeVec3(value: unknown): Vec3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return null;
  return [x, y, z];
}

// ---------------------------------------------------------------------------
// UTF-8 safe base64url (browser + Node, no Buffer dependency)
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Handoff encode / decode
// ---------------------------------------------------------------------------

export function encodePortalHandoff(payload: PortalHandoffPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return bytesToBase64Url(bytes);
}

/** Validates the decoded object; returns a fresh sanitized payload or null. */
export function sanitizeHandoffPayload(value: unknown): PortalHandoffPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;

  const fromWorldId = sanitizeId(raw.fromWorldId);
  if (!fromWorldId) return null;

  let returnUrl: string | undefined;
  if (raw.returnUrl !== undefined && raw.returnUrl !== null) {
    const safe = sanitizeHttpUrl(raw.returnUrl);
    // A non-http(s) return URL means a tampered payload: reject outright.
    if (!safe) return null;
    returnUrl = safe;
  }

  const payload: PortalHandoffPayload = {
    version: 1,
    playerName: sanitizeText(raw.playerName, 32) ?? 'Traveler',
    playerColor: sanitizeColor(raw.playerColor) ?? DEFAULT_PLAYER_COLOR,
    ...sanitizeSkinAppearance(raw),
    fromWorldId,
    fromWorldName: sanitizeText(raw.fromWorldName, 40) ?? fromWorldId,
    sentAt: isFiniteNumber(raw.sentAt) ? raw.sentAt : 0,
  };
  const characterId = sanitizeId(raw.characterId);
  if (characterId) payload.characterId = characterId;
  if (returnUrl) payload.returnUrl = returnUrl;
  const targetWorldId = sanitizeId(raw.targetWorldId);
  if (targetWorldId) payload.targetWorldId = targetWorldId;
  const targetSpawnId = sanitizeId(raw.targetSpawnId);
  if (targetSpawnId) payload.targetSpawnId = targetSpawnId;
  return payload;
}

export function decodePortalHandoff(encoded: string): PortalHandoffPayload | null {
  if (typeof encoded !== 'string') return null;
  const trimmed = encoded.trim();
  if (!trimmed || trimmed.length > MAX_ENCODED_HANDOFF_LENGTH) return null;
  const bytes = base64UrlToBytes(trimmed);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return sanitizeHandoffPayload(parsed);
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Appends `?handoff=<payload>` to a federated portal's destination URL. */
export function buildRemotePortalUrl(
  remoteUrl: string,
  payload: PortalHandoffPayload,
): string | null {
  const safe = sanitizeHttpUrl(remoteUrl);
  if (!safe) return null;
  const url = new URL(safe);
  url.searchParams.set('handoff', encodePortalHandoff(payload));
  if (/^#(?:.*&)?handoff=/.test(url.hash)) url.hash = '';
  return url.toString();
}

const ROUTE_PARAMS = ['world', 'spawn', 'handoff'] as const;
const RELATIVE_BASE = 'http://portalverse.invalid';

/**
 * Builds a clean shareable link, e.g. `https://host/?world=jp-world` or
 * `https://host/?world=fishpond&spawn=exit`. Other query params on the base
 * are preserved; stale route params and the hash are dropped.
 */
export function buildShareableWorldUrl(
  baseUrl: string,
  opts: { worldId: string; spawnId?: string },
): string {
  let url: URL;
  let relative = false;
  try {
    url = new URL(baseUrl);
  } catch {
    url = new URL(baseUrl || '/', RELATIVE_BASE);
    relative = true;
  }
  for (const key of ROUTE_PARAMS) url.searchParams.delete(key);
  url.hash = '';

  const worldId = sanitizeId(opts.worldId);
  if (worldId) url.searchParams.set('world', worldId);
  const spawnId = sanitizeId(opts.spawnId);
  if (spawnId) url.searchParams.set('spawn', spawnId);

  return relative ? `${url.pathname}${url.search}` : url.toString();
}

export interface LocationRoute {
  worldId?: string;
  spawnId?: string;
  handoff?: PortalHandoffPayload;
}

/** Parses `?world=`, `?spawn=` and `?handoff=` / `#handoff=`. */
export function readRouteFromLocation(search: string, hash?: string): LocationRoute {
  const route: LocationRoute = {};
  const query = new URLSearchParams(search ?? '');
  const hashParams = new URLSearchParams((hash ?? '').replace(/^#/, ''));

  const worldId = sanitizeId(query.get('world'));
  if (worldId) route.worldId = worldId;
  const spawnId = sanitizeId(query.get('spawn'));
  if (spawnId) route.spawnId = spawnId;

  const encoded = query.get('handoff') ?? hashParams.get('handoff');
  if (encoded) {
    const handoff = decodePortalHandoff(encoded);
    if (handoff) route.handoff = handoff;
  }
  return route;
}

// ---------------------------------------------------------------------------
// Return portal
// ---------------------------------------------------------------------------

function shiftHue(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // Rotate channels for a complementary-ish secondary swirl color.
  return `#${[b, r, g].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** How far into the room a federated traveller appears, leaving room behind the chase camera for the way home. */
export const HANDOFF_ARRIVAL_CLEARANCE = 12;
/** Gap between the traveller and the return portal behind them (> 5.6 m 3rd-person camera distance). */
const RETURN_PORTAL_GAP = 6.5;

export interface HandoffArrival {
  /** Where the traveller appears, facing the same way as the room's spawn. */
  arrival: SpawnPoint;
  /** The return portal directly behind the traveller, its front facing them. */
  portal: { position: Vec3Tuple; yaw: number };
}

/**
 * Places a federated arrival like stepping out of the room's entrance: the
 * traveller moves `clearance` metres forward from the spawn and the way home
 * stands just behind them, so turning around and walking back returns them.
 * The clearance keeps the portal clear of the entrance gate at the default spawn.
 */
export function placeHandoffArrival(spawn: SpawnPoint, clearance = HANDOFF_ARRIVAL_CLEARANCE): HandoffArrival {
  const forwardX = -Math.sin(spawn.yaw);
  const forwardZ = -Math.cos(spawn.yaw);
  const [x, y, z] = spawn.position;
  const arrivalX = x + forwardX * clearance;
  const arrivalZ = z + forwardZ * clearance;
  return {
    arrival: { ...spawn, position: [arrivalX, y, arrivalZ] },
    portal: {
      position: [arrivalX - forwardX * RETURN_PORTAL_GAP, y, arrivalZ - forwardZ * RETURN_PORTAL_GAP],
      // A portal's front faces local +Z, so turn it to face the way the traveller looks.
      yaw: spawn.yaw + Math.PI,
    },
  };
}

/**
 * Builds a glowing one-way return portal leading back to `handoff.returnUrl`.
 * Returns null when the handoff has no (valid) return URL.
 */
export function createReturnPortalFromHandoff(
  handoff: PortalHandoffPayload,
  position: Vec3Tuple = DEFAULT_RETURN_POSITION,
  yaw = 0,
): PortalDefinition | null {
  const returnUrl = sanitizeHttpUrl(handoff?.returnUrl);
  if (!returnUrl) return null;
  const fromWorldId = sanitizeId(handoff.fromWorldId);
  if (!fromWorldId) return null;
  const safePosition = sanitizeVec3(position) ?? [...DEFAULT_RETURN_POSITION];
  const worldName = sanitizeText(handoff.fromWorldName, 40) ?? fromWorldId;
  const colorA = sanitizeColor(handoff.playerColor) ?? DEFAULT_PLAYER_COLOR;

  return {
    id: `return-${fromWorldId}`.slice(0, 64),
    label: sanitizeText(`Return to ${worldName}`, 40) ?? 'Return portal',
    subtitle: sanitizeText(`Way home for ${handoff.playerName ?? 'Traveler'}`, 60) ?? 'Way home',
    position: safePosition,
    yaw: Number.isFinite(yaw) ? yaw : 0,
    targetWorldId: fromWorldId,
    remoteUrl: returnUrl,
    colorA,
    colorB: shiftHue(colorA),
    triggerRadius: 2.6,
    oneWay: true,
  };
}
