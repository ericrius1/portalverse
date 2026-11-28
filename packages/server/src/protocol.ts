import { sanitizeSkinAppearance } from '../../core/src/characters/appearance';
import type {
  ClientNetMessage,
  PlayerIdentity,
  PortalDefinition,
  RtcSignalPayload,
  ServerNetMessage,
} from '../../core/src/types';
import {
  isFiniteNumber,
  sanitizeColor,
  sanitizeHttpUrl,
  sanitizeId,
  sanitizeText,
  sanitizeVec3,
} from '../../core/src/portal/handoff';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  sanitizeSpeechBubbleStyle,
} from '../../core/src/chat/bubbleStyles';

/** Hard cap on a single inbound frame, before JSON parsing. */
export const MAX_CLIENT_MESSAGE_BYTES = 32 * 1024;
export const MAX_PLAYER_NAME_LENGTH = 32;
export const MAX_PORTAL_LABEL_LENGTH = 40;
export const MAX_PORTAL_SUBTITLE_LENGTH = 60;
export const MAX_SDP_LENGTH = 24 * 1024;
export const MAX_ICE_CANDIDATE_LENGTH = 2048;
export const MAX_CHAT_TARGETS = 64;
export const DEFAULT_PORTAL_TRIGGER_RADIUS = 2.6;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeIdentity(value: unknown): PlayerIdentity | null {
  if (!isRecord(value)) return null;
  const id = sanitizeId(value.id);
  const name = sanitizeText(value.name, MAX_PLAYER_NAME_LENGTH);
  const color = sanitizeColor(value.color);
  if (!id || !name || !color) return null;
  const identity: PlayerIdentity = { id, name, color, ...sanitizeSkinAppearance(value) };
  if (value.characterId !== undefined) {
    const characterId = sanitizeId(value.characterId);
    if (characterId) identity.characterId = characterId;
  }
  if (value.bubbleStyle !== undefined) {
    const bubbleStyle = sanitizeSpeechBubbleStyle(value.bubbleStyle, color);
    if (bubbleStyle) identity.bubbleStyle = bubbleStyle;
  }
  return identity;
}

export function sanitizeRtcSignal(value: unknown): RtcSignalPayload | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  switch (value.kind) {
    case 'offer':
    case 'answer': {
      if (typeof value.sdp !== 'string' || value.sdp.length === 0 || value.sdp.length > MAX_SDP_LENGTH) {
        return null;
      }
      return { kind: value.kind, sdp: value.sdp };
    }
    case 'ice': {
      if (typeof value.candidate !== 'string' || value.candidate.length > MAX_ICE_CANDIDATE_LENGTH) {
        return null;
      }
      const ice: Extract<RtcSignalPayload, { kind: 'ice' }> = {
        kind: 'ice',
        candidate: value.candidate,
      };
      if (value.sdpMid !== undefined) {
        if (value.sdpMid !== null && (typeof value.sdpMid !== 'string' || value.sdpMid.length > 64)) {
          return null;
        }
        ice.sdpMid = value.sdpMid;
      }
      if (value.sdpMLineIndex !== undefined) {
        if (
          value.sdpMLineIndex !== null &&
          (!isFiniteNumber(value.sdpMLineIndex) || value.sdpMLineIndex < 0 || value.sdpMLineIndex > 64)
        ) {
          return null;
        }
        ice.sdpMLineIndex = value.sdpMLineIndex;
      }
      if (value.usernameFragment !== undefined) {
        if (
          value.usernameFragment !== null &&
          (typeof value.usernameFragment !== 'string' || value.usernameFragment.length > 256)
        ) {
          return null;
        }
        ice.usernameFragment = value.usernameFragment;
      }
      return ice;
    }
    default:
      return null;
  }
}

/**
 * Validates an untrusted portal definition. Returns a fresh object containing
 * only known, sanitized fields, or null if any required field is invalid or an
 * optional field is present but unsafe (bad color, non-http(s) remoteUrl, …).
 */
export function sanitizePortalDefinition(
  portal: unknown,
  createdBy?: string,
): PortalDefinition | null {
  if (!isRecord(portal)) return null;
  const id = sanitizeId(portal.id);
  const label = sanitizeText(portal.label, MAX_PORTAL_LABEL_LENGTH);
  const position = sanitizeVec3(portal.position);
  const targetWorldId = sanitizeId(portal.targetWorldId);
  if (!id || !label || !position || !targetWorldId) return null;

  const result: PortalDefinition = { id, label, position, targetWorldId };

  if (portal.subtitle !== undefined) {
    const subtitle = sanitizeText(portal.subtitle, MAX_PORTAL_SUBTITLE_LENGTH);
    if (subtitle) result.subtitle = subtitle;
  }
  if (portal.yaw !== undefined) {
    if (!isFiniteNumber(portal.yaw)) return null;
    result.yaw = portal.yaw;
  }
  if (portal.targetSpawnId !== undefined) {
    const spawn = sanitizeId(portal.targetSpawnId);
    if (!spawn) return null;
    result.targetSpawnId = spawn;
  }
  if (portal.remoteUrl !== undefined) {
    const url = sanitizeHttpUrl(portal.remoteUrl);
    if (!url) return null;
    result.remoteUrl = url;
  }
  for (const key of ['colorA', 'colorB'] as const) {
    if (portal[key] === undefined) continue;
    const color = sanitizeColor(portal[key]);
    if (!color) return null;
    result[key] = color;
  }
  if (portal.triggerRadius !== undefined) {
    if (!isFiniteNumber(portal.triggerRadius)) return null;
    result.triggerRadius = Math.min(12, Math.max(0.5, portal.triggerRadius));
  }

  const creator = createdBy !== undefined ? sanitizeId(createdBy) : sanitizeId(portal.createdBy);
  if (creator) result.createdBy = creator;
  return result;
}

