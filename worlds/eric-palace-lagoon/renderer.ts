import { Camera, Ref, mat4Mul, type Kit, type RunEntry, type StorageBuffer, type UniformBuffer, type View } from '@ericrius1/weft';
import { WeftLayer } from '@portalverse/core/rooms/weft';
import { breathe } from '@portalverse/core/rooms/kit';
import { ProjectionRig } from '@portalverse/core/rooms/projection/rig';
import type { GpuContext, GpuLayerView } from '@portalverse/core/types';
import palaceShader from './shaders/palace.wgsl';
import groundShader from './shaders/ground.wgsl';
import grassShader from './shaders/grass.wgsl';
import waterShader from './shaders/water.wgsl';
import lanternShader from './shaders/lanterns.wgsl';
import { LAGOON, PALACE, WATER_Y, duskAt } from './layout';
import { skyGlobals, timeOfDay, type V3 } from './timeOfDay';
import { stageShow, SHOW_DRONES } from './show';
import { createPathway } from './path';
import { createGrove } from './trees';
import { createLife } from './life';
import type { FrameState, RoomEnv, RoomFeature } from './env';
import type { PalaceMeshData } from './palaceMesh.worker';

/**
 * The Palace Lagoon drawn with weft: one renderer per GPU device, made once and shared by every mount of the room (the
 * room you're in and its portal previews), so the Palace's mesh is fetched, unpacked and uploaded once a session.
 *
 * Each view the engine asks for gets its own time of day from where its eye is (sunset at the entrance, night at the
 * exit: layout.ts duskAt, timeOfDay.ts), then runs its passes: the reflection (the world mirrored in the lagoon's
 * surface, clipped to what's above it), the scene (the Palace, the land, the grass, the trees and the life, the
 * water reading the reflection, the sky, then the glows), and the projectors' beams in the haze. Once a frame, before
 * the first view: the drones' show is staged and the projection rig paints their images and redraws the depth maps
 * of the ones that moved; the trees' and the creatures' simulations step; and the key light's shadow of the Palace is
 * baked again when the key light has moved (the sun going down, the moon coming up).
 */

const SHADOW_SIZE = 2048;
const REVEAL_SECONDS = 1.6;
/** 1 MiB slices with a breath between them: the upload never holds a frame up. */
const UPLOAD_SLICE = 1 << 20;
/** the key light's shadow is baked again whenever it turns at all (smooth every-frame shadows while walking, zero cost while still) */
const SHADOW_REBAKE = 1e-5;
const PHASES = ['opaque', 'water', 'sky', 'glow'];
const ADD = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } as const;

class LagoonRenderer {
  readonly layer: WeftLayer;
  private readonly baseReady: Promise<void>;
  private meshPromise: Promise<boolean> | null = null;
  /** the player's feet while this room is the active one (index.ts sets it), for the time of day and the creatures */
  player: V3 | null = null;
  private readonly kit: Kit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly globals: UniformBuffer<any>;
  private vb: StorageBuffer | null = null;
  private ib: StorageBuffer | null = null;
  private count = 0;
  private revealStart = -1;
  private drewWithoutPalace = false;
  private readonly reflCam = new Camera();
  private readonly reflView: View;
  private readonly mirror = new Float32Array(16);
  private readonly reflMatrix = new Float32Array(16);
  private readonly sunCam = new Camera();
  private readonly sunView: View;
  private readonly shadowPass: RunEntry;
  private readonly bakedKey: V3 = [0, -1, 0];
  private bakeWanted = false;
  private readonly rig: ProjectionRig;
  private readonly features: RoomFeature[];
  private readonly items: readonly RunEntry[];
  private lastTime = Number.NaN;
  /** the most of the show any view saw this frame (none: the rig rests) */
  private showSeen = 1;
  /** the Palace's mesh has come in, or won't: the key light's shadow can be baked */
  private meshSettled = false;

  /** True once the Palace of Fine Arts geometry is uploaded on the GPU. */
  get hasPalace(): boolean {
    return this.count > 0;
  }

