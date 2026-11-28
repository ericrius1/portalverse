import type {
  AvatarState,
  ChatMessage,
  RtcSignalPayload,
  SpeechBubbleStyle,
  Vec3Tuple,
} from '../types';
import { sanitizeId, sanitizeText } from '../portal/handoff';
import {
  createDefaultBubbleStyle,
  MAX_CHAT_MESSAGE_LENGTH,
  sanitizeSpeechBubbleStyle,
} from '../chat/bubbleStyles';
import type { IncomingWsChatMessage } from './multiplayerClient';

export const CHAT_DATA_CHANNEL_LABEL = 'portalverse-chat';
const MAX_DC_PACKET_BYTES = 8192;
const MAX_SEEN_MESSAGE_IDS = 256;
const VOICE_SPEAKING_ON_THRESHOLD = 0.045;
const VOICE_SPEAKING_OFF_THRESHOLD = 0.024;
const TYPING_TIMEOUT_MS = 4200;

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection;

export interface PeerRtcSnapshot {
  playerId: string;
  connectionState: RTCPeerConnectionState | 'new';
  dataChannelOpen: boolean;
  hasRemoteAudio: boolean;
  speaking: boolean;
  voiceLevel: number;
  remoteMuted: boolean;
  locallyMuted: boolean;
  typing: boolean;
  bubbleStyle?: SpeechBubbleStyle;
}

export interface VoiceStateSnapshot {
  supported: boolean;
  joined: boolean;
  muted: boolean;
  deafened: boolean;
  pushToTalk: boolean;
  pttActive: boolean;
  spatialAudio: boolean;
  speaking: boolean;
  localLevel: number;
  inputDeviceId: string | null;
  p2pPeerCount: number;
  voicePeerCount: number;
  error?: string;
}

export interface WebRtcMeshOptions {
  localPlayerId: string;
  localPlayerName: string;
  localPlayerColor: string;
  localBubbleStyle: SpeechBubbleStyle;
  worldId: string;
  iceServers?: RTCIceServer[];
  /** Send signaling message to a specific peer via the multiplayer WebSocket. */
  sendSignal: (toPlayerId: string, signal: RtcSignalPayload) => void;
  /** Optional fallback relay over WebSocket for peers whose DataChannel is not open yet. */
  sendChatFallback?: (
    id: string,
    text: string,
    bubbleStyle: SpeechBubbleStyle,
    toPlayerIds: string[],
  ) => void;
  onChatMessage?: (message: ChatMessage) => void;
  onPeerTyping?: (playerId: string, typing: boolean, style?: SpeechBubbleStyle) => void;
  onPeerStyleUpdate?: (playerId: string, style: SpeechBubbleStyle) => void;
  onVoiceActivity?: (playerId: string, speaking: boolean, level: number, isLocal: boolean) => void;
  onStateChange?: (voice: VoiceStateSnapshot, peers: PeerRtcSnapshot[]) => void;
  onError?: (message: string) => void;
  /** Override RTCPeerConnection construction (for tests). */
  createPeerConnection?: PeerConnectionFactory;
  /** Override getUserMedia (for tests). */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

interface DataChannelPacketChat {
  kind: 'chat';
  id: string;
  text: string;
  bubbleStyle?: SpeechBubbleStyle;
  sentAt: number;
}

interface DataChannelPacketTyping {
  kind: 'typing';
  active: boolean;
}

interface DataChannelPacketVoiceState {
  kind: 'voice_state';
  muted: boolean;
  speaking: boolean;
  level: number;
}

interface DataChannelPacketStyleUpdate {
  kind: 'style_update';
  bubbleStyle: SpeechBubbleStyle;
}

type DataChannelPacket =
  | DataChannelPacketChat
  | DataChannelPacketTyping
  | DataChannelPacketVoiceState
  | DataChannelPacketStyleUpdate;

interface PeerEntry {
  playerId: string;
  name: string;
  color: string;
  bubbleStyle: SpeechBubbleStyle;
  polite: boolean;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  audioSender: RTCRtpSender | null;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingIce: RTCIceCandidateInit[];
  remoteStream: MediaStream | null;
  audioEl: HTMLAudioElement | null;
  mediaSource: MediaStreamAudioSourceNode | null;
  panner: PannerNode | null;
  gainNode: GainNode | null;
  analyser: AnalyserNode | null;
  analyserBuf: Float32Array<ArrayBuffer> | null;
  hasRemoteAudio: boolean;
  speaking: boolean;
  voiceLevel: number;
  remoteMuted: boolean;
  locallyMuted: boolean;
  typing: boolean;
  typingTimer: ReturnType<typeof setTimeout> | null;
  iceRestarted: boolean;
}

function defaultPeerConnectionFactory(): PeerConnectionFactory | null {
  const Ctor = (globalThis as { RTCPeerConnection?: new (config?: RTCConfiguration) => RTCPeerConnection })
    .RTCPeerConnection;
  return Ctor ? (config) => new Ctor(config) : null;
}

function defaultGetUserMedia(): ((c: MediaStreamConstraints) => Promise<MediaStream>) | null {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav?.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function') {
    return (c) => nav.mediaDevices.getUserMedia(c);
  }
  return null;
}

