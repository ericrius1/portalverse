import * as THREE from 'three/webgpu';
import {
  Fn,
  atan,
  clamp,
  cos,
  exp,
  float,
  length,
  screenUV,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { createSceneTarget } from './sceneTarget';

/**
 * Always-ready organic liquid-wave post-processing pass.
 *
 * Every frame renders into one persistent HalfFloat RenderTarget (matching
 * PortalPreviews' exact rgba16float / sampleCount=1 pipeline format so WebGPU
 * never recompiles scene pipelines or hitches when the wave fades in or out).
 * Wave phase flows continuously; intensity follows a smooth symmetric bell
 * curve driven by portal FOV and distance from the threshold, amplified by
 * movement speed.
 */
export class PortalRipplePass {
  private target: THREE.RenderTarget | null = null;
  private material: THREE.MeshBasicNodeMaterial | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadGeo = new THREE.PlaneGeometry(2, 2);
  private quad: THREE.Mesh | null = null;
  private readonly size = new THREE.Vector2();

  private readonly uPhase = uniform(0.0);
  private readonly uStrength = uniform(0.0);
  private readonly uAspect = uniform(1.0);
  private readonly uTime = uniform(0.0);

  private currentStrength = 0;
  private phase = 0;

  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  /** Pre-allocate the persistent RenderTarget and compile the WebGPU composite pipeline during startup. */
  warmUp(): void {
    const rt = this.ensureResources();
    const prevTarget = this.renderer.getRenderTarget();
    try {
      this.uStrength.value = 0;
      this.renderer.setRenderTarget(rt);
      this.renderer.clear();
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.setRenderTarget(prevTarget);
    }
  }

  /**
   * Advance the continuously flowing liquid wave phase and smoothly track the
   * target bell-curve intensity [0..1] with movement speed amplification [0..1].
   */
  update(dt: number, elapsed: number, targetStrength: number, moveNorm: number): void {
    // Constantly flowing wave phase; surges faster while moving through the portal
    this.phase += dt * (2.4 + 2.8 * moveNorm);
    const alpha = Math.min(1, dt * 14);
    this.currentStrength += (targetStrength - this.currentStrength) * alpha;
    if (this.currentStrength < 0.0005 && targetStrength === 0) {
      this.currentStrength = 0;
    }

    this.uPhase.value = this.phase;
    this.uStrength.value = this.currentStrength;
    this.uTime.value = elapsed;
  }

  private ensureResources(): THREE.RenderTarget {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    this.uAspect.value = w / h;

    if (!this.target) {
      this.target = createSceneTarget(w, h);

      const mat = new THREE.MeshBasicNodeMaterial();
      mat.depthTest = false;
      mat.depthWrite = false;

      const uPhase = this.uPhase;
      const uStr = this.uStrength;
      const uAsp = this.uAspect;
      const uT = this.uTime;
      const tex = this.target.texture;

      const rippleFn = Fn(() => {
        const uv = screenUV;
        const centered = uv.sub(0.5);
        const aspectPos = vec2(centered.x.mul(uAsp), centered.y);
        const dist = length(aspectPos);
        const angle = atan(aspectPos.y, aspectPos.x);

        // Organic fluid boundary modulation (asymmetric surface-tension lobes)
        const organic = sin(angle.mul(3.0).add(uT.mul(2.8)))
          .mul(0.065)
          .add(cos(angle.mul(5.0).sub(uT.mul(2.1))).mul(0.04))
          .add(sin(angle.mul(2.0).sub(uT.mul(1.7))).mul(0.045));

        // Continuously traveling outward organic liquid waves
        const wave1 = sin(dist.mul(13.0).sub(uPhase).add(organic.mul(10.0)));
        const wave2 = cos(dist.mul(8.5).sub(uPhase.mul(0.72)).sub(organic.mul(7.0))).mul(0.55);
        const radialWeight = smoothstep(float(0.0), float(0.18), dist).mul(exp(dist.negate().mul(0.65)));

        // Smooth taper to 0 at screen borders (no edge clamping artifacts)
        const edgeX = smoothstep(float(0.0), float(0.08), uv.x).mul(
          float(1.0).sub(smoothstep(float(0.92), float(1.0), uv.x)),
        );
        const edgeY = smoothstep(float(0.0), float(0.08), uv.y).mul(
          float(1.0).sub(smoothstep(float(0.92), float(1.0), uv.y)),
        );
        const edgeMask = edgeX.mul(edgeY);

        const dir = aspectPos.div(dist.add(0.0001));
        const amp = wave1.add(wave2).mul(radialWeight).mul(uStr).mul(0.022).mul(edgeMask);
        const offset = vec2(dir.x.div(uAsp), dir.y).mul(amp);

        // Whisper-subtle prismatic liquid lens dispersion scaled by intensity
        const chroma = offset.mul(0.22);
        const uvR = clamp(uv.add(offset).add(chroma), 0.001, 0.999);
        const uvG = clamp(uv.add(offset), 0.001, 0.999);
        const uvB = clamp(uv.add(offset).sub(chroma), 0.001, 0.999);

        const r = texture(tex, uvR).x;
        const g = texture(tex, uvG).y;
        const b = texture(tex, uvB).z;
        return vec3(r, g, b);
      });

      mat.colorNode = rippleFn();
      this.material = mat;
      this.quad = new THREE.Mesh(this.quadGeo, mat);
      this.scene.add(this.quad);
    } else if (this.target.width !== w || this.target.height !== h) {
      this.target.setSize(w, h);
    }

    return this.target;
  }

  /** Render the active frame into the persistent buffer and composite to screen. */
  render(renderScene: () => void): void {
    const rt = this.ensureResources();
    this.renderer.setRenderTarget(rt);
    try {
      renderScene();
    } finally {
      // Name the screen outright: a background precompile can leave another target set.
      this.renderer.setRenderTarget(null);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.currentStrength = 0;
    this.target?.dispose();
    this.target = null;
    this.material?.dispose();
    this.material = null;
    if (this.quad) {
      this.scene.remove(this.quad);
      this.quad = null;
    }
    this.quadGeo.dispose();
  }
}
