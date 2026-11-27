import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import manUrl from './assets/adventurer-man.glb?url';
import womanUrl from './assets/adventurer-woman.glb?url';
import { normalizeSkinAppearance, type SkinAppearance } from './appearance';
import { skinColor } from './skinTone';
import type { AvatarMotionState, CharacterRig, CharacterRigOptions } from './types';

export type AdventurerVariant = 'man' | 'woman';
const URLS = { man: manUrl, woman: womanUrl };
interface CachedModel { users: number; promise: Promise<GLTF> }
const cache = new Map<AdventurerVariant, CachedModel>();
const WALK_CADENCE = 1.4;
const CLIP_BLEND_SECONDS = 0.18;
const isStrideClip = (name: string) => /\|(Walk|Run(?:_Back|_Left|_Right)?)$/.test(name);

function disposeModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      geometries.add(obj.geometry);
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(mat);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

/** Exposed for contract tests and character-preview pose selection. */
export function adventurerClip(motion: AvatarMotionState): string {
  if (motion.isFlying || !motion.grounded) return 'Idle_Neutral';
  if (motion.speed < 0.2) return 'Idle';
  if (Math.abs(motion.strafeSpeed) > Math.abs(motion.forwardSpeed) * 1.2) {
    return motion.strafeSpeed > 0 ? 'Run_Right' : 'Run_Left';
  }
  if (motion.forwardSpeed < -0.2) return 'Run_Back';
  return motion.boost > 0.3 || motion.speedNorm > 0.8 ? 'Run' : 'Walk';
}

