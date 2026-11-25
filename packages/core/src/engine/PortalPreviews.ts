import * as THREE from 'three/webgpu';
import { cameraProjectionMatrix, positionView, screenCoordinate, texture, uniform, vec4 } from 'three/tsl';
import type { HubStyle, PortalVisualHandle, SpawnPoint, WorldModule } from '../types';
import { RoomInstance } from './RoomInstance';

type Aperture = PortalVisualHandle['aperture'];
type LocalLoader = (worldId: string) => Promise<WorldModule> | undefined;

interface Destination {
  ready: Promise<RoomInstance>;
  room?: RoomInstance;
  lastSeen: number;
  pinned?: boolean;
  retryAfter?: number;
}

interface WindowView {
  target: THREE.RenderTarget;
  material: THREE.MeshBasicNodeMaterial;
  original: THREE.Material;
  pixels: THREE.Vector4;
}

const up = new THREE.Vector3(0, 1, 0);
const turn = new THREE.Quaternion();
const origin = new THREE.Vector3();
const plane = new THREE.Plane();
const normal = new THREE.Vector3();
const clip = new THREE.Vector4();
const farCorner = new THREE.Vector4();
const corner = new THREE.Vector3();
const crop = new THREE.Matrix4();

/** Visible aperture bounds in physical pixels, measured from the top left. */
export function portalPixels(aperture: Aperture, viewer: THREE.PerspectiveCamera, size: THREE.Vector2, out: THREE.Vector4) {
  if (!aperture.geometry.boundingBox) aperture.geometry.computeBoundingBox();
  const { min, max } = aperture.geometry.boundingBox!;
  let left = size.x, top = size.y, right = 0, bottom = 0;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
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
  // Tile rounding keeps target allocations stable over small camera movements.
  const tile = 128;
  left = Math.max(0, Math.floor(left / tile) * tile);
  top = Math.max(0, Math.floor(top / tile) * tile);
  right = Math.min(size.x, Math.ceil(right / tile) * tile);
  bottom = Math.min(size.y, Math.ceil(bottom / tile) * tile);
  return out.set(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** Transport the viewer through the doorway, preserving the original screen pixel grid. */
export function framePortal(camera: THREE.PerspectiveCamera, viewer: THREE.PerspectiveCamera,
  aperture: Aperture, spawn: SpawnPoint, sourceFloor: number, sourceYaw: number,
  size: THREE.Vector2, pixels: THREE.Vector4): void {
  aperture.getWorldPosition(origin);
  normal.set(0, 0, 1).transformDirection(aperture.matrixWorld);
  plane.setFromNormalAndCoplanarPoint(normal, origin);
  const distance = plane.distanceToPoint(viewer.position);
  turn.setFromAxisAngle(up, spawn.yaw - sourceYaw - (distance < 0 ? Math.PI : 0));
  origin.y = sourceFloor;
  camera.position.copy(viewer.position).sub(origin).applyQuaternion(turn);
  camera.position.add(origin.fromArray(spawn.position));
  camera.quaternion.copy(turn).multiply(viewer.quaternion);
  camera.coordinateSystem = viewer.coordinateSystem;
  camera.near = viewer.near;
  camera.far = viewer.far;
  camera.updateMatrixWorld();

  const sx = size.x / pixels.z, sy = size.y / pixels.w;
  crop.makeScale(sx, sy, 1);
  crop.setPosition(sx - 1 - 2 * pixels.x / pixels.z, 1 - sy + 2 * pixels.y / pixels.w, 0);
  camera.projectionMatrix.multiplyMatrices(crop, viewer.projectionMatrix);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  // Clip geometry on the viewer's side of the destination threshold. Only
  // change depth; x/y must stay registered with the main scene on every frame.
  if (Math.abs(distance) <= viewer.near) return;
  if (distance > 0) plane.negate();
  plane.applyMatrix4(viewer.matrixWorldInverse);
  clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  farCorner.set(Math.sign(clip.x), Math.sign(clip.y), 1, 1).applyMatrix4(camera.projectionMatrixInverse);
  const dot = clip.dot(farCorner);
  if (dot <= 0) return;
  const webGPU = camera.coordinateSystem === THREE.WebGPUCoordinateSystem;
  clip.multiplyScalar((webGPU ? 1 : 2) / dot);
  const m = camera.projectionMatrix.elements;
  m[2] = clip.x;
  m[6] = clip.y;
  m[10] = clip.z + (webGPU ? 0 : 1);
  m[14] = clip.w;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

export class PortalPreviews {
  private readonly destinations = new Map<string, Destination>();
  private readonly views = new Map<Aperture, WindowView>();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly size = new THREE.Vector2();
  private readonly bounds = new THREE.Vector4();
  private readonly frustum = new THREE.Frustum();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];
  private readonly viewProjection = new THREE.Matrix4();

  constructor(private readonly renderer: THREE.WebGPURenderer, private readonly load: LocalLoader) {}

  private destination(id: string, style: HubStyle, elapsed: number): Destination | undefined {
    const key = JSON.stringify([id, style]);
    const existing = this.destinations.get(key);
    if (existing && !(existing.retryAfter && performance.now() >= existing.retryAfter)) {
      existing.lastSeen = elapsed;
      return existing;
    }
    const module = this.load(id);
    if (!module) return;
    const ready = module.then(mod => RoomInstance.mount(mod, this.renderer, style));
    const entry: Destination = { ready, lastSeen: elapsed };
    this.destinations.set(key, entry);
    void ready.then(room => { entry.room = room; }).catch(error => {
      entry.retryAfter = performance.now() + 5000;
      console.warn(`Portal preview unavailable for "${id}"`, error);
    });
    return entry;
  }

  prepare(id: string, style: HubStyle): Promise<RoomInstance> | undefined {
    const dest = this.destination(id, style, this.lastElapsed);
    if (dest) dest.pinned = true;
    return dest?.ready;
  }

  private lastElapsed = 0;
  /** Transfer ownership of the actual preview scene, including an in-flight mount. */
  take(id: string, style: HubStyle): Promise<RoomInstance> | undefined {
    const key = JSON.stringify([id, style]);
    const dest = this.destinations.get(key);
    this.destinations.delete(key);
    return dest?.ready;
  }

  private discard(dest: Destination): void {
    void dest.ready.then(room => room.dispose(), () => {});
  }

  private view(aperture: Aperture, bounds: THREE.Vector4): WindowView {
    const existing = this.views.get(aperture);
    if (existing) {
      existing.target.setSize(bounds.z, bounds.w);
      existing.pixels.copy(bounds);
      return existing;
    }
    const target = new THREE.RenderTarget(bounds.z, bounds.w, { type: THREE.HalfFloatType, samples: 4 });
    const material = new THREE.MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.fog = false;
    const pixels = bounds.clone();
    const rect = uniform(pixels);
    material.colorNode = texture(target.texture, screenCoordinate.sub(rect.xy).div(rect.zw));
    // A still-visible aperture may lie between the eye and its near plane.
    // Preserve its projected silhouette until the destination takes over.
    const mvp = cameraProjectionMatrix.mul(vec4(positionView, 1));
    const nearZ = this.renderer.coordinateSystem === THREE.WebGPUCoordinateSystem ? 0 : mvp.w.negate();
    material.vertexNode = vec4(mvp.xy, mvp.z.max(nearZ), mvp.w);
    const view = { target, material, pixels, original: aperture.material };
    this.views.set(aperture, view);
    return view;
  }

  private release(aperture: Aperture, view: WindowView): void {
    aperture.material = view.original;
    view.target.dispose();
    view.material.dispose();
    this.views.delete(aperture);
  }

  /** The built-in openings are convex. Four corner hits mean the entire
   * viewport looks through the opening, even when its mesh clips the eye. */
  private fillsView(aperture: Aperture, viewer: THREE.PerspectiveCamera): boolean {
    if (!(aperture.geometry instanceof THREE.PlaneGeometry || aperture.geometry instanceof THREE.CircleGeometry)) return false;
    if (Math.abs(aperture.worldToLocal(origin.copy(viewer.position)).z) > 1) return false;
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

  render(handles: PortalVisualHandle[], viewer: THREE.PerspectiveCamera, style: HubStyle,
    dt: number, elapsed: number): boolean {
    this.lastElapsed = elapsed;
    viewer.updateMatrixWorld();
    this.renderer.getDrawingBufferSize(this.size);
    this.camera.coordinateSystem = this.renderer.coordinateSystem;
    this.viewProjection.multiplyMatrices(viewer.projectionMatrix, viewer.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, viewer.coordinateSystem);
    const exit = handles.find(h => h.portal.id === 'exit');
    if (exit) this.destination(exit.portal.targetWorldId, style, elapsed);
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
      for (const { portal, aperture } of visible) {
        const dest = this.destination(portal.targetWorldId, portal.targetHubStyle ?? style, elapsed);
        const room = dest?.room;
        if (!room) continue;
        portalPixels(aperture, viewer, this.size, this.bounds);
        if (!this.bounds.z || !this.bounds.w) continue;
        framePortal(this.camera, viewer, aperture, room.spawn(portal.targetSpawnId),
          portal.position[1], portal.yaw ?? 0, this.size, this.bounds);
        if (!animated.has(room)) {
          room.update(dt, elapsed);
          for (const handle of room.portals) handle.update?.(dt, elapsed);
          animated.add(room);
        }
        const direct = this.fillsView(aperture, viewer);
        if (direct) {
          this.camera.projectionMatrix.copy(viewer.projectionMatrix);
          this.camera.projectionMatrixInverse.copy(viewer.projectionMatrixInverse);
          this.renderer.setRenderTarget(previous);
        } else {
          const view = this.view(aperture, this.bounds);
          view.material.side = aperture.userData.routeGate ? THREE.FrontSide : THREE.DoubleSide;
          aperture.material = view.material;
          used.add(aperture);
          this.renderer.setRenderTarget(view.target);
        }
        const receiving = room.portals.find(p => p.portal.id === portal.targetSpawnId);
        if (receiving) receiving.group.visible = false;
        try { this.renderer.render(room.scene, this.camera); }
        finally { if (receiving) receiving.group.visible = true; }
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
      if (!dest.pinned && elapsed - dest.lastSeen > 3) {
        this.destinations.delete(key);
        this.discard(dest);
      }
    }
    return presented;
  }

  clear(): void {
    for (const [aperture, view] of this.views) this.release(aperture, view);
    for (const dest of this.destinations.values()) this.discard(dest);
    this.destinations.clear();
  }
}
