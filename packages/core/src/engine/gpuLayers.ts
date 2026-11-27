import * as THREE from 'three/webgpu';
import { Fn, Discard, ivec2, positionGeometry, screenCoordinate, textureLoad, uniform, vec4 } from 'three/tsl';
import type { GpuLayer, GpuLayerDepth, GpuLayerView } from '../types';

/**
 * Rooms drawn by their own WebGPU code, composited into the engine's Three.js passes.
 *
 * Each layer gets a fullscreen backdrop mesh in the room's scene, drawn before
 * anything else. Whenever Three draws that scene (the main view, a portal window,
 * the far portal, a snapshot) the backdrop's `onBeforeRender` hands the layer that
 * pass's camera and viewport. The layer draws and submits its own work, which the
 * GPU runs before the Three pass it was called from. Its depth is turned into
 * Three's depth (a small pass here), and the backdrop writes the layer's colour
 * with that depth, so portals and players hide behind its geometry and in front of
 * it like any other mesh.
 */

const RESOLVE_WGSL = /* wgsl */ `
struct P { proj: vec4f, mode: vec4f }
@group(0) @binding(0) var src: texture_depth_2d;
@group(0) @binding(1) var<uniform> p: P;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let d = textureLoad(src, vec2i(pos.xy), 0);
  let rev = p.mode.x > 0.5;
  if (p.mode.w > 0.5) { return vec4f(select(d, 1.0 - d, rev)); }
  let n = p.mode.y;
  let f = p.mode.z;
  if ((rev && d <= 0.0) || (!rev && d >= 1.0)) { return vec4f(1.0); }
  var dist: f32;
  if (rev) {
    dist = select(f * n / (n + d * (f - n)), n / d, f <= 0.0);
  } else {
    dist = select(f * n / (f - d * (f - n)), n / (1.0 - d), f <= 0.0);
  }
  // Three's projection: clip z = m[10] * z + m[14], w = -z, with the view z = -dist.
  return vec4f(clamp((p.proj.x * -dist + p.proj.y) / dist, 0.0, 1.0));
}`;

/** The engine's side of one shared device: the depth pass's pipeline and the placeholders. */
interface DeviceKit {
  pipeline: GPURenderPipeline;
  colorStub: GPUTexture;
  depthStub: GPUTexture;
}
const deviceKits = new WeakMap<GPUDevice, DeviceKit>();

function deviceKit(device: GPUDevice): DeviceKit {
  let kit = deviceKits.get(device);
  if (kit) return kit;
  const module = device.createShaderModule({ label: 'portalverse.layerDepth', code: RESOLVE_WGSL });
  const pipeline = device.createRenderPipeline({
    label: 'portalverse.layerDepth',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'r32float' }] },
    primitive: { topology: 'triangle-list' },
  });
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  kit = {
    pipeline,
    colorStub: device.createTexture({ label: 'portalverse.layerColorStub', size: [1, 1], format: 'rgba16float', usage }),
    depthStub: device.createTexture({ label: 'portalverse.layerDepthStub', size: [1, 1], format: 'r32float', usage }),
  };
  deviceKits.set(device, kit);
  return kit;
}

/** One Three.js texture per GPU texture, made once. */
const wrapped = new WeakMap<GPUTexture, THREE.ExternalTexture>();
function wrap(texture: GPUTexture, float32: boolean): THREE.ExternalTexture {
  let ext = wrapped.get(texture);
  if (!ext) {
    ext = new THREE.ExternalTexture(texture);
    if (float32) ext.type = THREE.FloatType;
    ext.image = { width: texture.width, height: texture.height } as never;
    ext.generateMipmaps = false;
    ext.minFilter = ext.magFilter = THREE.NearestFilter;
    wrapped.set(texture, ext);
  }
  return ext;
}

const INFINITE_FAR = 0;
const scratchViewport = new THREE.Vector4();
const scratchSize = new THREE.Vector2();
const scratchEye = new THREE.Vector3();

/** Where the pass Three is drawing goes: its target's size and the viewport in it. */
export function currentPassRect(renderer: THREE.WebGPURenderer): { width: number; height: number; viewport: [number, number, number, number] } {
  const target = renderer.getRenderTarget();
  if (target) {
    const v = target.viewport;
    return { width: target.width, height: target.height, viewport: [Math.floor(v.x), Math.floor(v.y), Math.floor(v.z), Math.floor(v.w)] };
  }
  renderer.getDrawingBufferSize(scratchSize);
  renderer.getViewport(scratchViewport).multiplyScalar(renderer.getPixelRatio()).floor();
  const v = scratchViewport;
  return { width: scratchSize.x, height: scratchSize.y, viewport: [v.x, v.y, v.z, v.w] };
}

