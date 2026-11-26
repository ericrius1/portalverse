import { describe, expect, it } from 'vitest';
import catalog from '../../../../registry.json';
import type { RegistryFile } from '../types';
import { ROUTE_LENGTH } from '../portal/roomLayout';
import {
  APPROACH_RADIUS,
  LOOP_SECONDS,
  PHRASE_SECONDS,
  ROOM_VIBES,
  STEM_IDS,
  approachBlend,
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

  it('blends half and half at a gate, and nothing from the far room mid-room', () => {
    expect(approachBlend(0)).toBeCloseTo(0.5);
    expect(approachBlend(APPROACH_RADIUS)).toBe(0);
    expect(approachBlend(ROUTE_LENGTH / 2)).toBeLessThan(0.05);
    expect(approachBlend(10)).toBeGreaterThan(approachBlend(20));
  });

  it('is continuous across a crossing: the mix at one gate mirrors the mix at the other', () => {
    const a = vibeFor('jp-abyss');
    const b = vibeFor('laser-lab');
    const before = mixVibes(a, b, approachBlend(0));
    const after = mixVibes(b, a, approachBlend(0));
    for (const id of STEM_IDS) {
      expect(after[id].level).toBeCloseTo(before[id].level);
      expect(before[id].muffle).toBeCloseTo(0);
    }
  });

  it('muffles stems that only the distant neighbour plays', () => {
    const mix = mixVibes(vibeFor('jp-abyss'), vibeFor('eric-sun-observatory'), 0.1);
    expect(mix['golden-bed'].level).toBeGreaterThan(0);
    expect(mix['golden-bed'].muffle).toBeGreaterThan(0.5);
    expect(mix['abyss-bed'].muffle).toBe(0);
    expect(muffleCutoff(1)).toBeLessThan(muffleCutoff(0));
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
