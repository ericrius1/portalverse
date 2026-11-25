import { RUN_SPEED } from '../portal/roomLayout';
import * as THREE from 'three/webgpu';
import type { AvatarState, PlatformCollider, SpawnPoint, Vec3Tuple } from '../types';
import { createFloatingLabel } from './signage';

interface RemoteAvatarVisual {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  haloMesh: THREE.Mesh;
  label: { sprite: THREE.Sprite; dispose: () => void };
  targetPos: THREE.Vector3;
  targetYaw: number;
  name: string;
  color: string;
  dispose: () => void;
}

function createStylizedAvatarRig(hexColor: string): {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  haloMesh: THREE.Mesh;
  dispose: () => void;
} {
  const group = new THREE.Group();
  const col = new THREE.Color(hexColor);

  const bodyGeo = new THREE.CapsuleGeometry(0.36, 0.78, 10, 20);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: col,
    emissive: col,
    emissiveIntensity: 0.35,
    roughness: 0.25,
    metalness: 0.2,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.95;
  group.add(body);

  const visorGeo = new THREE.BoxGeometry(0.46, 0.16, 0.26);
  const visorMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 1.32, -0.24);
  group.add(visor);

  const haloGeo = new THREE.TorusGeometry(0.46, 0.035, 10, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: col,
    transparent: true,
    opacity: 0.85,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.rotation.x = Math.PI / 2;
  haloMesh.position.y = 1.82;
  group.add(haloMesh);

  return {
    group,
    bodyMat,
    haloMesh,
    dispose: () => {
      bodyGeo.dispose();
      bodyMat.dispose();
      visorGeo.dispose();
      visorMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
    },
  };
}

export class AvatarController {
  readonly position = new THREE.Vector3(0, 0, 10);
  yaw = 0;
  pitch = -0.12;
  velocityY = 0;
  isFlying = false;
  firstPerson = false;

  private readonly keys = new Set<string>();
  private isDraggingLook = false;
  private dragMoved = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private onGround = true;

  private localRig: ReturnType<typeof createStylizedAvatarRig>;
  private readonly remoteMap = new Map<string, RemoteAvatarVisual>();
  private readonly remoteRoot = new THREE.Group();
  private platforms: PlatformCollider[] = [];
  private terrainHeightFn: ((x: number, z: number) => number) | null = null;
  private onFlightChange?: (flying: boolean) => void;

  private readonly domElement: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    initialColor: string,
    onFlightChange?: (flying: boolean) => void,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.onFlightChange = onFlightChange;

    this.localRig = createStylizedAvatarRig(initialColor);
    this.scene.add(this.localRig.group);
    this.scene.add(this.remoteRoot);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  /** True if the last pointer interaction was a click (not a camera drag). */
  wasLastPointerClick(): boolean {
    return !this.dragMoved;
  }

  setLocalColor(hexColor: string): void {
    const col = new THREE.Color(hexColor);
    this.localRig.bodyMat.color.copy(col);
    this.localRig.bodyMat.emissive.copy(col);
    (this.localRig.haloMesh.material as THREE.MeshBasicMaterial).color.copy(col);
  }

  setWorldCollision(platforms: PlatformCollider[], terrainHeightFn: ((x: number, z: number) => number) | null): void {
    this.platforms = platforms;
    this.terrainHeightFn = terrainHeightFn;
  }

  applySpawn(spawn: SpawnPoint): void {
    this.position.set(spawn.position[0], spawn.position[1], spawn.position[2]);
    this.yaw = spawn.yaw;
    this.pitch = spawn.pitch ?? -0.14;
    this.velocityY = 0;
    this.setFlying(Boolean(spawn.flying));
    this.snapToGroundIfWalking();
    this.localRig.group.position.copy(this.position);
    this.localRig.group.rotation.y = this.yaw;
  }

  setFlying(flying: boolean): void {
    this.isFlying = flying;
    this.velocityY = 0;
    this.onFlightChange?.(flying);
  }

  toggleFlight(): void {
    this.setFlying(!this.isFlying);
  }

  updateCameraVisibility(): void {
    const horizontalDistance = Math.hypot(this.camera.position.x - this.position.x, this.camera.position.z - this.position.z);
    this.localRig.group.visible = !this.firstPerson && horizontalDistance > 0.9;
  }

  toggleCameraView(): void {
    this.firstPerson = !this.firstPerson;
    this.localRig.group.visible = !this.firstPerson;
  }

