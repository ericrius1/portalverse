/// <reference types="vite/client" />
import { livePortalSlots } from '@portalverse/core/portal/roomLayout';
import registryData from '../registry.json';
import type {
  AvatarState,
  ConnectionState,
  PlayerIdentity,
  PortalDefinition,
  RegistryFile,
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
import { Soundtrack } from '@portalverse/core/audio/Soundtrack';
import { vibeFor, type StemId } from '@portalverse/core/audio/musicMix';
import { ROUTE_LENGTH } from '@portalverse/core/portal/roomLayout';

const STORAGE_PROFILE_KEY = 'portalverse.profile.v1';
const STORAGE_MOVEMENT_MODE_KEY = 'portalverse.movement.mode';
const STORAGE_WARP_ZONES_KEY = 'portalverse.debug.warpZones';

function loadOrCreateIdentity(): PlayerIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerIdentity>;
      if (parsed.id && parsed.name && parsed.color) {
        return { id: parsed.id, name: parsed.name, color: parsed.color };
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
  const btnLinkPortal = document.getElementById('btn-link-portal')!;
  const btnProfile = document.getElementById('btn-profile')!;
  const btnControls = document.getElementById('btn-controls')!;
  const btnReplayTutorial = document.getElementById('btn-replay-tutorial') as HTMLButtonElement;

  const modalPortal = document.getElementById('modal-portal')!;
  const modalWorlds = document.getElementById('modal-worlds')!;
  const modalProfile = document.getElementById('modal-profile')!;
  const modalControls = document.getElementById('modal-controls')!;

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
  const loaders = Object.fromEntries(Object.entries(modules).map(([path, load]) => [path.split('/')[2], load]));
  const registry = new WorldRegistry(registryData as unknown as RegistryFile, loaders);

  // Read initial deep-link route (?world=eric-world, ?handoff=...)
  const route = readRouteFromLocation(window.location.search, window.location.hash);
  let identity = loadOrCreateIdentity();

  // Placed behind the traveller once their arrival spawn is known (see boot below).
  let returnPortalFromHandoff: PortalDefinition | null = null;
  if (route.handoff) {
    identity = {
      ...identity,
      name: route.handoff.playerName || identity.name,
      color: route.handoff.playerColor || identity.color,
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
      const shareUrl = buildShareableWorldUrl(window.location.origin + window.location.pathname, {
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
    if (returnPortalFromHandoff && activeWorldId === initialWorldId) {
      // First, so a room full of player portals never crowds out the way home.
      return [returnPortalFromHandoff, ...latestDynamicPortals];
    }
    return latestDynamicPortals;
  }

  let hudSyncTimer = 0;
  let lastRosterKey = '';
  function scheduleHudSync(updateRoster = false): void {
    const run = () => {
      hudWorldName.textContent = activeManifest.name;
      const authorLabel = activeManifest.owner ? `Owner: ${activeManifest.owner}` : activeManifest.author;
      hudWorldAuthor.textContent = `${authorLabel} · WebGPU`;
      worldAccentDot.style.background = activeManifest.accentColor;
      worldAccentDot.style.boxShadow = `0 0 14px ${activeManifest.accentColor}`;
      if (updateRoster) renderPresenceRoster();
    };
    window.clearTimeout(hudSyncTimer);
    hudSyncTimer = window.setTimeout(run, 0);
  }

  let gateExited = false;
  let shiftHeld = false;

  const allModals = [modalPortal, modalWorlds, modalProfile, modalControls];
  const isAnyModalOpen = () => allModals.some((m) => !m.classList.contains('hidden'));
  const syncPointerUi = (locked: boolean) => {
    fpsReticle.classList.toggle('hidden', !locked);
    mouseLockLabel.textContent = locked ? 'FPS Locked (Esc)' : 'Click to Lock';
    pointerLockBanner.classList.toggle('hidden', !gateExited || locked || isAnyModalOpen() || fallOverlay.classList.contains('active'));
  };

  // Adaptive soundtrack: Suno Studio stems blended by room and by distance to each gate.
  // ?mute=1 runs it at zero volume (automated tests) without touching the saved preference.
  const soundtrack = new Soundtrack({ silent: new URLSearchParams(window.location.search).get('mute') === '1' });
  if (import.meta.env.DEV) (window as unknown as { soundtrack: Soundtrack }).soundtrack = soundtrack;
  const localRoomOrder = registry.listWorlds().filter(w => w.kind === 'local').map(w => w.id);
  const loopNeighbour = (id: string, step: 1 | -1): string | null => {
    const i = localRoomOrder.indexOf(id);
    return i < 0 || localRoomOrder.length < 2
      ? null
      : localRoomOrder[(i + step + localRoomOrder.length) % localRoomOrder.length];
  };
  const initialVibe = vibeFor(initialWorldId);
  void soundtrack.load(
    (Object.keys(initialVibe) as StemId[]).sort((a, b) => (initialVibe[b] ?? 0) - (initialVibe[a] ?? 0)),
  );

  const engine = new WorldEngine(viewport, identity.color, {
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
        engine.avatar.yaw,
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
      if (gateExited) tutorial.notifyFlightToggle(flying);
    },
    onCameraViewChange: (firstPerson) => {
      cameraViewLabel.textContent = firstPerson ? 'View: FPS' : 'View: 3rd';
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
      syncPointerUi(engine.avatar.pointerLocked);
    },
    onMovementModeChange: (mode) => {
      physicsModeLabel.textContent = mode === 'platformer' ? 'Physics: Platformer' : 'Physics: Classic';
      try { localStorage.setItem(STORAGE_MOVEMENT_MODE_KEY, mode); } catch { /* storage unavailable */ }
    },
  });

  // Walking physics (G), remembered between reloads.
  try {
    engine.avatar.setMovementMode(parseMovementMode(localStorage.getItem(STORAGE_MOVEMENT_MODE_KEY)));
  } catch { /* storage unavailable */ }

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
      li.className = `player-item${!isMe && p.worldId !== activeWorldId ? ' clickable' : ''}`;
      li.innerHTML = `
        <span class="player-meta">
          <span class="player-swatch" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></span>
          <span class="player-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}</span>
        </span>
        <span class="player-world">${escapeHtml(worldName)}</span>
      `;
      if (!isMe && p.worldId !== activeWorldId) {
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
    const base = window.location.origin + window.location.pathname;

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
        engine.avatar.yaw,
      );
      renderPresenceRoster();
    } catch (err) {
      showToast(`Failed to enter world: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isTransitioning = false;
    }
  }

  async function handlePortalTransition(portal: PortalDefinition, crossed: boolean): Promise<void> {
    if (portal.remoteUrl) {
      const returnUrl = buildShareableWorldUrl(window.location.origin + window.location.pathname, {
        worldId: activeWorldId,
      });
      const dest = buildRemotePortalUrl(portal.remoteUrl, {
        version: 1,
        playerName: identity.name,
        playerColor: identity.color,
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

  // Modal helpers
  function openModal(modal: HTMLElement): void {
    if (!gateExited) return;
    closeAllModals();
    modal.classList.remove('hidden');
    engine.setInputLocked(true);
    syncPointerUi(false);
  }

  function closeAllModals(relockPointer = false): void {
    for (const modal of allModals) modal.classList.add('hidden');
    engine.setInputLocked(!gateExited);
    if (relockPointer && gateExited) {
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
    const shareUrl = buildShareableWorldUrl(window.location.origin + window.location.pathname, {
      worldId: activeWorldId,
    });
    await copyToClipboard(shareUrl);
    showToast(`Copied link to ${activeManifest.name}!`);
  });

  btnWorlds.addEventListener('click', () => {
    renderWorldDirectory();
    openModal(modalWorlds);
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
    net.updateProfile(name, color);
    renderPresenceRoster();
    closeAllModals();
    showToast(`Updated explorer identity to ${name}`);
  });

  // Respawn after a fall, then take the cursor back for mouse-look.
  const respawn = () => {
    if (!engine.hasFallen) return;
    engine.respawn();
    engine.requestPointerLock();
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
    } else if (e.code === 'KeyM') {
      renderWorldDirectory();
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
  const gateZ = ROUTE_LENGTH / 2;
  const feedSoundtrack = () => {
    requestAnimationFrame(feedSoundtrack);
    if (!gateExited) return;
    const feet = engine.avatar.position;
    soundtrack.update({
      roomId: activeWorldId,
      previousRoomId: loopNeighbour(activeWorldId, -1),
      nextRoomId: loopNeighbour(activeWorldId, 1),
      x: feet.x,
      z: feet.z,
      gateZ,
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
    engine.setInputLocked(false);
    engine.requestPointerLock();
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
      Number(engine.avatar.yaw.toFixed(3)),
      Number(engine.avatar.velocityY.toFixed(3)),
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
        sprinting: shiftHeld,
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
