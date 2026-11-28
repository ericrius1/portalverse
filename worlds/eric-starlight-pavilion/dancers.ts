import * as THREE from 'three/webgpu';
import { Face, type ExprName } from '@ericrius1/cast/face';
import { lineOf, type Timeline } from '@ericrius1/cast/speech';
import { angDiff, clamp, damp } from '@ericrius1/cast/math';
import { AvatarSpeechBubble } from '@portalverse/core/chat';
import { disposeObject, loadGLB } from '@portalverse/core/rooms/kit';
import { NPC_BY_ID, getNpcModelUrl, getNpcPortraitUrl, type NpcSpec } from '@portalverse/core/npc';

/** Shared 88 BPM G# Loom beat rate (beats per second). */
export const DANCE_BPM = 88;
export const DANCE_BPS = DANCE_BPM / 60;

export type DancerId = 'soraya' | 'dex' | 'ermelin';
export type DanceStyle = 'waltz' | 'hypergroove' | 'celestial';
export type FlourishKind = 'none' | 'spin_left' | 'spin_right' | 'leap' | 'drop' | 'twirl' | 'cast1' | 'cast2';

export interface SpellMeta {
  slot: 1 | 2;
  name: string;
  shortDesc: string;
  cooldownSec: number;
  accentHex: string;
  bark: string;
}

export interface DancerConfig {
  id: DancerId;
  spec: NpcSpec;
  roleTag: string;
  homePos: readonly [number, number];
  homeYaw: number;
  auraHex: string;
  secondaryHex: string;
  portraitUrl: string;
  spells: readonly [SpellMeta, SpellMeta];
  cheerBarks: readonly string[];
}

export const DANCER_IDS: readonly DancerId[] = ['soraya', 'dex', 'ermelin'];

export const DANCER_CONFIGS: readonly DancerConfig[] = [
  {
    id: 'soraya',
    spec: NPC_BY_ID.soraya,
    roleTag: 'Star-Weaver',
    homePos: [-3.2, -1.6],
    homeYaw: 0.42,
    auraHex: '#fbbf24',
    secondaryHex: '#2dd4bf',
    portraitUrl: getNpcPortraitUrl('soraya'),
    spells: [
      {
        slot: 1,
        name: 'Zellige Starburst',
        shortDesc: 'Launches 8 spinning golden star blades that ring every totem & prism orb',
        cooldownSec: 2.8,
        accentHex: '#fbbf24',
        bark: 'Eight points, spinning true — catch the starlight!',
      },
      {
        slot: 2,
        name: 'Aurora Canopy',
        shortDesc: 'Weaves a shimmering sky dome that lifts all three dancers into zero-G waltz',
        cooldownSec: 5.5,
        accentHex: '#2dd4bf',
        bark: 'Up off the marble! Let the aurora carry the beat!',
      },
    ],
    cheerBarks: [
      'Clean geometry on that turn!',
      'Yes! Hold the thirteenth beat!',
      'Now that is a proper spin!',
    ],
  },
  {
    id: 'dex',
    spec: NPC_BY_ID.dex,
    roleTag: 'Prism Rigger',
    homePos: [0.0, -3.4],
    homeYaw: 0.0,
    auraHex: '#ff2a85',
    secondaryHex: '#22d3ee',
    portraitUrl: getNpcPortraitUrl('dex'),
    spells: [
      {
        slot: 1,
        name: 'Prism Laser Nova',
        shortDesc: 'Fires a 360° rainbow laser fan + bass shockwave that supercharges disco orbs',
        cooldownSec: 2.6,
        accentHex: '#ff2a85',
        bark: 'FULL SPECTRUM DROP — watch the beams!',
      },
      {
        slot: 2,
        name: 'Holo-Clone Rush',
        shortDesc: 'Projects 3 neon holographic dance clones spinning in laser triangle formation',
        cooldownSec: 5.0,
        accentHex: '#22d3ee',
        bark: 'One Dex is loud — try FOUR of me on the beat!',
      },
    ],
    cheerBarks: [
      'YO, THAT FOOTWORK WAS ELECTRIC!',
      'Prism check — 10 out of 10!',
      'DROP IT AGAIN!!',
    ],
  },
  {
    id: 'ermelin',
    spec: NPC_BY_ID.ermelin,
    roleTag: 'Frost Waltz Sprite',
    homePos: [3.2, -1.6],
    homeYaw: -0.42,
    auraHex: '#93c5fd',
    secondaryHex: '#f59e0b',
    portraitUrl: getNpcPortraitUrl('ermelin'),
    spells: [
      {
        slot: 1,
        name: 'Blizzard Ribbon Twirl',
        shortDesc: 'Whips up 60 glittering snowflakes & chills the dance floor into crystal ice',
        cooldownSec: 3.0,
        accentHex: '#93c5fd',
        bark: 'Fresh powder on the dance floor — twirl with it!',
      },
      {
        slot: 2,
        name: 'Lantern Comet Ring',
        shortDesc: 'Launches 5 homing golden lantern comets that auto-ring every Chime Totem',
        cooldownSec: 5.2,
        accentHex: '#f59e0b',
        bark: 'Lantern sparks, go ring the whole pavilion!',
      },
    ],
    cheerBarks: [
      'Whoosh! Better than sledding!',
      'Look at those sparks fly!',
      'Save a leap for me!',
    ],
  },
];