  /** Compute a position slightly in front of the avatar for placing a new portal. */
  getPointInFront(distance = 6.5): Vec3Tuple {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const x = this.position.x + fx * distance;
    const z = this.position.z + fz * distance;
    const groundY = this.isFlying ? Math.max(0, this.position.y - 1.5) : this.sampleSurfaceHeight(x, z);
    return [Number(x.toFixed(2)), Number(groundY.toFixed(2)), Number(z.toFixed(2))];
  }

  syncRemotePlayers(players: AvatarState[], localPlayerId: string): void {
    const activeIds = new Set<string>();
    for (const p of players) {
      if (p.id === localPlayerId) continue;
      activeIds.add(p.id);

      let vis = this.remoteMap.get(p.id);
      if (!vis) {
        const rig = createStylizedAvatarRig(p.color);
        const label = createFloatingLabel({
          title: p.name,
          accentColor: p.color,
          width: 2.4,
        });
        label.sprite.position.set(0, 2.38, 0);
        rig.group.add(label.sprite);
        rig.group.position.set(p.position[0], p.position[1], p.position[2]);
        this.remoteRoot.add(rig.group);
        vis = {
          group: rig.group,
          bodyMat: rig.bodyMat,
          haloMesh: rig.haloMesh,
          label,
          targetPos: new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
          targetYaw: p.yaw,
          name: p.name,
          color: p.color,
          dispose: () => {
            rig.dispose();
            label.dispose();
          },
        };
        this.remoteMap.set(p.id, vis);
      } else {
        vis.targetPos.set(p.position[0], p.position[1], p.position[2]);
        vis.targetYaw = p.yaw;
        if (vis.name !== p.name || vis.color !== p.color) {
          const col = new THREE.Color(p.color);
          vis.bodyMat.color.copy(col);
          vis.bodyMat.emissive.copy(col);
          (vis.haloMesh.material as THREE.MeshBasicMaterial).color.copy(col);
          vis.group.remove(vis.label.sprite);
          vis.label.dispose();
          const newLabel = createFloatingLabel({
            title: p.name,
            accentColor: p.color,
            width: 2.4,
          });
          newLabel.sprite.position.set(0, 2.38, 0);
          vis.group.add(newLabel.sprite);
          vis.label = newLabel;
          vis.name = p.name;
          vis.color = p.color;
        }
      }
    }

    for (const [id, vis] of this.remoteMap.entries()) {
      if (!activeIds.has(id)) {
        this.remoteRoot.remove(vis.group);
        vis.dispose();
        this.remoteMap.delete(id);
      }
    }
  }

  clearRemotePlayers(): void {
    for (const vis of this.remoteMap.values()) {
      this.remoteRoot.remove(vis.group);
      vis.dispose();
    }
    this.remoteMap.clear();
  }

