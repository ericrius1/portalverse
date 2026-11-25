import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  cameraProjectionMatrix,
  clamp,
  dot,
  float,
  max,
  mix,
  positionLocal,
  positionView,
  screenCoordinate,
  texture,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import type { PortalDefinition, PortalVisualHandle, SpawnPoint, WorldModule } from '../types';
import {
  PORTAL_CENTER_Y,
  PORTAL_LENS_REF_DIST,
  PORTAL_RADIUS,
  ROUTE_LENGTH,
  effectivePortalDistance,
  farPortalScaleByDistance,
} from '../portal/roomLayout';
import { RoomInstance } from './RoomInstance';
import { isOneWay } from './PortalMesh';
import { createSceneTarget } from './sceneTarget';

type Aperture = PortalVisualHandle['aperture'];
type LocalLoader = (worldId: string) => Promise<WorldModule> | undefined;

export interface TransitAvatarState {
  rig: THREE.Group;
  position: THREE.Vector3;
  yaw: number;
  visible: boolean;
}

interface Destination {
  ready: Promise<RoomInstance>;
  room?: RoomInstance;
  lastSeen: number;
  pinned?: boolean;
  retryAfter?: number;
}

interface PortalSnapshot {
  target: THREE.RenderTarget;
  radius: number;
  refDistance: number;
}

/**
 * A pooled live portal window. Its target matches the drawing buffer, and each
 * frame renders only the portal's on-screen rectangle into the top-left corner at
 * one texel per screen pixel, so the view stays sharp and never reallocates.
 */
interface WindowViewSlot {
  oneWay: boolean;
  target: THREE.RenderTarget;
  material: THREE.MeshBasicNodeMaterial;
  /** On-screen rectangle (x, y, width, height) in physical pixels from the top left. */
  pixels: THREE.Vector4;
  /** Target size in texels, used to map screen pixels to texture coordinates. */
  targetSize: { value: THREE.Vector2 };
  liveBlend: { value: number };
  hasSnap: { value: number };
  lens: SnapshotLens;
  snapTexNode: ReturnType<typeof texture>;
}

interface WindowView {
  slot: WindowViewSlot;
  fallback: THREE.Material;
  blendProgress: number;
}

const SNAPSHOT_SIZE = 512;
const SNAPSHOT_RADIUS = 6.2;
const SNAPSHOT_REF_DISTANCE = PORTAL_LENS_REF_DIST;
const MAX_HOT_ROOMS = 6;
const LIVE_FADE_DURATION_S = 0.55;

const up = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();
const origin = new THREE.Vector3();
const plane = new THREE.Plane();
const normal = new THREE.Vector3();
const clip = new THREE.Vector4();
const farCorner = new THREE.Vector4();
const corner = new THREE.Vector3();
const crop = new THREE.Matrix4();
const lensRel = new THREE.Vector3();
const lensSpawnPos = new THREE.Vector3();
const lensDestNormal = new THREE.Vector3();
const lensProjCam = new THREE.PerspectiveCamera();
const lensMatDestToPortal = new THREE.Matrix4();
const lensMatScaleZ = new THREE.Matrix4();
const lensMatPortalToSource = new THREE.Matrix4();
const lensMatRot = new THREE.Matrix4();
const lensMatTrans = new THREE.Matrix4();
const lensMatVp = new THREE.Matrix4();

const proxyLocal = new THREE.Vector3();
const proxyOrigin = new THREE.Vector3();
const proxyNormal = new THREE.Vector3();
const proxyPlane = new THREE.Plane();
const proxyTurn = new THREE.Quaternion();
const proxyPos = new THREE.Vector3();

function snapshotKey(worldId: string, spawnId?: string): string {
  const normalized = spawnId === 'exit' ? 'exit' : 'entrance';
  return `${worldId}:${normalized}`;
}

/**
 * Texture coordinates into a portal snapshot with POV parallax: the snapshot slides
 * against the opening as the viewer moves, like looking through a window. Three.js
 * samples render targets top-down in both backends, so v grows downward.
 */
