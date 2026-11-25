import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import catalog from '../../../../registry.json';
import type { PortalDefinition, PortalHandoffPayload, PortalVisualHandle, RegistryFile, WorldContext, WorldModule } from '../types';
import { ROUTE_LENGTH, routeGates, threshold } from '../portal/roomLayout';
import { defineRoom } from '../portal/defineRoom';
import { createReturnPortalFromHandoff, placeHandoffArrival } from '../portal/handoff';
import { createArchwayPortal } from '../engine/PortalMesh';
import { RoomInstance } from '../engine/RoomInstance';
import { PortalPreviews, portalPixels } from '../engine/PortalPreviews';
import {
  carryThroughPortal,
  crossingYawDelta,
  detectFeetCrossing,
  resolveTransit,
  viewerSide,
} from '../engine/portalCrossing';

const rooms = (catalog as unknown as RegistryFile).worlds.filter(room => room.kind === 'local');
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function gate(roomId: string, end: 'entrance' | 'exit'): PortalVisualHandle {
  const definition = routeGates(roomId, rooms).find(g => g.id === end)!;
  const handle = createArchwayPortal(definition, { passage: true, routeGate: true });
  handle.group.updateMatrixWorld(true);
  return handle;
}

function sidePortal(overrides: Partial<PortalDefinition> = {}): PortalVisualHandle {
  const handle = createArchwayPortal(
    { id: 'side', label: 'Side', position: [10, 0, 5], yaw: Math.PI / 2, targetWorldId: 'fishpond', ...overrides },
    { passage: true },
  );
  handle.group.updateMatrixWorld(true);
  return handle;
}

/** Stand-in renderer that records each render's target and viewport instead of drawing. */
function fakeRenderer(width = 2560, height = 1440) {
  const size = new THREE.Vector2(width, height);
  let current: THREE.RenderTarget | null = null;
  const renders: Array<{ target: THREE.RenderTarget | null; viewport: THREE.Vector4 | null }> = [];
  const renderer = {
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getDrawingBufferSize: (out: THREE.Vector2) => out.copy(size),
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.RenderTarget | null) => { current = target; },
    render: () => { renders.push({ target: current, viewport: current ? current.viewport.clone() : null }); },
  } as unknown as THREE.WebGPURenderer;
  return { renderer, renders, size };
}

const emptyRoom = (id: string): WorldModule => defineRoom(id, { mount: () => {} });
const loadEmptyRoom = (id: string) => Promise.resolve(emptyRoom(id));

describe('stepping through a portal', () => {
  it('starts a transit when the feet pass through the front of a route gate', () => {
    const exit = gate('eric-world', 'exit');
    expect(detectFeetCrossing(exit, v(0.4, 0, -36.0), v(0.4, 0, -36.5))).toBe(1);
    const entrance = gate('eric-world', 'entrance');
    expect(detectFeetCrossing(entrance, v(-0.4, 0, 36.0), v(-0.4, 0, 36.5))).toBe(1);
  });

  it('ignores walking in through the back of a one-way route gate', () => {
    const exit = gate('eric-world', 'exit');
    expect(detectFeetCrossing(exit, v(0, 0, -36.5), v(0, 0, -36.0))).toBeNull();
    expect(viewerSide(exit, v(0, 3, -50))).toBe(1);
  });

  it('only counts feet that pass through the opening itself', () => {
    const exit = gate('eric-world', 'exit');
    expect(detectFeetCrossing(exit, v(3.2, 0, -36.0), v(3.2, 0, -36.5))).toBeNull();
    expect(detectFeetCrossing(exit, v(0, 6, -36.0), v(0, 6, -36.5))).toBeNull();
    expect(detectFeetCrossing(exit, v(0, 0, -30), v(0, 0, -35))).toBeNull();
  });

  it('lets two-way portals be entered from either face', () => {
    const portal = sidePortal();
    // Front faces +X for yaw π/2.
    expect(detectFeetCrossing(portal, v(10.3, 0, 5), v(9.7, 0, 5))).toBe(1);
    expect(detectFeetCrossing(portal, v(9.7, 0, 5), v(10.3, 0, 5))).toBe(-1);
    expect(viewerSide(portal, v(4, 2, 5))).toBe(-1);
  });
});

