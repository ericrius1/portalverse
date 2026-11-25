import * as THREE from 'three/webgpu';
import type { MovementMode } from './movement';
import type {
  AvatarState,
  PlayerView,
  PortalDefinition,
  PortalVisualHandle,
  SpawnPoint,
  WorldManifest,
  WorldModule,
} from '../types';
import {
  GATE_WIDTH,
  RUN_SPEED,
  WARP_RADIUS,
  livePortalSlots,
} from '../portal/roomLayout';
import { RoomInstance } from './RoomInstance';
import { PortalPreviews } from './PortalPreviews';
import { PortalRipplePass } from './PortalRipplePass';
import type { Heading } from './roomWindow';
import {
  AvatarController,
  createStylizedAvatarRig,
  type StylizedAvatarRig,
} from './AvatarController';
import { createArchwayPortal } from './PortalMesh';
import { portalWarp, smoothSpeed, warpSpeedFactor } from './portalWarp';
import {
  canOfferPortalPrompt,
  carryThroughPortal,
  crossingYawDelta,
  beginCrossing,
  resolveTransit,
  viewerSide,
  type CrossingSide,
  type FrameMotion,
} from './portalCrossing';

export interface WorldEngineCallbacks {
  loadLocalWorld?: (id: string) => Promise<WorldModule> | undefined;
  onWorldLoaded?: (manifest: WorldManifest) => void;
  onPortalPromoted?: (manifest: WorldManifest) => void;
  onPortalProximity?: (portal: PortalDefinition | null) => void;
  onPortalEnter?: (portal: PortalDefinition, crossed: boolean) => void;
  onFlightChange?: (flying: boolean) => void;
  onCameraViewChange?: (firstPerson: boolean) => void;
  onPointerLockChange?: (locked: boolean) => void;
  onMovementModeChange?: (mode: MovementMode) => void;
}

interface ActiveTransit {
  handle: PortalVisualHandle;
  sideSign: CrossingSide;
  /** The camera reached the opening first, because the player is backing in. */
  cameraLed?: boolean;
}

interface WalkThroughState {
  handle: PortalVisualHandle;
  sideSign: CrossingSide;
  targetYaw: number;
  dirX: number;
  dirZ: number;
  targetX: number;
  targetZ: number;
  startedAt: number;
}

/** Which way along the room loop a portal takes you. */
const headingThrough = (portal?: PortalDefinition): Heading => (portal?.id === 'entrance' ? -1 : 1);

export class WorldEngine {
  private readonly avatarScene = new THREE.Scene();
  get scene(): THREE.Scene { return this.room?.scene ?? this.avatarScene; }
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGPURenderer;
  readonly avatar: AvatarController;

