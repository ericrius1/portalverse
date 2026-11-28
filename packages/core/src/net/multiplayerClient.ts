import { sanitizeSkinAppearance, type SkinAppearance } from '../characters/appearance';
import { SIDE_PORTALS } from '../portal/roomLayout';
import type {
  AvatarState,
  ClientNetMessage,
  ConnectionState,
  PlayerIdentity,
  PortalDefinition,
  RtcSignalPayload,
  ServerNetMessage,
  SpeechBubbleStyle,
  Vec3Tuple,
} from '../types';
import { sanitizeColor, sanitizeId, sanitizeText } from '../portal/handoff';
import { MAX_CHAT_MESSAGE_LENGTH, sanitizeSpeechBubbleStyle } from '../chat/bubbleStyles';

/** Minimal WebSocket surface the client needs (browser WebSocket or `ws`). */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface IncomingWsChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  worldId: string;
  text: string;
  bubbleStyle?: SpeechBubbleStyle;
  sentAt: number;
}

export interface MultiplayerClientOptions {
  url?: string;
  identity: PlayerIdentity;
  initialWorldId: string;
  livePortalLimits?: ReadonlyMap<string, number>;
  onConnectionChange?: (state: ConnectionState) => void;
  onPlayersChange?: (playersInWorld: AvatarState[]) => void;
  onRosterChange?: (roster: AvatarState[], event?: string) => void;
  onDynamicPortalsChange?: (portals: PortalDefinition[]) => void;
  onRtcSignal?: (fromPlayerId: string, worldId: string, signal: RtcSignalPayload) => void;
  onChatFallback?: (message: IncomingWsChatMessage) => void;
  onError?: (message: string) => void;
  /** Override the socket implementation (tests / Node). Defaults to global WebSocket. */
  createSocket?: WebSocketFactory;
  /** Minimum ms between state packets (default 50 = 20 Hz). */
  stateIntervalMs?: number;
  /** Reconnect backoff bounds in ms. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

const OPEN = 1;

function resolveDefaultUrl(): string | null {
  const loc = (globalThis as { location?: Location }).location;
  if (!loc || !loc.host) return null;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

function defaultSocketFactory(): WebSocketFactory | null {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  return Ctor ? (url) => new Ctor(url) : null;
}

function copyAvatar(a: AvatarState): AvatarState {
  return {
    ...a,
    position: [...a.position] as Vec3Tuple,
    ...(a.bubbleStyle ? { bubbleStyle: { ...a.bubbleStyle } } : {}),
  };
}

function copyPortal(p: PortalDefinition): PortalDefinition {
  return { ...p, position: [...p.position] as Vec3Tuple };
}

/**
 * Browser-side presence client. Keeps a local mirror of the players in the
 * current world, the global roster, and the dynamic portals in this world.
 * When the server is unreachable it stays fully usable offline (solo mode)
 * while retrying with exponential backoff in the background.
 */
export class MultiplayerClient {
  private readonly options: MultiplayerClientOptions;
  private readonly url: string | null;
  private readonly createSocket: WebSocketFactory | null;
  private readonly stateIntervalMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  private socket: WebSocketLike | null = null;
  private state: ConnectionState = 'offline';
  private shouldRun = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private lastStateSentAt = -Infinity;
  private reportedUnreachable = false;

  private identity: PlayerIdentity;
  private localPlayerId: string;
  private worldId: string;
  private position: Vec3Tuple = [0, 0, 0];
  private yaw = 0;
  private velocityY = 0;
  private isFlying: boolean | undefined = undefined;
  private pendingState = false;

  private players = new Map<string, AvatarState>();
  private roster = new Map<string, AvatarState>();
  /** Dynamic portals keyed by world, so offline/solo portals persist per world. */
  private portalsByWorld = new Map<string, Map<string, PortalDefinition>>();
  /** Portals spawned while offline, re-published on the next welcome into that world. */
  private offlinePortals = new Map<string, Map<string, PortalDefinition>>();