  constructor(gpu: GpuContext) {
    this.layer = new WeftLayer(gpu, { near: 0.1, frame: view => this.frame(view) });
    const kit = (this.kit = this.layer.kit);
    const g = (this.globals = kit.uniforms(palaceShader.structs.Globals, 'lagoon.globals'));
    g.set({
      waterY: WATER_Y,
      lagoon: [LAGOON.x, LAGOON.z, LAGOON.rx, LAGOON.rz],
      palace: [PALACE.at[0], PALACE.at[1], 0, 0],
      reveal: 0,
    });
    g.set(skyGlobals(timeOfDay(0)) as never);

    // ---- the key light's shadow: an orthographic view from it over the Palace, the grounds and the lagoon
    const shadowTex = kit.texture({ label: 'lagoon.shadow', format: 'depth32float', size: [SHADOW_SIZE, SHADOW_SIZE], usage: ['render', 'sample'] });
    this.sunCam.ortho = { halfWidth: 155, halfHeight: 155 };
    this.sunCam.near = 1;
    this.sunCam.far = 1600;
    this.sunView = kit.view(this.sunCam, [SHADOW_SIZE, SHADOW_SIZE], 'lagoon.sun');
    this.aimShadow(timeOfDay(0).keyDir);

    // ---- the Palace's mesh, which arrives later: placeholders until then
    const dummy = kit.storage({ label: 'lagoon.palace.none', size: 28 * 3 });
    const dummyIdx = kit.storage({ label: 'lagoon.palace.noidx', size: 12, usage: ['index', 'copy-dst'] });
    const pv = new Ref(() => this.vb ?? dummy);
    const indices = { buffer: new Ref(() => this.ib ?? dummyIdx), format: 'uint32' as const };
    const palaceCount = () => this.count;
    const palaceOn = () => this.count > 0;

    const shadowPass = kit.pass({ label: 'lagoon.shadow', view: this.sunView, depth: { target: shadowTex, clear: 0 } });
    shadowPass.draw(palaceShader, { label: 'lagoon.palace.shadow', vertex: 'vsShadow', fragment: null, indices, bind: { pv }, count: palaceCount, cull: 'none', enabled: palaceOn });
    this.shadowPass = shadowPass;

    // ---- the drones' projectors: their shadows are the Palace's
    const rig = (this.rig = new ProjectionRig(kit, { capacity: SHOW_DRONES, imageSize: 512, depthSize: 1024, depthPerFrame: 2, label: 'lagoon.show' }));
    rig.occluders(pass => {
      pass.draw(palaceShader, { label: 'lagoon.palace.projector', vertex: 'vsShadow', fragment: null, indices, bind: { pv }, count: palaceCount, cull: 'none', enabled: palaceOn });
    });
    const world = { G: g, shadowMap: shadowTex };
    const lit = { ...world, ...rig.bindings };

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
      phases: PHASES,
    });
    const scene = kit.pass({
      label: 'lagoon.scene',
      color: [{ target: this.layer.color, clear: [0, 0, 0, 1] }],
      depth: { target: this.layer.depth, clear: 0 },
      viewport: this.layer.viewport,
      phases: PHASES,
    });
    // (the beams: over the finished scene, reading its depth)
    const beams = kit.pass({ label: 'lagoon.beams', color: [{ target: this.layer.color, clear: false }], viewport: this.layer.viewport });

    const groundCount = (384 - 1) * (384 - 1) * 6;
    for (const [pass, tag] of [[reflPass, 'refl'], [scene, 'main']] as const) {
      pass.draw(palaceShader, { label: `lagoon.palace.${tag}`, indices, bind: { ...lit, pv }, count: palaceCount, cull: 'none', enabled: palaceOn, phase: 'opaque', depthLayer: 'base' });
      pass.draw(groundShader, { label: `lagoon.ground.${tag}`, vertex: 'vsGround', fragment: 'fsGround', bind: lit, count: groundCount, cull: 'none', phase: 'opaque', depthLayer: 'terrain' });
      pass.draw(lanternShader, { label: `lagoon.lanterns.${tag}`, bind: world, count: 396, instances: 18, cull: 'none', phase: 'opaque', depthLayer: 'detail' });
      if (pass === scene) {
        // two rings of grass: fine close by, sparser out to about 50 m
        pass.draw(grassShader, { label: 'lagoon.grass.near', bind: world, count: 7, instances: 320 * 320, topology: 'triangle-strip', cull: 'none', phase: 'opaque', constants: { CELL: 0.12, SIDE: 320, HOLE: 0, WIDTH: 0.016, HEIGHT: 0.5, FADES: 0 } });
        pass.draw(grassShader, { label: 'lagoon.grass.far', bind: world, count: 7, instances: 256 * 256, topology: 'triangle-strip', cull: 'none', phase: 'opaque', constants: { CELL: 0.34, SIDE: 256, HOLE: 320 * 0.12 * 0.5 - 0.2, WIDTH: 0.04, HEIGHT: 0.55, FADES: 1 } });
        pass.draw(waterShader, { label: 'lagoon.water', bind: { G: g, shadowMap: shadowTex, refl: reflColor }, count: 6, cull: 'none', phase: 'water' });
        rig.drones(pass, { phase: 'opaque' }, { phase: 'glow' });
        pass.draw(lanternShader, { label: 'lagoon.lanterns.halo', vertex: 'vsHalo', fragment: 'fsHalo', bind: world, count: 6, instances: 18, cull: 'none', depthWrite: false, blend: ADD, phase: 'glow' });
      }
      pass.draw(groundShader, { label: `lagoon.sky.${tag}`, vertex: 'vsSky', fragment: 'fsSky', bind: { G: g }, count: 3, depthWrite: false, depthCompare: 'greater-equal', phase: 'sky' });
    }
    rig.beams(beams, this.layer.depth);

    // ---- the room's other parts: the boardwalk & celestial sky-path, the trees, the creatures
    const env: RoomEnv = { kit, scene, refl: reflPass, shadow: shadowPass, world, projection: rig };
    const features = (this.features = [createPathway(env), createGrove(env), createLife(env)]);
    this.items = [reflPass, scene, beams];

    this.baseReady = Promise.all([
      kit.ready([reflPass, scene, beams, shadowPass, ...rig.depthPasses]),
      rig.ready,
      ...features.map(f => f.ready.catch(error => console.warn('[palace-lagoon] a part of the room failed to load', error))),
    ]).then(() => {
      // Rebake once trees & path meshes have finished uploading so their shadows appear immediately on frame 1.
      this.bakeWanted = true;
    });
    // Start fetching & unpacking the Palace mesh immediately in parallel with pipeline compilation.
    void this.ensurePalaceMesh();
  }

  /** Wait for every pipeline, room feature, and the Palace mesh (retrying if a prior fetch failed). */
  async ensureReady(): Promise<void> {
    await Promise.all([this.baseReady, this.ensurePalaceMesh()]);
  }

  private ensurePalaceMesh(): Promise<boolean> {
    if (this.count > 0) return Promise.resolve(true);
    if (this.meshPromise) return this.meshPromise;
    const pending = (async () => {
      const mesh = await loadPalaceMesh();
      if (mesh) {
        await this.upload(mesh);
        // (the projectors' depth maps drawn before the Palace was up saw nothing: draw them again)
        this.rig.invalidateDepth();
        this.meshSettled = true;
        this.bakeWanted = true;
        return true;
      }
      this.meshSettled = true;
      this.bakeWanted = true;
      return false;
    })();
    this.meshPromise = pending;
    void pending.then(ok => {
      // Never cache a failed load permanently: a subsequent teleport/visit retries cleanly.
      if (!ok && this.meshPromise === pending) this.meshPromise = null;
    });
    return pending;
  }

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

  /** point the key light's shadow camera along `key` (over the Palace and the lagoon) */
  private aimShadow(key: V3): void {
    const centre: V3 = [PALACE.at[0] + 10, 0, PALACE.at[1]];
    this.sunCam.lookAt([centre[0] + key[0] * 700, centre[1] + key[1] * 700, centre[2] + key[2] * 700], centre);
    this.sunView.update(true);
    this.globals.set({ lightViewProj: this.sunCam.viewProj });
    this.bakedKey[0] = key[0]; this.bakedKey[1] = key[1]; this.bakedKey[2] = key[2];
  }

  /** One view: its time of day, the mirror camera, its uniforms, and its passes (after the frame's own work). */
  private frame(view: GpuLayerView): readonly RunEntry[] {
    const active = view.mode === 'active';
    const eye = view.cameraPosition;
    const camPos: V3 = [eye[0], eye[1], eye[2]];
    // the time of day: from the player's feet in the room they're in (steadier than the trailing camera), else the eye
    const dusk = active && this.player ? duskAt(this.player[2], this.player[1]) : duskAt(camPos[2], camPos[1]);
    const tod = timeOfDay(dusk);

    // mirror the view in the water: view · reflect(y about the surface)
    const m = this.mirror;
    m.fill(0);
    m[0] = 1; m[5] = -1; m[10] = 1; m[15] = 1; m[13] = 2 * WATER_Y;
    mat4Mul(view.view, m, this.reflMatrix);
    this.reflCam.viewOverride = this.reflMatrix;

    if (this.count === 0) {
      this.drewWithoutPalace = true;
    } else if (this.revealStart < 0) {
      // If the Palace finished loading before any frame rendered (normal load/teleport), show it solid right away.
      this.revealStart = this.drewWithoutPalace ? performance.now() : 0;
    }
    const reveal = this.count === 0
      ? 0
      : this.revealStart === 0
        ? 1
        : Math.min(1, (performance.now() - this.revealStart) / (REVEAL_SECONDS * 1000));
    // (the show comes up as the dark does: the drones' light, their beams, their nav lights)
    const show = smooth01((dusk - 0.12) / 0.4);
    this.globals.set(skyGlobals(tod) as never);
    this.globals.set({ time: view.time, vp: view.viewport as [number, number, number, number], reveal, dusk, palace: [PALACE.at[0], PALACE.at[1], 0, show] });

    const firstView = view.time !== this.lastTime;
    this.lastTime = view.time;
    const state: FrameState = { time: view.time, dt: view.dt, camPos, dusk, tod, firstView, player: active ? this.player : null };

    // ---- once a frame, before any view's own settings: the show staged, the rig's work, the parts' simulations, the
    // key light's shadow baked again when it has moved. All of it follows the player's walk when this room is the one
    // they're in, whichever view comes first; else the first view's
    const work: RunEntry[] = [];
    if (firstView) {
      const frameDusk = this.player ? duskAt(this.player[2], this.player[1]) : dusk;
      const frameState: FrameState = frameDusk === dusk ? state : { ...state, dusk: frameDusk, tod: timeOfDay(frameDusk) };
      stageShow(this.rig, view.time);
      // (no view saw the show last frame: no images painted, no depth maps drawn)
      work.push(...this.rig.update(view.time, { paint: this.showSeen > 0 }));
      this.showSeen = 0;
      for (const f of this.features) if (f.items) work.push(...f.items(frameState));
      if (this.meshSettled) {
        const k = frameState.tod.keyDir, b = this.bakedKey;
        const kc = frameState.tod.keyColor;
        const keyLit = kc[0] + kc[1] + kc[2] > 1e-4;
        const turned = Math.acos(Math.min(1, Math.max(-1, k[0] * b[0] + k[1] * b[1] + k[2] * b[2])));
        if (this.bakeWanted || (keyLit && turned > SHADOW_REBAKE)) {
          this.aimShadow(k);
          work.push(this.shadowPass);
          this.bakeWanted = false;
        }
      }
    }
    this.showSeen = Math.max(this.showSeen, show);

    this.rig.setView({
      keyDir: tod.keyDir, keyColor: tod.keyColor, ambSky: tod.ambSky, ambGround: tod.ambGround,
      viewport: view.viewport, hazeDensity: 0.007 * show, lights: tod.night, time: view.time,
    });
    for (const f of this.features) f.frame?.(state);
    if (!firstView) return this.items;
    return [...work, ...this.items];
  }
}

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Earth's Palace mesh, fetched and packed off the main thread with automatic retries on transient errors. */
async function loadPalaceMesh(): Promise<PalaceMeshData | null> {
  const fetchOnce = () => new Promise<PalaceMeshData | null>(resolve => {
    const worker = new Worker(new URL('./palaceMesh.worker.ts', import.meta.url), { type: 'module' });
    const done = (mesh: PalaceMeshData | null) => { worker.terminate(); resolve(mesh); };
    worker.onmessage = (event: MessageEvent<{ mesh?: PalaceMeshData; error?: string }>) => {
      if (event.data.error) console.warn('[palace-lagoon] Palace mesh not loaded:', event.data.error);
      done(event.data.mesh ?? null);
    };
    worker.onerror = event => { console.warn('[palace-lagoon] mesh worker failed', event.message); done(null); };
    worker.postMessage({ url: PALACE.url });
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const mesh = await fetchOnce();
    if (mesh) return mesh;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
  }
  return null;
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
