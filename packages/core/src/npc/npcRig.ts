import * as THREE from 'three/webgpu';
import { Face, type ExprName } from '@ericrius1/cast/face';
import { lineOf, type Timeline } from '@ericrius1/cast/speech';
import { angDiff, clamp, damp } from '@ericrius1/cast/math';
import { AvatarSpeechBubble } from '../chat/speechBubble3D';
import { createFloatingLabel } from '../engine/signage';
import { disposeObject, loadGLB } from '../rooms/kit';
import type { NpcExpression, NpcGesture, NpcSpec } from './types';
import { getNpcModelUrl } from './placements';

/** Portalverse soundtrack tempo: 88 BPM (beats per second = 88 / 60). */
const LOOM_BPS = 88 / 60;

interface BoneRest {
  bone: THREE.Bone;
  restQuat: THREE.Quaternion;
  restPos: THREE.Vector3;
  /** Which local axis ('x' | 'y' | 'z') aligns closest with world +Y (used for vertical eye blinking). */
  upAxis: 'x' | 'y' | 'z';
}

const GESTURE_DURATION: Record<NpcGesture, number> = {
  idle: 0,
  wave: 1.9,
  explain: 2.2,
  ponder: 2.4,
  point: 2.1,
  bow: 2.0,
  excited: 1.8,
};

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/**
 * Loads and animates one Portalverse Keeper NPC in Three.js WebGPU:
 * - Lazily fetches its uncompressed Blender-rigged GLB (`public/assets/npcs/<id>/model.glb`)
 *   while showing a clean luminous placeholder silhouette until loaded.
 * - Drives live phoneme lip-sync (`Jaw`), blinks, saccades, gaze tracking (`Head`, `Neck`, `EyeL`, `EyeR`),
 *   and dialogue moods via Eric's `@ericrius1/cast` (`Face` + `lineOf`).
 * - Pulses emissive materials gently at 88 BPM (the G# Loom tempo).
 * - Displays custom-styled 3D floating speech bubbles (`AvatarSpeechBubble`) for ambient barks & dialogue.
 */
export class NpcActor {
  readonly spec: NpcSpec;
  readonly group = new THREE.Group();
  readonly bubble: AvatarSpeechBubble;

  private readonly label: { sprite: THREE.Sprite; dispose: () => void } | null;
  private readonly ringMesh: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly ringGeo: THREE.RingGeometry;
  private readonly placeholderGroup = new THREE.Group();
  private readonly placeholderGeos: THREE.BufferGeometry[] = [];
  private readonly placeholderMats: THREE.Material[] = [];

  private readonly face: Face;
  private modelRoot: THREE.Object3D | null = null;
  private readonly bones = new Map<string, BoneRest>();
  private readonly emissiveMats: Array<{ mat: THREE.MeshStandardMaterial; baseIntensity: number }> = [];

  private baseYaw: number;
  private currentYaw: number;
  private headYaw = 0;
  private headPitch = 0;
  private eyeYaw = 0;
  private eyePitch = 0;
  private talkLine: Timeline | null = null;
  private talkTime = 0;
  private activeGesture: NpcGesture = 'idle';
  private gestureTime = 0;
  private talking = false;
  private proximity01 = 0;
  private disposed = false;

  // Scratch math objects to avoid per-frame allocations
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly worldPos = new THREE.Vector3();

  constructor(spec: NpcSpec, position: readonly [number, number, number], yaw: number) {
    this.spec = spec;
    this.baseYaw = yaw;
    this.currentYaw = yaw;
    this.group.name = `npc-${spec.id}`;
    this.group.position.set(position[0], position[1], position[2]);
    this.group.rotation.y = yaw;

    this.face = new Face({ seed: hashSeed(spec.id), talkOpen: 1.15 });
    this.face.attend = 0.72;
    this.face.mood('calm', { fade: 0.4 });

    // Grounded luminous interaction halo ring
    this.ringGeo = new THREE.RingGeometry(0.62, 0.78, 36);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(spec.accentColor),
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ringMesh = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.ringMesh.position.y = 0.035;
    this.group.add(this.ringMesh);

    // Floating nameplate + custom speech bubble right above head
    const labelY = spec.heightMeters + 0.34;
    if (typeof document !== 'undefined') {
      this.label = createFloatingLabel({
        title: spec.name,
        subtitle: spec.title,
        accentColor: spec.accentColor,
        width: 2.35,
      });
      this.label.sprite.position.set(0, labelY, 0);
      this.group.add(this.label.sprite);
    } else {
      this.label = null;
    }

    this.bubble = new AvatarSpeechBubble({
      baseHeight: labelY + 0.46,
      style: spec.bubbleStyle,
    });
    this.group.add(this.bubble.sprite);

    this.buildPlaceholder();
    this.group.add(this.placeholderGroup);
  }

