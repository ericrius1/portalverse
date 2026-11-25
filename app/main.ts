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
import {
  buildRemotePortalUrl,
  buildShareableWorldUrl,
  createReturnPortalFromHandoff,
  placeHandoffArrival,
  readRouteFromLocation,
} from '@portalverse/core/portal/handoff';

const STORAGE_PROFILE_KEY = 'portalverse.profile.v1';

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
  const warpOverlay = document.getElementById('warp-overlay')!;
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

  const btnShareLink = document.getElementById('btn-share-link')!;
  const btnWorlds = document.getElementById('btn-worlds')!;
  const btnLinkPortal = document.getElementById('btn-link-portal')!;
  const btnProfile = document.getElementById('btn-profile')!;

  const modalPortal = document.getElementById('modal-portal')!;
  const modalWorlds = document.getElementById('modal-worlds')!;
  const modalProfile = document.getElementById('modal-profile')!;

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

  const engine = new WorldEngine(viewport, identity.color, {
    loadLocalWorld: id => registry.getManifest(id)?.kind === 'local' ? registry.loadWorld(id) : undefined,
    onWorldLoaded: (manifest) => {
      activeManifest = manifest;
      activeWorldId = manifest.id;

      hudWorldName.textContent = manifest.name;
      const authorLabel = manifest.owner ? `Owner: ${manifest.owner}` : manifest.author;
      hudWorldAuthor.textContent = `${authorLabel} · WebGPU`;
      worldAccentDot.style.background = manifest.accentColor;
      worldAccentDot.style.boxShadow = `0 0 14px ${manifest.accentColor}`;

      syncUrlBar();
    },
    onPortalPromoted: (manifest) => {
      net.switchWorld(
        manifest.id,
        [engine.avatar.position.x, engine.avatar.position.y, engine.avatar.position.z],
        engine.avatar.yaw,
      );
      renderPresenceRoster();
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
      void handlePortalTransition(portal, crossed);
    },
    onFlightChange: (flying) => {
      flightStatusLabel.textContent = flying ? 'Flight: On' : 'Flight: Off';
    },
  });

  const net = new MultiplayerClient({
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

    try {
      const worldModule = await registry.loadWorld(worldId);
      await engine.mountWorld(worldModule, {
        spawnId: opts?.spawnId,
        fromPortal: opts?.fromPortal,
        crossed: opts?.crossed,
      });
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

  let gateExited = false;

  // Modal helpers
  function openModal(modal: HTMLElement): void {
    if (!gateExited) return;
    closeAllModals();
    modal.classList.remove('hidden');
    engine.setInputLocked(true);
  }

  function closeAllModals(): void {
    modalPortal.classList.add('hidden');
    modalWorlds.classList.add('hidden');
    modalProfile.classList.add('hidden');
    engine.setInputLocked(!gateExited);
  }

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeAllModals);
  });
  [modalPortal, modalWorlds, modalProfile].forEach((backdrop) => {
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

  // Global keyboard shortcuts (P = Link Portal, M = Rooms, Escape = Close modals)
  window.addEventListener('keydown', (e) => {
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
    }
  });

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
      loadingMedallion.setAttribute('aria-label', `Enter ${activeManifest.name}`);
      loadingPhaseText.textContent = activeManifest.name.toUpperCase();
      loadingMedallion.focus();
      return;
    }

    window.requestAnimationFrame(stepGate);
  };
  window.requestAnimationFrame(stepGate);

  loadingMedallion.addEventListener('click', () => {
    if (gateError) {
      window.location.reload();
      return;
    }
    if (!gateReady || gateExited) return;
    gateExited = true;
    loadingMedallion.disabled = true;
    loadingGate.classList.add('exiting');
    engine.setInputLocked(false);
    window.setTimeout(() => {
      loadingGate.remove();
    }, 900);
  });

  // Boot & preload pipeline behind the loading gate
  try {
    setLoadPhase(15, 'INITIALIZING WEBGPU');
    await engine.init();

    setLoadPhase(35, `LOADING ${activeManifest.name.toUpperCase()}`);
    const startModule = await registry.loadWorld(initialWorldId);
    const spawn = await engine.mountWorld(startModule, {
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

    const localIds = registry.listWorlds().filter(w => w.kind === 'local').map(w => w.id);
    setLoadPhase(68, 'RENDERING PORTAL PREVIEWS');
    await engine.prewarmPortalSnapshots(localIds, (frac) => {
      setLoadPhase(68 + frac * 30, 'RENDERING PORTAL PREVIEWS');
    });

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

  net.connect();
  renderPresenceRoster();

  // Stream local avatar coordinates to multiplayer server at ~20 Hz
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
