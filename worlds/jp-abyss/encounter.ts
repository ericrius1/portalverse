import * as THREE from 'three/webgpu';
import { disposeObject, groundModel, loadGLB } from '@portalverse/core/rooms/kit';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import shadowUrl from './assets/shadow-man.glb?url';
import { stoneMotion, type Stone } from './path';
import { applyPose, readPose, type EncounterPlacement } from './placement';

// Stable index in buildStrayStones(seed 8). This is the broad slab beyond JP's final jump.
export const TREASURE_STRAY = 30;

export async function loadEncounter(stone: Stone, placement: EncounterPlacement) {
  return new ChestEncounter(stone, placement, await loadGLB(shadowUrl));
}

export class ChestEncounter {
  readonly anchor = new THREE.Group();
  readonly chest = new THREE.Group();
  readonly shadow = new THREE.Group();
  private readonly normal = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly materials = new Set<THREE.Material>();
  private readonly mixer: THREE.AnimationMixer;
  private readonly action: THREE.AnimationAction;
  private age: number | undefined;
  private standing = false;
  private editing = false;

  constructor(private stone: Stone, placement: EncounterPlacement, shadow: GLTF) {
    this.anchor.name = 'Treasure island surface';
    this.chest.name = 'Treasure chest';
    this.shadow.name = 'Shadow Man spawn';
    // The invisible chest anchor preserves the exported shadow pose on the drifting surface.
    this.anchor.add(this.chest);
    this.chest.add(this.shadow);
    applyPose(this.chest, placement.chest);
    applyPose(this.shadow, placement.shadow);

    // Measure the first pose only. The artist animated forward motion into the morph targets.
    const apparition = groundModel(shadow.scene, true);
    apparition.scale.setScalar(0.012);
    this.shadow.add(apparition);
    shadow.scene.traverse(object => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      mesh.frustumCulled = false;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.transparent = true;
        material.depthWrite = false;
        if ('emissive' in material) (material as THREE.MeshStandardMaterial).emissive.setHex(0x20182d);
        this.materials.add(material);
      }
    });
    this.mixer = new THREE.AnimationMixer(shadow.scene);
    this.action = this.mixer.clipAction(shadow.animations[0]);
    this.action.setLoop(THREE.LoopOnce, 1);
    this.action.clampWhenFinished = true;
    this.shadow.visible = false;
    this.update(0, 0, false);
  }

  placement(): EncounterPlacement {
    return { chest: readPose(this.chest), shadow: readPose(this.shadow) };
  }

  setEditing(editing: boolean) {
    this.editing = editing;
    this.reset();
    if (editing) {
      this.show();
      this.action.time = this.action.getClip().duration * 0.35;
      this.mixer.update(0);
    }
  }

  private show() {
    this.shadow.visible = true;
    for (const m of this.materials) m.opacity = 1;
    this.action.reset().play();
  }

  reset() {
    this.age = undefined;
    this.standing = false;
    this.shadow.visible = false;
    this.action.stop();
  }

  update(dt: number, elapsed: number, onStone: boolean) {
    const { rise, sx, sz } = stoneMotion(this.stone, elapsed);
    this.anchor.position.set(this.stone.cx, this.stone.topY + rise, this.stone.cz);
    this.normal.set(-this.stone.slopeX - sx, 1, -this.stone.slopeZ - sz).normalize();
    this.anchor.quaternion.setFromUnitVectors(this.up, this.normal);
    if (this.editing) return;
    if (onStone && !this.standing && this.age === undefined) {
      this.age = 0;
      this.show();
    }
    this.standing = onStone;
    if (this.age === undefined) return;
    this.age += dt;
    this.mixer.update(dt);
    const duration = this.action.getClip().duration;
    const fade = THREE.MathUtils.smoothstep(this.action.time, duration * 0.75, duration);
    for (const m of this.materials) m.opacity = 1 - fade;
    if (fade >= 1) {
      this.shadow.visible = false;
      this.action.stop();
      this.age = undefined;
    }
  }

  dispose() {
    this.reset();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.anchor.removeFromParent();
    disposeObject(this.anchor);
  }
}
