import * as THREE from 'three/webgpu';
import type {
  AvatarState,
  HubStyle,
  PortalDefinition,
  PortalVisualHandle,
  WorldManifest,
  WorldModule,
} from '../types';
import { GATE_HEIGHT, GATE_WIDTH, livePortalSlots } from '../portal/roomLayout';
import { RoomInstance } from './RoomInstance';
import { PortalPreviews } from './PortalPreviews';
import { AvatarController } from './AvatarController';
import {
  createArchwayPortal,
  createBloomingFlowerPortal,
  createMagicFountainPortal,
} from './PortalMesh';

export interface WorldEngineCallbacks {
  loadLocalWorld?: (id: string) => Promise<WorldModule> | undefined;
  onWorldLoaded?: (manifest: WorldManifest, hubStyle: HubStyle) => void;
  onPortalHover?: (portal: PortalDefinition | null, screenX: number, screenY: number) => void;
  onPortalProximity?: (portal: PortalDefinition | null) => void;
  onPortalEnter?: (portal: PortalDefinition, crossed: boolean) => void;
  onFlightChange?: (flying: boolean) => void;
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
  private mountSequence = 0;
  private readonly dynamicPortalRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2(-99, -99);

  private currentManifest: WorldManifest | null = null;
  private currentHubStyle: HubStyle = 'fountains';
  private dynamicPortals: PortalVisualHandle[] = [];
  private approach?: { start: number; from: THREE.Vector3; to: THREE.Vector3; look: THREE.Quaternion;
    heading: THREE.Quaternion; finish: () => void };
  private readonly previousFeet = new THREE.Vector3();
  private hoveredPortal: PortalVisualHandle | null = null;
  private nearestPortal: PortalVisualHandle | null = null;
  private pointerScreenX = 0;
  private pointerScreenY = 0;
  private inputLocked = false;
  private portalCooldownUntil = 0;
  private arrivedAt = -Infinity;
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
    options?: { spawnId?: string; hubStyle?: HubStyle; extraPortals?: PortalDefinition[]; fromPortal?: PortalDefinition; crossed?: boolean },
  ): Promise<void> {
    const sequence = ++this.mountSequence;
    const style = options?.hubStyle ?? this.currentHubStyle;
    const source = this.getAllPortals().find(p => p.portal === options?.fromPortal);
    const cached = this.previews?.prepare(module.manifest.id, style);
    const room = await (cached ?? RoomInstance.mount(module, this.renderer, style));
    if (sequence !== this.mountSequence) {
      if (!cached) room.dispose();
      return;
    }
    const arrival = room.spawn(options?.spawnId);
    let sourceOrigin: THREE.Vector3 | undefined;
    let yawDelta = 0;
    if (source) {
      sourceOrigin = source.aperture.getWorldPosition(new THREE.Vector3());
      sourceOrigin.y = source.portal.position[1];
      let sourceYaw = source.portal.yaw ?? 0;
      if (!options?.crossed && source.aperture.worldToLocal(this.camera.position.clone()).z < 0) sourceYaw += Math.PI;
      yawDelta = arrival.yaw - sourceYaw;
      if (!options?.crossed) await this.approachPainting(sourceOrigin, sourceYaw);
    }
    if (sequence !== this.mountSequence) {
      if (!cached) room.dispose();
      return;
    }
    this.previews?.take(module.manifest.id, style);
    this.unmountCurrentWorld();
    this.room = room;
    room.scene.add(this.avatarScene);
    this.currentManifest = module.manifest;
    this.currentHubStyle = style;
    this.avatar.setWorldCollision(room.platforms, room.terrainHeight);
    if (sourceOrigin) {
      const axis = new THREE.Vector3(0, 1, 0);
      const landing = new THREE.Vector3().fromArray(arrival.position);
      for (const point of [this.avatar.position, this.camera.position]) {
        point.sub(sourceOrigin).applyAxisAngle(axis, yawDelta).add(landing);
      }
      this.arrivedAt = performance.now();
      this.avatar.yaw += yawDelta;
      this.camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, yawDelta));
    } else {
      this.avatar.applySpawn(arrival);
    }
    room.activate(portal => this.triggerPortal(portal));

    // Brief portal reentry grace period so players don't immediately re-trigger a portal at spawn
    this.portalCooldownUntil = performance.now() + 1800;

    if (options?.extraPortals?.length) {
      this.setDynamicPortals(options.extraPortals);
    }

    this.callbacks.onWorldLoaded?.(module.manifest, this.currentHubStyle);
  }

  private approachPainting(origin: THREE.Vector3, yaw: number): Promise<void> {
    const to = origin.clone();
    to.y += 1.65;
    const heading = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    return new Promise(resolve => {
      this.approach = { start: performance.now(), from: this.camera.position.clone(), to,
        look: this.camera.quaternion.clone(), heading, finish: () => {
          this.avatar.position.copy(origin);
          this.avatar.yaw = yaw;
          this.avatar.pitch = 0;
          resolve();
        } };
    });
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
    const slots = livePortalSlots(this.currentManifest);
    for (let i = 0; i < Math.min(slots, portals.length); i++) {
      const p = portals[i];
      let handle: PortalVisualHandle;
      if (isHub && this.currentHubStyle === 'fountains') {
        handle = createMagicFountainPortal(
          { ...p, position: [p.position[0], 0, p.position[2]] },
          { plumeHeight: 13.5, phase: i * 1.3 },
        );
      } else if (isHub && this.currentHubStyle === 'meadow') {
        const y = this.room?.terrainHeight ? this.room.terrainHeight(p.position[0], p.position[2]) : p.position[1];
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
    return [...(this.room?.portals ?? []), ...this.dynamicPortals];
  }

  private triggerPortal(portal: PortalDefinition, crossed = false): boolean {
    const now = performance.now();
    if (!this.callbacks.onPortalEnter || now < this.portalCooldownUntil) return false;
    this.portalCooldownUntil = now + 2000;
    this.callbacks.onPortalEnter(portal, crossed);
    return true;
  }

  private unmountCurrentWorld(): void {
    this.hoveredPortal = null;
    this.nearestPortal = null;
    this.callbacks.onPortalHover?.(null, 0, 0);
    this.callbacks.onPortalProximity?.(null);

    this.previews?.clear();
    this.avatarScene.removeFromParent();
    this.room?.dispose();
    this.room = undefined;

    for (const handle of this.dynamicPortals) {
      this.dynamicPortalRoot.remove(handle.group);
      handle.dispose?.();
    }
    this.dynamicPortals = [];

    this.avatar.clearRemotePlayers();
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    this.animFrameId = requestAnimationFrame(this.loop);

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    this.previousFeet.copy(this.avatar.position);
    this.avatar.update(dt, this.elapsed, this.inputLocked || !!this.approach);
    if (this.approach) {
      const a = this.approach;
      const t = Math.min(1, (now - a.start) / 720);
      const ease = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(a.from, a.to, ease);
      this.camera.quaternion.slerpQuaternions(a.look, a.heading, ease);
      if (t === 1) {
        this.approach = undefined;
        a.finish();
        return; // Present the promoted destination on the next frame.
      }
    }

    this.room?.update(dt, this.elapsed);

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
      if (!this.inputLocked && !this.approach && dist < GATE_WIDTH) {
        if (handle.passage) {
          const old = handle.group.worldToLocal(this.previousFeet.clone());
          const feet = handle.group.worldToLocal(this.avatar.position.clone());
          if (old.z > 0 && feet.z <= 0 && Math.abs(feet.x) < GATE_WIDTH / 2 && feet.y + 1.2 < GATE_HEIGHT && feet.y >= -0.25) {
            if (this.triggerPortal(handle.portal, true)) {
              // The chase rig already updated for this tick. Carry the eye through
              // the plane and leave the last good frame up until promotion.
              if (!this.avatar.firstPerson && Math.cos(this.avatar.yaw - (handle.portal.yaw ?? 0)) > 0.5) {
                this.blendToEye(1);
              }
              return;
            }
          }
        } else if (dist < handle.triggerRadius) {
          this.triggerPortal(handle.portal);
        }
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

    // Bring the chase camera up to the glass with the runner so the opening
    // fills the view at the instant the feet cross the plane.
    if (!this.avatar.firstPerson && !this.approach && closest?.passage && closestDist < 6) {
      const feet = closest.group.worldToLocal(this.avatar.position.clone());
      const facing = Math.cos(this.avatar.yaw - (closest.portal.yaw ?? 0));
      if (feet.z >= 0 && Math.abs(feet.x) < GATE_WIDTH / 2 && facing > 0.5) {
        this.blendToEye(1 - THREE.MathUtils.smoothstep(feet.z, 0, 5));
      }
    }
    if (!this.avatar.firstPerson && now - this.arrivedAt < 450) {
      this.blendToEye(1 - THREE.MathUtils.smoothstep(now - this.arrivedAt, 0, 450));
    }
    this.avatar.updateCameraVisibility();
    const insidePortal = this.previews?.render(portals, this.camera, this.currentHubStyle, dt, this.elapsed);
    if (!insidePortal) this.renderer.render(this.scene, this.camera);
  };

  private blendToEye(weight: number): void {
    const eye = this.avatar.position.clone();
    eye.y += 1.65;
    this.camera.position.lerp(eye, weight);
    const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.avatar.pitch, this.avatar.yaw, 0, 'YXZ'));
    this.camera.quaternion.slerp(facing, weight);
  }

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
    this.mountSequence++;
    this.running = false;
    this.approach?.finish();
    this.approach = undefined;
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