function computeRmsLevel(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  return Math.min(1, rms * 4.5);
}

/** Fetches ICE server configuration from the Portalverse server, falling back to public STUN. */
export async function fetchRtcIceServers(apiUrl = '/api/rtc-config'): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return DEFAULT_ICE_SERVERS;
    const data = (await res.json()) as { iceServers?: unknown };
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      return data.iceServers as RTCIceServer[];
    }
  } catch {
    // Fall back to default public STUN servers
  }
  return DEFAULT_ICE_SERVERS;
}

function createChatMessageId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `m-${Date.now().toString(36)}-${rand}`;
}

/**
 * Room-scoped WebRTC full-mesh manager for Portalverse:
 * - Uses W3C Perfect Negotiation over the existing `/ws` signaling relay.
 * - Opens a reliable `RTCDataChannel` ("portalverse-chat") per peer for P2P text chat,
 *   typing indicators, voice status, and live speech bubble style updates.
 * - Streams live microphone voice chat over WebRTC audio tracks with 3D spatial audio
 *   (`PannerNode`) + real-time voice activity levels (`AnalyserNode`) for 3D voice bubbles.
 */
export class WebRtcMesh {
  private readonly options: WebRtcMeshOptions;
  private readonly createPc: PeerConnectionFactory | null;
  private readonly getUserMediaFn: ((c: MediaStreamConstraints) => Promise<MediaStream>) | null;

  private iceServers: RTCIceServer[];
  private localPlayerId: string;
  private localPlayerName: string;
  private localPlayerColor: string;
  private localBubbleStyle: SpeechBubbleStyle;
  private worldId: string;

  private readonly peers = new Map<string, PeerEntry>();
  private readonly locallyMutedPeers = new Set<string>();
  private readonly seenMessageIds: string[] = [];
  private readonly seenMessageSet = new Set<string>();

  // Voice & Web Audio state
  private audioCtx: AudioContext | null = null;
  private localStream: MediaStream | null = null;
  private localAudioTrack: MediaStreamTrack | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localAnalyserBuf: Float32Array<ArrayBuffer> | null = null;

  private voiceJoined = false;
  private muted = false;
  private deafened = false;
  private pushToTalk = false;
  private pttActive = false;
  private spatialAudio = true;
  private localSpeaking = false;
  private localLevel = 0;
  private inputDeviceId: string | null = null;
  private lastVoiceError: string | undefined;
  private lastLevelSampleAt = 0;
  private lastBroadcastSpeaking = false;
  private lastBroadcastMuted = true;
  private disposed = false;

  constructor(options: WebRtcMeshOptions) {
    this.options = options;
    this.localPlayerId = options.localPlayerId;
    this.localPlayerName = options.localPlayerName;
    this.localPlayerColor = options.localPlayerColor;
    this.localBubbleStyle = { ...options.localBubbleStyle };
    this.worldId = options.worldId;
    this.iceServers = options.iceServers?.length ? [...options.iceServers] : [...DEFAULT_ICE_SERVERS];
    this.createPc = options.createPeerConnection ?? defaultPeerConnectionFactory();
    this.getUserMediaFn = options.getUserMedia ?? defaultGetUserMedia();
  }

  // -------------------------------------------------------------------------
  // Configuration & Local Identity
  // -------------------------------------------------------------------------

  setIceServers(servers: RTCIceServer[]): void {
    if (servers.length > 0) this.iceServers = [...servers];
  }

  setLocalIdentity(id: string, name: string, color: string, bubbleStyle: SpeechBubbleStyle): void {
    const idChanged = id !== this.localPlayerId;
    const styleChanged = JSON.stringify(bubbleStyle) !== JSON.stringify(this.localBubbleStyle);
    this.localPlayerId = id;
    this.localPlayerName = name;
    this.localPlayerColor = color;
    this.localBubbleStyle = { ...bubbleStyle };

    if (idChanged) {
      // Polite role depends on localPlayerId comparison; recreate peer connections cleanly.
      const peerAvatars = [...this.peers.values()].map((p) => ({
        id: p.playerId,
        name: p.name,
        color: p.color,
        bubbleStyle: p.bubbleStyle,
        worldId: this.worldId,
        position: [0, 0, 0] as Vec3Tuple,
        yaw: 0,
        velocityY: 0,
        updatedAt: Date.now(),
      }));
      this.closeAllPeers();
      this.syncPeers(peerAvatars, id, this.worldId);
      return;
    }

    if (styleChanged) {
      this.broadcastDataChannel({ kind: 'style_update', bubbleStyle: this.localBubbleStyle });
    }
  }

  getVoiceSnapshot(): VoiceStateSnapshot {
    let p2pPeerCount = 0;
    let voicePeerCount = 0;
    for (const p of this.peers.values()) {
      if (p.dc?.readyState === 'open' || p.pc.connectionState === 'connected') p2pPeerCount++;
      if (p.hasRemoteAudio) voicePeerCount++;
    }
    return {
      supported: Boolean(this.createPc),
      joined: this.voiceJoined,
      muted: this.isEffectivelyMuted(),
      deafened: this.deafened,
      pushToTalk: this.pushToTalk,
      pttActive: this.pttActive,
      spatialAudio: this.spatialAudio,
      speaking: this.localSpeaking,
      localLevel: this.localLevel,
      inputDeviceId: this.inputDeviceId,
      p2pPeerCount,
      voicePeerCount,
      ...(this.lastVoiceError ? { error: this.lastVoiceError } : {}),
    };
  }

