import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import catalog from '../../../../registry.json';
import type { PortalDefinition, PortalHandoffPayload, PortalVisualHandle, RegistryFile, WorldContext, WorldModule } from '../types';
import { PORTAL_CENTER_Y, PORTAL_RADIUS, ROUTE_LENGTH, routeGates, threshold } from '../portal/roomLayout';
import { defineRoom } from '../portal/defineRoom';
import { createReturnPortalFromHandoff, placeHandoffArrival } from '../portal/handoff';
import { createArchwayPortal } from '../engine/PortalMesh';
import { RoomInstance } from '../engine/RoomInstance';
import { PortalPreviews, framePortal, portalPixels } from '../engine/PortalPreviews';
import {
  beginCrossing,
  canOfferPortalPrompt,
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

interface RecordedRender {
  scene: THREE.Object3D;
  target: THREE.RenderTarget | null;
  viewport: THREE.Vector4 | null;
  /** The camera's full view-projection at render time. */
  viewProjection: THREE.Matrix4;
}

/** Stand-in renderer that records what each render would draw instead of drawing. */
function fakeRenderer(width = 2560, height = 1440) {
  const size = new THREE.Vector2(width, height);
  let current: THREE.RenderTarget | null = null;
  const renders: RecordedRender[] = [];
  const renderer = {
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getDrawingBufferSize: (out: THREE.Vector2) => out.copy(size),
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.RenderTarget | null) => { current = target; },
    compileAsync: async () => {},
    render: (scene: THREE.Object3D, camera: THREE.Camera) => {
      renders.push({
        scene,
        target: current,
        viewport: current ? current.viewport.clone() : null,
        viewProjection: camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse),
      });
    },
  } as unknown as THREE.WebGPURenderer;
  return { renderer, renders, size };
}

/** A live window's state, read from the previews' private bookkeeping. */
function windowFor(previews: PortalPreviews, aperture: THREE.Object3D) {
  const views = (previews as unknown as {
    views: Map<THREE.Object3D, { slot: { bounds: THREE.Vector4; material: THREE.Material; liveBlend: { value: number } } }>;
  }).views;
  return views.get(aperture)?.slot;
}