  /** Begin asynchronous GLB fetch (safe in headless Node tests where fetch/URL may not resolve). */
  loadModel(url = getNpcModelUrl(this.spec.id)): Promise<boolean> {
    if (typeof fetch !== 'function' || typeof window === 'undefined') {
      return Promise.resolve(false);
    }
    return loadGLB(url)
      .then((gltf) => {
        if (this.disposed) {
          disposeObject(gltf.scene);
          return false;
        }
        this.attachLoadedModel(gltf.scene);
        return true;
      })
      .catch((err) => {
        console.warn(`[npc:${this.spec.id}] couldn't load ${url}, using fallback silhouette:`, err);
        return false;
      });
  }

  getWorldPosition(out = this.worldPos): THREE.Vector3 {
    return out.copy(this.group.position);
  }

  setTalking(active: boolean): void {
    this.talking = active;
    if (!active) {
      this.face.speech = null;
      this.talkLine = null;
      this.activeGesture = 'idle';
      this.face.mood('calm', { fade: 0.6 });
    }
  }

  /** Speak a dialogue line or ambient bark: drives @ericrius1/cast lip-sync, mood, gesture, and 3D speech bubble! */
  speak(
    text: string,
    expr: NpcExpression = 'smile',
    gesture: NpcGesture = 'idle',
    durationSeconds?: number,
  ): void {
    const clean = text.trim();
    if (!clean) return;
    this.face.mood(expr as ExprName, { fade: 0.25 });
    const tl = lineOf(clean, { rate: 1.0, lead: 0.06 });
    this.talkLine = tl;
    this.talkTime = 0;
    this.face.speech = { tl, t: 0, w: 1 };
    this.activeGesture = gesture;
    this.gestureTime = 0;
    const dur = durationSeconds ?? Math.max(5.5, tl.dur + 2.4);
    this.bubble.showText(clean, this.spec.bubbleStyle, dur);
  }