  getPeerSnapshots(): PeerRtcSnapshot[] {
    return [...this.peers.values()].map((p) => ({
      playerId: p.playerId,
      connectionState: p.pc.connectionState ?? 'new',
      dataChannelOpen: p.dc?.readyState === 'open',
      hasRemoteAudio: p.hasRemoteAudio,
      speaking: p.speaking,
      voiceLevel: p.voiceLevel,
      remoteMuted: p.remoteMuted,
      locallyMuted: p.locallyMuted,
      typing: p.typing,
      bubbleStyle: { ...p.bubbleStyle },
    }));
  }

  // -------------------------------------------------------------------------
  // Peer Sync & Signaling
  // -------------------------------------------------------------------------

  /** Synchronize WebRTC peer connections with the players currently in the active room. */
  syncPeers(playersInWorld: AvatarState[], localPlayerId: string, worldId: string): void {
    if (this.disposed) return;
    if (localPlayerId !== this.localPlayerId) {
      this.localPlayerId = localPlayerId;
      this.closeAllPeers();
    }
    if (worldId !== this.worldId) {
      this.worldId = worldId;
      this.closeAllPeers();
    }

    const activeIds = new Set<string>();
    for (const p of playersInWorld) {
      if (p.id === this.localPlayerId) continue;
      activeIds.add(p.id);
      const existing = this.peers.get(p.id);
      const nextStyle = p.bubbleStyle
        ? sanitizeSpeechBubbleStyle(p.bubbleStyle, p.color) ?? createDefaultBubbleStyle(p.color)
        : existing?.bubbleStyle ?? createDefaultBubbleStyle(p.color);
      if (existing) {
        existing.name = p.name;
        existing.color = p.color;
        existing.bubbleStyle = nextStyle;
      } else {
        this.connectPeer(p.id, p.name, p.color, nextStyle);
      }
    }

    let changed = false;
    for (const peerId of [...this.peers.keys()]) {
      if (!activeIds.has(peerId)) {
        this.removePeer(peerId);
        changed = true;
      }
    }
    if (changed || activeIds.size > 0) {
      this.emitState();
    }
  }

