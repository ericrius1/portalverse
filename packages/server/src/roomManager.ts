import { sanitizeSkinAppearance, type SkinAppearance } from '../../core/src/characters/appearance';
import { SIDE_PORTALS } from '../../core/src/portal/roomLayout';
import type {
  AvatarState,
  ClientNetMessage,
  PortalDefinition,
  RtcSignalPayload,
  ServerNetMessage,
  SpeechBubbleStyle,
  Vec3Tuple,
  WorldPresenceSummary,
} from '../../core/src/types';
import { sanitizeSpeechBubbleStyle } from '../../core/src/chat/bubbleStyles';
import { sanitizePortalDefinition } from './protocol';

/** One message the transport layer should deliver to a set of connections. */
export interface Outbound {
  /** Connection ids to deliver to. */
  to: string[];
  message: ServerNetMessage;
}

export interface RoomManagerOptions {
  /** Friendly names for roster events, e.g. `{ 'jp-world': "JP's Room" }`. */
  worldNames?: Record<string, string>;
  /**
   * World ids players may join / spawn portals into. When omitted, any valid
   * id is accepted (handy for worlds added while the server is running).
   */
  knownWorldIds?: string[];
  defaultWorldId?: string;
  livePortalLimits?: ReadonlyMap<string, number>;
  maxPortalsPerWorld?: number;
  /** Max distinct worlds that may hold dynamic portals (memory guard). */
  maxWorldsWithPortals?: number;
  /** Positions are clamped to +/- this many meters on every axis. */
  positionLimit?: number;
  maxVelocityY?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

interface Session {
  connectionId: string;
  avatar: AvatarState;
}

export const DEFAULT_MAX_PORTALS_PER_WORLD = SIDE_PORTALS;
export const DEFAULT_POSITION_LIMIT = 5000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let y = yaw % twoPi;
  if (y > Math.PI) y -= twoPi;
  if (y < -Math.PI) y += twoPi;
  return y;
}

function cloneAvatar(a: AvatarState): AvatarState {
  return {
    ...a,
    position: [...a.position] as Vec3Tuple,
    ...(a.bubbleStyle ? { bubbleStyle: { ...a.bubbleStyle } } : {}),
  };
}

function clonePortal(p: PortalDefinition): PortalDefinition {
  return { ...p, position: [...p.position] as Vec3Tuple };
}

/**
 * Pure, transport-agnostic authoritative state for the metaverse: which player
 * is in which world, their latest pose, and the dynamic portals spawned into
 * each world. Every mutating call returns the messages to send; it never does
 * I/O itself, so it is trivially unit-testable.
 */
export class RoomManager {
  private readonly sessions = new Map<string, Session>(); // by connection id
  private readonly playerToConnection = new Map<string, string>();
  private readonly portals = new Map<string, Map<string, PortalDefinition>>();
  private readonly worldNames: Record<string, string>;
  private readonly knownWorlds: Set<string> | null;
  private readonly defaultWorldId: string;
  private readonly livePortalLimits: ReadonlyMap<string, number>;
  private readonly maxPortalsPerWorld: number;
  private readonly maxWorldsWithPortals: number;
  private readonly positionLimit: number;
  private readonly maxVelocityY: number;
  private readonly now: () => number;

