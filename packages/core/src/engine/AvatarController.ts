import { RUN_SPEED } from '../portal/roomLayout';
import * as THREE from 'three/webgpu';
import type { AvatarState, PlatformCollider, RoomCollider, SpawnPoint, TerrainHeight, Vec3Tuple, WalkBounds } from '../types';
import {
  createCharacterRig,
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  IDLE_MOTION_STATE,
  type AvatarMotionState,
  type CharacterRig,
} from '../characters';
import {
  PLATFORMER_TUNING,
  createMovementState,
  resolveGround,
  stepMovement,
  turnMomentum,
  type MovementInput,
  type MovementMode,
} from './movement';
import { createFloatingLabel } from './signage';
import { FLOOR_LIMIT } from './falling';

interface RemoteAvatarVisual {
  rig: CharacterRig;
  label: { sprite: THREE.Sprite; dispose: () => void };
  targetPos: THREE.Vector3;
  prevPos: THREE.Vector3;
  targetYaw: number;
  prevYaw: number;
  velocityY: number;
  isFlying: boolean;
  motion: AvatarMotionState;
  name: string;
  color: string;
  characterId: string;
  dispose: () => void;
}

export interface StylizedAvatarRig {
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  dispose: () => void;
}

export function createStylizedAvatarRig(hexColor: string): StylizedAvatarRig {
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

  return {
    group,
    bodyMat,
    dispose: () => {
      bodyGeo.dispose();
      bodyMat.dispose();
      visorGeo.dispose();
      visorMat.dispose();
    },
  };
}

// Earth-style flight & jump feel tuned for Portalverse rooms:
// Space jumps (held = higher); pressing Space again while airborne takes off into flight.
// While flying: WASD steers along view, Q (or Space) rises, E sinks (hold E onto floor to land),
// Shift boosts smoothly and carries forward glide momentum when released.
const FLY_START_SPEED = 6.5;
const FLY_CRUISE_SPEED = 16.5;
const FLY_BOOST_SPEED = 31.0;
const FLY_CRUISE_RAMP = 2.4;
const FLY_BOOST_RAMP = 1.8;
const FLY_BOOST_DECEL = 1.6;
const FLY_ACCEL_RATE = 4.2;
const FLY_COAST_SLOW = 5.0;
const FLY_COAST_FAST = 1.6;
const FLY_TAKEOFF_UP = 7.2;
const FLY_ARMED_HEIGHT = 4.5;
const FLY_AUTO_LAND_HEIGHT = 1.8;

