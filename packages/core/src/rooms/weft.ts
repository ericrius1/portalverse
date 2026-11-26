import { Kit, Ref, type RunEntry, type Texture, type View } from '@ericrius1/weft';
import type { GpuContext, GpuLayer, GpuLayerResult, GpuLayerView } from '../types';

/**
 * Rooms drawn with weft (github.com/ericrius1/weft), on the device the engine shares.
 *
 * `weftKit(ctx.gpu)` is one weft Kit per device, shared by every weft room and mount.
 * `WeftLayer` is a GPU layer (`ctx.addGpuLayer`) that points weft's camera at each
 * view the engine asks for and runs the room's passes into its own colour and depth
 * targets. Bind `layer.color` and `layer.depth` as your passes' targets and give them
 * `viewport: layer.viewport`. weft's conventions hold inside: reversed-Z with an
 * infinite far plane, linear HDR colour (the engine tone-maps it).
 *
 * Only this module imports weft, so weft lands in the chunks of the rooms that use it
 * and costs Three.js rooms nothing.
 */

const kits = new WeakMap<GPUDevice, Kit>();

export function weftKit(gpu: GpuContext): Kit {
  let kit = kits.get(gpu.device);
  if (!kit) {
    // weft draws to a canvas of its own when asked for 'screen'. Layers draw to their
    // own targets, so this one is never shown.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    kit = new Kit(null as unknown as GPUAdapter, gpu.device, canvas, { debug: false, maxPixelRatio: 1, warmPipelines: 64 });
    kit.manual = true;
    kits.set(gpu.device, kit);
  }
  return kit;
}

/** A Three.js projection (WebGPU clip space) as weft's camera numbers: field of view, aspect and lens shift. */
export function projectionToLens(projection: ArrayLike<number>): { fovY: number; aspect: number; shift: [number, number] } {
  const p0 = projection[0], p5 = projection[5];
  return {
    fovY: 2 * Math.atan(1 / p5),
    aspect: p5 / p0,
    // Three's off-axis terms move NDC by -m[8], -m[9]; weft's shift moves it by +shift.
    shift: [-projection[8], -projection[9]],
  };
}

export interface WeftLayerOptions {
  /** weft's near plane for this room (m). */
  near?: number;
  /** Build the run list for one view, after the camera and the targets are set. */
  frame: (view: GpuLayerView, layer: WeftLayer) => readonly RunEntry[];
}

export class WeftLayer implements GpuLayer {
  readonly kit: Kit;
  /** Bind as a pass's colour target. */
  readonly color: Ref;
  /** Bind as a pass's depth target. */
  readonly depth: Ref;
  /** Pass to every pass's `viewport`. */
  readonly viewport = (): number[] => this.rect;
  private rect: number[] = [0, 0, 1, 1];
  private colorTex: Texture | null = null;
  private depthTex: Texture | null = null;
  private lastTime = Number.NaN;
  private readonly near: number;
  private readonly views: View[] = [];
  private readonly extra: Array<{ label: string; format: GPUTextureFormat; tex: Texture | null }> = [];

  constructor(gpu: GpuContext, private readonly options: WeftLayerOptions) {
    this.kit = weftKit(gpu);
    this.near = options.near ?? 0.1;
    this.color = new Ref(() => this.colorTex);
    this.depth = new Ref(() => this.depthTex);
    // (weft reads a target's format when it builds a pipeline, so the targets exist from the start)
    this.fit(1, 1);
  }

  /** Another target the size of the layer's own (a reflection, a G-buffer): bind the Ref it returns. */
  target(label: string, format: GPUTextureFormat): Ref {
    const size: [number, number] = [this.colorTex?.gpu.width ?? 1, this.colorTex?.gpu.height ?? 1];
    const slot = { label, format, tex: this.kit.texture({ label: `layer.${label}`, format, size, usage: ['render', 'sample'] }) as Texture | null };
    this.extra.push(slot);
    return new Ref(() => slot.tex);
  }

  /** A second viewpoint (a reflection, a probe) sized to each view the engine asks for. */
  addView(view: View): View {
    this.views.push(view);
    return view;
  }

  /** The textures, grown to fit a view of this size. */
  private fit(width: number, height: number): void {
    const t = this.colorTex;
    if (t && t.gpu.width >= width && t.gpu.height >= height) return;
    // (grown to the largest view asked for so far, so views of different sizes don't reallocate every frame)
    const w = Math.max(width, t?.gpu.width ?? 0), h = Math.max(height, t?.gpu.height ?? 0);
    const old = [this.colorTex, this.depthTex, ...this.extra.map(slot => slot.tex)].filter((x): x is Texture => !!x);
    this.colorTex = this.kit.texture({ label: 'layer.color', format: 'rgba16float', size: [w, h], usage: ['render', 'sample'] });
    this.depthTex = this.kit.texture({ label: 'layer.depth', format: 'depth32float', size: [w, h], usage: ['render', 'sample'] });
    for (const slot of this.extra) {
      slot.tex = this.kit.texture({ label: `layer.${slot.label}`, format: slot.format, size: [w, h], usage: ['render', 'sample'] });
    }
    // (a pass encoded earlier this frame may still read the old ones)
    if (old.length) setTimeout(() => this.kit.release(...old), 500);
  }

  render(view: GpuLayerView): GpuLayerResult | null {
    const kit = this.kit;
    this.fit(view.width, view.height);
    if (view.time !== this.lastTime) {
      // a new engine frame: close weft's last one (its profiler, its overlay) and open this one
      if (!Number.isNaN(this.lastTime)) kit.endFrame();
      this.lastTime = view.time;
      kit.beginFrame(view.dt);
    }
    kit.time = view.time;
    kit.dt = view.dt;
    const [x, y, w, h] = view.viewport;
    this.rect = [x, y, w, h];

    const cam = kit.camera;
    const lens = projectionToLens(view.projection);
    cam.viewOverride = view.view;
    cam.fovY = lens.fovY;
    cam.shift = lens.shift;
    cam.near = this.near;
    cam.far = Infinity;
    kit.mainView.size = [w, h];
    const items = this.options.frame(view, this);
    kit.mainView.update(true);
    for (const v of this.views) {
      v.size = [w, h];
      v.camera.fovY = lens.fovY;
      v.camera.shift = lens.shift;
      v.camera.near = this.near;
      v.update(true);
    }
    kit.run(items);
    return {
      color: this.colorTex!.gpu,
      depth: this.depthTex!.gpu,
      depthMode: { reversed: true, near: this.near },
    };
  }
}