describe('promoting the destination room', () => {
  const exit = gate('eric-world', 'exit');
  const state = { walkingThrough: false, firstPerson: false };

  it('waits while the chase camera is still in the old room', () => {
    expect(resolveTransit(exit, 1, v(0, 0, -36.8), v(0, 3, -31.2), state)).toBe('wait');
  });

  it('promotes on the frame the camera reaches the threshold', () => {
    expect(resolveTransit(exit, 1, v(0, 0, -41.8), v(0, 3, -36.25), state)).toBe('promote');
  });

  it('promotes at once in first person, or when the camera lags far behind', () => {
    expect(resolveTransit(exit, 1, v(0, 0, -36.8), v(0, 3, -31.2), { ...state, firstPerson: true })).toBe('promote');
    expect(resolveTransit(exit, 1, v(0, 0, -46.0), v(0, 3, -30), state)).toBe('promote');
  });

  it('cancels when the player steps back out before the camera crosses', () => {
    expect(resolveTransit(exit, 1, v(0, 0, -35.5), v(0, 3, -30), state)).toBe('cancel');
    // A click-to-walk keeps going even if the walk briefly backs up.
    expect(resolveTransit(exit, 1, v(0, 0, -35.5), v(0, 3, -30), { ...state, walkingThrough: true })).toBe('wait');
  });
});

describe('arriving in the next room', () => {
  it('lands every route crossing just inside the receiving gate, moving the same way', () => {
    for (const room of rooms) {
      for (const definition of routeGates(room.id, rooms)) {
        const arrival = threshold(definition.targetSpawnId as 'entrance' | 'exit');
        const yawDelta = crossingYawDelta(definition.yaw ?? 0, 1, arrival.yaw);
        const origin = v(...definition.position);
        const landing = v(...arrival.position);

        // Feet 0.25 m past the source plane, travelling through it.
        const through = v(0, 0, -1).applyAxisAngle(v(0, 1, 0), definition.yaw ?? 0);
        const feet = origin.clone().add(v(0.4, 0, 0)).addScaledVector(through, 0.25);
        const landed = carryThroughPortal(feet.clone(), origin, yawDelta, landing);

        const receiving = gate(definition.targetWorldId, definition.targetSpawnId as 'entrance' | 'exit');
        const local = receiving.group.worldToLocal(landed.clone());
        expect(local.z).toBeCloseTo(0.25);
        expect(Math.abs(local.x)).toBeCloseTo(0.4);
        // The direction of travel becomes the arrival spawn's forward direction.
        const forward = through.clone().applyAxisAngle(v(0, 1, 0), yawDelta);
        expect(forward.x).toBeCloseTo(-Math.sin(arrival.yaw));
        expect(forward.z).toBeCloseTo(-Math.cos(arrival.yaw));
      }
    }
  });

  it('keeps the chase camera the same distance behind the player', () => {
    const origin = v(0, 0, -ROUTE_LENGTH / 2);
    const landing = v(...threshold('entrance').position);
    const feet = carryThroughPortal(v(0.4, 0, -36.5), origin, 0, landing);
    const camera = carryThroughPortal(v(0.4, 3.1, -30.9), origin, 0, landing);
    expect(camera.z - feet.z).toBeCloseTo(5.6);
    expect(camera.y - feet.y).toBeCloseTo(3.1);
  });

  it('returns to the same spot after crossing forward and straight back', () => {
    const exitOrigin = v(0, 0, -ROUTE_LENGTH / 2);
    const entranceOrigin = v(0, 0, ROUTE_LENGTH / 2);
    const start = v(0.7, 0, -36.4);
    const there = carryThroughPortal(start.clone(), exitOrigin, crossingYawDelta(0, 1, 0), entranceOrigin);
    const back = carryThroughPortal(there.clone(), entranceOrigin, crossingYawDelta(Math.PI, 1, Math.PI), exitOrigin);
    expect(back.distanceTo(start)).toBeCloseTo(0);
  });

  it('turns travellers through rotated side portals to face the arrival spawn', () => {
    const arrival = { position: [0, 0, 35.75] as [number, number, number], yaw: 0 };
    const origin = v(10, 0, 5);
    const landing = v(...arrival.position);
    for (const [side, past] of [[1, v(9, 0, 5)], [-1, v(11, 0, 5)]] as const) {
      const landed = carryThroughPortal(past.clone(), origin, crossingYawDelta(Math.PI / 2, side, arrival.yaw), landing);
      expect(landed.x).toBeCloseTo(0);
      expect(landed.z).toBeCloseTo(34.75);
    }
  });
});