  /** Expose the live Cast Face state (useful for UI mood sync and automated tests). */
  getFaceState() {
    return this.face.state;
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3 | null): void {
    const step = Math.min(Math.max(dt, 0), 0.05);

    // 1. Distance & player gaze tracking
    let targetYaw = this.baseYaw;
    let aimLocal: [number, number, number] | null = null;
    let dist = Infinity;

    if (playerPos) {
      const dx = playerPos.x - this.group.position.x;
      const dz = playerPos.z - this.group.position.z;
      dist = Math.hypot(dx, dz);
      this.proximity01 = clamp(1 - (dist - 2.2) / 5.5, 0, 1);

      if (this.talking || dist < 6.5) {
        const toPlayerYaw = Math.atan2(dx, dz);
        const diff = angDiff(this.baseYaw, toPlayerYaw);
        // Gently turn body when conversing or close, clamped when just casually noticing
        const bodyFollow = this.talking ? 0.92 : 0.45;
        targetYaw = this.baseYaw + clamp(diff * bodyFollow, -1.35, 1.35);

        const headDiff = clamp(angDiff(this.currentYaw, toPlayerYaw), -0.78, 0.78);
        const eyeH = this.spec.heightMeters * 0.88;
        const playerEyeY = playerPos.y + 1.62;
        const pitch = clamp(Math.atan2(playerEyeY - (this.group.position.y + eyeH), Math.max(0.8, dist)), -0.35, 0.35);
        this.headYaw = damp(this.headYaw, headDiff * 0.72, 6.5, step);
        this.headPitch = damp(this.headPitch, -pitch * 0.65, 6.5, step);
        aimLocal = [Math.sin(headDiff * 0.35), Math.sin(pitch * 0.35), 1];
      } else {
        this.headYaw = damp(this.headYaw, 0, 3.5, step);
        this.headPitch = damp(this.headPitch, 0, 3.5, step);
      }
    } else {
      this.proximity01 = damp(this.proximity01, 0, 4, step);
      this.headYaw = damp(this.headYaw, 0, 3.5, step);
      this.headPitch = damp(this.headPitch, 0, 3.5, step);
    }

    const yawStep = angDiff(this.currentYaw, targetYaw);
    this.currentYaw += yawStep * (1 - Math.exp(-(this.talking ? 7 : 3.5) * step));
    this.group.rotation.y = this.currentYaw;

    // 2. Advance @ericrius1/cast speech timeline & facial state (blinks, saccades, visemes, stress)
    if (this.talkLine) {
      this.talkTime += step;
      if (this.talkTime <= this.talkLine.dur + 0.15) {
        const w = this.talkTime > this.talkLine.dur ? Math.max(0, 1 - (this.talkTime - this.talkLine.dur) / 0.15) : 1;
        this.face.speech = { tl: this.talkLine, t: Math.min(this.talkTime, this.talkLine.dur), w };
      } else {
        this.talkLine = null;
        this.face.speech = null;
      }
    }
    const faceState = this.face.update(step, {}, aimLocal);
    this.eyeYaw = damp(this.eyeYaw, clamp(faceState.gaze[0], -0.45, 0.45), 14, step);
    this.eyePitch = damp(this.eyePitch, clamp(-faceState.gaze[1], -0.3, 0.3), 14, step);

    // 3. Advance active gesture clock
    if (this.activeGesture !== 'idle') {
      this.gestureTime += step;
      if (this.gestureTime > GESTURE_DURATION[this.activeGesture]) {
        this.activeGesture = 'idle';
        this.gestureTime = 0;
      }
    }

    // 4. Animate rigged Blender skeleton bones (or placeholder)
    const beatPhase = elapsed * LOOM_BPS * Math.PI * 2;
    const beatPulse = 0.5 + 0.5 * Math.sin(beatPhase);

    if (this.bones.size > 0) {
      this.applyBoneAnimation(elapsed, beatPhase, faceState.open, faceState.emph, faceState.blink);
    } else if (this.placeholderGroup.visible) {
      this.placeholderGroup.position.y = Math.sin(elapsed * 2.1) * 0.03;
    }

    // Pulse emissive accents gently on Portalverse's 88 BPM G# Loom beat
    for (const item of this.emissiveMats) {
      item.mat.emissiveIntensity = item.baseIntensity * (0.82 + 0.36 * beatPulse);
    }

    // Halo ring pulses softly as player approaches or talks
    const ringGlow = this.talking ? 0.72 : 0.16 + this.proximity01 * 0.42;
    this.ringMat.opacity = ringGlow * (0.85 + 0.15 * beatPulse);
    const ringScale = 1 + (this.talking ? 0.08 : this.proximity01 * 0.05) * beatPulse;
    this.ringMesh.scale.set(ringScale, ringScale, 1);

    // Update floating 3D speech bubble
    this.bubble.update(step, elapsed);
  }

