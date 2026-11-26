import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import catalog from '../../../../registry.json';
import type { RegistryFile, WorldModule } from '../types';
import { defineRoom } from '../portal/defineRoom';
import { PortalPreviews } from '../engine/PortalPreviews';
import { PortalRipplePass } from '../engine/PortalRipplePass';
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
  const targets: Array<THREE.RenderTarget | null> = [];
  const compileAsync = vi.fn(async (_scene: THREE.Object3D, _camera: THREE.Camera) => {});
  const renderer = {
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1600, 900),
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.RenderTarget | null) => { current = target; },
    render: (scene: THREE.Object3D) => { renders.push(scene); targets.push(current); },
    compileAsync,
  } as unknown as THREE.WebGPURenderer;
  return { renderer, renders, targets, compileAsync, target: () => current };
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

  // three.js yields during a precompile and, each time, leaves the renderer on the compile's target.
  it('puts the render target back after a precompile that yields', async () => {
    const fake = fakeRenderer();
    fake.compileAsync.mockImplementation(async () => {
      const compileTarget = fake.target();
      await flush();
      fake.renderer.setRenderTarget(compileTarget);
    });
    const previews = new PortalPreviews(fake.renderer, id => Promise.resolve(emptyRoom(id)), { idle: now });
    await previews.prepare('jp-world');
    expect(fake.target()).toBeNull();
    previews.clear();
  });

  it('draws the finished frame to the screen even while a precompile holds another target', () => {
    const fake = fakeRenderer();
    const pass = new PortalRipplePass(fake.renderer);
    const stray = new THREE.RenderTarget(1, 1);
    fake.renderer.setRenderTarget(stray);
    pass.render(() => {});
    expect(fake.targets.at(-1)).toBeNull();
    pass.dispose();
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

  it('wakes an idle preview immediately when the player selects that room', async () => {
    const fake = fakeRenderer();
    const slot = gate();
    const load = vi.fn(async (id: string) => emptyRoom(id));
    const previews = new PortalPreviews(fake.renderer, load, { idle: () => slot.closed });
    const background = previews.prepare('jp-world', false);
    await flush();
    expect(fake.compileAsync).not.toHaveBeenCalled();
    const trip = previews.travelTo('jp-world');
    expect(trip).toBe(background);
    await flush();
    expect(fake.compileAsync).toHaveBeenCalledTimes(1);
    expect(fake.renders).toHaveLength(2);
    slot.open();
    await trip;
    expect(load).toHaveBeenCalledTimes(1);
    await previews.clear();
  });

  it('gives the next compiler slot to the selected room', async () => {
    const fake = fakeRenderer();
    const first = gate();
    const order: string[] = [];
    fake.compileAsync.mockImplementation(async scene => {
      order.push(scene.name);
      if (order.length === 1) await first.closed;
    });
    const previews = new PortalPreviews(fake.renderer, async id =>
      defineRoom(id, { mount: ctx => { ctx.scene.name = id; } }), { idle: now });
    const running = previews.prepare('jp-world', false);
    const waiting = previews.prepare('eric-world', false);
    await flush();
    const selected = previews.travelTo('jp-loft');
    await flush();
    expect(order).toEqual(['jp-world']);
    first.open();
    await Promise.all([running, waiting, selected]);
    expect(order).toEqual(['jp-world', 'jp-loft', 'eric-world']);
    await previews.clear();
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

  it('uses a neighbour image that becomes available during compilation', async () => {
    const fake = fakeRenderer();
    const compiling = gate();
    const previews = new PortalPreviews(fake.renderer, async id => emptyRoom(id), { idle: now });
    const neighbour = await RoomInstance.mount(emptyRoom(at(0)), fake.renderer);
    fake.compileAsync.mockImplementation(() => compiling.closed);
    const ready = previews.prepare(at(1))!;
    await flush();
    await previews.refreshSnapshots(neighbour);
    let captured: THREE.Material | THREE.Material[] | undefined;
    fake.renderer.render = (scene, camera) => scene.traverseVisible(object => {
      if (object.userData.portalId === 'entrance' && object.layers.test(camera.layers)) {
        captured = (object as THREE.Mesh).material;
      }
    });
    compiling.open();
    const room = await ready;
    expect(captured).toBe(room.portals.find(p => p.portal.id === 'entrance')!.aperture.material);
    await previews.clear();
    neighbour.dispose();
  });

  it('disposes a room cleared mid-preparation and captures nothing after clear', async () => {
    const fake = fakeRenderer();
    const disposed = vi.fn();
    const module = defineRoom('jp-world', { mount: ctx => ctx.onDispose(disposed) });
    const compiling = gate();
    const disposedTarget = vi.fn();
    fake.compileAsync.mockImplementation(() => {
      fake.target()!.addEventListener('dispose', disposedTarget);
      return compiling.closed;
    });
    const previews = new PortalPreviews(fake.renderer, () => Promise.resolve(module), { idle: now });

    const neighbour = await RoomInstance.mount(emptyRoom('eric-world'), fake.renderer);
    await previews.refreshSnapshots(neighbour);
    const snapshot = fake.targets.find(target => target !== null)!;
    const disposedSnapshot = vi.fn();
    snapshot.addEventListener('dispose', disposedSnapshot);
    fake.renders.length = 0;
    const ready = previews.prepare('jp-world')!;
    await flush();
    const cleared = previews.clear();
    expect(disposedTarget).not.toHaveBeenCalled();
    expect(disposedSnapshot).not.toHaveBeenCalled();
    compiling.open();
    await cleared;
    expect(disposedTarget).toHaveBeenCalledTimes(1);
    expect(disposedSnapshot).toHaveBeenCalledTimes(1);
    await ready;
    await flush();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(fake.renders).toHaveLength(0);
    neighbour.dispose();
  });
});

/** Catalog ids in loop order; `at(0)` is the first room and negative steps wrap. */
const order = (catalog as unknown as RegistryFile).worlds.filter(w => w.kind === 'local').map(w => w.id);
const at = (step: number) => order[(step + order.length) % order.length];

/** Previews whose rooms record when they load and unload. */
function loop() {
  const loads: string[] = [];
  const disposed: string[] = [];
  const holds = new Map<string, Promise<void>>();
  const failures = new Set<string>();
  const fake = fakeRenderer();
  const previews = new PortalPreviews(fake.renderer, id => {
    loads.push(id);
    if (failures.delete(id)) return Promise.reject(new Error('offline'));
    const module = defineRoom(id, {
      mount: async ctx => {
        ctx.onDispose(() => disposed.push(id));
        await holds.get(id);
      },
    });
    return Promise.resolve(module);
  }, { idle: now });
  const home = (id: string) => RoomInstance.mount(emptyRoom(id), fake.renderer);
  const camera = new THREE.PerspectiveCamera();
  /** Step into a neighbouring room the way the engine does: keep the old one, take the new one. */
  const cross = (from: RoomInstance, id: string) => {
    const to = previews.takeReady(id)!;
    previews.retain(from.module.manifest.id, from);
    return { to, synced: previews.syncPinnedForRoom(to) };
  };
  const frame = async (elapsed: number) => {
    previews.render([], camera, 1 / 60, elapsed);
    await settle();
  };
  return { previews, loads, disposed, holds, failures, home, cross, frame };
}

async function settle() {
  for (let i = 0; i < 20; i++) await flush();
}

describe('the room window', () => {
  afterEach(() => vi.restoreAllMocks());

  it('finishes startup neighbours before an idle slot is available', async () => {
    const fake = fakeRenderer();
    const slot = gate();
    const loads: string[] = [];
    const previews = new PortalPreviews(fake.renderer, async id => {
      loads.push(id);
      return emptyRoom(id);
    }, { idle: () => slot.closed });
    const room = await RoomInstance.mount(emptyRoom(at(3)), fake.renderer);
    const ready = previews.syncPinnedForRoom(room, 1, true);
    await flush();
    expect(fake.renders).toHaveLength(4);
    expect(loads).toEqual([at(4), at(2)]);
    await ready;
    await previews.clear();
    slot.open();
    room.dispose();
  });

  it('loads neighbours at once and the outer rooms one at a time', async () => {
    const { previews, loads, holds, home } = loop();
    const outer = gate();
    holds.set(at(5), outer.closed);
    await previews.syncPinnedForRoom(await home(at(3)));
    expect(previews.takeReady(at(2))).toBeDefined();
    await settle();
    expect(loads).toEqual([at(4), at(2), at(5)]);
    outer.open();
    await settle();
    expect(loads).toEqual([at(4), at(2), at(5), at(1)]);
    previews.clear();
  });

  it('queues the side you are heading toward first', async () => {
    const { previews, loads, home } = loop();
    await previews.syncPinnedForRoom(await home(at(3)), -1);
    await settle();
    expect(loads.slice(2)).toEqual([at(1), at(5)]);
    previews.clear();
  });

  it('drops a room 4 s after it leaves the window', async () => {
    const { previews, disposed, home, cross, frame } = loop();
    const first = await home(at(3));
    await previews.syncPinnedForRoom(first);
    await settle();
    await frame(0);
    await cross(first, at(4)).synced;
    await frame(3);
    expect(disposed).toEqual([]);
    await frame(5);
    expect(disposed).toEqual([at(1)]);
    previews.clear();
  });

  it('keeps rooms when you step back within 4 s', async () => {
    const { previews, loads, disposed, home, cross, frame } = loop();
    const first = await home(at(3));
    await previews.syncPinnedForRoom(first);
    await settle();
    await frame(0);
    const { to: second, synced } = cross(first, at(4));
    await synced;
    await frame(1);
    await cross(second, at(3)).synced;
    await frame(10);
    expect(loads.filter(id => id === at(1))).toHaveLength(1);
    expect(disposed).not.toContain(at(1));
    previews.clear();
  });

  it('never mounts rooms left in the queue by a jump', async () => {
    const { previews, loads, holds, home } = loop();
    const slow = gate();
    holds.set(at(5), slow.closed);
    await previews.syncPinnedForRoom(await home(at(3)));
    await settle();
    const jumped = previews.syncPinnedForRoom(await home(at(8)));
    await jumped;
    slow.open();
    await settle();
    expect(loads).not.toContain(at(1));
    expect(loads.slice(3).sort()).toEqual([at(6), at(7), at(9), at(10)].sort());
    previews.clear();
  });

  it('carries on past a room that fails to load, and retries it later', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { previews, loads, failures, home } = loop();
    failures.add(at(5));
    const room = await home(at(3));
    await previews.syncPinnedForRoom(room);
    await settle();
    expect(loads).toContain(at(1));
    clock.mockReturnValue(7000);
    await previews.syncPinnedForRoom(room);
    await settle();
    expect(loads.filter(id => id === at(5))).toHaveLength(2);
    previews.clear();
  });

  it('knows which rooms belong to a window', () => {
    const { previews } = loop();
    expect(previews.keeps(at(3), at(1))).toBe(true);
    expect(previews.keeps(at(3), at(0))).toBe(false);
  });

  it('does not let a visible portal jump the queue', async () => {
    const { previews, loads, holds, home } = loop();
    const outer = gate();
    holds.set(at(5), outer.closed);
    const room = await home(at(3));
    await previews.syncPinnedForRoom(room);
    await settle();
    // Looking out through the previous room toward the queued room two steps back.
    const near = room.portals.find(p => p.portal.id === 'entrance')!;
    near.group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 450);
    camera.position.set(0, 3, 20);
    camera.lookAt(0, 3, 40);
    previews.render(room.portals, camera, 1 / 60, 1);
    await settle();
    expect(loads).not.toContain(at(1));
    outer.open();
    previews.clear();
  });

  it('starts the outer rooms only after both neighbours are ready', async () => {
    const { previews, loads, holds, home } = loop();
    const neighbour = gate();
    holds.set(at(2), neighbour.closed);
    const synced = previews.syncPinnedForRoom(await home(at(3)));
    await settle();
    expect(loads).toEqual([at(4), at(2)]);
    neighbour.open();
    await synced;
    await settle();
    expect(loads).toEqual([at(4), at(2), at(5), at(1)]);
    previews.clear();
  });

  it('holds the old queue while travelling somewhere else', async () => {
    const { previews, loads, holds, home } = loop();
    const stale = gate();
    const destination = gate();
    holds.set(at(5), stale.closed);
    holds.set(at(8), destination.closed);
    await previews.syncPinnedForRoom(await home(at(3)));
    await settle();
    const arriving = previews.travelTo(at(8))!;
    stale.open();
    await settle();
    expect(loads).not.toContain(at(1));
    // A destination that never gets installed must not leave the queue stuck.
    destination.open();
    await arriving;
    await settle();
    expect(loads).toContain(at(1));
    previews.clear();
  });
  it('prepares the new window while an obsolete neighbour is still downloading', async () => {
    const { previews, loads, holds, home } = loop();
    const old = gate();
    holds.set(at(2), old.closed);
    const oldWindow = previews.syncPinnedForRoom(await home(at(3)));
    await flush();
    await previews.syncPinnedForRoom(await home(at(8)));
    await settle();
    const started = [...loads];
    old.open();
    await oldWindow;
    await settle();
    previews.clear();
    expect(started).toEqual(expect.arrayContaining([at(10), at(6)]));
  });

  it('uses cached neighbour images in the new snapshots when a room remounts', async () => {
    const fake = fakeRenderer();
    const previews = new PortalPreviews(fake.renderer, id => Promise.resolve(emptyRoom(id)), { idle: now });
    await previews.prepare(at(0));
    await previews.prepare(at(2));
    await previews.prepare(at(1));
    previews.disposeRoom(previews.takeReady(at(1))!);
    const captured: Array<{ aperture: THREE.Mesh; material: unknown }> = [];
    fake.renderer.render = (scene, camera) => scene.traverseVisible(o => {
      if (o.userData.portalId && o.layers.test(camera.layers)) {
        const aperture = o as THREE.Mesh;
        captured.push({ aperture, material: aperture.material });
      }
    });
    await previews.prepare(at(1));
    expect(captured).toHaveLength(2);
    const results = captured.map(({ aperture, material }) => material === aperture.material);
    previews.clear();
    expect(results).toEqual([true, true]);
  });

  it('releases the pin on a superseded trip even when the replacement fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { previews, holds, failures, disposed, home, frame } = loop();
    await previews.syncPinnedForRoom(await home(at(3)));
    const slow = gate();
    holds.set(at(7), slow.closed);
    const abandoned = previews.travelTo(at(7));
    failures.add(at(8));
    await expect(previews.travelTo(at(8))).rejects.toThrow('offline');
    slow.open();
    await abandoned;
    await frame(5);
    expect(disposed).toContain(at(7));
    await previews.clear();
  });

  it('keeps a recovered adjacent room ready after the player looks away', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { previews, disposed, failures, home, frame } = loop();
    failures.add(at(4));
    const current = await home(at(3));
    await previews.syncPinnedForRoom(current);
    await settle();
    const exit = current.portals.find(p => p.portal.id === 'exit')!;
    exit.group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 450);
    camera.position.set(0, 3, -20);
    camera.lookAt(0, 3, -40);
    clock.mockReturnValue(7000);
    previews.render([exit], camera, 1 / 60, 7);
    await settle();
    await frame(12);
    const dropped = [...disposed];
    previews.clear();
    expect(dropped).not.toContain(at(4));
  });
});
