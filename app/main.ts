/// <reference types="vite/client" />
import { livePortalSlots } from '@portalverse/core/portal/roomLayout';
import { sessionCatalog } from '@portalverse/core/portal/sessionCatalog';
import { tourShareBase } from '@portalverse/core/portal/roomTour';
import type {
  AvatarState,
  ConnectionState,
  PlayerIdentity,
  PortalDefinition,
  SpeechBubbleStyle,
  Vec3Tuple,
  WorldManifest,
  WorldModule,
} from '@portalverse/core/types';
import { WorldEngine } from '@portalverse/core/engine/WorldEngine';
import { MultiplayerClient } from '@portalverse/core/net/multiplayerClient';
import {
  fetchRtcIceServers,
  WebRtcMesh,
  type PeerRtcSnapshot,
  type VoiceStateSnapshot,
} from '@portalverse/core/net/webrtcMesh';
import {
  createDefaultBubbleStyle,
  getBubblePreset,
  sanitizeSpeechBubbleStyle,
} from '@portalverse/core/chat';
import { WorldRegistry } from '@portalverse/core/portal/registry';
import { parseMovementMode } from '@portalverse/core/engine/movement';
import {
  buildRemotePortalUrl,
  buildShareableWorldUrl,
  createReturnPortalFromHandoff,
  placeHandoffArrival,
  readRouteFromLocation,
} from '@portalverse/core/portal/handoff';
import { InteractiveTutorial, hasCompletedTutorial } from './tutorial';
import { CharacterSelectScreen } from './characterSelect';
import { BubbleCustomizerModal } from './bubbleCustomizer';
import { ChatAndVoiceUi } from './chatUi';
import { NpcDialogueUi } from './dialogueUi';
import { MetaViewUi } from './metaViewUi';
import { MobileControls } from './mobileControls';
import { chooseStartupCharacter, getCharacterDefinition, normalizeSkinAppearance } from '@portalverse/core/characters';
import { CosmicMetaView } from '@portalverse/core/meta';
import {
  detectPerformanceProfile,
  isMobileTouchDevice,
  parsePerformanceProfilePreference,
  resolvePerformanceProfile,
  type PerformanceProfilePreference,
} from '@portalverse/core/engine/performanceProfile';
import { Soundtrack } from '@portalverse/core/audio/Soundtrack';
import { vibeFor, type StemId } from '@portalverse/core/audio/musicMix';

const STORAGE_PROFILE_KEY = 'portalverse.profile.v1';
const STORAGE_MOVEMENT_MODE_KEY = 'portalverse.movement.mode';
const STORAGE_WARP_ZONES_KEY = 'portalverse.debug.warpZones';
const STORAGE_PERF_PROFILE_KEY = 'portalverse.perf.profile';
const STORAGE_TOUCH_CONTROLS_KEY = 'portalverse.touch.controls';

type TouchControlsPreference = 'auto' | 'on' | 'off';

function parseTouchPreference(value: unknown): TouchControlsPreference {
  return value === 'on' || value === 'off' ? value : 'auto';
}

const STORAGE_CHARACTER_CHOICE_KEY = 'portalverse.character.choice';

function loadOrCreateIdentity(): PlayerIdentity {
  let savedChoice: string | null = null;
  try { savedChoice = localStorage.getItem(STORAGE_CHARACTER_CHOICE_KEY); } catch { /* storage unavailable */ }
  const startupCharacter = chooseStartupCharacter(savedChoice);
  try {
    const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
      if (parsed.id && parsed.name && parsed.color) {
        return {
          id: parsed.id,
          name: parsed.name,
          color: parsed.color,
          characterId: startupCharacter,
          ...normalizeSkinAppearance(parsed),
          bubbleStyle:
            sanitizeSpeechBubbleStyle(parsed.bubbleStyle, parsed.color) ??
            createDefaultBubbleStyle(parsed.color),
        };
      }
    }
  } catch {
    // Fall through to defaults
  }
  const palette = ['#22d3ee', '#f59e0b', '#a855f7', '#34d399', '#fb7185'];
  const id = `p-${Math.random().toString(36).slice(2, 10)}`;
  const color = palette[Math.floor(Math.random() * palette.length)];
  const identity: PlayerIdentity = {
    id,
    name: `Explorer ${id.slice(-4).toUpperCase()}`,
    color,
    characterId: startupCharacter,
    ...normalizeSkinAppearance(),
    bubbleStyle: createDefaultBubbleStyle(color),
  };
  saveIdentity(identity);
  return identity;
}

function saveIdentity(identity: PlayerIdentity): void {
  try {
    localStorage.setItem(STORAGE_PROFILE_KEY, JSON.stringify(identity));
  } catch {
    // Ignore storage quota errors
  }
}

function resolveMultiplayerUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get('ws') ?? (import.meta.env.VITE_WS_URL as string | undefined);
  if (explicit) {
    try {
      const u = new URL(explicit);
      if (u.protocol === 'ws:' || u.protocol === 'wss:') return u.toString();
    } catch {
      // Ignore malformed override
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

async function boot(): Promise<void> {
  const viewport = document.getElementById('viewport')!;
  const loadingGate = document.getElementById('loading-gate')!;
  const loadingMedallion = document.getElementById('loading-medallion') as HTMLButtonElement;
  const loadingRingArc = document.getElementById('loading-ring-arc') as unknown as SVGCircleElement;
  const loadingStatusText = document.getElementById('loading-status-text')!;
  const loadingPhaseText = document.getElementById('loading-phase-text')!;
  const btnGateTutorial = document.getElementById('btn-gate-tutorial') as HTMLButtonElement;
  const btnGateEnter = document.getElementById('btn-gate-enter') as HTMLButtonElement;
  const btnGateMeta = document.getElementById('btn-gate-meta') as HTMLButtonElement;
  const fpsReticle = document.getElementById('fps-reticle')!;
  const pointerLockBanner = document.getElementById('pointer-lock-banner')!;
  const mouseLockLabel = document.getElementById('mouse-lock-label')!;
  const cameraViewLabel = document.getElementById('camera-view-label')!;
  const warpOverlay = document.getElementById('warp-overlay')!;
  const fallOverlay = document.getElementById('fall-overlay')!;
  const respawnButton = document.getElementById('btn-respawn') as HTMLButtonElement;
  const warpLabel = document.getElementById('warp-label')!;
  const hudWorldName = document.getElementById('hud-world-name')!;
  const hudWorldAuthor = document.getElementById('hud-world-author')!;
  const worldAccentDot = document.getElementById('world-accent-dot')!;
  const hudNetStatus = document.getElementById('hud-net-status')!;
  const playerCountEl = document.getElementById('player-count')!;
  const playerListEl = document.getElementById('player-list')!;
  const portalPromptEl = document.getElementById('portal-prompt')!;
  const portalPromptText = document.getElementById('portal-prompt-text')!;
  const toastStack = document.getElementById('toast-stack')!;
  const flightStatusLabel = document.getElementById('flight-status-label')!;
  const physicsModeLabel = document.getElementById('physics-mode-label')!;
  const warpZonesToggle = document.getElementById('debug-warp-zones') as HTMLInputElement;

  const btnShareLink = document.getElementById('btn-share-link')!;
  const hudEl = document.getElementById('hud')!;
  const metaViewOverlay = document.getElementById('meta-view-overlay')!;
  const btnCosmos = document.getElementById('btn-cosmos')!;
  const btnWorldsOpenCosmos = document.getElementById('btn-worlds-open-cosmos')!;
  const btnWorlds = document.getElementById('btn-worlds')!;
  const btnCharacters = document.getElementById('btn-characters')!;
  const btnLinkPortal = document.getElementById('btn-link-portal')!;
  const btnProfile = document.getElementById('btn-profile')!;
  const btnControls = document.getElementById('btn-controls')!;
  const btnReplayTutorial = document.getElementById('btn-replay-tutorial') as HTMLButtonElement;

  const modalPortal = document.getElementById('modal-portal')!;
  const modalWorlds = document.getElementById('modal-worlds')!;
  const modalCharacters = document.getElementById('modal-characters')!;
  const modalProfile = document.getElementById('modal-profile')!;
  const modalBubbleStyle = document.getElementById('modal-bubble-style')!;
  const modalJournal = document.getElementById('modal-journal')!;
  const modalControls = document.getElementById('modal-controls')!;
  const profileBubbleSummary = document.getElementById('profile-bubble-summary')!;
  const btnProfileBubbleStyle = document.getElementById('btn-profile-bubble-style') as HTMLButtonElement;
  const mobileControlsRoot = document.getElementById('mobile-controls')!;
  const perfProfileSelect = document.getElementById('perf-profile-select') as HTMLSelectElement;
  const perfProfileSummary = document.getElementById('perf-profile-summary')!;
  const touchControlsSelect = document.getElementById('touch-controls-select') as HTMLSelectElement;

  const tutorial = new InteractiveTutorial({
    card: document.getElementById('tutorial-card')!,
    stepBadge: document.getElementById('tutorial-step-badge')!,
    progressFill: document.getElementById('tutorial-progress-fill')!,
    title: document.getElementById('tutorial-title')!,
    desc: document.getElementById('tutorial-desc')!,
    status: document.getElementById('tutorial-status')!,
    btnNext: document.getElementById('btn-tutorial-next') as HTMLButtonElement,
    btnSkip: document.getElementById('btn-tutorial-skip') as HTMLButtonElement,
  });

  if (!hasCompletedTutorial()) {
    btnGateTutorial.classList.add('recommended');
  }

  const formPortal = document.getElementById('form-portal') as HTMLFormElement;
  const portalLabelInput = document.getElementById('portal-label') as HTMLInputElement;
  const portalModeSelect = document.getElementById('portal-mode') as HTMLSelectElement;
  const portalLocalFields = document.getElementById('portal-local-fields')!;
  const portalRemoteFields = document.getElementById('portal-remote-fields')!;
  const portalTargetWorldSelect = document.getElementById('portal-target-world') as HTMLSelectElement;
  const portalTargetSpawnInput = document.getElementById('portal-target-spawn') as HTMLInputElement;
  const portalRemoteUrlInput = document.getElementById('portal-remote-url') as HTMLInputElement;
  const portalColorAInput = document.getElementById('portal-color-a') as HTMLInputElement;
  const portalColorBInput = document.getElementById('portal-color-b') as HTMLInputElement;

  const worldDirectoryList = document.getElementById('world-directory-list')!;
  const formProfile = document.getElementById('form-profile') as HTMLFormElement;
  const profileNameInput = document.getElementById('profile-name') as HTMLInputElement;
  const profileColorInput = document.getElementById('profile-color') as HTMLInputElement;

  function showToast(message: string): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 3600);
  }

  // Register lazy local world modules
  const modules = import.meta.glob<{ default: WorldModule }>('../worlds/*/index.ts');
  const roomIds = new Set(sessionCatalog.worlds.map(room => room.id));
  const loaders = Object.fromEntries(Object.entries(modules)
    .map(([path, load]) => [path.split('/')[2], load] as const)
    .filter(([id]) => roomIds.has(id)));
  const registry = new WorldRegistry(sessionCatalog, loaders);
  const shareBase = tourShareBase(window.location.href);
  const isVisagesTour = new URL(shareBase).searchParams.get('tour') === 'visages';

  // Read initial deep-link route (?world=eric-world, ?handoff=...)
  const route = readRouteFromLocation(window.location.search, window.location.hash);
  let identity = loadOrCreateIdentity();

  // Placed behind the traveller once their arrival spawn is known (see boot below).
  let returnPortalFromHandoff: PortalDefinition | null = null;
  if (route.handoff) {
    identity = {
      ...identity,
      ...normalizeSkinAppearance({ ...identity, ...route.handoff }),
      name: route.handoff.playerName || identity.name,
      color: route.handoff.playerColor || identity.color,
      characterId: route.handoff.characterId
        ? getCharacterDefinition(route.handoff.characterId).id
        : identity.characterId,
      bubbleStyle:
        route.handoff.bubbleStyle ??
        identity.bubbleStyle ??
        createDefaultBubbleStyle(route.handoff.playerColor || identity.color),
    };
    saveIdentity(identity);
  }
  const activeBubbleStyle = (): SpeechBubbleStyle =>
    identity.bubbleStyle ?? createDefaultBubbleStyle(identity.color);

  const initialWorldId =
    (route.worldId && registry.getManifest(route.worldId) ? route.worldId : undefined) ??
    (route.handoff?.targetWorldId && registry.getManifest(route.handoff.targetWorldId)
      ? route.handoff.targetWorldId
      : undefined) ??
    registry.getDefaultWorldId();

  let activeWorldId = initialWorldId;
  let activeManifest: WorldManifest = registry.getManifest(initialWorldId) ?? registry.listWorlds()[0];
  let isTransitioning = false;
  let latestRoster: AvatarState[] = [];
  let latestDynamicPortals: PortalDefinition[] = [];

  let urlSyncTimer = 0;
  function syncUrlBar(): void {
    window.clearTimeout(urlSyncTimer);
    urlSyncTimer = window.setTimeout(() => {
      const shareUrl = buildShareableWorldUrl(shareBase, {
        worldId: activeWorldId,
      });
      try {
        window.history.replaceState(null, '', shareUrl);
      } catch {
        // Ignore in sandboxed contexts
      }
    }, 120);
  }

  function combinedDynamicPortals(): PortalDefinition[] {
    const available = latestDynamicPortals.filter(portal => portal.remoteUrl || registry.getManifest(portal.targetWorldId));
    if (isVisagesTour) {
      return available.filter(portal => !portal.remoteUrl);
    }
    if (returnPortalFromHandoff && activeWorldId === initialWorldId) {
      // First, so a room full of player portals never crowds out the way home.
      return [returnPortalFromHandoff, ...available];
    }
    return available;
  }

  let hudSyncTimer = 0;
  let lastRosterKey = '';
  function scheduleHudSync(updateRoster = false): void {
    const run = () => {
      hudWorldName.textContent = activeManifest.name;
      const authorLabel = activeManifest.owner ? `Owner: ${activeManifest.owner}` : activeManifest.author;
      hudWorldAuthor.textContent = isVisagesTour
        ? `Visages comparison · ${sessionCatalog.worlds.findIndex(room => room.id === activeWorldId) + 1} of ${sessionCatalog.worlds.length} · Neon → Claude → Codex → Synthesis`
        : `${authorLabel} · WebGPU`;
      worldAccentDot.style.background = activeManifest.accentColor;
      worldAccentDot.style.boxShadow = `0 0 14px ${activeManifest.accentColor}`;
      if (updateRoster) renderPresenceRoster();
    };
    window.clearTimeout(hudSyncTimer);
    hudSyncTimer = window.setTimeout(run, 0);
  }

  const isTouchHardware = isMobileTouchDevice();
  const detectedPerfProfile = detectPerformanceProfile();
  const urlProfileParam = new URLSearchParams(window.location.search).get('profile');
  let perfPreference: PerformanceProfilePreference = 'auto';
  try {
    perfPreference = parsePerformanceProfilePreference(
      urlProfileParam ?? localStorage.getItem(STORAGE_PERF_PROFILE_KEY),
    );
  } catch {
    perfPreference = parsePerformanceProfilePreference(urlProfileParam);
  }
  let activePerfProfile = resolvePerformanceProfile(perfPreference);

  let touchPreference: TouchControlsPreference = 'auto';
  try {
    touchPreference = parseTouchPreference(localStorage.getItem(STORAGE_TOUCH_CONTROLS_KEY));
  } catch {
    touchPreference = 'auto';
  }
  const shouldUseTouchControls = () =>
    touchPreference === 'on' || (touchPreference === 'auto' && isTouchHardware);

  document.body.classList.toggle('is-mobile-device', isTouchHardware);

  let mobileControls: MobileControls | null = null;
  let gateExited = false;
  let shiftHeld = false;
  let roomInputCaptured = false;
  let wasPointerLockedBeforeChat = false;
  let latestVoiceSnapshot: VoiceStateSnapshot | null = null;
  let latestRtcPeers = new Map<string, PeerRtcSnapshot>();
  let chatUi: ChatAndVoiceUi;
  let dialogueUi: NpcDialogueUi;
  let metaView: CosmicMetaView | null = null;
  let metaViewUi: MetaViewUi | null = null;
  const initialOpenMeta = new URLSearchParams(window.location.search).get('view') === 'meta';
  const isMetaViewOpen = () => Boolean(metaViewUi?.isOpen());

  const allModals = [modalPortal, modalWorlds, modalCharacters, modalProfile, modalBubbleStyle, modalJournal, modalControls];
  const isAnyModalOpen = () => allModals.some((m) => !m.classList.contains('hidden'));
  const syncPointerUi = (locked: boolean) => {
    const touchActive = Boolean(mobileControls?.isEnabled());
    fpsReticle.classList.toggle('hidden', !locked || touchActive || isMetaViewOpen());
    mouseLockLabel.textContent = locked ? 'FPS Locked (Esc)' : 'Click to Lock';
    pointerLockBanner.classList.toggle(
      'hidden',
      touchActive ||
        !gateExited ||
        isTransitioning ||
        locked ||
        isMetaViewOpen() ||
        isAnyModalOpen() ||
        roomInputCaptured ||
        Boolean(dialogueUi?.isOpen()) ||
        Boolean(chatUi?.isFocused()) ||
        fallOverlay.classList.contains('active'),
    );
  };

  // Adaptive soundtrack: Suno Studio stems blended by room and by distance to each gate.
  // Music starts muted each visit. ?mute=1 forces zero output for automated tests.
  const soundtrack = new Soundtrack({ silent: new URLSearchParams(window.location.search).get('mute') === '1' });
  if (import.meta.env.DEV) (window as unknown as { soundtrack: Soundtrack }).soundtrack = soundtrack;
  const initialVibe = vibeFor(initialWorldId);
  void soundtrack.load(
    (Object.keys(initialVibe) as StemId[]).sort((a, b) => (initialVibe[b] ?? 0) - (initialVibe[a] ?? 0)),
  );

  const engine = new WorldEngine(viewport, identity.color, {
    performanceProfile: activePerfProfile,
    loadLocalWorld: id => registry.getManifest(id)?.kind === 'local' ? registry.loadWorld(id) : undefined,
    onWorldLoaded: (manifest) => {
      soundtrack.enterRoom(manifest.id);
      activeManifest = manifest;
      activeWorldId = manifest.id;
      metaView?.setActiveWorld(manifest.id);
      metaViewUi?.setActiveWorldId(manifest.id);
      dialogueUi?.closeDialogue(false);
      tutorial.notifyWorldChanged(manifest.id);
      // Defer DOM updates out of the crossing frame's rAF so WebGPU submits first.
      scheduleHudSync(false);
      syncUrlBar();
    },
    onPortalPromoted: (manifest) => {
      soundtrack.enterRoom(manifest.id);
      soundtrack.playPortalWhoosh();
      net.switchWorld(
        manifest.id,
        [engine.avatar.position.x, engine.avatar.position.y, engine.avatar.position.z],
        engine.avatar.getFacingYaw(),
      );
      rtcMesh.syncPeers([], net.getLocalPlayerId(), manifest.id);
      chatUi.clearTyping();
      scheduleHudSync(true);
    },
    onPortalProximity: (portal) => {
      if (!portal) {
        portalPromptEl.classList.add('hidden');
        return;
      }
      portalPromptEl.classList.remove('hidden');
      portalPromptText.textContent = `Enter ${portal.label}`;
    },
    onPortalEnter: (portal, crossed) => {
      soundtrack.playPortalWhoosh();
      void handlePortalTransition(portal, crossed);
    },
    onFlightChange: (flying) => {
      flightStatusLabel.textContent = flying ? 'Flying (Hold E to Land)' : 'Fly';
      mobileControls?.setFlying(flying);
      if (gateExited) tutorial.notifyFlightToggle(flying);
    },
    onCameraViewChange: (firstPerson) => {
      cameraViewLabel.textContent = firstPerson ? 'View: FPS' : 'View: 3rd';
      mobileControls?.setFirstPerson(firstPerson);
      if (gateExited) tutorial.notifyCameraToggle();
    },
    onPointerLockChange: (locked) => {
      syncPointerUi(locked);
    },
    onFallChange: (fallen) => {
      fallOverlay.classList.toggle('active', fallen);
      fallOverlay.setAttribute('aria-hidden', String(!fallen));
      respawnButton.tabIndex = fallen ? 0 : -1;
      // The button isn't focused for you, so a Space press meant as a jump can't click it.
      if (fallen) {
        dialogueUi?.closeDialogue(false);
        closeAllModals();
      }
      else respawnButton.blur();
      syncInputLocks();
      syncPointerUi(engine.avatar.pointerLocked);
    },
    onNearbyNpcChange: (npc) => {
      dialogueUi?.setNearbyNpc(npc, Boolean(mobileControls?.isEnabled()));
    },
    onNpcTalkRequest: (npc) => {
      if (!gateExited || engine.hasFallen || isTransitioning || isAnyModalOpen() || chatUi.isFocused()) return;
      if (dialogueUi.isOpen()) return;
      const locked = engine.avatar.pointerLocked;
      if (locked) engine.exitPointerLock();
      dialogueUi.openDialogue(npc, locked);
    },
    onMovementModeChange: (mode) => {
      physicsModeLabel.textContent = mode === 'platformer' ? 'Physics: Platformer' : 'Physics: Classic';
      try { localStorage.setItem(STORAGE_MOVEMENT_MODE_KEY, mode); } catch { /* storage unavailable */ }
    },
  }, identity.characterId);
  engine.avatar.setSkinAppearance(normalizeSkinAppearance(identity));
  engine.avatar.setLocalBubbleStyle(activeBubbleStyle());
  if (import.meta.env.DEV) (window as unknown as { engine: WorldEngine }).engine = engine;

  // Adventurers start with their character default; other characters retain saved physics.
  // G remains available to change physics during play.
  const defaultPhysics = getCharacterDefinition(identity.characterId).defaultMovementMode;
  if (!defaultPhysics) {
    try {
      engine.avatar.setMovementMode(parseMovementMode(localStorage.getItem(STORAGE_MOVEMENT_MODE_KEY)));
    } catch { /* storage unavailable */ }
  }
  physicsModeLabel.textContent = engine.avatar.movementMode === 'platformer' ? 'Physics: Platformer' : 'Physics: Classic';

  // Debug: show each portal's warp zone, remembered between reloads.
  const readWarpZones = (): boolean => {
    try { return localStorage.getItem(STORAGE_WARP_ZONES_KEY) === '1'; } catch { return false; }
  };
  warpZonesToggle.checked = readWarpZones();
  engine.setWarpZonesVisible(warpZonesToggle.checked);
  warpZonesToggle.addEventListener('change', () => {
    engine.setWarpZonesVisible(warpZonesToggle.checked);
    try { localStorage.setItem(STORAGE_WARP_ZONES_KEY, warpZonesToggle.checked ? '1' : '0'); } catch { /* storage unavailable */ }
    // Hand the keyboard back to the game; focused inputs swallow movement keys.
    warpZonesToggle.blur();
  });

  const wsUrl = resolveMultiplayerUrl();
  const net = new MultiplayerClient({
    url: wsUrl ?? undefined,
    identity,
    initialWorldId,
    livePortalLimits: new Map(registry.listWorlds().map(w => [w.id, livePortalSlots(w)])),
    onConnectionChange: (state: ConnectionState) => {
      hudNetStatus.dataset.state = state;
      hudNetStatus.textContent =
        state === 'connected' ? 'Live Co-op' : state === 'connecting' ? 'Connecting' : 'Solo / Local';
      if (state !== 'connected') {
        rtcMesh.syncPeers([], net.getLocalPlayerId(), activeWorldId);
      }
    },
    onPlayersChange: (players) => {
      engine.syncRemotePlayers(players, net.getLocalPlayerId());
      rtcMesh.syncPeers(players, net.getLocalPlayerId(), activeWorldId);
    },
    onRosterChange: (roster, eventText) => {
      latestRoster = roster;
      renderPresenceRoster();
      if (eventText) showToast(eventText);
    },
    onDynamicPortalsChange: (portals) => {
      latestDynamicPortals = portals;
      engine.setDynamicPortals(combinedDynamicPortals());
    },
    onRtcSignal: (fromPlayerId, worldId, signal) => {
      void rtcMesh.handleSignal(fromPlayerId, worldId, signal);
    },
    onChatFallback: (msg) => {
      rtcMesh.handleWsChatFallback(msg);
    },
    onError: (msg) => showToast(msg),
  });

  const rtcMesh = new WebRtcMesh({
    localPlayerId: identity.id,
    localPlayerName: identity.name,
    localPlayerColor: identity.color,
    localBubbleStyle: activeBubbleStyle(),
    worldId: initialWorldId,
    sendSignal: (toPlayerId, signal) => {
      net.sendRtcSignal(toPlayerId, signal);
    },
    sendChatFallback: (id, text, style, toPlayerIds) => {
      net.sendChatFallback(id, text, style, toPlayerIds);
    },
    onChatMessage: (msg) => {
      const isSelf = msg.senderId === net.getLocalPlayerId();
      chatUi.appendMessage(msg, isSelf);
      if (isSelf) {
        engine.avatar.showLocalSpeechBubble(msg.text, msg.bubbleStyle);
      } else {
        engine.avatar.showRemoteSpeechBubble(msg.senderId, msg.text, msg.bubbleStyle);
      }
    },
    onPeerTyping: (playerId, typing, style) => {
      const peerName =
        latestRoster.find((p) => p.id === playerId)?.name ??
        net.getPlayersInWorld().find((p) => p.id === playerId)?.name ??
        playerId;
      chatUi.setPeerTyping(playerId, peerName, typing);
      engine.avatar.setRemoteTyping(playerId, typing, style);
    },
    onPeerStyleUpdate: (playerId, style) => {
      engine.avatar.setRemoteBubbleStyle(playerId, style);
    },
    onVoiceActivity: (playerId, speaking, level, isLocal) => {
      if (isLocal) {
        engine.avatar.setLocalVoiceActivity(speaking, level, activeBubbleStyle());
      } else {
        const peerStyle = latestRtcPeers.get(playerId)?.bubbleStyle;
        engine.avatar.setRemoteVoiceActivity(playerId, speaking, level, peerStyle);
      }
    },
    onStateChange: (voice, peers) => {
      latestVoiceSnapshot = voice;
      latestRtcPeers = new Map(peers.map((p) => [p.playerId, p]));
      chatUi.syncVoiceUi(voice, peers);
      mobileControls?.setVoiceState(voice.joined, voice.muted, voice.speaking);
      renderPresenceRoster();
    },
    onError: (msg) => showToast(msg),
  });
  void fetchRtcIceServers().then((servers) => rtcMesh.setIceServers(servers));

  chatUi = new ChatAndVoiceUi({
    onSendMessage: (text) => {
      rtcMesh.resumeAudio();
      rtcMesh.sendChatMessage(text, activeBubbleStyle());
      if (wasPointerLockedBeforeChat && gateExited && !engine.hasFallen && !mobileControls?.isEnabled()) {
        wasPointerLockedBeforeChat = false;
        engine.requestPointerLock();
      }
    },
    onTypingChange: (active) => {
      rtcMesh.sendTyping(active);
    },
    onFocusChange: (focused) => {
      if (focused) {
        rtcMesh.resumeAudio();
      }
      syncInputLocks();
      syncPointerUi(engine.avatar.pointerLocked);
    },
    onOpenBubbleCustomizer: () => {
      openModal(modalBubbleStyle);
    },
    onJoinVoice: () => {
      void rtcMesh.joinVoice().then((ok) => {
        if (ok) showToast('Joined WebRTC voice chat (3D spatial audio)');
      });
    },
    onLeaveVoice: () => {
      rtcMesh.leaveVoice();
      showToast('Left voice chat');
    },
    onToggleMute: () => {
      const muted = rtcMesh.toggleMute();
      showToast(muted ? 'Microphone muted' : 'Microphone live');
    },
    onToggleDeafen: () => {
      const next = !(latestVoiceSnapshot?.deafened ?? false);
      rtcMesh.setDeafened(next);
      showToast(next ? 'Voice audio deafened' : 'Voice audio restored');
    },
    onTogglePushToTalk: (enabled) => {
      rtcMesh.setPushToTalk(enabled);
      showToast(enabled ? 'Push-to-Talk enabled (hold B)' : 'Open Mic enabled');
    },
    onToggleSpatialAudio: (enabled) => {
      rtcMesh.setSpatialAudio(enabled);
      showToast(enabled ? '3D Spatial voice enabled' : 'Room-wide stereo voice enabled');
    },
    onSelectInputDevice: (deviceId) => {
      if (latestVoiceSnapshot?.joined) {
        void rtcMesh.joinVoice(deviceId);
      }
    },
    listInputDevices: () => rtcMesh.listAudioInputDevices(),
  });
  chatUi.syncVoiceUi(rtcMesh.getVoiceSnapshot(), rtcMesh.getPeerSnapshots());
  if (isTouchHardware) {
    chatUi.setCollapsed(true);
  }

  function applySpeechBubbleStyle(style: SpeechBubbleStyle, sampleText?: string, customToast?: string): void {
    identity = { ...identity, bubbleStyle: style };
    saveIdentity(identity);
    engine.avatar.setLocalBubbleStyle(style);
    rtcMesh.setLocalIdentity(net.getLocalPlayerId(), identity.name, identity.color, style);
    net.updateProfile(identity.name, identity.color, identity.characterId, normalizeSkinAppearance(identity), style);
    syncProfileBubbleSummary();
    const presetName = getBubblePreset(style.preset).name;
    showToast(customToast ?? `Speech bubble updated to ${presetName}!`);
    if (sampleText && !engine.avatar.firstPerson) {
      engine.avatar.showLocalSpeechBubble(sampleText, style);
    }
  }

  const bubbleCustomizer = new BubbleCustomizerModal(modalBubbleStyle, {
    getCurrentStyle: () => activeBubbleStyle(),
    getAvatarColor: () => identity.color,
    onSave: (style, sampleText) => {
      applySpeechBubbleStyle(style, sampleText);
    },
    onClose: (relockPointer) => {
      closeAllModals(relockPointer);
    },
  });

  dialogueUi = new NpcDialogueUi({
    onOpenDialogue: (npc) => {
      chatUi.blurInput();
      chatUi.closeVoicePopover();
      engine.npcs.setDialogueActive(npc.id);
      syncInputLocks();
      syncPointerUi(false);
    },
    onCloseDialogue: (_npc, relockPointer) => {
      engine.npcs.setDialogueActive(null);
      syncInputLocks();
      if (relockPointer && gateExited && !engine.hasFallen && !mobileControls?.isEnabled() && !isAnyModalOpen()) {
        engine.requestPointerLock();
      }
      syncPointerUi(engine.avatar.pointerLocked);
    },
    onSpeakNode: (npc, node) => {
      engine.npcs.speak(npc.id, node.text, node.expr, node.gesture ?? 'explain');
    },
    onAdoptBubbleStyle: (npc, style) => {
      applySpeechBubbleStyle(
        { ...style },
        undefined,
        `Equipped ${npc.name}'s ${getBubblePreset(style.preset).name} speech bubble!`,
      );
    },
    onOpenJournal: () => {
      openModal(modalJournal);
    },
    onJumpToWorld: (worldId) => {
      closeAllModals();
      void transitionToWorld(worldId);
    },
    onToast: (msg) => showToast(msg),
    getWorldName: (worldId) => registry.getManifest(worldId)?.name ?? worldId,
  });

  function syncProfileBubbleSummary(): void {
    const s = activeBubbleStyle();
    const presetName = getBubblePreset(s.preset).name;
    const fx = s.effect === 'none' ? 'Clean' : s.effect[0].toUpperCase() + s.effect.slice(1);
    profileBubbleSummary.textContent = `${s.badge ? `${s.badge} ` : ''}${presetName} · ${fx}`;
  }
  syncProfileBubbleSummary();

  function renderPresenceRoster(): void {
    const displayList: AvatarState[] =
      latestRoster.length > 0
        ? latestRoster
        : [
            {
              id: identity.id,
              name: identity.name,
              color: identity.color,
              worldId: activeWorldId,
              position: [engine.avatar.position.x, engine.avatar.position.y, engine.avatar.position.z],
              yaw: engine.avatar.yaw,
              velocityY: 0,
              updatedAt: Date.now(),
            },
          ];

    const rosterKey = displayList
      .map((p) => {
        const isMe = p.id === net.getLocalPlayerId();
        const rtc = latestRtcPeers.get(p.id);
        const speaking = isMe ? Boolean(latestVoiceSnapshot?.speaking) : Boolean(rtc?.speaking);
        const hasAudio = isMe ? Boolean(latestVoiceSnapshot?.joined) : Boolean(rtc?.hasRemoteAudio);
        const muted = isMe ? Boolean(latestVoiceSnapshot?.muted) : Boolean(rtc?.locallyMuted);
        return `${p.id}|${p.name}|${p.color}|${p.worldId}|${activeWorldId}|${speaking}|${hasAudio}|${muted}`;
      })
      .join('\n');
    if (rosterKey === lastRosterKey) return;
    lastRosterKey = rosterKey;
    metaView?.syncPresence(displayList);

    playerCountEl.textContent = String(displayList.length);
    playerListEl.innerHTML = '';

    for (const p of displayList) {
      const li = document.createElement('li');
      const isMe = p.id === net.getLocalPlayerId();
      const rtc = latestRtcPeers.get(p.id);
      const speaking = isMe ? Boolean(latestVoiceSnapshot?.speaking) : Boolean(rtc?.speaking);
      const hasAudio = isMe ? Boolean(latestVoiceSnapshot?.joined) : Boolean(rtc?.hasRemoteAudio);
      const muted = isMe ? Boolean(latestVoiceSnapshot?.muted) : Boolean(rtc?.locallyMuted);
      const worldName = registry.getManifest(p.worldId)?.name ?? p.worldId;
      const canJoin = !isMe && p.worldId !== activeWorldId && !!registry.getManifest(p.worldId);
      li.className = `player-item${canJoin ? ' clickable' : ''}${speaking ? ' is-speaking' : ''}`;
      li.innerHTML = `
        <span class="player-meta">
          <span class="player-swatch" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></span>
          <span class="player-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}</span>
        </span>
        <span class="player-right">
          <span class="player-world">${escapeHtml(worldName)}</span>
        </span>
      `;
      if (hasAudio) {
        const right = li.querySelector('.player-right')!;
        const voicePill = document.createElement('button');
        voicePill.type = 'button';
        voicePill.className = `player-voice-badge${speaking ? ' speaking' : ''}${muted ? ' muted' : ''}`;
        voicePill.textContent = muted ? '✕' : '♪';
        voicePill.title = isMe
          ? muted
            ? 'Your mic is muted (click to unmute)'
            : 'Your mic is live (click to mute)'
          : muted
            ? `Unmute ${p.name}`
            : `Mute ${p.name}`;
        voicePill.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (isMe) rtcMesh.toggleMute();
          else rtcMesh.setPeerLocallyMuted(p.id, !muted);
        });
        right.prepend(voicePill);
      }
      if (canJoin) {
        li.title = `Click to join ${p.name} in ${worldName}`;
        li.addEventListener('click', () => {
          void transitionToWorld(p.worldId, { spawnId: 'default' });
        });
      }
      playerListEl.appendChild(li);
    }
  }

  function renderWorldDirectory(): void {
    worldDirectoryList.innerHTML = '';
    const base = shareBase;

    const entries = registry.listWorlds().filter(w => w.kind === 'local').map(w => ({
      title: w.name,
      owner: w.owner ?? w.author,
      desc: w.description,
      accent: w.accentColor,
      worldId: w.id,
    }));

    for (const item of entries) {
      const card = document.createElement('div');
      card.className = 'world-card';
      const url = buildShareableWorldUrl(base, { worldId: item.worldId });
      card.innerHTML = `
        <div class="world-card-info">
          <div class="world-card-title">
            <span class="player-swatch" style="background:${item.accent};box-shadow:0 0 8px ${item.accent}"></span>
            <span>${escapeHtml(item.title)}</span>
            <span class="world-card-owner">${escapeHtml(item.owner)}</span>
          </div>
          <div class="world-card-desc">${escapeHtml(item.desc)}</div>
        </div>
        <div class="world-card-actions">
          <button class="btn btn-sm" data-copy-url>Copy Link</button>
          <button class="btn btn-sm btn-primary" data-go-world>Enter</button>
        </div>
      `;

      card.querySelector('[data-copy-url]')!.addEventListener('click', async () => {
        await copyToClipboard(url);
        showToast(`Copied link to ${item.title}`);
      });

      card.querySelector('[data-go-world]')!.addEventListener('click', () => {
        closeAllModals();
        void transitionToWorld(item.worldId);
      });

      worldDirectoryList.appendChild(card);
    }

    // Refresh target world select inside "+ Link Portal" modal
    portalTargetWorldSelect.innerHTML = '';
    for (const w of registry.listWorlds()) {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.name}${w.owner ? ` (${w.owner})` : ''}`;
      portalTargetWorldSelect.appendChild(opt);
    }
  }

  async function transitionToWorld(
    worldId: string,
    opts?: { spawnId?: string; fromPortal?: PortalDefinition; crossed?: boolean },
  ): Promise<void> {
    if (isTransitioning) return;
    isTransitioning = true;
    const needsOverlay = !engine.isRoomReady(worldId);
    const targetName = registry.getManifest(worldId)?.name ?? worldId;
    if (needsOverlay) {
      warpLabel.textContent = `Loading ${targetName}...`;
      warpOverlay.classList.add('active');
      warpOverlay.setAttribute('aria-hidden', 'false');
      syncInputLocks();
      syncPointerUi(false);
    }
    if (!opts?.fromPortal) soundtrack.playPortalWhoosh();

    try {
      const arrival = await engine.mountWorld(worldId, {
        spawnId: opts?.spawnId,
        fromPortal: opts?.fromPortal,
        crossed: opts?.crossed,
      });
      if (!arrival) return;
      net.switchWorld(
        worldId,
        [engine.avatar.position.x, engine.avatar.position.y, engine.avatar.position.z],
        engine.avatar.getFacingYaw(),
      );
      rtcMesh.syncPeers([], net.getLocalPlayerId(), worldId);
      chatUi.clearTyping();
      renderPresenceRoster();
      if (needsOverlay) {
        // Let the newly installed room paint its first frame before lifting the loading overlay.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    } catch (err) {
      showToast(`Failed to enter world: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isTransitioning = false;
      if (needsOverlay) {
        warpOverlay.classList.remove('active');
        warpOverlay.setAttribute('aria-hidden', 'true');
        syncInputLocks();
        syncPointerUi(engine.avatar.pointerLocked);
      }
    }
  }

  async function handlePortalTransition(portal: PortalDefinition, crossed: boolean): Promise<void> {
    if (portal.remoteUrl) {
      const returnUrl = buildShareableWorldUrl(shareBase, {
        worldId: activeWorldId,
      });
      const dest = buildRemotePortalUrl(portal.remoteUrl, {
        version: 1,
        playerName: identity.name,
        playerColor: identity.color,
        ...normalizeSkinAppearance(identity),
        characterId: identity.characterId,
        bubbleStyle: activeBubbleStyle(),
        fromWorldId: activeWorldId,
        fromWorldName: activeManifest.name,
        returnUrl,
        targetWorldId: portal.targetWorldId,
        targetSpawnId: portal.targetSpawnId,
        sentAt: Date.now(),
      });
      if (!dest) {
        showToast('Invalid remote portal URL (only http/https allowed).');
        return;
      }
      warpLabel.textContent = `Warping to ${portal.label}...`;
      warpOverlay.classList.add('active');
      window.setTimeout(() => {
        window.location.href = dest;
      }, 320);
      return;
    }

    await transitionToWorld(portal.targetWorldId, {
      spawnId: portal.targetSpawnId,
      fromPortal: portal,
      crossed,
    });
  }

  const characterSelect = new CharacterSelectScreen(modalCharacters, {
    getEquippedId: () => engine.avatar.getCharacterId(),
    getAccentColor: () => identity.color,
    getSkinAppearance: () => normalizeSkinAppearance(identity),
    onPreview: (char, appearance) => {
      engine.prewarmCharacter(char.id, appearance);
    },
    onSelect: (char, switchToThirdPerson, appearance) => {
      identity = { ...identity, characterId: char.id, ...appearance };
      try { localStorage.setItem(STORAGE_CHARACTER_CHOICE_KEY, char.id); } catch { /* storage unavailable */ }
      saveIdentity(identity);
      engine.equipCharacter(char.id, appearance);
      net.updateProfile(identity.name, identity.color, char.id, appearance, activeBubbleStyle());
      if (switchToThirdPerson && engine.avatar.firstPerson) {
        engine.avatar.setFirstPerson(false);
      }
      renderPresenceRoster();
      showToast(`Playing as ${char.name} (${char.title})`);
    },
    onClose: (relockPointer) => {
      closeAllModals(relockPointer);
    },
  });

  // Mobile multi-touch controls + performance profile selector
  mobileControls = new MobileControls(mobileControlsRoot, engine.avatar, {
    onOpenCharacters: () => openModal(modalCharacters),
    onToggleCameraView: () => engine.avatar.toggleCameraView(),
    onOpenChat: () => chatUi.openAndFocus(),
    onOpenMetaView: () => openMetaView(),
    onToggleVoice: () => {
      if (!latestVoiceSnapshot?.joined) {
        void rtcMesh.joinVoice().then((ok) => {
          if (ok) showToast('Joined WebRTC voice chat');
        });
      } else {
        const muted = rtcMesh.toggleMute();
        showToast(muted ? 'Microphone muted' : 'Microphone live');
      }
    },
  });
  mobileControls.setEnabled(shouldUseTouchControls());
  mobileControls.setFlying(engine.avatar.isFlying);
  mobileControls.setFirstPerson(engine.avatar.firstPerson);
  mobileControls.setInputLocked(true);

  const syncPerfProfileUi = () => {
    const autoOpt = perfProfileSelect.querySelector<HTMLOptionElement>('option[value="auto"]');
    if (autoOpt) {
      autoOpt.textContent = `Auto (Detected: ${detectedPerfProfile.label})`;
    }
    perfProfileSelect.value = perfPreference;
    touchControlsSelect.value = touchPreference;
    perfProfileSummary.textContent = `Active: ${activePerfProfile.label} — ${activePerfProfile.summary}`;
  };
  syncPerfProfileUi();

  perfProfileSelect.addEventListener('change', () => {
    perfPreference = parsePerformanceProfilePreference(perfProfileSelect.value);
    activePerfProfile = resolvePerformanceProfile(perfPreference);
    engine.setPerformanceProfile(activePerfProfile);
    try {
      localStorage.setItem(STORAGE_PERF_PROFILE_KEY, perfPreference);
    } catch {
      /* storage unavailable */
    }
    syncPerfProfileUi();
    perfProfileSelect.blur();
    showToast(`Graphics profile: ${activePerfProfile.label}`);
  });

  touchControlsSelect.addEventListener('change', () => {
    touchPreference = parseTouchPreference(touchControlsSelect.value);
    try {
      localStorage.setItem(STORAGE_TOUCH_CONTROLS_KEY, touchPreference);
    } catch {
      /* storage unavailable */
    }
    mobileControls?.setEnabled(shouldUseTouchControls());
    dialogueUi.syncPrompt(Boolean(mobileControls?.isEnabled()));
    syncPointerUi(engine.avatar.pointerLocked);
    touchControlsSelect.blur();
  });

  // Make the nearby portal prompt tappable on mobile (and clickable on desktop)
  portalPromptEl.addEventListener('click', () => {
    engine.triggerNearestPortal();
  });

  // Keep engine UI lock (gate/modals/dialogue/room takeover/chat input/teleport loading) separate from engine.hasFallen
  // so closing modals on a fall never leaves engine.inputLocked stuck true after respawn().
  function syncInputLocks(): void {
    const uiLocked =
      !gateExited ||
      isTransitioning ||
      isMetaViewOpen() ||
      isAnyModalOpen() ||
      roomInputCaptured ||
      dialogueUi.isOpen() ||
      chatUi.isFocused();
    engine.setInputLocked(uiLocked);
    mobileControls?.setInputLocked(uiLocked || engine.hasFallen);
  }

  function ensureMetaView(): { view: CosmicMetaView; ui: MetaViewUi } {
    if (metaView && metaViewUi) return { view: metaView, ui: metaViewUi };
    const localWorlds = registry.listWorlds().filter((w) => w.kind === 'local');
    metaView = new CosmicMetaView({
      worlds: localWorlds,
      activeWorldId,
      isMobile: activePerfProfile.isMobile,
      callbacks: {
        onFocusChange: (focus) => metaViewUi?.setFocus(focus),
        onHoverChange: (label) => metaViewUi?.setHoverLabel(label),
        onEnterWorld: (worldId) => {
          const sameRoom = worldId === activeWorldId;
          closeMetaView(sameRoom);
          if (!sameRoom) {
            void transitionToWorld(worldId);
          }
        },
      },
    });
    metaViewUi = new MetaViewUi(metaViewOverlay, localWorlds, {
      onClose: () => closeMetaView(false),
      onOverview: () => metaView?.focusOverview(),
      onShake: (worldId) => metaView?.shakeGlobe(worldId),
      onToggleArt: () => {
        if (!metaView) return true;
        const next = !metaView.getShowConstellationArt();
        metaView.setShowConstellationArt(next);
        return next;
      },
      onSelectWorld: (worldId) => {
        metaView?.focusWorld(worldId);
      },
      onEnterWorld: (worldId) => {
        metaView?.enterWorld(worldId);
      },
      onStepWorld: (delta) => metaView?.stepWorld(delta),
      onSelectConstellation: (constellationId) => {
        metaView?.focusConstellation(constellationId);
      },
      onStepConstellation: (delta) => metaView?.stepConstellation(delta),
      onCopyWorldLink: (world) => {
        const url = buildShareableWorldUrl(shareBase, { worldId: world.id });
        void copyToClipboard(url).then(() => showToast(`Copied link to ${world.name}!`));
      },
    });
    return { view: metaView, ui: metaViewUi };
  }

  function openMetaView(): void {
    if (!gateExited || isTransitioning || isMetaViewOpen()) return;
    if (engine.hasFallen) engine.respawn();
    if (dialogueUi.isOpen()) dialogueUi.closeDialogue(false);
    chatUi.blurInput();
    chatUi.closeVoicePopover();
    closeAllModals();

    const { view, ui } = ensureMetaView();
    view.setActiveWorld(activeWorldId);
    const presenceRoster =
      latestRoster.length > 0
        ? latestRoster
        : [
            {
              id: identity.id,
              name: identity.name,
              color: identity.color,
              worldId: activeWorldId,
              position: [engine.avatar.position.x, engine.avatar.position.y, engine.avatar.position.z] as Vec3Tuple,
              yaw: engine.avatar.yaw,
              velocityY: 0,
              updatedAt: Date.now(),
            },
          ];
    view.syncPresence(presenceRoster);
    hudEl.classList.add('meta-view-hidden');
    ui.show(activeWorldId);
    engine.setOverlayView(view);
    view.attachControls(engine.renderer.domElement);
    soundtrack.enterRoom('__cosmic-meta__');
    syncInputLocks();
    syncPointerUi(false);
  }

  function closeMetaView(relockPointer = false): void {
    if (!isMetaViewOpen()) return;
    metaView?.detachControls();
    engine.setOverlayView(null);
    metaViewUi?.hide();
    hudEl.classList.remove('meta-view-hidden');
    soundtrack.enterRoom(activeWorldId);
    syncInputLocks();
    if (relockPointer && gateExited && !engine.hasFallen && !mobileControls?.isEnabled() && !isAnyModalOpen()) {
      engine.requestPointerLock();
    }
    syncPointerUi(engine.avatar.pointerLocked);
  }

  window.addEventListener('portalverse:room-capture', (ev) => {
    const active = Boolean((ev as CustomEvent<{ active?: boolean }>).detail?.active);
    if (active === roomInputCaptured) return;
    roomInputCaptured = active;
    if (active && engine.avatar.pointerLocked) {
      engine.exitPointerLock();
    }
    syncInputLocks();
    syncPointerUi(engine.avatar.pointerLocked);
  });

  // Modal helpers
  function openModal(modal: HTMLElement): void {
    if (!gateExited || engine.hasFallen || isTransitioning) return;
    if (dialogueUi.isOpen()) dialogueUi.closeDialogue(false);
    chatUi.blurInput();
    chatUi.closeVoicePopover();
    closeAllModals();
    modal.classList.remove('hidden');
    if (modal === modalCharacters) {
      characterSelect.show();
    } else if (modal === modalBubbleStyle) {
      bubbleCustomizer.show();
    } else if (modal === modalJournal) {
      dialogueUi.renderJournal();
    }
    syncInputLocks();
    syncPointerUi(false);
  }

  function closeAllModals(relockPointer = false): void {
    characterSelect.hide();
    engine.clearPrewarmedCharacter();
    bubbleCustomizer.hide();
    for (const modal of allModals) modal.classList.add('hidden');
    syncInputLocks();
    if (relockPointer && gateExited && !engine.hasFallen && !mobileControls?.isEnabled()) {
      engine.requestPointerLock();
    }
    syncPointerUi(engine.avatar.pointerLocked);
  }

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const shouldRelock = btn.closest('#modal-controls') !== null && btn.classList.contains('btn-primary');
      closeAllModals(shouldRelock);
    });
  });
  allModals.forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeAllModals();
    });
  });

  // Share current room direct link
  btnShareLink.addEventListener('click', async () => {
    const shareUrl = buildShareableWorldUrl(shareBase, {
      worldId: activeWorldId,
    });
    await copyToClipboard(shareUrl);
    showToast(`Copied link to ${activeManifest.name}!`);
  });

  btnCosmos.addEventListener('click', () => {
    openMetaView();
  });

  btnWorldsOpenCosmos.addEventListener('click', () => {
    closeAllModals();
    openMetaView();
  });

  btnWorlds.addEventListener('click', () => {
    renderWorldDirectory();
    worldDirectoryList.scrollTop = 0;
    openModal(modalWorlds);
  });

  btnCharacters.addEventListener('click', () => {
    openModal(modalCharacters);
  });

  btnLinkPortal.addEventListener('click', () => {
    renderWorldDirectory();
    openModal(modalPortal);
    portalLabelInput.focus();
  });

  btnProfile.addEventListener('click', () => {
    profileNameInput.value = identity.name;
    profileColorInput.value = identity.color;
    syncProfileBubbleSummary();
    openModal(modalProfile);
    profileNameInput.focus();
  });

  btnProfileBubbleStyle.addEventListener('click', () => {
    openModal(modalBubbleStyle);
  });

  btnControls.addEventListener('click', () => {
    openModal(modalControls);
  });

  btnReplayTutorial.addEventListener('click', () => {
    closeAllModals(true);
    tutorial.start(activeWorldId);
  });

  portalModeSelect.addEventListener('change', () => {
    const isRemote = portalModeSelect.value === 'remote';
    portalLocalFields.classList.toggle('hidden', isRemote);
    portalRemoteFields.classList.toggle('hidden', !isRemote);
  });

  formPortal.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = portalLabelInput.value.trim();
    if (!label) return;

    const isRemote = portalModeSelect.value === 'remote';
    const remoteUrl = isRemote ? portalRemoteUrlInput.value.trim() : undefined;
    const defaultId = registry.getDefaultWorldId();
    const targetWorldId = isRemote ? defaultId : portalTargetWorldSelect.value || defaultId;
    const targetSpawnId = isRemote ? undefined : portalTargetSpawnInput.value.trim() || 'default';

    const newPortal: PortalDefinition = {
      id: `dyn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      subtitle: isRemote ? 'Federated Remote Link' : `Linked by ${identity.name}`,
      position: engine.avatar.getPointInFront(7.5),
      yaw: engine.avatar.yaw + Math.PI,
      targetWorldId,
      targetSpawnId,
      remoteUrl,
      colorA: portalColorAInput.value,
      colorB: portalColorBInput.value,
      createdBy: identity.name,
    };

    net.spawnPortal(activeWorldId, newPortal);
    portalLabelInput.value = '';
    portalRemoteUrlInput.value = '';
    closeAllModals();
    showToast(`Spawned portal "${label}"!`);
  });

  formProfile.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = profileNameInput.value.trim();
    const color = profileColorInput.value;
    if (!name) return;
    identity = { ...identity, name, color };
    saveIdentity(identity);
    engine.avatar.setLocalColor(color);
    rtcMesh.setLocalIdentity(net.getLocalPlayerId(), name, color, activeBubbleStyle());
    net.updateProfile(name, color, identity.characterId, normalizeSkinAppearance(identity), activeBubbleStyle());
    renderPresenceRoster();
    closeAllModals();
    showToast(`Updated explorer identity to ${name}`);
  });

  // Respawn after a fall, then take the cursor back for mouse-look.
  const respawn = () => {
    if (!engine.hasFallen) return;
    engine.respawn();
    syncInputLocks();
    if (!mobileControls?.isEnabled()) engine.requestPointerLock();
  };
  respawnButton.addEventListener('click', respawn);

  // Global keyboard shortcuts (P = Link Portal, M = Rooms, H/? = Controls, Escape = Close modals)
  window.addEventListener('keydown', (e) => {
    if (engine.hasFallen) {
      // Not Space: players falling often mash it, and it would respawn them before they see the screen.
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
        e.preventDefault();
        respawn();
      }
      return;
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = true;
    if (isMetaViewOpen()) {
      if ((e.code === 'Escape' || e.code === 'KeyO') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        closeMetaView(false);
      }
      return;
    }
    if (
      e.code === 'KeyO' &&
      !e.repeat &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)
    ) {
      if (gateExited) {
        e.preventDefault();
        openMetaView();
      }
      return;
    }
    if (dialogueUi.isOpen()) {
      dialogueUi.handleKeyDown(e);
      return;
    }
    if (e.code === 'Escape') {
      if (chatUi.isFocused()) {
        wasPointerLockedBeforeChat = false;
        chatUi.blurInput();
        return;
      }
      if (chatUi.isVoicePopoverOpen()) {
        chatUi.closeVoicePopover();
        return;
      }
      closeAllModals();
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    if ((e.code === 'KeyT' || e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (gateExited && !isAnyModalOpen()) {
        e.preventDefault();
        wasPointerLockedBeforeChat = engine.avatar.pointerLocked;
        chatUi.openAndFocus();
      }
    } else if (e.code === 'KeyB' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (gateExited && !isAnyModalOpen()) {
        e.preventDefault();
        if (latestVoiceSnapshot?.joined && latestVoiceSnapshot.pushToTalk) {
          rtcMesh.setPushToTalkPressed(true);
        } else if (!latestVoiceSnapshot?.joined) {
          void rtcMesh.joinVoice().then((ok) => {
            if (ok) showToast('Joined WebRTC voice chat (3D spatial audio)');
          });
        } else {
          const muted = rtcMesh.toggleMute();
          showToast(muted ? 'Microphone muted' : 'Microphone live');
        }
      }
    } else if (e.code === 'KeyU' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!modalBubbleStyle.classList.contains('hidden')) {
        closeAllModals(true);
      } else {
        openModal(modalBubbleStyle);
      }
    } else if (e.code === 'KeyJ' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!modalJournal.classList.contains('hidden')) {
        closeAllModals(true);
      } else {
        openModal(modalJournal);
      }
    } else if (e.code === 'KeyP') {
      renderWorldDirectory();
      openModal(modalPortal);
    } else if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!modalCharacters.classList.contains('hidden')) {
        closeAllModals(true);
      } else {
        openModal(modalCharacters);
      }
    } else if (e.code === 'KeyM') {
      renderWorldDirectory();
      worldDirectoryList.scrollTop = 0;
      openModal(modalWorlds);
    } else if (e.code === 'KeyH' || e.key === '?') {
      if (!modalControls.classList.contains('hidden')) {
        closeAllModals();
      } else {
        openModal(modalControls);
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = false;
    if (e.code === 'KeyB') rtcMesh.setPushToTalkPressed(false);
  });
  window.addEventListener('blur', () => {
    shiftHeld = false;
    rtcMesh.setPushToTalkPressed(false);
  });

  // Soundtrack: feed it the player's state each frame, and the music toggle (button or N).
  const musicButton = document.getElementById('btn-music') as HTMLButtonElement;
  const musicLabel = document.getElementById('music-label')!;
  const syncMusicUi = () => {
    musicButton.setAttribute('aria-pressed', String(!soundtrack.isMuted));
    musicButton.classList.toggle('muted', soundtrack.isMuted);
    musicButton.title = soundtrack.isMuted ? 'Enable music (N)' : 'Mute music (N)';
    musicLabel.textContent = soundtrack.isMuted ? 'Muted' : 'Music';
  };
  syncMusicUi();
  const toggleMusic = () => {
    soundtrack.toggleMuted();
    syncMusicUi();
  };
  musicButton.addEventListener('click', () => {
    toggleMusic();
    musicButton.blur();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || e.repeat || !gateExited || engine.hasFallen) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    toggleMusic();
  });
  const listenerPos: Vec3Tuple = [0, 0, 0];
  const listenerForward: Vec3Tuple = [0, 0, -1];
  const listenerUp: Vec3Tuple = [0, 1, 0];
  const getRemotePos = (id: string) => engine.avatar.getRemotePlayerPosition(id);

  const feedSoundtrack = () => {
    requestAnimationFrame(feedSoundtrack);
    if (!gateExited) return;
    soundtrack.update({
      roomId: isMetaViewOpen() ? '__cosmic-meta__' : activeWorldId,
      warp: isMetaViewOpen() ? 0 : engine.portalWarp,
      moveNorm: isMetaViewOpen() ? 0.35 : engine.motionLevel,
      fallen: engine.hasFallen,
    });
    const e = engine.camera.matrixWorld.elements;
    listenerPos[0] = e[12];
    listenerPos[1] = e[13];
    listenerPos[2] = e[14];
    listenerForward[0] = -e[8];
    listenerForward[1] = -e[9];
    listenerForward[2] = -e[10];
    listenerUp[0] = e[4];
    listenerUp[1] = e[5];
    listenerUp[2] = e[6];
    rtcMesh.updateSpatialAndLevels(listenerPos, listenerForward, listenerUp, getRemotePos);
  };
  requestAnimationFrame(feedSoundtrack);

  // Yuna-style smooth circular loading gate controller
  const RING_CIRCUMFERENCE = 2 * Math.PI * 102;
  const REVEAL_START_Y = 168;
  const REVEAL_END_Y = 68;
  const revealCircleY = (pct: number) =>
    REVEAL_START_Y - (REVEAL_START_Y - REVEAL_END_Y) * (pct / 100);

  let targetProgress = 8;
  let visualProgress = 0;
  let fillProgress = 0;
  let preloadComplete = false;
  let gateReady = false;
  let gateError = false;
  let lastGateFrame = performance.now();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  engine.setInputLocked(true);

  const setLoadPhase = (progressPct: number, label: string) => {
    targetProgress = Math.max(targetProgress, Math.min(100, progressPct));
    loadingPhaseText.textContent = label;
  };

  const drawGateProgress = (val: number, bgVal: number) => {
    loadingStatusText.textContent = `${Math.floor(val)}%`;
    loadingMedallion.style.setProperty('--emblem-reveal-y', `${revealCircleY(val)}%`);
    loadingMedallion.style.setProperty('--fill-reveal-y', `${revealCircleY(bgVal)}%`);
    const dashOffset = RING_CIRCUMFERENCE * (1 - val / 100);
    loadingRingArc.style.strokeDashoffset = `${dashOffset.toFixed(2)}`;
  };

  const stepGate = (now: number) => {
    if (gateExited || gateError) return;
    const elapsedMs = Math.min(now - lastGateFrame, 100);
    lastGateFrame = now;

    const goal = preloadComplete ? 100 : targetProgress;
    if (reduceMotion) {
      visualProgress = goal;
      fillProgress = goal;
    } else {
      const response = 1 - Math.exp(-elapsedMs / 180);
      const maxStep = Math.min(2.2, 55 * (elapsedMs / 1000));
      visualProgress += Math.min((goal - visualProgress) * response, maxStep);
      if (Math.abs(goal - visualProgress) < 0.08) visualProgress = goal;

      const maxFillStep = Math.min(1.6, 42 * (elapsedMs / 1000));
      fillProgress += Math.min(visualProgress - fillProgress, maxFillStep);
      if (Math.abs(visualProgress - fillProgress) < 0.08) fillProgress = visualProgress;
    }

    visualProgress = Math.min(100, Math.max(0, visualProgress));
    fillProgress = Math.min(100, Math.max(0, fillProgress));
    drawGateProgress(visualProgress, fillProgress);

    if (preloadComplete && visualProgress >= 99.9 && fillProgress >= 99.9) {
      drawGateProgress(100, 100);
      gateReady = true;
      loadingGate.classList.add('ready');
      loadingGate.setAttribute('aria-busy', 'false');
      loadingGate.setAttribute('aria-label', 'Portalverse ready. Click to enter.');
      loadingMedallion.disabled = false;
      btnGateTutorial.disabled = false;
      btnGateEnter.disabled = false;
      btnGateMeta.disabled = false;
      loadingMedallion.setAttribute('aria-label', `Enter ${activeManifest.name}`);
      loadingPhaseText.textContent = activeManifest.name.toUpperCase();
      loadingMedallion.focus();
      return;
    }

    window.requestAnimationFrame(stepGate);
  };
  window.requestAnimationFrame(stepGate);

  const enterFromGate = (startTutorial: boolean, launchMeta = false) => {
    if (gateError) {
      window.location.reload();
      return;
    }
    if (!gateReady || gateExited) return;
    gateExited = true;
    engine.syncViewport();
    soundtrack.start();
    rtcMesh.resumeAudio();
    loadingMedallion.disabled = true;
    btnGateTutorial.disabled = true;
    btnGateEnter.disabled = true;
    btnGateMeta.disabled = true;
    loadingGate.classList.add('exiting');
    syncInputLocks();
    const shouldOpenMeta = launchMeta || (initialOpenMeta && !startTutorial);
    if (!shouldOpenMeta && !mobileControls?.isEnabled()) {
      engine.requestPointerLock();
    }
    syncPointerUi(engine.avatar.pointerLocked);
    if (startTutorial) {
      tutorial.start(activeWorldId);
    } else if (shouldOpenMeta) {
      openMetaView();
    }
    window.setTimeout(() => {
      loadingGate.remove();
    }, 900);
  };

  loadingMedallion.addEventListener('click', () => enterFromGate(false));
  btnGateEnter.addEventListener('click', () => enterFromGate(false));
  btnGateTutorial.addEventListener('click', () => enterFromGate(true));
  btnGateMeta.addEventListener('click', () => enterFromGate(false, true));

  // Boot & preload pipeline behind the loading gate
  try {
    setLoadPhase(15, 'INITIALIZING WEBGPU');
    await engine.init();

    setLoadPhase(35, `LOADING ${activeManifest.name.toUpperCase()}`);
    const spawn = await engine.mountWorld(initialWorldId, {
      spawnId: route.spawnId ?? route.handoff?.targetSpawnId,
      extraPortals: combinedDynamicPortals(),
    });
    if (route.handoff && spawn) {
      // Step the traveller into the room with the way home right behind them.
      const placement = placeHandoffArrival(spawn);
      returnPortalFromHandoff = createReturnPortalFromHandoff(
        route.handoff,
        placement.portal.position,
        placement.portal.yaw,
      );
      if (returnPortalFromHandoff) {
        engine.avatar.applySpawn(placement.arrival);
        engine.setDynamicPortals(combinedDynamicPortals());
      }
    }

    setLoadPhase(60, 'PRELOADING ADJACENT ROOMS');
    await engine.preloadAdjacentRooms();

    setLoadPhase(68, 'RENDERING PORTAL PREVIEWS');
    await engine.warmUpPortals();

    preloadComplete = true;
    setLoadPhase(100, activeManifest.name.toUpperCase());
  } catch (err) {
    gateError = true;
    loadingGate.classList.add('error');
    loadingGate.setAttribute('aria-busy', 'false');
    loadingStatusText.textContent = 'RETRY';
    loadingPhaseText.textContent = err instanceof Error ? err.message.slice(0, 32).toUpperCase() : 'LOAD FAILED';
    loadingMedallion.disabled = false;
    loadingMedallion.setAttribute('aria-label', 'Loading failed. Click to retry.');
    return;
  }

  if (wsUrl) {
    net.connect();
  } else {
    hudNetStatus.dataset.state = 'offline';
    hudNetStatus.textContent = 'Solo / Local';
  }
  renderPresenceRoster();

  // Stream local avatar coordinates to multiplayer server at ~20 Hz (+ sample interactive tutorial)
  window.setInterval(() => {
    net.sendState(
      [
        Number(engine.avatar.position.x.toFixed(3)),
        Number(engine.avatar.position.y.toFixed(3)),
        Number(engine.avatar.position.z.toFixed(3)),
      ],
      Number(engine.avatar.getFacingYaw().toFixed(3)),
      Number(engine.avatar.velocityY.toFixed(3)),
      engine.avatar.isFlying,
    );
    if (tutorial.isActive() && gateExited && !isAnyModalOpen()) {
      tutorial.sample({
        x: engine.avatar.position.x,
        y: engine.avatar.position.y,
        z: engine.avatar.position.z,
        yaw: engine.avatar.yaw,
        pitch: engine.avatar.pitch,
        velocityY: engine.avatar.velocityY,
        isFlying: engine.avatar.isFlying,
        pointerLocked: engine.avatar.pointerLocked,
        sprinting: shiftHeld || engine.avatar.isSprinting(),
      });
    }
  }, 50);

  if (route.handoff) {
    showToast(
      returnPortalFromHandoff
        ? `Arrived from ${route.handoff.fromWorldName}! Turn around to go back.`
        : `Arrived from ${route.handoff.fromWorldName}!`,
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

void boot();
