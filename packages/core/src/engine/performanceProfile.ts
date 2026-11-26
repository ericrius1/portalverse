export type PerformanceProfileId = 'desktop' | 'iphone' | 'android' | 'mobile-lite';
export type PerformanceProfilePreference = 'auto' | PerformanceProfileId;

export interface PerformanceProfile {
  readonly id: PerformanceProfileId;
  readonly label: string;
  readonly summary: string;
  /** Maximum canvas devicePixelRatio cap. */
  readonly maxPixelRatio: number;
  /** Whether to request hardware antialiasing on the main renderer. */
  readonly antialias: boolean;
  /** Number of rooms preloaded on each side of the active room in the promenade loop. */
  readonly roomWindowRadius: number;
  /** Maximum number of portals rendered live per frame (rest use zero-cost parallax snapshots). */
  readonly maxLivePortals: number;
  /** Whether to render nested depth-2 portals visible through a near portal. */
  readonly renderFarPortals: boolean;
  /** Square resolution (px) for cached portal reference snapshots. */
  readonly snapshotSize: number;
  /** Internal resolution multiplier (0.5..1.0) for live portal window render targets. */
  readonly portalResolutionScale: number;
  /** Whether to run the full-screen liquid-wave portal ripple post-processing pass. */
  readonly useRipplePass: boolean;
  /** Main camera far clip plane in meters. */
  readonly cameraFar: number;
  /** True for mobile/handheld profiles. */
  readonly isMobile: boolean;
}

export const PERFORMANCE_PROFILES: Readonly<Record<PerformanceProfileId, PerformanceProfile>> = {
  desktop: {
    id: 'desktop',
    label: 'Desktop (High)',
    summary: 'Full 2× DPR, MSAA, 4 live portals, depth-2 far portals, 5-room preload window.',
    maxPixelRatio: 2.0,
    antialias: true,
    roomWindowRadius: 2,
    maxLivePortals: 4,
    renderFarPortals: true,
    snapshotSize: 512,
    portalResolutionScale: 1.0,
    useRipplePass: true,
    cameraFar: 450,
    isMobile: false,
  },
  iphone: {
    id: 'iphone',
    label: 'iPhone / iPad',
    summary: '1.5× retina cap, 3-room memory window to avoid iOS Safari reloads, 2 live portals at 75% scale.',
    maxPixelRatio: 1.5,
    antialias: false,
    roomWindowRadius: 1,
    maxLivePortals: 2,
    renderFarPortals: false,
    snapshotSize: 256,
    portalResolutionScale: 0.75,
    useRipplePass: true,
    cameraFar: 280,
    isMobile: true,
  },
  android: {
    id: 'android',
    label: 'Android',
    summary: '1.35× DPR cap, 3-room memory window, 2 live portals at 70% scale tuned for Adreno/Mali GPUs.',
    maxPixelRatio: 1.35,
    antialias: false,
    roomWindowRadius: 1,
    maxLivePortals: 2,
    renderFarPortals: false,
    snapshotSize: 256,
    portalResolutionScale: 0.7,
    useRipplePass: true,
    cameraFar: 260,
    isMobile: true,
  },
  'mobile-lite': {
    id: 'mobile-lite',
    label: 'Mobile Lite (Battery)',
    summary: '1× DPR, single live portal at 55% scale, direct screen pass (no ripple buffer) for older phones.',
    maxPixelRatio: 1.0,
    antialias: false,
    roomWindowRadius: 1,
    maxLivePortals: 1,
    renderFarPortals: false,
    snapshotSize: 256,
    portalResolutionScale: 0.55,
    useRipplePass: false,
    cameraFar: 200,
    isMobile: true,
  },
};

export interface DeviceSignals {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  coarsePointer?: boolean;
  innerWidth?: number;
  innerHeight?: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function isPerformanceProfileId(value: unknown): value is PerformanceProfileId {
  return (
    value === 'desktop' ||
    value === 'iphone' ||
    value === 'android' ||
    value === 'mobile-lite'
  );
}

export function parsePerformanceProfilePreference(value: unknown): PerformanceProfilePreference {
  if (value === 'auto') return 'auto';
  return isPerformanceProfileId(value) ? value : 'auto';
}

export function getPerformanceProfile(id: PerformanceProfileId): PerformanceProfile {
  return PERFORMANCE_PROFILES[id];
}

export function readDeviceSignals(): DeviceSignals {
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number })
      : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  const coarsePointer =
    typeof win?.matchMedia === 'function'
      ? win.matchMedia('(pointer: coarse)').matches
      : false;
  return {
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    coarsePointer,
    innerWidth: win?.innerWidth ?? 1280,
    innerHeight: win?.innerHeight ?? 720,
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
  };
}

/** Detects whether the current device should default to touch controls. */
export function isMobileTouchDevice(signals: DeviceSignals = readDeviceSignals()): boolean {
  const ua = signals.userAgent ?? '';
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (signals.platform === 'MacIntel' && (signals.maxTouchPoints ?? 0) > 1);
  const isAndroid = /Android/i.test(ua);
  const isOtherMobile = /Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  if (isIOS || isAndroid || isOtherMobile) return true;
  const minDim = Math.min(signals.innerWidth ?? 1280, signals.innerHeight ?? 720);
  return Boolean(signals.coarsePointer && (signals.maxTouchPoints ?? 0) > 0 && minDim <= 1024);
}

/**
 * Picks the optimal performance profile for the host device.
 * iOS devices get the memory-guarded `iphone` profile; Android gets `android`;
 * low-memory / low-core mobile devices automatically step down to `mobile-lite`.
 */
export function detectPerformanceProfile(
  signals: DeviceSignals = readDeviceSignals(),
): PerformanceProfile {
  const ua = signals.userAgent ?? '';
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (signals.platform === 'MacIntel' && (signals.maxTouchPoints ?? 0) > 1);
  const isAndroid = /Android/i.test(ua);
  const mem = signals.deviceMemory;
  const cores = signals.hardwareConcurrency;
  const minDim = Math.min(signals.innerWidth ?? 1280, signals.innerHeight ?? 720);
  const isLowSpec =
    (typeof mem === 'number' && mem > 0 && mem <= 3) ||
    (typeof cores === 'number' && cores > 0 && cores <= 4 && minDim <= 430);

  if (isIOS) {
    return isLowSpec ? PERFORMANCE_PROFILES['mobile-lite'] : PERFORMANCE_PROFILES.iphone;
  }
  if (isAndroid) {
    const isLowAndroid =
      (typeof mem === 'number' && mem > 0 && mem <= 4) ||
      (typeof cores === 'number' && cores > 0 && cores <= 4);
    return isLowAndroid ? PERFORMANCE_PROFILES['mobile-lite'] : PERFORMANCE_PROFILES.android;
  }
  if (isMobileTouchDevice(signals)) {
    return isLowSpec ? PERFORMANCE_PROFILES['mobile-lite'] : PERFORMANCE_PROFILES.android;
  }
  return PERFORMANCE_PROFILES.desktop;
}

export function resolvePerformanceProfile(
  preference: PerformanceProfilePreference,
  signals: DeviceSignals = readDeviceSignals(),
): PerformanceProfile {
  if (preference === 'auto') return detectPerformanceProfile(signals);
  return PERFORMANCE_PROFILES[preference];
}