  update(dt: number, elapsed: number, inputLocked: boolean): void {
    const clampedDt = Math.min(dt, 0.05);

    if (!inputLocked) {
      const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const strafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      if (this.isFlying) {
        const flySpeed = sprint ? 26 : 13.5;
        const verticalInput =
          (this.keys.has('Space') ? 1 : 0) -
          (this.keys.has('KeyC') || this.keys.has('KeyQ') || this.keys.has('ControlLeft') ? 1 : 0);

        // Fly along camera 3D look direction when holding W/S so diving into fountains feels effortless!
        const cosPitch = Math.cos(this.pitch);
        const moveX = fwdX * cosPitch * forward + rightX * strafe;
        const moveY = Math.sin(this.pitch) * forward + verticalInput;
        const moveZ = fwdZ * cosPitch * forward + rightZ * strafe;
        const moveLen = Math.hypot(moveX, moveY, moveZ);

        if (moveLen > 0.001) {
          this.position.x += (moveX / moveLen) * flySpeed * clampedDt;
          this.position.y += (moveY / moveLen) * flySpeed * clampedDt;
          this.position.z += (moveZ / moveLen) * flySpeed * clampedDt;
        }
        const floorY = this.sampleSurfaceHeight(this.position.x, this.position.z);
        if (this.position.y < floorY + 0.5) {
          this.position.y = floorY + 0.5;
        }
        this.velocityY = 0;
      } else {
        const moveSpeed = sprint ? RUN_SPEED : 8.2;
        let dx = fwdX * forward + rightX * strafe;
        let dz = fwdZ * forward + rightZ * strafe;
        const len = Math.hypot(dx, dz);
        if (len > 0.001) {
          dx /= len;
          dz /= len;
          this.position.x += dx * moveSpeed * clampedDt;
          this.position.z += dz * moveSpeed * clampedDt;
        }

        if (this.keys.has('Space') && this.onGround) {
          this.velocityY = 8.4;
          this.onGround = false;
        }

        this.velocityY -= 21.0 * clampedDt;
        this.position.y += this.velocityY * clampedDt;

        const floorY = this.sampleSurfaceHeight(this.position.x, this.position.z);
        if (this.position.y <= floorY) {
          this.position.y = floorY;
          this.velocityY = 0;
          this.onGround = true;
        } else {
          this.onGround = false;
        }
      }

      // Soft world boundary so nobody wanders into NaN void
      this.position.x = THREE.MathUtils.clamp(this.position.x, -95, 95);
      this.position.z = THREE.MathUtils.clamp(this.position.z, -95, 95);
      this.position.y = THREE.MathUtils.clamp(this.position.y, -10, 75);
    }

    // Update local avatar rig
    this.localRig.group.position.copy(this.position);
    if (this.isFlying) {
      this.localRig.group.position.y += Math.sin(elapsed * 3.0) * 0.14;
    }
    this.localRig.group.rotation.y = this.yaw;
    this.localRig.haloMesh.position.y = 1.82 + Math.sin(elapsed * 2.8) * 0.06;

    // Update camera (3rd person chase OR 1st person eye)
    const eyeY = this.position.y + 1.65;
    if (this.firstPerson) {
      this.camera.position.set(this.position.x, eyeY, this.position.z);
      const lookX = this.position.x - Math.sin(this.yaw) * Math.cos(this.pitch) * 10;
      const lookY = eyeY + Math.sin(this.pitch) * 10;
      const lookZ = this.position.z - Math.cos(this.yaw) * Math.cos(this.pitch) * 10;
      this.camera.lookAt(lookX, lookY, lookZ);
    } else {
      const camDist = this.isFlying ? 7.2 : 5.6;
      const camX = this.position.x + Math.sin(this.yaw) * Math.cos(this.pitch) * camDist;
      const camY = Math.max(
        this.sampleSurfaceHeight(this.position.x, this.position.z) + 0.65,
        eyeY - Math.sin(this.pitch) * camDist + 1.15,
      );
      const camZ = this.position.z + Math.cos(this.yaw) * Math.cos(this.pitch) * camDist;
      this.camera.position.lerp(new THREE.Vector3(camX, camY, camZ), Math.min(1, clampedDt * 12));
      const lookAhead = this.isFlying ? 12 : 4;
      this.camera.lookAt(
        this.position.x - Math.sin(this.yaw) * lookAhead,
        eyeY + Math.sin(this.pitch) * lookAhead * 0.7,
        this.position.z - Math.cos(this.yaw) * lookAhead,
      );
    }

    // Smoothly interpolate remote players
    const alpha = Math.min(1, clampedDt * 11);
    for (const vis of this.remoteMap.values()) {
      vis.group.position.lerp(vis.targetPos, alpha);
      const dyaw = Math.atan2(
        Math.sin(vis.targetYaw - vis.group.rotation.y),
        Math.cos(vis.targetYaw - vis.group.rotation.y),
      );
      vis.group.rotation.y += dyaw * alpha;
      vis.haloMesh.position.y = 1.82 + Math.sin(elapsed * 3.1) * 0.07;
    }
  }

  sampleSurfaceHeight(x: number, z: number): number {
    let bestY = this.terrainHeightFn ? this.terrainHeightFn(x, z) : 0;
    for (const p of this.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) {
        if (p.topY > bestY) bestY = p.topY;
      }
    }
    return bestY;
  }

  private snapToGroundIfWalking(): void {
    if (!this.isFlying) {
      const floorY = this.sampleSurfaceHeight(this.position.x, this.position.z);
      if (this.position.y < floorY) {
        this.position.y = floorY;
      }
    }
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'KeyV') this.toggleCameraView();
    if (e.code === 'KeyF') this.toggleFlight();
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 2) return;
    this.isDraggingLook = true;
    this.dragMoved = false;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (!this.isDraggingLook) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      this.dragMoved = true;
    }
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    this.yaw -= dx * 0.0055;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0045, -1.32, 1.15);
  };

  private readonly handlePointerUp = (): void => {
    this.isDraggingLook = false;
  };

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.clearRemotePlayers();
    this.scene.remove(this.localRig.group);
    this.scene.remove(this.remoteRoot);
    this.localRig.dispose();
  }
}
