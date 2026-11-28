import * as THREE from 'three/webgpu';
import type { RoomInstance } from '../engine/RoomInstance';
import { getNpcsForWorld } from './dialogueData';
import { getNpcPlacement } from './placements';
import { NpcActor } from './npcRig';
import type { NpcExpression, NpcGesture, NpcSpec } from './types';

export interface NpcManagerCallbacks {
  onNearbyNpcChange?: (npc: NpcSpec | null) => void;
}

const INTERACT_RADIUS = 5.4;
const AMBIENT_BARK_RADIUS = 10.5;
const AMBIENT_BARK_COOLDOWN_SEC = 14;

/**
 * Manages the active room's Keeper NPC(s): mounts them cleanly grounded on the
 * room's live terrain/platforms, triggers ambient approach barks in their custom
 * 3D speech bubble, detects talk proximity, and disposes cleanly on room switch.
 */
export class NpcManager {
  readonly root = new THREE.Group();
  private readonly callbacks: NpcManagerCallbacks;
  private actors: NpcActor[] = [];
  private nearestNpc: NpcActor | null = null;
  private activeDialogueNpcId: string | null = null;
  private readonly barkCooldowns = new Map<string, number>();
  private readonly barkIndices = new Map<string, number>();

  constructor(callbacks: NpcManagerCallbacks = {}) {
    this.callbacks = callbacks;
    this.root.name = 'portalverse-npcs';
  }

  mountForRoom(room: RoomInstance): void {
    this.clear();
    const worldId = room.module.manifest.id;
    const specs = getNpcsForWorld(worldId);
    if (specs.length === 0) return;

    for (const spec of specs) {
      const placement = spec.placement ?? getNpcPlacement(spec.id, worldId);
      const [x, baseY, z] = placement.position;
      const groundY = this.sampleRoomGround(room, x, z, baseY);

      const actor = new NpcActor(spec, [x, groundY, z], placement.yaw);
      this.root.add(actor.group);
      this.actors.push(actor);
      void actor.loadModel();
    }
  }

  getActors(): readonly NpcActor[] {
    return this.actors;
  }

  getNearestNpc(): NpcSpec | null {
    return this.nearestNpc?.spec ?? null;
  }

  getActiveActor(npcId?: string): NpcActor | null {
    if (npcId) return this.actors.find((a) => a.spec.id === npcId) ?? null;
    return this.nearestNpc ?? this.actors[0] ?? null;
  }

  setDialogueActive(npcId: string | null): void {
    this.activeDialogueNpcId = npcId;
    for (const actor of this.actors) {
      actor.setTalking(actor.spec.id === npcId);
    }
  }

  speak(
    npcId: string,
    text: string,
    expr: NpcExpression,
    gesture: NpcGesture = 'idle',
    durationSeconds?: number,
  ): void {
    const actor = this.actors.find((a) => a.spec.id === npcId);
    actor?.speak(text, expr, gesture, durationSeconds);
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3 | null): void {
    let closest: NpcActor | null = null;
    let closestDist = Infinity;

    for (const actor of this.actors) {
      actor.update(dt, elapsed, playerPos);

      if (!playerPos) continue;
      const p = actor.group.position;
      const dist = Math.hypot(playerPos.x - p.x, playerPos.z - p.z);
      const vertDist = Math.abs(playerPos.y - p.y);
      if (dist < INTERACT_RADIUS && vertDist < 4.5 && dist < closestDist) {
        closestDist = dist;
        closest = actor;
      }

      // Friendly ambient approach bark before dialogue opens (one active bark at a time per room)
      const anotherBarkActive = this.actors.some((other) => other !== actor && Boolean(other.bubble.getActiveMode()));
      if (
        !this.activeDialogueNpcId &&
        !anotherBarkActive &&
        dist < AMBIENT_BARK_RADIUS &&
        vertDist < 5.0 &&
        !actor.bubble.getActiveMode()
      ) {
        const nextAllowed = this.barkCooldowns.get(actor.spec.id) ?? 0;
        if (elapsed >= nextAllowed) {
          const idx = this.barkIndices.get(actor.spec.id) ?? 0;
          const bark = actor.spec.ambientBarks[idx % actor.spec.ambientBarks.length];
          this.barkIndices.set(actor.spec.id, idx + 1);
          this.barkCooldowns.set(actor.spec.id, elapsed + AMBIENT_BARK_COOLDOWN_SEC);
          actor.speak(bark, 'smile', 'wave', 5.2);
        }
      }
    }

    if (closest !== this.nearestNpc) {
      this.nearestNpc = closest;
      this.callbacks.onNearbyNpcChange?.(closest?.spec ?? null);
    }
  }

  clear(): void {
    for (const actor of this.actors) {
      this.root.remove(actor.group);
      actor.dispose();
    }
    this.actors = [];
    this.activeDialogueNpcId = null;
    if (this.nearestNpc) {
      this.nearestNpc = null;
      this.callbacks.onNearbyNpcChange?.(null);
    }
  }

  dispose(): void {
    this.clear();
  }

  private sampleRoomGround(room: RoomInstance, x: number, z: number, fallbackY: number): number {
    let bestY = -Infinity;
    if (room.terrainHeight) {
      const ty = room.terrainHeight(x, z, fallbackY + 0.5);
      if (Number.isFinite(ty)) bestY = ty;
    }
    for (const p of room.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) {
        if (p.topY > bestY) bestY = p.topY;
      }
    }
    return Number.isFinite(bestY) ? bestY : fallbackY;
  }
}
