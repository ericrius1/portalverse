import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { WorldModule } from '../types';
import { defineRoom } from '../portal/defineRoom';
import { PortalPreviews } from '../engine/PortalPreviews';
import { RoomInstance } from '../engine/RoomInstance';

const emptyRoom = (id: string): WorldModule => defineRoom(id, { mount: () => {} });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const now = () => Promise.resolve();

function gate() {
  let open!: () => void;
  const closed = new Promise<void>(resolve => { open = resolve; });
  return { closed, open };
}

function fakeRenderer() {
  let current: THREE.RenderTarget | null = null;
  const renders: THREE.Object3D[] = [];
  const compileAsync = vi.fn(async (_scene: THREE.Object3D, _camera: THREE.Camera) => {});
  const renderer = {
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1600, 900),
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.RenderTarget | null) => { current = target; },
    render: (scene: THREE.Object3D) => { renders.push(scene); },
    compileAsync,
  } as unknown as THREE.WebGPURenderer;
  return { renderer, renders, compileAsync, target: () => current };
}

describe('preparing a room as it loads', () => {
  it('compiles a room against a scene target before it is ready', async () => {
    const fake = fakeRenderer();
    const screen = new THREE.RenderTarget(4, 4);
    fake.renderer.setRenderTarget(screen);
    const compiling = gate();
    let during: THREE.RenderTarget | null = null;
    fake.compileAsync.mockImplementation(() => {
      during = fake.target();
      return compiling.closed;
    });
    const previews = new PortalPreviews(fake.renderer, id => Promise.resolve(emptyRoom(id)), { idle: now });

    const ready = previews.prepare('jp-world')!;
    await flush();
    expect(fake.compileAsync).toHaveBeenCalledTimes(1);
    expect(previews.takeReady('jp-world')).toBeUndefined();
    expect(during!.texture.type).toBe(THREE.HalfFloatType);
    expect(during!.samples).toBe(0);
    expect(fake.target()).toBe(screen);

    compiling.open();
    const room = await ready;
    expect(fake.compileAsync.mock.calls[0][0]).toBe(room.scene);
    previews.clear();
  });

  it('compiles objects outside the camera view, then restores culling', async () => {
    const fake = fakeRenderer();
    const mesh = new THREE.Mesh();
    const module = defineRoom('jp-world', { mount: ctx => { ctx.scene.add(mesh); } });
    let during: boolean | undefined;
    fake.compileAsync.mockImplementation(async () => { during = mesh.frustumCulled; });
    const previews = new PortalPreviews(fake.renderer, () => Promise.resolve(module), { idle: now });

    await previews.prepare('jp-world');
    expect(during).toBe(false);
    expect(mesh.frustumCulled).toBe(true);
    previews.clear();
  });

  it('captures both snapshots on load and gives them to portals already mounted', async () => {
    const fake = fakeRenderer();
    const previews = new PortalPreviews(fake.renderer, id => Promise.resolve(emptyRoom(id)), { idle: now });
    const active = await RoomInstance.mount(emptyRoom('eric-world'), fake.renderer);
    await previews.refreshSnapshots(active);
    const exit = active.portals.find(p => p.portal.id === 'exit')!;
    const placeholder = exit.aperture.material;

    fake.renders.length = 0;
    const jp = (await previews.prepare('jp-world'))!;
    expect(fake.renders.filter(scene => scene === jp.scene)).toHaveLength(2);
    expect(exit.aperture.material).not.toBe(placeholder);
    previews.disposeRoom(active);
    previews.clear();
  });

  it('still delivers the room when compiling fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeRenderer();
    fake.compileAsync.mockRejectedValue(new Error('no pipeline'));
    const previews = new PortalPreviews(fake.renderer, id => Promise.resolve(emptyRoom(id)), { idle: now });
    const room = await previews.prepare('jp-world');
    expect(room).toBeInstanceOf(RoomInstance);
    expect(previews.takeReady('jp-world')).toBe(room);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('disposes a room cleared mid-preparation and captures nothing after clear', async () => {
    const fake = fakeRenderer();
    const disposed = vi.fn();
    const module = defineRoom('jp-world', { mount: ctx => ctx.onDispose(disposed) });
    const compiling = gate();
    fake.compileAsync.mockImplementation(() => compiling.closed);
    const previews = new PortalPreviews(fake.renderer, () => Promise.resolve(module), { idle: now });

    const ready = previews.prepare('jp-world')!;
    await flush();
    previews.clear();
    compiling.open();
    await ready;
    await flush();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(fake.renders).toHaveLength(0);
  });
});
