import * as THREE from 'three/webgpu';
import type {
  AvatarState,
  PortalDefinition,
  PortalVisualHandle,
  SpawnPoint,
  WorldManifest,
  WorldModule,
} from '../types';
import {
  GATE_WIDTH,
  PORTAL_CENTER_Y,
  PORTAL_RADIUS,
  RUN_SPEED,
  livePortalSlots,
} from '../portal/roomLayout';
import { RoomInstance } from './RoomInstance';
import { PortalPreviews } from './PortalPreviews';
import { PortalRipplePass } from './PortalRipplePass';
import {
  AvatarController,
  createStylizedAvatarRig,
  type StylizedAvatarRig,
} from './AvatarController';
import { createArchwayPortal, isOneWay } from './PortalMesh';
import {
  carryThroughPortal,
  crossingYawDelta,
  detectFeetCrossing,
  resolveTransit,
  viewerSide,
  type CrossingSide,
} from './portalCrossing';

const RIPPLE_START_FOV_FRACTION = 0.75;

export interface WorldEngineCallbacks {
  loadLocalWorld?: (id: string) => Promise<WorldModule> | undefined;
  onWorldLoaded?: (manifest: WorldManifest) => void;
  onPortalPromoted?: (manifest: WorldManifest) => void;
  onPortalHover?: (portal: PortalDefinition | null, screenX: number, screenY: number) => void;
  onPortalProximity?: (portal: PortalDefinition | null) => void;
  onPortalEnter?: (portal: PortalDefinition, crossed: boolean) => void;
  onFlightChange?: (flying: boolean) => void;
}

interface ActiveTransit {
  handle: PortalVisualHandle;
  sideSign: CrossingSide;
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
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2(-99, -99);

  private currentManifest: WorldManifest | null = null;
  private dynamicPortals: PortalVisualHandle[] = [];
  private transitPortal?: ActiveTransit;
  private exitedPortalId?: string;
  private walkThrough?: WalkThroughState;
  private readonly previousFeet = new THREE.Vector3();
  private readonly previousCamPos = new THREE.Vector3();
  private readonly scratchPlayerCenter = new THREE.Vector3();
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchVecC = new THREE.Vector3();
  private readonly transitAvatarState: {
    rig: THREE.Group;
    position: THREE.Vector3;
    yaw: number;
    visible: boolean;
  };
  private currentFramePortals: PortalVisualHandle[] = [];
  private currentFrameDt = 0;
  private smoothedCamSpeed = 0;
  private skipNextSpeedSample = true;
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