function createSnapshotLens(span: number) {
  const center = uniform(new THREE.Vector3());
  const right = uniform(new THREE.Vector3(1, 0, 0));
  const normal = uniform(new THREE.Vector3(0, 0, 1));
  const spanNode = uniform(span);
  const relCam = cameraPosition.sub(center);
  const cx = dot(relCam, right);
  const cy = relCam.y;
  const cz = max(abs(dot(relCam, normal)), float(1.0));
  const viewShiftX = clamp(cx.div(cz), float(-0.45), float(0.45)).mul(float(2.2));
  const viewShiftY = clamp(cy.div(cz), float(-0.35), float(0.35)).mul(float(1.6));
  const snapU = clamp(float(0.5).add(positionLocal.x.sub(viewShiftX).div(spanNode)), float(0.01), float(0.99));
  const snapV = clamp(float(0.5).sub(positionLocal.y.sub(viewShiftY).div(spanNode)), float(0.01), float(0.99));
  return { center, right, normal, span: spanNode, uv: vec2(snapU, snapV) };
}

type SnapshotLens = ReturnType<typeof createSnapshotLens>;

/** Point a snapshot lens at an aperture's current world placement. */
function aimSnapshotLens(lens: SnapshotLens, aperture: Aperture): void {
  aperture.updateWorldMatrix(true, false);
  aperture.getWorldPosition(lens.center.value);
  lens.right.value.set(1, 0, 0).transformDirection(aperture.matrixWorld).normalize();
  lens.normal.value.set(0, 0, 1).transformDirection(aperture.matrixWorld).normalize();
}

/** Build a POV-aware parallax TSL texture lookup for a cached portal snapshot. */
function buildSnapshotColorNode(snapshot: PortalSnapshot, aperture: Aperture) {
  const lens = createSnapshotLens(snapshot.radius * 2.0);
  aimSnapshotLens(lens, aperture);
  return texture(snapshot.target.texture, lens.uv);
}

