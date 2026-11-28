import { describe, expect, it, vi } from 'vitest';
import type { AvatarState, ChatMessage, RtcSignalPayload, SpeechBubbleStyle } from '../types';
import { getBubblePreset } from '../chat';
import { WebRtcMesh } from '../net/webrtcMesh';

// ---------------------------------------------------------------------------
// Minimal deterministic mock RTCPeerConnection + RTCDataChannel pair
// ---------------------------------------------------------------------------

class MockDataChannel {
  readonly label: string;
  readyState: RTCDataChannelState = 'connecting';
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  peer: MockDataChannel | null = null;
  readonly sent: string[] = [];

  constructor(label: string) {
    this.label = label;
  }

  open(): void {
    if (this.readyState === 'open') return;
    this.readyState = 'open';
    this.onopen?.({} as Event);
  }

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('DataChannel not open');
    this.sent.push(data);
    this.peer?.onmessage?.({ data } as MessageEvent);
  }

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.onclose?.({} as Event);
  }
}

class MockMediaStreamTrack {
  readonly kind = 'audio';
  enabled = true;
  stopped = false;
  onended: (() => void) | null = null;
  stop(): void {
    this.stopped = true;
    this.onended?.();
  }
  getSettings(): MediaTrackSettings {
    return { deviceId: 'mock-mic-1' };
  }
}

class MockMediaStream {
  readonly tracks: MockMediaStreamTrack[];
  constructor(tracks: MockMediaStreamTrack[] = [new MockMediaStreamTrack()]) {
    this.tracks = tracks;
  }
  getTracks(): MockMediaStreamTrack[] {
    return this.tracks;
  }
  getAudioTracks(): MockMediaStreamTrack[] {
    return this.tracks;
  }
}

interface MockSender {
  track: MockMediaStreamTrack | null;
  replaceTrack: (next: MockMediaStreamTrack | null) => Promise<void>;
}