/**
 * Parses and strictly validates one inbound client frame. Unknown message
 * types, malformed JSON, non-finite numbers and unsafe strings yield null.
 */
export function parseClientMessage(raw: string): ClientNetMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CLIENT_MESSAGE_BYTES) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || typeof data.type !== 'string') return null;

  switch (data.type) {
    case 'hello': {
      const player = sanitizeIdentity(data.player);
      const worldId = sanitizeId(data.worldId);
      const position = sanitizeVec3(data.position);
      if (!player || !worldId || !position || !isFiniteNumber(data.yaw)) return null;
      return { type: 'hello', player, worldId, position, yaw: data.yaw };
    }
    case 'state': {
      const position = sanitizeVec3(data.position);
      if (!position || !isFiniteNumber(data.yaw) || !isFiniteNumber(data.velocityY)) return null;
      const msg: Extract<ClientNetMessage, { type: 'state' }> = {
        type: 'state',
        position,
        yaw: data.yaw,
        velocityY: data.velocityY,
      };
      if (typeof data.isFlying === 'boolean') msg.isFlying = data.isFlying;
      return msg;
    }
    case 'switch_world': {
      const worldId = sanitizeId(data.worldId);
      const position = sanitizeVec3(data.position);
      if (!worldId || !position || !isFiniteNumber(data.yaw)) return null;
      return { type: 'switch_world', worldId, position, yaw: data.yaw };
    }
    case 'update_profile': {
      const name = sanitizeText(data.name, MAX_PLAYER_NAME_LENGTH);
      const color = sanitizeColor(data.color);
      if (!name || !color) return null;
      const msg: Extract<ClientNetMessage, { type: 'update_profile' }> = {
        type: 'update_profile',
        ...sanitizeSkinAppearance(data),
        name,
        color,
      };
      if (data.characterId !== undefined) {
        const characterId = sanitizeId(data.characterId);
        if (characterId) msg.characterId = characterId;
      }
      if (data.bubbleStyle !== undefined) {
        const bubbleStyle = sanitizeSpeechBubbleStyle(data.bubbleStyle, color);
        if (bubbleStyle) msg.bubbleStyle = bubbleStyle;
      }
      return msg;
    }
    case 'spawn_portal': {
      const worldId = sanitizeId(data.worldId);
      const portal = sanitizePortalDefinition(data.portal);
      if (!worldId || !portal) return null;
      return { type: 'spawn_portal', worldId, portal };
    }
    case 'remove_portal': {
      const worldId = sanitizeId(data.worldId);
      const portalId = sanitizeId(data.portalId);
      if (!worldId || !portalId) return null;
      return { type: 'remove_portal', worldId, portalId };
    }
    case 'rtc_signal': {
      const toPlayerId = sanitizeId(data.toPlayerId);
      const signal = sanitizeRtcSignal(data.signal);
      if (!toPlayerId || !signal) return null;
      return { type: 'rtc_signal', toPlayerId, signal };
    }
    case 'chat_message': {
      const id = sanitizeId(data.id);
      const text = sanitizeText(data.text, MAX_CHAT_MESSAGE_LENGTH);
      if (!id || !text) return null;
      const msg: Extract<ClientNetMessage, { type: 'chat_message' }> = {
        type: 'chat_message',
        id,
        text,
      };
      if (data.bubbleStyle !== undefined) {
        const bubbleStyle = sanitizeSpeechBubbleStyle(data.bubbleStyle);
        if (bubbleStyle) msg.bubbleStyle = bubbleStyle;
      }
      if (data.toPlayerIds !== undefined) {
        if (!Array.isArray(data.toPlayerIds) || data.toPlayerIds.length > MAX_CHAT_TARGETS) return null;
        const targets: string[] = [];
        for (const rawId of data.toPlayerIds) {
          const cleanId = sanitizeId(rawId);
          if (!cleanId) return null;
          targets.push(cleanId);
        }
        msg.toPlayerIds = targets;
      }
      return msg;
    }
    case 'ping': {
      if (!isFiniteNumber(data.t)) return null;
      return { type: 'ping', t: data.t };
    }
    default:
      return null;
  }
}

export function serializeServerMessage(msg: ServerNetMessage): string {
  return JSON.stringify(msg);
}
