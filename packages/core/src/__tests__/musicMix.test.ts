import { describe, expect, it } from 'vitest';
import catalog from '../../../../registry.json';
import type { RegistryFile } from '../types';
import { ROUTE_LENGTH } from '../portal/roomLayout';
import {
  PREVIEW_MAX,
  PREVIEW_RADIUS,
  LOOP_SECONDS,
  PHRASE_SECONDS,
  ROOM_VIBES,
  STEM_IDS,
  gateCloseness,
  loopOffset,
  mixVibes,
  motionMultiplier,
  muffleCutoff,
  phraseMultipliers,
  untilNextPhrase,
  vibeFor,
} from '../audio/musicMix';
import musicAssets from '../audio/musicAssets.json';

const rooms = (catalog as unknown as RegistryFile).worlds.filter(r => r.kind === 'local');

describe('soundtrack mixing', () => {
  it('gives every room in the loop its own vibe', () => {
    for (const room of rooms) expect(ROOM_VIBES[room.id], room.id).toBeDefined();
  });

  it('only names stems that exist, and every stem and the whoosh have files', () => {
    for (const vibe of Object.values(ROOM_VIBES)) {
      for (const id of Object.keys(vibe)) expect(STEM_IDS).toContain(id);
    }
    const assets = musicAssets as Record<string, { webm: string; m4a: string }>;
    for (const id of [...STEM_IDS, 'portal-whoosh']) {
      expect(assets[id]?.webm, id).toMatch(/^https:\/\/.+\.webm$/);
      expect(assets[id]?.m4a, id).toMatch(/^https:\/\/.+\.m4a$/);
    }
  });

  it('keeps each room to itself until a few metres from a gate', () => {
    expect(gateCloseness(PREVIEW_RADIUS)).toBe(0);
    expect(gateCloseness(ROUTE_LENGTH / 2)).toBe(0);
    expect(gateCloseness(0)).toBe(1);
    expect(gateCloseness(3)).toBeGreaterThan(gateCloseness(7));
    const mix = mixVibes(vibeFor('jp-abyss'), vibeFor('laser-lab'), gateCloseness(ROUTE_LENGTH / 4));
    expect(mix['holo-bed'].level).toBe(0);
  });

  it('only hints at the next room, muffled, even at the portal', () => {
    const far = mixVibes(vibeFor('jp-abyss'), vibeFor('eric-sun-observatory'), 0.3);
    expect(far['golden-bed'].level).toBeGreaterThan(0);
    expect(far['golden-bed'].level).toBeLessThan(PREVIEW_MAX);
    expect(far['golden-bed'].muffle).toBeGreaterThan(0.8);
    expect(far['abyss-bed']).toEqual({ level: 1, muffle: 0 });
    const at = mixVibes(vibeFor('jp-abyss'), vibeFor('eric-sun-observatory'), 1);
    expect(at['golden-bed'].level).toBeCloseTo(PREVIEW_MAX);
    expect(at['golden-bed'].muffle).toBeCloseTo(0);
    expect(muffleCutoff(1)).toBeLessThan(muffleCutoff(0));
  });

  it('never doubles a stem both rooms share', () => {
    const mix = mixVibes(vibeFor('jp-world'), vibeFor('jp-garden'), 1);
    expect(mix['golden-bed']).toEqual({ level: 1, muffle: 0 });
  });

  it('keeps beds up every phrase while layers can drop out', () => {
    let i = 0;
    const seq = [0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99];
    const low = phraseMultipliers(() => seq[i++ % seq.length]);
    expect(low['abyss-bed']).toBeGreaterThan(0);
    expect(low['shimmer-bells']).toBe(0);
    expect(motionMultiplier('beat', 0)).toBeLessThan(motionMultiplier('beat', 1));
    expect(motionMultiplier('bed', 0)).toBe(1);
  });

  it('starts loops on the shared grid', () => {
    expect(loopOffset(10, 10)).toBe(0);
    expect(loopOffset(10 + LOOP_SECONDS + 1, 10)).toBeCloseTo(1);
    expect(untilNextPhrase(10 + PHRASE_SECONDS * 2 + 1, 10)).toBeCloseTo(PHRASE_SECONDS - 1);
  });
});