interface BoneRest {
  bone: THREE.Bone;
  restQuat: THREE.Quaternion;
  restPos: THREE.Vector3;
  upAxis: 'x' | 'y' | 'z';
}

const FLOURISH_DURATION: Record<FlourishKind, number> = {
  none: 0,
  spin_left: 0.95,
  spin_right: 0.95,
  leap: 1.05,
  drop: 0.85,
  twirl: 0.65,
  cast1: 1.05,
  cast2: 1.25,
};

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export interface DancerMotionInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  swirlIntensity: number;
}

/**
 * Full-body choreographed rigged dancer for Soraya, Dex, or Ermelin.
 * Drives all 23+ Blender bones (including legs, knees, arms, torso, neck, head,
 * jaw lip-sync, orientation-aware blinking, cloaks, tails, ears, lanterns, and props)
 * smoothly both in autonomous trio formation and under live player takeover!
 */
export class DancePerformer {
  readonly config: DancerConfig;
  readonly group = new THREE.Group();
  readonly hitCollider: THREE.Mesh;
  readonly bubble: AvatarSpeechBubble;

  private readonly spotlightRing: THREE.Mesh;
  private readonly spotlightRingMat: THREE.MeshBasicMaterial;
  private readonly spotlightBeam: THREE.Mesh;
  private readonly spotlightBeamMat: THREE.MeshBasicMaterial;
  private readonly placeholderGroup = new THREE.Group();
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];

  private readonly face: Face;
  private modelRoot: THREE.Object3D | null = null;
  private readonly bones = new Map<string, BoneRest>();
  private readonly emissiveMats: Array<{ mat: THREE.MeshStandardMaterial; baseIntensity: number }> = [];

  // Kinematics & choreography state
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw: number;
  private spinOffset = 0;
  private jumpHeight = 0;
  private geyserVelY = 0;
  private geyserSpin = 0;
  private levitateAmount = 0;

  private activeFlourish: FlourishKind = 'none';
  private flourishTime = 0;
  private swirlEnergy = 0;
  private controlled = false;
  private talkLine: Timeline | null = null;
  private talkTime = 0;
  private disposed = false;

  readonly spellCooldowns: [number, number] = [0, 0];

  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(config: DancerConfig) {
    this.config = config;
    this.group.name = `dancer-${config.id}`;
    this.pos.set(config.homePos[0], 0, config.homePos[1]);
    this.yaw = config.homeYaw;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    this.face = new Face({ seed: hashSeed(config.id) + 77, talkOpen: 1.15 });
    this.face.attend = 0.8;
    this.face.mood('smile', { fade: 0.35 });

    // Invisible click/tap raycast cylinder around the dancer for direct 3D selection
    const hitGeo = new THREE.CylinderGeometry(0.62, 0.62, config.spec.heightMeters + 0.35, 12);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.ownedGeos.push(hitGeo);
    this.ownedMats.push(hitMat);
    this.hitCollider = new THREE.Mesh(hitGeo, hitMat);
    this.hitCollider.position.y = (config.spec.heightMeters + 0.35) * 0.5;
    this.hitCollider.userData.dancerId = config.id;
    this.group.add(this.hitCollider);

    // Glowing floor spotlight ring under the dancer
    const ringGeo = new THREE.RingGeometry(0.68, 0.92, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.spotlightRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(config.auraHex),
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ownedGeos.push(ringGeo);
    this.ownedMats.push(this.spotlightRingMat);
    this.spotlightRing = new THREE.Mesh(ringGeo, this.spotlightRingMat);
    this.spotlightRing.position.y = 0.04;
    this.group.add(this.spotlightRing);

    // Translucent volumetric spotlight cone when selected/controlled
    const beamGeo = new THREE.CylinderGeometry(0.32, 1.35, 7.6, 24, 1, true);
    this.spotlightBeamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(config.auraHex),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ownedGeos.push(beamGeo);
    this.ownedMats.push(this.spotlightBeamMat);
    this.spotlightBeam = new THREE.Mesh(beamGeo, this.spotlightBeamMat);
    this.spotlightBeam.position.y = 3.8;
    this.group.add(this.spotlightBeam);

    // Floating 3D custom speech bubble above head
    this.bubble = new AvatarSpeechBubble({
      baseHeight: config.spec.heightMeters + 0.55,
      style: config.spec.bubbleStyle,
    });
    this.group.add(this.bubble.sprite);

    this.buildPlaceholder();
    this.group.add(this.placeholderGroup);
  }

  loadModel(): Promise<boolean> {
    if (typeof fetch !== 'function' || typeof window === 'undefined') {
      return Promise.resolve(false);
    }
    const url = getNpcModelUrl(this.config.id);
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
        console.warn(`[starlight-dancer:${this.config.id}] failed to load ${url}:`, err);
        return false;
      });
  }

  setControlled(active: boolean): void {
    this.controlled = active;
    if (active) {
      this.face.mood('grin', { fade: 0.25 });
    } else {
      this.face.mood('smile', { fade: 0.45 });
    }
  }

  isControlled(): boolean {
    return this.controlled;
  }

  getActiveFlourish(): FlourishKind {
    return this.activeFlourish;
  }

  triggerFlourish(kind: FlourishKind): void {
    if (kind === 'none') return;
    this.activeFlourish = kind;
    this.flourishTime = 0;
    if (kind === 'leap') {
      this.face.mood('laugh', { fade: 0.15 });
    } else if (kind === 'spin_left' || kind === 'spin_right' || kind === 'twirl') {
      this.face.mood('grin', { fade: 0.15 });
    } else if (kind === 'drop') {
      this.face.mood('mischief', { fade: 0.15 });
    } else if (kind === 'cast1' || kind === 'cast2') {
      this.face.mood('awe', { fade: 0.12 });
    }
  }

  launchGeyser(velocityY = 10.6): void {
    this.geyserVelY = Math.max(this.geyserVelY, velocityY);
    this.geyserSpin = 1.0;
    this.face.mood('laugh', { fade: 0.12 });
    this.say('Wheee!! Zero-G spin!', 'laugh', 3.0);
  }

  canCastSpell(slot: 1 | 2): boolean {
    return this.spellCooldowns[slot - 1] <= 0.01;
  }

  markSpellCast(slot: 1 | 2): SpellMeta {
    const meta = this.config.spells[slot - 1];
    this.spellCooldowns[slot - 1] = meta.cooldownSec;
    this.triggerFlourish(slot === 1 ? 'cast1' : 'cast2');
    this.say(meta.bark, slot === 1 ? 'grin' : 'awe', 3.6);
    return meta;
  }

  say(text: string, expr: ExprName = 'smile', durationSec = 3.4): void {
    const clean = text.trim();
    if (!clean) return;
    this.face.mood(expr, { fade: 0.2 });
    const tl = lineOf(clean, { rate: 1.05, lead: 0.04 });
    this.talkLine = tl;
    this.talkTime = 0;
    this.face.speech = { tl, t: 0, w: 1 };
    this.bubble.showText(clean, this.config.spec.bubbleStyle, durationSec);
  }

  cheer(): void {
    const list = this.config.cheerBarks;
    const pick = list[Math.floor(Math.random() * list.length)];
    this.say(pick, 'laugh', 3.0);
    this.triggerFlourish('leap');
  }

  update(
    dt: number,
    elapsed: number,
    style: DanceStyle,
    levitating: boolean,
    overdrive: boolean,
    leader: DancePerformer | null,
    formationAngle: number,
    input: DancerMotionInput | null,
  ): void {
    const step = Math.min(Math.max(dt, 0), 0.05);

    // Tick spell cooldowns
    this.spellCooldowns[0] = Math.max(0, this.spellCooldowns[0] - step);
    this.spellCooldowns[1] = Math.max(0, this.spellCooldowns[1] - step);

    // 1. Movement & formation choreography
    const stageRadius = 9.4;
    if (this.controlled && input) {
      const speed = input.sprint ? 7.6 : 5.4;
      const targetVx = input.moveX * speed;
      const targetVz = input.moveZ * speed;
      this.vel.x = damp(this.vel.x, targetVx, 9.5, step);
      this.vel.z = damp(this.vel.z, targetVz, 9.5, step);
      this.pos.x += this.vel.x * step;
      this.pos.z += this.vel.z * step;

      // Keep inside pavilion dance arena cleanly
      const r = Math.hypot(this.pos.x, this.pos.z);
      if (r > stageRadius) {
        const s = stageRadius / r;
        this.pos.x *= s;
        this.pos.z *= s;
      }

      const moveSpeed = Math.hypot(this.vel.x, this.vel.z);
      if (moveSpeed > 0.25) {
        const desiredYaw = Math.atan2(this.vel.x, this.vel.z);
        this.yaw += angDiff(this.yaw, desiredYaw) * (1 - Math.exp(-10 * step));
      }
      this.swirlEnergy = damp(this.swirlEnergy, clamp(input.swirlIntensity, 0, 1), 8, step);
    } else {
      // Autonomous trio dance formation (either orbiting around stage center or flanking the player's controlled dancer!)
      const beatT = elapsed * DANCE_BPS;
      let targetX: number;
      let targetZ: number;
      let targetYaw: number;

      if (leader && leader !== this) {
        const orbitR = style === 'waltz' ? 3.5 : 3.0;
        const slowOrbit = formationAngle + elapsed * (style === 'waltz' ? 0.36 : 0.55);
        targetX = leader.pos.x + Math.cos(slowOrbit) * orbitR;
        targetZ = leader.pos.z + Math.sin(slowOrbit) * orbitR;
        // Clamp backup dancer inside pavilion
        const rr = Math.hypot(targetX, targetZ);
        if (rr > stageRadius - 0.5) {
          const s = (stageRadius - 0.5) / rr;
          targetX *= s;
          targetZ *= s;
        }
        targetYaw = Math.atan2(leader.pos.x - this.pos.x, leader.pos.z - this.pos.z);
      } else {
        // Default autonomous trio showcase choreography!
        const orbitSpeed = style === 'waltz' ? 0.32 : style === 'hypergroove' ? 0.45 : 0.52;
        const angle = formationAngle + elapsed * orbitSpeed;
        const radius =
          style === 'waltz'
            ? 3.1 + Math.sin(beatT * 0.5 + formationAngle) * 0.85
            : style === 'hypergroove'
              ? 2.8 + Math.sin(beatT * 1.0 + formationAngle) * 0.55
              : 3.35 + Math.cos(beatT * 0.75 + formationAngle) * 0.75;
        targetX = Math.cos(angle) * radius;
        targetZ = Math.sin(angle) * radius - 0.8;
        // Face slightly outward / toward approaching visitors on +Z promenade while glancing across trio
        const tangentYaw = Math.atan2(-Math.sin(angle), Math.cos(angle));
        const frontYaw = Math.atan2(-targetX * 0.35, 6.0 - targetZ);
        targetYaw = style === 'waltz' ? tangentYaw : frontYaw;
      }

      const prevX = this.pos.x;
      const prevZ = this.pos.z;
      this.pos.x = damp(this.pos.x, targetX, 3.2, step);
      this.pos.z = damp(this.pos.z, targetZ, 3.2, step);
      if (step > 1e-4) {
        this.vel.x = (this.pos.x - prevX) / step;
        this.vel.z = (this.pos.z - prevZ) / step;
      }
      this.yaw += angDiff(this.yaw, targetYaw) * (1 - Math.exp(-5.2 * step));
      this.swirlEnergy = damp(this.swirlEnergy, overdrive ? 0.65 : 0, 5, step);
    }

    // 2. Flourish clock & aerial physics (leaps, geyser launches, aurora levitation)
    let flourishEnv = 0;
    let flourishNorm = 0;
    if (this.activeFlourish !== 'none') {
      this.flourishTime += step;
      const dur = FLOURISH_DURATION[this.activeFlourish];
      if (this.flourishTime >= dur) {
        this.activeFlourish = 'none';
        this.flourishTime = 0;
      } else {
        flourishNorm = clamp(this.flourishTime / dur, 0, 1);
        flourishEnv = Math.sin(flourishNorm * Math.PI);
      }
    }

    // Geyser launch vertical arc
    if (this.jumpHeight > 0 || this.geyserVelY > 0) {
      this.jumpHeight += this.geyserVelY * step;
      this.geyserVelY -= 16.5 * step; // buoyant dreamy gravity
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0;
        this.geyserVelY = 0;
        this.geyserSpin = 0;
      }
    }

    // Aurora canopy levitation hover
    this.levitateAmount = damp(this.levitateAmount, levitating ? 1 : 0, 3.5, step);
    const levY = this.levitateAmount * (1.25 + Math.sin(elapsed * 2.6 + formationAngle) * 0.28);

    // Leap flourish arc
    const leapY = this.activeFlourish === 'leap' ? Math.sin(flourishNorm * Math.PI) * 2.15 : 0;

    // Spin offset from pirouettes, geyser spin, and continuous swirl
    let spinDelta = 0;
    if (this.activeFlourish === 'spin_left') spinDelta = Math.PI * 2 * (step / FLOURISH_DURATION.spin_left);
    else if (this.activeFlourish === 'spin_right') spinDelta = -Math.PI * 2 * (step / FLOURISH_DURATION.spin_right);
    else if (this.activeFlourish === 'twirl') spinDelta = Math.PI * 3.2 * step;
    if (this.swirlEnergy > 0.05) spinDelta += this.swirlEnergy * Math.PI * 3.6 * step;
    if (this.geyserSpin > 0.01) spinDelta += Math.PI * 3.2 * step;
    if (this.activeFlourish === 'cast1') spinDelta += Math.PI * 2 * (step / FLOURISH_DURATION.cast1);

    if (Math.abs(spinDelta) > 1e-5) {
      this.spinOffset += spinDelta;
    } else {
      // Unwind residual spin cleanly back to 0 mod 2π
      const twoPi = Math.PI * 2;
      const rem = ((this.spinOffset % twoPi) + twoPi) % twoPi;
      const shortest = rem > Math.PI ? rem - twoPi : rem;
      this.spinOffset = damp(shortest, 0, 7.0, step);
    }

    this.group.position.set(this.pos.x, this.jumpHeight + levY + leapY, this.pos.z);
    this.group.rotation.y = this.yaw + this.spinOffset;

    // 3. Advance @ericrius1/cast Face state
    if (this.talkLine) {
      this.talkTime += step;
      if (this.talkTime <= this.talkLine.dur + 0.12) {
        const w = this.talkTime > this.talkLine.dur ? Math.max(0, 1 - (this.talkTime - this.talkLine.dur) / 0.12) : 1;
        this.face.speech = { tl: this.talkLine, t: Math.min(this.talkTime, this.talkLine.dur), w };
      } else {
        this.talkLine = null;
        this.face.speech = null;
      }
    }
    const faceState = this.face.update(step, {}, [0, 0.06, 1]);

    // 4. Full-body skeletal dance animation synced to 88 BPM!
    const beatPhase = elapsed * DANCE_BPS * Math.PI * 2;
    const beatPulse = 0.5 + 0.5 * Math.sin(beatPhase);
    const speedNorm = clamp(Math.hypot(this.vel.x, this.vel.z) / 5.5, 0, 1);

    if (this.bones.size > 0) {
      this.applyDancePose(
        elapsed,
        beatPhase,
        style,
        speedNorm,
        flourishEnv,
        flourishNorm,
        overdrive,
        faceState.open,
        faceState.blink,
      );
    } else if (this.placeholderGroup.visible) {
      this.placeholderGroup.position.y = Math.abs(Math.sin(beatPhase * 0.5)) * 0.12;
      this.placeholderGroup.rotation.z = Math.sin(beatPhase * 0.5) * 0.08;
    }

    // Pulse emissives on the 88 BPM beat
    for (const item of this.emissiveMats) {
      item.mat.emissiveIntensity = item.baseIntensity * (0.85 + 0.45 * beatPulse + (overdrive ? 0.5 : 0));
    }

    // Update spotlight ring & volumetric cone
    this.spotlightRing.position.y = 0.04 - (this.jumpHeight + levY + leapY);
    const ringTargetOpacity = this.controlled ? 0.85 : overdrive ? 0.55 : 0.28;
    this.spotlightRingMat.opacity = damp(this.spotlightRingMat.opacity, ringTargetOpacity, 8, step);
    const ringScale = (this.controlled ? 1.18 : 0.96) + beatPulse * 0.1;
    this.spotlightRing.scale.set(ringScale, ringScale, 1);

    this.spotlightBeam.position.y = 3.8 - (this.jumpHeight + levY + leapY);
    this.spotlightBeamMat.opacity = damp(
      this.spotlightBeamMat.opacity,
      this.controlled ? 0.16 + beatPulse * 0.06 : overdrive ? 0.08 : 0.0,
      7,
      step,
    );

    this.bubble.update(step, elapsed);
  }

  private applyDancePose(
    elapsed: number,
    beatPhase: number,
    style: DanceStyle,
    speedNorm: number,
    flourishEnv: number,
    flourishNorm: number,
    overdrive: boolean,
    jawOpen: number,
    blink: number,
  ): void {
    const idPhase = this.config.id === 'soraya' ? 0 : this.config.id === 'dex' ? 2.09 : 4.18;
    const b1 = Math.sin(beatPhase + idPhase * 0.15);
    const bHalf = Math.sin(beatPhase * 0.5 + idPhase * 0.3);
    const bDouble = Math.sin(beatPhase * 2.0);
    const bounce = Math.abs(Math.sin(beatPhase));
    const energy = (overdrive ? 1.35 : 1.0) * (this.controlled ? 1.12 : 0.95);

    // Style-specific rhythmic phrasing
    const isWaltz = style === 'waltz';
    const isGroove = style === 'hypergroove';
    const isDrop = this.activeFlourish === 'drop';
    const isLeap = this.activeFlourish === 'leap' || this.jumpHeight > 0.25 || this.levitateAmount > 0.3;
    const isSpin =
      this.activeFlourish === 'spin_left' ||
      this.activeFlourish === 'spin_right' ||
      this.activeFlourish === 'twirl' ||
      this.swirlEnergy > 0.15;

    // Root vertical bounce & groove squat
    const rootBone = this.bones.get('Root');
    if (rootBone) {
      rootBone.bone.position.copy(rootBone.restPos);
      let yBob = isGroove ? -bounce * 0.095 * energy : Math.sin(beatPhase) * 0.045 * energy;
      if (isDrop) yBob -= flourishEnv * 0.32;
      rootBone.bone.position.y += yBob;
    }

    // Hip / Spine / Chest sway & groove pop
    const hipRoll = bHalf * (isWaltz ? 0.14 : 0.18) * energy;
    const hipYaw = bHalf * (isGroove ? 0.22 : 0.14) * energy;
    const spinePitch = (isDrop ? 0.34 * flourishEnv : 0) + (isGroove ? bounce * 0.11 : 0.04) - speedNorm * 0.08;
    const chestTwist = -hipYaw * 1.15 + (isGroove ? bDouble * 0.06 : 0);

    this.rotateBone('Pelvis', spinePitch * 0.35, hipYaw, hipRoll);
    this.rotateBone('Spine', spinePitch * 0.5, -hipYaw * 0.5, -hipRoll * 0.65);
    this.rotateBone('Chest', (isLeap ? -0.18 : bounce * 0.06), chestTwist, bHalf * 0.09);

    // Head bob & musical groove nod
    const headBob = isGroove ? Math.max(0, b1) * 0.18 : Math.sin(beatPhase * 0.5) * 0.09;
    this.rotateBone('Neck', headBob * 0.45, -chestTwist * 0.35, bHalf * 0.08);
    this.rotateBone('Head', headBob * 0.55, bHalf * 0.16, -bHalf * 0.12);

    // Live @ericrius1/cast Jaw lip-sync & joyful humming mouth
    const smileHum = overdrive ? 0.08 * bounce : 0;
    this.rotateBone('Jaw', clamp(jawOpen * 0.34 + smileHum, 0, 0.38), 0, 0);

    // Orientation-aware vertical eye blinking
    for (const eyeName of ['EyeL', 'EyeR']) {
      const entry = this.bones.get(eyeName);
      if (!entry) continue;
      const blinkScale = Math.max(0.12, 1 - blink * 0.88);
      if (entry.upAxis === 'x') entry.bone.scale.set(blinkScale, 1, 1);
      else if (entry.upAxis === 'z') entry.bone.scale.set(1, 1, blinkScale);
      else entry.bone.scale.set(1, blinkScale, 1);
    }

    // Arms choreography — each character has a signature vibe!
    let armLPitch = -0.35;
    let armLRoll = 0.28;
    let foreLPitch = -0.45;
    let armRPitch = -0.45;
    let armRRoll = -0.32;
    let foreRPitch = -0.42;

    if (this.config.id === 'soraya') {
      // Sweeping baton conductor arcs!
      armRPitch = -1.15 + Math.sin(beatPhase * 0.5) * 0.38 * energy;
      armRRoll = -0.42 - Math.cos(beatPhase * 0.5) * 0.32;
      foreRPitch = -0.35 + Math.sin(beatPhase) * 0.28;
      armLPitch = -0.52 + Math.cos(beatPhase * 0.5) * 0.32;
      armLRoll = 0.38 + Math.sin(beatPhase * 0.5) * 0.22;
      foreLPitch = -0.58;
    } else if (this.config.id === 'dex') {
      // Punchy cyberpunk prism pops & alternating groove pumps!
      armLPitch = -0.78 + Math.sin(beatPhase) * 0.48 * energy;
      armLRoll = 0.36 + Math.abs(bHalf) * 0.25;
      foreLPitch = -0.82 - Math.cos(beatPhase) * 0.35;
      armRPitch = -0.86 - Math.sin(beatPhase) * 0.44 * energy;
      armRRoll = -0.34 - Math.abs(bHalf) * 0.25;
      foreRPitch = -0.74 + Math.cos(beatPhase) * 0.3;
    } else {
      // Ermelin: cheerful lantern-waltz lifts & lively mitten swings!
      armRPitch = -0.92 + Math.sin(beatPhase * 0.5) * 0.25 * energy;
      armRRoll = -0.28;
      foreRPitch = -0.42 + Math.sin(beatPhase) * 0.18;
      armLPitch = -0.48 - Math.sin(beatPhase) * 0.42 * energy;
      armLRoll = 0.34 + bounce * 0.28;
      foreLPitch = -0.52;
    }

    // Flourish & Spell arm overrides
    if (isSpin) {
      const k = Math.max(flourishEnv, this.swirlEnergy);
      armLPitch = damp(armLPitch, -0.35, 1, k);
      armLRoll += 0.95 * k;
      foreLPitch *= 1 - 0.5 * k;
      armRPitch = damp(armRPitch, -0.45, 1, k);
      armRRoll -= 0.95 * k;
      foreRPitch *= 1 - 0.5 * k;
    }
    if (isLeap) {
      const lift = this.activeFlourish === 'leap' ? flourishEnv : 0.78;
      armLPitch -= 1.05 * lift;
      armLRoll += 0.45 * lift;
      armRPitch -= 1.05 * lift;
      armRRoll -= 0.45 * lift;
    }
    if (isDrop) {
      armLPitch += 0.42 * flourishEnv;
      armLRoll += 0.55 * flourishEnv;
      armRPitch += 0.42 * flourishEnv;
      armRRoll -= 0.55 * flourishEnv;
    }
    if (this.activeFlourish === 'cast1') {
      const punch = Math.sin(flourishNorm * Math.PI);
      armRPitch = -1.45 * punch + armRPitch * (1 - punch);
      armRRoll = -0.55 * punch;
      foreRPitch = -0.15 * punch;
      armLPitch = -0.85 * punch + armLPitch * (1 - punch);
    } else if (this.activeFlourish === 'cast2') {
      const raise = Math.sin(flourishNorm * Math.PI);
      armLPitch = -2.05 * raise + armLPitch * (1 - raise);
      armLRoll = 0.35 * raise;
      armRPitch = -2.05 * raise + armRPitch * (1 - raise);
      armRRoll = -0.35 * raise;
    }

    this.rotateBone('ArmL', armLPitch, 0, armLRoll);
    this.rotateBone('ForearmL', foreLPitch, 0, 0);
    this.rotateBone('ArmR', armRPitch, 0, armRRoll);
    this.rotateBone('ForearmR', foreRPitch, 0, 0);

    // Legs & footwork stepping synced to beat & movement speed!
    const stepAmp = (0.28 + speedNorm * 0.45) * energy;
    const strideL = Math.sin(beatPhase * (isGroove ? 1.0 : 0.5)) * stepAmp;
    const strideR = -strideL;
    let thighLPitch = strideL - (isDrop ? 0.55 * flourishEnv : 0);
    let shinLPitch = Math.max(0, -strideL * 1.15) + (isDrop ? 0.92 * flourishEnv : bounce * (isGroove ? 0.24 : 0.08));
    let thighRPitch = strideR - (isDrop ? 0.55 * flourishEnv : 0);
    let shinRPitch = Math.max(0, -strideR * 1.15) + (isDrop ? 0.92 * flourishEnv : bounce * (isGroove ? 0.24 : 0.08));

    if (isLeap) {
      const k = this.activeFlourish === 'leap' ? flourishEnv : 0.65;
      thighLPitch = -0.52 * k;
      shinLPitch = 0.85 * k;
      thighRPitch = 0.22 * k;
      shinRPitch = 0.48 * k;
    }

    this.rotateBone('ThighL', thighLPitch, 0, 0.05);
    this.rotateBone('ShinL', shinLPitch, 0, 0);
    this.rotateBone('FootL', -shinLPitch * 0.45, 0, 0);
    this.rotateBone('ThighR', thighRPitch, 0, -0.05);
    this.rotateBone('ShinR', shinRPitch, 0, 0);
    this.rotateBone('FootR', -shinRPitch * 0.45, 0, 0);

    // Expressive bespoke secondary bones (Soraya's coat/baton, Ermelin's ears/tail/scarf/lantern!)
    const flare = isSpin ? 0.32 : speedNorm * 0.16;
    this.rotateBone('Cloak', 0.08 + flare + Math.sin(beatPhase) * 0.12, 0, Math.cos(beatPhase * 0.5) * 0.1);
    this.rotateBone('Tail1', 0.12, Math.sin(beatPhase) * 0.42, 0);
    this.rotateBone('Tail2', 0.08, Math.sin(beatPhase - 0.8) * 0.52, 0);
    this.rotateBone('EarL', 0, 0, Math.sin(beatPhase * 2) * 0.14 + (isLeap ? 0.25 : 0));
    this.rotateBone('EarR', 0, 0, -Math.sin(beatPhase * 2) * 0.14 - (isLeap ? 0.25 : 0));
    this.rotateBone('Lantern', Math.sin(beatPhase) * 0.18 + speedNorm * 0.15, 0, Math.cos(beatPhase * 0.5) * 0.14);
    this.rotateBone('PropR', Math.sin(beatPhase) * 0.14, isSpin ? elapsed * 4.5 : 0, 0);
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
          if (
            m instanceof THREE.MeshStandardMaterial &&
            m.emissive &&
            (m.emissive.r > 0.01 || m.emissive.g > 0.01 || m.emissive.b > 0.01) &&
            m.emissiveIntensity > 0
          ) {
            this.emissiveMats.push({ mat: m, baseIntensity: m.emissiveIntensity });
          }
        }
      }
    });

    const box = new THREE.Box3().setFromObject(scene);
    if (Number.isFinite(box.min.y) && Math.abs(box.min.y) > 0.015) {
      scene.position.y -= box.min.y;
    }
    this.group.add(scene);
  }

  private buildPlaceholder(): void {
    const h = this.config.spec.heightMeters;
    const col = new THREE.Color(this.config.auraHex);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    });
    const headMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.35 });
    const bodyGeo = new THREE.CapsuleGeometry(0.24, Math.max(0.45, h * 0.52), 8, 16);
    const headGeo = new THREE.SphereGeometry(0.18, 16, 12);
    this.ownedGeos.push(bodyGeo, headGeo);
    this.ownedMats.push(bodyMat, headMat);

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h * 0.42;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = h * 0.84;
    this.placeholderGroup.add(body, head);
  }

  dispose(): void {
    this.disposed = true;
    this.bubble.dispose();
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    if (this.modelRoot) {
      disposeObject(this.modelRoot);
      this.modelRoot = null;
    }
    this.bones.clear();
    this.emissiveMats.length = 0;
  }
}