/** Visible aperture bounds in physical pixels, measured from the top left. */
export function portalPixels(aperture: Aperture, viewer: THREE.PerspectiveCamera, size: THREE.Vector2, out: THREE.Vector4) {
  if (!aperture.geometry.boundingBox) aperture.geometry.computeBoundingBox();
  const { min, max: maxB } = aperture.geometry.boundingBox!;
  let left = size.x, top = size.y, right = 0, bottom = 0;
  for (const x of [min.x, maxB.x]) {
    for (const y of [min.y, maxB.y]) {
      corner.set(x, y, min.z).applyMatrix4(aperture.matrixWorld).applyMatrix4(viewer.matrixWorldInverse);
      // Corners behind the eye cannot conservatively bound the visible polygon.
      if (corner.z >= -viewer.near) return out.set(0, 0, size.x, size.y);
      corner.applyMatrix4(viewer.projectionMatrix);
      const px = (1 + corner.x) * size.x / 2;
      const py = (1 - corner.y) * size.y / 2;
      left = Math.min(left, px);
      right = Math.max(right, px);
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
    }
  }
  // Round outward to whole pixels so the live view covers every pixel of the opening.
  left = Math.max(0, Math.floor(left));
  top = Math.max(0, Math.floor(top));
  right = Math.min(size.x, Math.ceil(right));
  bottom = Math.min(size.y, Math.ceil(bottom));
  return out.set(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/**
 * Transport the viewer through the doorway, preserving the original screen pixel grid
 * on the aperture plane while smoothly widening the far-distance portal lens (d > 12m)
 * so the live preview matches the depth-2 snapshot FOV with zero pop-in upon entry.
 */
export function framePortal(camera: THREE.PerspectiveCamera, viewer: THREE.PerspectiveCamera,
  aperture: Aperture, spawn: SpawnPoint, sourceFloor: number, sourceYaw: number,
  size: THREE.Vector2, pixels: THREE.Vector4): void {
  aperture.getWorldPosition(origin);
  normal.set(0, 0, 1).transformDirection(aperture.matrixWorld);
  plane.setFromNormalAndCoplanarPoint(normal, origin);
  const distance = plane.distanceToPoint(viewer.position);
  const absDist = Math.abs(distance);
  const effDist = effectivePortalDistance(absDist);
  const ratio = absDist > 1e-4 ? effDist / absDist : 1;

  const flip = distance < 0 ? Math.PI : 0;
  const sourceYawEff = sourceYaw + flip;
  turn.setFromAxisAngle(up, spawn.yaw - sourceYawEff);

  origin.y = sourceFloor;
  lensSpawnPos.fromArray(spawn.position);

  // Pull the virtual camera closer along the portal normal when far away (ratio < 1)
  // while keeping aperture-plane points fixed to their exact screen pixels.
  lensRel.copy(viewer.position).sub(origin);
  if (ratio < 0.9999) {
    lensRel.applyAxisAngle(up, -sourceYawEff);
    lensRel.z *= ratio;
    lensRel.applyAxisAngle(up, spawn.yaw);
    camera.position.copy(lensRel).add(lensSpawnPos);
  } else {
    camera.position.copy(lensRel).applyQuaternion(turn).add(lensSpawnPos);
  }

  camera.quaternion.copy(turn).multiply(viewer.quaternion);
  camera.coordinateSystem = viewer.coordinateSystem;
  camera.near = viewer.near;
  camera.far = viewer.far / Math.max(0.05, ratio);
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  const sx = size.x / pixels.z, sy = size.y / pixels.w;
  crop.makeScale(sx, sy, 1);
  crop.setPosition(sx - 1 - 2 * pixels.x / pixels.z, 1 - sy + 2 * pixels.y / pixels.w, 0);

  if (ratio < 0.9999) {
    lensProjCam.fov = viewer.fov;
    lensProjCam.aspect = viewer.aspect;
    lensProjCam.near = viewer.near;
    lensProjCam.far = camera.far;
    lensProjCam.coordinateSystem = viewer.coordinateSystem;
    lensProjCam.updateProjectionMatrix();

    // M_destToPortal = R(-spawn.yaw) * T(-spawn.position)
    lensMatRot.makeRotationY(-spawn.yaw);
    lensMatTrans.makeTranslation(-lensSpawnPos.x, -lensSpawnPos.y, -lensSpawnPos.z);
    lensMatDestToPortal.multiplyMatrices(lensMatRot, lensMatTrans);

    // Portal-local Z stretch: preserves z = 0 aperture pixels while widening depth FOV by 1/ratio
    lensMatScaleZ.makeScale(1, 1, 1 / ratio);

    // M_portalToSource = T(origin) * R(sourceYawEff)
    lensMatTrans.makeTranslation(origin.x, origin.y, origin.z);
    lensMatRot.makeRotationY(sourceYawEff);
    lensMatPortalToSource.multiplyMatrices(lensMatTrans, lensMatRot);

    lensMatVp
      .multiplyMatrices(crop, lensProjCam.projectionMatrix)
      .multiply(viewer.matrixWorldInverse)
      .multiply(lensMatPortalToSource)
      .multiply(lensMatScaleZ)
      .multiply(lensMatDestToPortal);

    camera.projectionMatrix.multiplyMatrices(lensMatVp, camera.matrixWorld);
  } else {
    camera.projectionMatrix.multiplyMatrices(crop, viewer.projectionMatrix);
  }
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  // Clip geometry on the viewer's side of the destination threshold. Only
  // change depth; x/y must stay registered with the main scene on every frame.
  if (effDist <= viewer.near) return;
  if (ratio < 0.9999) {
    lensDestNormal.set(-Math.sin(spawn.yaw), 0, -Math.cos(spawn.yaw));
    plane.setFromNormalAndCoplanarPoint(lensDestNormal, lensSpawnPos);
    plane.applyMatrix4(camera.matrixWorldInverse);
  } else {
    if (distance > 0) plane.negate();
    plane.applyMatrix4(viewer.matrixWorldInverse);
  }
  clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  farCorner.set(Math.sign(clip.x), Math.sign(clip.y), 1, 1).applyMatrix4(camera.projectionMatrixInverse);
  const dotVal = clip.dot(farCorner);
  if (dotVal <= 0) return;
  const webGPU = camera.coordinateSystem === THREE.WebGPUCoordinateSystem;
  clip.multiplyScalar((webGPU ? 1 : 2) / dotVal);
  const m = camera.projectionMatrix.elements;
  m[2] = clip.x - (webGPU ? 0 : m[3]);
  m[6] = clip.y - (webGPU ? 0 : m[7]);
  m[10] = clip.z - (webGPU ? 0 : m[11]);
  m[14] = clip.w - (webGPU ? 0 : m[15]);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export class PortalPreviews {
  private readonly destinations = new Map<string, Destination>();
  private readonly views = new Map<Aperture, WindowView>();
  private readonly viewPool: WindowViewSlot[] = [];
  private readonly snapshots = new Map<string, PortalSnapshot>();
  private readonly snapshotMaterials = new Map<Aperture, THREE.MeshBasicNodeMaterial>();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly captureCamera = new THREE.PerspectiveCamera();
  private readonly size = new THREE.Vector2();
  private readonly bounds = new THREE.Vector4();
  private readonly frustum = new THREE.Frustum();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];
  private readonly viewProjection = new THREE.Matrix4();
  private lastElapsed = 0;

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly load: LocalLoader) {}

  private destination(id: string, elapsed: number): Destination | undefined {
    const existing = this.destinations.get(id);
    if (existing && !(existing.retryAfter && performance.now() >= existing.retryAfter)) {
      existing.lastSeen = elapsed;
      return existing;
    }
    const module = this.load(id);
    if (!module) return;
    const ready = module.then(mod => RoomInstance.mount(mod, this.renderer));
    const entry: Destination = { ready, lastSeen: elapsed };
    this.destinations.set(id, entry);
    void ready.then(room => {
      entry.room = room;
      this.applySnapshotsToRoom(room);
    }).catch(error => {
      entry.retryAfter = performance.now() + 5000;
      console.warn(`Portal preview unavailable for "${id}"`, error);
    });
    return entry;
  }

  prepare(id: string): Promise<RoomInstance> | undefined {
    const dest = this.destination(id, this.lastElapsed);
    if (dest) dest.pinned = true;
    return dest?.ready;
  }

  /**
   * Hand a previously active room back into the preview cache so turning around
   * or stepping back through the entrance portal has zero reload delay. The room
   * goes back to preview mode, so its player-only behavior stops.
   */
  retain(id: string, room: RoomInstance): void {
    room.deactivate();
    const existing = this.destinations.get(id);
    if (existing && existing.room !== room) {
      this.discard(existing);
    }
    // Reset any forced-perspective scaling from when this room was active
    for (const h of room.portals) {
      h.group.scale.setScalar(1);
    }
    this.applySnapshotsToRoom(room);
    this.destinations.set(id, {
      ready: Promise.resolve(room),
      room,
      lastSeen: this.lastElapsed,
      pinned: true,
    });
  }

  /**
   * Preload and pin both adjacent rooms (next exit + previous entrance) of the
   * active room, while unpinning rooms further away so GPU memory stays bounded.
   */
  syncPinnedForRoom(room: RoomInstance): Promise<void> {
    const keepKeys = new Set<string>();
    const pending: Array<Promise<unknown>> = [];
    for (const h of room.portals) {
      if (h.portal.remoteUrl) continue;
      if (h.portal.id === 'exit' || h.portal.id === 'entrance') {
        keepKeys.add(h.portal.targetWorldId);
        const ready = this.prepare(h.portal.targetWorldId);
        if (ready) pending.push(ready.catch(() => {}));
      }
    }
    for (const [key, dest] of this.destinations) {
      if (!keepKeys.has(key) && this.destinations.size > MAX_HOT_ROOMS) {
        dest.pinned = false;
      }
    }
    return Promise.all(pending).then(() => {});
  }

  /** Synchronously take ownership of an already-mounted preview room (zero-frame-delay promotion). */
  takeReady(id: string): RoomInstance | undefined {
    const dest = this.destinations.get(id);
    if (!dest?.room) return undefined;
    this.destinations.delete(id);
    return dest.room;
  }

  /** Transfer ownership of the actual preview scene, including an in-flight mount. */
  take(id: string): Promise<RoomInstance> | undefined {
    const dest = this.destinations.get(id);
    this.destinations.delete(id);
    return dest?.ready;
  }

  /** Dispose a room this cache no longer tracks, releasing the snapshot materials on its portals. */
  disposeRoom(room: RoomInstance): void {
    this.releaseRoomSnapshotMaterials(room);
    room.dispose();
  }

  private getSnapshot(portal: PortalDefinition): PortalSnapshot | undefined {
    if (portal.remoteUrl) return undefined;
    return this.snapshots.get(snapshotKey(portal.targetWorldId, portal.targetSpawnId));
  }

  /** Capture a 512x512 POV-aligned reference snapshot of a room from its entrance or exit sightline. */
  private captureSnapshot(room: RoomInstance, spawnId: 'entrance' | 'exit'): void {
    const key = snapshotKey(room.module.manifest.id, spawnId);
    let snap = this.snapshots.get(key);
    if (!snap) {
      const target = createSceneTarget(SNAPSHOT_SIZE, SNAPSHOT_SIZE);
      snap = { target, radius: SNAPSHOT_RADIUS, refDistance: SNAPSHOT_REF_DISTANCE };
      this.snapshots.set(key, snap);
    }

    for (const h of room.portals) {
      h.group.scale.setScalar(1);
    }

    const spawn = room.spawn(spawnId);
    const forward = new THREE.Vector3(-Math.sin(spawn.yaw), 0, -Math.cos(spawn.yaw));
    const center = new THREE.Vector3(
      spawn.position[0],
      spawn.position[1] + PORTAL_CENTER_Y,
      spawn.position[2],
    );

    const fovDeg = 2 * Math.atan(snap.radius / snap.refDistance) * (180 / Math.PI);
    this.captureCamera.coordinateSystem = this.renderer.coordinateSystem;
    this.captureCamera.fov = fovDeg;
    this.captureCamera.aspect = 1;
    this.captureCamera.near = snap.refDistance;
    this.captureCamera.far = snap.refDistance + 260;
    this.captureCamera.position.copy(center).addScaledVector(forward, -snap.refDistance);
    this.captureCamera.lookAt(center);
    this.captureCamera.updateProjectionMatrix();
    this.captureCamera.updateMatrixWorld();

    room.update(0.016, 1.0);
    for (const h of room.portals) h.update?.(0.016, 1.0);

    const receiving = room.portals.find(p => p.portal.id === spawnId);
    const previousTarget = this.renderer.getRenderTarget();
    // Offset linear fog by refDistance during capture so fog starts at the threshold
    // rather than behind the capture camera (prevents washing out sunlit rooms!).
    const sceneFog = room.scene.fog;
    const savedNear = sceneFog instanceof THREE.Fog ? sceneFog.near : 0;
    const savedFar = sceneFog instanceof THREE.Fog ? sceneFog.far : 0;
    if (sceneFog instanceof THREE.Fog) {
      sceneFog.near = savedNear + snap.refDistance;
      sceneFog.far = savedFar + snap.refDistance;
    }
    if (receiving) receiving.group.visible = false;
    try {
      this.renderer.setRenderTarget(snap.target);
      this.renderer.render(room.scene, this.captureCamera);
    } finally {
      if (sceneFog instanceof THREE.Fog) {
        sceneFog.near = savedNear;
        sceneFog.far = savedFar;
      }
      if (receiving) receiving.group.visible = true;
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  /**
   * Apply POV-aware cached snapshot materials to every local portal inside a room
   * so depth-2 portals visible through a neighbor never show a swirling placeholder
   * and blend naturally into atmospheric distance fog.
   */
  applySnapshotsToRoom(room: RoomInstance): void {
    if (!room.portals?.length) return;
    for (const handle of room.portals) {
      if (handle.portal.remoteUrl) continue;
      const snap = this.getSnapshot(handle.portal);
      if (!snap) continue;
      if (this.snapshotMaterials.has(handle.aperture)) continue;

      const mat = new THREE.MeshBasicNodeMaterial();
      mat.side = isOneWay(handle) ? THREE.FrontSide : THREE.DoubleSide;
      mat.fog = true;
      mat.colorNode = buildSnapshotColorNode(snap, handle.aperture);
      this.snapshotMaterials.set(handle.aperture, mat);

      const activeView = this.views.get(handle.aperture);
      if (activeView) {
        activeView.fallback = mat;
      } else {
        handle.aperture.material = mat;
      }
    }
  }

  /**
   * Prewarm entrance & exit snapshots for every local room in the loop during the
   * initial loading gate, reporting fractional progress [0..1].
   */
  async prewarmSnapshots(
    worldIds: string[],
    activeRoom: RoomInstance,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const mountedForPass: Array<{ id: string; room: RoomInstance; owned: boolean }> = [];
    const totalSteps = Math.max(1, worldIds.length * 2);
    let completed = 0;

    try {
      // Pass 1: capture every room's entrance & exit snapshot
      for (const id of worldIds) {
        let room: RoomInstance | undefined;
        let owned = false;
        if (activeRoom.module.manifest.id === id) {
          room = activeRoom;
        } else {
          const dest = this.destinations.get(id);
          if (dest) {
            room = await dest.ready;
          } else {
            const loader = this.load(id);
            if (loader) {
              const mod = await loader;
              room = await RoomInstance.mount(mod, this.renderer);
              owned = true;
            }
          }
        }
        if (room) {
          this.captureSnapshot(room, 'entrance');
          this.captureSnapshot(room, 'exit');
          mountedForPass.push({ id, room, owned });
        }
        completed++;
        onProgress?.(completed / totalSteps);
      }

      // Pass 2: apply depth-2 snapshot materials to every room and refresh snapshots
      // so even distant depth-3 portals inside snapshots show real destinations!
      for (const entry of mountedForPass) {
        this.applySnapshotsToRoom(entry.room);
      }
      for (const entry of mountedForPass) {
        this.captureSnapshot(entry.room, 'entrance');
        this.captureSnapshot(entry.room, 'exit');
        completed++;
        onProgress?.(completed / totalSteps);
      }
    } finally {
      const keepHot = worldIds.length <= MAX_HOT_ROOMS;
      for (const entry of mountedForPass) {
        if (entry.owned) {
          if (keepHot) {
            this.retain(entry.id, entry.room);
          } else {
            this.disposeRoom(entry.room);
          }
        }
      }
    }

    // Ensure active room and all currently cached previews use their snapshot materials
    this.applySnapshotsToRoom(activeRoom);
    for (const dest of this.destinations.values()) {
      if (dest.room) this.applySnapshotsToRoom(dest.room);
    }
  }

  private releaseRoomSnapshotMaterials(room: RoomInstance): void {
    if (!room.portals?.length) return;
    for (const handle of room.portals) {
      const mat = this.snapshotMaterials.get(handle.aperture);
      if (mat) {
        mat.dispose();
        this.snapshotMaterials.delete(handle.aperture);
      }
    }
  }

  private discard(dest: Destination): void {
    void dest.ready.then(room => {
      this.releaseRoomSnapshotMaterials(room);
      room.dispose();
    }, () => {});
  }

  private allocateViewSlot(oneWay: boolean): WindowViewSlot {
    const idx = this.viewPool.findIndex(s => s.oneWay === oneWay);
    if (idx >= 0) {
      return this.viewPool.splice(idx, 1)[0];
    }

    const isWebGPU = this.renderer.coordinateSystem === THREE.WebGPUCoordinateSystem;
    const target = createSceneTarget(this.size.x, this.size.y);
    const material = new THREE.MeshBasicNodeMaterial();
    material.side = oneWay ? THREE.FrontSide : THREE.DoubleSide;
    material.fog = false;

    const pixels = new THREE.Vector4(0, 0, target.width, target.height);
    const rect = uniform(pixels);
    const targetSize = uniform(new THREE.Vector2(target.width, target.height));
    const liveBlend = uniform(1.0);
    const hasSnap = uniform(0.0);
    const lens = createSnapshotLens(SNAPSHOT_RADIUS * 2.0);

    // The live view sits in the target's top-left corner at one texel per screen pixel.
    const liveColor = texture(target.texture, screenCoordinate.sub(rect.xy).div(targetSize));
    const snapTexNode = texture(target.texture, lens.uv);
    const blended = mix(snapTexNode, liveColor, liveBlend);
    material.colorNode = mix(liveColor, blended, hasSnap);

    // Preserve aperture silhouette if the plane lies near the eye
    const mvp = cameraProjectionMatrix.mul(vec4(positionView, 1));
    const nearZ = isWebGPU ? 0 : mvp.w.negate();
    material.vertexNode = vec4(mvp.xy, mvp.z.max(nearZ), mvp.w);

    return { oneWay, target, material, pixels, targetSize, liveBlend, hasSnap, lens, snapTexNode };
  }

  /**
   * Size a window's target to the drawing buffer (only when the window size changes)
   * and limit this frame's render to the portal's on-screen rectangle.
   */
  private fitViewTarget(slot: WindowViewSlot, bounds: THREE.Vector4): void {
    const { target } = slot;
    if (target.width !== this.size.x || target.height !== this.size.y) {
      target.setSize(this.size.x, this.size.y);
      slot.targetSize.value.set(this.size.x, this.size.y);
    }
    slot.pixels.copy(bounds);
    target.viewport.set(0, 0, bounds.z, bounds.w);
  }

  private view(
    handle: PortalVisualHandle,
    bounds: THREE.Vector4,
    viewer: THREE.PerspectiveCamera,
    snapshot?: PortalSnapshot,
  ): WindowView {
    const aperture = handle.aperture;
    const existing = this.views.get(aperture);
    if (existing) {
      this.fitViewTarget(existing.slot, bounds);
      return existing;
    }

    const slot = this.allocateViewSlot(isOneWay(handle));
    this.fitViewTarget(slot, bounds);

    const distToPortal = viewer.position.distanceTo(handle.triggerCenter);
    const startBlended = !snapshot || distToPortal < 15;
    slot.liveBlend.value = startBlended ? 1.0 : 0.0;

    if (snapshot) {
      aimSnapshotLens(slot.lens, aperture);
      slot.lens.span.value = snapshot.radius * 2.0;
      slot.snapTexNode.value = snapshot.target.texture;
      slot.hasSnap.value = 1.0;
    } else {
      slot.hasSnap.value = 0.0;
    }

    const fallback = this.snapshotMaterials.get(aperture) ?? aperture.material;
    const view: WindowView = {
      slot,
      fallback,
      blendProgress: startBlended ? 1 : 0,
    };
    this.views.set(aperture, view);
    return view;
  }

  private release(aperture: Aperture, view: WindowView): void {
    aperture.material = view.fallback;
    this.viewPool.push(view.slot);
    this.views.delete(aperture);
  }

  /** Release only active aperture WindowViews (keeping preloaded rooms & snapshots intact). */
  releaseViews(): void {
    for (const [aperture, view] of this.views) {
      this.release(aperture, view);
    }
  }

  /** The built-in circular openings are convex. Four corner hits close to the
   * plane mean the entire viewport looks through the opening. */
  private fillsView(aperture: Aperture, viewer: THREE.PerspectiveCamera): boolean {
    if (!(aperture.geometry instanceof THREE.PlaneGeometry || aperture.geometry instanceof THREE.CircleGeometry)) return false;
    const localZ = aperture.worldToLocal(origin.copy(viewer.position)).z;
    if (aperture.userData.oneWay === true) {
      if (localZ <= 0 || localZ > 0.55) return false;
    } else {
      if (Math.abs(localZ) === 0 || Math.abs(localZ) > 0.55) return false;
    }
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        this.ray.setFromCamera(this.ndc.set(x, y), viewer);
        this.hits.length = 0;
        aperture.raycast(this.ray, this.hits);
        if (!this.hits.length) return false;
      }
    }
    return true;
  }

  render(handles: PortalVisualHandle[], viewer: THREE.PerspectiveCamera,
    dt: number, elapsed: number, transitAvatar?: TransitAvatarState): boolean {
    this.lastElapsed = elapsed;
    viewer.updateMatrixWorld();
    this.renderer.getDrawingBufferSize(this.size);
    this.camera.coordinateSystem = this.renderer.coordinateSystem;
    this.viewProjection.multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, viewer.coordinateSystem);

    // Eagerly preload both adjacent rooms in the loop for instant crossings in either direction.
    for (const h of handles) {
      if (h.portal.id === 'exit' || h.portal.id === 'entrance') {
        this.destination(h.portal.targetWorldId, elapsed);
      }
    }

    const visible = handles.filter(({ portal, aperture }) => {
      if (portal.remoteUrl) return false;
      aperture.updateWorldMatrix(true, false);
      return this.frustum.intersectsObject(aperture);
    }).sort((a, b) => a.triggerCenter.distanceToSquared(viewer.position) -
      b.triggerCenter.distanceToSquared(viewer.position)).slice(0, 4);

    const used = new Set<Aperture>();
    const animated = new Set<RoomInstance>();
    const previous = this.renderer.getRenderTarget();
    let presented = false;
    try {
      for (const handle of visible) {
        const { portal, aperture } = handle;
        const dest = this.destination(portal.targetWorldId, elapsed);
        const room = dest?.room;
        if (!room) continue;
        portalPixels(aperture, viewer, this.size, this.bounds);
        if (!this.bounds.z || !this.bounds.w) continue;
        const spawn = room.spawn(portal.targetSpawnId);
        framePortal(this.camera, viewer, aperture, spawn,
          portal.position[1], portal.yaw ?? 0, this.size, this.bounds);
        if (!animated.has(room)) {
          room.update(dt, elapsed);
          for (const h of room.portals) h.update?.(dt, elapsed);
          animated.add(room);
        }
        const direct = this.fillsView(aperture, viewer);
        if (direct) {
          this.camera.projectionMatrix.copy(viewer.projectionMatrix);
          this.camera.projectionMatrixInverse.copy(viewer.projectionMatrixInverse);
          this.renderer.setRenderTarget(previous);
        } else {
          const snap = this.getSnapshot(portal);
          const view = this.view(handle, this.bounds, viewer, snap);
          if (view.blendProgress < 1) {
            view.blendProgress = Math.min(1, view.blendProgress + dt / LIVE_FADE_DURATION_S);
            const t = view.blendProgress;
            view.slot.liveBlend.value = t * t * (3 - 2 * t);
          }
          aperture.material = view.slot.material;
          used.add(aperture);
          this.renderer.setRenderTarget(view.slot.target);
        }

        // Mirror the local character into the destination room while crossing the threshold
        // so you watch your character step right into the next room as the camera follows!
        let attachedProxy = false;
        if (transitAvatar?.visible) {
          proxyLocal.copy(transitAvatar.position);
          handle.group.worldToLocal(proxyLocal);
          if (Math.abs(proxyLocal.x) < PORTAL_RADIUS + 1.5 && Math.abs(proxyLocal.z) < 16) {
            aperture.getWorldPosition(proxyOrigin);
            proxyNormal.set(0, 0, 1).transformDirection(aperture.matrixWorld);
            proxyPlane.setFromNormalAndCoplanarPoint(proxyNormal, proxyOrigin);
            const viewerDist = proxyPlane.distanceToPoint(viewer.position);
            const flip = viewerDist < 0 ? Math.PI : 0;
            const deltaYaw = spawn.yaw - (portal.yaw ?? 0) - flip;
            proxyTurn.setFromAxisAngle(up, deltaYaw);
            proxyOrigin.y = portal.position[1];
            proxyPos.copy(transitAvatar.position).sub(proxyOrigin).applyQuaternion(proxyTurn);
            proxyPos.add(proxyOrigin.fromArray(spawn.position));
            transitAvatar.rig.position.copy(proxyPos);
            transitAvatar.rig.rotation.y = transitAvatar.yaw + deltaYaw;
            room.scene.add(transitAvatar.rig);
            attachedProxy = true;
          }
        }

        const receiving = room.portals.find(p => p.portal.id === portal.targetSpawnId);
        // Compute true viewer distance to this portal so far-portal de-emphasis stays tied
        // to the player's real walk progress (0.30x across the room -> exact 1.0x at crossing),
        // while fog offsets by the compressed virtual camera distance behind the threshold.
        const distToPortal = Math.max(
          0,
          Math.hypot(viewer.position.x - portal.position[0], viewer.position.z - portal.position[2]),
        );
        const effDistToPortal = effectivePortalDistance(distToPortal);
        for (const h of room.portals) {
          if (h.aperture.userData.routeGate && h !== receiving) {
            h.group.scale.setScalar(farPortalScaleByDistance(ROUTE_LENGTH + distToPortal));
          }
        }
        const destFog = room.scene.fog;
        const savedFogNear = destFog instanceof THREE.Fog ? destFog.near : 0;
        const savedFogFar = destFog instanceof THREE.Fog ? destFog.far : 0;
        if (destFog instanceof THREE.Fog) {
          destFog.near = savedFogNear + effDistToPortal;
          destFog.far = savedFogFar + effDistToPortal;
        }
        if (receiving) receiving.group.visible = false;
        try { this.renderer.render(room.scene, this.camera); }
        finally {
          if (destFog instanceof THREE.Fog) {
            destFog.near = savedFogNear;
            destFog.far = savedFogFar;
          }
          if (receiving) receiving.group.visible = true;
          if (attachedProxy && transitAvatar) room.scene.remove(transitAvatar.rig);
        }
        if (direct) {
          presented = true;
          break;
        }
      }
    } finally {
      this.renderer.setRenderTarget(previous);
    }
    for (const [aperture, view] of this.views) {
      if (!used.has(aperture)) this.release(aperture, view);
    }
    for (const [key, dest] of this.destinations) {
      if (!dest.pinned && elapsed - dest.lastSeen > 4) {
        this.destinations.delete(key);
        this.discard(dest);
      }
    }
    return presented;
  }

  clear(): void {
    this.releaseViews();
    for (const slot of this.viewPool) {
      slot.target.dispose();
      slot.material.dispose();
    }
    this.viewPool.length = 0;
    for (const mat of this.snapshotMaterials.values()) mat.dispose();
    this.snapshotMaterials.clear();
    for (const dest of this.destinations.values()) this.discard(dest);
    this.destinations.clear();
    for (const snap of this.snapshots.values()) snap.target.dispose();
    this.snapshots.clear();
  }
}
