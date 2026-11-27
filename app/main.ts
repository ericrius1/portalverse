/// <reference types="vite/client" />
import { livePortalSlots } from '@portalverse/core/portal/roomLayout';
import { sessionCatalog } from '@portalverse/core/portal/sessionCatalog';
import { tourShareBase } from '@portalverse/core/portal/roomTour';
import type {
  AvatarState,
  ConnectionState,
  PlayerIdentity,
  PortalDefinition,
  WorldManifest,
  WorldModule,
} from '@portalverse/core/types';
import { WorldEngine } from '@portalverse/core/engine/WorldEngine';
import { MultiplayerClient } from '@portalverse/core/net/multiplayerClient';
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
import { MobileControls } from './mobileControls';
import { chooseStartupCharacter, getCharacterDefinition, normalizeSkinAppearance } from '@portalverse/core/characters';
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
        };
      }
    }
  } catch {
    // Fall through to defaults
  }
  const palette = ['#22d3ee', '#f59e0b', '#a855f7', '#34d399', '#fb7185'];
  const id = `p-${Math.random().toString(36).slice(2, 10)}`;
  const identity: PlayerIdentity = {
    id,
    name: `Explorer ${id.slice(-4).toUpperCase()}`,
    color: palette[Math.floor(Math.random() * palette.length)],
    characterId: startupCharacter,
    ...normalizeSkinAppearance(),
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
  const modalControls = document.getElementById('modal-controls')!;
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
    };
    saveIdentity(identity);
  }

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

  const allModals = [modalPortal, modalWorlds, modalCharacters, modalProfile, modalControls];
  const isAnyModalOpen = () => allModals.some((m) => !m.classList.contains('hidden'));
  const syncPointerUi = (locked: boolean) => {
    const touchActive = Boolean(mobileControls?.isEnabled());
    fpsReticle.classList.toggle('hidden', !locked || touchActive);
    mouseLockLabel.textContent = locked ? 'FPS Locked (Esc)' : 'Click to Lock';
    pointerLockBanner.classList.toggle(
      'hidden',
      touchActive || !gateExited || isTransitioning || locked || isAnyModalOpen() || fallOverlay.classList.contains('active'),
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
      if (fallen) closeAllModals();
      else respawnButton.blur();
      syncInputLocks();
      syncPointerUi(engine.avatar.pointerLocked);
    },
    onMovementModeChange: (mode) => {
      physicsModeLabel.textContent = mode === 'platformer' ? 'Physics: Platformer' : 'Physics: Classic';
      try { localStorage.setItem(STORAGE_MOVEMENT_MODE_KEY, mode); } catch { /* storage unavailable */ }
    },
  }, identity.characterId);
  engine.avatar.setSkinAppearance(normalizeSkinAppearance(identity));
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
    },
    onPlayersChange: (players) => {
      engine.syncRemotePlayers(players, net.getLocalPlayerId());
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
    onError: (msg) => showToast(msg),
  });

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
      .map(p => `${p.id}|${p.name}|${p.color}|${p.worldId}|${activeWorldId}`)
      .join('\n');
    if (rosterKey === lastRosterKey) return;
    lastRosterKey = rosterKey;

    playerCountEl.textContent = String(displayList.length);
    playerListEl.innerHTML = '';

    for (const p of displayList) {
      const li = document.createElement('li');
      const isMe = p.id === net.getLocalPlayerId();
      const worldName = registry.getManifest(p.worldId)?.name ?? p.worldId;
      const canJoin = !isMe && p.worldId !== activeWorldId && !!registry.getManifest(p.worldId);
      li.className = `player-item${canJoin ? ' clickable' : ''}`;
      li.innerHTML = `
        <span class="player-meta">
          <span class="player-swatch" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></span>
          <span class="player-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}</span>
        </span>
        <span class="player-world">${escapeHtml(worldName)}</span>
      `;
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
    onSelect: (char, switchToThirdPerson, appearance) => {
      identity = { ...identity, characterId: char.id, ...appearance };
      try { localStorage.setItem(STORAGE_CHARACTER_CHOICE_KEY, char.id); } catch { /* storage unavailable */ }
      saveIdentity(identity);
      engine.avatar.setSkinAppearance(appearance);
      engine.avatar.setCharacter(char.id);
      net.updateProfile(identity.name, identity.color, char.id, appearance);
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
    syncPointerUi(engine.avatar.pointerLocked);
    touchControlsSelect.blur();
  });

  // Make the nearby portal prompt tappable on mobile (and clickable on desktop)
  portalPromptEl.addEventListener('click', () => {
    engine.triggerNearestPortal();
  });

  // Keep engine UI lock (gate/modals/teleport loading) separate from engine.hasFallen so closing modals
  // on a fall never leaves engine.inputLocked stuck true after respawn().
  function syncInputLocks(): void {
    const uiLocked = !gateExited || isTransitioning || isAnyModalOpen();
    engine.setInputLocked(uiLocked);
    mobileControls?.setInputLocked(uiLocked || engine.hasFallen);
  }

  // Modal helpers
  function openModal(modal: HTMLElement): void {
    if (!gateExited || engine.hasFallen || isTransitioning) return;
    closeAllModals();
    modal.classList.remove('hidden');
    if (modal === modalCharacters) {
      characterSelect.show();
    }
    syncInputLocks();
    syncPointerUi(false);
  }

  function closeAllModals(relockPointer = false): void {
    characterSelect.hide();
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
    openModal(modalProfile);
    profileNameInput.focus();
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
    net.updateProfile(name, color, identity.characterId);
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
    if (e.code === 'Escape') {
      closeAllModals();
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    if (e.code === 'KeyP') {
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
  });
  window.addEventListener('blur', () => {
    shiftHeld = false;
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
  const feedSoundtrack = () => {
    requestAnimationFrame(feedSoundtrack);
    if (!gateExited) return;
    soundtrack.update({
      roomId: activeWorldId,
      warp: engine.portalWarp,
      moveNorm: engine.motionLevel,
      fallen: engine.hasFallen,
    });
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
      loadingMedallion.setAttribute('aria-label', `Enter ${activeManifest.name}`);
      loadingPhaseText.textContent = activeManifest.name.toUpperCase();
      loadingMedallion.focus();
      return;
    }

    window.requestAnimationFrame(stepGate);
  };
  window.requestAnimationFrame(stepGate);

  const enterFromGate = (startTutorial: boolean) => {
    if (gateError) {
      window.location.reload();
      return;
    }
    if (!gateReady || gateExited) return;
    gateExited = true;
    soundtrack.start();
    loadingMedallion.disabled = true;
    btnGateTutorial.disabled = true;
    btnGateEnter.disabled = true;
    loadingGate.classList.add('exiting');
    syncInputLocks();
    if (!mobileControls?.isEnabled()) {
      engine.requestPointerLock();
    }
    syncPointerUi(engine.avatar.pointerLocked);
    if (startTutorial) {
      tutorial.start(activeWorldId);
    }
    window.setTimeout(() => {
      loadingGate.remove();
    }, 900);
  };

  loadingMedallion.addEventListener('click', () => enterFromGate(false));
  btnGateEnter.addEventListener('click', () => enterFromGate(false));
  btnGateTutorial.addEventListener('click', () => enterFromGate(true));

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
