import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { ChestEncounter, TREASURE_STRAY } from './encounter';
import { buildStrayStones, looseStoneSurface } from './path';
import { readPath } from './islands';
import preset from './secret-path.json';

it('keeps the hidden chest anchor on the far side and plays the supplied apparition once per landing', async () => {
  const placement = readPath(preset)!.encounter!;
  const host = buildStrayStones(seededRandom(8))[TREASURE_STRAY];
  const load = async (name: string) => {
    const bytes = await readFile(new URL(`./assets/${name}.glb`, import.meta.url));
    return new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  };
  const shadow = await load('shadow-man');
  const encounter = new ChestEncounter(host, placement, shadow);
  expect(encounter.chest.children).toEqual([encounter.shadow]);
  const final = preset.islands[preset.islands.length - 1];
  for (const t of [0, 4, 15]) {
    encounter.update(0.016, t, false);
    const p = encounter.chest.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(encounter.anchor.quaternion);
    expect(p.y - looseStoneSurface(host, p.x, p.z, t)).toBeCloseTo(placement.chest.y / normal.y);
    expect((p.x - host.cx) * (final.x - host.cx) + (p.z - host.cz) * (final.z - host.cz)).toBeLessThan(0);
    expect(encounter.shadow.visible).toBe(false);
  }
  encounter.update(0.5, 16, true);
  const mesh = shadow.scene.getObjectByProperty('isMesh', true) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  expect(encounter.shadow.visible).toBe(true);
  expect(mesh.morphTargetInfluences!.some((value, i) => i > 0 && value > 0)).toBe(true);
  const duration = shadow.animations[0].duration;
  expect(mesh.material.opacity).toBe(1);
  encounter.update(duration * 0.75 - 0.5, 18, true);
  expect(mesh.material.opacity).toBe(1);
  encounter.update(duration * 0.125, 19, true);
  expect(mesh.material.opacity).toBeCloseTo(0.5);
  expect(encounter.shadow.visible).toBe(true);
  encounter.update(duration * 0.125, 20, true);
  expect(mesh.material.opacity).toBe(0);
  expect(encounter.shadow.visible).toBe(false);
  encounter.update(0.016, 20.016, true);
  expect(encounter.shadow.visible).toBe(false);
  encounter.update(0.1, 21, false);
  encounter.update(0.1, 22, true);
  expect(encounter.shadow.visible).toBe(true);
  expect(mesh.material.opacity).toBe(1);
  encounter.dispose();
});