  constructor(options: RoomManagerOptions = {}) {
    this.worldNames = { ...(options.worldNames ?? {}) };
    this.knownWorlds = options.knownWorldIds ? new Set(options.knownWorldIds) : null;
    this.defaultWorldId = options.defaultWorldId ?? 'hub';
    this.livePortalLimits = options.livePortalLimits ?? new Map();
    this.maxPortalsPerWorld = options.maxPortalsPerWorld ?? DEFAULT_MAX_PORTALS_PER_WORLD;
    this.maxWorldsWithPortals = options.maxWorldsWithPortals ?? 64;
    this.positionLimit = options.positionLimit ?? DEFAULT_POSITION_LIMIT;
    this.maxVelocityY = options.maxVelocityY ?? 200;
    this.now = options.now ?? Date.now;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getWorldName(worldId: string): string {
    return this.worldNames[worldId] ?? worldId;
  }

  getRoster(): AvatarState[] {
    return [...this.sessions.values()]
      .map((s) => cloneAvatar(s.avatar))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  getPlayersInWorld(worldId: string): AvatarState[] {
    return this.getRoster().filter((a) => a.worldId === worldId);
  }

  getDynamicPortals(worldId: string): PortalDefinition[] {
    return [...(this.portals.get(worldId)?.values() ?? [])].map(clonePortal);
  }

  getTotalPlayers(): number {
    return this.sessions.size;
  }

  getPlayerIdForConnection(connectionId: string): string | undefined {
    return this.sessions.get(connectionId)?.avatar.id;
  }

  getWorldSummaries(): WorldPresenceSummary[] {
    const ids = new Set<string>([
      ...(this.knownWorlds ?? []),
      ...Object.keys(this.worldNames),
      ...this.portals.keys(),
    ]);
    for (const s of this.sessions.values()) ids.add(s.avatar.worldId);
    const counts = new Map<string, number>();
    for (const s of this.sessions.values()) {
      counts.set(s.avatar.worldId, (counts.get(s.avatar.worldId) ?? 0) + 1);
    }
    return [...ids].sort().map((worldId) => ({
      worldId,
      playerCount: counts.get(worldId) ?? 0,
      dynamicPortalCount: this.portals.get(worldId)?.size ?? 0,
    }));
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  handleMessage(connectionId: string, msg: ClientNetMessage): Outbound[] {
    if (msg.type === 'ping') {
      return [{ to: [connectionId], message: { type: 'pong', t: msg.t } }];
    }
    if (msg.type === 'hello') return this.handleHello(connectionId, msg);

    const session = this.sessions.get(connectionId);
    if (!session) return [this.error(connectionId, 'not_joined', 'Send hello first')];

    switch (msg.type) {
      case 'state':
        return this.handleState(session, msg.position, msg.yaw, msg.velocityY, msg.isFlying);
      case 'switch_world':
        return this.handleSwitchWorld(session, msg.worldId, msg.position, msg.yaw);
      case 'update_profile':
        return this.handleUpdateProfile(session, msg.name, msg.color, msg.characterId, msg, msg.bubbleStyle);
      case 'spawn_portal':
        return this.handleSpawnPortal(session, msg.worldId, msg.portal);
      case 'remove_portal':
        return this.handleRemovePortal(session, msg.worldId, msg.portalId);
      case 'rtc_signal':
        return this.handleRtcSignal(session, msg.toPlayerId, msg.signal);
      case 'chat_message':
        return this.handleChatMessage(session, msg.id, msg.text, msg.bubbleStyle, msg.toPlayerIds);
      default:
        return [this.error(connectionId, 'bad_message', 'Unsupported message type')];
    }
  }

  disconnect(connectionId: string): Outbound[] {
    const session = this.sessions.get(connectionId);
    if (!session) return [];
    this.sessions.delete(connectionId);
    if (this.playerToConnection.get(session.avatar.id) === connectionId) {
      this.playerToConnection.delete(session.avatar.id);
    }
    const { id, name, worldId } = session.avatar;
    return [
      ...this.toWorld(worldId, { type: 'player_left', playerId: id, worldId }),
      this.rosterUpdate(`${name} left the metaverse`),
    ].filter((o) => o.to.length > 0);
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private handleHello(
    connectionId: string,
    msg: Extract<ClientNetMessage, { type: 'hello' }>,
  ): Outbound[] {
    // A repeated hello on the same socket is treated as a fresh join.
    const out: Outbound[] = this.sessions.has(connectionId) ? this.disconnect(connectionId) : [];

    const worldId = this.isWorldAllowed(msg.worldId) ? msg.worldId : this.defaultWorldId;
    const playerId = this.allocatePlayerId(msg.player.id);
    const avatar: AvatarState = {
      id: playerId,
      name: msg.player.name,
      color: msg.player.color,
      ...sanitizeSkinAppearance({ ...msg.player }),
      ...(msg.player.characterId ? { characterId: msg.player.characterId } : {}),
      ...(msg.player.bubbleStyle ? { bubbleStyle: { ...msg.player.bubbleStyle } } : {}),
      worldId,
      position: this.clampPosition(msg.position),
      yaw: normalizeYaw(msg.yaw),
      velocityY: 0,
      updatedAt: this.now(),
    };
    this.sessions.set(connectionId, { connectionId, avatar });
    this.playerToConnection.set(playerId, connectionId);

    out.push(this.welcome(connectionId));
    out.push(...this.toWorld(worldId, { type: 'player_joined', player: cloneAvatar(avatar) }, connectionId));
    out.push(this.rosterUpdate(`${avatar.name} joined the metaverse in ${this.getWorldName(worldId)}`));
    return out.filter((o) => o.to.length > 0);
  }

  private handleState(
    session: Session,
    position: Vec3Tuple,
    yaw: number,
    velocityY: number,
    isFlying?: boolean,
  ): Outbound[] {
    const a = session.avatar;
    a.position = this.clampPosition(position);
    a.yaw = normalizeYaw(yaw);
    a.velocityY = clamp(velocityY, -this.maxVelocityY, this.maxVelocityY);
    if (typeof isFlying === 'boolean') a.isFlying = isFlying;
    a.updatedAt = this.now();
    const stateMsg: Extract<ServerNetMessage, { type: 'player_state' }> = {
      type: 'player_state',
      playerId: a.id,
      worldId: a.worldId,
      position: [...a.position] as Vec3Tuple,
      yaw: a.yaw,
      velocityY: a.velocityY,
      ...(typeof a.isFlying === 'boolean' ? { isFlying: a.isFlying } : {}),
      updatedAt: a.updatedAt,
    };
    return this.toWorld(a.worldId, stateMsg, session.connectionId).filter((o) => o.to.length > 0);
  }

  private handleSwitchWorld(
    session: Session,
    worldId: string,
    position: Vec3Tuple,
    yaw: number,
  ): Outbound[] {
    if (!this.isWorldAllowed(worldId)) {
      return [this.error(session.connectionId, 'unknown_world', `Unknown world "${worldId}"`)];
    }
    const a = session.avatar;
    const fromWorldId = a.worldId;
    a.position = this.clampPosition(position);
    a.yaw = normalizeYaw(yaw);
    a.velocityY = 0;
    a.updatedAt = this.now();

    if (fromWorldId === worldId) {
      return [this.welcome(session.connectionId)];
    }
    a.worldId = worldId;
    return [
      ...this.toWorld(fromWorldId, { type: 'player_left', playerId: a.id, worldId: fromWorldId }, session.connectionId),
      this.welcome(session.connectionId),
      ...this.toWorld(worldId, { type: 'player_joined', player: cloneAvatar(a) }, session.connectionId),
      this.rosterUpdate(`${a.name} entered ${this.getWorldName(worldId)}`),
    ].filter((o) => o.to.length > 0);
  }

  private handleUpdateProfile(
    session: Session,
    name: string,
    color: string,
    characterId?: string,
    appearance?: Partial<SkinAppearance>,
    bubbleStyle?: SpeechBubbleStyle,
  ): Outbound[] {
    const a = session.avatar;
    const oldName = a.name;
    a.name = name;
    a.color = color;
    Object.assign(a, sanitizeSkinAppearance({ ...appearance }));
    if (characterId) a.characterId = characterId;
    if (bubbleStyle) {
      const cleanStyle = sanitizeSpeechBubbleStyle(bubbleStyle, color);
      if (cleanStyle) a.bubbleStyle = cleanStyle;
    }
    a.updatedAt = this.now();
    const event = oldName !== name ? `${oldName} is now known as ${name}` : undefined;
    return [
      // player_joined doubles as an upsert so peers refresh name/color/character/bubbleStyle.
      ...this.toWorld(a.worldId, { type: 'player_joined', player: cloneAvatar(a) }, session.connectionId),
      this.rosterUpdate(event),
    ].filter((o) => o.to.length > 0);
  }

  private handleRtcSignal(
    session: Session,
    toPlayerId: string,
    signal: RtcSignalPayload,
  ): Outbound[] {
    if (toPlayerId === session.avatar.id) return [];
    const targetConnId = this.playerToConnection.get(toPlayerId);
    if (!targetConnId) return [];
    const targetSession = this.sessions.get(targetConnId);
    // Keep WebRTC signaling scoped to peers currently sharing the same room.
    if (!targetSession || targetSession.avatar.worldId !== session.avatar.worldId) return [];
    return [
      {
        to: [targetConnId],
        message: {
          type: 'rtc_signal',
          fromPlayerId: session.avatar.id,
          worldId: session.avatar.worldId,
          signal,
        },
      },
    ];
  }

  private handleChatMessage(
    session: Session,
    id: string,
    text: string,
    bubbleStyle?: SpeechBubbleStyle,
    toPlayerIds?: string[],
  ): Outbound[] {
    const a = session.avatar;
    const resolvedStyle =
      (bubbleStyle ? sanitizeSpeechBubbleStyle(bubbleStyle, a.color) : null) ??
      (a.bubbleStyle ? { ...a.bubbleStyle } : undefined);
    const message: ServerNetMessage = {
      type: 'chat_message',
      id,
      senderId: a.id,
      senderName: a.name,
      senderColor: a.color,
      worldId: a.worldId,
      text,
      ...(resolvedStyle ? { bubbleStyle: resolvedStyle } : {}),
      sentAt: this.now(),
    };
    if (toPlayerIds) {
      const targetConns: string[] = [];
      const seen = new Set<string>();
      for (const pid of toPlayerIds) {
        if (pid === a.id || seen.has(pid)) continue;
        seen.add(pid);
        const connId = this.playerToConnection.get(pid);
        if (!connId) continue;
        const targetSession = this.sessions.get(connId);
        if (targetSession && targetSession.avatar.worldId === a.worldId) {
          targetConns.push(connId);
        }
      }
      return targetConns.length > 0 ? [{ to: targetConns, message }] : [];
    }
    return this.toWorld(a.worldId, message, session.connectionId).filter((o) => o.to.length > 0);
  }

  private handleSpawnPortal(session: Session, worldId: string, portal: PortalDefinition): Outbound[] {
    const conn = session.connectionId;
    if (worldId !== session.avatar.worldId && !this.isWorldAllowed(worldId, true)) {
      return [this.error(conn, 'unknown_world', `Cannot spawn portals into "${worldId}"`)];
    }
    const clean = sanitizePortalDefinition(portal, session.avatar.id);
    if (!clean) return [this.error(conn, 'invalid_portal', 'Portal definition rejected')];
    clean.position = this.clampPosition(clean.position);
    if (clean.yaw !== undefined) clean.yaw = normalizeYaw(clean.yaw);

    let worldPortals = this.portals.get(worldId);
    if (!worldPortals) {
      if (this.portals.size >= this.maxWorldsWithPortals) {
        return [this.error(conn, 'portal_limit', 'Too many worlds hold dynamic portals')];
      }
      worldPortals = new Map();
    }
    const existing = worldPortals.get(clean.id);
    if (existing && existing.createdBy !== session.avatar.id && this.isCreatorOnline(existing)) {
      return [this.error(conn, 'portal_exists', `Portal "${clean.id}" belongs to someone else`)];
    }
    const available = Math.min(this.maxPortalsPerWorld, this.livePortalLimits.get(worldId) ?? SIDE_PORTALS);
    if (!existing && worldPortals.size >= available) {
      return [
        this.error(conn, 'portal_limit', `A world can hold at most ${available} dynamic portals`),
      ];
    }
    worldPortals.set(clean.id, clean);
    this.portals.set(worldId, worldPortals);
    return this.toWorld(worldId, { type: 'portal_spawned', worldId, portal: clonePortal(clean) }).filter(
      (o) => o.to.length > 0,
    );
  }

  private handleRemovePortal(session: Session, worldId: string, portalId: string): Outbound[] {
    const conn = session.connectionId;
    const worldPortals = this.portals.get(worldId);
    const existing = worldPortals?.get(portalId);
    if (!worldPortals || !existing) {
      return [this.error(conn, 'portal_not_found', `No dynamic portal "${portalId}" in ${worldId}`)];
    }
    if (existing.createdBy !== session.avatar.id && this.isCreatorOnline(existing)) {
      return [this.error(conn, 'forbidden', 'Only the creator can remove this portal while online')];
    }
    worldPortals.delete(portalId);
    if (worldPortals.size === 0) this.portals.delete(worldId);
    const out = this.toWorld(worldId, { type: 'portal_removed', worldId, portalId });
    // The remover may be elsewhere; make sure they get confirmation too.
    if (!out[0]?.to.includes(conn)) out.push({ to: [conn], message: { type: 'portal_removed', worldId, portalId } });
    return out.filter((o) => o.to.length > 0);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private isWorldAllowed(worldId: string, forPortals = false): boolean {
    if (this.knownWorlds) return this.knownWorlds.has(worldId);
    // Without an explicit world list, only accept portals into worlds that are
    // named or currently occupied, to avoid unbounded world creation.
    if (forPortals) {
      return (
        worldId in this.worldNames ||
        this.portals.has(worldId) ||
        [...this.sessions.values()].some((s) => s.avatar.worldId === worldId)
      );
    }
    return true;
  }

  private isCreatorOnline(portal: PortalDefinition): boolean {
    return !!portal.createdBy && this.playerToConnection.has(portal.createdBy);
  }

  private allocatePlayerId(requested: string): string {
    if (!this.playerToConnection.has(requested)) return requested;
    for (let n = 2; ; n++) {
      const suffix = `-${n}`;
      const candidate = requested.slice(0, 64 - suffix.length) + suffix;
      if (!this.playerToConnection.has(candidate)) return candidate;
    }
  }

  private clampPosition(p: Vec3Tuple): Vec3Tuple {
    const l = this.positionLimit;
    return [clamp(p[0], -l, l), clamp(p[1], -l, l), clamp(p[2], -l, l)];
  }

  private connectionsInWorld(worldId: string, exceptConnectionId?: string): string[] {
    const ids: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.avatar.worldId === worldId && s.connectionId !== exceptConnectionId) ids.push(s.connectionId);
    }
    return ids;
  }

  private toWorld(worldId: string, message: ServerNetMessage, exceptConnectionId?: string): Outbound[] {
    return [{ to: this.connectionsInWorld(worldId, exceptConnectionId), message }];
  }

  private welcome(connectionId: string): Outbound {
    const a = this.sessions.get(connectionId)!.avatar;
    return {
      to: [connectionId],
      message: {
        type: 'welcome',
        playerId: a.id,
        worldId: a.worldId,
        players: this.getPlayersInWorld(a.worldId).filter((p) => p.id !== a.id),
        roster: this.getRoster(),
        dynamicPortals: this.getDynamicPortals(a.worldId),
      },
    };
  }

  private rosterUpdate(event?: string): Outbound {
    const message: ServerNetMessage = { type: 'roster_update', roster: this.getRoster() };
    if (event) message.event = event;
    return { to: [...this.sessions.keys()], message };
  }

  private error(connectionId: string, code: string, message: string): Outbound {
    return { to: [connectionId], message: { type: 'error', code, message } };
  }
}