/** Where a world point lands on screen, given the camera of a render cropped to `bounds`. */
function screenPixel(point: THREE.Vector3, viewProjection: THREE.Matrix4, bounds: THREE.Vector4): THREE.Vector2 {
  const ndc = point.clone().applyMatrix4(viewProjection);
  return new THREE.Vector2(bounds.x + (ndc.x + 1) / 2 * bounds.z, bounds.y + (1 - ndc.y) / 2 * bounds.w);
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

  it('only counts feet that pass through the circular opening itself', () => {
    const exit = gate('eric-world', 'exit');
    expect(detectFeetCrossing(exit, v(3.2, 0, -36.0), v(3.2, 0, -36.5))).toBeNull();
    expect(detectFeetCrossing(exit, v(0, 6, -36.0), v(0, 6, -36.5))).toBeNull();
    expect(detectFeetCrossing(exit, v(0, 0, -30), v(0, 0, -35))).toBeNull();
    // Flying corner outside the circular ring (within the old bounding rectangle) is rejected.
    expect(detectFeetCrossing(exit, v(2.6, 4.4, -36.0), v(2.6, 4.4, -36.5))).toBeNull();
  });

  it('only offers the [E] prompt when on an allowed entry side and facing the portal', () => {
    const exit = gate('eric-world', 'exit');
    // Facing -Z toward exit from inside the room -> offered
    expect(canOfferPortalPrompt(exit, v(0, 0, -32), 0)).toBe(true);
    // Facing +Z away from exit -> not offered
    expect(canOfferPortalPrompt(exit, v(0, 0, -32), Math.PI)).toBe(false);
    // On the back side of a one-way gate, even facing it -> not offered
    expect(canOfferPortalPrompt(exit, v(0, 0, -40), Math.PI)).toBe(false);
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
    expect(ctx().player).toBeNull();
    const player = { position: v(1, 0, 2), camera: new THREE.PerspectiveCamera() };
    room.activate(enter, player);
    expect(ctx().mode).toBe('active');
    expect(ctx().player).toBe(player);
    expect(counts).toEqual({ starts: 1, stops: 0 });
    ctx().enterPortal(portal);
    expect(enter).toHaveBeenCalledTimes(1);

    room.deactivate();
    expect(ctx().mode).toBe('preview');
    expect(ctx().player).toBeNull();
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
    await previews.prepare('jp-world');
    await previews.refreshSnapshots(active);

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
    const jp = (await previews.prepare('jp-world'))!;
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
      const live = fake.renders.find(r => r.scene === jp.scene);
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

describe('backing through a portal', () => {
  // Eric's exit (z = -36.25) faces into his room. Backing toward it, the player faces +Z
  // and the 3rd-person camera trails 5.6 m behind their back, so it reaches the exit first.
  const CAMERA_BEHIND = 5.6;
  const CAMERA_HEIGHT = 3.5;
  const cameraFor = (feet: THREE.Vector3, facing: 1 | -1) =>
    v(feet.x, CAMERA_HEIGHT, feet.z - facing * CAMERA_BEHIND);

  /** Step the feet along z, calling `onFrame` with each frame's motion. */
  function walk(from: number, to: number, facing: 1 | -1, x: number,
    onFrame: (motion: { previousFeet: THREE.Vector3; feet: THREE.Vector3; previousCamera: THREE.Vector3; camera: THREE.Vector3 }) => boolean | void) {
    const step = 0.24 * Math.sign(to - from); // a sprint frame at 60 fps
    for (let z = from; Math.abs(z - to) > 1e-6 && (z - to) * Math.sign(from - to) > 0; z += step) {
      const previousFeet = v(x, 0, z);
      const feet = v(x, 0, z + step);
      if (onFrame({ previousFeet, feet, previousCamera: cameraFor(previousFeet, facing), camera: cameraFor(feet, facing) })) return;
    }
  }

  it('starts the crossing when the camera reaches the opening, not 5.6 m later at the feet', () => {
    const exit = gate('eric-world', 'exit');
    let started: { by: string; feetZ: number } | null = null;
    walk(-28, -40, 1, 0.4, motion => {
      const start = beginCrossing(exit, motion, false);
      if (!start) return;
      started = { by: start.by, feetZ: motion.feet.z };
      expect(resolveTransit(exit, start.side, motion.feet, motion.camera, { walkingThrough: false, firstPerson: false })).toBe('promote');
      return true;
    });
    expect(started).not.toBeNull();
    expect(started!.by).toBe('camera');
    expect(started!.feetZ).toBeCloseTo(-ROUTE_LENGTH / 2 + CAMERA_BEHIND, 0);
  });

  it('still lets the feet lead walking forward, or in first person, and ignores passing beside the ring', () => {
    const exit = gate('eric-world', 'exit');
    const firstStart = (x: number, facing: 1 | -1, firstPerson: boolean) => {
      let result: string | null = null;
      walk(-28, -40, facing, x, motion => {
        const start = beginCrossing(exit, motion, firstPerson);
        if (start) result = start.by;
        return !!start;
      });
      return result;
    };
    expect(firstStart(0.4, -1, false)).toBe('feet'); // facing the exit, camera behind in the room
    expect(firstStart(0.4, 1, true)).toBe('feet');
    expect(firstStart(4.5, 1, false)).toBeNull();
  });

  it('completes once the player backs fully in, or switches back if they walk away', () => {
    // After switching on the camera, the feet are still behind JP's entrance, the portal back.
    const back = gate('jp-world', 'entrance');
    const state = { walkingThrough: false, firstPerson: false };
    const shift = ROUTE_LENGTH;
    const decisions = (to: number, facing: 1 | -1) => {
      const seen: string[] = [];
      walk(-30.6 + shift, to, facing, 0.4, motion => {
        const decision = resolveTransit(back, 1, motion.feet, motion.camera, state);
        if (seen.at(-1) !== decision) seen.push(decision);
        return decision !== 'wait';
      });
      return seen;
    };
    expect(decisions(-40 + shift, 1)).toEqual(['wait', 'cancel']); // kept backing: crossing done
    expect(decisions(-20 + shift, -1)).toEqual(['promote']); // turned and walked away: back to Eric's
  });

  it('shows the same picture on both sides of the switch', async () => {
    const W = 1920, H = 1080;
    const fake = fakeRenderer(W, H);
    const previews = new PortalPreviews(fake.renderer, loadEmptyRoom);
    const eric = await RoomInstance.mount(emptyRoom('eric-world'), fake.renderer);
    eric.activate(() => {});
    const jp = (await previews.prepare('jp-world'))!;
    const viewer = new THREE.PerspectiveCamera(62, W / H, 0.1, 450);
    viewer.coordinateSystem = THREE.WebGPUCoordinateSystem;
    const place = (z: number) => {
      viewer.position.set(0.4, CAMERA_HEIGHT, z);
      viewer.rotation.set(-0.06, Math.PI, 0, 'YXZ'); // looking +Z, back at the player
      viewer.updateProjectionMatrix();
      viewer.updateMatrixWorld();
    };
    const lamp = v(1.5, 1.2, -25); // something in Eric's room in front of the camera
    const full = new THREE.Vector4(0, 0, W, H);

    place(-ROUTE_LENGTH / 2 + 0.001); // camera just inside Eric's exit: sees his room directly
    const before = screenPixel(lamp, viewer.projectionMatrix.clone().multiply(viewer.matrixWorldInverse), full);

    // Camera passes through: JP becomes the room, and Eric's is seen back through JP's entrance.
    eric.deactivate();
    previews.retain('eric-world', eric);
    expect(previews.takeReady('jp-world')).toBe(jp);
    jp.activate(() => {});
    place(-ROUTE_LENGTH / 2 - 0.001 + ROUTE_LENGTH);
    fake.renders.length = 0;
    previews.render(jp.portals, viewer, 1 / 60, 1);
    const ericView = fake.renders.find(r => r.scene === eric.scene)!;
    expect(ericView.target).toBeNull(); // the opening fills the view, so it's drawn straight to the screen
    const after = screenPixel(lamp, ericView.viewProjection, full);

    expect(after.distanceTo(before)).toBeLessThan(0.25);
    previews.clear();
  });
});

describe('the portal two rooms ahead', () => {
  // Eric's entrance leads back to Alpine, whose far gate (its entrance) leads to Laser.
  const lantern = v(2.5, 2.85, -ROUTE_LENGTH / 2 + 20); // 20 m into Laser, seen from its exit
  const W = 1920, H = 1080;

  async function ericLookingAtPrevRoom() {
    const fake = fakeRenderer(W, H);
    const previews = new PortalPreviews(fake.renderer, loadEmptyRoom);
    const eric = await RoomInstance.mount(emptyRoom('eric-world'), fake.renderer);
    eric.activate(() => {});
    // With snapshots captured, any fallback to them at the crossing would show as a crossfade.
    for (const { id } of rooms) {
      if (id !== 'eric-world') await previews.prepare(id);
    }
    await previews.refreshSnapshots(eric);
    const prevId = eric.portals.find(p => p.portal.id === 'entrance')!.portal.targetWorldId;
    const nearRoom = (await previews.prepare(prevId))!;
    const nearFar = nearRoom.portals.find(p => p.portal.id === 'entrance')!;
    const farId = nearFar.portal.targetWorldId;
    const farRoom = (await previews.prepare(farId))!;

    const viewer = new THREE.PerspectiveCamera(62, W / H, 0.1, 450);
    viewer.coordinateSystem = THREE.WebGPUCoordinateSystem;
    const place = (x: number, z: number) => {
      viewer.position.set(x, 3.5, z);
      viewer.rotation.set(-0.06, Math.PI, 0, 'YXZ'); // 3rd-person height, looking +Z
      viewer.updateProjectionMatrix();
      viewer.updateMatrixWorld();
    };
    const frame = (handles: PortalVisualHandle[]) => {
      fake.renders.length = 0;
      previews.render(handles, viewer, 1 / 60, 1);
      return fake.renders;
    };
    return { previews, eric, prevId, nearRoom, farRoom, nearFar, viewer, place, frame };
  }

  it('draws the far portal live while you walk toward the near one', async () => {
    const { previews, eric, farRoom, nearFar, place, frame } = await ericLookingAtPrevRoom();
    place(0, ROUTE_LENGTH / 2 - 20);
    const renders = frame(eric.portals);
    const farWindow = windowFor(previews, nearFar.aperture)!;
    expect(renders.some(r => r.scene === farRoom.scene)).toBe(true);
    expect(nearFar.aperture.material).toBe(farWindow.material);
    expect(farWindow.liveBlend.value).toBe(1);
    expect(nearFar.group.scale.x).toBe(1);
    previews.clear();
  });

  it.each([0, 1.5])('keeps it steady through the crossing, %s m off-centre', async lateral => {
    const { previews, eric, prevId, nearRoom, farRoom, nearFar, viewer, place, frame } = await ericLookingAtPrevRoom();

    // Just before the near threshold, in Eric's room.
    place(lateral, ROUTE_LENGTH / 2 - 0.01);
    const before = frame(eric.portals);
    const beforeWindow = windowFor(previews, nearFar.aperture)!;
    const lanternBefore = screenPixel(lantern, before.find(r => r.scene === farRoom.scene)!.viewProjection, beforeWindow.bounds);
    // The near room fills the view here, so it is drawn straight to the screen.
    const nearRender = before.find(r => r.scene === nearRoom.scene)!;
    expect(nearRender.target).toBeNull();
    const fullScreen = new THREE.Vector4(0, 0, W, H);
    const ringCenter = nearFar.aperture.getWorldPosition(new THREE.Vector3());
    const ringTop = nearFar.group.localToWorld(v(0, PORTAL_CENTER_Y + PORTAL_RADIUS, 0));
    const ringBefore = screenPixel(ringCenter, nearRender.viewProjection, fullScreen)
      .distanceTo(screenPixel(ringTop, nearRender.viewProjection, fullScreen));

    // The engine promotes the near room as the camera crosses, then the same frame renders from inside it.
    previews.releaseViews();
    const active = previews.takeReady(prevId)!;
    expect(active).toBe(nearRoom);
    eric.deactivate();
    previews.retain('eric-world', eric);
    nearRoom.activate(() => {});
    place(lateral, ROUTE_LENGTH / 2 + 0.01 - ROUTE_LENGTH);
    const after = frame(nearRoom.portals);
    const afterWindow = windowFor(previews, nearFar.aperture)!;
    const lanternAfter = screenPixel(lantern, after.find(r => r.scene === farRoom.scene)!.viewProjection, afterWindow.bounds);
    viewer.updateMatrixWorld();
    const viewerVp = viewer.projectionMatrix.clone().multiply(viewer.matrixWorldInverse);
    const ringAfter = screenPixel(ringCenter, viewerVp, fullScreen).distanceTo(screenPixel(ringTop, viewerVp, fullScreen));

    // Same pixels, same size, and the live view carries on rather than restarting from the snapshot.
    expect(lanternAfter.distanceTo(lanternBefore)).toBeLessThan(0.25);
    expect(ringAfter / ringBefore).toBeCloseTo(1, 2);
    expect(afterWindow.liveBlend.value).toBe(1);
    expect(nearFar.group.scale.x).toBe(1);
    // The portal we just stepped out of sits behind the camera and must not render full-screen.
    expect(after.some(r => r.scene === eric.scene)).toBe(false);
    previews.clear();
  });

  it('keeps snapshot materials un-fogged like live windows so depth-3 previews do not pop in saturation', async () => {
    const fake = fakeRenderer();
    const previews = new PortalPreviews(fake.renderer, () => Promise.resolve(emptyRoom('jp-world')));
    const room = await RoomInstance.mount(emptyRoom('eric-world'), fake.renderer);
    await previews.prepare('jp-world');
    await previews.refreshSnapshots(room);
    const exit = room.portals.find(p => p.portal.id === 'exit')!;
    expect((exit.aperture.material as THREE.MeshBasicNodeMaterial).fog).toBe(false);
    previews.disposeRoom(room);
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

  it('puts the way home behind the 3rd-person chase camera, clear of the entrance gate, and silent until turned toward', () => {
    const spawn = rooms[0].spawns.default;
    const { arrival, portal } = placeHandoffArrival(spawn);
    const definition = createReturnPortalFromHandoff(handoff, portal.position, portal.yaw)!;
    expect(definition.oneWay).toBe(true);
    expect(arrival.yaw).toBe(spawn.yaw);
    // Return portal sits > 5.6 m behind the avatar (behind the chase camera) and clear of entrance.
    expect(definition.position[2] - arrival.position[2]).toBeGreaterThan(5.6);
    expect(definition.position[2]).toBeLessThan(ROUTE_LENGTH / 2 - 5);

    const home = createArchwayPortal(definition, { passage: true });
    home.group.updateMatrixWorld(true);
    // Facing forward on arrival does not offer the [E] prompt for the return portal behind you.
    expect(canOfferPortalPrompt(home, v(...arrival.position), arrival.yaw)).toBe(false);
    // Turning around to face it offers the prompt.
    expect(canOfferPortalPrompt(home, v(...arrival.position), arrival.yaw + Math.PI)).toBe(true);
    // The traveller starts in front of it...
    expect(home.group.worldToLocal(v(...arrival.position)).z).toBeGreaterThan(0);
    // ...turning around and walking back goes home...
    const behind = v(arrival.position[0], 0, definition.position[2] + 0.2);
    expect(detectFeetCrossing(home, v(...arrival.position), behind)).toBe(1);
    // ...but coming down the room from the entrance walks harmlessly through its back.
    expect(detectFeetCrossing(home, behind, v(...arrival.position))).toBeNull();
  });
});

describe('overhead dome-roof portals (useFullOrientation)', () => {
  function domePortal(): PortalVisualHandle {
    const group = new THREE.Group();
    group.position.set(0, 26.2, -14);
    group.rotation.x = Math.PI / 2; // local +Z faces DOWN into the rotunda, local -Z faces UP into the dome
    const geo = new THREE.SphereGeometry(17, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.49);
    geo.rotateX(-Math.PI / 2);
    const aperture = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    aperture.userData.oneWay = true;
    aperture.userData.routeGate = true;
    aperture.userData.useFullOrientation = true;
    group.add(aperture);
    group.updateMatrixWorld(true);
    return {
      portal: {
        id: 'exit',
        label: 'Next',
        position: [0, 26.2, -14],
        yaw: 0,
        targetWorldId: 'laser-lab',
        targetSpawnId: 'entrance',
        oneWay: true,
      },
      group,
      passage: true,
      aperture,
      triggerCenter: v(0, 26.2, -14),
      triggerRadius: 15.6,
      openingRadius: 15.6,
      portalCenterY: 0,
      useFullOrientation: true,
    };
  }

  it('triggers crossing when feet ascend up through the dome plane anywhere inside its wide radius', () => {
    const dome = domePortal();
    expect(detectFeetCrossing(dome, v(0, 25.9, -14), v(0, 26.5, -14))).toBe(1);
    expect(detectFeetCrossing(dome, v(10, 25.9, -10), v(10, 26.5, -10))).toBe(1);
    // Outside the 15.6 m opening radius is ignored, and descending through the back is ignored (one-way)
    expect(detectFeetCrossing(dome, v(18, 25.9, -14), v(18, 26.5, -14))).toBeNull();
    expect(detectFeetCrossing(dome, v(0, 26.5, -14), v(0, 25.9, -14))).toBeNull();
  });

  it('computes 3D bounding-box pixel rect and maps looking UP into the dome to looking forward (-Z) right-side up', () => {
    const dome = domePortal();
    const size = new THREE.Vector2(1920, 1080);
    const viewer = new THREE.PerspectiveCamera(62, size.x / size.y, 0.1, 450);
    viewer.coordinateSystem = THREE.WebGPUCoordinateSystem;
    viewer.position.set(0, 10, -14);
    viewer.rotation.set(Math.PI / 2 - 0.05, 0, 0, 'YXZ'); // looking nearly straight UP at the dome
    viewer.updateProjectionMatrix();
    viewer.updateMatrixWorld();

    const bounds = portalPixels(dome.aperture, viewer, size, new THREE.Vector4());
    expect(bounds.z).toBeGreaterThan(800);
    expect(bounds.w).toBeGreaterThan(500);

    const destCam = new THREE.PerspectiveCamera();
    const spawn = { position: [0, 0, 36.25] as [number, number, number], yaw: 0 };
    framePortal(destCam, viewer, dome.aperture, spawn, 26.2, 0, size, bounds);

    const destForward = new THREE.Vector3(0, 0, -1).applyQuaternion(destCam.quaternion);
    const destUp = new THREE.Vector3(0, 1, 0).applyQuaternion(destCam.quaternion);
    // Looking UP into the dome maps directly to looking forward (-Z) into the destination room, right-side up (+Y)
    expect(destForward.z).toBeLessThan(-0.95);
    expect(destUp.y).toBeGreaterThan(0.95);
    expect(destCam.position.y).toBeGreaterThan(1.0);
  });
});