class MockPeerConnection {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((ev: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: MockDataChannel }) => void) | null = null;
  ontrack: ((ev: { track: MockMediaStreamTrack; streams: MockMediaStream[] }) => void) | null = null;

  readonly createdChannels: MockDataChannel[] = [];
  readonly senders: MockSender[] = [];
  readonly addedIce: RTCIceCandidateInit[] = [];
  closed = false;
  remotePc: MockPeerConnection | null = null;
  private offerCounter = 0;

  createDataChannel(label: string): MockDataChannel {
    const dc = new MockDataChannel(label);
    this.createdChannels.push(dc);
    queueMicrotask(() => {
      if (!this.closed) this.onnegotiationneeded?.();
    });
    return dc;
  }

  addTrack(track: MockMediaStreamTrack, _stream: MockMediaStream): MockSender {
    const sender: MockSender = {
      track,
      replaceTrack: async (next) => {
        sender.track = next;
      },
    };
    this.senders.push(sender);
    queueMicrotask(() => {
      if (!this.closed) this.onnegotiationneeded?.();
    });
    return sender;
  }

  async setLocalDescription(desc?: RTCSessionDescriptionInit): Promise<void> {
    if (desc) {
      this.localDescription = desc;
    } else if (this.signalingState === 'have-remote-offer') {
      this.localDescription = { type: 'answer', sdp: `v=0\r\nanswer-${++this.offerCounter}` };
      this.signalingState = 'stable';
    } else {
      this.localDescription = { type: 'offer', sdp: `v=0\r\noffer-${++this.offerCounter}` };
      this.signalingState = 'have-local-offer';
    }
    this.onicecandidate?.({
      candidate: {
        candidate: 'candidate:1 1 UDP 2122252543 127.0.0.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'ufrag',
      } as RTCIceCandidate,
    });
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
    if (desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else {
      this.signalingState = 'stable';
    }
    if (this.signalingState === 'stable' && this.remotePc && !this.closed) {
      this.completeLink(this.remotePc);
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedIce.push(candidate);
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  private completeLink(other: MockPeerConnection): void {
    this.connectionState = 'connected';
    other.connectionState = 'connected';
    this.onconnectionstatechange?.();
    other.onconnectionstatechange?.();

    // Link DataChannels from whichever side created them
    for (const [creator, receiver] of [
      [this, other],
      [other, this],
    ] as const) {
      for (const dc of creator.createdChannels) {
        if (!dc.peer) {
          const remoteDc = new MockDataChannel(dc.label);
          dc.peer = remoteDc;
          remoteDc.peer = dc;
          receiver.ondatachannel?.({ channel: remoteDc });
          dc.open();
          remoteDc.open();
        }
      }
      for (const sender of creator.senders) {
        if (sender.track && receiver.ontrack) {
          const remoteTrack = new MockMediaStreamTrack();
          const remoteStream = new MockMediaStream([remoteTrack]);
          receiver.ontrack({ track: remoteTrack, streams: [remoteStream] });
        }
      }
    }
  }
}

function avatar(id: string, name: string, color: string, bubbleStyle?: SpeechBubbleStyle): AvatarState {
  return {
    id,
    name,
    color,
    ...(bubbleStyle ? { bubbleStyle } : {}),
    worldId: 'eric-world',
    position: [0, 0, 0],
    yaw: 0,
    velocityY: 0,
    updatedAt: 1,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

describe('WebRtcMesh (Perfect Negotiation, P2P text chat & voice)', () => {
  it('negotiates P2P DataChannel between two peers, delivers styled text chat, typing & style updates', async () => {
    const ericStyle = getBubblePreset('cyber').style;
    const jpStyle = getBubblePreset('comic').style;
    const ericMsgs: ChatMessage[] = [];
    const jpMsgs: ChatMessage[] = [];
    const jpTypingEvents: Array<{ playerId: string; typing: boolean }> = [];
    const jpStyleUpdates: SpeechBubbleStyle[] = [];

    const ericPcs: MockPeerConnection[] = [];
    const jpPcs: MockPeerConnection[] = [];
    const ericSignals: Array<{ to: string; signal: RtcSignalPayload }> = [];
    const jpSignals: Array<{ to: string; signal: RtcSignalPayload }> = [];

    let eric!: WebRtcMesh;
    let jp!: WebRtcMesh;

    const linkMockPcs = () => {
      if (ericPcs[0] && jpPcs[0]) {
        ericPcs[0].remotePc = jpPcs[0];
        jpPcs[0].remotePc = ericPcs[0];
      }
    };

    eric = new WebRtcMesh({
      localPlayerId: 'eric',
      localPlayerName: 'Eric',
      localPlayerColor: '#22d3ee',
      localBubbleStyle: ericStyle,
      worldId: 'eric-world',
      sendSignal: (to, signal) => {
        ericSignals.push({ to, signal });
        queueMicrotask(() => {
          linkMockPcs();
          void jp.handleSignal('eric', 'eric-world', signal);
        });
      },
      onChatMessage: (m) => ericMsgs.push(m),
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        ericPcs.push(pc);
        linkMockPcs();
        return pc as unknown as RTCPeerConnection;
      },
    });

    jp = new WebRtcMesh({
      localPlayerId: 'jp',
      localPlayerName: 'JP',
      localPlayerColor: '#f59e0b',
      localBubbleStyle: jpStyle,
      worldId: 'eric-world',
      sendSignal: (to, signal) => {
        jpSignals.push({ to, signal });
        queueMicrotask(() => {
          linkMockPcs();
          void eric.handleSignal('jp', 'eric-world', signal);
        });
      },
      onChatMessage: (m) => jpMsgs.push(m),
      onPeerTyping: (playerId, typing) => jpTypingEvents.push({ playerId, typing }),
      onPeerStyleUpdate: (_id, style) => jpStyleUpdates.push(style),
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        jpPcs.push(pc);
        linkMockPcs();
        return pc as unknown as RTCPeerConnection;
      },
    });

    eric.syncPeers([avatar('jp', 'JP', '#f59e0b', jpStyle)], 'eric', 'eric-world');
    jp.syncPeers([avatar('eric', 'Eric', '#22d3ee', ericStyle)], 'jp', 'eric-world');
    await flushMicrotasks();

    // Verify signaling completed and WebRTC DataChannels opened P2P
    expect(ericSignals.some((s) => s.signal.kind === 'answer')).toBe(true);
    expect(jpSignals.some((s) => s.signal.kind === 'offer')).toBe(true);
    expect(eric.getVoiceSnapshot().p2pPeerCount).toBe(1);
    expect(jp.getVoiceSnapshot().p2pPeerCount).toBe(1);

    // Send typing indicator P2P
    eric.sendTyping(true);
    expect(jpTypingEvents.at(-1)).toEqual({ playerId: 'eric', typing: true });

    // Send styled text chat P2P over DataChannel
    const sent = eric.sendChatMessage('Meet me at the Palace Lagoon!', ericStyle);
    expect(sent?.transport).toBe('webrtc');
    expect(ericMsgs).toHaveLength(1);
    expect(jpMsgs).toHaveLength(1);
    expect(jpMsgs[0]).toMatchObject({
      senderId: 'eric',
      senderName: 'Eric',
      text: 'Meet me at the Palace Lagoon!',
      transport: 'webrtc',
      bubbleStyle: expect.objectContaining({ preset: 'cyber' }),
    });
    // Receiving a message clears typing state
    expect(jpTypingEvents.at(-1)).toEqual({ playerId: 'eric', typing: false });

    // Duplicate WS fallback with same message ID is ignored
    jp.handleWsChatFallback({
      id: sent!.id,
      senderId: 'eric',
      senderName: 'Eric',
      senderColor: '#22d3ee',
      worldId: 'eric-world',
      text: 'Meet me at the Palace Lagoon!',
      bubbleStyle: ericStyle,
      sentAt: sent!.sentAt,
    });
    expect(jpMsgs).toHaveLength(1);

    // Live style customization broadcasts over P2P DataChannel
    const aurora = getBubblePreset('aurora').style;
    eric.setLocalIdentity('eric', 'Eric', '#22d3ee', aurora);
    expect(jpStyleUpdates.at(-1)?.preset).toBe('aurora');

    // Switching rooms tears down peer connections cleanly
    eric.syncPeers([], 'eric', 'jp-world');
    expect(ericPcs[0].closed).toBe(true);
    expect(eric.getPeerSnapshots()).toEqual([]);

    eric.dispose();
    jp.dispose();
  });

  it('uses WS fallback for peers whose DataChannel is not open yet, and supports voice join/mute/PTT/leave', async () => {
    const fallbackSpy = vi.fn();
    const mockTrack = new MockMediaStreamTrack();
    const mockStream = new MockMediaStream([mockTrack]);
    const pcs: MockPeerConnection[] = [];

    const mesh = new WebRtcMesh({
      localPlayerId: 'eric',
      localPlayerName: 'Eric',
      localPlayerColor: '#22d3ee',
      localBubbleStyle: getBubblePreset('glass').style,
      worldId: 'eric-world',
      sendSignal: () => {},
      sendChatFallback: fallbackSpy,
      createPeerConnection: () => {
        const pc = new MockPeerConnection();
        pcs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
      getUserMedia: async () => mockStream as unknown as MediaStream,
    });

    mesh.syncPeers([avatar('jp', 'JP', '#f59e0b')], 'eric', 'eric-world');
    const msg = mesh.sendChatMessage('Fallback while ICE connects');
    expect(msg?.transport).toBe('ws-fallback');
    expect(fallbackSpy).toHaveBeenCalledWith(
      msg!.id,
      'Fallback while ICE connects',
      expect.objectContaining({ preset: 'glass' }),
      ['jp'],
    );

    // Join voice chat & attach track to peer
    const joined = await mesh.joinVoice();
    expect(joined).toBe(true);
    expect(mesh.getVoiceSnapshot().joined).toBe(true);
    expect(mesh.getVoiceSnapshot().muted).toBe(false);
    expect(mockTrack.enabled).toBe(true);
    expect(pcs[0].senders).toHaveLength(1);

    // Mute / unmute toggles track without tearing down stream
    mesh.toggleMute();
    expect(mockTrack.enabled).toBe(false);
    expect(mesh.getVoiceSnapshot().muted).toBe(true);
    mesh.toggleMute();
    expect(mockTrack.enabled).toBe(true);

    // Push-to-Talk holds mic muted until PTT pressed
    mesh.setPushToTalk(true);
    expect(mockTrack.enabled).toBe(false);
    mesh.setPushToTalkPressed(true);
    expect(mockTrack.enabled).toBe(true);
    mesh.setPushToTalkPressed(false);
    expect(mockTrack.enabled).toBe(false);

    // Leaving voice stops the microphone track cleanly
    mesh.leaveVoice();
    expect(mockTrack.stopped).toBe(true);
    expect(mesh.getVoiceSnapshot().joined).toBe(false);
    mesh.dispose();
  });
});
