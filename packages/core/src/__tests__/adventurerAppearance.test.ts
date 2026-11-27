import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAdventurerRig, adventurerClip } from '../characters/adventurer';
import { chooseStartupCharacter, IDLE_MOTION_STATE, skinColor, normalizeSkinAppearance } from '../characters';
import { sanitizeSkinAppearance } from '../characters/appearance';
import { parseClientMessage } from '../../../server/src/protocol';
import { RoomManager } from '../../../server/src/roomManager';
import { encodePortalHandoff, decodePortalHandoff } from '../portal/handoff';

beforeAll(() => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
    const variant = String(url).includes('woman') ? 'woman' : 'man';
    const b = await readFile(new URL(`../characters/assets/adventurer-${variant}.glb`, import.meta.url));
    return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  });
});
afterAll(() => vi.restoreAllMocks());

function materials(root: THREE.Object3D): Map<string, THREE.MeshStandardMaterial> {
  const result = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (material instanceof THREE.MeshStandardMaterial) result.set(material.name, material);
    }
  });
  return result;
}

describe('adventurer appearance', () => {
  it('splits startup choices equally and keeps explicit choices', () => {
    const choices = Array.from({ length: 1000 }, (_, i) => chooseStartupCharacter(null, () => i / 1000));
    expect(choices.filter((c) => c === 'adventurer-man')).toHaveLength(500);
    expect(choices.filter((c) => c === 'adventurer-woman')).toHaveLength(500);
    expect(chooseStartupCharacter('sky-drake', () => 0)).toBe('sky-drake');
    expect(chooseStartupCharacter('missing', () => 0.5)).toBe('adventurer-woman');
  });

  it('provides a continuous decreasing luminance ramp and distinct undertones', () => {
    let previous = Infinity;
    for (let i = 0; i <= 100; i++) {
      const c = skinColor({ skinTone: i / 100, undertone: 0 });
      const luminance = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      expect(luminance).toBeLessThan(previous);
      previous = luminance;
      for (const channel of c.toArray()) expect(channel).toBeGreaterThanOrEqual(0);
    }
    const rosy = skinColor({ skinTone: 0.52, undertone: -1 });
    const golden = skinColor({ skinTone: 0.52, undertone: 1 });
    expect(rosy.getHexString()).not.toBe(golden.getHexString());
    expect(rosy.r / rosy.g).toBeGreaterThan(golden.r / golden.g);
    expect(normalizeSkinAppearance({ skinTone: NaN, undertone: Infinity })).toEqual(normalizeSkinAppearance());
    expect(sanitizeSkinAppearance({ skinTone: -3, undertone: 8 })).toEqual({ skinTone: 0, undertone: 1 });
    expect(sanitizeSkinAppearance({ skinTone: '0.2', undertone: null })).toEqual({});
  });

  it.each(['man', 'woman'] as const)('isolates %s skin, skeletons and resource lifetimes', async (variant) => {
    const first = createAdventurerRig(variant, { skinTone: 0.1 });
    const second = createAdventurerRig(variant, { skinTone: 0.9 });
    await Promise.all([first.ready, second.ready]);
    const a = materials(first.group), b = materials(second.group);
    expect(a.get('Skin')).not.toBe(b.get('Skin'));
    expect(a.get('Skin')!.color.getHexString()).not.toBe(b.get('Skin')!.color.getHexString());
    const clothing = a.get('Green')!.color.getHexString();
    first.setSkinAppearance!({ skinTone: 1, undertone: -1 });
    expect(a.get('Green')!.color.getHexString()).toBe(clothing);
    expect(b.get('Skin')!.color.getHexString()).toBe(skinColor({ skinTone: 0.9 }).getHexString());
    expect(a.get('Skin')!.metalness).toBe(0);
    expect(first.group.getObjectByName('Head')).not.toBe(second.group.getObjectByName('Head'));

    const skinDispose = vi.spyOn(a.get('Skin')!, 'dispose');
    first.dispose(); first.dispose();
    expect(skinDispose).toHaveBeenCalledTimes(1);
    second.update(1 / 60, 0, { ...IDLE_MOTION_STATE, grounded: false, isFlying: true });
    expect(new THREE.Box3().setFromObject(second.group).isEmpty()).toBe(false);
    second.dispose();
  });

  it.each([
    ['man', 'Walk', 1.4], ['woman', 'Walk', 1.4], ['man', 'Run', 1], ['woman', 'Run', 1],
  ] as const)('preserves %s authored %s tracks at %sx cadence and airborne ankle alignment', async (variant, clipName, cadence) => {
    const source = await new GLTFLoader().loadAsync(variant);
    const reference = new THREE.AnimationMixer(source.scene);
    const walk = source.animations.find((clip) => clip.name.endsWith(`|${clipName}`))!;
    reference.clipAction(walk).play();
    reference.update(1.5 * cadence);
    const rig = createAdventurerRig(variant);
    await rig.ready;
    const moving = { ...IDLE_MOTION_STATE, speed: 8, speedNorm: 0.65, forwardSpeed: 8, boost: clipName === 'Run' ? 1 : 0 };
    const flying = { ...moving, grounded: false, isFlying: true, boost: 1 };
    const run = (motion: typeof moving) => {
      for (let i = 0; i < 90; i++) rig.update(1 / 60, i / 60, motion);
    };
    run(flying);
    rig.group.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const ankle = rig.group.getObjectByName(`LowerLeg${side}_end`)!.getWorldPosition(new THREE.Vector3());
      const foot = rig.group.getObjectByName(`Foot${side}`)!.getWorldPosition(new THREE.Vector3());
      expect(ankle.distanceTo(foot)).toBeLessThan(0.03);
    }
    run(moving);
    // Compare the actual shipped clip, including constant tracks that AnimationMixer
    // may skip on subsequent frames, after procedural flight has completely faded.
    for (const track of walk.tracks) {
      const [name, property] = track.name.split('.');
      const actual = rig.group.getObjectByName(name)!;
      const expected = source.scene.getObjectByName(name)!;
      if (property === 'quaternion') expect(Math.abs(actual.quaternion.dot(expected.quaternion))).toBeCloseTo(1, 4);
      if (property === 'position') {
        // Feet now follow the shin instead of the independently interpolated control;
        // permit its millimeter-scale source interpolation error, not a visible gap.
        expect(actual.position.distanceTo(expected.position)).toBeLessThan(name.startsWith('Foot') ? 0.00003 : 0.00001);
      }
    }
    rig.dispose();
  });

  it.each(['man', 'woman'] as const)('keeps %s boots attached during interrupted direction changes', async variant => {
    const rig = createAdventurerRig(variant);
    await rig.ready;
    const moving = { ...IDLE_MOTION_STATE, speed: 8.2, speedNorm: 0.65, forwardSpeed: 8.2 };
    const sequence = [moving, { ...moving, forwardSpeed: 0, strafeSpeed: 8.2 },
      { ...moving, forwardSpeed: -8.2 }, { ...moving, forwardSpeed: 0, strafeSpeed: -8.2 },
      { ...moving, boost: 1 }, IDLE_MOTION_STATE];
    let maxGap = 0;
    for (let frame = 0; frame < 360; frame++) {
      rig.update(1 / 60, frame / 60, sequence[Math.floor(frame / 7) % sequence.length]);
      rig.group.updateMatrixWorld(true);
      for (const side of ['L', 'R']) {
        const ankle = rig.group.getObjectByName(`LowerLeg${side}_end`)!.getWorldPosition(new THREE.Vector3());
        const foot = rig.group.getObjectByName(`Foot${side}`)!.getWorldPosition(new THREE.Vector3());
        maxGap = Math.max(maxGap, ankle.distanceTo(foot));
      }
    }
    rig.dispose();
    expect(maxGap).toBeLessThan(0.015);
  });

  it('handles disposal while loading without mounting a late model', async () => {
    const rig = createAdventurerRig('man');
    rig.dispose();
    await rig.ready;
    expect(rig.group.children).toHaveLength(0);
  });

  it('chooses directional locomotion and airborne poses for existing actions', () => {
    const motion = { ...IDLE_MOTION_STATE, speed: 8, speedNorm: 0.65, forwardSpeed: 8 };
    expect(adventurerClip(IDLE_MOTION_STATE)).toBe('Idle');
    expect(adventurerClip(motion)).toBe('Walk');
    expect(adventurerClip({ ...motion, boost: 1 })).toBe('Run');
    expect(adventurerClip({ ...motion, forwardSpeed: -8 })).toBe('Run_Back');
    expect(adventurerClip({ ...motion, forwardSpeed: 0, strafeSpeed: 8 })).toBe('Run_Right');
    expect(adventurerClip({ ...motion, forwardSpeed: 0, strafeSpeed: -8 })).toBe('Run_Left');
    expect(adventurerClip({ ...motion, grounded: false })).toBe('Idle_Neutral');
    expect(adventurerClip({ ...motion, isFlying: true })).toBe('Idle_Neutral');
  });

  it('keeps appearance through joins, profile updates, old clients and portal handoffs', () => {
    const room = new RoomManager({ knownWorldIds: ['eric-world'] });
    const hello = parseClientMessage(JSON.stringify({ type: 'hello',
      player: { id: 'p-1', name: 'Explorer', color: '#abcdef', characterId: 'adventurer-woman', skinTone: 0.7, undertone: -0.4 },
      worldId: 'eric-world', position: [0, 0, 0], yaw: 0 }));
    room.handleMessage('c1', hello!);
    expect(room.getRoster()[0]).toMatchObject({ skinTone: 0.7, undertone: -0.4 });
    const update = (values: object) => room.handleMessage('c1', parseClientMessage(JSON.stringify({
      type: 'update_profile', name: 'Explorer', color: '#abcdef', ...values }))!);
    update({ skinTone: 0, undertone: 0 });
    expect(room.getRoster()[0]).toMatchObject({ skinTone: 0, undertone: 0 });
    update({});
    expect(room.getRoster()[0]).toMatchObject({ skinTone: 0, undertone: 0 });
    update({ skinTone: 'invalid', undertone: {} });
    expect(room.getRoster()[0]).toMatchObject({ skinTone: 0, undertone: 0 });
    const handoff = decodePortalHandoff(encodePortalHandoff({ version: 1,
      playerName: 'Explorer', playerColor: '#abcdef', characterId: 'adventurer-man',
      skinTone: 0.7, undertone: -0.4, fromWorldId: 'eric-world', fromWorldName: 'World', sentAt: 0 }));
    expect(handoff).toMatchObject({ characterId: 'adventurer-man', skinTone: 0.7, undertone: -0.4 });
  });
});