  constructor(options: MultiplayerClientOptions) {
    this.options = options;
    this.identity = { ...options.identity };
    this.localPlayerId = options.identity.id;
    this.worldId = options.initialWorldId;
    this.url = options.url ?? resolveDefaultUrl();
    this.createSocket = options.createSocket ?? defaultSocketFactory();
    this.stateIntervalMs = options.stateIntervalMs ?? 50;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  connect(): void {
    this.shouldRun = true;
    if (this.socket) return;
    this.clearReconnect();
    this.openSocket();
  }

  disconnect(): void {
    this.shouldRun = false;
    this.clearReconnect();
    this.clearStateTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      try {
        socket.close(1000, 'client disconnect');
      } catch {
        /* ignore */
      }
    }
    this.enterOffline();
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  getLocalPlayerId(): string {
    return this.localPlayerId;
  }

  getWorldId(): string {
    return this.worldId;
  }

  getPlayersInWorld(): AvatarState[] {
    return [...this.players.values()].map(copyAvatar);
  }

  getRoster(): AvatarState[] {
    if (this.state !== 'connected') return [this.selfAvatar()];
    return [...this.roster.values()].map(copyAvatar);
  }

  getDynamicPortals(): PortalDefinition[] {
    return [...(this.portalsByWorld.get(this.worldId)?.values() ?? [])].map(copyPortal);
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  /** Queues the local pose; sent at most every `stateIntervalMs` (trailing edge kept). */
  sendState(position: Vec3Tuple, yaw: number, velocityY: number, isFlying?: boolean): void {
    if (![...position, yaw, velocityY].every(Number.isFinite)) return;
    this.position = [position[0], position[1], position[2]];
    this.yaw = yaw;
    this.velocityY = velocityY;
    this.isFlying = isFlying;
    this.pendingState = true;
    if (this.state !== 'connected') return;

    const now = Date.now();
    const wait = this.lastStateSentAt + this.stateIntervalMs - now;
    if (wait <= 0) {
      this.flushState();
    } else if (!this.stateTimer) {
      this.stateTimer = setTimeout(() => {
        this.stateTimer = null;
        this.flushState();
      }, wait);
    }
  }

  switchWorld(worldId: string, position: Vec3Tuple, yaw: number): void {
    const changed = worldId !== this.worldId;
    this.worldId = worldId;
    this.position = [position[0], position[1], position[2]];
    this.yaw = yaw;
    this.velocityY = 0;
    this.pendingState = false;
    this.clearStateTimer();
    if (changed) {
      this.players.clear();
      this.emitPlayers();
      this.emitPortals();
    }
    this.send({ type: 'switch_world', worldId, position: [...this.position] as Vec3Tuple, yaw });
  }

  updateProfile(
    name: string,
    color: string,
    characterId?: string,
    appearance?: Partial<SkinAppearance>,
    bubbleStyle?: SpeechBubbleStyle,
  ): void {
    const cleanName = sanitizeText(name, 32);
    const cleanColor = sanitizeColor(color);
    if (!cleanName || !cleanColor) {
      this.options.onError?.('Invalid name or color');
      return;
    }
    const cleanSkin = sanitizeSkinAppearance({ ...this.identity, ...appearance });
    const cleanChar = characterId ? sanitizeId(characterId) ?? undefined : this.identity.characterId;
    const cleanBubble =
      bubbleStyle !== undefined
        ? sanitizeSpeechBubbleStyle(bubbleStyle, cleanColor) ?? undefined
        : this.identity.bubbleStyle;
    this.identity = {
      ...this.identity,
      ...cleanSkin,
      name: cleanName,
      color: cleanColor,
      ...(cleanChar ? { characterId: cleanChar } : {}),
      ...(cleanBubble ? { bubbleStyle: cleanBubble } : {}),
    };
    const msg: Extract<ClientNetMessage, { type: 'update_profile' }> = {
      type: 'update_profile',
      ...cleanSkin,
      name: cleanName,
      color: cleanColor,
      ...(cleanChar ? { characterId: cleanChar } : {}),
      ...(cleanBubble ? { bubbleStyle: cleanBubble } : {}),
    };
    if (!this.send(msg)) {
      this.emitRoster();
    }
  }

  sendRtcSignal(toPlayerId: string, signal: RtcSignalPayload): boolean {
    const cleanTo = sanitizeId(toPlayerId);
    if (!cleanTo) return false;
    return this.send({ type: 'rtc_signal', toPlayerId: cleanTo, signal });
  }

  sendChatFallback(
    id: string,
    text: string,
    bubbleStyle?: SpeechBubbleStyle,
    toPlayerIds?: string[],
  ): boolean {
    const cleanId = sanitizeId(id);
    const cleanText = sanitizeText(text, MAX_CHAT_MESSAGE_LENGTH);
    if (!cleanId || !cleanText) return false;
    const cleanStyle = bubbleStyle ? sanitizeSpeechBubbleStyle(bubbleStyle, this.identity.color) ?? undefined : undefined;
    const msg: Extract<ClientNetMessage, { type: 'chat_message' }> = {
      type: 'chat_message',
      id: cleanId,
      text: cleanText,
      ...(cleanStyle ? { bubbleStyle: cleanStyle } : {}),
      ...(toPlayerIds && toPlayerIds.length > 0 ? { toPlayerIds } : {}),
    };
    return this.send(msg);
  }

  spawnPortal(worldId: string, portal: PortalDefinition): void {
    if (this.state !== 'connected') {
      // Offline/solo: apply locally so the portal still appears.
      const map = this.portalMap(worldId);
      const limit = this.options.livePortalLimits?.get(worldId) ?? SIDE_PORTALS;
      if (!map.has(portal.id) && map.size >= limit) {
        this.options.onError?.(`This room has used its ${limit} live portal slots`);
        return;
      }
      const local = copyPortal({ ...portal, createdBy: portal.createdBy ?? this.localPlayerId });
      this.portalMap(worldId).set(local.id, local);
      let pending = this.offlinePortals.get(worldId);
      if (!pending) this.offlinePortals.set(worldId, (pending = new Map()));
      pending.set(local.id, local);
      if (worldId === this.worldId) this.emitPortals();
      return;
    }
    this.send({ type: 'spawn_portal', worldId, portal: copyPortal(portal) });
  }

  removePortal(worldId: string, portalId: string): void {
    if (this.state !== 'connected') {
      this.offlinePortals.get(worldId)?.delete(portalId);
      if (this.portalsByWorld.get(worldId)?.delete(portalId) && worldId === this.worldId) {
        this.emitPortals();
      }
      return;
    }
    this.send({ type: 'remove_portal', worldId, portalId });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private openSocket(): void {
    if (!this.url || !this.createSocket) {
      this.enterOffline();
      if (!this.reportedUnreachable) {
        this.reportedUnreachable = true;
        this.options.onError?.('Multiplayer unavailable (no WebSocket URL); playing solo');
      }
      return;
    }
    this.setState('connecting');
    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.url);
    } catch (err) {
      this.handleSocketGone(String(err));
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.rawSend(socket, {
        type: 'hello',
        player: { ...this.identity },
        worldId: this.worldId,
        position: [...this.position] as Vec3Tuple,
        yaw: this.yaw,
      });
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
      let msg: ServerNetMessage;
      try {
        msg = JSON.parse(text) as ServerNetMessage;
      } catch {
        return;
      }
      if (msg && typeof msg === 'object') this.handleServerMessage(msg);
    };
    socket.onerror = () => {
      /* onclose follows and handles reconnect */
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.detach(socket);
      this.socket = null;
      this.handleSocketGone();
    };
  }

  private handleSocketGone(reason?: string): void {
    const wasConnected = this.state === 'connected';
    this.enterOffline();
    if (wasConnected) {
      this.options.onError?.('Disconnected from multiplayer server; retrying…');
    } else if (!this.reportedUnreachable) {
      this.reportedUnreachable = true;
      this.options.onError?.(
        `Multiplayer server unreachable${reason ? ` (${reason})` : ''}; playing solo while retrying`,
      );
    }
    if (this.shouldRun) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const exp = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.reconnectAttempts);
    const delay = Math.round(exp * (0.75 + Math.random() * 0.5));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldRun && !this.socket) this.openSocket();
    }, delay);
  }

  private handleServerMessage(msg: ServerNetMessage): void {
    switch (msg.type) {
      case 'welcome': {
        this.reconnectAttempts = 0;
        this.reportedUnreachable = false;
        this.localPlayerId = msg.playerId;
        this.worldId = msg.worldId;
        this.players = new Map(
          (msg.players ?? []).filter((p) => p.id !== msg.playerId).map((p) => [p.id, copyAvatar(p)]),
        );
        this.roster = new Map((msg.roster ?? []).map((p) => [p.id, copyAvatar(p)]));
        // Server is authoritative for this world's dynamic portals; re-publish
        // any portals spawned here while offline so they are not lost.
        const serverPortals = new Map((msg.dynamicPortals ?? []).map((p) => [p.id, copyPortal(p)]));
        const pending = this.offlinePortals.get(msg.worldId);
        this.offlinePortals.delete(msg.worldId);
        this.portalsByWorld.set(msg.worldId, serverPortals);
        this.setState('connected');
        for (const p of pending?.values() ?? []) {
          if (serverPortals.has(p.id)) continue;
          this.rawSend(this.socket, { type: 'spawn_portal', worldId: msg.worldId, portal: p });
        }
        this.emitPlayers();
        this.emitRoster();
        this.emitPortals();
        if (this.pendingState) this.flushState();
        break;
      }
      case 'player_joined': {
        const p = msg.player;
        if (p) this.roster.set(p.id, copyAvatar(p));
        if (p && p.worldId === this.worldId && p.id !== this.localPlayerId) {
          this.players.set(p.id, copyAvatar(p));
          this.emitPlayers();
        }
        break;
      }
      case 'player_left': {
        if (msg.worldId === this.worldId && this.players.delete(msg.playerId)) this.emitPlayers();
        break;
      }
      case 'player_state': {
        if (msg.worldId !== this.worldId || msg.playerId === this.localPlayerId) break;
        const existing = this.players.get(msg.playerId);
        if (!existing) break;
        existing.position = [...msg.position] as Vec3Tuple;
        existing.yaw = msg.yaw;
        existing.velocityY = msg.velocityY;
        if (typeof msg.isFlying === 'boolean') existing.isFlying = msg.isFlying;
        existing.updatedAt = msg.updatedAt;
        this.emitPlayers();
        break;
      }
      case 'roster_update': {
        this.roster = new Map((msg.roster ?? []).map((p) => [p.id, copyAvatar(p)]));
        this.options.onRosterChange?.(this.getRoster(), msg.event);
        break;
      }
      case 'portal_spawned': {
        if (!msg.portal) break;
        this.portalMap(msg.worldId).set(msg.portal.id, copyPortal(msg.portal));
        if (msg.worldId === this.worldId) this.emitPortals();
        break;
      }
      case 'portal_removed': {
        if (this.portalsByWorld.get(msg.worldId)?.delete(msg.portalId) && msg.worldId === this.worldId) {
          this.emitPortals();
        }
        break;
      }
      case 'rtc_signal': {
        if (msg.worldId !== this.worldId || msg.fromPlayerId === this.localPlayerId) break;
        this.options.onRtcSignal?.(msg.fromPlayerId, msg.worldId, msg.signal);
        break;
      }
      case 'chat_message': {
        if (msg.worldId !== this.worldId || msg.senderId === this.localPlayerId) break;
        this.options.onChatFallback?.({
          id: msg.id,
          senderId: msg.senderId,
          senderName: msg.senderName,
          senderColor: msg.senderColor,
          worldId: msg.worldId,
          text: msg.text,
          bubbleStyle: msg.bubbleStyle,
          sentAt: msg.sentAt,
        });
        break;
      }
      case 'error':
        this.options.onError?.(msg.message || msg.code);
        break;
      case 'pong':
      default:
        break;
    }
  }

  private flushState(): void {
    if (!this.pendingState || this.state !== 'connected') return;
    this.clearStateTimer();
    this.pendingState = false;
    this.lastStateSentAt = Date.now();
    this.send({
      type: 'state',
      position: [...this.position] as Vec3Tuple,
      yaw: this.yaw,
      velocityY: this.velocityY,
      ...(typeof this.isFlying === 'boolean' ? { isFlying: this.isFlying } : {}),
    });
  }

  /** Sends when connected; returns false when offline (message dropped). */
  private send(msg: ClientNetMessage): boolean {
    if (this.state !== 'connected') return false;
    return this.rawSend(this.socket, msg);
  }

  private rawSend(socket: WebSocketLike | null, msg: ClientNetMessage): boolean {
    if (!socket || socket.readyState !== OPEN) return false;
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private enterOffline(): void {
    const wasConnected = this.state === 'connected';
    this.clearStateTimer();
    this.setState('offline');
    if (wasConnected) {
      this.players.clear();
      this.roster.clear();
      this.emitPlayers();
      this.emitRoster();
    }
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.options.onConnectionChange?.(next);
  }

  private selfAvatar(): AvatarState {
    return {
      id: this.localPlayerId,
      name: this.identity.name,
      color: this.identity.color,
      ...sanitizeSkinAppearance({ ...this.identity }),
      ...(this.identity.characterId ? { characterId: this.identity.characterId } : {}),
      ...(this.identity.bubbleStyle ? { bubbleStyle: { ...this.identity.bubbleStyle } } : {}),
      worldId: this.worldId,
      position: [...this.position] as Vec3Tuple,
      yaw: this.yaw,
      velocityY: this.velocityY,
      ...(typeof this.isFlying === 'boolean' ? { isFlying: this.isFlying } : {}),
      updatedAt: Date.now(),
    };
  }

  private portalMap(worldId: string): Map<string, PortalDefinition> {
    let map = this.portalsByWorld.get(worldId);
    if (!map) {
      map = new Map();
      this.portalsByWorld.set(worldId, map);
    }
    return map;
  }

  private emitPlayers(): void {
    this.options.onPlayersChange?.(this.getPlayersInWorld());
  }

  private emitRoster(event?: string): void {
    this.options.onRosterChange?.(this.getRoster(), event);
  }

  private emitPortals(): void {
    this.options.onDynamicPortalsChange?.(this.getDynamicPortals());
  }

  private detach(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearStateTimer(): void {
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = null;
  }
}

/** Generates a stable-ish random player id suitable for `PlayerIdentity.id`. */
export function createPlayerId(prefix = 'p'): string {
  const safePrefix = sanitizeId(prefix) ?? 'p';
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${safePrefix}-${rand}`;
}
