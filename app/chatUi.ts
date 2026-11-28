import type { ChatMessage, SpeechBubbleStyle } from '@portalverse/core/types';
import { bubbleFontStack } from '@portalverse/core/chat';
import type { PeerRtcSnapshot, VoiceStateSnapshot } from '@portalverse/core/net/webrtcMesh';

export interface ChatUiCallbacks {
  onSendMessage: (text: string) => void;
  onTypingChange: (active: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onOpenBubbleCustomizer: () => void;
  onJoinVoice: () => void;
  onLeaveVoice: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onTogglePushToTalk: (enabled: boolean) => void;
  onToggleSpatialAudio: (enabled: boolean) => void;
  onSelectInputDevice: (deviceId: string) => void;
  listInputDevices: () => Promise<MediaDeviceInfo[]>;
}

const MAX_CHAT_HISTORY = 60;
const IDLE_DIM_MS = 12_000;

/**
 * Manages the bottom-left speech-bubble Chat Dock and the top-bar WebRTC Voice
 * button + settings popover. All user text is written via textContent (XSS-safe).
 */
export class ChatAndVoiceUi {
  private readonly dock: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly typingBar: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly unreadBadge: HTMLElement;
  private readonly p2pBadge: HTMLElement;
  private readonly styleBtn: HTMLButtonElement;

  // Top-bar Voice Controls & Popover
  private readonly voiceBtn: HTMLButtonElement;
  private readonly voiceLabel: HTMLElement;
  private readonly voiceMeterFill: HTMLElement;
  private readonly voiceMenuBtn: HTMLButtonElement;
  private readonly voicePopover: HTMLElement;
  private readonly voiceStatusText: HTMLElement;
  private readonly voiceJoinLeaveBtn: HTMLButtonElement;
  private readonly voiceMuteBtn: HTMLButtonElement;
  private readonly voiceDeafenBtn: HTMLButtonElement;
  private readonly voicePttCheckbox: HTMLInputElement;
  private readonly voiceSpatialCheckbox: HTMLInputElement;
  private readonly voiceDeviceSelect: HTMLSelectElement;
  private readonly voiceTestMeter: HTMLElement;

  private readonly callbacks: ChatUiCallbacks;
  private readonly typingNames = new Map<string, string>();
  private collapsed = false;
  private unreadCount = 0;
  private focused = false;
  private typingSent = false;
  private typingIdleTimer = 0;
  private dimTimer = 0;
  private lastVoiceJoined = false;
  private popoverOpen = false;

  constructor(callbacks: ChatUiCallbacks) {
    this.callbacks = callbacks;

    this.dock = document.getElementById('chat-dock')!;
    this.feed = document.getElementById('chat-feed')!;
    this.typingBar = document.getElementById('chat-typing')!;
    this.form = document.getElementById('form-chat') as HTMLFormElement;
    this.input = document.getElementById('chat-input') as HTMLInputElement;
    this.toggleBtn = document.getElementById('btn-chat-toggle') as HTMLButtonElement;
    this.unreadBadge = document.getElementById('chat-unread-badge')!;
    this.p2pBadge = document.getElementById('chat-p2p-badge')!;
    this.styleBtn = document.getElementById('btn-bubble-style') as HTMLButtonElement;

    this.voiceBtn = document.getElementById('btn-voice') as HTMLButtonElement;
    this.voiceLabel = document.getElementById('voice-label')!;
    this.voiceMeterFill = document.getElementById('voice-meter-fill')!;
    this.voiceMenuBtn = document.getElementById('btn-voice-menu') as HTMLButtonElement;
    this.voicePopover = document.getElementById('voice-popover')!;
    this.voiceStatusText = document.getElementById('voice-status-text')!;
    this.voiceJoinLeaveBtn = document.getElementById('btn-voice-join-leave') as HTMLButtonElement;
    this.voiceMuteBtn = document.getElementById('btn-voice-mute') as HTMLButtonElement;
    this.voiceDeafenBtn = document.getElementById('btn-voice-deafen') as HTMLButtonElement;
    this.voicePttCheckbox = document.getElementById('voice-ptt-toggle') as HTMLInputElement;
    this.voiceSpatialCheckbox = document.getElementById('voice-spatial-toggle') as HTMLInputElement;
    this.voiceDeviceSelect = document.getElementById('voice-device-select') as HTMLSelectElement;
    this.voiceTestMeter = document.getElementById('voice-test-meter-fill')!;

    this.bindEvents();
    this.bumpActivity();
  }

