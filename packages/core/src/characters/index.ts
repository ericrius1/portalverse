import { createAdventurerRig } from './adventurer';
import { createSkyDrakeRig } from './skyDrake';
import { createSuitBeeRig } from './suitBee';
import type { CharacterDefinition, CharacterRig, CharacterRigOptions } from './types';

export * from './types';
export { createSuitBeeRig } from './suitBee';
export { createSkyDrakeRig } from './skyDrake';

export * from './appearance';
export { skinColor } from './skinTone';

// Stable fallback for legacy network peers; app startup uses chooseStartupCharacter.
export const DEFAULT_CHARACTER_ID = 'suit-bee';

/** A saved explicit choice wins; otherwise both adventurers have equal probability. */
export function chooseStartupCharacter(savedId?: string | null, random = Math.random): string {
  return isValidCharacterId(savedId) ? savedId : random() < 0.5 ? 'adventurer-man' : 'adventurer-woman';
}

/**
 * Playable character roster. Add new characters here and they automatically
 * appear in the Character Select screen, multiplayer sync, and portal transit.
 */
export const CHARACTERS: readonly CharacterDefinition[] = [
  ...(['man', 'woman'] as const).map((variant): CharacterDefinition => ({
    id: `adventurer-${variant}`,
    name: variant === 'man' ? 'Adventurer · Man' : 'Adventurer · Woman',
    title: 'Trail Explorer',
    species: 'Human',
    tagline: 'Ready for the next portal, on foot or in flight.',
    description: 'A traveling adventurer by Quaternius. Choose your skin tone and undertone, then explore at your own pace.',
    accentColor: variant === 'man' ? '#86b889' : '#d5ac72',
    labelHeight: 2.12,
    eyeHeight: 1.62,
    supportsSkinTone: true,
    thirdPersonMovement: 'adventure',
    defaultMovementMode: 'platformer',
    traits: ['Animated Stride', 'Soaring Flight', 'Custom Skin Tone'],
    createRig: (options) => createAdventurerRig(variant, options),
  })),
  {
    id: 'suit-bee',
    name: 'Barnaby Buzz',
    title: 'Executive Bumblebee',
    species: 'Honey Hood Bee',
    tagline: 'Sharp navy suit, crimson power tie, turbo-charged wings.',
    description:
      'Straight from Honey Hood in tailored navy wool and a fluttering red tie. Strides briskly on foot and takes to the sky with shimmering iridescent wingbeats.',
    accentColor: '#ffc21a',
    labelHeight: 2.15,
    eyeHeight: 1.62,
    traits: ['Bipedal Stride', 'Turbo Wing Buzz', 'Dapper Tie Physics'],
    createRig: () => createSuitBeeRig(),
  },
  {
    id: 'sky-drake',
    name: 'Zephyr',
    title: 'Prism Sky Drake',
    species: 'Celestial Wyvern',
    tagline: 'Bioluminescent aurora wings, pearl horns, and a starry tail.',
    description:
      'An agile celestial sky drake clad in iridescent twilight scales and a woven sky-explorer scarf. Folds its aurora wings into a sleek mantle on foot and unfurls them wide to soar.',
    accentColor: '#38bdf8',
    labelHeight: 2.18,
    eyeHeight: 1.64,
    traits: ['Sweeping Aurora Wings', 'Sinuous Tail', 'Prism Boost Glow'],
    createRig: (options) => createSkyDrakeRig(options),
  },
];

const CHARACTER_MAP = new Map<string, CharacterDefinition>(CHARACTERS.map((c) => [c.id, c]));

export function isValidCharacterId(id: unknown): id is string {
  return typeof id === 'string' && CHARACTER_MAP.has(id);
}

export function getCharacterDefinition(id?: string): CharacterDefinition {
  if (id) {
    const found = CHARACTER_MAP.get(id);
    if (found) return found;
  }
  return CHARACTER_MAP.get(DEFAULT_CHARACTER_ID) ?? CHARACTERS[0];
}

export function createCharacterRig(
  id?: string,
  options?: CharacterRigOptions,
): CharacterRig {
  return getCharacterDefinition(id).createRig(options);
}