export function createAdventurerRig(variant: AdventurerVariant, options?: CharacterRigOptions): CharacterRig {
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.y = 0.9;
  group.add(pivot);
  let appearance = normalizeSkinAppearance(options);
  let disposed = false;
  let model: THREE.Object3D | undefined;
  let mixer: THREE.AnimationMixer | undefined;
  let current: THREE.AnimationAction | undefined;
  const actions = new Map<string, THREE.AnimationAction>();
  const fadeFrom = new Map<THREE.AnimationAction, number>();
  let fadeElapsed = CLIP_BLEND_SECONDS;
  const feet: { ankle: THREE.Object3D; foot: THREE.Object3D; offset: THREE.Vector3 }[] = [];
  const materials = new Set<THREE.Material>();
  const sampledPose = new Map<THREE.Bone, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  const skinMaterials: THREE.MeshStandardMaterial[] = [];
  let flyBlend = 0;
  let airBlend = 0;
  let boostBlend = 0;

  let entry = cache.get(variant);
  if (!entry) {
    entry = { users: 0, promise: new GLTFLoader().loadAsync(URLS[variant]) };
    cache.set(variant, entry);
  }
  const acquired = entry;
  acquired.users++;

  const setSkinAppearance = (value: Partial<SkinAppearance>) => {
    appearance = normalizeSkinAppearance(value);
    const color = skinColor(appearance);
    skinMaterials.forEach((mat) => mat.color.copy(color));
  };

  const ready = acquired.promise.then((gltf) => {
    if (disposed) return;
    model = clone(gltf.scene);
    // Geometry/clip data is shared while in use; skeletons and materials are per instance.
    const clonedMaterials = new Map<THREE.Material, THREE.Material>();
    model.traverse((obj) => {
      if (obj instanceof THREE.Bone) sampledPose.set(obj, {
        position: obj.position.clone(), quaternion: obj.quaternion.clone(), scale: obj.scale.clone(),
      });
      if (!(obj instanceof THREE.Mesh)) return;
      const copyMaterial = (source: THREE.Material) => {
        let mat = clonedMaterials.get(source);
        if (!mat) {
          mat = source.clone();
          clonedMaterials.set(source, mat);
          materials.add(mat);
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.roughness = 1;
            if (mat.name === 'Skin') {
              mat.metalness = 0;
              skinMaterials.push(mat);
            }
          }
        }
        return mat;
      };
      obj.material = Array.isArray(obj.material) ? obj.material.map(copyMaterial) : copyMaterial(obj.material);
      // Animated limbs can leave the bind-pose bounds.
      obj.frustumCulled = false;
      obj.castShadow = true;
    });
    setSkinAppearance(appearance);
    mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) actions.set(clip.name.split('|').pop()!, mixer.clipAction(clip));
    current = actions.get('Idle')!;
    current.play();
    mixer.update(0);
    for (const [bone, pose] of sampledPose) {
      pose.position.copy(bone.position);
      pose.quaternion.copy(bone.quaternion);
      pose.scale.copy(bone.scale);
    }
    model.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const ankle = model.getObjectByName(`LowerLeg${side}_end`);
      const foot = model.getObjectByName(`Foot${side}`);
      if (ankle && foot?.parent) feet.push({ ankle, foot,
        offset: ankle.worldToLocal(foot.getWorldPosition(new THREE.Vector3())) });
    }
    const box = new THREE.Box3().setFromObject(model);
    const scale = 1.8 / (box.max.y - box.min.y);
    model.scale.setScalar(scale);
    model.rotation.y = Math.PI; // Source faces +Z; Portalverse faces -Z.
    model.position.y = -0.9 - box.min.y * scale;
    pivot.add(model);
    group.updateMatrixWorld(true);
  });
  // Consumers may await ready to show loading/error UI. Also handle non-preview loads.
  void ready.catch((error) => console.warn(`Could not load adventurer ${variant}:`, error));

  // Aim a bone in model space, independent of the two models' different bone roll angles.
  const start = new THREE.Vector3(), end = new THREE.Vector3(), target = new THREE.Vector3();
  const parentRotation = new THREE.Quaternion(), inverseParent = new THREE.Quaternion(), delta = new THREE.Quaternion();
  const ankleBefore = new THREE.Vector3(), ankleAfter = new THREE.Vector3(), footPosition = new THREE.Vector3();
  const legBefore = new THREE.Quaternion(), legAfter = new THREE.Quaternion(), footRotation = new THREE.Quaternion();
  const footParentRotation = new THREE.Quaternion();
  const handAxis = new THREE.Vector3(), thumbDirection = new THREE.Vector3(), inwardDirection = new THREE.Vector3();
  const handCross = new THREE.Vector3();
  function aim(name: string, childName: string, x: number, y: number, z: number, weight: number) {
    if (!model || weight < 0.001) return;
    const bone = model.getObjectByName(name), child = model.getObjectByName(childName);
    if (!bone?.parent || !child) return;
    bone.getWorldPosition(start);
    child.getWorldPosition(end);
    end.sub(start).normalize();
    target.set(x, y, z).normalize().transformDirection(model.matrixWorld);
    delta.setFromUnitVectors(end, target);
    bone.parent.getWorldQuaternion(parentRotation);
    delta.premultiply(inverseParent.copy(parentRotation).invert()).multiply(parentRotation).multiply(bone.quaternion);
    bone.quaternion.slerp(delta, weight);
    bone.updateWorldMatrix(false, true);
  }

  return {
    group, ready, setSkinAppearance,
    update(dt, elapsed, motion) {
      if (!mixer || !model || disposed) return;
      // Restore the previous sampled animation pose before applying the next sample.
      // The mixer skips unchanged tracks, so resetting to the bind pose here would
      // lose constant authored values. Procedural offsets must never accumulate.
      for (const [bone, pose] of sampledPose) {
        bone.position.copy(pose.position);
        bone.quaternion.copy(pose.quaternion);
        bone.scale.copy(pose.scale);
      }
      const clipName = adventurerClip(motion);
      const next = actions.get(clipName)!;
      if (next !== current) {
        // Retarget from the weights actually on screen, even when a previous fade
        // is interrupted. Restarting fadeIn/fadeOut assumes full weights and pops.
        fadeFrom.clear();
        for (const action of actions.values()) {
          if (action.isRunning()) fadeFrom.set(action, action.getEffectiveWeight());
        }
        if (!next.isRunning()) {
          next.reset().setEffectiveTimeScale(1).setEffectiveWeight(0).play();
          // Keep the same point in the step when changing locomotion clips.
          if (current && isStrideClip(current.getClip().name) && isStrideClip(next.getClip().name)) {
            next.time = (current.time / current.getClip().duration % 1) * next.getClip().duration;
          }
        }
        fadeFrom.set(next, fadeFrom.get(next) ?? 0);
        fadeElapsed = 0;
        current = next;
      }
      fadeElapsed = Math.min(CLIP_BLEND_SECONDS, fadeElapsed + dt);
      const progress = fadeElapsed / CLIP_BLEND_SECONDS;
      const eased = progress * progress * (3 - 2 * progress);
      for (const [action, weight] of fadeFrom) {
        action.setEffectiveWeight(THREE.MathUtils.lerp(weight, action === current ? 1 : 0, eased));
        if (progress === 1 && action !== current) action.stop();
      }
      if (progress === 1) fadeFrom.clear();
      const strideRate = motion.grounded && motion.speed > 0.2
        ? THREE.MathUtils.clamp(motion.speedNorm / 0.65, 0.65, 1.6) : 1;
      current.setEffectiveTimeScale(strideRate * (clipName === 'Walk' ? WALK_CADENCE : 1));
      mixer.update(dt);
      for (const [bone, pose] of sampledPose) {
        pose.position.copy(bone.position);
        pose.quaternion.copy(bone.quaternion);
        pose.scale.copy(bone.scale);
      }
      const blend = 1 - Math.exp(-dt * 9);
      flyBlend += ((motion.isFlying ? 1 : 0) - flyBlend) * blend;
      airBlend += ((!motion.grounded ? 1 : 0) - airBlend) * blend;
      boostBlend += (motion.boost - boostBlend) * blend;
      pivot.rotation.x = flyBlend * (-0.65 - boostBlend * 0.65 + motion.pitch * 0.5);
      pivot.rotation.z = flyBlend * THREE.MathUtils.clamp(-motion.turnRate * 0.12, -0.3, 0.3);
      pivot.position.y = 0.9 - motion.landImpact * 0.09 + flyBlend * Math.sin(elapsed * 2.2) * 0.025;
      group.updateMatrixWorld(true);
      // The source's feet are independent controls. Blending their positions and
      // the leg rotations separately breaks ankle alignment, even for grounded
      // clips. Keep their authored ankle offset throughout every transition.
      for (const { ankle, foot, offset } of feet) {
        ankle.localToWorld(footPosition.copy(offset));
        foot.position.copy(foot.parent!.worldToLocal(footPosition));
        foot.updateWorldMatrix(false, true);
      }
      if (airBlend < 0.001) return;
      // Airborne: open arms and tuck legs. Flight: reach forward and streamline on boost.
      for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
        aim(`UpperArm${side}`, `LowerArm${side}`, sign * (0.75 - flyBlend * (0.5 + boostBlend * 0.15)),
          -0.2 + flyBlend * (0.65 + boostBlend * 0.55), 0.4 * (1 - boostBlend * flyBlend), airBlend);
        aim(`LowerArm${side}`, `Wrist${side}`, sign * 0.1, flyBlend * (0.75 + boostBlend * 0.25),
          1 - flyBlend * (0.8 + boostBlend * 0.2), airBlend);
        // Extend the fingers along the forearm, then roll the thumb toward the
        // centerline. Derive the roll from the actual hand bones: the authored
        // wrist rotations differ between rigs, and flight/boost aim differently.
        aim(`Wrist${side}`, `Middle4${side}`, sign * 0.1,
          flyBlend * (0.75 + boostBlend * 0.25), 1 - flyBlend * (0.8 + boostBlend * 0.2), flyBlend);
        const wrist = model.getObjectByName(`Wrist${side}`);
        const finger = model.getObjectByName(`Middle4${side}`);
        const knuckle = model.getObjectByName(`Middle2${side}`);
        const thumb = model.getObjectByName(`Thumb3${side}`);
        if (wrist?.parent && finger && knuckle && thumb && flyBlend > 0.001) {
          wrist.getWorldPosition(start);
          finger.getWorldPosition(handAxis).sub(start).normalize();
          knuckle.getWorldPosition(start);
          thumb.getWorldPosition(thumbDirection).sub(start);
          thumbDirection.addScaledVector(handAxis, -thumbDirection.dot(handAxis)).normalize();
          inwardDirection.set(-sign, 0, 0).transformDirection(model.matrixWorld);
          inwardDirection.addScaledVector(handAxis, -inwardDirection.dot(handAxis)).normalize();
          const angle = Math.atan2(handAxis.dot(handCross.crossVectors(thumbDirection, inwardDirection)),
            thumbDirection.dot(inwardDirection));
          delta.setFromAxisAngle(handAxis, angle * flyBlend);
          wrist.parent.getWorldQuaternion(parentRotation);
          delta.premultiply(inverseParent.copy(parentRotation).invert()).multiply(parentRotation);
          wrist.quaternion.premultiply(delta);
          wrist.updateWorldMatrix(false, true);
        }
        const lowerLeg = model.getObjectByName(`LowerLeg${side}`);
        const ankle = model.getObjectByName(`LowerLeg${side}_end`);
        const foot = model.getObjectByName(`Foot${side}`);
        if (ankle && lowerLeg && foot?.parent) {
          ankle.getWorldPosition(ankleBefore);
          lowerLeg.getWorldQuaternion(legBefore);
          foot.getWorldPosition(footPosition);
          foot.getWorldQuaternion(footRotation);
        }
        aim(`UpperLeg${side}`, `LowerLeg${side}`, sign * 0.12, -1, -0.25, airBlend);
        aim(`LowerLeg${side}`, `LowerLeg${side}_end`, 0, -1, -0.35 * (1 - flyBlend), airBlend);
        // The exported feet are independent controls, not children of the shins.
        // Carry their offset and orientation with the ankle to keep boots attached.
        if (ankle && lowerLeg && foot?.parent && airBlend > 0.001) {
          ankle.getWorldPosition(ankleAfter);
          lowerLeg.getWorldQuaternion(legAfter).multiply(legBefore.invert());
          footPosition.sub(ankleBefore).applyQuaternion(legAfter).add(ankleAfter);
          foot.position.copy(foot.parent.worldToLocal(footPosition));
          foot.parent.getWorldQuaternion(footParentRotation).invert();
          foot.quaternion.copy(footParentRotation.multiply(legAfter).multiply(footRotation));
          foot.updateWorldMatrix(false, true);
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer?.stopAllAction();
      if (model) {
        mixer?.uncacheRoot(model);
        const skeletons = new Set<THREE.Skeleton>();
        model.traverse((obj) => { if (obj instanceof THREE.SkinnedMesh) skeletons.add(obj.skeleton); });
        skeletons.forEach((skeleton) => skeleton.dispose());
      }
      materials.forEach((mat) => mat.dispose());
      group.clear();
      if (--acquired.users === 0) {
        cache.delete(variant);
        void acquired.promise.then((gltf) => disposeModel(gltf.scene), () => {});
      }
    },
  };
}
