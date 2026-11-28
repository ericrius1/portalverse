import { describe, expect, it } from 'vitest';
import catalog from '../../../../registry.json';
import type { RegistryFile } from '../types';
import {
  BEAT_SECONDS,
  LOOP_SECONDS,
  PHRASE_SECONDS,
  ROOM_VIBES,
  STEM_IDS,
  nextBeat,
  nextPhraseStart,
  stemsFor,
  loopOffset,
  motionMultiplier,
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

  it('gives each room a song of its own stems, loudest first', () => {
    expect(stemsFor(vibeFor('jp-abyss'))).toEqual(['abyss-bed', 'abyss-motif']);
    expect(stemsFor(vibeFor('jp-apartment'))[0]).toBe('lofi-bed');
    expect(stemsFor(vibeFor('unknown-room')).length).toBeGreaterThan(0);
  });

  it('drops the next song on a beat after a short sweep', () => {
    const start = 10;
    const now = start + 3 * BEAT_SECONDS + 0.1;
    const drop = nextBeat(now, start, 0.3);
    expect(drop - now).toBeGreaterThanOrEqual(0.3);
    expect(drop - now).toBeLessThan(0.3 + BEAT_SECONDS + 1e-9);
    const beats = (drop - start) / BEAT_SECONDS;
    expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-9);
    // A song queued to start later still lands on its own first beat.
    expect(nextBeat(5, 10, 0.3)).toBe(10);
  });

  it('finds the next phrase on a song\'s grid', () => {
    expect(nextPhraseStart(10, 10)).toBeCloseTo(10 + PHRASE_SECONDS);
    expect(nextPhraseStart(10 + PHRASE_SECONDS + 1, 10)).toBeCloseTo(10 + 2 * PHRASE_SECONDS);
    expect(nextPhraseStart(5, 10)).toBe(10);
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
