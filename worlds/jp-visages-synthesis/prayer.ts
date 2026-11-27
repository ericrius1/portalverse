// The carving is centred on the origin, halfway between the avenue's two portals.
export const RING_RADIUS = 2.25;
export const BEAM_RADIUS = RING_RADIUS * 4;
const RELEASE_SECONDS = 0.35;
const CHARGE_SECONDS = 3;
const PRAYER_DELAY_SECONDS = 1;
const GLOW_RISE_SECONDS = 0.45;
const WALK_GLOW_SECONDS = 0.35;
const GLOW_OFF_SECONDS = 0.35;
const ease = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

export class Prayer {
  private enteredAt: number | undefined;
  private entryGlow = 0;
  private entryRingGlow = 0;
  private glowRelease: { at: number; floor: number; ring: number } | undefined;
  private invokedAt: number | undefined;
  private releasedAt: number | undefined;
  private releaseStrength = 0;
  ready = false;
  glow = 0;
  ringGlow = 0;
  light = 0;

  reset() {
    this.enteredAt = this.invokedAt = this.releasedAt = undefined;
    this.glowRelease = undefined;
    this.entryGlow = this.entryRingGlow = 0;
    this.releaseStrength = this.glow = this.ringGlow = this.light = 0;
    this.ready = false;
  }

  update(now: number, x: number, y: number, z: number, grounded: boolean) {
    const radialSq = x * x + z * z;
    const standing = grounded && radialSq <= RING_RADIUS ** 2;
    if (standing) {
      if (this.enteredAt === undefined) {
        this.enteredAt = now;
        this.entryGlow = this.glow;
        this.entryRingGlow = this.ringGlow;
      }
      this.glowRelease = undefined;
    } else if (this.enteredAt !== undefined) {
      this.glowRelease = { at: now, floor: this.glow, ring: this.ringGlow };
      this.enteredAt = undefined;
    }
    const dwell = this.enteredAt === undefined ? 0 : now - this.enteredAt;
    const rise = ease((dwell - (CHARGE_SECONDS - GLOW_RISE_SECONDS)) / GLOW_RISE_SECONDS);
    const contact = ease(dwell / WALK_GLOW_SECONDS);
    if (standing) {
      // Small overlapping pulses keep the dim engraving alive, then settle at full charge.
      const flicker = 1 + 0.035 * Math.sin(now * 7.3) + 0.015 * Math.sin(now * 17.1);
      const target = 0.5 * flicker * (1 - rise) + rise;
      this.glow = this.entryGlow * (1 - contact) + target * contact;
      this.ringGlow = this.entryRingGlow * (1 - contact) * (1 - rise) + rise;
    } else {
      const fade = this.glowRelease ? 1 - ease((now - this.glowRelease.at) / GLOW_OFF_SECONDS) : 0;
      this.glow = (this.glowRelease?.floor ?? 0) * fade;
      this.ringGlow = (this.glowRelease?.ring ?? 0) * fade;
      if (fade === 0) this.glowRelease = undefined;
    }
    this.ready = this.invokedAt === undefined && dwell >= CHARGE_SECONDS + PRAYER_DELAY_SECONDS;

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
