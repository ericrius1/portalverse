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
  effectivePortalDistance,
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
  bounds: THREE.Vector4;
  /**
   * Where the material samples: `bounds` relative to the pass that draws this
   * opening. That is the screen for an opening in the active room, or the parent
   * window's target for an opening seen through another portal.
   */
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
/** Rooms kept mounted at once. Above this, rooms away from the player are unloaded and remounted when needed. */
const MAX_HOT_ROOMS = 10;
const LIVE_FADE_DURATION_S = 0.55;

const up = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();
const origin = new THREE.Vector3();
const plane = new THREE.Plane();
const normal = new THREE.Vector3();
const clip = new THREE.Vector4();
const farCorner = new THREE.Vector4();
const corner = new THREE.Vector3();
const pixelQuad = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const pixelClip = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
];
const PIXEL_CLIP_Z = -1e-4;
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

const mapOrigin = new THREE.Vector3();
const mapNormal = new THREE.Vector3();
const mapPlane = new THREE.Plane();
const mapStep = new THREE.Matrix4();

/**
 * The transform a portal view applies to its destination, matching `framePortal`:
 * destination world → source world. It is rigid within the exact range and, farther
 * away, also stretches depth behind the threshold (the distance-compressed lens).
 * Writes the matrix to `out` and returns the yaw it turns the destination by.
 */
export function portalMapping(viewer: THREE.Vector3, aperture: Aperture, spawn: SpawnPoint,
  sourceFloor: number, sourceYaw: number, out: THREE.Matrix4): number {
  aperture.getWorldPosition(mapOrigin);
  mapNormal.set(0, 0, 1).transformDirection(aperture.matrixWorld);
  const distance = mapPlane.setFromNormalAndCoplanarPoint(mapNormal, mapOrigin).distanceToPoint(viewer);
  const absDist = Math.abs(distance);
  const ratio = absDist > 1e-4 ? effectivePortalDistance(absDist) / absDist : 1;
  const sourceYawEff = sourceYaw + (distance < 0 ? Math.PI : 0);
  out.makeTranslation(-spawn.position[0], -spawn.position[1], -spawn.position[2])
    .premultiply(mapStep.makeRotationY(-spawn.yaw))
    .premultiply(mapStep.makeScale(1, 1, ratio < 0.9999 ? 1 / ratio : 1))
    .premultiply(mapStep.makeRotationY(sourceYawEff))
    .premultiply(mapStep.makeTranslation(mapOrigin.x, sourceFloor, mapOrigin.z));
  return sourceYawEff - spawn.yaw;
}

/** Visible aperture bounds in physical pixels, measured from the top left. */
export function portalPixels(aperture: Aperture, viewer: THREE.PerspectiveCamera, size: THREE.Vector2, out: THREE.Vector4) {
  if (!aperture.geometry.boundingBox) aperture.geometry.computeBoundingBox();
  const { min, max: maxB } = aperture.geometry.boundingBox!;
  // Transform the 4 bounding corners into view space in winding order and clip against
  // the eye plane so portals behind the camera never return full-screen bounds.
  pixelQuad[0].set(min.x, min.y, min.z).applyMatrix4(aperture.matrixWorld).applyMatrix4(viewer.matrixWorldInverse);
  pixelQuad[1].set(maxB.x, min.y, min.z).applyMatrix4(aperture.matrixWorld).applyMatrix4(viewer.matrixWorldInverse);
  pixelQuad[2].set(maxB.x, maxB.y, min.z).applyMatrix4(aperture.matrixWorld).applyMatrix4(viewer.matrixWorldInverse);
  pixelQuad[3].set(min.x, maxB.y, min.z).applyMatrix4(aperture.matrixWorld).applyMatrix4(viewer.matrixWorldInverse);

  let clipCount = 0;
  for (let i = 0; i < 4; i++) {
    const a = pixelQuad[i];
    const b = pixelQuad[(i + 1) & 3];
    const aIn = a.z < PIXEL_CLIP_Z;
    const bIn = b.z < PIXEL_CLIP_Z;
    if (aIn) pixelClip[clipCount++].copy(a);
    if (aIn !== bIn) {
      const t = (PIXEL_CLIP_Z - a.z) / (b.z - a.z);
      pixelClip[clipCount++].lerpVectors(a, b, t);
    }
  }
  if (clipCount === 0) return out.set(0, 0, 0, 0);

  let left = size.x, top = size.y, right = 0, bottom = 0;
  for (let i = 0; i < clipCount; i++) {
    corner.copy(pixelClip[i]).applyMatrix4(viewer.projectionMatrix);
    const px = (1 + corner.x) * size.x / 2;
    const py = (1 - corner.y) * size.y / 2;
    left = Math.min(left, px);
    right = Math.max(right, px);
    top = Math.min(top, py);
    bottom = Math.max(bottom, py);
  }
  // Round outward to whole pixels so the live view covers every pixel of the opening.
  left = Math.max(0, Math.floor(left));
  top = Math.max(0, Math.floor(top));
  right = Math.min(size.x, Math.ceil(right));
  bottom = Math.min(size.y, Math.ceil(bottom));
  if (right <= left || bottom <= top) return out.set(0, 0, 0, 0);
  return out.set(left, top, right - left, bottom - top);
}

