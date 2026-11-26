import { Camera, Ref, mat4Mul, type Kit, type RunEntry, type StorageBuffer, type UniformBuffer, type View } from '@ericrius1/weft';
import { WeftLayer } from '@portalverse/core/rooms/weft';
import { breathe } from '@portalverse/core/rooms/kit';
import type { GpuContext, GpuLayerView } from '@portalverse/core/types';
import palaceShader from './shaders/palace.wgsl';
import groundShader from './shaders/ground.wgsl';
import grassShader from './shaders/grass.wgsl';
import waterShader from './shaders/water.wgsl';
import { LAGOON, PALACE, SUN_COLOR, SUN_DIR, WATER_Y } from './layout';
import type { PalaceMeshData } from './palaceMesh.worker';

/**
 * The Palace Lagoon drawn with weft: one renderer per GPU device, made once and
 * shared by every mount of the room (the room you're in and its portal previews), so
 * the Palace's mesh is fetched, unpacked and uploaded once a session.
 *
 * Each view the engine asks for runs two passes: the reflection (the world mirrored in
 * the lagoon's surface, clipped to what's above it) and the scene (the Palace, the
 * land, the grass, the water reading the reflection, the sky). The sun's shadow of
 * the Palace is baked once when the mesh arrives: nothing in the room moves the sun.
 */

const SHADOW_SIZE = 2048;
const REVEAL_SECONDS = 1.6;
/** 1 MiB slices with a breath between them: the upload never holds a frame up. */
const UPLOAD_SLICE = 1 << 20;

class LagoonRenderer {
  readonly layer: WeftLayer;
  readonly ready: Promise<void>;
  private readonly kit: Kit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly globals: UniformBuffer<any>;
  private vb: StorageBuffer | null = null;
  private ib: StorageBuffer | null = null;
  private count = 0;
  private revealStart = -1;
  private readonly reflCam = new Camera();
  private readonly reflView: View;
  private readonly mirror = new Float32Array(16);
  private readonly reflMatrix = new Float32Array(16);

  constructor(gpu: GpuContext) {
    this.layer = new WeftLayer(gpu, { near: 0.1, frame: view => this.frame(view) });
    const kit = (this.kit = this.layer.kit);
    const g = (this.globals = kit.uniforms(palaceShader.structs.Globals, 'lagoon.globals'));
    g.set({
      sunDir: SUN_DIR,
      sunColor: SUN_COLOR,
      waterY: WATER_Y,
      skyZenith: [0.1, 0.27, 0.74],
      skyHorizon: [0.92, 0.66, 0.44],
      haze: 0.0011,
      ambSky: [0.24, 0.32, 0.5],
      ambGround: [0.16, 0.15, 0.08],
      lagoon: [LAGOON.x, LAGOON.rx, LAGOON.rz, 0],
      reveal: 0,
    });

    // ---- the sun's shadow: an orthographic view from the sun over the Palace and the lagoon
    const shadowTex = kit.texture({ label: 'lagoon.shadow', format: 'depth32float', size: [SHADOW_SIZE, SHADOW_SIZE], usage: ['render', 'sample'] });
    const sunCam = new Camera();
    const centre = [-125, 0, -30];
    sunCam.ortho = { halfWidth: 185, halfHeight: 185 };
    sunCam.near = 1;
    sunCam.far = 1400;
    sunCam.lookAt([centre[0] + SUN_DIR[0] * 600, centre[1] + SUN_DIR[1] * 600, centre[2] + SUN_DIR[2] * 600], centre);
    const sunView = kit.view(sunCam, [SHADOW_SIZE, SHADOW_SIZE], 'lagoon.sun');
    sunView.update(true);
    g.set({ lightViewProj: sunCam.viewProj });

    // ---- the Palace's mesh, which arrives later: placeholders until then
    const dummy = kit.storage({ label: 'lagoon.palace.none', size: 28 * 3 });
    const dummyIdx = kit.storage({ label: 'lagoon.palace.noidx', size: 12, usage: ['index', 'copy-dst'] });
    const pv = new Ref(() => this.vb ?? dummy);
    const indices = { buffer: new Ref(() => this.ib ?? dummyIdx), format: 'uint32' as const };
    const palaceCount = () => this.count;
    const palaceOn = () => this.count > 0;

    const shadowPass = kit.pass({ label: 'lagoon.shadow', view: sunView, depth: { target: shadowTex, clear: 0 } });
    shadowPass.draw(palaceShader, { label: 'lagoon.palace.shadow', vertex: 'vsShadow', fragment: null, indices, bind: { pv }, count: palaceCount, cull: 'none', enabled: palaceOn });

    const world = { G: g, shadowMap: shadowTex };

    // ---- the reflection: the world mirrored in the water, drawn from below it
    this.reflView = this.layer.addView(kit.view(this.reflCam, [1, 1], 'lagoon.reflection'));
    this.reflView.user[0] = 1;
    this.reflView.user[1] = WATER_Y;
    const reflColor = this.layer.target('reflection', 'rgba16float');
    const reflDepth = this.layer.target('reflection.depth', 'depth32float');
    const reflPass = kit.pass({
      label: 'lagoon.reflection',
      view: this.reflView,
      color: [{ target: reflColor, clear: [0, 0, 0, 0] }],
      depth: { target: reflDepth, clear: 0 },
      viewport: this.layer.viewport,
    });
    const scene = kit.pass({
      label: 'lagoon.scene',
      color: [{ target: this.layer.color, clear: [0, 0, 0, 1] }],
      depth: { target: this.layer.depth, clear: 0 },
      viewport: this.layer.viewport,
    });

    const groundCount = (384 - 1) * (384 - 1) * 6;
    for (const [pass, tag] of [[reflPass, 'refl'], [scene, 'main']] as const) {
      pass.draw(palaceShader, { label: `lagoon.palace.${tag}`, indices, bind: { ...world, pv }, count: palaceCount, cull: 'none', enabled: palaceOn });
      pass.draw(groundShader, { label: `lagoon.ground.${tag}`, vertex: 'vsGround', fragment: 'fsGround', bind: world, count: groundCount, cull: 'none' });
      if (pass === scene) {
        // two rings of grass: fine close by, sparser out to about 50 m
        pass.draw(grassShader, { label: 'lagoon.grass.near', bind: world, count: 7, instances: 320 * 320, topology: 'triangle-strip', cull: 'none', constants: { CELL: 0.12, SIDE: 320, HOLE: 0, WIDTH: 0.016, HEIGHT: 0.5, FADES: 0 } });
        pass.draw(grassShader, { label: 'lagoon.grass.far', bind: world, count: 7, instances: 256 * 256, topology: 'triangle-strip', cull: 'none', constants: { CELL: 0.34, SIDE: 256, HOLE: 320 * 0.12 * 0.5 - 0.2, WIDTH: 0.04, HEIGHT: 0.55, FADES: 1 } });
        pass.draw(waterShader, { label: 'lagoon.water', bind: { G: g, shadowMap: shadowTex, refl: reflColor }, count: 6, cull: 'none' });
      }
      pass.draw(groundShader, { label: `lagoon.sky.${tag}`, vertex: 'vsSky', fragment: 'fsSky', bind: { G: g }, count: 3, depthWrite: false, depthCompare: 'greater-equal' });
    }
    this.items = [reflPass, scene];

    this.ready = (async () => {
      // the room's pipelines compile off the main thread while the mesh comes in
      const [mesh] = await Promise.all([loadPalaceMesh(), kit.ready([reflPass, scene, shadowPass])]);
      if (mesh) {
        await this.upload(mesh);
        await kit.ready([shadowPass]);
        kit.run([shadowPass]);
      }
    })();
  }

