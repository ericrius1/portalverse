import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  CHARACTERS,
  createCharacterRig,
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  IDLE_MOTION_STATE,
  isValidCharacterId,
  type AvatarMotionState,
} from '../characters';
import { AvatarController } from '../engine/AvatarController';
import { parseClientMessage } from '../../../server/src/protocol';
import { RoomManager } from '../../../server/src/roomManager';

const MOTION_MODES: Array<[string, AvatarMotionState]> = [
  ['idle', { ...IDLE_MOTION_STATE }],
  [
    'walk',
    {
      speed: 8.2,
      speedNorm: 0.65,
      forwardSpeed: 8.2,
      strafeSpeed: 0,
      velocityY: 0,
      turnRate: 0.4,
      grounded: true,
      isFlying: false,
      boost: 0,
      pitch: 0,
      landImpact: 0,
    },
  ],
  [
    'jump-land',
    {
      speed: 6.0,
      speedNorm: 0.5,
      forwardSpeed: 6.0,
      strafeSpeed: 1.2,
      velocityY: 5.5,
      turnRate: -0.5,
      grounded: false,
      isFlying: false,
      boost: 0,
      pitch: 0.15,
      landImpact: 0.8,
    },
  ],
  [
    'fly',
    {
      speed: 16.5,
      speedNorm: 1.15,
      forwardSpeed: 16.5,
      strafeSpeed: -1.5,
      velocityY: 1.2,
      turnRate: 1.1,
      grounded: false,
      isFlying: true,
      boost: 0.2,
      pitch: 0.25,
      landImpact: 0,
    },
  ],
  [
    'boost',
    {
      speed: 31.0,
      speedNorm: 1.8,
      forwardSpeed: 31.0,
      strafeSpeed: 0,
      velocityY: -0.8,
      turnRate: -1.6,
      grounded: false,
      isFlying: true,
      boost: 1.0,
      pitch: -0.2,
      landImpact: 0,
    },
  ],
];

function expectFiniteTransforms(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    for (const v of [
      obj.position.x,
      obj.position.y,
      obj.position.z,
      obj.rotation.x,
      obj.rotation.y,
      obj.rotation.z,
      obj.scale.x,
      obj.scale.y,
      obj.scale.z,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
}

beforeAll(() => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
    const variant = String(url).includes('woman') ? 'woman' : 'man';
    const bytes = await readFile(new URL(`../characters/assets/adventurer-${variant}.glb`, import.meta.url));
    return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  });
});
afterAll(() => vi.restoreAllMocks());

describe('playable character registry', () => {
  it('registers suit-bee and sky-drake with valid metadata and fallback lookup', () => {
    expect(CHARACTERS.map((c) => c.id)).toEqual(['adventurer-man', 'adventurer-woman', 'suit-bee', 'sky-drake']);
    expect(DEFAULT_CHARACTER_ID).toBe('suit-bee');
    expect(isValidCharacterId('suit-bee')).toBe(true);
    expect(isValidCharacterId('sky-drake')).toBe(true);
    expect(isValidCharacterId('unknown-hero')).toBe(false);
    expect(getCharacterDefinition('unknown-hero').id).toBe(DEFAULT_CHARACTER_ID);
  });

  it.each(CHARACTERS.map((c) => c.id))(
    'builds %s at explorer scale (feet near Y=0) and animates cleanly across all motion modes',
    async (id) => {
      const rig = createCharacterRig(id, { accentColor: '#38bdf8' });
      await rig.ready;
      rig.group.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(rig.group);
      // Feet should rest close to ground Y = 0 and total standing height should match explorer scale (~1.4..2.3m)
      expect(box.min.y).toBeGreaterThan(-0.18);
      expect(box.min.y).toBeLessThan(0.18);
      expect(box.max.y).toBeGreaterThan(1.4);
      expect(box.max.y).toBeLessThan(2.35);

      rig.setAccentColor?.('#f472b6');

      let elapsed = 0;
      for (const [, motion] of MOTION_MODES) {
        for (let frame = 0; frame < 12; frame++) {
          elapsed += 1 / 60;
          rig.update(1 / 60, elapsed, motion);
        }
        expectFiniteTransforms(rig.group);
      }

      // Disposing one rig must not crash or corrupt a sibling instance of the same character
      const sibling = createCharacterRig(id);
      await sibling.ready;
      rig.dispose();
      sibling.update(1 / 60, 0.5, MOTION_MODES[3][1]);
      expectFiniteTransforms(sibling.group);
      sibling.dispose();
    },
  );
});