/**
 * Transport the viewer through the doorway, preserving the original screen pixel grid
 * on the aperture plane while smoothly widening the far-distance portal lens (d > 12m)
 * to the framing portal snapshots are taken with.
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
  /** Camera, bounds and stand-in opening for the portal at the far end of a previewed room. */
  private readonly farCamera = new THREE.PerspectiveCamera();
  private readonly farBounds = new THREE.Vector4();
  private readonly nearMapping = new THREE.Matrix4();
  private readonly farProxy: Aperture = new THREE.Mesh();
  private readonly farFloor = new THREE.Vector3();
  /** Openings that were on screen showing only their snapshot last frame, because their room wasn't ready. */
  private seenWithoutLive = new Set<Aperture>();
  private nextSeenWithoutLive = new Set<Aperture>();
  private lastElapsed = 0;

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly load: LocalLoader) {
    this.farProxy.matrixAutoUpdate = false;
  }

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
   * Apply POV-aware cached snapshot materials to every local portal inside a room,
   * so portals too far away to draw live never show a swirling placeholder and blend
   * into atmospheric distance fog.
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
      // Match live portal windows (`fog = false`) so distant depth-3 snapshots stay
      // equally vibrant and never pop in saturation when promoted to depth-2 live.
      mat.fog = false;
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

      // Pass 2: apply snapshot materials to every room and refresh snapshots
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

    const bounds = new THREE.Vector4(0, 0, target.width, target.height);
    const pixels = bounds.clone();
    const rect = uniform(pixels);
    const targetSize = uniform(new THREE.Vector2(target.width, target.height));
    const liveBlend = uniform(1.0);
    const hasSnap = uniform(0.0);
    const lens = createSnapshotLens(SNAPSHOT_RADIUS * 2.0);

    // The live view sits in the target's top-left corner at one texel per pixel of the pass that draws the opening.
    // Clamp inside the active sub-viewport so linear filtering never bleeds cleared texels at tiny portal edges.
    const samplePx = clamp(screenCoordinate.sub(rect.xy), vec2(0.5), max(rect.zw.sub(0.5), vec2(0.5)));
    const liveColor = texture(target.texture, samplePx.div(targetSize));
    const snapTexNode = texture(target.texture, lens.uv);
    const blended = mix(snapTexNode, liveColor, liveBlend);
    material.colorNode = mix(liveColor, blended, hasSnap);

    // Preserve aperture silhouette if the plane lies near the eye
    const mvp = cameraProjectionMatrix.mul(vec4(positionView, 1));
    const nearZ = isWebGPU ? 0 : mvp.w.negate();
    material.vertexNode = vec4(mvp.xy, mvp.z.max(nearZ), mvp.w);

    return { oneWay, target, material, bounds, pixels, targetSize, liveBlend, hasSnap, lens, snapTexNode };
  }

  /**
   * Size a window's target to the drawing buffer (only when the window size changes)
   * and limit this frame's render to the portal's on-screen rectangle. `origin` is the
   * screen position of the pass that will draw the opening (zero for the main view).
   */
  private fitViewTarget(slot: WindowViewSlot, bounds: THREE.Vector4, originX = 0, originY = 0): void {
    const { target } = slot;
    if (target.width !== this.size.x || target.height !== this.size.y) {
      target.setSize(this.size.x, this.size.y);
      slot.targetSize.value.set(this.size.x, this.size.y);
    }
    slot.bounds.copy(bounds);
    slot.pixels.set(bounds.x - originX, bounds.y - originY, bounds.z, bounds.w);
    target.viewport.set(0, 0, bounds.z, bounds.w);
  }

  private view(
    handle: PortalVisualHandle,
    bounds: THREE.Vector4,
    snapshot?: PortalSnapshot,
    originX = 0,
    originY = 0,
  ): WindowView {
    const aperture = handle.aperture;
    const existing = this.views.get(aperture);
    if (existing) {
      this.fitViewTarget(existing.slot, bounds, originX, originY);
      return existing;
    }

    const slot = this.allocateViewSlot(isOneWay(handle));
    this.fitViewTarget(slot, bounds, originX, originY);

    // Crossfade from the snapshot only if it was on screen last frame because the room
    // wasn't ready. Openings that were already live (including the far-end portal you
    // just walked toward) and openings just coming into view start live.
    const startBlended = !snapshot || !this.seenWithoutLive.has(aperture);
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
    this.farCamera.coordinateSystem = this.renderer.coordinateSystem;
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
    this.nextSeenWithoutLive.clear();
    let presented = false;
    try {
      for (const handle of visible) {
        const { portal, aperture } = handle;
        const dest = this.destination(portal.targetWorldId, elapsed);
        const room = dest?.room;
        if (!room) {
          this.nextSeenWithoutLive.add(aperture);
          continue;
        }
        portalPixels(aperture, viewer, this.size, this.bounds);
        if (!this.bounds.z || !this.bounds.w) continue;
        const spawn = room.spawn(portal.targetSpawnId);
        framePortal(this.camera, viewer, aperture, spawn,
          portal.position[1], portal.yaw ?? 0, this.size, this.bounds);
        this.animate(room, dt, elapsed, animated);
        const direct = this.fillsView(aperture, viewer);

        // Draw the portal at the far end of this room first, so this room's view shows it live.
        this.renderFarPortal(handle, room, spawn, viewer, direct, dt, elapsed, animated, used);

        if (direct) {
          this.camera.projectionMatrix.copy(viewer.projectionMatrix);
          this.camera.projectionMatrixInverse.copy(viewer.projectionMatrixInverse);
          this.renderer.setRenderTarget(previous);
        } else {
          const snap = this.getSnapshot(portal);
          const view = this.view(handle, this.bounds, snap);
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

        // Fog starts at the threshold: offset it by the virtual camera's compressed distance.
        const distToPortal = Math.hypot(viewer.position.x - portal.position[0], viewer.position.z - portal.position[2]);
        try {
          this.renderRoom(room, this.camera, portal.targetSpawnId, effectivePortalDistance(distToPortal));
        } finally {
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
    [this.seenWithoutLive, this.nextSeenWithoutLive] = [this.nextSeenWithoutLive, this.seenWithoutLive];
    for (const [key, dest] of this.destinations) {
      if (!dest.pinned && elapsed - dest.lastSeen > 4) {
        this.destinations.delete(key);
        this.discard(dest);
      }
    }
    return presented;
  }

  private animate(room: RoomInstance, dt: number, elapsed: number, animated: Set<RoomInstance>): void {
    if (animated.has(room)) return;
    room.update(dt, elapsed);
    for (const h of room.portals) h.update?.(dt, elapsed);
    animated.add(room);
  }

  /** Render a destination room with its fog starting at the threshold and its receiving portal hidden. */
  private renderRoom(room: RoomInstance, camera: THREE.Camera, receivingId: string | undefined, fogOffset: number): void {
    const receiving = room.portals.find(p => p.portal.id === receivingId);
    const fog = room.scene.fog instanceof THREE.Fog ? room.scene.fog : null;
    const fogNear = fog?.near ?? 0;
    const fogFar = fog?.far ?? 0;
    if (fog) {
      fog.near = fogNear + fogOffset;
      fog.far = fogFar + fogOffset;
    }
    if (receiving) receiving.group.visible = false;
    try {
      this.renderer.render(room.scene, camera);
    } finally {
      if (fog) {
        fog.near = fogNear;
        fog.far = fogFar;
      }
      if (receiving) receiving.group.visible = true;
    }
  }

  /**
   * Draw the route gate at the far end of a previewed room live, through the same lens
   * it will use once the player walks into that room. Seen from here it sits behind the
   * near portal, so place a stand-in for it in this world with the near portal's mapping
   * and frame it like any other opening. When the player crosses, the gate becomes an
   * opening in the active room and its view simply carries on, so nothing jumps.
   * Other portals in previewed rooms keep their snapshots.
   */
  private renderFarPortal(
    near: PortalVisualHandle,
    room: RoomInstance,
    spawn: SpawnPoint,
    viewer: THREE.PerspectiveCamera,
    direct: boolean,
    dt: number,
    elapsed: number,
    animated: Set<RoomInstance>,
    used: Set<Aperture>,
  ): void {
    // The lens stretches depth along the near portal's axis, which only lines up with the
    // far gate when we arrive at one of this room's route thresholds.
    const arrival = near.portal.targetSpawnId;
    if (arrival !== 'entrance' && arrival !== 'exit') return;
    const far = room.portals.find(p => p.aperture.userData.routeGate && p.portal.id !== arrival && !p.portal.remoteUrl);
    if (!far) return;
    const farRoom = this.destination(far.portal.targetWorldId, elapsed)?.room;
    if (!farRoom) {
      this.nextSeenWithoutLive.add(far.aperture);
      return;
    }

    const turn = portalMapping(viewer.position, near.aperture, spawn,
      near.portal.position[1], near.portal.yaw ?? 0, this.nearMapping);
    far.aperture.updateWorldMatrix(true, false);
    this.farProxy.geometry = far.aperture.geometry;
    this.farProxy.matrix.multiplyMatrices(this.nearMapping, far.aperture.matrixWorld);
    this.farProxy.updateMatrixWorld(true);

    // Only the part of the far opening visible through the near opening needs drawing.
    portalPixels(this.farProxy, viewer, this.size, this.farBounds);
    const fb = this.farBounds;
    const nb = this.bounds;
    const left = Math.max(fb.x, nb.x);
    const top = Math.max(fb.y, nb.y);
    const right = Math.min(fb.x + fb.z, nb.x + nb.z);
    const bottom = Math.min(fb.y + fb.w, nb.y + nb.w);
    if (right <= left || bottom <= top) return;
    fb.set(left, top, right - left, bottom - top);

    far.group.updateWorldMatrix(true, false);
    this.farFloor.setFromMatrixPosition(far.group.matrixWorld).applyMatrix4(this.nearMapping);
    const farSpawn = farRoom.spawn(far.portal.targetSpawnId);
    framePortal(this.farCamera, viewer, this.farProxy, farSpawn,
      this.farFloor.y, (far.portal.yaw ?? 0) + turn, this.size, fb);
    this.animate(farRoom, dt, elapsed, animated);

    // The near room is drawn into its own window unless it fills the view, so sample
    // relative to wherever that pass starts on screen.
    const farSnap = this.getSnapshot(far.portal);
    const view = this.view(far, fb, farSnap, direct ? 0 : nb.x, direct ? 0 : nb.y);
    if (view.blendProgress < 1) {
      view.blendProgress = Math.min(1, view.blendProgress + dt / LIVE_FADE_DURATION_S);
      const t = view.blendProgress;
      view.slot.liveBlend.value = t * t * (3 - 2 * t);
    }
    far.aperture.material = view.slot.material;
    used.add(far.aperture);
    this.renderer.setRenderTarget(view.slot.target);
    const farDistance = Math.hypot(viewer.position.x - this.farFloor.x, viewer.position.z - this.farFloor.z);
    this.renderRoom(farRoom, this.farCamera, far.portal.targetSpawnId, effectivePortalDistance(farDistance));
  }

  clear(): void {
    this.releaseViews();
    this.seenWithoutLive.clear();
    this.nextSeenWithoutLive.clear();
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
