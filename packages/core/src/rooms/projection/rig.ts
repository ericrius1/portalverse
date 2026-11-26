import { Camera, StructArray, type Bindable, type Compute, type Kit, type RenderPass, type RunEntry, type StorageBuffer, type Texture, type UniformBuffer, type View } from '@ericrius1/weft';
import lightShader from './light.wgsl';
import contentShader from './content.wgsl';
import dronesShader from './drones.wgsl';
import beamsShader from './beams.wgsl';

/**
 * Projection mapping for weft scenes: a rig of projectors (drones, masts, lamps on a façade) whose light lands on
 * whatever a surface shader draws, mapped to it or thrown, occluded by what stands in the way, and seen in the air as
 * beams. Nothing in it knows about any one place: a host gives it occluders to cast the projectors' shadows, adds
 * `projectedLight(p, n)` (light.wgsl) to its surfaces, and moves the projectors about.
 *
 *     const rig = new ProjectionRig(kit, { capacity: 12 });
 *     rig.occluders((pass) => pass.draw(building, { vertex: 'vsShadow', fragment: null, ... }));
 *     surfacePass.draw(building, { bind: { ...mine, ...rig.bindings } });       // light.wgsl in its fragment
 *     rig.drones(scenePass, { phase: 'opaque' }, { phase: 'glow' });            // optional: the drones themselves
 *     rig.beams(beamPass, sceneDepth, () => viewport);                         // optional: the beams in the haze
 *     // each frame: move rig.projectors[i], then
 *     kit.run([...rig.update(time), ...yourPasses]);
 *
 * Each frame the rig writes the projectors, paints every lit projector's image (content.wgsl, from the programs in
 * programs.wgsl) and redraws the depth maps of the ones that moved (a few a frame: a projector holding still costs
 * nothing). Light units: a projector's `power` is the light a square-on surface 10 m away takes from a white frame.
 */

export type V3 = [number, number, number];

/** What lands where a projector's light lands. */
export type Mapping =
  /** its image in its own frame, as a real projector throws it */
  | { kind: 'throw' }
  /** its image in a cylinder's coordinates round a vertical axis: `repeats` frames round it, `height` m tall from `foot` */
  | { kind: 'cylinder'; axis: [number, number]; repeats: number; foot: number; height: number }
  /** its image on a plane: from `origin` along `right` and `down` (unit), `height` m a frame, `aspect` wide */
  | { kind: 'plane'; origin: V3; right: V3; down: V3; height: number; aspect: number };

export interface Projector {
  /** the lens (world) and what it's pointed at */
  position: V3;
  target: V3;
  /** its frame's vertical field of view (radians); frames are square */
  fovY: number;
  /** its lamp (0: off) and colour */
  power: number;
  tint: V3;
  /** how strongly its beam shows in the haze (0: not at all) */
  haze: number;
  /** test what stands in its way (its depth map) */
  occlude: boolean;
  /** draw a drone body at its lens (rig.drones) */
  body: boolean;
  /** the program it shows (programs.wgsl), the one it's crossing to and how far across (0..1), its seed (0..1) */
  program: number;
  nextProgram: number;
  blend: number;
  seed: number;
  /** its image's clock (s): by default the rig's time */
  clock?: number;
  mapping: Mapping;
}

export interface ProjectionRigOptions {
  /** how many projectors (at most 16) */
  capacity?: number;
  /** each image's size (px, square) */
  imageSize?: number;
  /** each depth map's size (px, square) */
  depthSize?: number;
  /** how many moved projectors' depth maps are redrawn a frame */
  depthPerFrame?: number;
  /** paint the images every n-th frame (alternating halves of the rig on 2) */
  paintEvery?: 1 | 2;
  label?: string;
}

/** The light the drones' bodies are lit by, and this view's haze (rig.setView). */
export interface RigView {
  keyDir: V3;
  keyColor: V3;
  ambSky: V3;
  ambGround: V3;
  /** this view's viewport in its target (x, y, w, h px) */
  viewport: readonly number[];
  /** this view's clock (s): the drones' hover */
  time: number;
  /** how dense the air is for the beams (per metre; 0: no beams) */
  hazeDensity: number;
  /** how bright the drones' own lights are (0..1: their nav lights and lens show at dusk and night) */
  lights: number;
}

const NEAR = 0.3;

export function defaultProjector(): Projector {
  return {
    position: [0, 10, 0], target: [0, 0, -10], fovY: 0.8, power: 0, tint: [1, 1, 1], haze: 1, occlude: true, body: true,
    program: 0, nextProgram: 0, blend: 0, seed: 0, mapping: { kind: 'throw' },
  };
}

