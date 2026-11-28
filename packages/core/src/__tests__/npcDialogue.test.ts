import { describe, expect, it } from 'vitest';
import registryJson from '../../../../registry.json';
import { BUBBLE_PRESET_IDS, sanitizeSpeechBubbleStyle } from '../chat';
import {
  ARCHIVED_VISAGES_WORLD_IDS,
  NPC_BARK_MAX_CHARS,
  NPC_LINE_MAX_CHARS,
  NPC_BY_ID,
  NPC_LIST,
  NPC_SPECS,
  NPC_SPECS_BY_WORLD,
  getNpcByClueId,
  getNpcForWorld,
  getNpcsForWorld,
  visibleChoices,
} from '../npc';

const EXPRESSIONS = new Set([
  'neutral', 'calm', 'smile', 'grin', 'laugh', 'surprise', 'awe', 'worry', 'sad', 'thinking',
  'determined', 'sleepy', 'content', 'shy', 'fond', 'mischief', 'proud',
]);
const GESTURES = new Set(['idle', 'wave', 'explain', 'ponder', 'point', 'bow', 'excited']);
const TONES = new Set(['curious', 'playful', 'lore', 'farewell']);
const HEX = /^#[0-9a-f]{6}$/;

const registryWorldIds = registryJson.worlds.map((w) => w.id);
const registryIndex = new Map(registryWorldIds.map((id, i) => [id, i]));
const registryOwnerById = new Map(registryJson.worlds.map((w) => [w.id, w.owner]));
const ericWorldIds = registryJson.worlds.filter((w) => w.owner === 'ericrius1').map((w) => w.id);

describe('NPC cast', () => {
  it('places every Keeper in one of Eric’s registry worlds, in loop order, with unique ids and clues', () => {
    const npcWorldIds = NPC_LIST.map((n) => n.worldId);
    for (const worldId of npcWorldIds) {
      expect(registryIndex.has(worldId)).toBe(true);
      expect(registryOwnerById.get(worldId)).toBe('ericrius1');
    }
    const indices = npcWorldIds.map((id) => registryIndex.get(id)!);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(NPC_LIST.map((n) => n.id)).size).toBe(NPC_LIST.length);
    expect(new Set(NPC_LIST.map((n) => n.clueId)).size).toBe(NPC_LIST.length);
    for (const npc of NPC_LIST) {
      expect(NPC_BY_ID[npc.id]).toBe(npc);
      expect(getNpcByClueId(npc.clueId)).toBe(npc);
      expect(npc.id).toMatch(/^[a-z]+$/);
    }
  });

  it('mounts multiple Keepers across Eric’s rooms and zero Keepers in non-Eric rooms', () => {
    let totalMounted = 0;
    for (const world of registryJson.worlds) {
      const npcs = getNpcsForWorld(world.id);
      if (world.owner === 'ericrius1') {
        expect(npcs.length, `${world.id} should host multiple Keepers`).toBeGreaterThanOrEqual(2);
        expect(getNpcForWorld(world.id)).toBe(npcs[0]);
        expect(NPC_SPECS[world.id]).toBe(npcs[0]);
        expect(NPC_SPECS_BY_WORLD[world.id]).toBe(npcs);
        totalMounted += npcs.length;
      } else {
        expect(npcs, `${world.id} (owner: ${world.owner}) should have no Keepers`).toHaveLength(0);
        expect(getNpcForWorld(world.id)).toBeUndefined();
        expect(NPC_SPECS[world.id]).toBeUndefined();
      }
    }
    expect(totalMounted).toBe(NPC_LIST.length);
    expect(Object.keys(NPC_SPECS_BY_WORLD).sort()).toEqual([...ericWorldIds].sort());
    for (const worldId of ARCHIVED_VISAGES_WORLD_IDS) {
      expect(getNpcsForWorld(worldId)).toHaveLength(0);
    }
    // Starlight Pavilion mounts Soraya, Dex & Ermelin live on stage, so its promenade Keepers never duplicate them
    const pavilionIds = new Set(getNpcsForWorld('eric-starlight-pavilion').map((n) => n.id));
    expect(pavilionIds.has('soraya')).toBe(false);
    expect(pavilionIds.has('dex')).toBe(false);
    expect(pavilionIds.has('ermelin')).toBe(false);
  });

  it('keeps specs within art and bubble limits', () => {
    for (const npc of NPC_LIST) {
      expect(npc.accentColor).toMatch(HEX);
      expect(npc.heightMeters).toBeGreaterThanOrEqual(1.45);
      expect(npc.heightMeters).toBeLessThanOrEqual(2.15);
      expect(npc.ambientBarks).toHaveLength(3);
      for (const bark of npc.ambientBarks) expect(bark.length, `${npc.id}: ${bark}`).toBeLessThanOrEqual(NPC_BARK_MAX_CHARS);
      expect(npc.clueSummary.length).toBeGreaterThan(0);
      // The style survives the same sanitizer remote bubble styles go through, unchanged.
      expect(sanitizeSpeechBubbleStyle(npc.bubbleStyle, npc.accentColor)).toEqual(npc.bubbleStyle);
    }
  });

  it('uses all eight bubble presets, with no two NPCs sharing an identical bubble', () => {
    expect(new Set(NPC_LIST.map((n) => n.bubbleStyle.preset))).toEqual(new Set(BUBBLE_PRESET_IDS));
    const looks = NPC_LIST.map((n) => JSON.stringify(n.bubbleStyle));
    expect(new Set(looks).size).toBe(NPC_LIST.length);
  });
});