    this.scene.add(this.dynamicPortalRoot);

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
        (this.transitRig.haloMesh.material as THREE.MeshBasicMaterial).color.copy(col);
      },
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
    this.installRoom(room, arrival, options?.spawnId, sourceOrigin, yawDelta, options?.extraPortals);
    return arrival;
  }

  /** Preload and pin both next (exit) and previous (entrance) neighbor rooms of the active room. */
  async preloadAdjacentRooms(): Promise<void> {
    if (!this.room || !this.previews) return;
    await this.previews.syncPinnedForRoom(this.room);
  }

  /**
   * Capture POV-matched portal snapshots for every local room in the loop so
   * depth-2 portals visible inside neighboring rooms show the real next room
   * and gracefully crossfade into live depth-1 previews upon entering.
   */
  async prewarmPortalSnapshots(
    worldIds: string[],
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    if (!this.room || !this.previews) return;
    // Hide the local & remote avatar scene while capturing snapshots so no character
    // appears baked into the initial room's portal preview (e.g. Eric's Room).
    const prevAvatarVisible = this.avatarScene.visible;
    this.avatarScene.visible = false;
    try {
      await this.previews.prewarmSnapshots(worldIds, this.room, onProgress);
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
    arrivalSpawnId?: string,
    sourceOrigin?: THREE.Vector3,
    yawDelta = 0,
    extraPortals?: PortalDefinition[],
  ): void {
    const prevRoom = this.room;
    // Keep the room we just left mounted as a preview when the new room links back to
    // it, so turning around shows it live and crossing back costs no remount.
    const shouldRetainPrev =
      !!prevRoom &&
      prevRoom !== room &&
      room.portals.some(p => !p.portal.remoteUrl && p.portal.targetWorldId === prevRoom.module.manifest.id);

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
      this.camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta));
      this.avatar.syncRigTransform(this.elapsed);
      this.exitedPortalId = arrivalSpawnId;
      this.skipNextSpeedSample = true;
    } else {
      this.avatar.applySpawn(arrival);
      this.exitedPortalId = undefined;
      this.skipNextSpeedSample = true;
    }

    room.activate(portal => this.requestPortalEntry(portal));

    // Preload next & previous neighbors immediately so transitions never stall
    void this.previews?.syncPinnedForRoom(room);

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
    this.installRoom(room, arrival, portal.targetSpawnId, sourceOrigin, yawDelta);
    this.callbacks.onPortalPromoted?.(room.module.manifest);
    return true;
  }

  /**
   * Enter a portal via click or E key. For local passage portals, smoothly walk the
   * character through the circular opening in 3rd-person with the camera trailing naturally!
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
    for (let i = 0; i < Math.min(slots, portals.length); i++) {
      const handle = createArchwayPortal(portals[i], { passage: true });
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
    this.hoveredPortal = null;
    this.nearestPortal = null;
    this.transitPortal = undefined;
    this.walkThrough = undefined;
    this.callbacks.onPortalHover?.(null, 0, 0);
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

  /** Dispose a room, including the snapshot materials previews attached to its portals. */
  private disposeRoom(room: RoomInstance): void {
    if (this.previews) this.previews.disposeRoom(room);
    else room.dispose();
  }

  private unmountCurrentWorld(): void {
    this.exitedPortalId = undefined;
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

  /**
   * Symmetric raised-cosine bell-curve intensity peaking at 1.0 right on the
   * portal threshold and tapering smoothly to 0 at 75% portal vertical FOV on
   * both entry (approaching) and exit (coming out of the threshold).
   */
  private computeWaveBellIntensity(portals: PortalVisualHandle[]): number {
    const dStart =
      PORTAL_RADIUS /
      (RIPPLE_START_FOV_FRACTION * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)));
    this.camera.getWorldDirection(this.scratchVecC);
    let maxBell = 0;

    for (const handle of portals) {
      if (!handle.passage || handle.portal.remoteUrl) continue;
      const camLocal = handle.group.worldToLocal(this.scratchVecA.copy(this.camera.position));
      const absZ = Math.abs(camLocal.z);
      if (absZ >= dStart) {
        if (handle.portal.id === this.exitedPortalId) {
          this.exitedPortalId = undefined;
        }
        continue;
      }

      const absX = Math.abs(camLocal.x);
      if (absX >= PORTAL_RADIUS + 1.4) continue;
      if (camLocal.y < -0.5 || camLocal.y > PORTAL_CENTER_Y + PORTAL_RADIUS + 1.4) continue;

      const isExiting = handle.portal.id === this.exitedPortalId;
      if (!isExiting) {
        if (isOneWay(handle) && camLocal.z < 0) continue;
        handle.aperture.getWorldPosition(this.scratchVecB);
        this.scratchVecB.sub(this.camera.position);
        const len = this.scratchVecB.length();
        if (len > 0.05 && this.scratchVecC.dot(this.scratchVecB) / len < 0.25) continue;
      }

      const latMask = 1 - THREE.MathUtils.smoothstep(absX, PORTAL_RADIUS * 0.85, PORTAL_RADIUS + 1.4);
      const u = THREE.MathUtils.clamp(absZ / dStart, 0, 1);
      const raisedCos = 0.5 + 0.5 * Math.cos(u * Math.PI);
      const bell = raisedCos * raisedCos * (3 - 2 * raisedCos);
      const contrib = bell * latMask;
      if (contrib > maxBell) maxBell = contrib;
    }

    return maxBell;
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    this.previousFeet.copy(this.avatar.position);

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
    this.transitRig.haloMesh.position.y = 1.82 + Math.sin(this.elapsed * 2.8) * 0.06;

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

      if (dist < closestDist) {
        closestDist = dist;
        closest = handle;
      }

      // Detect the character stepping into a portal opening
      if (!this.inputLocked && !this.transitPortal && now >= this.portalCooldownUntil && dist < GATE_WIDTH + 2) {
        if (handle.passage) {
          const side = detectFeetCrossing(handle, this.previousFeet, this.avatar.position);
          if (side && handle.portal.remoteUrl) {
            // Remote portals hand off to another server as soon as the feet pass through.
            this.triggerPortal(handle.portal, true);
          } else if (side) {
            this.transitPortal = { handle, sideSign: side };
            this.previews?.prepare(handle.portal.targetWorldId);
          }
        } else if (dist < handle.triggerRadius) {
          this.triggerPortal(handle.portal, true);
        }
      }
    }

    // Check active 3rd-person portal transit: promote synchronously as soon as the camera crosses.
    if (this.transitPortal) {
      const { handle, sideSign } = this.transitPortal;
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
        if (promoted) {
          portals = this.getAllPortals();
          this.room?.update(0, this.elapsed);
          for (const h of portals) h.update?.(0, this.elapsed);
        } else {
          this.triggerPortal(handle.portal, true);
        }
      }
    }

    const promptCandidate = closest && closestDist < closest.triggerRadius + 4.2 ? closest : null;
    if (promptCandidate !== this.nearestPortal) {
      this.nearestPortal = promptCandidate;
      this.callbacks.onPortalProximity?.(promptCandidate?.portal ?? null);
    }

    // Hover raycast for clickable portals
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

    // Active room portals always stay at exact 1.0x physical scale (never shrinking as you walk up).
    for (const handle of portals) {
      if (handle.aperture.userData.routeGate) {
        handle.group.scale.setScalar(1);
      }
    }

    // Track smoothed camera speed (ignoring single-frame portal coordinate swaps)
    if (this.skipNextSpeedSample) {
      this.skipNextSpeedSample = false;
    } else if (dt > 1e-4) {
      const instantSpeed = this.camera.position.distanceTo(this.previousCamPos) / dt;
      this.smoothedCamSpeed += (Math.min(instantSpeed, 30) - this.smoothedCamSpeed) * Math.min(1, dt * 10);
    }
    this.previousCamPos.copy(this.camera.position);

    // Continuous organic wave: intensity follows symmetric bell curve around threshold,
    // starting subtly at 75% portal FOV and amplifying smoothly with movement speed.
    const bellIntensity = this.computeWaveBellIntensity(portals);
    const moveNorm = THREE.MathUtils.clamp(this.smoothedCamSpeed / RUN_SPEED, 0, 1);
    const moveAmp = 0.48 + 0.52 * moveNorm;
    this.ripplePass.update(dt, this.elapsed, bellIntensity * moveAmp, moveNorm);

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
    if (e.code === 'KeyE' && this.nearestPortal) {
      this.requestPortalEntry(this.nearestPortal.portal);
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
      this.requestPortalEntry(this.hoveredPortal.portal);
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
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    this.unmountCurrentWorld();
    this.ripplePass.dispose();
    this.transitRig.dispose();
    this.avatar.dispose();
    this.renderer.dispose();
  }
}