  async handleSignal(fromPlayerId: string, worldId: string, signal: RtcSignalPayload): Promise<void> {
    if (this.disposed || worldId !== this.worldId || fromPlayerId === this.localPlayerId) return;
    let peer = this.peers.get(fromPlayerId);
    if (!peer) {
      peer = this.connectPeer(fromPlayerId, fromPlayerId, '#38bdf8', createDefaultBubbleStyle());
      if (!peer) return;
    }

    const pc = peer.pc;
    try {
      if (signal.kind === 'offer' || signal.kind === 'answer') {
        const description: RTCSessionDescriptionInit = { type: signal.kind, sdp: signal.sdp };
        const readyForOffer =
          !peer.makingOffer &&
          (pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
        const offerCollision = signal.kind === 'offer' && !readyForOffer;

        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        peer.isSettingRemoteAnswerPending = signal.kind === 'answer';
        await pc.setRemoteDescription(description);
        peer.isSettingRemoteAnswerPending = false;
        await this.flushPendingIce(peer);

        if (signal.kind === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription?.sdp && (pc.localDescription.type === 'answer' || pc.localDescription.type === 'offer')) {
            this.options.sendSignal(peer.playerId, {
              kind: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            });
          }
        }
      } else if (signal.kind === 'ice') {
        const candidate: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid ?? undefined,
          sdpMLineIndex: signal.sdpMLineIndex ?? undefined,
          usernameFragment: signal.usernameFragment ?? undefined,
        };
        if (!pc.remoteDescription) {
          peer.pendingIce.push(candidate);
        } else {
          try {
            await pc.addIceCandidate(candidate);
          } catch (err) {
            if (!peer.ignoreOffer) {
              console.warn('[webrtc] ice candidate error:', err);
            }
          }
        }
      }
    } catch (err) {
      peer.isSettingRemoteAnswerPending = false;
      console.warn('[webrtc] signal handling failed:', err);
    }
  }

  // -------------------------------------------------------------------------
  // Text Chat & Typing via WebRTC DataChannel (with WS fallback)
  // -------------------------------------------------------------------------

  sendChatMessage(rawText: string, style?: SpeechBubbleStyle): ChatMessage | null {
    const cleanText = sanitizeText(rawText, MAX_CHAT_MESSAGE_LENGTH);
    if (!cleanText) return null;
    const resolvedStyle =
      (style ? sanitizeSpeechBubbleStyle(style, this.localPlayerColor) : null) ??
      { ...this.localBubbleStyle };
    const id = createChatMessageId();
    const sentAt = Date.now();
    this.rememberMessageId(id);

    const packet: DataChannelPacketChat = {
      kind: 'chat',
      id,
      text: cleanText,
      bubbleStyle: resolvedStyle,
      sentAt,
    };

    let sentViaWebRtc = 0;
    const fallbackTargets: string[] = [];
    for (const peer of this.peers.values()) {
      if (this.sendToPeerChannel(peer, packet)) {
        sentViaWebRtc++;
      } else {
        fallbackTargets.push(peer.playerId);
      }
    }

    if (fallbackTargets.length > 0) {
      this.options.sendChatFallback?.(id, cleanText, resolvedStyle, fallbackTargets);
    }

    const message: ChatMessage = {
      id,
      senderId: this.localPlayerId,
      senderName: this.localPlayerName,
      senderColor: this.localPlayerColor,
      worldId: this.worldId,
      text: cleanText,
      bubbleStyle: resolvedStyle,
      sentAt,
      transport: sentViaWebRtc > 0 ? 'webrtc' : fallbackTargets.length > 0 ? 'ws-fallback' : 'local',
    };
    this.options.onChatMessage?.(message);
    return message;
  }

  handleWsChatFallback(msg: IncomingWsChatMessage): void {
    if (this.disposed || msg.worldId !== this.worldId || msg.senderId === this.localPlayerId) return;
    if (this.seenMessageSet.has(msg.id)) return;
    const cleanText = sanitizeText(msg.text, MAX_CHAT_MESSAGE_LENGTH);
    if (!cleanText) return;
    this.rememberMessageId(msg.id);

    const peer = this.peers.get(msg.senderId);
    const bubbleStyle =
      (msg.bubbleStyle ? sanitizeSpeechBubbleStyle(msg.bubbleStyle, msg.senderColor) : null) ??
      peer?.bubbleStyle ??
      createDefaultBubbleStyle(msg.senderColor);

    if (peer) {
      peer.bubbleStyle = bubbleStyle;
      this.setPeerTyping(peer, false);
    }

    this.options.onChatMessage?.({
      id: msg.id,
      senderId: msg.senderId,
      senderName: msg.senderName,
      senderColor: msg.senderColor,
      worldId: msg.worldId,
      text: cleanText,
      bubbleStyle,
      sentAt: msg.sentAt,
      transport: 'ws-fallback',
    });
  }

  sendTyping(active: boolean): void {
    this.broadcastDataChannel({ kind: 'typing', active });
  }

  // -------------------------------------------------------------------------
  // Voice Chat & 3D Spatial Audio
  // -------------------------------------------------------------------------

  /** Unlock/resume the dedicated Voice AudioContext from any user gesture. */
  resumeAudio(): void {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }
    for (const peer of this.peers.values()) {
      if (peer.audioEl && peer.audioEl.paused) {
        void peer.audioEl.play().catch(() => {});
      }
    }
  }

  async joinVoice(deviceId?: string | null): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.createPc || !this.getUserMediaFn) {
      this.lastVoiceError = 'Voice chat requires WebRTC microphone support in this browser.';
      this.options.onError?.(this.lastVoiceError);
      this.emitState();
      return false;
    }

    this.ensureAudioContext();
    this.resumeAudio();
    this.lastVoiceError = undefined;

    const audioConstraint: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };

    try {
      const stream = await this.getUserMediaFn({ audio: audioConstraint, video: false });
      const track = stream.getAudioTracks()[0] ?? null;
      if (!track) {
        for (const t of stream.getTracks()) t.stop();
        throw new Error('No microphone track available');
      }

      // Stop any previous mic stream cleanly
      this.teardownLocalStream();
      this.localStream = stream;
      this.localAudioTrack = track;
      this.inputDeviceId = track.getSettings?.().deviceId ?? deviceId ?? null;
      this.voiceJoined = true;
      this.applyLocalTrackEnabled();
      this.setupLocalAnalyser(stream);

      // Attach audio track to every active peer connection
      for (const peer of this.peers.values()) {
        await this.attachLocalTrackToPeer(peer);
      }

      this.broadcastVoiceState(true);
      this.emitState();
      return true;
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission denied — allow mic access to use voice chat.'
          : err instanceof Error
            ? `Could not access microphone: ${err.message}`
            : 'Could not access microphone.';
      this.lastVoiceError = msg;
      this.options.onError?.(msg);
      this.emitState();
      return false;
    }
  }

  leaveVoice(): void {
    if (!this.voiceJoined && !this.localStream) return;
    this.voiceJoined = false;
    this.pttActive = false;
    this.localSpeaking = false;
    this.localLevel = 0;
    this.teardownLocalStream();

    for (const peer of this.peers.values()) {
      if (peer.audioSender) {
        void peer.audioSender.replaceTrack(null).catch(() => {});
      }
    }

    this.options.onVoiceActivity?.(this.localPlayerId, false, 0, true);
    this.broadcastVoiceState(true);
    this.emitState();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyLocalTrackEnabled();
    if (this.isEffectivelyMuted()) {
      this.localSpeaking = false;
      this.localLevel = 0;
      this.options.onVoiceActivity?.(this.localPlayerId, false, 0, true);
    }
    this.broadcastVoiceState(true);
    this.emitState();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setPushToTalk(enabled: boolean): void {
    this.pushToTalk = enabled;
    if (!enabled) this.pttActive = false;
    this.applyLocalTrackEnabled();
    this.broadcastVoiceState(true);
    this.emitState();
  }

  setPushToTalkPressed(pressed: boolean): void {
    if (!this.voiceJoined || !this.pushToTalk) return;
    if (this.pttActive === pressed) return;
    this.pttActive = pressed;
    this.applyLocalTrackEnabled();
    if (!pressed) {
      this.localSpeaking = false;
      this.localLevel = 0;
      this.options.onVoiceActivity?.(this.localPlayerId, false, 0, true);
    }
    this.broadcastVoiceState(true);
    this.emitState();
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    for (const peer of this.peers.values()) {
      this.syncPeerAudioGain(peer);
    }
    this.emitState();
  }

  setSpatialAudio(spatial: boolean): void {
    this.spatialAudio = spatial;
    for (const peer of this.peers.values()) {
      if (peer.panner) {
        peer.panner.rolloffFactor = spatial ? 1.15 : 0;
      }
    }
    this.emitState();
  }

  setPeerLocallyMuted(playerId: string, muted: boolean): void {
    if (muted) this.locallyMutedPeers.add(playerId);
    else this.locallyMutedPeers.delete(playerId);
    const peer = this.peers.get(playerId);
    if (peer) {
      peer.locallyMuted = muted;
      this.syncPeerAudioGain(peer);
      this.emitState();
    }
  }

  async listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!nav?.mediaDevices || typeof nav.mediaDevices.enumerateDevices !== 'function') return [];
    try {
      const devices = await nav.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  /**
   * Call once per frame from the render loop to keep 3D spatial voice panners
   * aligned with avatars and sample real-time voice activity levels (~15 Hz).
   */
  updateSpatialAndLevels(
    listenerPos: Readonly<Vec3Tuple>,
    listenerForward: Readonly<Vec3Tuple>,
    listenerUp: Readonly<Vec3Tuple>,
    getPeerPosition: (playerId: string) => Readonly<Vec3Tuple> | null,
    nowMs = performance.now(),
  ): void {
    if (this.disposed) return;

    // 1. Update Web Audio 3D listener + peer panners
    if (this.audioCtx && this.audioCtx.state === 'running') {
      const listener = this.audioCtx.listener;
      const t = this.audioCtx.currentTime;
      if (listener.positionX) {
        listener.positionX.setTargetAtTime(listenerPos[0], t, 0.03);
        listener.positionY.setTargetAtTime(listenerPos[1], t, 0.03);
        listener.positionZ.setTargetAtTime(listenerPos[2], t, 0.03);
        listener.forwardX.setTargetAtTime(listenerForward[0], t, 0.03);
        listener.forwardY.setTargetAtTime(listenerForward[1], t, 0.03);
        listener.forwardZ.setTargetAtTime(listenerForward[2], t, 0.03);
        listener.upX.setTargetAtTime(listenerUp[0], t, 0.03);
        listener.upY.setTargetAtTime(listenerUp[1], t, 0.03);
        listener.upZ.setTargetAtTime(listenerUp[2], t, 0.03);
      } else if (typeof listener.setPosition === 'function') {
        listener.setPosition(listenerPos[0], listenerPos[1], listenerPos[2]);
        listener.setOrientation(
          listenerForward[0],
          listenerForward[1],
          listenerForward[2],
          listenerUp[0],
          listenerUp[1],
          listenerUp[2],
        );
      }

      for (const peer of this.peers.values()) {
        if (!peer.panner) continue;
        const pos = this.spatialAudio ? getPeerPosition(peer.playerId) : null;
        const px = pos ? pos[0] : listenerPos[0];
        const py = pos ? pos[1] + 1.65 : listenerPos[1];
        const pz = pos ? pos[2] : listenerPos[2];
        if (peer.panner.positionX) {
          peer.panner.positionX.setTargetAtTime(px, t, 0.04);
          peer.panner.positionY.setTargetAtTime(py, t, 0.04);
          peer.panner.positionZ.setTargetAtTime(pz, t, 0.04);
        } else if (typeof peer.panner.setPosition === 'function') {
          peer.panner.setPosition(px, py, pz);
        }
      }
    }

    // 2. Sample audio levels at ~15 Hz
    if (nowMs - this.lastLevelSampleAt < 65) return;
    this.lastLevelSampleAt = nowMs;

    let stateDirty = false;

    if (this.voiceJoined && !this.isEffectivelyMuted() && this.localAnalyser && this.localAnalyserBuf) {
      const level = computeRmsLevel(this.localAnalyser, this.localAnalyserBuf);
      const nextSpeaking = this.localSpeaking
        ? level > VOICE_SPEAKING_OFF_THRESHOLD
        : level > VOICE_SPEAKING_ON_THRESHOLD;
      if (nextSpeaking !== this.localSpeaking || Math.abs(level - this.localLevel) > 0.05) {
        this.localSpeaking = nextSpeaking;
        this.localLevel = nextSpeaking ? Math.max(0.15, level) : level * 0.4;
        this.options.onVoiceActivity?.(this.localPlayerId, this.localSpeaking, this.localLevel, true);
        stateDirty = true;
      }
      if (this.localSpeaking !== this.lastBroadcastSpeaking) {
        this.broadcastVoiceState(false);
      }
    }

    for (const peer of this.peers.values()) {
      if (peer.analyser && peer.analyserBuf && !peer.locallyMuted && !this.deafened) {
        const level = computeRmsLevel(peer.analyser, peer.analyserBuf);
        const nextSpeaking = peer.speaking
          ? level > VOICE_SPEAKING_OFF_THRESHOLD
          : level > VOICE_SPEAKING_ON_THRESHOLD;
        if (nextSpeaking !== peer.speaking || (nextSpeaking && Math.abs(level - peer.voiceLevel) > 0.05)) {
          peer.speaking = nextSpeaking;
          peer.voiceLevel = nextSpeaking ? Math.max(0.18, level) : 0;
          this.options.onVoiceActivity?.(peer.playerId, peer.speaking, peer.voiceLevel, false);
          stateDirty = true;
        }
      }
    }

    if (stateDirty) {
      this.emitState();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.leaveVoice();
    this.closeAllPeers();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private isEffectivelyMuted(): boolean {
    if (!this.voiceJoined) return true;
    if (this.pushToTalk) return !this.pttActive;
    return this.muted;
  }

  private applyLocalTrackEnabled(): void {
    if (this.localAudioTrack) {
      this.localAudioTrack.enabled = !this.isEffectivelyMuted();
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return null;
    try {
      this.audioCtx = new Ctor({ latencyHint: 'interactive' });
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  private setupLocalAnalyser(stream: MediaStream): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    try {
      this.localSource = ctx.createMediaStreamSource(stream);
      this.localAnalyser = ctx.createAnalyser();
      this.localAnalyser.fftSize = 256;
      this.localAnalyser.smoothingTimeConstant = 0.65;
      this.localSource.connect(this.localAnalyser);
      this.localAnalyserBuf = new Float32Array(new ArrayBuffer(this.localAnalyser.fftSize * 4));
    } catch {
      this.localSource = null;
      this.localAnalyser = null;
      this.localAnalyserBuf = null;
    }
  }

  private teardownLocalStream(): void {
    try {
      this.localSource?.disconnect();
    } catch {
      /* ignore */
    }
    this.localSource = null;
    this.localAnalyser = null;
    this.localAnalyserBuf = null;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    this.localStream = null;
    this.localAudioTrack = null;
  }

  private connectPeer(
    playerId: string,
    name: string,
    color: string,
    bubbleStyle: SpeechBubbleStyle,
  ): PeerEntry | undefined {
    if (!this.createPc) return undefined;
    const existing = this.peers.get(playerId);
    if (existing) return existing;

    const pc = this.createPc({ iceServers: this.iceServers });
    const polite = this.localPlayerId.localeCompare(playerId) < 0;

    const peer: PeerEntry = {
      playerId,
      name,
      color,
      bubbleStyle: { ...bubbleStyle },
      polite,
      pc,
      dc: null,
      audioSender: null,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingIce: [],
      remoteStream: null,
      audioEl: null,
      mediaSource: null,
      panner: null,
      gainNode: null,
      analyser: null,
      analyserBuf: null,
      hasRemoteAudio: false,
      speaking: false,
      voiceLevel: 0,
      remoteMuted: true,
      locallyMuted: this.locallyMutedPeers.has(playerId),
      typing: false,
      typingTimer: null,
      iceRestarted: false,
    };

    this.peers.set(playerId, peer);

    pc.onicecandidate = (ev) => {
      if (this.peers.get(playerId) !== peer || !ev.candidate) return;
      this.options.sendSignal(playerId, {
        kind: 'ice',
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex,
        usernameFragment: ev.candidate.usernameFragment ?? null,
      });
    };

    pc.onnegotiationneeded = async () => {
      if (this.peers.get(playerId) !== peer) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription?.sdp && (pc.localDescription.type === 'offer' || pc.localDescription.type === 'answer')) {
          this.options.sendSignal(playerId, {
            kind: pc.localDescription.type,
            sdp: pc.localDescription.sdp,
          });
        }
      } catch (err) {
        console.warn('[webrtc] negotiationneeded error:', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.peers.get(playerId) !== peer) return;
      if (pc.connectionState === 'failed' && !peer.iceRestarted && !peer.polite) {
        peer.iceRestarted = true;
        try {
          pc.restartIce?.();
        } catch {
          /* ignore */
        }
      }
      this.emitState();
    };

    pc.ondatachannel = (ev) => {
      if (this.peers.get(playerId) !== peer) return;
      this.bindDataChannel(peer, ev.channel);
    };

    pc.ontrack = (ev) => {
      if (this.peers.get(playerId) !== peer) return;
      if (ev.track.kind !== 'audio') return;
      const stream = ev.streams[0] ?? (typeof MediaStream !== 'undefined' ? new MediaStream([ev.track]) : null);
      if (stream) {
        this.attachRemoteAudioStream(peer, stream);
      }
      ev.track.onended = () => {
        if (this.peers.get(playerId) !== peer) return;
        peer.hasRemoteAudio = false;
        peer.speaking = false;
        peer.voiceLevel = 0;
        this.options.onVoiceActivity?.(peer.playerId, false, 0, false);
        this.emitState();
      };
    };

    // Impolite peer creates the reliable chat DataChannel so both sides converge cleanly.
    if (!polite) {
      const dc = pc.createDataChannel(CHAT_DATA_CHANNEL_LABEL, { ordered: true });
      this.bindDataChannel(peer, dc);
    }

    // Attach our active voice track right away if we're already in voice chat.
    if (this.voiceJoined && this.localAudioTrack && this.localStream) {
      void this.attachLocalTrackToPeer(peer);
    }

    return peer;
  }

  private async attachLocalTrackToPeer(peer: PeerEntry): Promise<void> {
    if (!this.localAudioTrack || !this.localStream) return;
    try {
      if (peer.audioSender) {
        await peer.audioSender.replaceTrack(this.localAudioTrack);
      } else {
        peer.audioSender = peer.pc.addTrack(this.localAudioTrack, this.localStream);
      }
    } catch (err) {
      console.warn('[webrtc] failed to attach audio track:', err);
    }
  }

  private bindDataChannel(peer: PeerEntry, dc: RTCDataChannel): void {
    peer.dc = dc;
    dc.onopen = () => {
      if (this.peers.get(peer.playerId) !== peer) return;
      // Sync current bubble style & voice status as soon as the P2P channel opens
      this.sendToPeerChannel(peer, {
        kind: 'style_update',
        bubbleStyle: this.localBubbleStyle,
      });
      this.sendToPeerChannel(peer, {
        kind: 'voice_state',
        muted: this.isEffectivelyMuted(),
        speaking: this.localSpeaking,
        level: this.localLevel,
      });
      this.emitState();
    };
    dc.onclose = () => {
      if (this.peers.get(peer.playerId) !== peer) return;
      this.setPeerTyping(peer, false);
      this.emitState();
    };
    dc.onmessage = (ev) => {
      if (this.peers.get(peer.playerId) !== peer) return;
      this.handleDataChannelMessage(peer, ev.data);
    };
  }

  private handleDataChannelMessage(peer: PeerEntry, raw: unknown): void {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_DC_PACKET_BYTES) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const pkt = parsed as Record<string, unknown>;

    switch (pkt.kind) {
      case 'chat': {
        const id = sanitizeId(pkt.id);
        const text = sanitizeText(pkt.text, MAX_CHAT_MESSAGE_LENGTH);
        if (!id || !text || this.seenMessageSet.has(id)) return;
        this.rememberMessageId(id);

        const bubbleStyle =
          (pkt.bubbleStyle ? sanitizeSpeechBubbleStyle(pkt.bubbleStyle, peer.color) : null) ??
          peer.bubbleStyle;
        peer.bubbleStyle = bubbleStyle;
        this.setPeerTyping(peer, false);

        const sentAt = typeof pkt.sentAt === 'number' && Number.isFinite(pkt.sentAt) ? pkt.sentAt : Date.now();
        this.options.onChatMessage?.({
          id,
          senderId: peer.playerId,
          senderName: peer.name,
          senderColor: peer.color,
          worldId: this.worldId,
          text,
          bubbleStyle,
          sentAt,
          transport: 'webrtc',
        });
        break;
      }
      case 'typing': {
        if (typeof pkt.active !== 'boolean') return;
        this.setPeerTyping(peer, pkt.active);
        break;
      }
      case 'style_update': {
        const style = sanitizeSpeechBubbleStyle(pkt.bubbleStyle, peer.color);
        if (!style) return;
        peer.bubbleStyle = style;
        this.options.onPeerStyleUpdate?.(peer.playerId, style);
        this.emitState();
        break;
      }
      case 'voice_state': {
        if (typeof pkt.muted === 'boolean') peer.remoteMuted = pkt.muted;
        if (typeof pkt.speaking === 'boolean' && !peer.analyser) {
          const level =
            typeof pkt.level === 'number' && Number.isFinite(pkt.level)
              ? Math.max(0, Math.min(1, pkt.level))
              : pkt.speaking
                ? 0.55
                : 0;
          peer.speaking = pkt.speaking && !peer.locallyMuted && !this.deafened;
          peer.voiceLevel = peer.speaking ? level : 0;
          this.options.onVoiceActivity?.(peer.playerId, peer.speaking, peer.voiceLevel, false);
        }
        this.emitState();
        break;
      }
      default:
        break;
    }
  }

  private setPeerTyping(peer: PeerEntry, active: boolean): void {
    if (peer.typingTimer) {
      clearTimeout(peer.typingTimer);
      peer.typingTimer = null;
    }
    if (active) {
      peer.typingTimer = setTimeout(() => {
        peer.typingTimer = null;
        if (peer.typing) {
          peer.typing = false;
          this.options.onPeerTyping?.(peer.playerId, false, peer.bubbleStyle);
          this.emitState();
        }
      }, TYPING_TIMEOUT_MS);
    }
    if (peer.typing !== active) {
      peer.typing = active;
      this.options.onPeerTyping?.(peer.playerId, active, peer.bubbleStyle);
      this.emitState();
    }
  }

  private attachRemoteAudioStream(peer: PeerEntry, stream: MediaStream): void {
    this.teardownPeerAudio(peer);
    peer.remoteStream = stream;
    peer.hasRemoteAudio = true;

    const ctx = this.ensureAudioContext();

    // Always bind to an HTMLAudioElement too: Chromium requires an active <audio> sink
    // to pump decoded WebRTC packets into Web Audio's MediaStreamAudioSourceNode.
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audioEl.srcObject = stream;
      audioEl.muted = Boolean(ctx);
      void audioEl.play().catch(() => {});
      peer.audioEl = audioEl;
    }

    if (ctx) {
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.65;

        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 3.5;
        panner.maxDistance = 55;
        panner.rolloffFactor = this.spatialAudio ? 1.15 : 0;

        const gain = ctx.createGain();
        gain.gain.value = this.deafened || peer.locallyMuted ? 0 : 1;

        source.connect(analyser);
        analyser.connect(panner);
        panner.connect(gain);
        gain.connect(ctx.destination);

        peer.mediaSource = source;
        peer.analyser = analyser;
        peer.analyserBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
        peer.panner = panner;
        peer.gainNode = gain;
      } catch {
        // Fall back to direct HTMLAudioElement playback
        if (peer.audioEl) {
          peer.audioEl.muted = this.deafened || peer.locallyMuted;
        }
      }
    }

    this.syncPeerAudioGain(peer);
    this.emitState();
  }

  private syncPeerAudioGain(peer: PeerEntry): void {
    const silenced = this.deafened || peer.locallyMuted;
    if (peer.gainNode && this.audioCtx) {
      peer.gainNode.gain.setTargetAtTime(silenced ? 0 : 1, this.audioCtx.currentTime, 0.03);
    } else if (peer.audioEl) {
      peer.audioEl.muted = silenced;
    }
    if (silenced && peer.speaking) {
      peer.speaking = false;
      peer.voiceLevel = 0;
      this.options.onVoiceActivity?.(peer.playerId, false, 0, false);
    }
  }

  private teardownPeerAudio(peer: PeerEntry): void {
    try {
      peer.mediaSource?.disconnect();
      peer.analyser?.disconnect();
      peer.panner?.disconnect();
      peer.gainNode?.disconnect();
    } catch {
      /* ignore */
    }
    if (peer.audioEl) {
      try {
        peer.audioEl.pause();
        peer.audioEl.srcObject = null;
      } catch {
        /* ignore */
      }
    }
    peer.mediaSource = null;
    peer.analyser = null;
    peer.analyserBuf = null;
    peer.panner = null;
    peer.gainNode = null;
    peer.audioEl = null;
    peer.remoteStream = null;
    peer.hasRemoteAudio = false;
  }

  private async flushPendingIce(peer: PeerEntry): Promise<void> {
    if (!peer.pendingIce.length) return;
    const queued = peer.pendingIce.splice(0);
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.warn('[webrtc] queued ice error:', err);
      }
    }
  }

  private sendToPeerChannel(peer: PeerEntry, packet: DataChannelPacket): boolean {
    if (!peer.dc || peer.dc.readyState !== 'open') return false;
    try {
      peer.dc.send(JSON.stringify(packet));
      return true;
    } catch {
      return false;
    }
  }

  private broadcastDataChannel(packet: DataChannelPacket): void {
    for (const peer of this.peers.values()) {
      this.sendToPeerChannel(peer, packet);
    }
  }

  private broadcastVoiceState(force: boolean): void {
    const muted = this.isEffectivelyMuted();
    if (!force && this.localSpeaking === this.lastBroadcastSpeaking && muted === this.lastBroadcastMuted) {
      return;
    }
    this.lastBroadcastSpeaking = this.localSpeaking;
    this.lastBroadcastMuted = muted;
    this.broadcastDataChannel({
      kind: 'voice_state',
      muted,
      speaking: this.localSpeaking,
      level: this.localLevel,
    });
  }

  private rememberMessageId(id: string): void {
    if (this.seenMessageSet.has(id)) return;
    this.seenMessageSet.add(id);
    this.seenMessageIds.push(id);
    while (this.seenMessageIds.length > MAX_SEEN_MESSAGE_IDS) {
      const oldest = this.seenMessageIds.shift();
      if (oldest) this.seenMessageSet.delete(oldest);
    }
  }

  private removePeer(playerId: string): void {
    const peer = this.peers.get(playerId);
    if (!peer) return;
    this.peers.delete(playerId);
    if (peer.typingTimer) clearTimeout(peer.typingTimer);
    if (peer.typing) this.options.onPeerTyping?.(playerId, false, peer.bubbleStyle);
    if (peer.speaking) this.options.onVoiceActivity?.(playerId, false, 0, false);
    this.teardownPeerAudio(peer);
    try {
      peer.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      peer.pc.close();
    } catch {
      /* ignore */
    }
  }

  private closeAllPeers(): void {
    for (const id of [...this.peers.keys()]) {
      this.removePeer(id);
    }
    this.emitState();
  }

  private emitState(): void {
    this.options.onStateChange?.(this.getVoiceSnapshot(), this.getPeerSnapshots());
  }
}