describe('AvatarController character switching and multiplayer sync', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('HTMLSelectElement', class {});
  });

  afterEach(() => vi.unstubAllGlobals());

  function controls(id: string) {
    const camera = new THREE.PerspectiveCamera();
    const avatar = new AvatarController(new THREE.Scene(), camera,
      new EventTarget() as unknown as HTMLElement, '#22d3ee',
      undefined, undefined, undefined, undefined, undefined, id);
    avatar.setFirstPerson(false);
    avatar.applySpawn({ position: [0, 0, 0], yaw: 0 });
    const run = (frames = 60) => {
      for (let i = 0; i < frames; i++) avatar.update(1 / 60, i / 60, false);
    };
    return { avatar, camera, run };
  }

  it.each(['adventurer-man', 'adventurer-woman', 'suit-bee', 'sky-drake'])(
    '%s uses its own third-person facing behavior when moving sideways', (id) => {
      const { avatar, run } = controls(id);
      const adventure = id.startsWith('adventurer-');
      const press = new Event('keydown');
      Object.defineProperty(press, 'code', { value: 'KeyA' });
      window.dispatchEvent(press);
      run();
      expect(avatar.position.x).toBeLessThan(-2);
      expect(avatar.yaw).toBe(0);
      expect(avatar.getFacingYaw()).toBeCloseTo(adventure ? Math.PI / 2 : 0, 3);
      if (adventure) {
        expect(avatar.getMotionState().forwardSpeed).toBeGreaterThan(5);
        expect(Math.abs(avatar.getMotionState().strafeSpeed)).toBeLessThan(0.02);
      } else {
        expect(avatar.getMotionState().strafeSpeed).toBeLessThan(-5);
      }
      avatar.dispose();
    },
  );

  it.each(['adventurer-man', 'adventurer-woman', 'suit-bee', 'sky-drake'])(
    '%s keeps the correct relationship between stationary orbit and body facing', (id) => {
      const { avatar, camera, run } = controls(id);
      avatar.applyLookDelta(Math.PI / 0.0046, 0);
      run();
      expect(avatar.yaw).toBeCloseTo(-Math.PI);
      expect(camera.position.z).toBeLessThan(0); // Camera has orbited to the character's front.
      expect(avatar.getFacingYaw()).toBeCloseTo(id.startsWith('adventurer-') ? 0 : -Math.PI);
      expect(avatar.position.length()).toBe(0);
      avatar.dispose();
    },
  );

  it.each(['classic', 'platformer'] as const)('adventure movement remains camera-relative with %s physics', mode => {
    const { avatar, run } = controls('adventurer-woman');
    avatar.setMovementMode(mode);
    avatar.yaw = Math.PI / 2;
    avatar.setVirtualMove(-1, 0);
    run();
    expect(avatar.position.x).toBeGreaterThan(2);
    expect(Math.abs(avatar.position.z)).toBeLessThan(0.01);
    expect(avatar.getFacingYaw()).toBeCloseTo(-Math.PI / 2, 3);
    expect(avatar.yaw).toBe(Math.PI / 2);
    avatar.setVirtualMove(0, 0);
    run(120);
    const facing = avatar.getFacingYaw();
    avatar.applyLookDelta(180, 50);
    run();
    expect(avatar.getFacingYaw()).toBeCloseTo(facing);
    avatar.dispose();
  });

  it.each(['adventurer-man', 'adventurer-woman'])('%s eases rapid reversals without a one-frame heading snap', id => {
    for (const fps of [30, 60, 120]) {
      const { avatar } = controls(id);
      let largestStep = 0;
      for (let frame = 0; frame < fps * 2; frame++) {
        avatar.setVirtualMove(0, Math.floor(frame / (fps * 0.4)) % 2 ? 1 : -1);
        const previous = avatar.getFacingYaw();
        avatar.update(1 / fps, frame / fps, false);
        const delta = avatar.getFacingYaw() - previous;
        const step = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
        largestStep = Math.max(largestStep, step);
        expect(step).toBeLessThanOrEqual(Math.PI * 4 / fps + 1e-8);
        expect(avatar.yaw).toBe(0);
      }
      expect(largestStep).toBeGreaterThan(0.02);
      avatar.setVirtualMove(0, 1);
      for (let frame = 0; frame < fps; frame++) avatar.update(1 / fps, 2 + frame / fps, false);
      expect(Math.cos(avatar.getFacingYaw() + Math.PI / 2)).toBeCloseTo(1, 4);
      avatar.dispose();
    }
  });

  it('uses travel direction in flight and keeps orbit pitch out of the flight pose', () => {
    const { avatar, run } = controls('adventurer-man');
    avatar.applySpawn({ position: [0, 12, 0], yaw: 0, flying: true });
    avatar.setVirtualMove(0, 1);
    run();
    expect(avatar.getFacingYaw()).toBeCloseTo(-Math.PI / 2, 3);
    expect(avatar.yaw).toBe(0);
    avatar.setVirtualMove(0, 0);
    run(240);
    const facing = avatar.getFacingYaw();
    avatar.applyLookDelta(200, 120);
    run();
    expect(avatar.getFacingYaw()).toBeCloseTo(facing, 3);
    expect(avatar.getMotionState().pitch).toBeCloseTo(0);
    expect(avatar.pitch).not.toBe(0);
    avatar.dispose();
  });

  it('resets facing on spawn and keeps camera/body separation through portal rotation', () => {
    const { avatar, run } = controls('adventurer-man');
    avatar.setVirtualMove(0, -1);
    run();
    const facing = avatar.getFacingYaw();
    avatar.rotateHeading(Math.PI / 2);
    avatar.turnMomentum(Math.PI / 2);
    avatar.syncRigTransform();
    expect(avatar.yaw).toBeCloseTo(Math.PI / 2);
    expect(avatar.getFacingYaw()).toBeCloseTo(facing + Math.PI / 2);
    avatar.setVirtualMove(0, 0);
    run(30);
    expect(avatar.getFacingYaw()).toBeCloseTo(facing + Math.PI / 2, 3);
    avatar.applySpawn({ position: [0, 0, 0], yaw: 0.7 });
    expect(avatar.getFacingYaw()).toBe(0.7);
    expect(avatar.yaw).toBe(0.7);
    avatar.dispose();
  });

  it('restores camera-facing strafing in first person and when switching to a legacy character', () => {
    const { avatar, run } = controls('adventurer-woman');
    avatar.setVirtualMove(0, -1);
    run();
    expect(avatar.getFacingYaw()).toBeCloseTo(Math.PI / 2, 3);
    avatar.setFirstPerson(true);
    run();
    expect(avatar.getFacingYaw()).toBe(avatar.yaw);
    expect(avatar.getMotionState().strafeSpeed).toBeLessThan(-5);
    avatar.setFirstPerson(false);
    avatar.setCharacter('suit-bee');
    run();
    expect(avatar.getFacingYaw()).toBe(avatar.yaw);
    expect(avatar.getMotionState().strafeSpeed).toBeLessThan(-5);
    avatar.dispose();
  });

  it('switches playable characters cleanly and keeps motion telemetry live', () => {
    const onCharacterChange = vi.fn();
    const scene = new THREE.Scene();
    const avatar = new AvatarController(
      scene,
      new THREE.PerspectiveCamera(),
      new EventTarget() as unknown as HTMLElement,
      '#22d3ee',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'suit-bee',
      onCharacterChange,
    );

    expect(avatar.getCharacterId()).toBe('suit-bee');
    avatar.setCharacter('sky-drake');
    expect(avatar.getCharacterId()).toBe('sky-drake');
    expect(onCharacterChange).toHaveBeenCalledWith('sky-drake');

    avatar.setFirstPerson(false);
    expect(avatar.firstPerson).toBe(false);
    avatar.toggleFlight();
    avatar.update(1 / 60, 0.5, false);
    expect(avatar.getMotionState().isFlying).toBe(true);

    avatar.dispose();
  });

  it('round-trips characterId and isFlying through server protocol and RoomManager', () => {
    const hello = parseClientMessage(
      JSON.stringify({
        type: 'hello',
        player: { id: 'p-1', name: 'Eric', color: '#38bdf8', characterId: 'sky-drake' },
        worldId: 'eric-world',
        position: [0, 0, 0],
        yaw: 0,
      }),
    );
    expect(hello).not.toBeNull();
    expect(hello?.type === 'hello' && hello.player.characterId).toBe('sky-drake');

    const updateProfile = parseClientMessage(
      JSON.stringify({
        type: 'update_profile',
        name: 'Eric',
        color: '#ffc21a',
        characterId: 'suit-bee',
      }),
    );
    expect(updateProfile?.type === 'update_profile' && updateProfile.characterId).toBe('suit-bee');

    const state = parseClientMessage(
      JSON.stringify({
        type: 'state',
        position: [1, 4, -2],
        yaw: 0.5,
        velocityY: 1.2,
        isFlying: true,
      }),
    );
    expect(state?.type === 'state' && state.isFlying).toBe(true);

    const rm = new RoomManager({ knownWorldIds: ['eric-world'] });
    rm.handleMessage('c1', hello!);
    rm.handleMessage('c1', state!);
    expect(rm.getRoster()[0].characterId).toBe('sky-drake');
    expect(rm.getRoster()[0].isFlying).toBe(true);

    rm.handleMessage('c1', updateProfile!);
    expect(rm.getRoster()[0].characterId).toBe('suit-bee');
  });
});
