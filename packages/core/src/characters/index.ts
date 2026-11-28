import { createAdventurerRig } from './adventurer';
import { createMoonMothRig } from './moonMoth';
import { createSkyDrakeRig } from './skyDrake';
import { createSuitBeeRig } from './suitBee';
import type { CharacterDefinition, CharacterRig, CharacterRigOptions } from './types';

export * from './types';
export { createSuitBeeRig } from './suitBee';
export { createSkyDrakeRig } from './skyDrake';
export { createMoonMothRig } from './moonMoth';

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
    backstory:
      'Barnaby Buzz once read a 1934 memo proving that bumblebees can\'t fly, found a rounding error on page two, and filed a correction so politely devastating that physics sent him a fruit basket. He has flown wherever he likes ever since, strictly on schedule, as founder, CEO, and entire staff of Buzz & Associates — Honey Hood\'s premier consultancy for flowers that are "thinking about blooming." He takes the minutes when the beekeeper tells the hive the morning news, and he is the only bee Big Jacket has ever nodded to. His navy suit has no seams anywhere — his tailor swears she "just started and didn\'t stop" — and his crimson tie is exactly one inch short, which he insists is a power move. In his planner, in his own handwriting, sits a standing appointment every Tuesday at 4:00 a.m. that simply reads "don\'t be late." He never has been; so far, he\'s always the first one there.',
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
    backstory:
      'Zephyr hatched from a falling star that missed the ground (by a lot) and was raised by a weather system, which taught it how to ride a jet stream bareback, fold an aurora without wrinkling it, and apologize properly to a thundercloud. It is the only creature known to have outflown a sunrise — a feat it describes as "mostly leaning." Its pearl horns ring like struck crystal whenever it\'s happy, which is always, and wherever it lands smells faintly of somebody else\'s weather for a day. Its grandmother, the Northern Lights, knitted its explorer\'s scarf in every color of dusk, plus one red thread Zephyr never saw go in and one loose end it won\'t let anybody trim. Zephyr has been lost only once, on a Tuesday just before dawn, when the stars came out in the wrong order; it landed an hour before it took off, and it\'s still a little embarrassed about it.',
    accentColor: '#38bdf8',
    labelHeight: 2.18,
    eyeHeight: 1.64,
    traits: ['Sweeping Aurora Wings', 'Sinuous Tail', 'Prism Boost Glow'],
    createRig: (options) => createSkyDrakeRig(options),
  },
  {
    id: 'moon-moth',
    name: 'Velveteen Moonbite',
    title: 'Moon-Biting Gourmand',
    species: 'Velvet Luna Moth',
    tagline: 'Velvet wings, a moon-slice tiara, and a napkin tucked in just in case.',
    description:
      'A velvet luna moth with feathery plume antennae and a glowing crescent tiara. Drapes her wings like an opera cape on foot, then spreads them wide to drift, loop, and dash on trails of shimmering moondust.',
    backstory:
      'Velveteen Moonbite was an ordinary attic moth until the night she decided porch lights were for amateurs and flew at the Moon instead. The trip took eleven years — moths aren\'t supposed to live that long, but she was simply too busy to stop. When she arrived she took one bite, and that, she\'ll tell anyone, is why the Moon has phases: she\'s still working through it, a nibble a night, and it very graciously grows back. She wears that first bite as a glowing tiara and steers by a moon no one else can see. She has given up eating sweaters; her last fabric meal ever was a red ribbon she found floating in midair, which tasted of honey, high wind, and, somehow, four in the morning. She ate exactly the middle and left both ends, on principle — it took her an hour she can\'t remember a second of, and ever since she has been able to taste what day it is. Tuesdays are sweet. She flies in figure-eights around every light she meets ("not a compulsion, darling; it\'s a signature") and keeps a lace napkin tucked under her chin at all times, in case of moon.',
    accentColor: '#d946ef',
    labelHeight: 2.3,
    eyeHeight: 1.56,
    traits: ['Moonbite Dash', 'Figure-Eight Hover', 'Moondust Trail'],
    createRig: (options) => createMoonMothRig(options),
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
