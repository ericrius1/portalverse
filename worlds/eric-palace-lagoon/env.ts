import type { Kit, RenderPass, RunEntry, Texture, UniformBuffer } from '@ericrius1/weft';
import type { ProjectionRig } from '@portalverse/core/rooms/projection/rig';
import type { TimeOfDay, V3 } from './timeOfDay';

/**
 * What the Palace Lagoon's renderer (renderer.ts) gives each part of the room that draws (the trees, the life, the
 * projection show): the kit, the passes to declare draws into, and the room's shared light.
 *
 * Every shader that #includes shaders/common.wgsl binds `world` (G, the room's Globals; shadowMap, the key light's
 * shadow). Draws go into passes in the order they're declared, within each pass's phases:
 *   scene: 'opaque' (solid things: the Palace, the land, trees, bodies), 'water' (the lagoon, reading the reflection),
 *          'sky' (drawn where nothing else is), 'glow' (additive light after everything: depthWrite false,
 *          blend additive: fireflies, lanterns' halos, wings' sparkle)
 *   refl:  the same phases, drawn from below the water (frame.user.x = 1: discard with clipBelowWater(p) in the
 *          fragment); add what should show in the lagoon's mirror, cull: 'none' (it's mirrored)
 *   shadow: depth-only from the key light (orthographic; baked when the key light moves, not every frame): add
 *          casters with `vertex: '<your shadow entry>', fragment: null`
 */
export interface RoomEnv {
  kit: Kit;
  scene: RenderPass;
  refl: RenderPass;
  shadow: RenderPass;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  world: { G: UniformBuffer<any>; shadowMap: Texture };
  /** the drones' projectors: spread `projection.bindings` into a draw's bind to light it with them (light.wgsl) */
  projection: ProjectionRig;
}

/** What a part of the room is told each view, before its passes run. */
export interface FrameState {
  /** seconds (the engine's clock) and the last frame's length */
  time: number;
  dt: number;
  /** the eye (world) */
  camPos: V3;
  /** 0 sunset .. 1 night (layout.ts duskAt), and the light that goes with it */
  dusk: number;
  tod: TimeOfDay;
  /** the first view of this engine frame (simulate once a frame, here); later views of the same frame only draw */
  firstView: boolean;
  /** the player's feet (world), or null in a portal's preview */
  player: V3 | null;
}

/** One part of the room. */
export interface RoomFeature {
  /** resolves when its pipelines and data are ready (the room waits for it, up to a point) */
  ready: Promise<void>;
  /** set its uniforms for this view (CPU only) */
  frame?(state: FrameState): void;
  /** work to run before the room's passes, once a frame (computes: a flock's step, a sim); called on the first view */
  items?(state: FrameState): readonly RunEntry[];
}