  private applyBoneAnimation(
    elapsed: number,
    beatPhase: number,
    jawOpen: number,
    syllableEmph: number,
    blink: number,
  ): void {
    const breath = Math.sin(elapsed * 1.9);
    const sway = Math.sin(elapsed * 0.95);
    const talkingNod = syllableEmph * 0.12;

    // Gentle hover for hovering spirits/constructs (Kestrel, Fen, Nori, Cairn)
    const hovers =
      this.spec.id === 'kestrel' ||
      this.spec.id === 'fen' ||
      this.spec.id === 'nori' ||
      this.spec.id === 'cairn';
    const rootBone = this.bones.get('Root');
    if (rootBone) {
      rootBone.bone.position.copy(rootBone.restPos);
      if (hovers) {
        rootBone.bone.position.y += 0.055 + Math.sin(elapsed * 1.8) * 0.045;
      }
    }

    // Gesture envelope (smooth 0..1..0 bell curve)
    const gDur = GESTURE_DURATION[this.activeGesture];
    const gNorm = gDur > 0 ? clamp(this.gestureTime / gDur, 0, 1) : 0;
    const gEnv = gDur > 0 ? Math.sin(gNorm * Math.PI) : 0;

    // Spine & Chest breathing + bow/excited posture
    const bowPitch = this.activeGesture === 'bow' ? gEnv * 0.36 : 0;
    const excitedLift = this.activeGesture === 'excited' ? Math.abs(Math.sin(this.gestureTime * 8)) * gEnv * 0.08 : 0;
    this.rotateBone('Pelvis', bowPitch * 0.3, sway * 0.025, sway * 0.018);
    this.rotateBone('Spine', breath * 0.025 + bowPitch * 0.45 - excitedLift, 0, sway * 0.02);
    this.rotateBone('Chest', breath * 0.03 + bowPitch * 0.25, sway * -0.02, 0);

    // Neck & Head gaze + talking syllable emphasis
    const ponderTilt = this.activeGesture === 'ponder' ? gEnv * 0.16 : 0;
    this.rotateBone('Neck', this.headPitch * 0.4 + talkingNod * 0.5, this.headYaw * 0.45, ponderTilt * 0.4);
    this.rotateBone('Head', this.headPitch * 0.6 + talkingNod, this.headYaw * 0.55, ponderTilt * 0.6);

    // @ericrius1/cast phoneme lip-sync on Jaw!
    this.rotateBone('Jaw', clamp(jawOpen * 0.32, 0, 0.36), 0, 0);

    // Eyes saccade & orientation-aware vertical blink scale (works whether Eye bone points +Y or +Z)
    for (const eyeName of ['EyeL', 'EyeR']) {
      const entry = this.bones.get(eyeName);
      if (!entry) continue;
      this.rotateBone(eyeName, this.eyePitch, this.eyeYaw, 0);
      const blinkScale = Math.max(0.12, 1 - blink * 0.88);
      if (entry.upAxis === 'x') entry.bone.scale.set(blinkScale, 1, 1);
      else if (entry.upAxis === 'z') entry.bone.scale.set(1, 1, blinkScale);
      else entry.bone.scale.set(1, blinkScale, 1);
    }

    // Arms & Hands: ambient breathing + talking gesture choreography
    let armLPitch = 0.04 + breath * 0.025;
    let armLRoll = 0.06;
    let foreLPitch = -0.14;
    let armRPitch = 0.04 + breath * 0.025;
    let armRRoll = -0.06;
    let foreRPitch = -0.14;

    if (this.talking) {
      const talkWave = Math.sin(elapsed * 4.4) * (0.08 + syllableEmph * 0.12);
      armLPitch -= 0.12 + talkWave;
      foreLPitch -= 0.22 + talkWave * 0.6;
      armRPitch -= 0.10 - talkWave * 0.8;
      foreRPitch -= 0.18;
    }

    switch (this.activeGesture) {
      case 'wave': {
        const w = Math.sin(this.gestureTime * 9.5) * 0.25 * gEnv;
        armRPitch -= 1.35 * gEnv;
        armRRoll -= 0.35 * gEnv;
        foreRPitch -= 0.55 * gEnv + w;
        break;
      }
      case 'explain': {
        const s = Math.sin(this.gestureTime * 5.2) * 0.18 * gEnv;
        armLPitch -= 0.55 * gEnv + s;
        foreLPitch -= 0.45 * gEnv;
        armRPitch -= 0.52 * gEnv - s;
        foreRPitch -= 0.45 * gEnv;
        break;
      }
      case 'ponder': {
        armRPitch -= 0.72 * gEnv;
        foreRPitch -= 1.05 * gEnv;
        armRRoll += 0.24 * gEnv;
        break;
      }
      case 'point': {
        armRPitch -= 1.15 * gEnv;
        foreRPitch -= 0.12 * gEnv;
        armRRoll -= 0.18 * gEnv;
        break;
      }
      case 'excited': {
        const bounce = Math.sin(this.gestureTime * 10) * 0.22 * gEnv;
        armLPitch -= 1.05 * gEnv + bounce;
        armLRoll += 0.32 * gEnv;
        armRPitch -= 1.05 * gEnv - bounce;
        armRRoll -= 0.32 * gEnv;
        break;
      }
      case 'bow': {
        armLPitch += 0.18 * gEnv;
        armRPitch += 0.18 * gEnv;
        break;
      }
      default:
        break;
    }

    this.rotateBone('ArmL', armLPitch, 0, armLRoll);
    this.rotateBone('ForearmL', foreLPitch, 0, 0);
    this.rotateBone('ArmR', armRPitch, 0, armRRoll);
    this.rotateBone('ForearmR', foreRPitch, 0, 0);

    // Secondary bespoke bones (cloaks, tails, ears, halos, lanterns, wings, hats, root tendrils)
    this.rotateBone('Cloak', Math.sin(elapsed * 1.7) * 0.08 + 0.04, 0, Math.cos(elapsed * 1.2) * 0.05);
    this.rotateBone('Tail1', 0.05, Math.sin(elapsed * 2.4) * 0.22, 0);
    this.rotateBone('Tail2', 0.04, Math.sin(elapsed * 2.4 - 0.7) * 0.28, 0);
    this.rotateBone('EarL', 0, 0, Math.sin(elapsed * 2.8) * 0.08 + syllableEmph * 0.14);
    this.rotateBone('EarR', 0, 0, -Math.sin(elapsed * 2.8) * 0.08 - syllableEmph * 0.14);
    this.rotateBone('Hat', Math.sin(elapsed * 1.6) * 0.02 + syllableEmph * 0.04, 0, Math.cos(elapsed * 1.1) * 0.025);
    this.rotateBone('Halo', 0, elapsed * 0.55, Math.sin(beatPhase) * 0.06);
    this.rotateBone('Lantern', Math.sin(elapsed * 2.2) * 0.09, 0, Math.cos(elapsed * 1.9) * 0.07);
    this.rotateBone('WingL', 0, Math.sin(elapsed * 3.1) * 0.14, 0);
    this.rotateBone('WingR', 0, -Math.sin(elapsed * 3.1) * 0.14, 0);
    for (let i = 1; i <= 4; i++) {
      const phase = elapsed * 1.35 + i * 1.45;
      this.rotateBone(`Tentacle${i}`, Math.sin(phase) * 0.07, 0, Math.cos(phase * 0.8) * 0.06);
    }
  }

