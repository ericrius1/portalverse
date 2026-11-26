import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { PortalRipplePass } from '../engine/PortalRipplePass';
import { PERFORMANCE_PROFILES } from '../engine/performanceProfile';

interface Draw {
  scene: THREE.Object3D;
  target: THREE.RenderTarget | null;
  toneMapping: THREE.ToneMapping;
  outputColorSpace: string;
}

/** A renderer that records the output settings in force at each draw. */
function fakeRenderer() {
  let current: THREE.RenderTarget | null = null;
  const draws: Draw[] = [];
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
    outputColorSpace: THREE.SRGBColorSpace as string,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1600, 900),
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.RenderTarget | null) => { current = target; },
    clear: () => {},
    render(scene: THREE.Object3D) {
      draws.push({ scene, target: current, toneMapping: this.toneMapping, outputColorSpace: this.outputColorSpace });
    },
  };
  return { renderer, draws, pass: new PortalRipplePass(renderer as unknown as THREE.WebGPURenderer) };
}

// Three.js inserts its own full-screen output pass (through an extra buffer) whenever the
// renderer has tone mapping or a non-linear output space while drawing to the screen.
const neutral = { toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.LinearSRGBColorSpace };
const configured = { toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace };

describe('the ripple pass draws straight to the screen', () => {
  it('draws the composite with neutral renderer output, and the scene with the configured one', () => {
    const { renderer, draws, pass } = fakeRenderer();
    let duringScene: unknown;
    pass.render(() => {
      duringScene = { toneMapping: renderer.toneMapping, outputColorSpace: renderer.outputColorSpace };
    });
    expect(duringScene).toEqual(configured);
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({ target: null, ...neutral });
    expect(renderer).toMatchObject(configured);
    pass.dispose();
  });

  it('applies the tone mapping and colour space in its own shader', () => {
    const { draws, pass } = fakeRenderer();
    pass.render(() => {});
    const quad = draws[0].scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial>;
    expect(quad.material.colorNode).toMatchObject({
      isRenderOutputNode: true,
      _toneMapping: THREE.ACESFilmicToneMapping,
      outputColorSpace: THREE.SRGBColorSpace,
    });
    pass.dispose();
  });

  it('warms up the same screen pipeline that later frames use', () => {
    const { renderer, draws, pass } = fakeRenderer();
    pass.warmUp();
    expect(draws.at(-1)).toMatchObject({ target: null, ...neutral });
    expect(renderer).toMatchObject(configured);
    pass.dispose();
  });

  it('restores the renderer output settings when the composite throws', () => {
    const { renderer, pass } = fakeRenderer();
    renderer.render = () => { throw new Error('lost device'); };
    expect(() => pass.render(() => {})).toThrow('lost device');
    expect(renderer).toMatchObject(configured);
    pass.dispose();
  });

  it('asks for no multisampled canvas on profiles that only draw a full-screen quad to it', () => {
    for (const profile of Object.values(PERFORMANCE_PROFILES)) {
      if (profile.useRipplePass) expect(profile.antialias, profile.id).toBe(false);
    }
  });
});
