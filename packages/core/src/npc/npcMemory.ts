import { NPC_LIST } from './dialogueData';

const STORAGE_JOURNAL_KEY = 'portalverse.npc.journal.v1';

export interface NpcJournalSnapshot {
  foundClues: string[];
  metNpcIds: string[];
  totalClues: number;
  hasShuttlePage: boolean;
}

export const SHUTTLE_SECRET_PAGE = Object.freeze({
  title: 'The Shuttle',
  summary: 'You have walked a circle that is not a circle, and everything you carried arrived.',
});

type JournalListener = (snapshot: NpcJournalSnapshot, newlyDiscoveredClueId?: string) => void;

/**
 * Persistent cross-world memory for the Keepers of the Loop.
 * Tracks which dimensional clues the player has uncovered and which Keepers they've met,
 * unlocking cross-world callback dialogue choices and the unwritten 16th journal page.
 */
export class NpcJournalStore {
  private readonly foundClues = new Set<string>();
  private readonly metNpcs = new Set<string>();
  private readonly listeners = new Set<JournalListener>();
  private readonly storageKey: string;

  constructor(storageKey = STORAGE_JOURNAL_KEY) {
    this.storageKey = storageKey;
    this.load();
  }

  getFoundClues(): ReadonlySet<string> {
    return this.foundClues;
  }

  hasClue(clueId: string): boolean {
    return this.foundClues.has(clueId);
  }

  hasMet(npcId: string): boolean {
    return this.metNpcs.has(npcId);
  }

  recordMet(npcId: string): boolean {
    if (this.metNpcs.has(npcId)) return false;
    this.metNpcs.add(npcId);
    this.save();
    this.emit();
    return true;
  }

  discoverClue(clueId: string): boolean {
    if (!clueId || this.foundClues.has(clueId)) return false;
    this.foundClues.add(clueId);
    this.save();
    this.emit(clueId);
    return true;
  }

  getSnapshot(): NpcJournalSnapshot {
    const totalClues = NPC_LIST.length;
    return {
      foundClues: [...this.foundClues],
      metNpcIds: [...this.metNpcs],
      totalClues,
      hasShuttlePage: this.foundClues.size >= totalClues,
    };
  }

  subscribe(listener: JournalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.foundClues.clear();
    this.metNpcs.clear();
    this.save();
    this.emit();
  }

  private emit(newlyDiscoveredClueId?: string): void {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) fn(snap, newlyDiscoveredClueId);
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { foundClues?: unknown; metNpcIds?: unknown };
      if (Array.isArray(parsed.foundClues)) {
        for (const id of parsed.foundClues) {
          if (typeof id === 'string') this.foundClues.add(id);
        }
      }
      if (Array.isArray(parsed.metNpcIds)) {
        for (const id of parsed.metNpcIds) {
          if (typeof id === 'string') this.metNpcs.add(id);
        }
      }
    } catch {
      // Ignore corrupt or unavailable storage
    }
  }

  private save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          foundClues: [...this.foundClues],
          metNpcIds: [...this.metNpcs],
        }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }
}
