export interface ViewportSizeInput {
  containerWidth?: number;
  containerHeight?: number;
  windowWidth?: number;
  windowHeight?: number;
  visualWidth?: number;
  visualHeight?: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
}

function positiveFinite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Resolve the canvas viewport size and aspect ratio from the container element,
 * falling back per-axis to `window` and `visualViewport` whenever layout hasn't
 * given the container positive dimensions yet (e.g. before CSS applies or while
 * a mobile in-app browser sheet is opening).
 *
 * When the container already has positive dimensions, it wins over
 * `visualViewport` so opening a mobile soft keyboard doesn't squash the full-
 * screen `#viewport` canvas.
 */
export function resolveViewportSize(input: ViewportSizeInput): ViewportSize {
  const width = Math.max(
    1,
    Math.round(
      positiveFinite(input.containerWidth) ||
        positiveFinite(input.windowWidth) ||
        positiveFinite(input.visualWidth) ||
        1,
    ),
  );
  const height = Math.max(
    1,
    Math.round(
      positiveFinite(input.containerHeight) ||
        positiveFinite(input.windowHeight) ||
        positiveFinite(input.visualHeight) ||
        1,
    ),
  );
  return {
    width,
    height,
    aspect: width / height,
  };
}

export function resolvePixelRatio(devicePixelRatio: number | undefined, maxPixelRatio: number): number {
  const raw = positiveFinite(devicePixelRatio) || 1;
  const cap = positiveFinite(maxPixelRatio) || 1;
  return Math.min(Math.max(1, raw), cap);
}

export interface ViewportSyncSnapshot {
  width: number;
  height: number;
  pixelRatio: number;
  cameraAspect: number;
}

export function needsViewportSync(
  current: ViewportSyncSnapshot,
  nextWidth: number,
  nextHeight: number,
  nextPixelRatio: number,
): boolean {
  const nextAspect = nextWidth / Math.max(1, nextHeight);
  return (
    current.width !== nextWidth ||
    current.height !== nextHeight ||
    Math.abs(current.pixelRatio - nextPixelRatio) > 1e-4 ||
    !Number.isFinite(current.cameraAspect) ||
    Math.abs(current.cameraAspect - nextAspect) > 1e-4
  );
}
