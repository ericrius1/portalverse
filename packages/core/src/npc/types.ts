import type { SpeechBubbleStyle, Vec3Tuple } from '../types';

/**
 * Facial expressions an NPC can hold while a line is spoken. Every name is an
 * expression in `@ericrius1/cast`'s `EXPRESSIONS` table, so a node's `expr`
 * can go straight to the rig's face (`face.mood` / a passing expression).
 */
export type NpcExpression =
  | 'neutral'
  | 'calm'
  | 'smile'
  | 'grin'
  | 'laugh'
  | 'surprise'
  | 'awe'
  | 'worry'
  | 'sad'
  | 'thinking'
  | 'determined'
  | 'sleepy'
  | 'content'
  | 'shy'
  | 'fond'
  | 'mischief'
  | 'proud';

/** Body gesture played with a line. `idle` (or none) keeps the ambient loop. */
export type NpcGesture = 'idle' | 'wave' | 'explain' | 'ponder' | 'point' | 'bow' | 'excited';

/** How a player choice reads in the dialogue panel (icon / colour hint). */
export type NpcChoiceTone = 'curious' | 'playful' | 'lore' | 'farewell';

export interface NpcDialogueChoice {
  /** What the player says. */
  text: string;
  /** Node this choice leads to; `null` ends the conversation. */
  nextNodeId: string | null;
  tone?: NpcChoiceTone;
  /**
   * Only offered once the player has found this clue (another NPC's `clueId`).
   * These are the cross-world callbacks that let the rooms talk to each other.
   */
  requiresClue?: string;
}

export interface NpcDialogueNode {
  id: string;
  /** The NPC's line: 1–3 sentences, at most `NPC_LINE_MAX_CHARS`. */
  text: string;
  expr: NpcExpression;
  gesture?: NpcGesture;
  /** Reaching this node records the NPC's clue in the player's journal. */
  grantsClue?: boolean;
  /** 2–3 player choices. */
  choices: readonly NpcDialogueChoice[];
}

/** Optional room-local stand point. When absent, the room or engine picks a spot beside the path. */
export interface NpcPlacement {
  position: Vec3Tuple;
  /** Facing angle in radians around Y (0 = facing -Z), as in `SpawnPoint`. */
  yaw: number;
}

export interface NpcSpec {
  /** Clean slug, unique across the cast (e.g. `kestrel`). */
  id: string;
  /** Home world id from `registry.json`. */
  worldId: string;
  name: string;
  title: string;
  species: string;
  role: string;
  /** Character accent, `#rrggbb`. */
  accentColor: string;
  /** Standing height in metres (1.45–2.15). */
  heightMeters: number;
  bubbleStyle: SpeechBubbleStyle;
  /** Lines that pop up in the 3D bubble as a player walks near, before dialogue opens (each at most `NPC_BARK_MAX_CHARS`). */
  ambientBarks: readonly [string, string, string];
  /** Unique key of the higher-dimensional thread this NPC reveals. */
  clueId: string;
  /** Short poetic journal title for the clue. */
  clueTitle: string;
  /** One-sentence note written in the journal when the clue is found. */
  clueSummary: string;
  entryNodeId: string;
  nodes: Readonly<Record<string, NpcDialogueNode>>;
  placement?: NpcPlacement;
}

/** Longest line that still fits a 3D speech bubble and the dialogue panel. */
export const NPC_LINE_MAX_CHARS = 240;
/** Longest ambient bark. */
export const NPC_BARK_MAX_CHARS = 80;