  private readonly items: readonly RunEntry[];

  private async upload(mesh: PalaceMeshData): Promise<void> {
    const kit = this.kit;
    const vb = kit.storage({ label: 'lagoon.palace.verts', size: mesh.verts.byteLength, usage: ['storage', 'copy-dst'] });
    const ib = kit.storage({ label: 'lagoon.palace.idx', size: mesh.indices.byteLength, usage: ['index', 'copy-dst'] });
    for (const [buf, data] of [[vb, mesh.verts], [ib, mesh.indices]] as const) {
      for (let at = 0; at < data.byteLength; at += UPLOAD_SLICE) {
        buf.write(new Uint8Array(data, at, Math.min(UPLOAD_SLICE, data.byteLength - at)), at);
        await breathe();
      }
    }
    this.vb = vb;
    this.ib = ib;
    this.count = mesh.count;
  }

  /** One view: the mirror camera, this view's uniforms, the passes. */
  private frame(view: GpuLayerView): readonly RunEntry[] {
    // mirror the view in the water: view · reflect(y about the surface)
    const m = this.mirror;
    m.fill(0);
    m[0] = 1; m[5] = -1; m[10] = 1; m[15] = 1; m[13] = 2 * WATER_Y;
    mat4Mul(view.view, m, this.reflMatrix);
    this.reflCam.viewOverride = this.reflMatrix;

    if (this.count > 0 && this.revealStart < 0) this.revealStart = performance.now();
    const reveal = this.revealStart < 0 ? 0 : Math.min(1, (performance.now() - this.revealStart) / (REVEAL_SECONDS * 1000));
    this.globals.set({ time: view.time, vp: view.viewport as [number, number, number, number], reveal });
    return this.items;
  }
}

/** Earth's Palace mesh, fetched and packed off the main thread (null if it can't be had: the room goes on without it). */
function loadPalaceMesh(): Promise<PalaceMeshData | null> {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./palaceMesh.worker.ts', import.meta.url), { type: 'module' });
    const done = (mesh: PalaceMeshData | null) => { worker.terminate(); resolve(mesh); };
    worker.onmessage = (event: MessageEvent<{ mesh?: PalaceMeshData; error?: string }>) => {
      if (event.data.error) console.warn('[palace-lagoon] Palace mesh not loaded:', event.data.error);
      done(event.data.mesh ?? null);
    };
    worker.onerror = event => { console.warn('[palace-lagoon] mesh worker failed', event.message); done(null); };
    worker.postMessage({ url: PALACE.url });
  });
}

const renderers = new WeakMap<GPUDevice, LagoonRenderer>();

/** The room's renderer on this device, made on first use. */
export function lagoonRenderer(gpu: GpuContext): LagoonRenderer {
  let r = renderers.get(gpu.device);
  if (!r) {
    r = new LagoonRenderer(gpu);
    renderers.set(gpu.device, r);
    if (import.meta.env.DEV) (window as unknown as { lagoon: LagoonRenderer }).lagoon = r;
  }
  return r;
}
