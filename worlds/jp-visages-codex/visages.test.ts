import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import * as kit from '@portalverse/core/rooms/kit';
import type { WorldContext } from '@portalverse/core/types';
import room from './index';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { collideHeads, HEAD_STATIONS, ROW_X } from './layout';

describe('the unending witnesses', () => {
  it('keeps a six-metre-wide corridor clear, including both portal thresholds', () => {
    for (const z of [...Array.from({ length: 321 }, (_, i) => i / 4 - 40), -36.25, 36.25]) {
      for (const x of [-3, 0, 3]) {
        expect(collideHeads([x, 0, z + 0.1], [x, 0, z], 0.4, 1.8)).toEqual([x, z]);
      }
    }
  });
  it('pushes players out of heads but permits flight above them', () => {
    for (const z of HEAD_STATIONS) {
      for (const side of [-1, 1]) {
        const x = side * ROW_X;
        const [outX, outZ] = collideHeads([0, 0, z], [x, 0, z], 0.4, 1.8);
        expect(Math.hypot((outX - x) / 15.3, (outZ - z) / 11.2)).toBeGreaterThanOrEqual(0.99999);
        expect(collideHeads([x, 31, z], [x, 31, z], 0.4, 1.8)).toEqual([x, z]);
      }
    }
  });
  it('extends both rows hundreds of metres beyond the gates', () => {
    expect(HEAD_STATIONS[0]).toBeLessThan(-300);
    expect(HEAD_STATIONS.at(-1)).toBeGreaterThan(300);
  });
  it.each(['head.glb', 'head-distant.glb'])('retains upright stone and original eye geometry in %s', async file => {
    const bytes = await readFile(new URL(`./assets/${file}`, import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const parts: THREE.Mesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) parts.push(object); });
    expect(parts).toHaveLength(2);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    expect(bounds.min.y).toBeCloseTo(0, 4);
    expect(bounds.max.y).toBeCloseTo(30, 0);
    const eyes = parts.find(m => (m.material as THREE.Material).name === 'Black eyes')!;
    expect(eyes).toBeDefined();
    const eyeBounds = new THREE.Box3().setFromObject(eyes);
    expect(eyeBounds.min.y).toBeGreaterThan(13);
    expect(eyeBounds.min.z).toBeGreaterThan(5);
    expect(eyeBounds.min.x + eyeBounds.max.x).toBeCloseTo(0, 0);
    for (const mesh of parts) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
  });
});


it('isolates and disposes active/preview resources independently', async () => {
  const loader = vi.spyOn(kit, 'loadGLB').mockImplementation(async url => {
    const name = url.includes('head-distant') ? 'head-distant.glb' : 'head.glb';
    const bytes = await readFile(new URL(`./assets/${name}`, import.meta.url));
    return new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '',
    );
  });
  const mounted: { scene: THREE.Scene; dispose: (() => void)[] }[] = [];
  try {
    for (const mode of ['active', 'preview'] as const) {
      const scene = new THREE.Scene();
      const dispose: (() => void)[] = [];
      mounted.push({ scene, dispose });
      await room.mount({
        mode, scene, player: null, breathe: async () => {},
        setTerrainHeight: vi.fn(), setCollider: vi.fn(), setWalkBounds: vi.fn(),
        onDispose: (fn: () => void) => dispose.push(fn),
      } as unknown as WorldContext);
    }
    const resources = mounted.map(({ scene }) => {
      const owned = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.InstancedMesh>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        owned.add(object.geometry);
        if (object instanceof THREE.InstancedMesh) owned.add(object);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          owned.add(material);
          const map = (material as THREE.MeshStandardMaterial).envMap;
          if (map) owned.add(map);
        }
      });
      return owned;
    });
    expect([...resources[0]].some(resource => resources[1].has(resource))).toBe(false);
    const disposeSpies = [...resources[0]].map(resource => vi.spyOn(resource, 'dispose'));
    mounted[0].dispose.forEach(fn => fn());
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledOnce();
    expect(mounted[0].scene.children).toHaveLength(0);
    expect(mounted[1].scene.children.length).toBeGreaterThan(0);
    mounted[0].dispose.length = 0;
  } finally {
    mounted.forEach(({ dispose }) => dispose.forEach(fn => fn()));
    loader.mockRestore();
  }
});