describe('room lifecycle across crossings', () => {
  function trackedRoom() {
    const counts = { starts: 0, stops: 0 };
    let ctx!: WorldContext;
    const module = defineRoom('fishpond', {
      mount(context) {
        ctx = context;
        context.onActivate(() => {
          counts.starts++;
          return () => { counts.stops++; };
        });
      },
    });
    return { module, counts, ctx: () => ctx };
  }

  it('switches between active and preview, starting and stopping player-only behavior', async () => {
    const { module, counts, ctx } = trackedRoom();
    const { renderer } = fakeRenderer();
    const room = await RoomInstance.mount(module, renderer);
    const enter = vi.fn();
    const portal = room.portals[0].portal;

    expect(ctx().mode).toBe('preview');
    room.activate(enter);
    expect(ctx().mode).toBe('active');
    expect(counts).toEqual({ starts: 1, stops: 0 });
    ctx().enterPortal(portal);
    expect(enter).toHaveBeenCalledTimes(1);

    room.deactivate();
    expect(ctx().mode).toBe('preview');
    expect(counts).toEqual({ starts: 1, stops: 1 });
    ctx().enterPortal(portal);
    expect(enter).toHaveBeenCalledTimes(1);

    room.activate(enter);
    room.activate(enter);
    expect(counts).toEqual({ starts: 2, stops: 1 });
    room.dispose();
    expect(counts).toEqual({ starts: 2, stops: 2 });
  });

  it('puts a room you leave back into preview mode and reuses it when you return', async () => {
    const { module, counts, ctx } = trackedRoom();
    const { renderer } = fakeRenderer();
    const previews = new PortalPreviews(renderer, () => Promise.resolve(module));

    await previews.prepare('fishpond');
    const room = previews.takeReady('fishpond')!;
    room.activate(() => {});
    previews.retain('fishpond', room);
    expect(ctx().mode).toBe('preview');
    expect(counts).toEqual({ starts: 1, stops: 1 });

    expect(previews.takeReady('fishpond')).toBe(room);
    room.activate(() => {});
    expect(ctx().mode).toBe('active');
    expect(counts).toEqual({ starts: 2, stops: 1 });
    previews.clear();
  });

  it('releases snapshot materials when a room is dropped instead of kept', async () => {
    const { renderer } = fakeRenderer();
    const previews = new PortalPreviews(renderer, loadEmptyRoom);
    const active = await RoomInstance.mount(emptyRoom('eric-world'), renderer);
    await previews.prewarmSnapshots(['eric-world', 'jp-world'], active);

    const exit = active.portals.find(p => p.portal.id === 'exit')!;
    const snapshotMaterial = exit.aperture.material;
    const disposed = vi.fn();
    snapshotMaterial.addEventListener('dispose', disposed);

    previews.disposeRoom(active);
    expect(disposed).toHaveBeenCalledTimes(1);
    previews.clear();
  });
});