const JUMP_VELOCITY = 7.8;
const JUMP_GRAVITY = 20.0;
/** Walking stays on ground that drops away by less than this (downhill, stairs, sinking stones). */
const GROUND_SNAP = 0.3;
/** The player's size against a room's walls and columns (RoomCollider). */
const AVATAR_RADIUS = 0.35;
const AVATAR_HEIGHT = 1.8;
/** How far from a room's middle a player can wander unless the room says otherwise. */
const DEFAULT_WALK_BOUNDS: WalkBounds = { minX: -95, maxX: 95, minZ: -95, maxZ: 95 };
const JUMP_HOLD_FROM = 0.06;
const JUMP_HOLD_UNTIL = 0.34;

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class AvatarController {
  readonly position = new THREE.Vector3(0, 0, 10);
  yaw = 0;
  pitch = 0;
  velocityY = 0;
  isFlying = false;
  movementMode: MovementMode = 'classic';
  firstPerson = true;
  pointerLocked = false;

  private readonly keys = new Set<string>();
  private virtualForward = 0;
  private virtualStrafe = 0;
  private virtualVertical = 0;
  private virtualSprint = false;
  private virtualBoost = false;
  private virtualJumpHeld = false;
  private touchLookHandledExternally = false;
  private chaseLift = 0;
  private lookTurn?: { yaw: number; pitch: number; dyaw: number; dpitch: number; initialLift: number; start: number; duration: number };
  private activeDragPointerId: number | null = null;
  private readonly desiredCamPos = new THREE.Vector3();
  private readonly flyVel = new THREE.Vector3();
  private readonly takeoffDrift = new THREE.Vector3();
  private readonly stride = new THREE.Vector2();
  private takeoffDriftW = 0;
  private cruiseT = 0;
  private boostT = 0;
  private flyArmed = false;
  private jumpedInAir = false;
  private jumpT = 9;
  private inputLocked = false;
  private isDraggingLook = false;
  private dragMoved = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private onGround = true;
  /** Platformer timers; velocity and footing are copied from the fields above each step. */
  private readonly platformer = createMovementState();
  private pendingJumpPresses = 0;

  private localRig: CharacterRig;
  private localCharacterId: string;
  private localColor: string;
  private readonly localMotion: AvatarMotionState = { ...IDLE_MOTION_STATE };
  private readonly prevRigPos = new THREE.Vector3();
  private prevRigYaw = 0;
  private landImpact = 0;
  private groundSprintBlend = 0;
  private skipMotionSample = true;
  private readonly remoteMap = new Map<string, RemoteAvatarVisual>();
  private readonly remoteRoot = new THREE.Group();
  private platforms: PlatformCollider[] = [];
  private terrainHeightFn: TerrainHeight | null = null;
  private collider: RoomCollider | null = null;
  private bounds: WalkBounds = DEFAULT_WALK_BOUNDS;
  private lowestY = FLOOR_LIMIT;
  private onFlightChange?: (flying: boolean) => void;
  private onColorChange?: (hexColor: string) => void;
  private onCameraViewChange?: (firstPerson: boolean) => void;
  private onPointerLockChange?: (locked: boolean) => void;
  private onMovementModeChange?: (mode: MovementMode) => void;
  private onCharacterChange?: (characterId: string) => void;

  private readonly domElement: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    initialColor: string,
    onFlightChange?: (flying: boolean) => void,
    onColorChange?: (hexColor: string) => void,
    onCameraViewChange?: (firstPerson: boolean) => void,
    onPointerLockChange?: (locked: boolean) => void,
    onMovementModeChange?: (mode: MovementMode) => void,
    initialCharacterId: string = DEFAULT_CHARACTER_ID,
    onCharacterChange?: (characterId: string) => void,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.localColor = initialColor;
    this.localCharacterId = getCharacterDefinition(initialCharacterId).id;
    this.onFlightChange = onFlightChange;
    this.onColorChange = onColorChange;
    this.onCameraViewChange = onCameraViewChange;
    this.onPointerLockChange = onPointerLockChange;
    this.onMovementModeChange = onMovementModeChange;
    this.onCharacterChange = onCharacterChange;

    this.localRig = createCharacterRig(this.localCharacterId, { accentColor: initialColor });
    this.localRig.group.visible = !this.firstPerson;
    this.scene.add(this.localRig.group);
    this.scene.add(this.remoteRoot);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    this.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
  }

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
    if (locked) {
      this.lookTurn = undefined;
      this.keys.clear();
      this.clearVirtualInputs();
      this.flyVel.set(0, 0, 0);
      this.stride.set(0, 0);
      this.resetPlatformerTimers();
      this.isDraggingLook = false;
      this.activeDragPointerId = null;
      this.exitPointerLock();
    }
  }

  /** Set analog movement axes from touch joystick (-1..1). */
  setVirtualMove(forward: number, strafe: number, sprint = false): void {
    this.virtualForward = THREE.MathUtils.clamp(forward, -1, 1);
    this.virtualStrafe = THREE.MathUtils.clamp(strafe, -1, 1);
    this.virtualSprint = sprint;
  }

  /** Set vertical flight axis from touch Rise/Land buttons (-1 = descend/land, +1 = rise). */
  setVirtualVertical(vertical: number): void {
    this.virtualVertical = THREE.MathUtils.clamp(vertical, -1, 1);
  }

  /** Hold/release sprint/boost from a touch button. */
  setVirtualBoost(active: boolean): void {
    this.virtualBoost = active;
  }

  /** Trigger jump on ground or takeoff when pressed again mid-air (identical to Space). */
  pressJumpOrFly(): void {
    if (this.inputLocked) return;
    this.triggerJumpOrFly();
  }

  /** Hold/release virtual jump for variable jump height. */
  setJumpHeld(held: boolean): void {
    this.virtualJumpHeld = held;
  }

  /** Apply camera look delta from dedicated multi-touch look pad (pixels). */
  applyLookDelta(dx: number, dy: number, sensitivity = 0.0046): void {
    if (this.inputLocked) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (dx || dy) this.lookTurn = undefined;
    this.yaw -= dx * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sensitivity, -1.32, 1.15);
  }

  /** One short eased turn along the shortest yaw arc. Mouse or touch look takes over immediately. */
  turnToFace(target: THREE.Vector3): void {
    if (this.inputLocked) return;
    const x = target.x - this.position.x, z = target.z - this.position.z;
    const range = Math.hypot(x, z);
    const eyeY = this.position.y + 1.65;
    const heading = range > 1e-6 ? Math.atan2(-x, -z) : this.yaw;
    const dyaw = Math.atan2(Math.sin(heading - this.yaw), Math.cos(heading - this.yaw));
    let pitch = Math.atan2(target.y - eyeY, range);
    if (!this.firstPerson) {
      // The chase camera sits behind the avatar and its boom stops at the ground.
      // Solve for the orbit pitch that puts the target on its actual sightline.
      const back = this.isFlying ? 7.2 : 5.6, ahead = this.isFlying ? 12 : 4;
      const floor = this.sampleSurfaceHeight(this.position.x, this.position.z) + 0.65;
      let low = -1.32, high = 1.15;
      for (let i = 0; i < 14; i++) {
        pitch = (low + high) / 2;
        const cameraY = Math.max(floor, eyeY - Math.sin(pitch) * back + 1.15);
        const offset = Math.cos(pitch) * back;
        const aimY = eyeY + this.chaseRise(pitch, 1) * ahead;
        if ((aimY - cameraY) * (range + offset) < (target.y - cameraY) * (ahead + offset)) low = pitch;
        else high = pitch;
      }
    }
    const dpitch = THREE.MathUtils.clamp(pitch, -1.32, this.firstPerson ? 1.38 : 1.15) - this.pitch;
    const distance = Math.hypot(dyaw, dpitch);
    if (distance < 1e-5) { this.lookTurn = undefined; return; }
    this.lookTurn = { yaw: this.yaw, pitch: this.pitch, dyaw, dpitch,
      initialLift: this.chaseLift, start: performance.now(), duration: distance / THREE.MathUtils.degToRad(330) * 1000 };
  }

  private chaseRise(pitch: number, lift = this.chaseLift): number {
    // Once the boom nears the ground, continue tilting the view up over the character.
    return Math.sin(pitch) * 0.7 + lift * 3 * Math.max(0, pitch - 0.65) ** 2;
  }

  /** When mobile touch controls own multi-touch look, ignore raw touch drags on the canvas. */
  setTouchLookHandled(handled: boolean): void {
    this.touchLookHandledExternally = handled;
  }

  /** True if currently sprinting via keyboard or touch controls. */
  isSprinting(): boolean {
    return (
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.virtualSprint ||
      this.virtualBoost
    );
  }

  clearVirtualInputs(): void {
    this.virtualForward = 0;
    this.virtualStrafe = 0;
    this.virtualVertical = 0;
    this.virtualSprint = false;
    this.virtualBoost = false;
    this.virtualJumpHeld = false;
  }

  requestPointerLock(): void {
    if (this.inputLocked || this.pointerLocked) return;
    if (typeof this.domElement.requestPointerLock !== 'function') return;
    try {
      const maybePromise = this.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          // Ignore rejected pointer lock requests (e.g. Esc cooldown or unsupported context)
        });
      }
    } catch {
      // Ignore pointer lock errors on unsupported platforms
    }
  }

  exitPointerLock(): void {
    if (typeof document === 'undefined') return;
    if (document.pointerLockElement === this.domElement && typeof document.exitPointerLock === 'function') {
      try {
        document.exitPointerLock();
      } catch {
        // Ignore
      }
    }
  }

  /** True if the last pointer interaction was a click (not a camera drag). */
  wasLastPointerClick(): boolean {
    return !this.dragMoved;
  }

  getLocalColor(): string {
    return this.localColor;
  }

  setLocalColor(hexColor: string): void {
    this.localColor = hexColor;
    this.localRig.setAccentColor?.(hexColor);
    this.onColorChange?.(hexColor);
  }

  getCharacterId(): string {
    return this.localCharacterId;
  }

  setCharacter(characterId: string): void {
    const resolved = getCharacterDefinition(characterId).id;
    if (resolved === this.localCharacterId) return;
    this.localCharacterId = resolved;

    const wasVisible = this.localRig.group.visible;
    this.scene.remove(this.localRig.group);
    this.localRig.dispose();

    this.localRig = createCharacterRig(resolved, { accentColor: this.localColor });
    this.localRig.group.position.copy(this.position);
    this.localRig.group.rotation.y = this.yaw;
    this.localRig.group.visible = wasVisible;
    this.localRig.update(0, 0, this.localMotion);
    this.scene.add(this.localRig.group);
    this.onCharacterChange?.(resolved);
  }

  getMotionState(): Readonly<AvatarMotionState> {
    return this.localMotion;
  }

  /** `lowestY` is as far down as the player can go; rooms that allow falling pass something deep. */
  setWorldCollision(
    platforms: PlatformCollider[],
    terrainHeightFn: TerrainHeight | null,
    lowestY = FLOOR_LIMIT,
    collider: RoomCollider | null = null,
    bounds: WalkBounds | null = null,
  ): void {
    this.lookTurn = undefined;
    this.chaseLift = 0;
    this.platforms = platforms;
    this.terrainHeightFn = terrainHeightFn;
    this.lowestY = lowestY;
    this.collider = collider;
    this.bounds = bounds ?? DEFAULT_WALK_BOUNDS;
  }

  /** Push this step out of the room's walls and columns (`from` is where the feet were before it). */
  private collide(fromX: number, fromY: number, fromZ: number): void {
    if (!this.collider) return;
    const p = this.position;
    const [x, z] = this.collider.move([fromX, fromY, fromZ], [p.x, p.y, p.z], AVATAR_RADIUS, AVATAR_HEIGHT);
    if (Number.isFinite(x) && Number.isFinite(z)) {
      p.x = x;
      p.z = z;
    }
  }

  applySpawn(spawn: SpawnPoint): void {
    this.lookTurn = undefined;
    this.chaseLift = 0;
    this.position.set(spawn.position[0], spawn.position[1], spawn.position[2]);
    this.yaw = spawn.yaw;
    this.pitch = spawn.pitch ?? (this.firstPerson ? 0 : -0.14);
    this.velocityY = 0;
    this.setFlying(Boolean(spawn.flying));
    this.snapToGroundIfWalking();
    this.skipMotionSample = true;
    this.prevRigPos.copy(this.position);
    this.prevRigYaw = this.yaw;
    this.syncRigTransform();
    this.snapCameraToTarget();
  }

  syncRigTransform(elapsed = 0): void {
    this.localRig.group.position.copy(this.position);
    this.localRig.group.rotation.y = this.yaw;
    this.localRig.update(0, elapsed, this.localMotion);
  }

  snapCameraToTarget(): void {
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
      this.camera.position.set(camX, camY, camZ);
      const lookAhead = this.isFlying ? 12 : 4;
      this.camera.lookAt(
        this.position.x - Math.sin(this.yaw) * lookAhead,
        eyeY + this.chaseRise(this.pitch) * lookAhead,
        this.position.z - Math.cos(this.yaw) * lookAhead,
      );
    }
  }

  setFlying(flying: boolean, carryVelocity?: THREE.Vector3): void {
    const changed = this.isFlying !== flying;
    this.isFlying = flying;
    this.flyArmed = false;
    this.takeoffDriftW = 0;
    this.cruiseT = 0;
    this.boostT = 0;
    this.resetPlatformerTimers();
    if (flying) {
      this.jumpedInAir = false;
      this.onGround = false;
      this.velocityY = 0;
      if (carryVelocity) {
        this.flyVel.copy(carryVelocity);
      } else {
        this.flyVel.set(0, 0, 0);
      }
    } else {
      this.flyVel.set(0, 0, 0);
      if (carryVelocity) {
        this.stride.set(carryVelocity.x, carryVelocity.z);
        this.velocityY = carryVelocity.y;
        this.onGround = false;
      } else {
        this.stride.set(0, 0);
        this.velocityY = 0;
      }
      this.jumpedInAir = false;
    }
    if (changed) {
      this.onFlightChange?.(flying);
    }
  }

  toggleFlight(): void {
    if (this.isFlying) {
      this.setFlying(false);
    } else {
      this.takeOff();
    }
  }

  private takeOff(): void {
    const carry = new THREE.Vector3(this.stride.x, FLY_TAKEOFF_UP, this.stride.y);
    this.setFlying(true, carry);
    this.takeoffDrift.copy(carry);
    this.takeoffDriftW = 1;
  }

  setMovementMode(mode: MovementMode): void {
    if (mode === this.movementMode) return;
    this.movementMode = mode;
    this.resetPlatformerTimers();
    this.onMovementModeChange?.(mode);
  }

  toggleMovementMode(): void {
    this.setMovementMode(this.movementMode === 'classic' ? 'platformer' : 'classic');
  }

  /** Keep Platformer momentum pointing the same way relative to the player through a portal. */
  turnMomentum(yawDelta: number): void {
    if (this.movementMode !== 'platformer') return;
    const state = this.platformer;
    state.velocity.x = this.stride.x;
    state.velocity.z = this.stride.y;
    turnMomentum(state, yawDelta);
    this.stride.set(state.velocity.x, state.velocity.z);
  }

  private resetPlatformerTimers(): void {
    this.platformer.coyote = 0;
    this.platformer.jumpBuffer = 0;
    this.platformer.gaitSpeed = 0;
    this.pendingJumpPresses = 0;
  }

  private triggerJumpOrFly(): void {
    if (this.isFlying) return;
    const air = !this.onGround || this.velocityY > 0.1;
    // Pressing Space again while airborne off a jump launches straight into flight (Earth repo feel).
    if (air && this.jumpedInAir) {
      this.takeOff();
      return;
    }
    // Platformer jumps happen in its movement step, which also allows late and early presses.
    if (this.movementMode === 'platformer') {
      this.pendingJumpPresses++;
    } else if (!air) {
      this.velocityY = JUMP_VELOCITY;
      this.onGround = false;
      this.jumpedInAir = true;
      this.jumpT = 0;
    }
  }

  updateCameraVisibility(): void {
    const horizontalDistance = Math.hypot(this.camera.position.x - this.position.x, this.camera.position.z - this.position.z);
    this.localRig.group.visible = !this.firstPerson && horizontalDistance > 0.55;
  }

  setFirstPerson(firstPerson: boolean): void {
    if (this.firstPerson === firstPerson) return;
    this.lookTurn = undefined;
    this.chaseLift = 0;
    this.firstPerson = firstPerson;
    this.localRig.group.visible = !this.firstPerson;
    this.onCameraViewChange?.(this.firstPerson);
  }

  toggleCameraView(): void {
    this.setFirstPerson(!this.firstPerson);
  }

  /** Compute a position slightly in front of the avatar for placing a new portal. */
  getPointInFront(distance = 6.5): Vec3Tuple {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const x = this.position.x + fx * distance;
    const z = this.position.z + fz * distance;
    const floorY = this.sampleSurfaceHeight(x, z);
    // Over a drop with no ground, put the portal at the player's height instead.
    const groundY = this.isFlying ? Math.max(0, this.position.y - 1.5) : Number.isFinite(floorY) ? floorY : this.position.y;
    return [Number(x.toFixed(2)), Number(groundY.toFixed(2)), Number(z.toFixed(2))];
  }

  syncRemotePlayers(players: AvatarState[], localPlayerId: string): void {
    const activeIds = new Set<string>();
    for (const p of players) {
      if (p.id === localPlayerId) continue;
      activeIds.add(p.id);

      const charDef = getCharacterDefinition(p.characterId);
      let vis = this.remoteMap.get(p.id);
      if (!vis) {
        const rig = charDef.createRig({ accentColor: p.color });
        const label = createFloatingLabel({
          title: p.name,
          accentColor: p.color,
          width: 2.4,
        });
        label.sprite.position.set(0, charDef.labelHeight, 0);
        rig.group.add(label.sprite);
        rig.group.position.set(p.position[0], p.position[1], p.position[2]);
        rig.group.rotation.y = p.yaw;
        this.remoteRoot.add(rig.group);
        const startPos = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
        vis = {
          rig,
          label,
          targetPos: startPos.clone(),
          prevPos: startPos.clone(),
          targetYaw: p.yaw,
          prevYaw: p.yaw,
          velocityY: p.velocityY,
          isFlying: Boolean(p.isFlying),
          motion: { ...IDLE_MOTION_STATE, isFlying: Boolean(p.isFlying), grounded: !p.isFlying },
          name: p.name,
          color: p.color,
          characterId: charDef.id,
          dispose: () => {
            vis!.rig.dispose();
            vis!.label.dispose();
          },
        };
        this.remoteMap.set(p.id, vis);
      } else {
        vis.targetPos.set(p.position[0], p.position[1], p.position[2]);
        vis.targetYaw = p.yaw;
        vis.velocityY = p.velocityY;
        if (typeof p.isFlying === 'boolean') vis.isFlying = p.isFlying;

        if (vis.characterId !== charDef.id) {
          const oldGroup = vis.rig.group;
          const pos = oldGroup.position.clone();
          const yaw = oldGroup.rotation.y;
          oldGroup.remove(vis.label.sprite);
          this.remoteRoot.remove(oldGroup);
          vis.rig.dispose();

          const newRig = charDef.createRig({ accentColor: p.color });
          newRig.group.position.copy(pos);
          newRig.group.rotation.y = yaw;
          vis.label.sprite.position.set(0, charDef.labelHeight, 0);
          newRig.group.add(vis.label.sprite);
          this.remoteRoot.add(newRig.group);
          vis.rig = newRig;
          vis.characterId = charDef.id;
        }

        if (vis.name !== p.name || vis.color !== p.color) {
          vis.rig.setAccentColor?.(p.color);
          vis.rig.group.remove(vis.label.sprite);
          vis.label.dispose();
          const newLabel = createFloatingLabel({
            title: p.name,
            accentColor: p.color,
            width: 2.4,
          });
          newLabel.sprite.position.set(0, charDef.labelHeight, 0);
          vis.rig.group.add(newLabel.sprite);
          vis.label = newLabel;
          vis.name = p.name;
          vis.color = p.color;
        }
      }
    }

    for (const [id, vis] of this.remoteMap.entries()) {
      if (!activeIds.has(id)) {
        this.remoteRoot.remove(vis.rig.group);
        vis.dispose();
        this.remoteMap.delete(id);
      }
    }
  }

  clearRemotePlayers(): void {
    for (const vis of this.remoteMap.values()) {
      this.remoteRoot.remove(vis.rig.group);
      vis.dispose();
    }
    this.remoteMap.clear();
  }

  update(dt: number, elapsed: number, inputLocked: boolean): void {
    if (inputLocked) this.lookTurn = undefined;
    const turn = this.lookTurn;
    if (turn) {
      const t = Math.min(1, (performance.now() - turn.start) / turn.duration);
      const ease = t * t * (3 - 2 * t);
      this.yaw = turn.yaw + turn.dyaw * ease;
      this.pitch = turn.pitch + turn.dpitch * ease;
      if (!this.firstPerson) this.chaseLift = THREE.MathUtils.lerp(turn.initialLift, 1, ease);
      if (t === 1) this.lookTurn = undefined;
    }
    if (!this.lookTurn && this.pitch <= 0.65) this.chaseLift = 0;
    const clampedDt = Math.min(dt, 0.05);
    const jumpPresses = this.pendingJumpPresses;
    this.pendingJumpPresses = 0;
    const wasGrounded = this.onGround;
    const prevVelY = this.velocityY;

    if (inputLocked && this.movementMode === 'platformer') {
      this.stride.set(0, 0);
      this.resetPlatformerTimers();
    }

    if (!inputLocked) {
      const keyForward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const keyStrafe = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      const forward = THREE.MathUtils.clamp(keyForward + this.virtualForward, -1, 1);
      const strafe = THREE.MathUtils.clamp(keyStrafe + this.virtualStrafe, -1, 1);
      const sprint =
        this.keys.has('ShiftLeft') ||
        this.keys.has('ShiftRight') ||
        this.virtualSprint ||
        this.virtualBoost;
      const jumpHeld = this.keys.has('Space') || this.virtualJumpHeld;

      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      if (this.isFlying) {
        // Earth-style flight: WASD/stick steers along view, Q (or Space) rises, E sinks & lands onto floor,
        // Shift/Boost boosts smoothly (holding Shift/Boost alone flies forward where you look).
        const riseInput = this.keys.has('KeyQ') || this.keys.has('Space') || this.virtualJumpHeld ? 1 : 0;
        const sinkInput = this.keys.has('KeyE') || this.keys.has('ControlLeft') ? 1 : 0;
        const verticalInput = THREE.MathUtils.clamp(riseInput - sinkInput + this.virtualVertical, -1, 1);

        let fwdInput = forward;
        const moving = Math.abs(fwdInput) > 0.05 || Math.abs(strafe) > 0.05 || Math.abs(verticalInput) > 0.05;
        if (sprint && !moving) fwdInput = 1;

        this.cruiseT = sprint
          ? FLY_CRUISE_RAMP
          : THREE.MathUtils.clamp(this.cruiseT + (moving ? clampedDt : -clampedDt * 1.6), 0, FLY_CRUISE_RAMP);
        this.boostT = THREE.MathUtils.clamp(
          this.boostT + (sprint ? clampedDt / FLY_BOOST_RAMP : -clampedDt / FLY_BOOST_DECEL),
          0,
          1,
        );

        const cruiseK = smoothstep(0, 1, this.cruiseT / FLY_CRUISE_RAMP);
        const boostK = smoothstep(0, 1, this.boostT);
        const cruiseSpeed = FLY_START_SPEED + (FLY_CRUISE_SPEED - FLY_START_SPEED) * cruiseK;
        let targetSpeed = cruiseSpeed + (FLY_BOOST_SPEED - cruiseSpeed) * boostK;

        const floorNow = this.sampleSurfaceHeight(this.position.x, this.position.z);
        const heightAboveFloor = Math.max(0, this.position.y - floorNow);
        // Holding E alone to descend eases gently as the floor nears.
        if (verticalInput < -0.3 && Math.abs(fwdInput) < 0.1 && Math.abs(strafe) < 0.1 && !sprint) {
          targetSpeed = Math.min(targetSpeed, 4.0 + 0.45 * heightAboveFloor);
        }

        const cosPitch = Math.cos(this.pitch);
        let dirX = fwdX * cosPitch * fwdInput + rightX * strafe;
        let dirY = Math.sin(this.pitch) * fwdInput + verticalInput;
        let dirZ = fwdZ * cosPitch * fwdInput + rightZ * strafe;
        const dirLen = Math.hypot(dirX, dirY, dirZ);
        if (dirLen > 1) {
          dirX /= dirLen;
          dirY /= dirLen;
          dirZ /= dirLen;
        }

        const wantX = dirX * targetSpeed;
        const wantY = dirY * targetSpeed;
        const wantZ = dirZ * targetSpeed;
        const prevSpeed = this.flyVel.length();
        const wantSpeed = Math.hypot(wantX, wantY, wantZ);
        const rate =
          prevSpeed > wantSpeed + 0.05
            ? FLY_COAST_SLOW + (FLY_COAST_FAST - FLY_COAST_SLOW) * smoothstep(4, 24, prevSpeed)
            : FLY_ACCEL_RATE;

        this.flyVel.x = damp(this.flyVel.x, wantX, rate, clampedDt);
        this.flyVel.y = damp(this.flyVel.y, wantY, rate, clampedDt);
        this.flyVel.z = damp(this.flyVel.z, wantZ, rate, clampedDt);

        if (this.takeoffDriftW > 0) {
          this.flyVel.lerp(this.takeoffDrift, this.takeoffDriftW);
          this.takeoffDriftW = this.takeoffDriftW < 0.01 ? 0 : this.takeoffDriftW * Math.exp(-clampedDt / 0.55);
        }

        const fromX = this.position.x, fromZ = this.position.z;
        this.position.x += this.flyVel.x * clampedDt;
        this.position.z += this.flyVel.z * clampedDt;
        this.collide(fromX, this.position.y, fromZ);

        const floorY = this.sampleSurfaceHeight(this.position.x, this.position.z);
        this.position.y += this.flyVel.y * clampedDt;
        const overFloor = this.position.y - floorY;
        if (overFloor > FLY_ARMED_HEIGHT) this.flyArmed = true;

        // Holding E onto the floor lands cleanly on foot.
        if (verticalInput < -0.5 && overFloor <= 0.35) {
          this.position.y = floorY;
          this.setFlying(false);
          this.onGround = true;
        } else if (this.flyArmed && this.flyVel.y < -0.5 && overFloor < FLY_AUTO_LAND_HEIGHT) {
          // Diving down near the ground after flying high releases flight and lands smoothly with momentum.
          const carry = this.flyVel.clone();
          this.position.y = Math.max(this.position.y, floorY);
          this.setFlying(false, carry);
        } else if (overFloor < 0.35 && verticalInput >= 0) {
          // Gentle hover cushion while skimming low without holding E.
          this.position.y = floorY + 0.35;
          if (this.flyVel.y < 0) this.flyVel.y = 0;
        }
        this.velocityY = this.isFlying ? this.flyVel.y : this.velocityY;
      } else if (this.movementMode === 'platformer') {
        const dx = fwdX * forward + rightX * strafe;
        const dz = fwdZ * forward + rightZ * strafe;
        const len = Math.hypot(dx, dz);
        const norm = len > 1 ? len : 1;
        this.updatePlatformer(
          { x: dx / norm, z: dz / norm, sprint, jumpHeld, jumpPressed: jumpPresses > 0 },
          clampedDt,
        );
        if (jumpPresses > 1 && this.jumpedInAir) this.takeOff();
      } else {
        this.jumpT += clampedDt;
        const moveSpeed = sprint ? RUN_SPEED : 8.2;
        let dx = fwdX * forward + rightX * strafe;
        let dz = fwdZ * forward + rightZ * strafe;
        const len = Math.hypot(dx, dz);
        if (len > 1) {
          dx /= len;
          dz /= len;
        }
        const wantX = dx * moveSpeed;
        const wantZ = dz * moveSpeed;
        const carried = !this.onGround && this.stride.length() > RUN_SPEED + 0.5;
        const strideRate = carried ? 1.4 : len > 0.01 ? 11.0 : 12.0;
        this.stride.x = damp(this.stride.x, wantX, strideRate, clampedDt);
        this.stride.y = damp(this.stride.y, wantZ, strideRate, clampedDt);

        const fromX = this.position.x, fromZ = this.position.z;
        this.position.x += this.stride.x * clampedDt;
        this.position.z += this.stride.y * clampedDt;
        this.collide(fromX, this.position.y, fromZ);

        // Holding Space briefly through the initial rise extends jump height (Earth repo feel).
        const holdingJump =
          this.velocityY > 0 &&
          this.jumpT > JUMP_HOLD_FROM &&
          this.jumpT < JUMP_HOLD_UNTIL &&
          jumpHeld;
        if (!holdingJump) {
          this.velocityY -= JUMP_GRAVITY * clampedDt;
        }
        const floorY = this.sampleSurfaceHeight(this.position.x, this.position.z);
        this.position.y += this.velocityY * clampedDt;
        // Walking (not jumping) follows ground that falls away a little (scaled slightly for steep slopes at low FPS).
        const stepHoriz = Math.hypot(this.position.x - fromX, this.position.z - fromZ);
        const snap = Math.min(0.55, Math.max(GROUND_SNAP, stepHoriz * 0.75));
        const follows = this.onGround && this.velocityY <= 0 && this.position.y - floorY <= snap;
        if (this.position.y <= floorY || follows) {
          this.position.y = floorY;
          this.velocityY = 0;
          this.onGround = true;
          this.jumpedInAir = false;
        } else {
          this.onGround = false;
        }
      }

      // Soft world boundary so nobody wanders into NaN void
      const boundedX = THREE.MathUtils.clamp(this.position.x, this.bounds.minX, this.bounds.maxX);
      const boundedZ = THREE.MathUtils.clamp(this.position.z, this.bounds.minZ, this.bounds.maxZ);
      if (this.movementMode === 'platformer') {
        if (boundedX !== this.position.x) this.stride.x = 0;
        if (boundedZ !== this.position.z) this.stride.y = 0;
      }
      this.position.x = boundedX;
      this.position.z = boundedZ;
      this.position.y = THREE.MathUtils.clamp(this.position.y, this.lowestY, 75);
    }

    // Compute rich per-frame motion telemetry for character rigging & shaders
    if (!wasGrounded && this.onGround && !this.isFlying) {
      this.landImpact = THREE.MathUtils.clamp(Math.abs(prevVelY) / 14, 0.25, 1.0);
    } else {
      this.landImpact = Math.max(0, this.landImpact - clampedDt * 4.5);
    }

    let vx = 0;
    let vz = 0;
    let turnRate = 0;
    if (this.skipMotionSample || clampedDt <= 1e-5) {
      this.skipMotionSample = false;
    } else {
      const dx = this.position.x - this.prevRigPos.x;
      const dz = this.position.z - this.prevRigPos.z;
      const stepDist = Math.hypot(dx, dz);
      // Ignore portal-crossing teleports when computing locomotion velocity
      if (stepDist < 4.5) {
        vx = dx / clampedDt;
        vz = dz / clampedDt;
      }
      const dyaw = Math.atan2(
        Math.sin(this.yaw - this.prevRigYaw),
        Math.cos(this.yaw - this.prevRigYaw),
      );
      if (Math.abs(dyaw) < 1.2) {
        turnRate = dyaw / clampedDt;
      }
    }
    this.prevRigPos.copy(this.position);
    this.prevRigYaw = this.yaw;

    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const speed = Math.hypot(vx, vz);
    const speedNorm = speed / RUN_SPEED;
    const targetGroundSprint =
      !this.isFlying && this.onGround && !inputLocked && this.isSprinting() && speedNorm > 0.5
        ? 1
        : 0;
    this.groundSprintBlend = damp(this.groundSprintBlend, targetGroundSprint, 8.0, clampedDt);

    this.localMotion.speed = speed;
    this.localMotion.speedNorm = speedNorm;
    this.localMotion.forwardSpeed = vx * fwdX + vz * fwdZ;
    this.localMotion.strafeSpeed = vx * rightX + vz * rightZ;
    this.localMotion.velocityY = this.velocityY;
    this.localMotion.turnRate = turnRate;
    this.localMotion.grounded = this.onGround && !this.isFlying;
    this.localMotion.isFlying = this.isFlying;
    this.localMotion.boost = this.isFlying ? this.boostT : this.groundSprintBlend;
    this.localMotion.pitch = this.pitch;
    this.localMotion.landImpact = this.landImpact;

    // Update local avatar rig
    this.localRig.group.position.copy(this.position);
    this.localRig.group.rotation.y = this.yaw;
    this.localRig.update(clampedDt, elapsed, this.localMotion);

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
      this.desiredCamPos.set(camX, camY, camZ);
      this.camera.position.lerp(this.desiredCamPos, Math.min(1, clampedDt * 12));
      const lookAhead = this.isFlying ? 12 : 4;
      this.camera.lookAt(
        this.position.x - Math.sin(this.yaw) * lookAhead,
        eyeY + this.chaseRise(this.pitch) * lookAhead,
        this.position.z - Math.cos(this.yaw) * lookAhead,
      );
    }

    // Smoothly interpolate & animate remote players
    const alpha = Math.min(1, clampedDt * 11);
    for (const vis of this.remoteMap.values()) {
      vis.rig.group.position.lerp(vis.targetPos, alpha);
      const dyaw = Math.atan2(
        Math.sin(vis.targetYaw - vis.rig.group.rotation.y),
        Math.cos(vis.targetYaw - vis.rig.group.rotation.y),
      );
      vis.rig.group.rotation.y += dyaw * alpha;

      const rdx = vis.rig.group.position.x - vis.prevPos.x;
      const rdz = vis.rig.group.position.z - vis.prevPos.z;
      const rvx = clampedDt > 1e-5 ? rdx / clampedDt : 0;
      const rvz = clampedDt > 1e-5 ? rdz / clampedDt : 0;
      const rSpeed = Math.hypot(rvx, rvz);
      const rYaw = vis.rig.group.rotation.y;
      const rFwdX = -Math.sin(rYaw);
      const rFwdZ = -Math.cos(rYaw);
      const rRightX = Math.cos(rYaw);
      const rRightZ = -Math.sin(rYaw);
      const rTurn =
        clampedDt > 1e-5
          ? Math.atan2(Math.sin(rYaw - vis.prevYaw), Math.cos(rYaw - vis.prevYaw)) / clampedDt
          : 0;

      vis.prevPos.copy(vis.rig.group.position);
      vis.prevYaw = rYaw;

      vis.motion.speed = rSpeed;
      vis.motion.speedNorm = rSpeed / RUN_SPEED;
      vis.motion.forwardSpeed = rvx * rFwdX + rvz * rFwdZ;
      vis.motion.strafeSpeed = rvx * rRightX + rvz * rRightZ;
      vis.motion.velocityY = vis.velocityY;
      vis.motion.turnRate = rTurn;
      vis.motion.isFlying = vis.isFlying;
      vis.motion.grounded = !vis.isFlying && Math.abs(vis.velocityY) < 0.35;
      vis.motion.boost = vis.isFlying && rSpeed > FLY_CRUISE_SPEED + 2 ? 0.85 : 0;
      vis.motion.pitch = 0;
      vis.motion.landImpact = 0;
      vis.rig.update(clampedDt, elapsed, vis.motion);
    }
  }

  private updatePlatformer(input: MovementInput, dt: number): void {
    const state = this.platformer;
    state.velocity.x = this.stride.x;
    state.velocity.y = this.velocityY;
    state.velocity.z = this.stride.y;
    state.grounded = this.onGround;

    const move = stepMovement(state, input, PLATFORMER_TUNING, dt);
    // Only a jump raises vertical speed. Remember it so that another press in mid-air takes off.
    if (state.velocity.y > Math.max(0, this.velocityY)) this.jumpedInAir = true;

    const fromX = this.position.x, fromZ = this.position.z;
    this.position.x += move.x;
    this.position.z += move.z;
    this.collide(fromX, this.position.y, fromZ);
    const floorY = this.sampleSurfaceHeight(this.position.x, this.position.z);
    const stepHoriz = Math.hypot(this.position.x - fromX, this.position.z - fromZ);
    const snap = Math.min(0.55, Math.max(PLATFORMER_TUNING.groundSnap, stepHoriz * 0.75));
    this.position.y = resolveGround(state, this.position.y + move.y, floorY, snap);

    this.stride.set(state.velocity.x, state.velocity.z);
    this.velocityY = state.velocity.y;
    this.onGround = state.grounded;
    if (this.onGround) this.jumpedInAir = false;
  }

  sampleSurfaceHeight(x: number, z: number): number {
    let bestY = this.terrainHeightFn ? this.terrainHeightFn(x, z, this.position.y) : 0;
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
      this.onGround = Number.isFinite(floorY) && this.position.y <= floorY + 0.05;
    }
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (this.inputLocked) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'Space' && !e.repeat) this.triggerJumpOrFly();
    if (e.code === 'KeyG' && !e.repeat && !e.ctrlKey && !e.metaKey) this.toggleMovementMode();
    if (e.code === 'KeyV' && !e.repeat) this.toggleCameraView();
    if (e.code === 'KeyF' && !e.repeat) this.toggleFlight();
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly handleWindowBlur = (): void => {
    this.lookTurn = undefined;
    this.keys.clear();
    if (this.movementMode === 'platformer') this.stride.set(0, 0);
    this.resetPlatformerTimers();
    this.isDraggingLook = false;
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.domElement;
    if (locked === this.pointerLocked) return;
    this.pointerLocked = locked;
    if (locked) {
      this.isDraggingLook = false;
    }
    this.onPointerLockChange?.(locked);
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (this.inputLocked) return;
    if (e.pointerType === 'touch' && this.touchLookHandledExternally) return;
    if (e.button !== 0 && e.button !== 2) return;
    if (e.button === 0 && !this.pointerLocked && e.pointerType !== 'touch') {
      this.requestPointerLock();
    }
    this.isDraggingLook = true;
    this.activeDragPointerId = e.pointerId;
    this.dragMoved = false;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (this.inputLocked) return;
    if (this.pointerLocked) {
      const dx = e.movementX;
      const dy = e.movementY;
      // Ignore occasional browser focus-change spikes in pointer lock deltas.
      if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;
      if (dx || dy) this.lookTurn = undefined;
      this.yaw -= dx * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.38, 1.38);
      return;
    }
    if (!this.isDraggingLook) return;
    if (this.activeDragPointerId !== null && e.pointerId !== this.activeDragPointerId) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      this.dragMoved = true;
    }
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (dx || dy) this.lookTurn = undefined;
    this.yaw -= dx * 0.0055;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0045, -1.32, 1.15);
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (this.activeDragPointerId !== null && e.pointerId !== this.activeDragPointerId) return;
    this.isDraggingLook = false;
    this.activeDragPointerId = null;
  };

  dispose(): void {
    this.exitPointerLock();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.clearRemotePlayers();
    this.scene.remove(this.localRig.group);
    this.scene.remove(this.remoteRoot);
    this.localRig.dispose();
  }
}
