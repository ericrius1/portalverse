import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { defineRoom } from '../portal/defineRoom';
import { PORTAL_CENTER_Y, ROUTE_LENGTH } from '../portal/roomLayout';
import { PortalPreviews } from '../engine/PortalPreviews';
import { RoomInstance } from '../engine/RoomInstance';

const emptyRoom = (id: string) => defineRoom(id, { mount: () => {} });

/** Three.js skips invisible subtrees and checks each object's layers against the camera. */
function visibleIn(scene: THREE.Object3D, camera: THREE.Camera) {
  const lights: number[] = [];
  const openings: THREE.Object3D[] = [];
  scene.traverseVisible(o => {
    if (!o.layers.test(camera.layers)) return;
    if ((o as THREE.Light).isLight) lights.push(o.id);
    if (o.userData.portalId) openings.push(o);
  });
  return { lights: lights.sort((a, b) => a - b), openings };
}

/** Draw eric-world's neighbours the ways the engine does, recording what each room render saw. */
async function renderPreviews() {
  let target: THREE.RenderTarget | null = null;
  const seen: Array<{ scene: THREE.Scene; camera: THREE.Camera } & ReturnType<typeof visibleIn>> = [];
  const renderer = {
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1600, 900),
    getRenderTarget: () => target,
    setRenderTarget: (next: THREE.RenderTarget | null) => { target = next; },
    compileAsync: async () => {},
    render: (scene: THREE.Scene, camera: THREE.Camera) => {
      seen.push({ scene, camera, ...visibleIn(scene, camera) });
    },
  } as unknown as THREE.WebGPURenderer;
  const previews = new PortalPreviews(renderer, id => Promise.resolve(emptyRoom(id)));
  const home = await RoomInstance.mount(emptyRoom('eric-world'), renderer);
  for (const handle of home.portals) handle.group.updateMatrixWorld(true);
  await previews.syncPinnedForRoom(home);
  return { renderer, previews, home, seen };
}

function expectPreviewVisibility(seen: Awaited<ReturnType<typeof renderPreviews>>['seen']) {
  expect(seen.length).toBeGreaterThan(0);
  for (const render of seen) {
    // Rendering leaves the room untouched afterwards, so this is what it shows when active.
    const active = visibleIn(render.scene, render.camera);
    expect(active.lights.length).toBeGreaterThan(0);
    expect(render.lights).toEqual(active.lights);
    expect(render.openings.length).toBeLessThan(active.openings.length);
  }
}

describe('room lighting stays the same between preview and active', () => {
  // Three.js builds a room's shaders for its set of lights. A different set when the
  // player arrives rebuilds every one of them on the crossing frame.
  it('in live portal windows, while still hiding the portal you arrive through', async () => {
    const { previews, home, seen } = await renderPreviews();
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 450);
    camera.position.set(0, PORTAL_CENTER_Y, -ROUTE_LENGTH / 2 + 6);
    camera.lookAt(0, PORTAL_CENTER_Y, -ROUTE_LENGTH);
    previews.render(home.portals, camera, 1 / 60, 1);
    expectPreviewVisibility(seen);
  });

  it('in the snapshots taken while loading', async () => {
    const { previews, home, seen } = await renderPreviews();
    await previews.prepare(home.portals.find(handle => handle.portal.id === 'exit')!.portal.targetWorldId);
    await previews.refreshSnapshots(home);
    expectPreviewVisibility(seen);
  });
});
