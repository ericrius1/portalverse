/**
 * The Portalverse NPC cast: one keeper per portal world, each holding one
 * thread of the same quiet mystery (see `docs/npc-bible.md`).
 *
 * Pure data, no DOM or engine imports, so it runs under `tsc --noEmit` and
 * Vitest as-is. `__tests__/npcDialogue.test.ts` checks the graph: every
 * `nextNodeId` exists, every `requiresClue` names another NPC's clue, lines fit
 * their bubbles, and the cast uses all eight bubble presets.
 */
import type { NpcDialogueNode, NpcSpec } from './types';

/** Builds a node table from `{ nodeId: node-without-id }` so keys and ids can't drift apart. */
function nodes(defs: Record<string, Omit<NpcDialogueNode, 'id'>>): Record<string, NpcDialogueNode> {
  const out: Record<string, NpcDialogueNode> = {};
  for (const [id, def] of Object.entries(defs)) out[id] = { id, ...def };
  return out;
}

// ─── 1 · JP's Solarpunk Meadow ──────────────────────────────────────────────

const SOLENNE: NpcSpec = {
  id: 'solenne',
  worldId: 'eric-palace-lagoon',
  name: 'Solenne',
  title: 'Keeper of the Brass Arches',
  species: 'Human (solarpunk heliotrope tinker)',
  role: 'Tunes the brass solar arches so the meadow drinks its light, and reads the wildflowers like weather.',
  accentColor: '#79a756',
  heightMeters: 1.84,
  bubbleStyle: {
    preset: 'glass',
    bgColor: '#fbf6dc',
    accentColor: '#79a756',
    textColor: '#2f3a1c',
    tail: 'curved',
    font: 'serif',
    effect: 'shimmer',
    badge: '☀',
  },
  ambientBarks: [
    "Wind's from the southwest. The arches will sing by noon.",
    'Polish the brass with your sleeve as you pass. They like it.',
    'Every flower here follows the sun. Well. A sun.',
  ],
  clueId: 'clue_second_sun',
  clueTitle: 'The Flowers Face Elsewhere',
  clueSummary:
    "Solenne's oldest sunflowers have turned, all together on one beat, toward a warmth that comes from no direction in the sky.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Morning, traveler. It's always morning here, so I'm never wrong. I'm Solenne. I keep the brass arches tuned so the meadow drinks its light properly.",
      expr: 'smile',
      gesture: 'wave',
      choices: [
        { text: 'Tuned? Like instruments?', nextNodeId: 'arches', tone: 'curious' },
        { text: 'How long have you kept them?', nextNodeId: 'self', tone: 'curious' },
        { text: "Lovely meadow. I'll walk on.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: 'Forty-one summers. I built the first arch from a broken telescope and a bicycle wheel. The rest grew out of stubbornness and good neighbors.',
      expr: 'proud',
      gesture: 'explain',
      choices: [
        { text: 'You must know this meadow by heart.', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the arches.', nextNodeId: 'arches', tone: 'curious' },
      ],
    },
    arches: {
      text: "Each arch catches light and hums when the wind goes through it. In tune, they make the wildflowers grow toward the music as much as the sun. Plants are better listeners than people.",
      expr: 'content',
      gesture: 'explain',
      choices: [
        { text: 'Are they in tune now?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'And who tunes you?', nextNodeId: 'self', tone: 'playful' },
      ],
    },
    odd: {
      text: 'Mostly. But for a season now, the oldest sunflowers have turned their faces away from the sun. Not wilting. Tracking. Something low in the sky that only they can see.',
      expr: 'worry',
      gesture: 'ponder',
      choices: [
        { text: 'Where are they pointing?', nextNodeId: 'clue', tone: 'lore' },
        { text: "Maybe they're just tired.", nextNodeId: 'tired', tone: 'playful' },
      ],
    },
    tired: {
      text: "Ha! I thought so too. So I watched. They turn together, all at once, on the same beat, like a congregation standing up. Tired things don't keep time, love.",
      expr: 'mischief',
      gesture: 'explain',
      choices: [
        { text: 'Show me where they point.', nextNodeId: 'clue', tone: 'lore' },
        { text: "Let's talk about something else.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    clue: {
      text: "Stand behind that one and sight along its face, through the arch. Nothing, yes? Now close one eye. There's warmth on your cheek from a direction your other eye doesn't believe in.",
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'A beekeeper says his bees dance toward that warmth too.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_waggle_dance',
        },
        { text: "I felt it. I'll remember.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "Bees, too? Then it's no fancy of an old woman. Bees and sunflowers have argued about the sun since before we had words. If they agree on a second one, I'll believe them.",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: 'Show me the warmth again.', nextNodeId: 'clue', tone: 'lore' },
        { text: "I'll tell the bees you said hello.", nextNodeId: 'bye', tone: 'playful' },
      ],
    },
    bye: {
      text: 'Off with you, then. Walk in the light, whichever one finds you first.',
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'Until the next morning.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing, Solenne.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 3 · Breezy Plant Garden ────────────────────────────────────────────────

const FEN: NpcSpec = {
  id: 'fen',
  worldId: 'eric-biolum-grove',
  name: 'Fen',
  title: 'the Breeze Between Leaves',
  species: 'Leaf-woven breeze spirit',
  role: 'Sways the giant flat-coloured leaves so they stay supple, and carries the garden gossip.',
  accentColor: '#f08a9b',
  heightMeters: 1.52,
  bubbleStyle: {
    preset: 'comic',
    bgColor: '#fff6dc',
    accentColor: '#f08a9b',
    textColor: '#2b2320',
    tail: 'curved',
    font: 'comic',
    effect: 'sparkle',
    badge: '🌿',
  },
  ambientBarks: [
    "Whoosh! Sorry. That was me. I'm the breeze. Hi!",
    'Monstera says you have nice shoes.',
    'Sniff that? No? It smells like somewhere else today.',
  ],
  clueId: 'clue_wind_from_nowhere',
  clueTitle: 'A Breeze With No Compass Point',
  clueSummary:
    'Fen, the garden breeze, now blows in from a direction that is neither north nor south nor anything, smelling of salt and pine.',
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Hi! Hello! You walked in on the downbeat, that's good manners. I'm Fen. I'm the breeze here. Well, a breeze. The big leaves need someone to sway them.",
      expr: 'grin',
      gesture: 'excited',
      choices: [
        { text: "You're the wind?", nextNodeId: 'self', tone: 'curious' },
        { text: 'Why do the leaves need swaying?', nextNodeId: 'place', tone: 'curious' },
        { text: 'Bye, Fen!', nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: "I'm a lot of leaves that decided to hold hands and go somewhere. When I stop moving, I'm just a pile. So I don't stop! Mostly I go in circles. Circles are underrated.",
      expr: 'laugh',
      gesture: 'excited',
      choices: [
        { text: 'Where does the breeze come from?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'What do the plants think of you?', nextNodeId: 'place', tone: 'playful' },
      ],
    },
    place: {
      text: "Big leaves go stiff if nobody sways them. Banana leaf is ticklish, bromeliads are grumpy, monstera's the gossip. They tell me everything. Today they told me about you!",
      expr: 'mischief',
      gesture: 'point',
      choices: [
        { text: 'What did they say?', nextNodeId: 'gossip', tone: 'playful' },
        { text: 'Something seems different today.', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    gossip: {
      text: "That you smell like portals. Ozone, and a little bit of someone else's weather. Don't worry, everyone who walks the loop does. You pick up passengers.",
      expr: 'fond',
      gesture: 'ponder',
      choices: [
        { text: 'Passengers?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: "Here's the thing. I'm the breeze, so I should know where I come from. But lately I blow in from a direction that isn't north or south or anything. And I smell like salt. And pine.",
      expr: 'worry',
      gesture: 'ponder',
      choices: [
        { text: "A direction that isn't anywhere?", nextNodeId: 'clue', tone: 'lore' },
        { text: "Maybe you're dizzy from all the circles.", nextNodeId: 'self', tone: 'playful' },
      ],
    },
    clue: {
      text: "Lean into me. Close your eyes. Feel that? I'm pushing you toward a place you can't step to, like the garden has a back door that's also every wall. I don't like that I fit through it.",
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'Someone in a night loft smells pine and honey through a sealed window.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_draft_pine_honey',
        },
        { text: "I'll follow your direction. Carefully.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "Through a closed window? Ohhh. That was me! Or a me. If I'm blowing through her loft and the snow and the honey trees all at once, I'm not a breeze. I'm a draft. Some door is open.",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: 'Whose door, Fen?', nextNodeId: 'clue', tone: 'lore' },
        { text: "Keep blowing. I'll find out.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: "Bye! Whoosh! If you smell salt where there's no sea, that's me saying hi. Or somebody saying hi through me. Either way, wave back!",
      expr: 'grin',
      gesture: 'wave',
      choices: [
        { text: 'Whoosh to you too.', nextNodeId: null, tone: 'farewell' },
        { text: 'Wait, one more question.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 4 · Kāneʻohe Fishpond ──────────────────────────────────────────────────

const KEOLA: NpcSpec = {
  id: 'keola',
  worldId: 'eric-palace-lagoon',
  name: 'Uncle Keola',
  title: 'Kiaʻi Loko, Fishpond Caretaker',
  species: 'Human (Native Hawaiian kupuna)',
  role: 'Helps care for the loko iʻa: resets kuapā stones, minds the mākāhā, counts fish, and welcomes volunteers.',
  accentColor: '#14b8a6',
  heightMeters: 1.76,
  bubbleStyle: {
    preset: 'glass',
    bgColor: '#e8fbf7',
    accentColor: '#14b8a6',
    textColor: '#0f3b36',
    tail: 'curved',
    font: 'sans',
    effect: 'none',
    badge: '🐟',
  },
  ambientBarks: [
    'Aloha. Go slow on the kuapā, the basalt gets slippery.',
    "Tide's turning. The mākāhā is breathing in.",
    'Found another thing in the gate today. Not from here, this one.',
  ],
  clueId: 'clue_makaha_tide',
  clueTitle: 'What the Mākāhā Lets In',
  clueSummary:
    "Uncle Keola's mākāhā has begun letting in things from no ocean he knows: a warm brass cog, a snowflake that will not melt, a cassette.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Aloha, welcome. I'm Keola, most people call me Uncle. I help look after this loko iʻa, this fishpond. You're welcome to walk the wall. Just go slow and leave the stones how you found them.",
      expr: 'smile',
      gesture: 'wave',
      choices: [
        { text: 'How old is this fishpond?', nextNodeId: 'place', tone: 'curious' },
        { text: 'What do you do here, Uncle?', nextNodeId: 'self', tone: 'curious' },
        { text: "Mahalo. I'll keep walking.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    place: {
      text: "Kūpuna built this kuapā by hand, stone by stone, centuries ago. No mortar, just knowing how water moves. We're still learning what they knew. Every stretch we rebuild teaches us something.",
      expr: 'proud',
      gesture: 'explain',
      choices: [
        { text: 'How does the pond work?', nextNodeId: 'makaha', tone: 'curious' },
        { text: 'Who helps you keep it?', nextNodeId: 'self', tone: 'curious' },
      ],
    },
    self: {
      text: 'Me and whoever shows up. Families, school kids, aunties with lunch. We pull mangrove, reset fallen stones, count the fish. Mālama ʻāina: you take care of the land, the land takes care of you.',
      expr: 'content',
      gesture: 'explain',
      choices: [
        { text: 'Tell me about the gate in the wall.', nextNodeId: 'makaha', tone: 'curious' },
        { text: 'Anything unusual lately?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    makaha: {
      text: "That's the mākāhā, the sluice gate. Young fish swim in through the grate with the tide, eat well on the limu, and grow too big to swim back out. Smart, yeah? The ocean does the work.",
      expr: 'grin',
      gesture: 'point',
      choices: [
        { text: 'What else comes in with the tide?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Clever. Tell me about you.', nextNodeId: 'self', tone: 'playful' },
      ],
    },
    odd: {
      text: "Mostly just ocean. But lately the tide brings things from no ocean I know. A brass cog, still warm. A snowflake that won't melt in my hand. A little plastic box with tape inside.",
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'Where do you think they come from?', nextNodeId: 'clue', tone: 'lore' },
        { text: "Let's talk about something else.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    clue: {
      text: "Watch the water right at the grate when the tide turns. See how it pulls in from more directions than the ocean has? I don't have a word for it yet. So I do what kūpuna did. I watch, and I count what arrives.",
      expr: 'calm',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'Stones are falling into a fog chasm and never landing.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_falling_stones',
        },
        { text: "I'll watch the gate with you a while.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: 'Ae, I found one last week. Dark, cut in funny facets, glowing teal at the edges. I set it in the wall where a stone was missing. It fits better than it should, like it was cut for that spot.',
      expr: 'surprise',
      gesture: 'explain',
      choices: [
        { text: 'Maybe it was.', nextNodeId: 'bye', tone: 'lore' },
        { text: 'Show me the gate again.', nextNodeId: 'clue', tone: 'curious' },
      ],
    },
    bye: {
      text: 'A hui hou, until we meet again. If the tide brings you back this way, come help reset a stone. Many hands make light work.',
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'A hui hou, Uncle.', nextNodeId: null, tone: 'farewell' },
        { text: 'Wait, one more thing.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 5 · Coral Reef Walk ────────────────────────────────────────────────────

const NORI: NpcSpec = {
  id: 'nori',
  worldId: 'eric-palace-lagoon',
  name: 'Nori',
  title: 'Current-Reader of the Reef',
  species: 'Tidefolk (sea-person)',
  role: 'Reads and knots the reef currents into string maps, and keeps an ear to the coral.',
  accentColor: '#22b8cf',
  heightMeters: 1.58,
  bubbleStyle: {
    preset: 'thought',
    bgColor: '#e0f7fb',
    accentColor: '#22b8cf',
    textColor: '#0b3a45',
    tail: 'dots',
    font: 'sans',
    effect: 'shimmer',
    badge: '🫧',
  },
  ambientBarks: [
    "Shh. The current's telling a long story today.",
    'Mind the turtle. She has right of way, always.',
    'Put your hand on the coral. Gently. Can you hear it?',
  ],
  clueId: 'clue_coral_song',
  clueTitle: 'Grooves in the Coral',
  clueSummary:
    "Nori says the brain coral's grooves play one low, patient note, carried in by a current that rises from beneath the sand.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Oh, a dry-lander, walking the sea floor like it's a street! I'm Nori. I read the currents and draw maps nobody else can use. Mind your bubbles, they tickle the jellies.",
      expr: 'smile',
      gesture: 'wave',
      choices: [
        { text: 'Maps of the currents?', nextNodeId: 'self', tone: 'curious' },
        { text: 'This reef is beautiful.', nextNodeId: 'place', tone: 'curious' },
        { text: 'Sorry to bother you.', nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: "Tidefolk don't swim so much as get carried well. I tie a knot in this string for each current: warm, cold, lazy, liar. A good map is mostly knots and patience.",
      expr: 'content',
      gesture: 'explain',
      choices: [
        { text: "What's a liar current?", nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the reef.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: "The canyon's a cathedral if you look up. The manta comes through when the light changes, the turtle naps by the third arch, and the coral grows a fingernail a year, building a city.",
      expr: 'fond',
      gesture: 'point',
      choices: [
        { text: 'Who is the turtle?', nextNodeId: 'turtle', tone: 'playful' },
        { text: 'Does the coral do anything else?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    turtle: {
      text: "Old Slowpaddle. Older than my grandmother's maps. She goes up, breathes, and comes back down looking like she's seen something funny up there. She never says what.",
      expr: 'grin',
      gesture: 'ponder',
      choices: [
        { text: 'Back to the coral.', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: "A liar current flows one way and arrives from another. There's one here that comes up through the canyon floor, from below the sand, where there isn't any below. And it hums.",
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'What does it hum?', nextNodeId: 'clue', tone: 'lore' },
        { text: "Currents can't lie.", nextNodeId: 'self', tone: 'playful' },
      ],
    },
    clue: {
      text: "Put your ear to the brain coral. The grooves are like a record, see? The current plays them. Always one note, low and patient, eighty-eight times a minute. It isn't a reef song.",
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'A tea-stall keeper says the rain falls in that same note.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_resonance_gsharp',
        },
        { text: "I hear it. I'll remember it.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "Rain? Above the water? Then the note isn't in the coral. The coral just catches it, the way a shell catches the sea. Something big is humming, and everything with grooves is listening.",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: 'Play me the coral again.', nextNodeId: 'clue', tone: 'lore' },
        { text: "Then I'll listen everywhere.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: "Swim easy. Well, walk easy. If you hear one note under every other sound, don't panic. That's just the world tuning itself.",
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'Thank you, Nori.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more question.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 6 · Apartment ─────────────────────────────────────────────────────────

const JUNO: NpcSpec = {
  id: 'juno',
  worldId: 'eric-sun-observatory',
  name: 'Juno Park',
  title: 'Night-Shift Translator',
  species: 'Human (urban dreamer), with Mandu the shiba',
  role: 'Subtitles shows nobody has seen yet at three in the morning, makes up stories for the city windows, and keeps the barley tea warm.',
  accentColor: '#f4a259',
  heightMeters: 1.66,
  bubbleStyle: {
    preset: 'thought',
    bgColor: '#2b1d14',
    accentColor: '#f4a259',
    textColor: '#fde7cc',
    tail: 'dots',
    font: 'serif',
    effect: 'glow',
    badge: '☕',
  },
  ambientBarks: [
    "Shh, Mandu's asleep. Ish. One ear is awake.",
    "There's tea in the pot if you want some. It's barley.",
    "Another night, another window that won't stay closed.",
  ],
  clueId: 'clue_draft_pine_honey',
  clueTitle: 'A Draft Through a Closed Window',
  clueSummary:
    "A sealed window in Juno's loft breathes a cold, sweet draft of pine and honey, and Mandu barks before anyone comes through the portal.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Oh, hi. Sorry, I'm in socks. Welcome to the loft. I'm Juno. I translate subtitles for shows nobody's seen yet, mostly at three a.m. That's Mandu. He's judging you lovingly.",
      expr: 'shy',
      gesture: 'wave',
      choices: [
        { text: 'Hi, Mandu!', nextNodeId: 'mandu', tone: 'playful' },
        { text: 'Why work at night?', nextNodeId: 'self', tone: 'curious' },
        { text: "I'll leave you to it.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    mandu: {
      text: "He's a shiba, so he's either asleep or deeply concerned. Lately, concerned. He barks at the big window a few seconds before anyone comes through the portal. Every time. Before.",
      expr: 'thinking',
      gesture: 'point',
      choices: [
        { text: 'Before? How does he know?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Who's a good boy?", nextNodeId: 'self', tone: 'playful' },
      ],
    },
    self: {
      text: "The city's quiet enough at night to hear what words mean underneath. Translating is mostly listening for the shape of a thing before you name it. Daytime is too loud for that.",
      expr: 'content',
      gesture: 'explain',
      choices: [
        { text: "What's the city like from up here?", nextNodeId: 'place', tone: 'curious' },
        { text: 'Is anything strange about this loft?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    place: {
      text: 'Every window out there is a little life. I make up stories for them. Third tower, fifth floor, that light blinks slow, like a heartbeat. I timed it once. Same tempo as the music in my headphones.',
      expr: 'calm',
      gesture: 'point',
      choices: [
        { text: "Tell me about the window that won't close.", nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: "The big window's latched. Sealed. I checked. But there's a draft, cold and sweet, like pine needles and warm honey. Mandu lies in it with his nose up like it's a radio.",
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'Where could it come from?', nextNodeId: 'clue', tone: 'lore' },
        { text: "A neighbor's candle, maybe?", nextNodeId: 'mandu', tone: 'playful' },
      ],
    },
    clue: {
      text: "Hold your hand here. Feel that? It isn't coming through the glass. It's coming through the room, like the air is a curtain and someone behind it is breathing out a forest.",
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'A lantern warden says her snow sometimes falls upward.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_upward_snow',
        },
        { text: "I'll keep your window in mind.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: 'Upward? Oh. Last night there was frost on the inside of the glass, little ferns of it, growing toward the ceiling. I thought I was tired. Mandu licked it. He looked homesick for somewhere he has never been.',
      expr: 'surprise',
      gesture: 'explain',
      choices: [
        { text: 'Poor Mandu.', nextNodeId: 'mandu', tone: 'playful' },
        { text: "I'll follow the draft.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: "Get home safe, wherever that is for you. If you smell pine where there are no trees, say hi to whoever's breathing. Mandu, say bye.",
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'Goodnight, Juno. Goodnight, Mandu.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 7 · Abyss ──────────────────────────────────────────────

const CAIRN: NpcSpec = {
  id: 'cairn',
  worldId: 'eric-biolum-grove',
  name: 'Cairn',
  title: 'Abbot of the Stepping Stones',
  species: 'Voronoi stone construct (folkloric guardian)',
  role: 'Floats beside the path and keeps the stepping stones from forgetting where they float.',
  accentColor: '#3ff2c8',
  heightMeters: 2.1,
  bubbleStyle: {
    preset: 'cyber',
    bgColor: '#06201b',
    accentColor: '#3ff2c8',
    textColor: '#d1fff2',
    tail: 'none',
    font: 'mono',
    effect: 'pulse',
    badge: '◈',
  },
  ambientBarks: [
    'Step where the light is. Stone remembers feet.',
    'The fog is not deep. It is folded.',
    'Breathe. Then step. In that order.',
  ],
  clueId: 'clue_falling_stones',
  clueTitle: "What Falls Doesn't Land Here",
  clueSummary:
    'Stones that fall into the abyss make no sound; Cairn says the fog folds them through to somewhere else.',
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: 'Walker. You cross well. I am called Cairn. I keep the stones from forgetting where they float. Speak, if you wish. I have time. I am mostly time.',
      expr: 'calm',
      gesture: 'bow',
      choices: [
        { text: 'What are you made of?', nextNodeId: 'self', tone: 'curious' },
        { text: "What's below the stones?", nextNodeId: 'place', tone: 'curious' },
        { text: "I'll keep crossing.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: 'Stones that broke the same way, and agreed to stay near. The teal light is the agreement. When it loosens, I lose a finger. I have lost eleven. Each grew back slower.',
      expr: 'calm',
      gesture: 'explain',
      choices: [
        { text: 'Where do the lost pieces go?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the chasm.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: 'Fog, and needles of rock, and the old path the stones remember. Pilgrims once crossed here reading runes. Now only you, and the wind, and sometimes a seabird who should not be this high.',
      expr: 'thinking',
      gesture: 'point',
      choices: [
        { text: 'The runes. What do they say?', nextNodeId: 'runes', tone: 'curious' },
        { text: 'Where do falling stones go?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    runes: {
      text: "Each says one word: 'here'. Here, here, here, all the way across. A path is only a list of heres. The pilgrims believed that if you read every one, you would arrive somewhere not on the list.",
      expr: 'calm',
      gesture: 'explain',
      choices: [
        { text: 'And did they?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: 'A stone that falls does not reach the bottom. I have listened for eleven of my own fingers. No sound. The fog takes them the way a page takes a fold. Not down. Through.',
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'Through to where?', nextNodeId: 'clue', tone: 'lore' },
        { text: "I'll stay on the path.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    clue: {
      text: 'Look at the grain of the fog. It is not falling or rising. It curls around an axis you cannot face. The chasm is not deep, walker. It is where this world folds against another.',
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'A fishpond keeper found a teal-lit stone in his sea gate.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_makaha_tide',
        },
        { text: "I'll keep away from the edge.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: 'In a wall. By the sea. And it fit. Then my fingers were not lost. They were sent. Tell the keeper the stone is his now. A good wall is a better home than a fall.',
      expr: 'content',
      gesture: 'bow',
      choices: [
        { text: "I'll tell him.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Tell me about the fold again.', nextNodeId: 'clue', tone: 'lore' },
      ],
    },
    bye: {
      text: "Go well. Step where the light is. And if the path ever reads 'here' where there is no stone, do not stop to argue. Keep walking.",
      expr: 'calm',
      gesture: 'bow',
      choices: [
        { text: 'Go well, Cairn.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more question.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 8 · Visage (shared by the three archived Visages studies) ───

const VESPER: NpcSpec = {
  id: 'vesper',
  worldId: 'eric-biolum-grove',
  name: 'Vesper',
  title: 'Last Lamplighter of the Avenue',
  species: 'Moon-touched human, half-carved',
  role: 'Lights the Avenue lamps each night and polishes the obsidian eyes of the stone heads so they mirror the moon.',
  accentColor: '#d11824',
  heightMeters: 2.02,
  bubbleStyle: {
    preset: 'parchment',
    bgColor: '#e9dcc4',
    accentColor: '#8f1119',
    textColor: '#2a1a14',
    tail: 'sharp',
    font: 'serif',
    effect: 'none',
    badge: '☾',
  },
  ambientBarks: [
    "Hush. They're dreaming, and their dreams are heavy.",
    "Don't drink from the crimson pools. They drink back.",
    'Lamps lit, eyes polished. The moon may look at itself.',
  ],
  clueId: 'clue_obsidian_sky',
  clueTitle: 'The Other Sky in Their Eyes',
  clueSummary:
    "The obsidian eyes of the Visages return Vesper's lamplight a breath late, against green curtains and stars that are not this Avenue's.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: 'Ah. A visitor walks the Avenue, and the heads do not turn. That means you are welcome. I am Vesper, the last lamplighter. I keep the lamps, and I polish the eyes.',
      expr: 'calm',
      gesture: 'bow',
      choices: [
        { text: 'Polish the eyes?', nextNodeId: 'eyes', tone: 'curious' },
        { text: 'Who were the heads?', nextNodeId: 'place', tone: 'curious' },
        { text: "Excuse me. I'll walk on.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    place: {
      text: 'No one remembers. That is the shape of this place: a forgetting, carved large. Some say they were kings. I think they were listeners, built to stand very still and hear something far away.',
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'Hear what?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'And you? Why the mask?', nextNodeId: 'self', tone: 'curious' },
      ],
    },
    self: {
      text: 'The mask is cut from the same stone as theirs. A courtesy. One does not stare at the sleeping with a bare face. Beneath it I am mostly human. The rest is moonlight that stayed too long.',
      expr: 'shy',
      gesture: 'idle',
      choices: [
        { text: 'Tell me about the eyes.', nextNodeId: 'eyes', tone: 'curious' },
        { text: 'What do the heads listen for?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    eyes: {
      text: 'Obsidian. Each night I lift a lamp to them and wipe away the dew, so they mirror the moon cleanly. They love the moon. It is the only visitor more faithful than I am.',
      expr: 'fond',
      gesture: 'explain',
      choices: [
        { text: 'What do you see in them?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: 'Lately the reflection is late. I raise the lamp, and the flame appears in the eye a breath afterward. And the sky behind my lamp, in the eye, is not this sky.',
      expr: 'worry',
      gesture: 'ponder',
      choices: [
        { text: 'Whose sky is it?', nextNodeId: 'clue', tone: 'lore' },
        { text: 'Tired eyes, surely. Yours, not theirs.', nextNodeId: 'eyes', tone: 'playful' },
      ],
    },
    clue: {
      text: 'Come. Look into the left eye of the eldest. There: green curtains, slow as breath. Stars not ours. They are not reflecting the Avenue. They are a window, and we stand on its wrong side.',
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'An astronomer above the clouds charted a constellation tied in a knot.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_knotted_constellation',
        },
        { text: "I'll remember their sky.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "A knot. Yes. If the stars in these eyes are the astronomer's stars, then every sky in every room is one sky, seen through different cuts. The heads are not kings. They are keyholes.",
      expr: 'surprise',
      gesture: 'explain',
      choices: [
        { text: 'Keyholes for whom?', nextNodeId: 'clue', tone: 'lore' },
        { text: "I'll look through every one I find.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: 'Walk softly. If you see your own face in a pool and it blinks first, that is only the Avenue being polite. Bow, and keep going.',
      expr: 'calm',
      gesture: 'bow',
      choices: [
        { text: 'Goodnight, Vesper.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more question.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 9 · Palace Lagoon ──────────────────────────────────────────────────────

const SORAYA: NpcSpec = {
  id: 'soraya',
  worldId: 'eric-palace-lagoon',
  name: 'Soraya Benali',
  title: 'Geometer of the Tiled Dome',
  species: 'Human (zellige master and drone conductor)',
  role: 'Set the ceramic tiles of the dome and conducts the twelve projection drones that paint the façade at dusk.',
  accentColor: '#f2b866',
  heightMeters: 1.7,
  bubbleStyle: {
    preset: 'aurora',
    bgColor: '#1d1433',
    accentColor: '#f2b866',
    textColor: '#fff3dc',
    tail: 'curved',
    font: 'serif',
    effect: 'sparkle',
    badge: '✦',
  },
  ambientBarks: [
    'Twelve drones, twelve colors, one patient pattern.',
    'Climb the cedar spiral slowly. The tiles reward patience.',
    'Listen. The starlings are counting in sevens again.',
  ],
  clueId: 'clue_projected_lattice',
  clueTitle: 'A Pattern Cast From Somewhere Wider',
  clueSummary:
    'Soraya counts a thirteenth star in the dome, a tile nobody placed, cast like a shadow from a wider lattice.',
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Marhaba! You came at the good hour, sunset tipping into aurora. I'm Soraya. I set the tiles of the dome, and I conduct the twelve drones that paint light across the lagoon.",
      expr: 'smile',
      gesture: 'wave',
      choices: [
        { text: 'You conduct drones?', nextNodeId: 'drones', tone: 'curious' },
        { text: 'Tell me about the dome.', nextNodeId: 'place', tone: 'curious' },
        { text: "Beautiful. I'll walk on.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    drones: {
      text: "Like a choir. Each drone carries one color of one pattern. Alone, they're nonsense. Together, the façade blooms. The trick is never to let them hear they're beautiful. They get showy.",
      expr: 'mischief',
      gesture: 'explain',
      choices: [
        { text: 'And the tiles?', nextNodeId: 'place', tone: 'curious' },
        { text: 'Who are you, outside of work?', nextNodeId: 'self', tone: 'playful' },
      ],
    },
    self: {
      text: 'My grandmother cut zellige in Fes, and her teacher learned from Granada. I am the next knot in that thread. I studied mathematics so I could argue with her properly. She still wins.',
      expr: 'laugh',
      gesture: 'explain',
      choices: [
        { text: 'What did you argue about?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the dome.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: 'Up the cedar spiral, under the dome, every tile is a promise. Twelve-fold stars, interlacing, never quite repeating. The old masters built patterns that go on forever inside a finite room.',
      expr: 'proud',
      gesture: 'point',
      choices: [
        { text: 'Never quite repeating?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: "Mathematicians found that patterns like these are shadows: flat slices of a perfectly regular lattice in more dimensions than we have. My grandmother just said, 'the tile knows its family.'",
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'So the dome is a shadow?', nextNodeId: 'clue', tone: 'lore' },
        { text: 'Your grandmother sounds wise.', nextNodeId: 'self', tone: 'playful' },
      ],
    },
    clue: {
      text: "Count the stars from the top of the spiral. Twelve, and a thirteenth that only exists between the others when the drones line up. Nobody placed that tile. It's cast, from somewhere wider.",
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'An astronomer above the clouds mapped stars tied into a higher-dimensional knot.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_knotted_constellation',
        },
        { text: "I'll count the stars myself.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "A constellation tied in a knot? Then it's the same lattice. His stars and my dome are two shadows of one shape, cast on different walls. We are all living inside a projection.",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: 'Projected from what?', nextNodeId: 'clue', tone: 'lore' },
        { text: "I'll keep finding shadows.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: 'Go gently. Look up before you leave, the drones are about to land the last color. Patterns are never finished, only paused.',
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'Goodbye, Soraya.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 10 · Laser Forcefield Arena ────────────────────────────────────────────

const DEX: NpcSpec = {
  id: 'dex',
  worldId: 'eric-sun-observatory',
  name: 'Dex Arclight',
  title: 'Light-Show Rigger',
  species: 'Human (augmented, with a beam-sight visor)',
  role: 'Rigged every laser fan, forcefield and prism in the Arena, and keeps the show synced to the house beat.',
  accentColor: '#ff2a85',
  heightMeters: 1.74,
  bubbleStyle: {
    preset: 'shout',
    bgColor: '#12001a',
    accentColor: '#ff2a85',
    textColor: '#ffffff',
    tail: 'sharp',
    font: 'sans',
    effect: 'pulse',
    badge: '⚡',
  },
  ambientBarks: [
    "YO! Mind the fan beams! They're only light, but still!",
    "Drop in three, two... okay, I'm just practicing.",
    'Prism check! Nobody touch the prisms!',
  ],
  clueId: 'clue_second_beam',
  clueTitle: 'The Beam Nobody Fires',
  clueSummary:
    "Dex's forcefield wall shows interference from a second laser that isn't in the room, aimed in from no angle at all.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "AY, A VISITOR! Welcome to the Arena! I'm Dex, I rig every beam in here! Don't stand in the magenta. It's emotionally intense!",
      expr: 'grin',
      gesture: 'excited',
      choices: [
        { text: 'What is this place?', nextNodeId: 'place', tone: 'curious' },
        { text: 'You rigged all of this?', nextNodeId: 'self', tone: 'curious' },
        { text: 'Too bright for me. Bye!', nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: 'Every fan, every forcefield, every prism! Took me two years and one eyebrow. The visor is for the eyebrow situation. Also it lets me see beams before they fire. Mostly.',
      expr: 'proud',
      gesture: 'explain',
      choices: [
        { text: 'Mostly?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Show me the room.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: 'A gallery where the art is light hitting things! Forcefields pulse on the beat, lasers sweep, prisms throw rainbows. People walk in grumpy and leave glowing. Literally. Wash your hands.',
      expr: 'grin',
      gesture: 'point',
      choices: [
        { text: 'What beat do they pulse on?', nextNodeId: 'beat', tone: 'curious' },
        { text: 'Anything ever go wrong?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    beat: {
      text: "The house tempo. Slow, heavy, kind of sad, in a key I never picked. It was here before I wired the speakers. I just synced everything to it. You don't fight a beat like that. You ride it.",
      expr: 'thinking',
      gesture: 'explain',
      choices: [
        { text: "Something's off, isn't it?", nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: "Okay, real talk. Sometimes the forcefield wall shows an interference pattern. That only happens when two beams cross. But there's one beam. The other one isn't in this room.",
      expr: 'worry',
      gesture: 'ponder',
      choices: [
        { text: 'Then where is it?', nextNodeId: 'clue', tone: 'lore' },
        { text: 'Sounds like a loose cable.', nextNodeId: 'place', tone: 'playful' },
      ],
    },
    clue: {
      text: 'Watch the wall. There! See the fringe? A second beam, coming in at an angle my visor reads as zero degrees from every direction at once. Someone, somewhere, is aiming a light at us. Through.',
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'A lamplighter sees another sky inside stone eyes.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_obsidian_sky',
        },
        { text: "I'll watch for that beam.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "Wait. Stone eyes catching a sky from somewhere else? That's a mirror! If those eyes are mirrors and my wall is a screen, light is bouncing between rooms. We're a light show for... something!",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: 'For whom?', nextNodeId: 'clue', tone: 'lore' },
        { text: 'Keep the show running, Dex.', nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: "LATER, LEGEND! If you ever see your shadow pointing the wrong way, that's the beam! Wave at it! Politely!",
      expr: 'laugh',
      gesture: 'wave',
      choices: [
        { text: 'Later, Dex!', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing!', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 11 · Alpine Snow Run ───────────────────────────────────────────────────

const ERMELIN: NpcSpec = {
  id: 'ermelin',
  worldId: 'eric-sun-observatory',
  name: 'Ermelin',
  title: 'Lantern Warden of the Snow Run',
  species: 'Ermine-folk (folkloric snow guardian)',
  role: 'Lights all two hundred and six fence lanterns at dusk so sledders stay on the run.',
  accentColor: '#818cf8',
  heightMeters: 1.48,
  bubbleStyle: {
    preset: 'shout',
    bgColor: '#eef2ff',
    accentColor: '#818cf8',
    textColor: '#1e1b4b',
    tail: 'curved',
    font: 'comic',
    effect: 'sparkle',
    badge: '❄',
  },
  ambientBarks: [
    "MIND THE FENCE! Oh, you're walking. Carry on!",
    'Lanterns lit, runners waxed, cocoa questionable!',
    "Snow's falling funny tonight. Keep your hood up.",
  ],
  clueId: 'clue_upward_snow',
  clueTitle: 'Snow That Remembers Falling Up',
  clueSummary:
    'On the Snow Run the flakes sometimes stop, fall upward for one heartbeat, then fall again, as if someone were shaking a snow globe.',
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Halloo! Welcome to the Snow Run! I'm Ermelin, warden of the lanterns. Small, yes. Loud, also yes. Out here the wind steals quiet voices, so I don't keep one!",
      expr: 'grin',
      gesture: 'wave',
      choices: [
        { text: 'What does a lantern warden do?', nextNodeId: 'self', tone: 'curious' },
        { text: 'Tell me about the run.', nextNodeId: 'place', tone: 'curious' },
        { text: "Brr. I'll keep moving.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: "Every dusk I light every lantern on the fences so sledders don't fly off into the firs. Two hundred and six! My coat goes white in winter so the snow thinks I'm family.",
      expr: 'proud',
      gesture: 'explain',
      choices: [
        { text: 'Does the snow ever misbehave?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the run.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: 'Best run in any world! Alpenglow on the peaks, firs frosted like cake, and one long lovely curve where everyone screams. Happy screaming. Mostly. Bring a sled and bring a friend!',
      expr: 'laugh',
      gesture: 'point',
      choices: [
        { text: 'Who else lives up here?', nextNodeId: 'firs', tone: 'playful' },
        { text: 'Anything strange tonight?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    firs: {
      text: 'Just the firs, and they mostly creak. They lean together when a storm is coming. Tonight they leaned before the wind even started, the way a dog stands up before the doorbell.',
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'Before? Like they knew?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: 'Once in a while, all the snow stops. Just hangs there. Then it falls UP, for one heartbeat, back the way it came. Then down again, like nothing happened. It keeps a rhythm. I counted!',
      expr: 'worry',
      gesture: 'ponder',
      choices: [
        { text: 'Back the way it came. From where?', nextNodeId: 'clue', tone: 'lore' },
        { text: "You've been out in the cold too long!", nextNodeId: 'self', tone: 'playful' },
      ],
    },
    clue: {
      text: "Next time it happens, look up into the flakes. They don't rise into the sky. They rise into a direction tucked behind the sky, like snow sliding up the inside of a snow globe. Someone's shaking it.",
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: "A meadow keeper's sunflowers turn toward a second sun.",
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_second_sun',
        },
        { text: "I'll keep my hood up.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "A second sun?! Then that's why the snow rises. It's melting toward a warmth it can't reach! Poor flakes. I'll hang a lantern on the side of the fence that faces nowhere, so they feel welcome.",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: "That's very kind.", nextNodeId: 'bye', tone: 'playful' },
        { text: 'Tell me about the rising snow again.', nextNodeId: 'clue', tone: 'lore' },
      ],
    },
    bye: {
      text: "Off you go! Sled safe, scream happily, and if the snow goes up, wave at it! It's only trying to go home!",
      expr: 'grin',
      gesture: 'wave',
      choices: [
        { text: 'Goodnight, Ermelin!', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing!', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 12 · Bioluminescent Redwood Grove ──────────────────────────────────────

const MYRROW: NpcSpec = {
  id: 'myrrow',
  worldId: 'eric-biolum-grove',
  name: 'Myrrow',
  title: 'Warden Who Listens Underground',
  species: 'Mycelial grove-warden (redwood bark and living fungus)',
  role: 'Listens through the mycelium beneath the grove and answers for the redwoods, slowly.',
  accentColor: '#34d399',
  heightMeters: 2.15,
  bubbleStyle: {
    preset: 'aurora',
    bgColor: '#04190f',
    accentColor: '#34d399',
    textColor: '#d1fae5',
    tail: 'dots',
    font: 'serif',
    effect: 'shimmer',
    badge: '🍄',
  },
  ambientBarks: [
    '...slower... the mushrooms are reading your footsteps...',
    '...the aurora hangs low tonight... it wants to listen too...',
    '...every root here... is holding hands with another...',
  ],
  clueId: 'clue_root_network',
  clueTitle: 'Roots Beneath Every Room',
  clueSummary:
    "Myrrow's mycelium reaches past the grove to palm, fir and honey-tree roots; the worlds are stacked like pages, with the roots running through the spine.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: '...Ah. Warm-footed one. The mushrooms brightened when you entered... they always tell me first. I am Myrrow. I listen underground, where the grove keeps its thoughts.',
      expr: 'calm',
      gesture: 'bow',
      choices: [
        { text: 'Underground thoughts?', nextNodeId: 'self', tone: 'curious' },
        { text: 'Tell me about the grove.', nextNodeId: 'place', tone: 'curious' },
        { text: "I'll let you listen.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: '...Beneath the moss, threads finer than hair join every redwood to every other. I am mostly threads. What you see is only the part of me that came up to breathe.',
      expr: 'content',
      gesture: 'explain',
      choices: [
        { text: 'What do the threads say?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the grove.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: '...The redwoods remember the first rain. The spores drift like slow stars. The aurora bows low to hear the trees. Step on a mushroom and it glows... it is laughing.',
      expr: 'fond',
      gesture: 'point',
      choices: [
        { text: 'The aurora listens?', nextNodeId: 'aurora', tone: 'curious' },
        { text: 'Anything unusual in the threads?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    aurora: {
      text: '...It hangs lower each year, green and patient. On still nights its curtain ripples without wind... as if someone on the other side were brushing past it.',
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'Someone on the other side?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: '...My threads reach farther than the grove. Past the last redwood... past where the soil ends. They touch roots that are not trees I know. Palm. Fir. Monstera. Honey-trees.',
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'How can roots reach other worlds?', nextNodeId: 'clue', tone: 'lore' },
        { text: "Maybe you've just grown very big.", nextNodeId: 'self', tone: 'playful' },
      ],
    },
    clue: {
      text: '...Kneel. Hand on the moss. Feel the pulse, slow as the rain keeps it? Every world you walked rests on the same soil. Not side by side... stacked, like pages. The roots run through the spine.',
      expr: 'awe',
      gesture: 'ponder',
      grantsClue: true,
      choices: [
        {
          text: 'A garden breeze says it blows from no direction at all.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_wind_from_nowhere',
        },
        { text: "I'll walk softly on the moss.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: '...The little leaf-wind. Yes. It blows along my threads, up through the gaps between pages. That is the direction it cannot name. Not across... through. Tell it the roots say hello.',
      expr: 'fond',
      gesture: 'explain',
      choices: [
        { text: "I'll tell Fen.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Tell me about the pages again.', nextNodeId: 'clue', tone: 'lore' },
      ],
    },
    bye: {
      text: '...Go slowly. The mushrooms will remember your light... and so, a little, will I.',
      expr: 'calm',
      gesture: 'bow',
      choices: [
        { text: 'Goodbye, Myrrow.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing...', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 13 · Golden Cloud Observatory ──────────────────────────────────────────

const HALCYON: NpcSpec = {
  id: 'halcyon',
  worldId: 'eric-sun-observatory',
  name: 'Halcyon Vey',
  title: 'Cartographer of the Sky Above the Clouds',
  species: 'Human (elderly cloud-born astronomer)',
  role: 'Oils the armillary rings, argues with their conclusions, and charts the stars that will not wheel.',
  accentColor: '#f59e0b',
  heightMeters: 1.62,
  bubbleStyle: {
    preset: 'parchment',
    bgColor: '#f6e7c1',
    accentColor: '#b7791f',
    textColor: '#3b2a10',
    tail: 'curved',
    font: 'serif',
    effect: 'shimmer',
    badge: '☉',
  },
  ambientBarks: [
    "Don't jostle the rings! They're mid-calculation!",
    'Clouds below, stars above, and me in between. Ideal.',
    'Fifteen stars. Always fifteen. Why fifteen?',
  ],
  clueId: 'clue_knotted_constellation',
  clueTitle: 'A Constellation Tied in a Knot',
  clueSummary:
    "Halcyon Vey's fifteen unplaceable stars, joined in order, make a closed line that is truly a knot, though drawn flat it looks like a circle.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Oh! Company! Mind the rings, they're mid-thought. I'm Halcyon Vey, cartographer of the sky above the clouds. Which is most of the sky, if you think about it, and I do.",
      expr: 'grin',
      gesture: 'wave',
      choices: [
        { text: 'What are the rings for?', nextNodeId: 'place', tone: 'curious' },
        { text: 'How long have you been up here?', nextNodeId: 'self', tone: 'curious' },
        { text: "Sorry, I'll leave you to it.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: 'Since I was a boy who climbed a cloud on a dare and never climbed back down. Seventy years, give or take. The clouds feed me sunset and the stars keep me company. A fair arrangement.',
      expr: 'fond',
      gesture: 'explain',
      choices: [
        { text: 'What have you mapped?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the rings.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: "The armillary! Brass rings for the sun's road, the moon's, the wandering planets'. They turn by themselves now. I just oil them and argue with their conclusions.",
      expr: 'proud',
      gesture: 'point',
      choices: [
        { text: 'What do they conclude?', nextNodeId: 'odd', tone: 'lore' },
        { text: "What's below the clouds?", nextNodeId: 'clouds', tone: 'playful' },
      ],
    },
    clouds: {
      text: "Gold, mostly. Sometimes a gull. Once, a sled, upside down, perfectly dry, going nowhere. I logged it as 'weather'. Some things you log as weather to stay sane.",
      expr: 'mischief',
      gesture: 'ponder',
      choices: [
        { text: 'A sled? Up here?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: "Fifteen stars I can't place, in fifteen colors. They don't wheel with the others. And when I draw a line between them, in order, it passes back through itself without ever crossing.",
      expr: 'thinking',
      gesture: 'explain',
      choices: [
        { text: 'Draw it for me.', nextNodeId: 'clue', tone: 'lore' },
        { text: 'Maybe you need new spectacles.', nextNodeId: 'self', tone: 'playful' },
      ],
    },
    clue: {
      text: 'Here, my chart. Fifteen stars, one closed line. A knot, though drawn flat it looks like a plain circle. A knot only knots in more room than a page has. Our sky has more room than we do.',
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'A laser rigger sees a beam that comes from no angle at all.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_second_beam',
        },
        { text: "I'll look for your stars.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "No angle at all? Then it's a sightline along the knot! Someone at another star is looking straight down the thread at us, and the thread is the way we walk.",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: 'The way we walk. The loop?', nextNodeId: 'clue', tone: 'lore' },
        { text: "I'll keep walking it.", nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: "Off you go, star-walker. Count the portals as you pass. If you reach fifteen and you're back where you began, well. That's what a knot feels like from inside.",
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'Clear skies, Halcyon.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more question.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 14 · Honey in da Hood Ya Heard ─────────────────────────────────────────

const DRE: NpcSpec = {
  id: 'dre',
  worldId: 'eric-starlight-pavilion',
  name: 'Dré Honeycutt',
  title: 'Block Beekeeper and Corner Philosopher',
  species: 'Human (neighborhood beekeeper)',
  role: 'Keeps the hives on the block, tells the bees the news every morning, and keeps the peace with Big Jacket.',
  accentColor: '#fbbf24',
  heightMeters: 1.88,
  bubbleStyle: {
    preset: 'comic',
    bgColor: '#fff3c4',
    accentColor: '#d97706',
    textColor: '#2a1a00',
    tail: 'sharp',
    font: 'comic',
    effect: 'none',
    badge: '🍯',
  },
  ambientBarks: [
    "Ya heard? Honey's dripping sideways today.",
    "Don't mind Big Jacket. He only eats birds. Mostly.",
    "Pull up a hydrant, friend. This one's mine though.",
  ],
  clueId: 'clue_waggle_dance',
  clueTitle: 'The Dance Points Off the Map',
  clueSummary:
    "Dré's bees dance toward flowers at an angle that isn't on any compass, and some days the honey tastes of pine and salt.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Ayy, welcome to the block! Sweetest street in any world, ya heard. I'm Dré. I keep the bees, the bees keep the trees, and the trees keep everybody sticky.",
      expr: 'grin',
      gesture: 'wave',
      choices: [
        { text: "Who's the giant bee?", nextNodeId: 'jacket', tone: 'playful' },
        { text: 'You keep the bees?', nextNodeId: 'self', tone: 'curious' },
        { text: 'Stay sweet, Dré.', nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    jacket: {
      text: "That's Big Jacket. Blue jacket, big appetite. Birds fly by, CHOMP. He's not mean, he's just a bee who believes in himself. Respect the jacket and the jacket respects you.",
      expr: 'laugh',
      gesture: 'point',
      choices: [
        { text: 'And the little bees?', nextNodeId: 'self', tone: 'curious' },
        { text: 'Anything weird around here?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    self: {
      text: "Grew up on this block. My grandma kept three hives on the roof and one rule: talk to the bees every morning, tell 'em the news. I still do. They listen better than my cousins.",
      expr: 'content',
      gesture: 'explain',
      choices: [
        { text: 'What do the bees tell you back?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the block.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: "Honey trees, golden grass, a hydrant nobody's opened in years 'cause it's full of honey too. The road twists like it's dancing. Everything's warm here, even at night. Especially at night.",
      expr: 'fond',
      gesture: 'point',
      choices: [
        { text: 'Even at night?', nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: "Bees dance to tell each other where the flowers are. The angle of the dance is the angle from the sun. Lately my girls dance at an angle that ain't on any compass. Straight off the map.",
      expr: 'thinking',
      gesture: 'explain',
      choices: [
        { text: "Where's the dance pointing?", nextNodeId: 'clue', tone: 'lore' },
        { text: "Maybe they're just vibing.", nextNodeId: 'jacket', tone: 'playful' },
      ],
    },
    clue: {
      text: "Watch the hive door. See her waggle? Now stand where she's pointing. You can't, right? Your feet won't go. But you feel warm on your face. Flowers are blooming somewhere we can't walk.",
      expr: 'awe',
      gesture: 'point',
      grantsClue: true,
      choices: [
        {
          text: 'A grove warden says roots run beneath every world.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_root_network',
        },
        { text: 'Tell the bees I said hi.', nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "Under every world? Man. So my trees drink from the same ground as a forest and a reef and who knows. That's why the honey tastes like pine some days. And salt. My girls been foraging the whole loop.",
      expr: 'surprise',
      gesture: 'excited',
      choices: [
        { text: 'The whole loop?', nextNodeId: 'clue', tone: 'lore' },
        { text: 'Stay sticky, Dré.', nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    bye: {
      text: 'Peace, friend. Watch for dripping honey and hungry Jackets. And if you ever find those far flowers, bring a jar back, ya heard?',
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'Ya heard.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── 15 · Midnight Cassette Station ─────────────────────────────────────────

const LULU: NpcSpec = {
  id: 'lulu',
  worldId: 'eric-starlight-pavilion',
  name: 'Lulu Static',
  title: 'Tea-Stall Keeper, Ex-Pirate DJ',
  species: 'Human (retired late-night radio host)',
  role: 'Runs the 24H tea stall, minds the sleeping station cat, and still talks to listeners she cannot see.',
  accentColor: '#5eead4',
  heightMeters: 1.55,
  bubbleStyle: {
    preset: 'pixel',
    bgColor: '#0b1a2e',
    accentColor: '#5eead4',
    textColor: '#e0fffa',
    tail: 'sharp',
    font: 'mono',
    effect: 'pulse',
    badge: '📼',
  },
  ambientBarks: [
    "Tea's hot, rain's soft, tape's rolling. Pull up a stool.",
    "Shh. The payphone's singing again. Listen.",
    'Five mixtapes hidden in this station. I only made four.',
  ],
  clueId: 'clue_resonance_gsharp',
  clueTitle: 'The Eighth Note in the Rain',
  clueSummary:
    "Lulu's fifth mixtape, the one she doesn't remember making, carries rain in G-sharp minor at eighty-eight beats a minute under every sound, like a carrier tone.",
  entryNodeId: 'greet',
  nodes: nodes({
    greet: {
      text: "Evening, night owl. Welcome to the station. Tram's late, tea's not. I'm Lulu. Used to run a pirate station out of a laundromat. Now I run this stall and listen to the rain.",
      expr: 'smile',
      gesture: 'wave',
      choices: [
        { text: 'Pirate radio?', nextNodeId: 'self', tone: 'curious' },
        { text: "What's this station?", nextNodeId: 'place', tone: 'curious' },
        { text: 'Just sheltering from the rain.', nextNodeId: 'bye', tone: 'farewell' },
      ],
    },
    self: {
      text: "Lulu Static, 88.8 on your dial, three to six a.m., for the insomniacs and the heartbroken. They shut me down in '97. I kept the tapes. And the habit of talking to people I can't see.",
      expr: 'fond',
      gesture: 'explain',
      choices: [
        { text: 'Talking to whom, now?', nextNodeId: 'odd', tone: 'lore' },
        { text: 'Tell me about the station.', nextNodeId: 'place', tone: 'curious' },
      ],
    },
    place: {
      text: "Moss in the glass roof, koi swimming through holograms, a CRT shrine nobody remembers building, and Oolong the cat, who hasn't moved since Tuesday. Best waiting room in any world.",
      expr: 'content',
      gesture: 'point',
      choices: [
        { text: 'And the mixtapes?', nextNodeId: 'tapes', tone: 'curious' },
        { text: 'The payphone sings?', nextNodeId: 'odd', tone: 'lore' },
      ],
    },
    tapes: {
      text: "Five, hidden around the station for whoever's patient. Thing is, I only ever made four. The fifth turned up in my stall, labeled in my handwriting. I don't remember recording it.",
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: "What's on the fifth?", nextNodeId: 'odd', tone: 'lore' },
        { text: "Let's start over.", nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    odd: {
      text: 'Side A is just rain. Side B is rain too, but different rain. Under it, surf on stones. A shiba barking. Bees. And under everything, one note. The payphone rings in it too.',
      expr: 'thinking',
      gesture: 'ponder',
      choices: [
        { text: 'What note?', nextNodeId: 'clue', tone: 'lore' },
        { text: 'Sounds like a nice mix.', nextNodeId: 'tapes', tone: 'playful' },
      ],
    },
    clue: {
      text: "G-sharp. Low and minor, and the rain falls on it at eighty-eight. Twenty years on the dial, I know a carrier tone when I hear one. Somebody's broadcasting, and every world in the loop is a speaker.",
      expr: 'awe',
      gesture: 'explain',
      grantsClue: true,
      choices: [
        {
          text: 'A reef reader hears that note in the grooves of the coral.',
          nextNodeId: 'echo',
          tone: 'lore',
          requiresClue: 'clue_coral_song',
        },
        { text: "I'll keep my ears open.", nextNodeId: 'bye', tone: 'farewell' },
        { text: 'Back to the start.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
    echo: {
      text: "Grooves in the coral, like a record? Ha! Then the reef's a turntable and my tape's a dub of a dub. The question ain't who's broadcasting, love. It's who's tuning in.",
      expr: 'mischief',
      gesture: 'point',
      choices: [
        { text: 'Maybe we are.', nextNodeId: 'bye', tone: 'lore' },
        { text: 'Play me Side B again.', nextNodeId: 'clue', tone: 'curious' },
      ],
    },
    bye: {
      text: "Night, night owl. Take an umbrella, take a tea. If the payphone rings while you're here, pick it up and don't say anything. Just listen. They like that.",
      expr: 'fond',
      gesture: 'wave',
      choices: [
        { text: 'Goodnight, Lulu.', nextNodeId: null, tone: 'farewell' },
        { text: 'One more thing.', nextNodeId: 'greet', tone: 'curious' },
      ],
    },
  }),
};

// ─── Exports ────────────────────────────────────────────────────────────────

/**
 * The fourteen Keepers, spread across Eric's four rooms in `registry.json` loop order:
 *   - Palace Lagoon (4): Soraya, Solenne, Keola, Nori
 *   - Bioluminescent Redwood Grove (4): Myrrow, Fen, Cairn, Vesper
 *   - Sun Observatory (4): Halcyon, Ermelin, Juno, Dex
 *   - Starlight Dance Pavilion (2): Dre, Lulu (alongside Soraya, Dex & Ermelin live on stage)
 */
export const NPC_LIST: readonly NpcSpec[] = [
  SORAYA,
  SOLENNE,
  KEOLA,
  NORI,
  MYRROW,
  FEN,
  CAIRN,
  VESPER,
  HALCYON,
  ERMELIN,
  JUNO,
  DEX,
  DRE,
  LULU,
];

/** The three archived Visages comparison rooms (retained as a constant for reference; no Keepers mount here). */
export const ARCHIVED_VISAGES_WORLD_IDS = ['jp-visages', 'jp-visages-claude', 'jp-visages-codex'] as const;

/** Ensemble worlds that also mount live animated troupe performers on a central stage. */
export const TROUPE_STAGE_WORLD_IDS = ['eric-starlight-pavilion'] as const;

/** All Keepers hosted in each world id (multiple Keepers may share a room). */
export const NPC_SPECS_BY_WORLD: Readonly<Record<string, readonly NpcSpec[]>> = (() => {
  const grouped: Record<string, NpcSpec[]> = {};
  for (const npc of NPC_LIST) {
    (grouped[npc.worldId] ??= []).push(npc);
  }
  const frozen: Record<string, readonly NpcSpec[]> = {};
  for (const [worldId, list] of Object.entries(grouped)) {
    frozen[worldId] = Object.freeze(list);
  }
  return Object.freeze(frozen);
})();

/** Lead Keeper for each populated world id. */
export const NPC_SPECS: Readonly<Record<string, NpcSpec>> = Object.freeze(
  Object.fromEntries(Object.entries(NPC_SPECS_BY_WORLD).map(([worldId, list]) => [worldId, list[0]])),
);

/** NPC by its slug (`soraya`, `solenne`, ...). */
export const NPC_BY_ID: Readonly<Record<string, NpcSpec>> = Object.freeze(
  Object.fromEntries(NPC_LIST.map((npc) => [npc.id, npc])),
);

/** Returns all Keepers mounted in `worldId` (empty array for rooms with no Keepers). */
export function getNpcsForWorld(worldId: string): readonly NpcSpec[] {
  return NPC_SPECS_BY_WORLD[worldId] ?? [];
}

/** Returns the lead Keeper for `worldId`, or `undefined` if the room has no Keepers. */
export function getNpcForWorld(worldId: string): NpcSpec | undefined {
  return NPC_SPECS_BY_WORLD[worldId]?.[0];
}

/** The NPC whose clue this is, for journal pages and callback hints. */
export function getNpcByClueId(clueId: string): NpcSpec | undefined {
  return NPC_LIST.find((npc) => npc.clueId === clueId);
}

/** A node's choices the player can see now: callbacks stay hidden until their clue is found. */
export function visibleChoices(node: NpcDialogueNode, foundClues: ReadonlySet<string>): NpcDialogueNode['choices'] {
  return node.choices.filter((choice) => !choice.requiresClue || foundClues.has(choice.requiresClue));
}