/** Clamp a viewport to a texture, or null when nothing of it is left. */
function clampViewport(view: GpuLayerView, texture: GPUTexture): [number, number, number, number] | null {
  const [x, y, w, h] = view.viewport;
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(texture.width, x + w), y1 = Math.min(texture.height, y + h);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

export interface LayerClock {
  readonly time: number;
  readonly dt: number;
  readonly mode: 'active' | 'preview';
}

/** One layer's backdrop, depth pass and per-draw bookkeeping. */
export class GpuLayerCompositor {
  readonly mesh: THREE.Mesh;
  private readonly kit: DeviceKit;
  private readonly params: GPUBuffer;
  private readonly paramData = new Float32Array(8);
  private readonly material: THREE.MeshBasicNodeMaterial;
  private readonly colorNode: ReturnType<typeof textureLoad>;
  private readonly depthNode: ReturnType<typeof textureLoad>;
  private readonly enabled = uniform(0);
  private resolved: GPUTexture | null = null;
  private readonly groups = new WeakMap<GPUTexture, GPUBindGroup>();
  private readonly viewMatrix = new Float32Array(16);
  private readonly projMatrix = new Float32Array(16);
  private disposed = false;

  constructor(
    private readonly device: GPUDevice,
    private readonly layer: GpuLayer,
    private readonly clock: LayerClock,
    order: number,
  ) {
    this.kit = deviceKit(device);
    this.params = device.createBuffer({ label: 'portalverse.layerDepth.params', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const pixel = ivec2(screenCoordinate.xy);
    this.colorNode = textureLoad(wrap(this.kit.colorStub, false), pixel);
    this.depthNode = textureLoad(wrap(this.kit.depthStub, true), pixel);
    const material = new THREE.MeshBasicNodeMaterial();
    const enabled = this.enabled;
    const colorNode = this.colorNode;
    material.colorNode = Fn(() => {
      Discard(enabled.lessThan(0.5));
      return vec4(colorNode.rgb, 1);
    })();
    material.depthNode = this.depthNode.x;
    material.vertexNode = vec4(positionGeometry.xy, 0, 1);
    material.depthTest = true;
    material.depthWrite = true;
    material.depthFunc = THREE.LessEqualDepth;
    material.fog = false;
    material.side = THREE.DoubleSide;
    this.material = material;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1e6 + order;
    this.mesh.name = 'gpu-layer';
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.draw(renderer as unknown as THREE.WebGPURenderer, camera);
  }

  private draw(renderer: THREE.WebGPURenderer, camera: THREE.Camera): void {
    this.enabled.value = 0;
    if (this.disposed) return;
    const rect = currentPassRect(renderer);
    if (rect.viewport[2] <= 0 || rect.viewport[3] <= 0) return;
    camera.getWorldPosition(scratchEye);
    this.viewMatrix.set(camera.matrixWorldInverse.elements);
    this.projMatrix.set(camera.projectionMatrix.elements);
    const view: GpuLayerView = {
      width: rect.width,
      height: rect.height,
      viewport: rect.viewport,
      view: this.viewMatrix,
      projection: this.projMatrix,
      cameraPosition: [scratchEye.x, scratchEye.y, scratchEye.z],
      time: this.clock.time,
      dt: this.clock.dt,
      mode: this.clock.mode,
    };
    let result;
    try {
      result = this.layer.render(view);
    } catch (error) {
      console.warn('GPU layer failed to render', error);
      return;
    }
    if (!result) return;
    this.colorNode.value = wrap(result.color, false);
    const depth = result.depth ? this.resolveDepth(view, result.depth, result.depthMode ?? { reversed: false, near: 0.1 }) : null;
    this.depthNode.value = wrap(depth ?? this.kit.depthStub, true);
    this.enabled.value = 1;
  }

  /** Turn the layer's depth into Three's for this pass's projection (r32float, read by the backdrop). */
  private resolveDepth(view: GpuLayerView, source: GPUTexture, mode: GpuLayerDepth): GPUTexture | null {
    const rect = clampViewport(view, source);
    if (!rect) return null;
    if (!this.resolved || this.resolved.width !== source.width || this.resolved.height !== source.height) {
      this.resolved?.destroy();
      this.resolved = this.device.createTexture({
        label: 'portalverse.layerDepth',
        size: [source.width, source.height],
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const p = this.paramData;
    p[0] = view.projection[10];
    p[1] = view.projection[14];
    p[4] = mode.reversed ? 1 : 0;
    p[5] = mode.near;
    p[6] = mode.far && Number.isFinite(mode.far) ? mode.far : INFINITE_FAR;
    p[7] = mode.matchesProjection ? 1 : 0;
    this.device.queue.writeBuffer(this.params, 0, p);
    let group = this.groups.get(source);
    if (!group) {
      group = this.device.createBindGroup({
        label: 'portalverse.layerDepth',
        layout: this.kit.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView({ aspect: 'depth-only' }) },
          { binding: 1, resource: { buffer: this.params } },
        ],
      });
      this.groups.set(source, group);
    }
    const encoder = this.device.createCommandEncoder({ label: 'portalverse.layerDepth' });
    const pass = encoder.beginRenderPass({
      label: 'portalverse.layerDepth',
      colorAttachments: [{ view: this.resolved.createView(), loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(this.kit.pipeline);
    pass.setBindGroup(0, group);
    pass.setViewport(rect[0], rect[1], rect[2], rect[3], 0, 1);
    pass.setScissorRect(rect[0], rect[1], rect[2], rect[3]);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    return this.resolved;
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    // Leave the texture for a frame: a pass already encoded this frame may still read it.
    const resolved = this.resolved;
    this.resolved = null;
    if (resolved) setTimeout(() => resolved.destroy(), 500);
    this.params.destroy();
  }
}

/** The shared device under a Three.js renderer, once `init()` has run with WebGPU. */
export function rendererDevice(renderer: THREE.WebGPURenderer): GPUDevice | null {
  const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean; device?: GPUDevice } }).backend;
  return backend?.isWebGPUBackend && backend.device ? backend.device : null;
}
