import * as THREE from 'three/webgpu';
import { abs, floor, fract, mix, positionWorld, texture, uniform, vec2 } from 'three/tsl';

// CollectivSea's Experience.jsx fog and global.css background share this colour.
export const WATER_COLOR = '#0fa2ab';
export const WATER_FOG_NEAR = -25;
export const WATER_FOG_FAR = 50;

/**
 * CollectivSea's six-second projected caustic clip, sampled into 64 frames.
 * Two adjacent frames blend on the GPU: no video decoder, autoplay requirement,
 * per-frame uploads, extra lights, or render passes in the five-room window.
 */
export function createWaterLight(atlas: THREE.Texture) {
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.flipY = false; // Atlas frames run left-to-right, then top-to-bottom.
  atlas.generateMipmaps = false; // Mipmaps would mix unrelated animation cells.
  atlas.minFilter = THREE.LinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  const clock = uniform(0);
  const frame = fract(clock.div(6)).mul(64);
  const first = floor(frame);
  const next = first.add(1).mod(64);

  const caustic = (scale = 1) => {
    // A slightly slanted world-space projection keeps corals, sand, and fish
    // in the same light field. Mirror tiling hides the clip's non-periodic edges.
    const projected = positionWorld.xz.add(positionWorld.y.mul(vec2(0.16, 0.08)))
      .mul(scale).div(vec2(32, 18));
    const tileUV = abs(fract(projected.mul(0.5)).mul(2).sub(1));
    const sample = (index: THREE.Node<'float'>) => {
      const cell = vec2(index.mod(8), floor(index.div(8)));
      // Half-texel inset prevents linear filtering from sampling the next cell.
      const within = tileUV.mul(vec2(255, 143)).add(0.5).div(vec2(256, 144));
      return texture(atlas, cell.add(within).div(8)).r;
    };
    return mix(sample(first), sample(next), fract(frame));
  };

  return { clock, caustic };
}

export type CausticField = ReturnType<typeof createWaterLight>['caustic'];
