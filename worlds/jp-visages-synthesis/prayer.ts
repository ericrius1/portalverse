// The carving is centred on the origin, halfway between the avenue's two portals.
export const RING_RADIUS = 2.25;
export const BEAM_RADIUS = RING_RADIUS * 4;
const RELEASE_SECONDS = 0.35;

export class Prayer {
  private standingSince: number | undefined;
  private invokedAt: number | undefined;
  private releasedAt: number | undefined;
  private releaseStrength = 0;
  ready = false;
  glow = 0;
  light = 0;

  reset() {
    this.standingSince = this.invokedAt = this.releasedAt = undefined;
    this.releaseStrength = this.glow = this.light = 0;
    this.ready = false;
  }

  update(now: number, x: number, y: number, z: number, grounded: boolean) {
    const radialSq = x * x + z * z;
    const standing = grounded && radialSq <= RING_RADIUS ** 2;
    if (standing) this.standingSince ??= now;
    else this.standingSince = undefined;
    const dwell = this.standingSince === undefined ? 0 : now - this.standingSince;
    this.glow = Math.min(1, Math.max(0, (dwell - 6) / 0.45));
    this.ready = this.invokedAt === undefined && dwell >= 7;

    if (this.invokedAt === undefined) return;
    if (this.releasedAt === undefined) {
      this.light = Math.min(1, Math.max(0, (now - this.invokedAt) / 0.22));
      if (radialSq + y * y <= BEAM_RADIUS ** 2) return;
      this.releasedAt = now;
      this.releaseStrength = this.light;
    }
    const fade = Math.max(0, 1 - (now - this.releasedAt) / RELEASE_SECONDS);
    this.light = this.releaseStrength * fade;
    if (fade === 0) this.reset();
  }

  invoke(now: number) {
    if (!this.ready) return false;
    this.invokedAt = now;
    this.ready = false;
    return true;
  }
}
