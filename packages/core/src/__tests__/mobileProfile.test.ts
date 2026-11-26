import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  detectPerformanceProfile,
  isMobileTouchDevice,
  parsePerformanceProfilePreference,
  PERFORMANCE_PROFILES,
  resolvePerformanceProfile,
} from '../engine/performanceProfile';
import { AvatarController } from '../engine/AvatarController';
import { roomWindow } from '../engine/roomWindow';

describe('mobile performance profile detection', () => {
  it('detects iPhone / iPad and selects the memory-guarded iphone profile', () => {
    const iphone = detectPerformanceProfile({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      coarsePointer: true,
      innerWidth: 393,
      innerHeight: 852,
    });
    expect(iphone.id).toBe('iphone');
    expect(iphone.isMobile).toBe(true);
    expect(iphone.roomWindowRadius).toBe(1);
    expect(iphone.maxLivePortals).toBe(2);
    expect(iphone.renderFarPortals).toBe(false);
    expect(iphone.maxPixelRatio).toBeLessThanOrEqual(1.5);

    // iPadOS reporting MacIntel with touch points
    const ipad = detectPerformanceProfile({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      coarsePointer: true,
      innerWidth: 820,
      innerHeight: 1180,
    });
    expect(ipad.id).toBe('iphone');
    expect(isMobileTouchDevice({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      coarsePointer: true,
    })).toBe(true);
  });

  it('detects Android flagship vs low-RAM Android devices', () => {
    const flagship = detectPerformanceProfile({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
      coarsePointer: true,
      innerWidth: 412,
      innerHeight: 915,
      deviceMemory: 8,
      hardwareConcurrency: 8,
    });
    expect(flagship.id).toBe('android');
    expect(flagship.roomWindowRadius).toBe(1);
    expect(flagship.portalResolutionScale).toBeLessThan(1);

    const budget = detectPerformanceProfile({
      userAgent:
        'Mozilla/5.0 (Linux; Android 13; Moto G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
      coarsePointer: true,
      innerWidth: 360,
      innerHeight: 800,
      deviceMemory: 3,
      hardwareConcurrency: 4,
    });
    expect(budget.id).toBe('mobile-lite');
    expect(budget.useRipplePass).toBe(false);
    expect(budget.maxLivePortals).toBe(1);
  });

  it('defaults desktop browsers to high fidelity and respects manual overrides', () => {
    const desktop = detectPerformanceProfile({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      coarsePointer: false,
      innerWidth: 1440,
      innerHeight: 900,
    });
    expect(desktop.id).toBe('desktop');
    expect(desktop.isMobile).toBe(false);
    expect(desktop.roomWindowRadius).toBe(2);
    expect(desktop.renderFarPortals).toBe(true);

    expect(parsePerformanceProfilePreference('iphone')).toBe('iphone');
    expect(parsePerformanceProfilePreference('invalid')).toBe('auto');
    expect(resolvePerformanceProfile('mobile-lite')).toBe(PERFORMANCE_PROFILES['mobile-lite']);
  });

  it('supports tighter roomWindow radius on mobile profiles', () => {
    const rooms = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];
    expect(roomWindow(rooms, 'r2', 1, 2).map((e) => e.id)).toEqual(['r3', 'r1', 'r4', 'r0']);
    expect(roomWindow(rooms, 'r2', 1, 1).map((e) => e.id)).toEqual(['r3', 'r1']);
  });
});

describe('AvatarController virtual touch inputs', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('HTMLSelectElement', class {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('walks, looks, jumps, flies, rises, boosts, and lands using virtual touch APIs', () => {
    const avatar = new AvatarController(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      new EventTarget() as unknown as HTMLElement,
      '#38bdf8',
    );
    avatar.applySpawn({ position: [0, 0, 0], yaw: 0 });

    // Analog forward walk (-Z)
    avatar.setVirtualMove(1, 0, false);
    for (let i = 0; i < 30; i++) avatar.update(1 / 60, i / 60, false);
    expect(avatar.position.z).toBeLessThan(-2);
    avatar.setVirtualMove(0, 0, false);

    // Touch look delta
    avatar.applyLookDelta(100, -40);
    expect(avatar.yaw).toBeLessThan(0);
    expect(avatar.pitch).toBeGreaterThan(0);

    // Jump -> second press in mid-air takes off into flight
    avatar.pressJumpOrFly();
    avatar.setJumpHeld(true);
    for (let i = 0; i < 10; i++) avatar.update(1 / 60, 0.5 + i / 60, false);
    expect(avatar.position.y).toBeGreaterThan(0.5);
    expect(avatar.isFlying).toBe(false);

    avatar.pressJumpOrFly();
    expect(avatar.isFlying).toBe(true);

    // Rise & boost in flight
    avatar.setVirtualBoost(true);
    for (let i = 0; i < 30; i++) avatar.update(1 / 60, 1 + i / 60, false);
    expect(avatar.position.y).toBeGreaterThan(3);

    // Descend & land onto floor (auto-releases flight near ground, then gravity settles feet to 0)
    avatar.setJumpHeld(false);
    avatar.setVirtualBoost(false);
    avatar.setVirtualVertical(-1);
    for (let i = 0; i < 240 && (avatar.isFlying || avatar.position.y > 0); i++) {
      avatar.update(1 / 60, 2 + i / 60, false);
    }
    expect(avatar.isFlying).toBe(false);
    expect(avatar.position.y).toBe(0);

    avatar.dispose();
  });
});