  private rotateBone(name: string, rx: number, ry: number, rz: number): void {
    const entry = this.bones.get(name);
    if (!entry) return;
    this.tmpEuler.set(rx, ry, rz, 'YXZ');
    this.tmpQuat.setFromEuler(this.tmpEuler);
    entry.bone.quaternion.copy(entry.restQuat).multiply(this.tmpQuat);
  }

  private attachLoadedModel(scene: THREE.Object3D): void {
    this.placeholderGroup.visible = false;
    this.modelRoot = scene;
    this.bones.clear();
    this.emissiveMats.length = 0;

    scene.updateMatrixWorld(true);
    const worldQuat = new THREE.Quaternion();
    const localUp = new THREE.Vector3();

    scene.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        const bone = obj as THREE.Bone;
        bone.getWorldQuaternion(worldQuat);
        localUp.set(0, 1, 0).applyQuaternion(worldQuat.invert());
        const ax = Math.abs(localUp.x);
        const ay = Math.abs(localUp.y);
        const az = Math.abs(localUp.z);
        const upAxis: 'x' | 'y' | 'z' = ax >= ay && ax >= az ? 'x' : az >= ay ? 'z' : 'y';
        this.bones.set(bone.name, {
          bone,
          restQuat: bone.quaternion.clone(),
          restPos: bone.position.clone(),
          upAxis,
        });
      }
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            if (m.emissive && (m.emissive.r > 0.01 || m.emissive.g > 0.01 || m.emissive.b > 0.01) && m.emissiveIntensity > 0) {
              this.emissiveMats.push({ mat: m, baseIntensity: m.emissiveIntensity });
            }
          }
        }
      }
    });

    // Ensure feet sit cleanly at y = 0 regardless of export pivot
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    if (Number.isFinite(box.min.y) && Math.abs(box.min.y) > 0.015) {
      scene.position.y -= box.min.y;
    }

    this.group.add(scene);
  }

  private buildPlaceholder(): void {
    const h = this.spec.heightMeters;
    const accent = new THREE.Color(this.spec.accentColor);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.25,
      roughness: 0.45,
      metalness: 0.15,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      emissive: accent,
      emissiveIntensity: 0.12,
      roughness: 0.35,
    });
    this.placeholderMats.push(bodyMat, headMat);

    const bodyGeo = new THREE.CapsuleGeometry(0.24, Math.max(0.45, h * 0.52), 8, 16);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h * 0.42;

    const headGeo = new THREE.SphereGeometry(0.18, 16, 12);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = h * 0.84;

    this.placeholderGeos.push(bodyGeo, headGeo);
    this.placeholderGroup.add(body, head);
  }

  dispose(): void {
    this.disposed = true;
    this.label?.dispose();
    this.bubble.dispose();
    this.ringGeo.dispose();
    this.ringMat.dispose();
    for (const g of this.placeholderGeos) g.dispose();
    for (const m of this.placeholderMats) m.dispose();
    if (this.modelRoot) {
      disposeObject(this.modelRoot);
      this.modelRoot = null;
    }
    this.bones.clear();
    this.emissiveMats.length = 0;
  }
}
