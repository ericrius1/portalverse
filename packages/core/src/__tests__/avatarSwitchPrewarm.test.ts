import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { AvatarController } from '../engine/AvatarController';
import { PortalPreviews } from '../engine/PortalPreviews';
import { defineRoom } from '../portal/defineRoom';
import type { CharacterRig } from '../characters/types';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeRenderer() {
  let current: THREE.RenderTarget | null = null;
  const compileAsync = vi.fn(
    async (_object: THREE.Object3D, _camera: THREE.Camera, _targetScene?: THREE.Scene | null) => {},
  );
  const renderer = {
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1600, 900),
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.RenderTarget | null) => {
      current = target;
    },
    render: vi.fn(),
    compileAsync,
  } as unknown as THREE.WebGPURenderer;
  return { renderer, compileAsync, target: () => current };
}

describe('FPS-to-character switch precompile and smooth transition', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('HTMLSelectElement', class {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pre-compiles a hidden FPS rig against the room scene without flashing it visible during async yield', async () => {
    const fake = fakeRenderer();
    const previews = new PortalPreviews(
      fake.renderer,
      (id) => Promise.resolve(defineRoom(id, { mount: () => {} })),
      { idle: () => Promise.resolve() },
    );

    const roomScene = new THREE.Scene();
    const rigGroup = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    rigGroup.add(mesh);
    rigGroup.visible = false; // hidden in FPS
    roomScene.add(rigGroup);

    let visibleDuringSyncProject: boolean | undefined;
    let culledDuringSyncProject: boolean | undefined;
    let targetDuringSyncProject: THREE.RenderTarget | null | undefined;
    let releaseCompile!: () => void;
    const compileDone = new Promise<void>((resolve) => {
      releaseCompile = resolve;
    });

    fake.compileAsync.mockImplementation((obj, _cam, targetScene) => {
      expect(obj).toBe(rigGroup);
      expect(targetScene).toBe(roomScene);
      visibleDuringSyncProject = obj.visible;
      culledDuringSyncProject = mesh.frustumCulled;
      targetDuringSyncProject = fake.target();
      return compileDone;
    });

    const pending = previews.compileObject(rigGroup, roomScene, true);
    // Synchronous restoration happens before the async pipeline build resolves so FPS frames never flash the rig.
    expect(visibleDuringSyncProject).toBe(true);
    expect(culledDuringSyncProject).toBe(false);
    expect(targetDuringSyncProject?.texture.type).toBe(THREE.HalfFloatType);
    expect(rigGroup.visible).toBe(false);
    expect(mesh.frustumCulled).toBe(true);
    expect(fake.target()).toBeNull();

    releaseCompile();
    await pending;
    expect(rigGroup.visible).toBe(false);
    expect(fake.target()).toBeNull();

    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    await previews.clear();
  });

  it('compiles directly against the swapchain target when useSceneTarget is false (mobile-lite)', async () => {
    const fake = fakeRenderer();
    const previews = new PortalPreviews(
      fake.renderer,
      (id) => Promise.resolve(defineRoom(id, { mount: () => {} })),
      { idle: () => Promise.resolve() },
    );
    const roomScene = new THREE.Scene();
    const rigGroup = new THREE.Group();
    rigGroup.visible = false;
    let targetDuring: THREE.RenderTarget | null | undefined;
    fake.compileAsync.mockImplementation(async () => {
      targetDuring = fake.target();
    });

    await previews.compileObject(rigGroup, roomScene, false);
    expect(targetDuring).toBeNull();
    expect(rigGroup.visible).toBe(false);
    await previews.clear();
  });

  it('adopts a prewarmed CharacterRig directly in AvatarController.setCharacter without rebuilding', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const avatar = new AvatarController(
      scene,
      camera,
      new EventTarget() as unknown as HTMLElement,
      '#38bdf8',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'suit-bee',
    );

    const setAccentColor = vi.fn();
    const setSkinAppearance = vi.fn();
    const update = vi.fn();
    const dispose = vi.fn();
    const prewarmed: CharacterRig = {
      group: new THREE.Group(),
      setAccentColor,
      setSkinAppearance,
      update,
      dispose,
    };

    avatar.setCharacter('sky-drake', prewarmed);
    expect(avatar.getCharacterId()).toBe('sky-drake');
    expect(avatar.getLocalRig()).toBe(prewarmed);
    expect(setAccentColor).toHaveBeenCalledWith('#38bdf8');
    expect(setSkinAppearance).toHaveBeenCalled();
    expect(scene.children).toContain(prewarmed.group);

    avatar.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('blends the camera look target smoothly when switching from FPS to third person instead of snapping', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const avatar = new AvatarController(
      scene,
      camera,
      new EventTarget() as unknown as HTMLElement,
      '#38bdf8',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'suit-bee',
    );
    avatar.applySpawn({ position: [0, 0, 0], yaw: 0, pitch: 0.45 });
    avatar.update(1 / 60, 1 / 60, false);
    const fpsDir = camera.getWorldDirection(new THREE.Vector3());

    // Switch from FPS -> 3rd person: frame 1 should glide cleanly away from FPS look, not snap abruptly.
    avatar.setFirstPerson(false);
    avatar.update(1 / 60, 2 / 60, false);
    const firstFrameDir = camera.getWorldDirection(new THREE.Vector3());

    for (let i = 3; i < 90; i++) {
      avatar.update(1 / 60, i / 60, false);
    }
    const settledDir = camera.getWorldDirection(new THREE.Vector3());

    const totalAngle = fpsDir.angleTo(settledDir);
    const firstStepAngle = fpsDir.angleTo(firstFrameDir);
    expect(totalAngle).toBeGreaterThan(0.05);
    expect(firstStepAngle).toBeLessThan(totalAngle * 0.5);

    await flush();
    avatar.dispose();
  });
});