  isFocused(): boolean {
    return this.focused;
  }

  isVoicePopoverOpen(): boolean {
    return this.popoverOpen;
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.dock.classList.toggle('collapsed', collapsed);
    this.toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    this.toggleBtn.title = collapsed ? 'Expand chat (T)' : 'Collapse chat';
    if (!collapsed) {
      this.unreadCount = 0;
      this.syncUnread();
      this.scrollToBottom();
      this.bumpActivity();
    }
  }

  openAndFocus(): void {
    if (this.collapsed) this.setCollapsed(false);
    this.bumpActivity();
    this.input.focus();
  }

  blurInput(): void {
    if (document.activeElement === this.input) {
      this.input.blur();
    }
    this.stopTyping();
  }

  closeVoicePopover(): void {
    if (!this.popoverOpen) return;
    this.popoverOpen = false;
    this.voicePopover.classList.add('hidden');
    this.voiceMenuBtn.setAttribute('aria-expanded', 'false');
  }

  appendMessage(msg: ChatMessage, isSelf: boolean): void {
    const item = document.createElement('div');
    item.className = `chat-bubble-row${isSelf ? ' is-self' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'chat-bubble-meta';

    const dot = document.createElement('span');
    dot.className = 'chat-sender-dot';
    dot.style.background = msg.senderColor;
    dot.style.boxShadow = `0 0 8px ${msg.senderColor}`;

    const sender = document.createElement('span');
    sender.className = 'chat-sender-name';
    sender.textContent = isSelf ? `${msg.senderName} (you)` : msg.senderName;

    meta.append(dot, sender);

    if (msg.transport === 'webrtc') {
      const p2p = document.createElement('span');
      p2p.className = 'chat-transport-pill';
      p2p.textContent = 'P2P';
      p2p.title = 'Delivered peer-to-peer via WebRTC DataChannel';
      meta.appendChild(p2p);
    }

    const bubble = this.createStyledBubbleElement(msg.text, msg.bubbleStyle);
    item.append(meta, bubble);
    this.feed.appendChild(item);

    while (this.feed.children.length > MAX_CHAT_HISTORY) {
      this.feed.firstElementChild?.remove();
    }

    if (this.collapsed && !isSelf) {
      this.unreadCount = Math.min(99, this.unreadCount + 1);
      this.syncUnread();
    } else {
      this.scrollToBottom();
    }
    this.bumpActivity();
  }

  appendSystemNote(text: string): void {
    const note = document.createElement('div');
    note.className = 'chat-system-note';
    note.textContent = text;
    this.feed.appendChild(note);
    while (this.feed.children.length > MAX_CHAT_HISTORY) {
      this.feed.firstElementChild?.remove();
    }
    this.scrollToBottom();
    this.bumpActivity();
  }

  setPeerTyping(playerId: string, playerName: string, active: boolean): void {
    if (active) this.typingNames.set(playerId, playerName);
    else this.typingNames.delete(playerId);

    const names = [...this.typingNames.values()];
    if (names.length === 0) {
      this.typingBar.textContent = '';
      this.typingBar.classList.add('hidden');
    } else {
      const label =
        names.length === 1
          ? `${names[0]} is typing…`
          : names.length === 2
            ? `${names[0]} and ${names[1]} are typing…`
            : `${names[0]} and ${names.length - 1} others are typing…`;
      this.typingBar.textContent = label;
      this.typingBar.classList.remove('hidden');
      this.bumpActivity();
    }
  }

  clearTyping(): void {
    this.typingNames.clear();
    this.typingBar.textContent = '';
    this.typingBar.classList.add('hidden');
  }

  syncVoiceUi(voice: VoiceStateSnapshot, peers: PeerRtcSnapshot[]): void {
    this.lastVoiceJoined = voice.joined;

    // Top-bar Voice Button state
    this.voiceBtn.classList.toggle('voice-joined', voice.joined);
    this.voiceBtn.classList.toggle('voice-muted', voice.joined && voice.muted);
    this.voiceBtn.classList.toggle('voice-speaking', voice.joined && voice.speaking);
    this.voiceBtn.setAttribute('aria-pressed', String(voice.joined && !voice.muted));

    if (!voice.joined) {
      this.voiceLabel.textContent = 'Voice';
      this.voiceBtn.title = 'Join WebRTC Voice Chat (B)';
    } else if (voice.pushToTalk) {
      this.voiceLabel.textContent = voice.pttActive ? 'Talking' : 'PTT (B)';
      this.voiceBtn.title = 'Push-to-Talk active — hold B to speak';
    } else if (voice.muted) {
      this.voiceLabel.textContent = 'Mic Off';
      this.voiceBtn.title = 'Unmute microphone (B)';
    } else {
      this.voiceLabel.textContent = 'Mic On';
      this.voiceBtn.title = 'Mute microphone (B)';
    }

    const levelPct = voice.joined && !voice.muted ? Math.round(Math.min(1, voice.localLevel) * 100) : 0;
    this.voiceMeterFill.style.width = `${levelPct}%`;
    this.voiceTestMeter.style.width = `${levelPct}%`;

    // Chat header P2P badge
    if (voice.p2pPeerCount > 0) {
      const voicePart = voice.voicePeerCount > 0 ? ` · ${voice.voicePeerCount} voice` : '';
      this.p2pBadge.textContent = `WebRTC P2P · ${voice.p2pPeerCount}${voicePart}`;
      this.p2pBadge.dataset.state = 'connected';
    } else if (peers.length > 0) {
      this.p2pBadge.textContent = 'Connecting P2P…';
      this.p2pBadge.dataset.state = 'connecting';
    } else {
      this.p2pBadge.textContent = 'WebRTC Ready';
      this.p2pBadge.dataset.state = 'idle';
    }

    // Popover controls
    this.voiceJoinLeaveBtn.textContent = voice.joined ? 'Disconnect Voice' : 'Join Voice Chat';
    this.voiceJoinLeaveBtn.classList.toggle('btn-danger', voice.joined);
    this.voiceJoinLeaveBtn.classList.toggle('btn-primary', !voice.joined);

    this.voiceMuteBtn.disabled = !voice.joined || voice.pushToTalk;
    this.voiceMuteBtn.textContent = voice.muted ? 'Unmute Mic' : 'Mute Mic';
    this.voiceMuteBtn.classList.toggle('active', voice.joined && voice.muted);

    this.voiceDeafenBtn.textContent = voice.deafened ? 'Undeafen' : 'Deafen All';
    this.voiceDeafenBtn.classList.toggle('active', voice.deafened);

    this.voicePttCheckbox.checked = voice.pushToTalk;
    this.voiceSpatialCheckbox.checked = voice.spatialAudio;

    if (!voice.supported) {
      this.voiceStatusText.textContent = 'WebRTC unavailable in this browser';
    } else if (voice.error) {
      this.voiceStatusText.textContent = voice.error;
    } else if (voice.joined) {
      const modeLabel = voice.spatialAudio ? '3D Spatial' : 'Room Stereo';
      const talkLabel = voice.pushToTalk ? 'Push-to-Talk (Hold B)' : voice.muted ? 'Muted' : 'Open Mic';
      this.voiceStatusText.textContent = `${talkLabel} · ${modeLabel} · ${voice.p2pPeerCount} P2P`;
    } else {
      this.voiceStatusText.textContent = `Voice ready · ${voice.p2pPeerCount} P2P peer${voice.p2pPeerCount === 1 ? '' : 's'} in room`;
    }
  }

  private createStyledBubbleElement(text: string, style: SpeechBubbleStyle): HTMLElement {
    const el = document.createElement('div');
    el.className = [
      'hud-speech-bubble',
      `bubble-preset-${style.preset}`,
      `bubble-tail-${style.tail}`,
      `bubble-fx-${style.effect}`,
    ].join(' ');
    el.style.setProperty('--b-bg', style.bgColor);
    el.style.setProperty('--b-accent', style.accentColor);
    el.style.setProperty('--b-text', style.textColor);
    el.style.setProperty('--b-font', bubbleFontStack(style.font));

    if (style.badge) {
      const badge = document.createElement('span');
      badge.className = 'hud-bubble-badge';
      badge.textContent = style.badge;
      el.appendChild(badge);
    }

    const span = document.createElement('span');
    span.className = 'hud-bubble-text';
    span.textContent = text;
    el.appendChild(span);
    return el;
  }

  private bindEvents(): void {
    this.toggleBtn.addEventListener('click', () => {
      this.setCollapsed(!this.collapsed);
      this.toggleBtn.blur();
    });

    this.styleBtn.addEventListener('click', () => {
      this.callbacks.onOpenBubbleCustomizer();
      this.styleBtn.blur();
    });

    this.input.addEventListener('focus', () => {
      this.focused = true;
      this.dock.classList.add('focused');
      this.dock.classList.remove('idle-dim');
      window.clearTimeout(this.dimTimer);
      this.callbacks.onFocusChange(true);
    });

    this.input.addEventListener('blur', () => {
      this.focused = false;
      this.dock.classList.remove('focused');
      this.stopTyping();
      this.callbacks.onFocusChange(false);
      this.bumpActivity();
    });

    this.input.addEventListener('input', () => {
      const hasText = this.input.value.trim().length > 0;
      if (hasText) {
        if (!this.typingSent) {
          this.typingSent = true;
          this.callbacks.onTypingChange(true);
        }
        window.clearTimeout(this.typingIdleTimer);
        this.typingIdleTimer = window.setTimeout(() => this.stopTyping(), 2600);
      } else {
        this.stopTyping();
      }
    });

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      this.input.value = '';
      this.stopTyping();
      this.input.blur();
      if (text) {
        this.callbacks.onSendMessage(text);
      }
    });

    this.dock.addEventListener('mouseenter', () => {
      this.dock.classList.remove('idle-dim');
      window.clearTimeout(this.dimTimer);
    });
    this.dock.addEventListener('mouseleave', () => {
      if (!this.focused) this.bumpActivity();
    });

    // Voice bar controls
    this.voiceBtn.addEventListener('click', () => {
      if (!this.lastVoiceJoined) {
        this.callbacks.onJoinVoice();
      } else {
        this.callbacks.onToggleMute();
      }
      this.voiceBtn.blur();
    });

    this.voiceMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.popoverOpen = !this.popoverOpen;
      this.voicePopover.classList.toggle('hidden', !this.popoverOpen);
      this.voiceMenuBtn.setAttribute('aria-expanded', String(this.popoverOpen));
      if (this.popoverOpen) {
        void this.refreshDeviceList();
      }
      this.voiceMenuBtn.blur();
    });

    this.voiceJoinLeaveBtn.addEventListener('click', () => {
      if (this.lastVoiceJoined) this.callbacks.onLeaveVoice();
      else this.callbacks.onJoinVoice();
    });

    this.voiceMuteBtn.addEventListener('click', () => {
      this.callbacks.onToggleMute();
    });

    this.voiceDeafenBtn.addEventListener('click', () => {
      this.callbacks.onToggleDeafen();
    });

    this.voicePttCheckbox.addEventListener('change', () => {
      this.callbacks.onTogglePushToTalk(this.voicePttCheckbox.checked);
    });

    this.voiceSpatialCheckbox.addEventListener('change', () => {
      this.callbacks.onToggleSpatialAudio(this.voiceSpatialCheckbox.checked);
    });

    this.voiceDeviceSelect.addEventListener('change', () => {
      if (this.voiceDeviceSelect.value) {
        this.callbacks.onSelectInputDevice(this.voiceDeviceSelect.value);
      }
      this.voiceDeviceSelect.blur();
    });

    document.addEventListener('pointerdown', (e) => {
      if (!this.popoverOpen) return;
      const target = e.target as Node | null;
      if (
        target &&
        !this.voicePopover.contains(target) &&
        !this.voiceMenuBtn.contains(target) &&
        !this.voiceBtn.contains(target)
      ) {
        this.closeVoicePopover();
      }
    });
  }

  private async refreshDeviceList(): Promise<void> {
    const devices = await this.callbacks.listInputDevices();
    const prev = this.voiceDeviceSelect.value;
    this.voiceDeviceSelect.innerHTML = '';
    if (devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Default Microphone';
      this.voiceDeviceSelect.appendChild(opt);
      return;
    }
    devices.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${idx + 1}`;
      this.voiceDeviceSelect.appendChild(opt);
    });
    if (prev && devices.some((d) => d.deviceId === prev)) {
      this.voiceDeviceSelect.value = prev;
    }
  }

  private stopTyping(): void {
    window.clearTimeout(this.typingIdleTimer);
    if (this.typingSent) {
      this.typingSent = false;
      this.callbacks.onTypingChange(false);
    }
  }

  private syncUnread(): void {
    this.unreadBadge.textContent = String(this.unreadCount);
    this.unreadBadge.classList.toggle('hidden', this.unreadCount === 0);
  }

  private scrollToBottom(): void {
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  private bumpActivity(): void {
    this.dock.classList.remove('idle-dim');
    window.clearTimeout(this.dimTimer);
    if (!this.focused) {
      this.dimTimer = window.setTimeout(() => {
        if (!this.focused) this.dock.classList.add('idle-dim');
      }, IDLE_DIM_MS);
    }
  }
}
