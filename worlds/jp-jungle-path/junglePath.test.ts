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
      onActivate: () => {}, onUpdate: () => {}, onDispose: (fn: () => void) => cleanups.push(fn),
      setTerrainHeight: () => {}, setCollider: () => {}, setWalkBounds: () => {},
    } as unknown as WorldContext;
    await room.mount(ctx);
    return { scene, cleanups, yields };
  };
  const a = await mount();
  const b = await mount();
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.InstancedMesh>();
  let leaves = 0;
  a.scene.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    resources.add(o.geometry);
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) resources.add(mat);
    if (o instanceof THREE.InstancedMesh) {
      resources.add(o);
      if (o.name.startsWith('Foliage skin')) leaves += o.count;
      expect(o.boundingSphere).not.toBeNull();
    }
  });
  expect(leaves).toBeGreaterThan(10_000);
  expect(a.yields).toBeGreaterThan(500);
  // Every screen has real apertures; overlapping screens close the view collectively.
  const skins: THREE.InstancedMesh[] = [];
  a.scene.traverse(o => {
    if (o instanceof THREE.InstancedMesh && o.name.startsWith('Foliage skin') && o.userData.side === 1) skins.push(o);
  });
  expect(skins).toHaveLength(7);
  a.scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let frontHits = 0;
  let stackHits = 0;
  for (let i = 0; i < 160; i++) {
    const z = -27 + (i % 40) * 1.31;
    const y = 0.75 + Math.floor(i / 40) * 0.57;
    ray.set(new THREE.Vector3(pathCenter(z), y, z), new THREE.Vector3(1, 0, 0));
    const hits = ray.intersectObjects(skins, false);
    if (hits.some(h => h.object.userData.layer === 0)) frontHits++;
    if (hits.length) stackHits++;
  }
  expect(frontHits).toBeLessThan(160 * 0.8);
  expect(frontHits).toBeGreaterThan(160 * 0.25);
  expect(stackHits).toBeGreaterThanOrEqual(160 * 0.96);
  const near = new THREE.Matrix4();
  const far = new THREE.Matrix4();
  skins[0].getMatrixAt(0, near);
  skins[6].getMatrixAt(0, far);
  expect(Math.abs(far.elements[12] - near.elements[12])).toBeGreaterThan(15);
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

it('updates spacing immediately and coalesces density edits in a mounted preview', async () => {
  const { default: room } = await import('./index');
  const { updateJungleSettings, jungleDefaults } = await import('./tuning');
  const { vi } = await import('vitest');
  const cleanups: Array<() => void> = [];
  const scene = new THREE.Scene();
  const skins = () => {
    const found: THREE.InstancedMesh[] = [];
    scene.traverse(o => { if (o instanceof THREE.InstancedMesh && o.name.startsWith('Foliage skin')) found.push(o); });
    return found;
  };
  const count = () => skins().reduce((n, mesh) => n + mesh.count, 0);
  try {
    await room.mount({
      mode: 'preview', player: null, scene, renderer: {}, gpu: null,
      breathe: async () => {}, onActivate: () => {}, onUpdate: () => {},
      onDispose: (fn: () => void) => cleanups.push(fn),
      setTerrainHeight: () => {}, setCollider: () => {}, setWalkBounds: () => {},
    } as unknown as WorldContext);
    const original = skins();
    const originalCount = count();
    let released = 0;
    original.forEach(mesh => mesh.geometry.addEventListener('dispose', () => { released++; }));
    updateJungleSettings({ pathDistance: 3.95 });
    expect(skins()[0]).toBe(original[0]);
    expect(skins()[0].position.x).toBeCloseTo(-3);
    updateJungleSettings({ densityNear: 2, densityFar: 2 });
    updateJungleSettings({ densityNear: 0.5, densityFar: 0.5 });
    await vi.waitFor(() => expect(skins()[0]).not.toBe(original[0]), { timeout: 3000 });
    expect(count()).toBeLessThan(originalCount * 0.6);
    expect(count()).toBeGreaterThan(originalCount * 0.4);
    expect(released).toBe(14);
    expect(skins()[0].position.x).toBeCloseTo(-3);
    updateJungleSettings(jungleDefaults);
    await vi.waitFor(() => expect(count()).toBe(originalCount), { timeout: 3000 });
    expect(skins()[0].position.x).toBeCloseTo(0);
    // A queued rebuild must not resurrect foliage after the room is disposed.
    updateJungleSettings({ heightFar: 20 });
    cleanups.forEach(fn => fn());
    cleanups.length = 0;
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(scene.children).toHaveLength(0);
  } finally {
    cleanups.forEach(fn => fn());
    updateJungleSettings(jungleDefaults);
  }
});