  private readonly container: HTMLElement;
  private readonly callbacks: WorldEngineCallbacks;
  private room?: RoomInstance;
  private readonly previews?: PortalPreviews;
  private readonly ripplePass: PortalRipplePass;
  private readonly transitRig: StylizedAvatarRig;
  private readonly transitAvatarPos = new THREE.Vector3();
  private mountSequence = 0;
  private readonly dynamicPortalRoot = new THREE.Group();
  /** Debug view of each portal's warp zone: a wireframe sphere and its equator on the floor. */
  private readonly warpZones = new THREE.Group();
  private readonly warpSphereGeometry = new THREE.SphereGeometry(WARP_RADIUS, 32, 16);
  private readonly warpSphereMaterial = new THREE.MeshBasicMaterial({
    color: '#facc15', wireframe: true, transparent: true, opacity: 0.3, depthWrite: false,
  });
  private readonly warpCircleGeometry = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 96 }, (_, i) => {
      const angle = (i / 96) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * WARP_RADIUS, 0, Math.sin(angle) * WARP_RADIUS);
    }),
  );
  private readonly warpCircleMaterial = new THREE.LineBasicMaterial({ color: '#facc15' });

  private currentManifest: WorldManifest | null = null;
  private dynamicPortals: PortalVisualHandle[] = [];
  private transitPortal?: ActiveTransit;
  private walkThrough?: WalkThroughState;
  private readonly previousFeet = new THREE.Vector3();
  private readonly previousCamera = new THREE.Vector3();
  private readonly frameMotion: FrameMotion;
  /** What the active room may read about the player. */
  private readonly playerView: PlayerView;
  private readonly scratchPlayerCenter = new THREE.Vector3();
  private readonly scratchVecA = new THREE.Vector3();
  private readonly transitAvatarState: {
    rig: THREE.Group;
    position: THREE.Vector3;
    yaw: number;
    visible: boolean;
  };
  private currentFramePortals: PortalVisualHandle[] = [];
  private currentFrameDt = 0;
  /** Player's horizontal speed, smoothed so stop-start steps count less than a steady run. */
  private smoothedSpeed = 0;
  private skipNextSpeedSample = true;
  private nearestPortal: PortalVisualHandle | null = null;
  private inputLocked = false;
  private portalCooldownUntil = 0;
  private animFrameId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private running = false;

  constructor(container: HTMLElement, initialAvatarColor: string, callbacks: WorldEngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene.add(this.dynamicPortalRoot);
    this.warpZones.visible = false;
    this.avatarScene.add(this.warpZones);

    this.camera = new THREE.PerspectiveCamera(
      62,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      450,
    );

    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    if (callbacks.loadLocalWorld) this.previews = new PortalPreviews(this.renderer, callbacks.loadLocalWorld);
    this.ripplePass = new PortalRipplePass(this.renderer);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.transitRig = createStylizedAvatarRig(initialAvatarColor);
    this.transitAvatarState = {
      rig: this.transitRig.group,
      position: this.transitAvatarPos,
      yaw: 0,
      visible: true,
    };

    this.avatar = new AvatarController(
      this.scene,
      this.camera,
      this.renderer.domElement,
      initialAvatarColor,
      callbacks.onFlightChange,
      (hexColor) => {
        const col = new THREE.Color(hexColor);
        this.transitRig.bodyMat.color.copy(col);
        this.transitRig.bodyMat.emissive.copy(col);
      },
      callbacks.onCameraViewChange,
      callbacks.onPointerLockChange,
      callbacks.onMovementModeChange,
    );
    this.playerView = { position: this.avatar.position };
    this.frameMotion = {
      previousFeet: this.previousFeet,
      feet: this.avatar.position,
      previousCamera: this.previousCamera,
      camera: this.camera.position,
    };

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
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
    this.avatar.setInputLocked(locked);
  }

  requestPointerLock(): void {
    this.avatar.requestPointerLock();
  }

  exitPointerLock(): void {
    this.avatar.exitPointerLock();
  }

  getCurrentWorldId(): string | null {
    return this.currentManifest?.id ?? null;
  }

  /** Show or hide each portal's warp zone (debug). */
  setWarpZonesVisible(visible: boolean): void {
    this.warpZones.visible = visible;
  }

  syncRemotePlayers(players: AvatarState[], localPlayerId: string): void {
    this.avatar.syncRemotePlayers(players, localPlayerId);
  }

  /**
   * Make `module` the active room. Resolves with the spawn the player arrived at,
   * or undefined when a later mount superseded this one.
   */
  async mountWorld(
    module: WorldModule,
    options?: { spawnId?: string; extraPortals?: PortalDefinition[]; fromPortal?: PortalDefinition; crossed?: boolean },
  ): Promise<SpawnPoint | undefined> {
    const sequence = ++this.mountSequence;
    const source = this.getAllPortals().find(p => p.portal === options?.fromPortal);
    const cached = this.previews?.prepare(module.manifest.id);
    const room = await (cached ?? RoomInstance.mount(module, this.renderer));
    if (sequence !== this.mountSequence) {
      if (!cached) this.disposeRoom(room);
      return undefined;
    }

    const arrival = room.spawn(options?.spawnId);
    let sourceOrigin: THREE.Vector3 | undefined;
    let yawDelta = 0;
    if (source && options?.crossed) {
      sourceOrigin = new THREE.Vector3().fromArray(source.portal.position);
      const side = viewerSide(source, this.camera.position);
      yawDelta = crossingYawDelta(source.portal.yaw ?? 0, side, arrival.yaw);
    }

    this.previews?.take(module.manifest.id);
    this.installRoom(room, arrival, headingThrough(options?.fromPortal), sourceOrigin, yawDelta, options?.extraPortals);
    return arrival;
  }

  /** Wait for the next (exit) and previous (entrance) rooms; the rest of the window loads behind them. */
  async preloadAdjacentRooms(): Promise<void> {
    if (!this.room || !this.previews) return;
    await this.previews.syncPinnedForRoom(this.room);
  }

  /**
   * Refresh the nearby rooms' portal snapshots and warm up the post-processing
   * pass, during the loading gate.
   */
  async warmUpPortals(): Promise<void> {
    if (!this.room || !this.previews) return;
    // Hide the local & remote avatar scene while capturing snapshots so no character
    // appears baked into the initial room's portal preview (e.g. Eric's Room).
    const prevAvatarVisible = this.avatarScene.visible;
    this.avatarScene.visible = false;
    try {
      await this.previews.refreshSnapshots(this.room);
    } finally {
      this.avatarScene.visible = prevAvatarVisible;
    }
    // Pre-allocate the persistent post-processing target and compile both the ripple
    // composite pipeline and active room portal pipelines during the loading gate.
    this.ripplePass.warmUp();
    this.currentFramePortals = this.getAllPortals();
    this.currentFrameDt = 0;
    this.ripplePass.render(this.renderMainPass);
  }

  private installRoom(
    room: RoomInstance,
    arrival: SpawnPoint,
    heading: Heading,
    sourceOrigin?: THREE.Vector3,
    yawDelta = 0,
    extraPortals?: PortalDefinition[],
  ): void {
    const prevRoom = this.room;
    // Keep the room we just left mounted as a preview when it's still in the window or
    // the new room links back to it, so turning around costs no remount.
    const prevId = prevRoom?.module.manifest.id;
    const shouldRetainPrev =
      !!prevId &&
      prevRoom !== room &&
      (!!this.previews?.keeps(room.module.manifest.id, prevId) ||
        room.portals.some(p => !p.portal.remoteUrl && p.portal.targetWorldId === prevId));

    this.swapOutCurrentRoom(shouldRetainPrev);

    this.room = room;
    this.previews?.applySnapshotsToRoom(room);
    room.scene.add(this.avatarScene);
    this.currentManifest = room.module.manifest;
    this.avatar.setWorldCollision(room.platforms, room.terrainHeight);

    if (sourceOrigin) {
      const landing = new THREE.Vector3().fromArray(arrival.position);
      carryThroughPortal(this.avatar.position, sourceOrigin, yawDelta, landing);
      carryThroughPortal(this.camera.position, sourceOrigin, yawDelta, landing);
      this.avatar.yaw += yawDelta;
      this.avatar.turnMomentum(yawDelta);
      this.camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta));
      this.avatar.syncRigTransform(this.elapsed);
      this.skipNextSpeedSample = true;
    } else {
      this.avatar.applySpawn(arrival);
      this.skipNextSpeedSample = true;
    }

    room.activate(portal => this.requestPortalEntry(portal), this.playerView);

    // Move the room window: neighbours load immediately so transitions never stall
    void this.previews?.syncPinnedForRoom(room, heading);

    // Brief portal reentry grace period so players don't immediately re-trigger a portal at spawn
    this.portalCooldownUntil = performance.now() + 900;

    if (extraPortals?.length) {
      this.setDynamicPortals(extraPortals);
    }

    this.callbacks.onWorldLoaded?.(room.module.manifest);
  }

  /**
   * Promote a pre-mounted destination RoomInstance synchronously on the frame the
   * camera crosses the portal plane, so the view never jumps or dips.
   */
  private promotePortalSync(handle: PortalVisualHandle, sideSign: CrossingSide): boolean {
    const portal = handle.portal;
    const room = this.previews?.takeReady(portal.targetWorldId);
    if (!room) return false;

    const arrival = room.spawn(portal.targetSpawnId);
    const sourceOrigin = new THREE.Vector3().fromArray(portal.position);
    const yawDelta = crossingYawDelta(portal.yaw ?? 0, sideSign, arrival.yaw);

    this.mountSequence++;
    this.installRoom(room, arrival, headingThrough(portal), sourceOrigin, yawDelta);
    this.callbacks.onPortalPromoted?.(room.module.manifest);
    return true;
  }

  /**
   * Enter a portal via E key or programmatic trigger. For local passage portals,
   * smoothly walk the character through the circular opening with the camera following.
   */
  private requestPortalEntry(portal: PortalDefinition): void {
    const now = performance.now();
    if (now < this.portalCooldownUntil) return;
    if (portal.remoteUrl) {
      this.triggerPortal(portal, false);
      return;
    }
    const handle = this.getAllPortals().find(p => p.portal === portal);
    if (!handle || !handle.passage) {
      this.triggerPortal(portal, false);
      return;
    }

    // Eagerly pin the destination preview so crossing is synchronous and instant.
    this.previews?.prepare(portal.targetWorldId);

    const sideSign = viewerSide(handle, this.avatar.position);
    const portalYaw = (portal.yaw ?? 0) + (sideSign < 0 ? Math.PI : 0);
    // Forward direction through the portal in world XZ:
    const dirX = -Math.sin(portalYaw);
    const dirZ = -Math.cos(portalYaw);

    this.walkThrough = {
      handle,
      sideSign,
      targetYaw: portalYaw,
      dirX,
      dirZ,
      targetX: portal.position[0] + dirX * 7.2,
      targetZ: portal.position[2] + dirZ * 7.2,
      startedAt: now,
    };
  }

  /** Synchronize dynamically spawned portals using the circular archway style. */
  setDynamicPortals(portals: PortalDefinition[]): void {
    for (const handle of this.dynamicPortals) {
      this.dynamicPortalRoot.remove(handle.group);
      handle.dispose?.();
    }
    this.dynamicPortals = [];

    const slots = livePortalSlots(this.currentManifest);
    let playerPortalsPlaced = 0;
    for (const portal of portals) {
      const isReturnPortal = Boolean(portal.remoteUrl && portal.id.startsWith('return-'));
      if (!isReturnPortal) {
        if (playerPortalsPlaced >= slots) continue;
        playerPortalsPlaced++;
      }
      const handle = createArchwayPortal(portal, { passage: true });
      this.dynamicPortalRoot.add(handle.group);
      this.dynamicPortals.push(handle);
    }
  }

  private getAllPortals(): PortalVisualHandle[] {
    return [...(this.room?.portals ?? []), ...this.dynamicPortals];
  }

  private triggerPortal(portal: PortalDefinition, crossed = false): boolean {
    const now = performance.now();
    if (!this.callbacks.onPortalEnter || now < this.portalCooldownUntil) return false;
    this.portalCooldownUntil = now + 1500;
    this.callbacks.onPortalEnter(portal, crossed);
    return true;
  }

  private swapOutCurrentRoom(retainInPreviewCache: boolean): void {
    this.nearestPortal = null;
    this.transitPortal = undefined;
    this.walkThrough = undefined;
    this.callbacks.onPortalProximity?.(null);

    this.previews?.releaseViews();
    this.avatarScene.removeFromParent();

    if (this.room) {
      const oldRoom = this.room;
      this.room = undefined;
      oldRoom.deactivate();
      if (retainInPreviewCache && this.previews) {
        this.previews.retain(oldRoom.module.manifest.id, oldRoom);
      } else {
        this.disposeRoom(oldRoom);
      }
    }

    for (const handle of this.dynamicPortals) {
      this.dynamicPortalRoot.remove(handle.group);
      handle.dispose?.();
    }
    this.dynamicPortals = [];

    this.avatar.clearRemotePlayers();
  }

  /** Place one warp-zone marker on each portal in the current room. */
  private syncWarpZones(portals: PortalVisualHandle[]): void {
    while (this.warpZones.children.length < portals.length) {
      const zone = new THREE.Group();
      const sphere = new THREE.Mesh(this.warpSphereGeometry, this.warpSphereMaterial);
      const floorCircle = new THREE.LineLoop(this.warpCircleGeometry, this.warpCircleMaterial);
      floorCircle.position.y = 0.03;
      zone.add(sphere, floorCircle);
      this.warpZones.add(zone);
    }
    this.warpZones.children.forEach((zone, i) => {
      const handle = portals[i];
      zone.visible = !!handle;
      if (!handle) return;
      const floorY = handle.portal.position[1];
      zone.position.set(handle.triggerCenter.x, floorY, handle.triggerCenter.z);
      zone.children[0].position.y = handle.triggerCenter.y - floorY;
    });
  }

  /** Dispose a room, including the snapshot materials previews attached to its portals. */
  private disposeRoom(room: RoomInstance): void {
    if (this.previews) this.previews.disposeRoom(room);
    else room.dispose();
  }

  private unmountCurrentWorld(): void {
    this.swapOutCurrentRoom(false);
    this.previews?.clear();
  }

  private readonly renderMainPass = (): void => {
    const insidePortal = this.previews?.render(
      this.currentFramePortals,
      this.camera,
      this.currentFrameDt,
      this.elapsed,
      this.transitAvatarState,
    );
    if (!insidePortal) this.renderer.render(this.scene, this.camera);
  };

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    this.previousFeet.copy(this.avatar.position);
    this.previousCamera.copy(this.camera.position);

    if (this.walkThrough) {
      const wt = this.walkThrough;
      const feetLocal = wt.handle.group.worldToLocal(this.scratchVecA.copy(this.avatar.position));
      const approaching = feetLocal.z * wt.sideSign > 0.2 && Math.abs(feetLocal.x) > 1.4;
      const goalX = approaching ? wt.handle.portal.position[0] : wt.targetX;
      const goalZ = approaching ? wt.handle.portal.position[2] : wt.targetZ;
      const toX = goalX - this.avatar.position.x;
      const toZ = goalZ - this.avatar.position.z;
      const dist = Math.hypot(toX, toZ);
      const speed = Math.max(RUN_SPEED, dist * 1.35);
      if (dist > 0.05) {
        const step = Math.min(dist, speed * dt);
        this.avatar.position.x += (toX / dist) * step;
        this.avatar.position.z += (toZ / dist) * step;
      }
      const floorY = this.avatar.sampleSurfaceHeight(this.avatar.position.x, this.avatar.position.z);
      if (!this.avatar.isFlying) {
        this.avatar.position.y += (floorY - this.avatar.position.y) * Math.min(1, dt * 10);
      }
      const desiredYaw = approaching ? Math.atan2(-toX, -toZ) : wt.targetYaw;
      const dyaw = Math.atan2(
        Math.sin(desiredYaw - this.avatar.yaw),
        Math.cos(desiredYaw - this.avatar.yaw),
      );
      this.avatar.yaw += dyaw * Math.min(1, dt * 8);
      this.avatar.pitch += (-0.12 - this.avatar.pitch) * Math.min(1, dt * 6);
      this.avatar.update(dt, this.elapsed, true);

      if (now - wt.startedAt > 6000) {
        this.walkThrough = undefined;
      }
    } else {
      this.avatar.update(dt, this.elapsed, this.inputLocked);
    }

    // Keep transit avatar proxy animation synced with the live character
    this.transitAvatarPos.copy(this.avatar.position);
    if (this.avatar.isFlying) {
      this.transitAvatarPos.y += Math.sin(this.elapsed * 3.0) * 0.14;
    }

    this.room?.update(dt, this.elapsed);

    let portals = this.getAllPortals();
    let closest: PortalVisualHandle | null = null;
    let closestDist = Infinity;

    const playerCenter = this.scratchPlayerCenter.set(
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

      if (dist < closestDist && canOfferPortalPrompt(handle, this.avatar.position, this.avatar.yaw)) {
        closestDist = dist;
        closest = handle;
      }

      // Detect the character, or the chase camera when backing in, entering a portal opening
      if (!this.inputLocked && !this.transitPortal) {
        const ready = now >= this.portalCooldownUntil && dist < GATE_WIDTH + 2;
        if (handle.passage) {
          const start = beginCrossing(handle, this.frameMotion, this.avatar.firstPerson);
          if (start?.by === 'feet' && ready) {
            if (handle.portal.remoteUrl) {
              // Remote portals hand off to another server as soon as the feet pass through.
              this.triggerPortal(handle.portal, true);
            } else {
              this.transitPortal = { handle, sideSign: start.side };
              this.previews?.prepare(handle.portal.targetWorldId);
            }
          } else if (start?.by === 'camera' && !handle.portal.remoteUrl) {
            // No cooldown: a camera crossing needs real movement through the opening,
            // and backing straight out again must switch straight back.
            this.transitPortal = { handle, sideSign: start.side, cameraLed: true };
            this.previews?.prepare(handle.portal.targetWorldId);
          }
        } else if (ready && dist < handle.triggerRadius) {
          this.triggerPortal(handle.portal, true);
        }
      }
    }

    // Check active 3rd-person portal transit: promote synchronously as soon as the camera crosses.
    if (this.transitPortal) {
      const { handle, sideSign, cameraLed } = this.transitPortal;
      const decision = resolveTransit(handle, sideSign, this.avatar.position, this.camera.position, {
        walkingThrough: !!this.walkThrough,
        firstPerson: this.avatar.firstPerson,
      });

      if (decision === 'cancel') {
        // Player stepped back out before the camera crossed
        this.transitPortal = undefined;
      } else if (decision === 'promote') {
        this.transitPortal = undefined;
        this.walkThrough = undefined;
        const promoted = this.promotePortalSync(handle, sideSign);
        if (promoted && cameraLed) {
          // The camera is in the new room but the feet are still behind the portal we
          // came through. From here that is a crossing back in progress: it completes
          // when the player backs fully in, or switches back if the camera returns.
          const receiving = this.room?.portals.find(p => p.portal.id === handle.portal.targetSpawnId);
          if (receiving) this.transitPortal = { handle: receiving, sideSign: 1 };
        }
        if (promoted) {
          portals = this.getAllPortals();
          this.transitAvatarPos.copy(this.avatar.position);
          if (this.avatar.isFlying) {
            this.transitAvatarPos.y += Math.sin(this.elapsed * 3.0) * 0.14;
          }
          this.room?.update(0, this.elapsed);
          for (const h of portals) h.update?.(0, this.elapsed);
        } else {
          this.triggerPortal(handle.portal, true);
        }
      }
    }

    const promptCandidate =
      !this.avatar.isFlying && closest && closestDist < closest.triggerRadius + 4.2 ? closest : null;
    if (promptCandidate !== this.nearestPortal) {
      this.nearestPortal = promptCandidate;
      this.callbacks.onPortalProximity?.(promptCandidate?.portal ?? null);
    }

    // Smoothed horizontal speed of the feet (skipping the frame a crossing moves them between rooms)
    if (this.skipNextSpeedSample) {
      this.skipNextSpeedSample = false;
    } else if (dt > 1e-4) {
      const instantSpeed = Math.hypot(
        this.avatar.position.x - this.previousFeet.x,
        this.avatar.position.z - this.previousFeet.z,
      ) / dt;
      this.smoothedSpeed = smoothSpeed(this.smoothedSpeed, Math.min(instantSpeed, 30), dt);
    }

    // Warp: strongest at a portal's centre, fading to nothing at its warp circle, plus up to 20% when moving.
    const warp = portalWarp(portals, this.avatar.position) * warpSpeedFactor(this.smoothedSpeed);
    const moveNorm = THREE.MathUtils.clamp(this.smoothedSpeed / RUN_SPEED, 0, 1);
    this.ripplePass.update(dt, this.elapsed, warp, moveNorm);
    if (this.warpZones.visible) this.syncWarpZones(portals);

    this.avatar.updateCameraVisibility();
    this.transitAvatarState.yaw = this.avatar.yaw;
    this.transitAvatarState.visible = !this.avatar.firstPerson;
    this.currentFramePortals = portals;
    this.currentFrameDt = dt;

    // Always render through the persistent post-processing buffer (zero buildup/teardown hitches)
    this.ripplePass.render(this.renderMainPass);
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
    // While flying, E descends and lands (matching Earth repo); fly directly through portals instead.
    if (e.code === 'KeyE' && !this.avatar.isFlying && this.nearestPortal) {
      this.requestPortalEntry(this.nearestPortal.portal);
    }
  };

  dispose(): void {
    this.mountSequence++;
    this.running = false;
    this.walkThrough = undefined;
    this.transitPortal = undefined;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.unmountCurrentWorld();
    this.ripplePass.dispose();
    this.warpSphereGeometry.dispose();
    this.warpSphereMaterial.dispose();
    this.warpCircleGeometry.dispose();
    this.warpCircleMaterial.dispose();
    this.transitRig.dispose();
    this.avatar.dispose();
    this.renderer.dispose();
  }
}
