import type * as THREE from 'three/webgpu';
import type { AvatarMotionState } from './types';

/**
 * Shared contract between Zephyr the Prism Sky Drake's procedural texture & TSL
 * shader module (`skyDrakeMaterials.ts`) and its 3D model / skeleton rig (`skyDrake.ts`).
 */
export interface SkyDrakeMaterialSet {
  /** Iridescent deep-cerulean / twilight-indigo scales with procedural normal/roughness detail & Fresnel rim. */
  readonly body: THREE.Material;
  /** Warm opalescent ivory-gold segmented belly plates. */
  readonly belly: THREE.Material;
  /** Carved pearlescent gold-ivory material for curved horns and claws. */
  readonly horn: THREE.Material;
  /** Double-sided translucent aurora wing membrane with glowing bioluminescent veins & flight shimmer. */
  readonly wingMembrane: THREE.Material;
  /** Sleek dark lapis-teal wing spar / finger / spine-ridge material with subtle metallic trim. */
  readonly wingBone: THREE.Material;
  /** Double-sided luminous aurora crest / cheek-fin / tail-vane material that brightens in flight & boost. */
  readonly crest: THREE.Material;
  /** Expressive glowing amber-gold dragon iris with vertical slit pupil & starlight catchlight. */
  readonly eyeIris: THREE.Material;
  /** Dark glossy pupil/rim ring or outer sclera accent. */
  readonly eyeRim: THREE.Material;
  /** Matching upper scale material for animated blinking eyelids. */
  readonly eyelid: THREE.Material;
  /** Cosmic twilight-gold woven sky-explorer neck scarf / wing-harness trim. */
  readonly scarf: THREE.Material;
  /** Subtle tinting hook for the player's profile aura color (preserves the drake's core palette). */
  setAccentColor(hexColor: string): void;
  /** Push motion uniforms (flight, boost, speed, time) into TSL materials each frame. */
  update(dt: number, elapsed: number, motion: AvatarMotionState): void;
  /** Dispose every procedural texture and material owned by this material set. */
  dispose(): void;
}