export class ProjectionRig {
  readonly kit: Kit;
  readonly capacity: number;
  readonly projectors: Projector[];
  /** spread into the bind of every draw whose shader includes light.wgsl */
  readonly bindings: { projectors: StorageBuffer; projectorImage: Texture; projectorDepth: Texture };
  /** one depth-only pass per projector, drawn from it (add occluders with `occluders`) */
  readonly depthPasses: RenderPass[];
  /** resolves when the rig's own pipelines are compiled */
  readonly ready: Promise<void>;
  private readonly cams: Camera[] = [];
  private readonly views: View[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly data: StructArray<any>;
  private readonly buffer: StorageBuffer;
  private readonly paint: Compute;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly viewU: UniformBuffer<any>;
  private readonly depthPerFrame: number;
  private readonly paintEvery: number;
  /** where each depth map was drawn from (lens, target, fov), and the matrix it was drawn with */
  private readonly drawnFrom: Float64Array;
  private readonly drawnVP: Float32Array[];
  private readonly drawn: boolean[];
  private cursor = 0;
  private readonly painted: boolean[] = [];
  private frameNo = 0;
  private time = 0;

  constructor(kit: Kit, options: ProjectionRigOptions = {}) {
    this.kit = kit;
    const n = (this.capacity = Math.min(16, Math.max(1, options.capacity ?? 12)));
    const label = options.label ?? 'projection';
    const imageSize = options.imageSize ?? 512;
    const depthSize = options.depthSize ?? 1024;
    this.depthPerFrame = options.depthPerFrame ?? 2;
    this.paintEvery = options.paintEvery ?? 1;
    this.projectors = Array.from({ length: n }, defaultProjector);

    this.data = new StructArray(lightShader.structs.Projector, n);
    this.buffer = kit.storage({ label: `${label}.projectors`, size: this.data.data.byteLength, usage: ['storage', 'copy-dst'] });
    const image = kit.texture({ label: `${label}.images`, format: 'rgba16float', size: [imageSize, imageSize, n], view: '2d-array', usage: ['storage', 'sample'] });
    const depth = kit.texture({ label: `${label}.depth`, format: 'depth32float', size: [depthSize, depthSize, n], view: '2d-array', usage: ['render', 'sample'] });
    this.bindings = { projectors: this.buffer, projectorImage: image, projectorDepth: depth };

    this.paint = kit.compute(contentShader, { label: `${label}.paint`, entry: 'paint', bind: { projectors: this.buffer, paintOut: image }, threads: [imageSize, imageSize, n] });
    this.depthPasses = [];
    this.drawnFrom = new Float64Array(n * 7);
    this.drawnVP = [];
    this.drawn = [];
    for (let i = 0; i < n; i++) {
      const cam = new Camera();
      cam.near = NEAR;
      cam.far = Infinity;
      const view = kit.view(cam, [depthSize, depthSize], `${label}.view${i}`);
      this.cams.push(cam);
      this.views.push(view);
      this.depthPasses.push(kit.pass({ label: `${label}.depth${i}`, view, depth: { target: depth.layer(i), clear: 0 } }));
      this.drawnVP.push(new Float32Array(16));
      this.drawn.push(false);
    }
    this.viewU = kit.uniforms(dronesShader.structs.RigView, `${label}.view`);
    this.ready = kit.ready([this.paint]).then(() => undefined);
  }

  /** Give every projector's depth pass the draws that cast its shadows (depth-only: `fragment: null`). */
  occluders(declare: (pass: RenderPass, index: number) => void): void {
    this.depthPasses.forEach((pass, i) => declare(pass, i));
  }

  /** Draw the drones at the projectors that have `body`: their bodies (opaque) and their lights (additive). */
  drones(pass: RenderPass, opaque: { phase?: string } = {}, glow: { phase?: string } = {}): void {
    const bind = { projectors: this.buffer, RV: this.viewU };
    pass.draw(dronesShader, { label: 'projection.drones', vertex: 'vsBody', fragment: 'fsBody', bind, count: DRONE_VERTS, instances: this.capacity, cull: 'none', ...opaque });
    pass.draw(dronesShader, {
      label: 'projection.droneLights', vertex: 'vsLight', fragment: 'fsLight', bind, count: 6 * LIGHTS_PER_DRONE, instances: this.capacity,
      cull: 'none', depthWrite: false,
      blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } },
      ...glow,
    });
  }

  /** Draw the beams in the haze into `pass` (colour loaded, no depth attachment), reading the scene's depth. */
  beams(pass: RenderPass, sceneDepth: Bindable): void {
    pass.fullscreen(beamsShader, {
      label: 'projection.beams',
      bind: { ...this.bindings, RV: this.viewU, sceneDepth },
      blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } },
    });
  }

  /** This view's light and haze, for the drones and the beams (call per view, before its run). */
  setView(v: RigView): void {
    this.viewU.set({
      keyDir: v.keyDir, keyColor: v.keyColor, ambSky: v.ambSky, ambGround: v.ambGround,
      vp: [v.viewport[0], v.viewport[1], v.viewport[2], v.viewport[3]], density: v.hazeDensity, lights: v.lights, time: v.time,
    });
  }

  /** Draw every lit projector's depth map again (what it sees has changed: a building loaded, a wall moved). */
  invalidateDepth(): void {
    this.drawn.fill(false);
  }

  /**
   * The frame's work: the projectors written, their images painted, the moved ones' depth maps redrawn. Once a frame.
   * `paint: false` when nothing will show the projectors this frame: no images painted, no depth maps drawn.
   */
  update(time: number, options: { paint?: boolean } = {}): RunEntry[] {
    this.time = time;
    this.frameNo++;
    const items: RunEntry[] = [];
    if (options.paint === false) {
      for (let i = 0; i < this.capacity; i++) this.write(i);
      this.buffer.write(this.data.data);
      return items;
    }
    // ---- which depth maps to redraw: the ones whose projector moved since, round the rig from where we left off
    let budget = this.depthPerFrame;
    const start = this.cursor;
    for (let k = 0; k < this.capacity && budget > 0; k++) {
      const i = (start + k) % this.capacity;
      const P = this.projectors[i];
      if (P.power <= 0 || !P.occlude || !this.moved(i)) continue;
      const cam = this.cams[i];
      cam.fovY = P.fovY;
      cam.lookAt(P.position, P.target);
      this.views[i].update(true);
      this.drawnVP[i].set(cam.viewProj);
      const f = this.drawnFrom, o = i * 7;
      f[o] = P.position[0]; f[o + 1] = P.position[1]; f[o + 2] = P.position[2];
      f[o + 3] = P.target[0]; f[o + 4] = P.target[1]; f[o + 5] = P.target[2]; f[o + 6] = P.fovY;
      this.drawn[i] = true;
      items.push(this.depthPasses[i]);
      budget--;
      this.cursor = (i + 1) % this.capacity;
    }
    // ---- the projectors, as light.wgsl reads them
    for (let i = 0; i < this.capacity; i++) this.write(i);
    this.buffer.write(this.data.data);
    items.unshift(this.paint);
    return items;
  }

  /** has projector i moved (or changed its lens) enough since its depth map was drawn to need a new one? */
  private moved(i: number): boolean {
    if (!this.drawn[i]) return true;
    const P = this.projectors[i], f = this.drawnFrom, o = i * 7;
    const dp = Math.hypot(P.position[0] - f[o], P.position[1] - f[o + 1], P.position[2] - f[o + 2]);
    const dt = Math.hypot(P.target[0] - f[o + 3], P.target[1] - f[o + 4], P.target[2] - f[o + 5]);
    return dp > 0.02 || dt > 0.05 || Math.abs(P.fovY - f[o + 6]) > 1e-4;
  }

  private readonly scratch = new Camera();
  private write(i: number): void {
    const P = this.projectors[i];
    const cam = this.scratch;
    cam.near = NEAR;
    cam.far = Infinity;
    cam.fovY = P.fovY;
    cam.lookAt(P.position, P.target);
    cam.update(1, 1);
    const ax = P.target[0] - P.position[0], ay = P.target[1] - P.position[1], az = P.target[2] - P.position[2];
    const al = Math.hypot(ax, ay, az) || 1;
    const m = P.mapping;
    let map: [number, number, number, number] = [0, 0, 0, 0];
    let mapB: [number, number, number, number] = [0, 0, 0, 0];
    let mapU: [number, number, number, number] = [0, 0, 0, 1];
    let mapV: [number, number, number, number] = [0, 0, 0, 0];
    if (m.kind === 'cylinder') {
      map = [1, m.axis[0], m.axis[1], m.repeats];
      mapB = [m.foot, m.height, 0, 0];
    } else if (m.kind === 'plane') {
      map = [2, 0, 0, 0];
      mapB = [m.origin[0], m.origin[1], m.origin[2], m.height];
      mapU = [m.right[0], m.right[1], m.right[2], m.aspect];
      mapV = [m.down[0], m.down[1], m.down[2], 0];
    }
    // (every lit projector paints on its first frame, then on its turn)
    const paintNow = this.paintEvery === 1 || !this.painted[i] || (i + this.frameNo) % this.paintEvery === 0;
    if (P.power > 0) this.painted[i] = true;
    this.data.set(i, {
      viewProj: cam.viewProj as unknown as number[],
      depthViewProj: (this.drawn[i] ? this.drawnVP[i] : cam.viewProj) as unknown as number[],
      pos: P.position,
      power: P.power,
      tint: P.tint,
      occlude: P.occlude && this.drawn[i] ? 1 : 0,
      axis: [ax / al, ay / al, az / al],
      haze: P.haze,
      map, mapB, mapU, mapV,
      paint: [P.program, P.nextProgram, P.blend, P.seed],
      clock: [P.clock ?? this.time, paintNow ? 1 : 0, P.body ? 1 : 0, 0],
    } as never);
  }
}

/** the drone body's vertex count (drones.wgsl BODY_VERTS) and its lights (LIGHTS) */
const DRONE_VERTS = 12 * 8 * 6 + 4 * 36;
const LIGHTS_PER_DRONE = 4;
