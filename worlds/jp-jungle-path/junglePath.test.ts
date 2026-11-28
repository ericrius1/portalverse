import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import type { WorldContext } from '@portalverse/core/types';
import { bankHeight, hedgeCollider, pathCenter, pathWidth } from './layout';

describe('Jungle Path traversal', () => {
  it('keeps both portal thresholds and their landings straight and level', () => {
    for (const z of [-38, -36.25, -35.75, 35.75, 36.25, 38]) {
      expect(pathCenter(z)).toBeCloseTo(0, 8);
      for (const x of [-1.5, 0, 1.5]) expect(bankHeight(x, z)).toBe(0);
    }
  });
  it('walks the complete winding path in both directions without being pushed', () => {
    for (const direction of [-1, 1]) {
      let from: [number, number, number] = [0, 0, -36.25 * direction];
      for (let i = 1; i <= 725; i++) {
        const z = (-36.25 + i * 0.1) * direction;
        const to: [number, number, number] = [pathCenter(z), 0, z];
        expect(hedgeCollider.move(from, to, 0.35, 1.8)).toEqual([to[0], z]);
        expect(bankHeight(to[0], z)).toBe(0);
        from = to;
      }
    }
  });
  it('contains sprint steps into either hedge, slides along curves, and preserves portal crossing', () => {
    for (let z = -38; z <= 38; z += 0.5) {
      for (const side of [-1, 1]) {
        const from: [number, number, number] = [pathCenter(z) + side * (pathWidth(z) - 0.4), 0, z];
        const [x, nextZ] = hedgeCollider.move(from, [from[0] + side * 1.4, 0, z - 0.4], 0.35, 1.8);
        expect(Math.abs(x - pathCenter(nextZ))).toBeLessThanOrEqual(pathWidth(nextZ) - 0.35 + 1e-5);
        expect(Number.isFinite(nextZ)).toBe(true);
      }
    }
    expect(hedgeCollider.move([0, 0, -36], [0, 0, -37], 0.35, 1.8)).toEqual([0, -37]);
  });
});

it('mounts isolated previews, yields during foliage setup, and releases every GPU resource', async () => {
  const { default: room } = await import('./index');
  const mount = async () => {
    const scene = new THREE.Scene();
    const cleanups: Array<() => void> = [];
    let yields = 0;
    const ctx = {
      mode: 'preview', player: null, scene, renderer: {}, gpu: null,
      breathe: async () => { yields++; },
      onUpdate: () => {}, onDispose: (fn: () => void) => cleanups.push(fn),
      setTerrainHeight: () => {}, setCollider: () => {}, setWalkBounds: () => {},
    } as unknown as WorldContext;
    await room.mount(ctx);
    return { scene, cleanups, yields };
  };
  const a = await mount();
  const b = await mount();
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.InstancedMesh>();
  let sprays = 0;
  a.scene.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    resources.add(o.geometry);
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) resources.add(mat);
    if (o instanceof THREE.InstancedMesh) {
      resources.add(o);
      if (o.name.startsWith('Leaf sprays')) sprays += o.count;
      expect(o.boundingSphere).not.toBeNull();
    }
  });
  expect(sprays * 7).toBeGreaterThan(100_000);
  expect(a.yields).toBeGreaterThan(600);
  const released = new Set<unknown>();
  resources.forEach(r => {
    const release = () => { released.add(r); };
    if (r instanceof THREE.InstancedMesh) r.addEventListener('dispose', release);
    else if (r instanceof THREE.Material) r.addEventListener('dispose', release);
    else r.addEventListener('dispose', release);
  });
  a.cleanups.forEach(fn => fn());
  expect(released.size).toBe(resources.size);
  expect(a.scene.children).toHaveLength(0);
  expect(a.scene.fog).toBeNull();
  expect(b.scene.children.length).toBeGreaterThan(0);
  expect(b.scene.fog).toBeInstanceOf(THREE.Fog);
  b.cleanups.forEach(fn => fn());
});