describe('live portal windows', () => {
  async function lookAtExit(width = 2560, height = 1440) {
    const fake = fakeRenderer(width, height);
    const previews = new PortalPreviews(fake.renderer, loadEmptyRoom);
    const active = await RoomInstance.mount(emptyRoom('eric-world'), fake.renderer);
    await previews.prepare('jp-world');
    const viewer = new THREE.PerspectiveCamera(62, width / height, 0.1, 450);
    viewer.coordinateSystem = THREE.WebGPUCoordinateSystem;
    const exit = active.portals.find(p => p.portal.id === 'exit')!;
    const frame = (z: number) => {
      fake.renders.length = 0;
      viewer.position.set(0, 3, z);
      viewer.lookAt(0, 2.85, -ROUTE_LENGTH / 2);
      viewer.updateProjectionMatrix();
      viewer.updateMatrixWorld();
      previews.render(active.portals, viewer, 1 / 60, 1);
      const live = fake.renders.find(r => r.target);
      const bounds = portalPixels(exit.aperture, viewer, fake.size, new THREE.Vector4());
      return { live: live!, bounds };
    };
    return { ...fake, previews, frame };
  }

  it('renders the opening at one texel per screen pixel', async () => {
    const { frame, previews } = await lookAtExit();
    const { live, bounds } = frame(-20);
    expect(live.target!.width).toBe(2560);
    expect(live.target!.height).toBe(1440);
    expect(bounds.z).toBeGreaterThan(0);
    expect(bounds.z).toBeLessThan(2560);
    expect(live.viewport!.toArray()).toEqual([0, 0, bounds.z, bounds.w]);
    previews.clear();
  });

  it('reuses the same target as the opening grows, without reallocating', async () => {
    const { frame, previews } = await lookAtExit();
    const far = frame(-10);
    const near = frame(-30);
    expect(near.live.target).toBe(far.live.target);
    expect(near.bounds.z).toBeGreaterThan(far.bounds.z);
    expect(near.live.viewport!.toArray()).toEqual([0, 0, near.bounds.z, near.bounds.w]);
    expect(near.live.target!.width).toBe(2560);
    previews.clear();
  });

  it('follows the drawing buffer when the window resizes', async () => {
    const { frame, size, previews } = await lookAtExit();
    const before = frame(-20).live.target;
    size.set(1280, 720);
    const after = frame(-20).live.target!;
    expect(after).toBe(before);
    expect([after.width, after.height]).toEqual([1280, 720]);
    previews.clear();
  });
});

describe('federated arrival', () => {
  const handoff: PortalHandoffPayload = {
    version: 1,
    playerName: 'Eric',
    playerColor: '#22d3ee',
    fromWorldId: 'eric-world',
    fromWorldName: "Eric's Room",
    returnUrl: 'https://eric.example.com/?world=eric-world',
    sentAt: 0,
  };

  it('puts the way home right behind the traveller, clear of the entrance gate', () => {
    const spawn = rooms[0].spawns.default;
    const { arrival, portal } = placeHandoffArrival(spawn);
    const definition = createReturnPortalFromHandoff(handoff, portal.position, portal.yaw)!;
    expect(definition.oneWay).toBe(true);
    expect(arrival.yaw).toBe(spawn.yaw);
    expect(definition.position[2]).toBeGreaterThan(arrival.position[2]);
    expect(definition.position[2]).toBeLessThan(ROUTE_LENGTH / 2 - 5);

    const home = createArchwayPortal(definition, { passage: true });
    home.group.updateMatrixWorld(true);
    // The traveller starts in front of it...
    expect(home.group.worldToLocal(v(...arrival.position)).z).toBeGreaterThan(0);
    // ...turning around and walking back goes home...
    const behind = v(arrival.position[0], 0, definition.position[2] + 0.2);
    expect(detectFeetCrossing(home, v(...arrival.position), behind)).toBe(1);
    // ...but coming down the room from the entrance walks harmlessly through its back.
    expect(detectFeetCrossing(home, behind, v(...arrival.position))).toBeNull();
  });
});
