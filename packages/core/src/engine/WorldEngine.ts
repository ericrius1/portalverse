import * as THREE from 'three/webgpu';
import type {
  AvatarState,
  HubStyle,
  PlatformCollider,
  PortalDefinition,
  PortalVisualHandle,
  SpawnPoint,
  WorldContext,
  WorldManifest,
  WorldModule,
} from '../types';
import { AvatarController } from './AvatarController';
import {
  createArchwayPortal,
  createBloomingFlowerPortal,
  createMagicFountainPortal,
} from './PortalMesh';

export interface WorldEngineCallbacks {
  onWorldLoaded?: (manifest: WorldManifest, hubStyle: HubStyle) => void;
  onPortalHover?: (portal: PortalDefinition | null, screenX: number, screenY: number) => void;
  onPortalProximity?: (portal: PortalDefinition | null) => void;
  onPortalEnter?: (portal: PortalDefinition) => void;
  onFlightChange?: (flying: boolean) => void;
}

export class WorldEngine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGPURenderer;
  readonly avatar: AvatarController;

  private readonly container: HTMLElement;
  private readonly callbacks: WorldEngineCallbacks;
  private readonly worldRoot = new THREE.Group();
  private readonly dynamicPortalRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2(-99, -99);

  private currentManifest: WorldManifest | null = null;
  private currentHubStyle: HubStyle = 'fountains';
  private staticPortals: PortalVisualHandle[] = [];
  private dynamicPortals: PortalVisualHandle[] = [];
  private updateHooks: Array<(dt: number, elapsed: number) => void> = [];
  private disposeHooks: Array<() => void> = [];
  private platforms: PlatformCollider[] = [];
  private terrainHeightFn: ((x: number, z: number) => number) | null = null;
  private spawnOverride: SpawnPoint | null = null;

  private hoveredPortal: PortalVisualHandle | null = null;
  private nearestPortal: PortalVisualHandle | null = null;
  private pointerScreenX = 0;
  private pointerScreenY = 0;
  private inputLocked = false;
  private portalCooldownUntil = 0;
  private animFrameId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private running = false;

  constructor(container: HTMLElement, initialAvatarColor: string, callbacks: WorldEngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.scene.add(this.worldRoot);
    this.scene.add(this.dynamicPortalRoot);

    this.camera = new THREE.PerspectiveCamera(
      62,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      450,
    );

    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.avatar = new AvatarController(
      this.scene,
      this.camera,
      this.renderer.domElement,
      initialAvatarColor,
      callbacks.onFlightChange,
    );

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('click', this.handleClick);
  }

  /** Must be awaited before rendering any frame (Three.js WebGPURenderer requirement). */
  async init(): Promise<void> {
    await this.renderer.init();
    this.running = true;
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
  }

  getCurrentWorldId(): string | null {
    return this.currentManifest?.id ?? null;
  }

  getCurrentHubStyle(): HubStyle {
    return this.currentHubStyle;
  }

  syncRemotePlayers(players: AvatarState[], localPlayerId: string): void {
    this.avatar.syncRemotePlayers(players, localPlayerId);
  }

  async mountWorld(
    module: WorldModule,
    options?: { spawnId?: string; hubStyle?: HubStyle; extraPortals?: PortalDefinition[] },
  ): Promise<void> {
    this.unmountCurrentWorld();

    this.currentManifest = module.manifest;
    if (options?.hubStyle) {
      this.currentHubStyle = options.hubStyle;
    }

    this.spawnOverride = null;
    this.platforms = [];
    this.terrainHeightFn = null;

    const worldSceneGroup = new THREE.Group();
    this.worldRoot.add(worldSceneGroup);

    const ctx: WorldContext = {
      scene: this.scene,
      renderer: this.renderer,
      hubStyle: this.currentHubStyle,
      addPortal: (portal) => {
        const handle = createArchwayPortal(portal);
        this.worldRoot.add(handle.group);
        this.staticPortals.push(handle);
        return handle;
      },
      registerCustomPortal: (handle) => {
        this.worldRoot.add(handle.group);
        this.staticPortals.push(handle);
      },
      onUpdate: (fn) => {
        this.updateHooks.push(fn);
      },
      onDispose: (fn) => {
        this.disposeHooks.push(fn);
      },
      addPlatform: (bounds) => {
        this.platforms.push(bounds);
      },
      setTerrainHeight: (fn) => {
        this.terrainHeightFn = fn;
      },
      configureSpawn: (spawn) => {
        this.spawnOverride = spawn;
      },
      enterPortal: (portal) => {
        this.triggerPortal(portal);
      },
    };

    // Mount world module (adds lighting, terrain, geometry, custom portals)
    await module.mount(ctx);

    this.avatar.setWorldCollision(this.platforms, this.terrainHeightFn);

    // Choose spawn: explicit non-default named spawn -> world mount override -> manifest default
    const requestedSpawn =
      options?.spawnId && options.spawnId !== 'default' ? module.manifest.spawns[options.spawnId] : undefined;
    const spawn: SpawnPoint =
      requestedSpawn ??
      this.spawnOverride ??
      module.manifest.spawns.default ?? { position: [0, 0, 10], yaw: 0 };

    this.avatar.applySpawn(spawn);

    // Brief portal reentry grace period so players don't immediately re-trigger a portal at spawn
    this.portalCooldownUntil = performance.now() + 1800;

    if (options?.extraPortals?.length) {
      this.setDynamicPortals(options.extraPortals);
    }

    this.callbacks.onWorldLoaded?.(module.manifest, this.currentHubStyle);
  }

  /**
   * Synchronize dynamically spawned portals (e.g. from the "+ Link Portal" dialog or remote peers).
   * Adapts visual style to match the active hub theme (magic fountain / blooming flower / archway).
   */
  setDynamicPortals(portals: PortalDefinition[]): void {
    for (const handle of this.dynamicPortals) {
      this.dynamicPortalRoot.remove(handle.group);
      handle.dispose?.();
    }
    this.dynamicPortals = [];

    const isHub = this.currentManifest?.id === 'hub';
    for (let i = 0; i < portals.length; i++) {
      const p = portals[i];
      let handle: PortalVisualHandle;
      if (isHub && this.currentHubStyle === 'fountains') {
        handle = createMagicFountainPortal(
          { ...p, position: [p.position[0], 0, p.position[2]] },
          { plumeHeight: 13.5, phase: i * 1.3 },
        );
      } else if (isHub && this.currentHubStyle === 'meadow') {
        const y = this.terrainHeightFn ? this.terrainHeightFn(p.position[0], p.position[2]) : p.position[1];
        handle = createBloomingFlowerPortal(
          { ...p, position: [p.position[0], y, p.position[2]] },
          { stemHeight: 3.4, phase: i * 1.1 },
        );
      } else {
        handle = createArchwayPortal(p);
      }
      this.dynamicPortalRoot.add(handle.group);
      this.dynamicPortals.push(handle);
    }
  }

  private getAllPortals(): PortalVisualHandle[] {
    return [...this.staticPortals, ...this.dynamicPortals];
  }

  private triggerPortal(portal: PortalDefinition): void {
    const now = performance.now();
    if (now < this.portalCooldownUntil) return;
    this.portalCooldownUntil = now + 2000;
    this.callbacks.onPortalEnter?.(portal);
  }

  private unmountCurrentWorld(): void {
    this.hoveredPortal = null;
    this.nearestPortal = null;
    this.callbacks.onPortalHover?.(null, 0, 0);
    this.callbacks.onPortalProximity?.(null);

    for (const fn of this.disposeHooks) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors on rapid world switches
      }
    }
    this.disposeHooks = [];
    this.updateHooks = [];

    for (const handle of this.staticPortals) {
      handle.dispose?.();
    }
    this.staticPortals = [];

    for (const handle of this.dynamicPortals) {
      this.dynamicPortalRoot.remove(handle.group);
      handle.dispose?.();
    }
    this.dynamicPortals = [];

    // Clear all children attached to worldRoot & scene lighting added directly to scene
    while (this.worldRoot.children.length > 0) {
      this.worldRoot.remove(this.worldRoot.children[0]);
    }
    this.scene.fog = null;
    this.scene.background = null;
    this.avatar.clearRemotePlayers();
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    this.avatar.update(dt, this.elapsed, this.inputLocked);

    for (const fn of this.updateHooks) {
      fn(dt, this.elapsed);
    }

    const portals = this.getAllPortals();
    let closest: PortalVisualHandle | null = null;
    let closestDist = Infinity;

    const playerCenter = new THREE.Vector3(
      this.avatar.position.x,
      this.avatar.position.y + 1.2,
      this.avatar.position.z,
    );

    for (const handle of portals) {
      let dist: number;
      if (handle.triggerYRange) {
        const horizDist = Math.hypot(
          playerCenter.x - handle.triggerCenter.x,
          playerCenter.z - handle.triggerCenter.z,
        );
        const [minY, maxY] = handle.triggerYRange;
        const vertExcess =
          playerCenter.y < minY ? minY - playerCenter.y : playerCenter.y > maxY ? playerCenter.y - maxY : 0;
        dist = Math.hypot(horizDist, vertExcess);
      } else {
        dist = playerCenter.distanceTo(handle.triggerCenter);
      }
      const prox01 = THREE.MathUtils.clamp(1 - (dist - handle.triggerRadius) / 9.0, 0, 1);
      handle.setProximity?.(prox01);
      handle.update?.(dt, this.elapsed);

      if (dist < closestDist) {
        closestDist = dist;
        closest = handle;
      }

      // Walk or dive directly into a portal to enter automatically!
      if (!this.inputLocked && dist < handle.triggerRadius) {
        this.triggerPortal(handle.portal);
      }
    }

    const promptCandidate = closest && closestDist < closest.triggerRadius + 4.2 ? closest : null;
    if (promptCandidate !== this.nearestPortal) {
      this.nearestPortal = promptCandidate;
      this.callbacks.onPortalProximity?.(promptCandidate?.portal ?? null);
    }

    // Hover raycast for clickable portals (magic fountains, blooming flowers, arches)
    if (!this.inputLocked && portals.length > 0) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      let hitHandle: PortalVisualHandle | null = null;
      let hitDistance = Infinity;

      for (const handle of portals) {
        const hits = this.raycaster.intersectObjects(handle.hitTargets, true);
        if (hits.length > 0 && hits[0].distance < hitDistance) {
          hitDistance = hits[0].distance;
          hitHandle = handle;
        }
      }

      if (hitHandle !== this.hoveredPortal) {
        this.hoveredPortal?.setHovered?.(false);
        this.hoveredPortal = hitHandle;
        this.hoveredPortal?.setHovered?.(true);
        this.renderer.domElement.style.cursor = hitHandle ? 'pointer' : 'grab';
      }
      this.callbacks.onPortalHover?.(hitHandle?.portal ?? null, this.pointerScreenX, this.pointerScreenY);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private readonly handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (this.inputLocked) return;
    if (e.code === 'KeyE' && this.nearestPortal) {
      this.triggerPortal(this.nearestPortal.portal);
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointerScreenX = e.clientX;
    this.pointerScreenY = e.clientY;
  };

  private readonly handleClick = (): void => {
    if (this.inputLocked) return;
    if (!this.avatar.wasLastPointerClick()) return;
    if (this.hoveredPortal) {
      this.triggerPortal(this.hoveredPortal.portal);
    }
  };

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    this.unmountCurrentWorld();
    this.avatar.dispose();
    this.renderer.dispose();
  }
}