describe('NPC dialogue trees', () => {
  const clueIds = new Set(NPC_LIST.map((n) => n.clueId));

  it.each(NPC_LIST.map((n) => [n.id, n] as const))('%s has a well-formed tree', (_id, npc) => {
    const ids = Object.keys(npc.nodes);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(ids.length).toBeLessThanOrEqual(8);
    expect(npc.nodes[npc.entryNodeId]).toBeDefined();
    expect(Object.values(npc.nodes).filter((n) => n.grantsClue)).toHaveLength(1);

    for (const [key, node] of Object.entries(npc.nodes)) {
      expect(node.id).toBe(key);
      expect(node.text.length, `${npc.id}.${key}`).toBeLessThanOrEqual(NPC_LINE_MAX_CHARS);
      expect(EXPRESSIONS.has(node.expr), `${npc.id}.${key} expr ${node.expr}`).toBe(true);
      if (node.gesture) expect(GESTURES.has(node.gesture)).toBe(true);
      expect(node.choices.length).toBeGreaterThanOrEqual(2);
      expect(node.choices.length).toBeLessThanOrEqual(3);
      // A node must stay escapable before any callback is unlocked.
      expect(visibleChoices(node, new Set()).length).toBeGreaterThanOrEqual(1);
      for (const choice of node.choices) {
        if (choice.nextNodeId !== null) expect(npc.nodes[choice.nextNodeId], `${npc.id}.${key} -> ${choice.nextNodeId}`).toBeDefined();
        if (choice.tone) expect(TONES.has(choice.tone)).toBe(true);
        if (choice.requiresClue) {
          expect(clueIds.has(choice.requiresClue)).toBe(true);
          expect(choice.requiresClue).not.toBe(npc.clueId);
        }
      }
    }

    // Every node is reachable from the entry once all clues are known, and the clue node is reachable without any.
    const reach = (known: ReadonlySet<string>) => {
      const seen = new Set<string>([npc.entryNodeId]);
      const queue = [npc.entryNodeId];
      while (queue.length) {
        for (const c of visibleChoices(npc.nodes[queue.shift()!], known)) {
          if (c.nextNodeId && !seen.has(c.nextNodeId)) {
            seen.add(c.nextNodeId);
            queue.push(c.nextNodeId);
          }
        }
      }
      return seen;
    };
    expect(reach(clueIds).size).toBe(ids.length);
    const clueNode = Object.values(npc.nodes).find((n) => n.grantsClue)!;
    expect(reach(new Set()).has(clueNode.id)).toBe(true);
    // The conversation can always end.
    expect(Object.values(npc.nodes).some((n) => n.choices.some((c) => c.nextNodeId === null))).toBe(true);
  });

  it('gives at least ten NPCs a cross-world callback', () => {
    const withCallback = NPC_LIST.filter((n) =>
      Object.values(n.nodes).some((node) => node.choices.some((c) => c.requiresClue)),
    );
    expect(withCallback.length).toBeGreaterThanOrEqual(10);
  });
});
