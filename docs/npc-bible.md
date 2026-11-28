# Portalverse NPC Bible

**The Keepers of the Loop: story, cast and art briefs for the fifteen portal worlds**

This is the shared reference for everyone building Portalverse's characters: narrative, art and texture (Antigravity + Codex), modeling and rigging (Blender), and engine integration. The dialogue itself lives in [`packages/core/src/npc/dialogueData.ts`](../packages/core/src/npc/dialogueData.ts) (types in [`npc/types.ts`](../packages/core/src/npc/types.ts), checked by [`__tests__/npcDialogue.test.ts`](../packages/core/src/__tests__/npcDialogue.test.ts)). If this document and the data disagree, the data wins. Fix the document.

---

## 1. The mythos: the Seam and the G♯ Loom

### 1.1 The truth (for the team only; never said in full in game)

The fifteen worlds are not separate places. They are **cross-sections of one larger shape** that extends into a direction we cannot face: a fourth axis. Each room is what you get when that shape is sliced by a three-dimensional "page". The portals are where the slices touch. The players and the team call the place where slices touch **the Seam**.

The shape is quietly *doing* something. It works like a loom, drawing a thread through the slices in a closed path. That path is the portal loop. Seen flat it is a circle. In the room it really has, it is a **knot**. Its working rhythm is the hum that underlies everything in Portalverse: **G♯ minor at 88 BPM, which is the real soundtrack's key and tempo.** The music is diegetic, though no one ever says so. The keepers hear it in rain, coral, light, snow, roots and bee-dances.

The unspoken last turn: **the walker is the thread.** Every player who walks the loop is the shuttle passing through the weave. That is why animals react before a portal opens, why visitors "smell like someone else's weather", and why objects wash up where they don't belong. The walking is what carries things across.

The worlds never tell the player this. A player who meets all fifteen keepers should be able to *feel* it, and maybe say it out loud before the game does.

### 1.2 Rules of telling

1. **No keeper knows the whole.** Each holds exactly one thread (their clue). They describe what they have noticed in their own trade's language: a draftsman's edge, a beekeeper's dance angle, a DJ's carrier tone.
2. **Sensory first, theory never.** A cog that's still warm, frost growing toward the ceiling, a reflection a breath late. Never "dimensional rift", "multiverse", "simulation" or "the fourth dimension". The only technical vocabulary allowed belongs to the speaker's craft (Soraya's lattice mathematics, Halcyon's knot, Lulu's carrier tone).
3. **The words *Seam* and *Loom* are almost never spoken.** They are names for the team and section headings for the journal UI. In dialogue, characters reach for their own images: Cairn's *fold*, Myrrow's *pages and spine*, Vesper's *window seen from the wrong side*, Fen's *a back door that's also every wall*, Halcyon's *knot*.
4. **Wonder, not dread.** The uncanny is gentle. Nobody is in danger. The keepers' reactions run from curious to tender: Ermelin hangs a lantern for the homesick snow, and Cairn decides his lost stones were *sent*, not lost.
5. **Earn it through walking.** The deepest lines are cross-world callbacks, shown only after the player has carried a clue from another room (`requiresClue`). The worlds talk to each other through the player, which is the mythos acted out.
6. **G♯ and 88 are said sparingly.** Only Kestrel (the grid pulses 88 a minute), Nori (the coral note, 88 a minute) and Lulu (G♯, 88, and "88.8 on your dial") say them outright. Everyone else hints: "a key I never picked" (Dex), "the same tempo as the music in my headphones" (Juno), "slow as the rain keeps it" (Myrrow).

### 1.3 Bleed-through motifs (the shared vocabulary of the uncanny)

| Motif | Where it surfaces |
|---|---|
| Objects washing up where they don't belong | Keola's mākāhā (brass cog, unmelting snowflake, cassette); Cairn's teal-lit stone set in Keola's wall; Halcyon's dry upside-down sled in the clouds |
| A direction that isn't one | Kestrel's extra edge; Fen's wind; Dex's beam "zero degrees from every direction"; Dré's waggle dance "off the map"; Solenne's sunflowers |
| Sounds carried across | Nori's coral grooves; Lulu's Side B (surf, a shiba, bees); the singing payphone; the arches' hum |
| Reflections of another sky | Vesper's obsidian eyes showing green curtains (the Grove's aurora) and stars that aren't the Avenue's |
| Scents in the wrong room | Pine and honey through Juno's sealed window; salt and pine on Fen; pine and salt in Dré's honey |
| Creatures reacting early | Mandu barks before the portal opens; Ermelin's firs lean before the wind; Myrrow's mushrooms brighten before you enter |
| Things moving along the hidden axis | Snow falling up for one beat; fog curling around an axis you can't face; the aurora rippling without wind |
| Patterns that are shadows of something larger | Soraya's thirteenth star; Kestrel's crystal-as-silhouette; Halcyon's knot drawn flat as a circle |

### 1.4 The clue web

Each keeper gives one clue on their deep-lore node (`grantsClue`). Each keeper also has **one callback choice** that appears only if the player already holds a specific other keeper's clue. All fifteen have one, so the threads form a closed web:

| Keeper (world) | Gives | Callback needs | …from |
|---|---|---|---|
| Kestrel (Eric's Room) | `clue_fourth_axis`: *The Edge That Wasn't Drawn* | `clue_projected_lattice` | Soraya |
| Solenne (Solarpunk Meadow) | `clue_second_sun`: *The Flowers Face Elsewhere* | `clue_waggle_dance` | Dré |
| Fen (Breezy Plant Garden) | `clue_wind_from_nowhere`: *A Breeze With No Compass Point* | `clue_draft_pine_honey` | Juno |
| Uncle Keola (Kāneʻohe Fishpond) | `clue_makaha_tide`: *What the Mākāhā Lets In* | `clue_falling_stones` | Cairn |
| Nori (Coral Reef Walk) | `clue_coral_song`: *Grooves in the Coral* | `clue_resonance_gsharp` | Lulu |
| Juno (Apartment) | `clue_draft_pine_honey`: *A Draft Through a Closed Window* | `clue_upward_snow` | Ermelin |
| Cairn (Abyss) | `clue_falling_stones`: *What Falls Doesn't Land Here* | `clue_makaha_tide` | Keola |
| Vesper (Visage) | `clue_obsidian_sky`: *The Other Sky in Their Eyes* | `clue_knotted_constellation` | Halcyon |
| Soraya (Palace Lagoon) | `clue_projected_lattice`: *A Pattern Cast From Somewhere Wider* | `clue_fourth_axis` | Kestrel |
| Dex (Laser Forcefield Arena) | `clue_second_beam`: *The Beam Nobody Fires* | `clue_obsidian_sky` | Vesper |
| Ermelin (Alpine Snow Run) | `clue_upward_snow`: *Snow That Remembers Falling Up* | `clue_second_sun` | Solenne |
| Myrrow (Bioluminescent Grove) | `clue_root_network`: *Roots Beneath Every Room* | `clue_wind_from_nowhere` | Fen |
| Halcyon Vey (Golden Cloud Observatory) | `clue_knotted_constellation`: *A Constellation Tied in a Knot* | `clue_second_beam` | Dex |
| Dré (Honey in da Hood) | `clue_waggle_dance`: *The Dance Points Off the Map* | `clue_root_network` | Myrrow |
| Lulu Static (Midnight Cassette Station) | `clue_resonance_gsharp`: *The Eighth Note in the Rain* | `clue_coral_song` | Nori |

Pairs answer each other: **Kestrel ↔ Soraya** (two shadows of one shape), **Keola ↔ Cairn** (the stone that fell from the sky fits the sea wall), **Nori ↔ Lulu** (the coral is a turntable, the tape a dub of a dub). The longer chains run **Juno → Fen → Myrrow → Dré → Solenne → Ermelin → Juno** (scent, wind, roots, bees, sun, snow) and **Halcyon → Vesper → Dex → Halcyon** (knot, other sky, mirror-beam, sightline along the knot). Most callbacks point *backward or forward across several rooms*, so a player has to go around the loop at least once to unlock them. That is the point.

### 1.5 The unwritten sixteenth page (future hook)

When a player holds all fifteen clues, the journal could add one more entry with no keeper attached. Suggested title: **"The Shuttle"**, with one line: *"You have walked a circle that is not a circle, and everything you carried arrived."* No exposition, no reward screen. Not in the data yet; it is a design hook for whoever builds the journal UI.

---

## 2. The cast at a glance

| # | World (`worldId`) | Keeper (`id`) | Species | Height | Bubble preset |
|---|---|---|---|---|---|
| 1 | Eric's Room (`eric-world`) | **Kestrel**, the Draftwright (`kestrel`) | Holographic drafting familiar | 1.78 m | `cyber` |
| 2 | JP's Solarpunk Meadow (`jp-world`) | **Solenne**, Keeper of the Brass Arches (`solenne`) | Human, solarpunk tinker (elder) | 1.84 m | `glass` |
| 3 | Breezy Plant Garden (`jp-garden`) | **Fen**, the Breeze Between Leaves (`fen`) | Leaf-woven breeze spirit | 1.52 m | `comic` |
| 4 | Kāneʻohe Fishpond (`fishpond`) | **Uncle Keola**, Kiaʻi Loko (`keola`) | Human, Native Hawaiian kupuna | 1.76 m | `glass` |
| 5 | Coral Reef Walk (`jp-reef`) | **Nori**, Current-Reader (`nori`) | Tidefolk sea-person | 1.58 m | `thought` |
| 6 | Apartment (`jp-apartment`) | **Juno Park**, Night-Shift Translator (`juno`), with Mandu the shiba | Human, urban dreamer | 1.66 m | `thought` |
| 7 | Abyss (`jp-abyss`) | **Cairn**, Abbot of the Stepping Stones (`cairn`) | Voronoi stone construct | 2.10 m | `cyber` |
| 8 | Visage (`jp-visage`, also `jp-visages`, `jp-visages-claude`, `jp-visages-codex`) | **Vesper**, Last Lamplighter (`vesper`) | Moon-touched human, half-carved | 2.02 m | `parchment` |
| 9 | Palace Lagoon (`eric-palace-lagoon`) | **Soraya Benali**, Geometer of the Tiled Dome (`soraya`) | Human, zellige master | 1.70 m | `aurora` |
| 10 | Laser Forcefield Arena (`laser-lab`) | **Dex Arclight**, Light-Show Rigger (`dex`) | Human, augmented | 1.74 m | `shout` |
| 11 | Alpine Snow Run (`alpine-sled`) | **Ermelin**, Lantern Warden (`ermelin`) | Ermine-folk | 1.48 m | `shout` |
| 12 | Bioluminescent Redwood Grove (`eric-biolum-grove`) | **Myrrow**, Warden Who Listens Underground (`myrrow`) | Mycelial grove-warden | 2.15 m | `aurora` |
| 13 | Golden Cloud Observatory (`eric-sun-observatory`) | **Halcyon Vey**, Cartographer of the Sky (`halcyon`) | Human, elderly astronomer | 1.62 m | `parchment` |
| 14 | Honey in da Hood Ya Heard (`honey-hood`) | **Dré Honeycutt**, Block Beekeeper (`dre`) | Human, neighborhood beekeeper | 1.88 m | `comic` |
| 15 | Midnight Cassette Station (`doug-cassette-station`) | **Lulu Static**, Tea-Stall Keeper (`lulu`) | Human, retired pirate DJ (elder) | 1.55 m | `pixel` |

**Range check:** seven humans of very different ages, builds and cultures; one light-construct; one stone construct; one plant spirit; one fungal giant; one sea-person; one animal-folk; and one half-carved figure. The heights run from 1.48 m to 2.15 m, so silhouettes read apart at a distance. Pronouns: Kestrel she, Solenne she, Fen they, Keola he, Nori they, Juno she, Cairn it (and doesn't mind "he"), Vesper she, Soraya she, Dex they, Ermelin she, Myrrow they, Halcyon he, Dré he, Lulu she.

---

## 3. Shared art direction

### 3.1 Style target

**Stylized AA.** Proportions are slightly heroic and caricatured (heads about 1/6.5 of height for adults, larger for Fen, Ermelin and Nori), with readable shape language at 20 m. Surfaces are painterly-PBR: hand-authored base colour with real roughness and metal response, so the characters sit naturally in rooms that run from flat-colour (Garden, Honey Hood) to physically lit (Palace Lagoon, Observatory). Each keeper should match the rendering language of their own room. Fen and Dré can lean flatter and more graphic; Soraya, Halcyon and Vesper lean richer and more material.

**Each keeper reads as one big shape first, one accent colour second, one prop third.** A player should recognise any keeper from a silhouette thumbnail.

### 3.2 Expressions and gestures (rig contract)

- **Face:** dialogue nodes use 17 expressions, every one a name in `@ericrius1/cast`'s `EXPRESSIONS` table: `neutral calm smile grin laugh surprise awe worry sad thinking determined sleepy content shy fond mischief proud`. Humanoid keepers should drive these through the cast face. Non-human keepers need an equivalent mapping (see each brief): Kestrel's wireframe "face plate", Cairn's rune glyph, Fen's leaf-flutter, Myrrow's cap glow.
- **Gestures:** `idle wave explain ponder point bow excited`. Author these seven as short (1–2.5 s) additive clips over each keeper's idle loop. `point` must aim at a target that the dialogue system supplies (the clue node always points at something in the room).
- **Idle:** every keeper has a signature idle (listed per brief). Barks play over the idle and never interrupt it.

### 3.3 Modeling and rigging (Blender)

- Blender 5.2.3 LTS is the install on `portal-windows` (`C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe`).
- Model at real scale (1 unit = 1 m), feet at origin, facing −Z (the engine's yaw-0 direction).
- **Budgets per keeper:** 15–35k triangles for the body, plus props. Up to three materials. Textures 2048² maximum per edge (1024² for props). The GLB stays **uncompressed** (no Draco, meshopt or KTX2), matching the room budget rules, with a target of **≤ 2.5 MiB** per keeper so that one fits comfortably inside a room's 12 MiB budget.
- Humanoids share one base skeleton so the gesture clips retarget. Non-humanoids (Fen, Cairn, Myrrow, Kestrel's light-ribbons, Ermelin's tail, Nori's fronds) add bones on top of the shared skeleton rather than using a separate rig, so `wave`, `bow` and `point` still work.
- Emissive parts (Kestrel, Cairn, Myrrow, Dex's visor, Lulu's tape window) get a separate emissive mask so rooms can pulse them on the music beat (88 BPM).

### 3.4 Textures (Antigravity + Codex)

- Image generation goes through Codex's GPT Image tool, per house rules. Generate **concept turnarounds first** (front, ¾, side, back, on a flat mid-grey background), then texture sheets that are projected and painted over in Blender.
- Keep each keeper's palette to the five hex values in their brief. The first value is the dominant mass and the last is the accent, which matches `accentColor` in the data.
- Fabrics carry one readable pattern at most. Wear and dirt are painted to tell the character's story: Solenne's brass polish marks, Keola's salt bloom, Dré's honey drips, Lulu's tea stains.

---

## 4. Character briefs

Each brief covers **concept · silhouette · outfit layers · signature prop · materials · palette · face · personality & voice · idle · bubble · thread**.

---

### 4.1 Kestrel, the Draftwright · Eric's Room (`eric-world`)

**Concept:** a drafting familiar sketched in light by a forgotten maker, never erased, and now on her seventeenth self-revision. She is the first keeper most players meet: precise, proud, a little mischievous, and quietly unsettled by an edge she can't draw.

- **Height & silhouette:** 1.78 m. Tall and slender, with an elongated drafting-compass silhouette: narrow torso, long forearms, and legs that taper to fine points that hover 3 cm above the grid. Two "ribbon" contrails trail from her shoulder blades like unrolled blueprint scrolls.
- **Outfit layers:** (1) a core body of translucent cyan volume with visible internal wireframe; (2) a fitted drafting smock made of **solid** light planes with scan-line edges; (3) a tool belt of floating instruments (a rule, a protractor ring, a pencil of light) that orbit her waist slowly; (4) the two ribbon scrolls.
- **Signature prop:** a **pair of dividers (drafting compass) taller than her forearm**, in glowing white-cyan. She measures the player with it and uses it to point.
- **Materials:** additive or fresnel emissive shell over a darker refractive core. The wireframe uses barycentric-line emissive. The instruments are solid light with a slight bloom.
- **Palette:** `#041a24` · `#0e3a4a` · `#7ce7f5` · `#cffafe` · accent `#22d3ee`
- **Face:** a smooth oval "face plate" with no mouth geometry. Expressions are drawn as linework on the plate: two bright arcs for eyes, with brows sketched and erased in real time. `mischief` adds a drafted half-smile line; `awe` scatters a ring of construction dots around the eyes.
- **Personality & voice:** dry, fast and exact; she files bug reports with herself. Underneath there is real tenderness ("bring me the drawing").
- **Idle:** redraws one of her own hands in wireframe, decides she likes it, and fades it back to solid.
- **Bubble:** `cyber` · bg `#041a24` · accent `#22d3ee` · text `#cffafe` · tail `sharp` · font `mono` · effect `glow` · badge `◇`
- **Thread:** *The Edge That Wasn't Drawn.* Her wireframe of the crystal has one edge too many, and it pulses at 88 per minute. The crystal is a shadow. Her callback (from Soraya): every room is a slice of one shape, "and the slices remember each other."

---

### 4.2 Solenne, Keeper of the Brass Arches · JP's Solarpunk Meadow (`jp-world`)

**Concept:** a solarpunk elder who built the meadow's first arch from a broken telescope and a bicycle wheel forty-one summers ago. She is warm, unhurried and stubborn, and she reads flowers like weather.

- **Height & silhouette:** 1.84 m. Tall, rangy and straight-backed, with a wide-brimmed sun hat whose brim is a fan of brass slats like a solar collector. Long arms, and a walking-staff silhouette.
- **Outfit layers:** (1) a loose undyed-linen shirt, sleeves rolled; (2) a sage canvas work apron with many pockets (seed packets, a tuning fork, a rag); (3) a short ochre waistcoat with brass buttons cut from old gears; (4) wide-legged trousers tucked into patched leather boots; (5) the brass slatted sun hat.
- **Signature prop:** a **tuning staff**, a walking stick topped with a small brass arch and a tuning fork, worn bright where she grips it.
- **Materials:** linen and canvas with visible weave; brass that is polished bright on touch points and green-brown patina in the recesses; soft cracked leather.
- **Palette:** `#fbf6dc` (linen) · `#c8a24a` (brass) · `#4b5b2a` (canvas) · `#a8623a` (ochre) · accent `#79a756`
- **Face:** deep brown skin with sun creases and freckles across the cheekbones; silver locs bound in a sun-yellow wrap. A brass monocle-sextant hangs on a chain and goes to her eye in `thinking`. Her laugh lines do most of her acting.
- **Personality & voice:** "love", "traveler"; dry farm humour; patient with plants and slightly less so with people. Has total faith in what bees and sunflowers agree on.
- **Idle:** taps an arch with the staff, listens, and nudges a slat by hand.
- **Bubble:** `glass` · bg `#fbf6dc` · accent `#79a756` · text `#2f3a1c` · tail `curved` · font `serif` · effect `shimmer` · badge `☀`
- **Thread:** *The Flowers Face Elsewhere.* Her oldest sunflowers turn together, on one beat, toward a warmth from no direction ("close one eye"). Her callback (from Dré): if the bees agree on a second sun, she'll believe it.

---

### 4.3 Fen, the Breeze Between Leaves · Breezy Plant Garden (`jp-garden`)

**Concept:** a lot of leaves that decided to hold hands and go somewhere. Fen *is* the breeze, a giggly, gossipy flutter of a spirit. Lately Fen has been blowing in from a direction that isn't one, smelling of salt and pine.

- **Height & silhouette:** 1.52 m. A spiral-woven teardrop body, wider at the shoulders and swirling to a point instead of legs. Two oversized monstera-leaf "hands". A bromeliad crown that flares when excited. Fen never stops moving, and the silhouette constantly re-forms.
- **Outfit layers:** none in the cloth sense. Fen is layered *leaf types*: (1) a core of tightly wound banana-leaf ribbon; (2) monstera leaves as cape and hands; (3) small pink bromeliad bracts as the crown and "cheeks"; (4) a loose orbit of 6–10 single leaves trailing behind as the "breeze tail".
- **Signature prop:** none held. The **orbiting leaf tail** is the prop: it bunches when Fen is worried and fans wide in `excited`.
- **Materials:** flat-colour, graphic leaves matching the Garden's flat style, with hard colour bands, a thin dark outline (inverted-hull or post) and subsurface translucency when backlit.
- **Palette:** `#fff6dc` · `#2e7d4f` (monstera) · `#9bd16b` (banana leaf) · `#ffd166` · accent `#f08a9b` (bromeliad pink)
- **Face:** two large glossy seed-black eyes set in the widest leaf and a small leaf-fold mouth. Most expression comes from the crown: flat for `worry`, spiky for `surprise`, waving for `laugh`.
- **Personality & voice:** exclamation-happy, fast and kind. Treats the player as a friend at once. The worry, when it arrives, is sincere and small.
- **Idle:** spirals a slow circle around the nearest giant leaf and "sways" it, and the leaf responds.
- **Bubble:** `comic` · bg `#fff6dc` · accent `#f08a9b` · text `#2b2320` · tail `curved` · font `comic` · effect `sparkle` · badge `🌿`
- **Thread:** *A Breeze With No Compass Point.* "A back door that's also every wall." Their callback (from Juno): Fen realises they're the draft through Juno's sealed window, so "I'm not a breeze. I'm a draft. Some door is open."

---

### 4.4 Uncle Keola, Kiaʻi Loko · Kāneʻohe Fishpond (`fishpond`)

**Concept:** a kupuna (elder) who helps care for the loko iʻa as part of a living community restoration effort. He is grounded, funny and practical. His relationship to the place is *work and care*, not magic. The uncanny thing in his world is what arrives at his mākāhā, never him.

- **Height & silhouette:** 1.76 m. Broad-shouldered, solid and slightly stooped from decades of lifting stone; strong forearms. Reads as "a man who works outside" first.
- **Outfit layers:** (1) a faded, sun-softened aloha shirt in a muted print (ʻulu/breadfruit leaves, not a tourist hibiscus print), sleeves loose; (2) a lightweight long-sleeve sun shirt beneath, cuffs pushed up; (3) work shorts in drab olive; (4) tabi reef shoes for the wet basalt; (5) a woven lauhala hat, well worn. Optionally, a volunteer-day bandana in his back pocket.
- **Signature prop:** a **clipboard in a ziplock bag** with a pencil on a string: tide times, fish counts and his running list of "things that came in". His gloves are clipped to his belt.
- **Materials:** soft washed cotton with salt bloom and fading at the shoulders; lauhala weave; wet-darkened neoprene on the reef shoes.
- **Palette:** `#e8fbf7` · `#3d6b5e` (faded green print) · `#6b5b3e` (olive) · `#c9a66b` (lauhala) · accent `#14b8a6`
- **Face:** a weathered, warm brown face with deep smile lines, a short grey moustache and grey hair under the hat. His eyes squint against glare. His default is a patient half-smile, and `grin` is generous.
- **Personality & voice:** welcoming and plain-spoken, with light Hawai'i English rhythm ("Smart, yeah?"). ʻŌlelo Hawaiʻi words appear the way they would in a caretaker's daily speech (aloha, mahalo, kūpuna, kuapā, mākāhā, limu, mālama ʻāina, a hui hou), never as decoration.
- **Idle:** crouches at the mākāhā grate, checks the flow, and writes a note on the clipboard.
- **Bubble:** `glass` · bg `#e8fbf7` · accent `#14b8a6` · text `#0f3b36` · tail `curved` · font `sans` · effect `none` · badge `🐟`
- **Thread:** *What the Mākāhā Lets In.* A warm brass cog, a snowflake that won't melt, a cassette. "I watch, and I count what arrives," as kūpuna did. His callback (from Cairn): he set a teal-lit faceted stone into a gap in the kuapā, "like it was cut for that spot."
- **Cultural notes (please keep):** Fishponds like the ones in Kāneʻohe Bay are actively restored by community organisations today. Portray that living practice: volunteers, school groups, data, aloha ʻāina. Do **not** invent akua, moʻolelo, chants or sacred objects, and do not costume him in ceremonial dress. If the team wants any further Hawaiian-language or cultural content, review it with a Hawaiian cultural practitioner first. Correct ʻokina (ʻ) and kahakō (ā) in all text and texture work.

---

### 4.5 Nori, Current-Reader of the Reef · Coral Reef Walk (`jp-reef`)

**Concept:** a tidefolk cartographer who "doesn't swim so much as get carried well". Nori knots each current into a string map, and lately hears one patient note in the coral.

- **Height & silhouette:** 1.58 m. Small and soft-shouldered, with long trailing kelp hair that floats upward and sways. Fin-frill forearms. Moves in a hovering, slightly forward-leaning drift with knees bent.
- **Outfit layers:** (1) iridescent blue-green skin with faint countershading; (2) a patchwork tunic of old fishing net and shell scales; (3) a sash hung with **dozens of knotted strings** in different colours, which are the maps; (4) a cape of translucent sea-silk that catches caustics.
- **Signature prop:** a **sea-glass jar lantern** holding a captive glow (bioluminescent plankton), plus the knotted-string map that Nori unspools to "read" a current.
- **Materials:** wet subsurface skin with a fresnel sheen; transmissive sea-silk; matte rope; nacre shell scales with thin-film iridescence.
- **Palette:** `#e0f7fb` · `#0e5a6b` · `#5fd3c6` · `#f6c6a8` (shell) · accent `#22b8cf`
- **Face:** wide-set round eyes with a nictitating sheen, small gill-frond "ears" that flutter with emotion, and a little smiling mouth. Freckles of bioluminescence on the cheeks brighten in `awe`.
- **Personality & voice:** soft-voiced and curious, a careful listener. Mildly scandalised by "dry-landers" walking the sea floor "like it's a street".
- **Idle:** ties a new knot, holds the string up to the current, and frowns at it.
- **Bubble:** `thought` · bg `#e0f7fb` · accent `#22b8cf` · text `#0b3a45` · tail `dots` (rising bubbles) · font `sans` · effect `shimmer` · badge `🫧`
- **Thread:** *Grooves in the Coral.* A "liar current" rises from below the sand; the brain coral's grooves play one note, 88 a minute. Their callback (from Lulu): the coral only *catches* the note, "the way a shell catches the sea."
- **Companion (environment, not a keeper):** Old Slowpaddle, the reef turtle, who "comes back down looking like she's seen something funny up there".

---

### 4.6 Juno Park, Night-Shift Translator · Apartment (`jp-apartment`), with Mandu the shiba

**Concept:** a Korean-American subtitle translator who works at 3 a.m. because "daytime is too loud", and who makes up stories for the city's windows. Her shiba, Mandu, barks before anyone comes through the portal, and a sealed window breathes pine and honey.

- **Height & silhouette:** 1.66 m. Cosy and rounded: an oversized cardigan creates a soft A-shape, hair in a messy bun with a pencil through it, socks and no shoes.
- **Outfit layers:** (1) a soft grey long-sleeve tee; (2) an **oversized oatmeal cable-knit cardigan** with one sleeve always slipping; (3) loose plaid lounge trousers in burnt orange and navy; (4) mismatched wool socks (one with a moon); (5) over-ear headphones around her neck.
- **Signature prop:** a **chipped mug of barley tea**, steaming, and a dog-eared notebook of untranslatable words.
- **Materials:** chunky knit with real cable relief (normal-mapped); flannel; ceramic with a glaze chip; warm rim light from the city.
- **Palette:** `#2b1d14` · `#d9c7a8` (oatmeal) · `#2f3e5c` (navy plaid) · `#b8572e` (burnt orange) · accent `#f4a259`
- **Face:** round and expressive, with soft monolid eyes behind big round glasses (she pushes them up in `thinking`) and slight under-eye shadows from the night shifts. Her `shy` smile is her signature.
- **Personality & voice:** wry, gentle and self-deprecating ("Sorry, I'm in socks"). She notices things and turns them into small poems.
- **Idle:** types two lines, rubs her eyes, looks at the window, and looks at Mandu.
- **Mandu (companion rig):** a red sesame shiba about 0.4 m at the shoulder, with a curled tail. Idle: asleep with one ear awake. Before a portal opens: sits up, faces the big window, and gives one bark. During the clue: lies in the draft with his nose up "like it's a radio".
- **Bubble:** `thought` · bg `#2b1d14` · accent `#f4a259` · text `#fde7cc` · tail `dots` · font `serif` · effect `glow` · badge `☕`
- **Thread:** *A Draft Through a Closed Window.* "Someone behind it is breathing out a forest." Her callback (from Ermelin): frost on the *inside* of the glass, growing toward the ceiling, and Mandu "looked homesick for somewhere he has never been."

---

### 4.7 Cairn, Abbot of the Stepping Stones · Abyss (`jp-abyss`)

**Concept:** stones that broke the same way and agreed to stay near, held together by a teal "agreement" of light. Cairn is serene, slow, and "mostly time". Cairn has lost eleven fingers to the fog, and later learns they were *sent*.

- **Height & silhouette:** 2.10 m, and floats. A monumental robed monk built from **Voronoi-cell stone fragments** (matching the room's stepping stones), with visible teal light in the cracks between cells. A tall hooded head-cell. The hands are slightly too large, and one is missing fingers.
- **Outfit layers:** (1) the core stack of dark basalt-like cells; (2) a "robe" of thinner, flatter cells that hangs and drifts; (3) a woven rope sash, the only non-stone element, hung with small rune-tablets; (4) a ring of 3–5 pebble cells orbiting the head like a halo of prayer beads.
- **Signature prop:** a **rune-tablet** worn smooth, inscribed with a single glyph that means "here".
- **Materials:** rough dark stone with lichen in the crevices; teal emissive seams (the beat-pulse mask); weathered rope.
- **Palette:** `#06201b` · `#2a2f33` (stone) · `#55606a` · `#9ea7a3` (lichen) · accent `#3ff2c8`
- **Face:** none in the human sense. A recessed hood holds one horizontal seam of teal light. Expressions are seam shape and brightness: a soft dim line for `calm`, widening for `awe`, a slow upward curve for `content`, a brief flicker for `thinking`.
- **Personality & voice:** short declarative sentences; unhurried and unbothered. Addresses the player as "walker". Never jokes, but is gently funny by accident ("I have time. I am mostly time").
- **Idle:** the halo pebbles rotate one notch per bar; occasionally Cairn raises the incomplete hand and regards it.
- **Bubble:** `cyber` · bg `#06201b` · accent `#3ff2c8` · text `#d1fff2` · tail `none` · font `mono` · effect `pulse` · badge `◈`
- **Thread:** *What Falls Doesn't Land Here.* "The chasm is not deep. It is where this world folds against another." Cairn's callback (from Keola): "Tell the keeper the stone is his now. A good wall is a better home than a fall."

---

### 4.8 Vesper, Last Lamplighter of the Avenue · Visage (`jp-visage`; shared by `jp-visages`, `jp-visages-claude`, `jp-visages-codex`)

**Concept:** the last lamplighter, who lights the Avenue each night and polishes the colossal heads' obsidian eyes so they mirror the moon. She is mostly human; "the rest is moonlight that stayed too long". She is gothic, courteous and melancholy, and the eyes have started showing another sky.

- **Height & silhouette:** 2.02 m. Very tall and gaunt, with a long column silhouette: an ankle-length coat flaring at the hem and a high collar. The **lamp-pole is taller than she is**, so together they make a long vertical with a hook of light at the top.
- **Outfit layers:** (1) a high-collared dark shirt; (2) a long, fitted moth-grey greatcoat with deep cuffs and many small pockets (wicks, a polishing cloth, a tinderbox); (3) a crimson lining, visible only when she turns or bows, echoing the crimson pools; (4) soft felt boots for walking silently on cobbles; (5) a **porcelain-stone half-mask** carved from the same weathered stone as the heads, covering the upper left face.
- **Signature prop:** a **long hooked lamp-pole** with a small caged oil lamp that burns a warm flame, and a folded polishing cloth always in one hand.
- **Materials:** heavy wool with a soft nap; weathered stone on the mask, with the same moss and erosion as the heads; tarnished silver lamp cage; a crimson satin lining.
- **Palette:** `#1c1418` · `#6e6a6f` (moth grey) · `#e9dcc4` (stone and paper) · `#c9b48a` (lamplight) · accent `#d11824` (crimson)
- **Face:** pale with a long jaw and a calm, tired mouth. The visible right eye is dark and gentle. Where the mask meets the skin, the skin *becomes* faintly stone-textured for a centimetre, the half-carved hint. In `awe` the masked side's eye-hole catches a faint green glint, a reflection of the other sky.
- **Personality & voice:** formal and old-fashioned ("One does not stare at the sleeping with a bare face"), kind beneath the solemnity, with a dark wit ("They drink back").
- **Idle:** raises the lamp to a giant eye, waits a breath, wipes, and bows slightly to the head.
- **Bubble:** `parchment` · bg `#e9dcc4` · accent `#8f1119` · text `#2a1a14` · tail `sharp` · font `serif` · effect `none` · badge `☾`
- **Thread:** *The Other Sky in Their Eyes.* The reflection arrives a breath late, showing green curtains (the Grove's aurora) and stars that aren't the Avenue's: "a window, and we stand on its wrong side." Her callback (from Halcyon): "The heads are not kings. They are keyholes."
- **Archived studies:** the three Visages comparison rooms map to Vesper in `NPC_SPECS`. She keeps the Avenue as her `worldId`, so her journal entry and clue are the same in every version.

---

### 4.9 Soraya Benali, Geometer of the Tiled Dome · Palace Lagoon (`eric-palace-lagoon`)

**Concept:** a zellige master and mathematician from a line of tile-cutters (Fes, and before that Granada) who also conducts the twelve projection drones like a choir. She is brilliant, warm and teasing, and she has counted a thirteenth star in her dome that nobody placed.

- **Height & silhouette:** 1.70 m. Confident and upright, with a layered, flowing silhouette: a long open over-robe that moves in the lagoon breeze, a head wrap, and a shoulder bag of tools. A **conductor's stance** with one hand often raised.
- **Outfit layers:** (1) a fitted cream tunic; (2) wide indigo trousers; (3) a long open **saffron-and-ochre over-robe** with a band of embroidered twelve-fold star geometry at the hem and cuffs; (4) a deep teal head wrap; (5) a leather tool sash holding a tile hammer (*menqash*), chalk lines and a brass compass.
- **Signature prop:** a **slim brass conductor's baton topped with a small zellige star**. The drones follow it, and its tip glows the colour of whichever drone she is cueing.
- **Materials:** brushed cotton; satin-sheen embroidery; vegetable-tanned leather; glazed ceramic star (high gloss, slight crackle); polished brass.
- **Palette:** `#1d1433` (dusk) · `#1f4e79` (indigo) · `#0f766e` (teal) · `#e8a33d` (saffron) · accent `#f2b866`
- **Face:** North African features, warm olive-brown skin, strong brows and dark, lively eyes, with a few chalk smudges on her cheek. Laugh lines. Her expressions are quick, especially `mischief` and `laugh`.
- **Personality & voice:** teasing, generous and quick ("never let them hear they're beautiful, they get showy"). Fond of her grandmother, who "still wins". Opens with "Marhaba!"
- **Idle:** conducts a small phrase at the drones, frowns at one that is late, and cues it again.
- **Bubble:** `aurora` · bg `#1d1433` · accent `#f2b866` · text `#fff3dc` · tail `curved` · font `serif` · effect `sparkle` · badge `✦`
- **Thread:** *A Pattern Cast From Somewhere Wider.* Patterns like hers are, mathematically, flat slices of a higher-dimensional lattice (true of quasi-periodic tilings). A thirteenth star appears only when the drones align. Her callback (from Kestrel): "two shadows of one shape, cast on different walls. We are all living inside a projection."

---

### 4.10 Dex Arclight, Light-Show Rigger · Laser Forcefield Arena (`laser-lab`)

**Concept:** the loud, joyful rigger who built every beam, forcefield and prism in the Arena ("two years and one eyebrow"). They are hype on the surface and a careful technician underneath, and they have seen an interference fringe from a beam that isn't in the room.

- **Height & silhouette:** 1.74 m. Athletic and angular, with a big asymmetric **undercut hairstyle with a magenta streak**, a chunky wraparound visor, and a utility harness with cables looping off one shoulder. Wide stance and restless energy.
- **Outfit layers:** (1) a black technical bodysuit with reflective piping; (2) a cropped, oversized **holographic bomber jacket** that shifts magenta-to-cyan; (3) a rigging harness with carabiners, cable coils and a gaffer-tape roll; (4) heavy platform work boots with light-strip soles; (5) fingerless gloves.
- **Signature prop:** the **beam-sight visor** (wraparound, segmented, with a scrolling readout), plus a handheld **prism** they toss and catch.
- **Materials:** holographic thin-film on the jacket; matte black technical fabric; glossy visor with an emissive HUD; a clear refractive prism (transmission and dispersion).
- **Palette:** `#12001a` · `#1b1b2f` · `#00e5ff` (cyan) · `#f5f5f5` · accent `#ff2a85` (magenta)
- **Face:** light brown skin, a strong jaw, and a small burn scar where the left eyebrow used to be (the "eyebrow situation"). The visor lifts to the forehead in `worry` and `awe`, and its readout mirrors their mood.
- **Personality & voice:** capitals, exclamation marks, "legend", "real talk". Generous and theatrical, and they respect the house beat ("You don't fight a beat like that. You ride it").
- **Idle:** runs a soundcheck air-drum; flicks a prism and lets a rainbow cross the floor.
- **Bubble:** `shout` · bg `#12001a` · accent `#ff2a85` · text `#ffffff` · tail `sharp` · font `sans` · effect `pulse` · badge `⚡`
- **Thread:** *The Beam Nobody Fires.* An interference pattern needs two beams, and the second comes in "at zero degrees from every direction at once". Their callback (from Vesper): stone eyes are mirrors, the wall is a screen, so "we're a light show for... something!"

---

### 4.11 Ermelin, Lantern Warden of the Snow Run · Alpine Snow Run (`alpine-sled`)

**Concept:** a small, loud ermine-folk warden who lights all two hundred and six fence lanterns at dusk. Her coat goes white in winter "so the snow thinks I'm family". Sometimes the snow falls *up* for one heartbeat.

- **Height & silhouette:** 1.48 m, the smallest keeper. A long slinky body in a round puffy coat, a long black-tipped tail that sweeps for balance, big round ears, and a lantern on a tall pole. An upright, alert, meerkat-like stance.
- **Outfit layers:** (1) white winter fur (the ermine coat); (2) a **puffy quilted periwinkle jacket**, too big, with toggle buttons; (3) a long knitted scarf in alpine reds and creams with a woven edelweiss motif; (4) felted mittens on a string; (5) small wooden snowshoes.
- **Signature prop:** a **lantern pole**: a long ash-wood pole with a brass hooded lantern at the top and a wick-lighter hook. A sled leans nearby with "206" carved on it.
- **Materials:** groomed fur cards (or shell fur in a strand look), with a black tail tip; quilted nylon with sheen; chunky wool; frosted brass; ash wood.
- **Palette:** `#eef2ff` (snow and fur) · `#1e1b4b` · `#b91c1c` (scarf red) · `#f59e0b` (lantern) · accent `#818cf8` (periwinkle)
- **Face:** a small triangular muzzle, big glossy black eyes, a pink nose and whiskers that react. Ears do most of the acting: back for `worry`, straight up for `surprise`. Frost catches in her eyelashes.
- **Personality & voice:** HOLLERS (the wind steals quiet voices), cheerful, protective and tender-hearted. "Halloo!"
- **Idle:** lifts the pole to relight a guttering lantern, then shakes snow off her ears.
- **Bubble:** `shout` · bg `#eef2ff` · accent `#818cf8` · text `#1e1b4b` · tail `curved` · font `comic` · effect `sparkle` · badge `❄`
- **Thread:** *Snow That Remembers Falling Up.* The snow rises "into a direction tucked behind the sky, like snow sliding up the inside of a snow globe". Her callback (from Solenne): the snow is melting toward a second sun it can't reach, so she'll hang a lantern on "the side of the fence that faces nowhere."

---

### 4.12 Myrrow, Warden Who Listens Underground · Bioluminescent Redwood Grove (`eric-biolum-grove`)

**Concept:** the tallest keeper, a being of redwood bark and living fungus who is "mostly threads"; what you see is only the part that came up to breathe. Myrrow speaks very slowly, and their mycelium reaches past the soil's end into palm, fir and honey-tree roots.

- **Height & silhouette:** 2.15 m. A hunched, ancient, tree-like figure with long arms that nearly touch the ground and a **broad glowing mushroom cap** as head and hat in one. Mycelial threads trail from the feet into the moss like roots.
- **Outfit layers:** (1) a core of deep red-brown, deeply furrowed redwood-bark body; (2) a mantle of moss and lichen over the shoulders; (3) shelf fungi growing up one side like epaulettes; (4) a skirt of hanging, faintly glowing mycelial strands; (5) drifting spores, a particle emitter attached to the cap.
- **Signature prop:** none held. The **glowing cap** and the **root-trails** that light up along the moss toward whatever Myrrow is talking about (they replace `point`).
- **Materials:** bark with deep normal and displacement; wet moss; translucent fungal gills with emissive green; a soft volumetric glow beneath the cap.
- **Palette:** `#04190f` · `#5b2c1d` (redwood) · `#2f5d3a` (moss) · `#a7f3d0` (spore glow) · accent `#34d399`
- **Face:** in the shadow beneath the cap, two slow amber-green knot-hole eyes and a mouth that is only a crack in the bark. The cap's glow intensity and colour carry expression: brighter for `fond`, rippling for `thinking`, a full bloom for `awe`.
- **Personality & voice:** ellipses; unhurried; ancient tenderness. Calls the player "warm-footed one". Never surprised, only interested.
- **Idle:** slowly kneels a hand into the moss and listens; the mushrooms nearby pulse in response.
- **Bubble:** `aurora` · bg `#04190f` · accent `#34d399` · text `#d1fae5` · tail `dots` · font `serif` · effect `shimmer` · badge `🍄`
- **Thread:** *Roots Beneath Every Room.* "Not side by side... stacked, like pages. The roots run through the spine." Their callback (from Fen): the leaf-wind blows "up through the gaps between pages... Not across... through."

---

### 4.13 Halcyon Vey, Cartographer of the Sky Above the Clouds · Golden Cloud Observatory (`eric-sun-observatory`)

**Concept:** a small, excitable, absent-minded astronomer who climbed a cloud on a dare seventy years ago and never came down. He argues with the armillary rings and has charted fifteen stars that won't wheel. Joined in order, they make a knot.

- **Height & silhouette:** 1.62 m (he would be taller without the stoop). Slight and stooped, with a huge flyaway white cloud of hair and beard (a visual rhyme with the clouds). A long scholar's coat. **Brass apparatus sticks out of him everywhere**: a spyglass in one pocket, an astrolabe on the belt, spectacles stacked on his head.
- **Outfit layers:** (1) a cream shirt with a loosened cravat; (2) a brocade waistcoat embroidered with constellations; (3) a long navy-blue astronomer's coat with brass-rimmed pockets and ink stains; (4) knee breeches and striped stockings; (5) slippers, because he never leaves.
- **Signature prop:** a **rolled star chart** that he unrolls for the clue: the fifteen-star knot drawn in gold ink on deep blue vellum. He also carries a pocket astrolabe.
- **Materials:** brocade with gold thread; ink-stained wool; polished brass; vellum with gold-leaf ink (metallic mask).
- **Palette:** `#f6e7c1` (vellum) · `#1e2a5a` (navy) · `#b7791f` (brass) · `#fdf4e3` (hair) · accent `#f59e0b`
- **Face:** pale and rosy, deeply lined, with a big nose and a bright, delighted gaze behind multiple spectacles (he cycles through them in `thinking`). His beard moves with his speech.
- **Personality & voice:** delighted, tangential and funny ("Some things you log as weather to stay sane"). A brilliant mind that enjoys being astonished.
- **Idle:** squints through a spyglass, scribbles, consults a different pair of spectacles, and scribbles again.
- **Bubble:** `parchment` · bg `#f6e7c1` · accent `#b7791f` · text `#3b2a10` · tail `curved` · font `serif` · effect `shimmer` · badge `☉`
- **Thread:** *A Constellation Tied in a Knot.* "A knot only knots in more room than a page has." His callback (from Dex): a beam from no angle is "a sightline along the knot... and the thread is the way we walk." His farewell ("If you reach fifteen and you're back where you began… that's what a knot feels like from inside") is the closest any keeper comes to the whole truth.

---

### 4.14 Dré Honeycutt, Block Beekeeper and Corner Philosopher · Honey in da Hood Ya Heard (`honey-hood`)

**Concept:** he grew up on the block, keeps his grandma's rule of telling the bees the news every morning, and keeps the peace with Big Jacket (the giant blue-jacketed bee who eats passing birds). He is chill, funny and wise. His bees dance at an angle that isn't on any compass.

- **Height & silhouette:** 1.88 m. Tall and relaxed, with a laid-back lean, usually **perched on the fire hydrant**. A beekeeper's veil worn pushed back like a hood or do-rag over the head, plus a loose, oversized fit.
- **Outfit layers:** (1) a white tee; (2) an **open honey-gold beekeeper's jacket** (cropped, zip-front, cuffs taped) worn like streetwear; (3) a bucket-hat-plus-veil combo pushed back; (4) relaxed carpenter jeans with honey drips; (5) clean white high-top sneakers he is very careful with; (6) a gold chain with a small hexagon pendant.
- **Signature prop:** a **bee smoker** (brass, with a leather bellows) that he gestures with, and a honey dipper he spins in his fingers.
- **Materials:** honey glaze (glossy, translucent drips with SSS); cotton twill; brass; mesh veil (alpha-tested).
- **Palette:** `#fff3c4` · `#2a1a00` · `#3b82f6` (Big Jacket blue, as a trim echo) · `#f5f5f4` (sneakers) · accent `#fbbf24` (honey gold)
- **Face:** dark brown skin, a short beard with a fade, warm heavy-lidded eyes and an easy grin. The occasional bee lands on his shoulder or hat, and he doesn't flinch.
- **Personality & voice:** "ya heard", "my girls" (the bees), "Man." Unhurried humour, neighbourhood pride, and real respect for animals, including Big Jacket.
- **Idle:** talks quietly to a bee on his finger, nods as if it answered, and checks his sneakers for honey.
- **Big Jacket (environment, not a keeper):** respect the jacket and the jacket respects you. Dré never talks to Big Jacket directly; he only waves.
- **Bubble:** `comic` · bg `#fff3c4` · accent `#d97706` (deep honey, so the border reads on the pale fill) · text `#2a1a00` · tail `sharp` · font `comic` · effect `none` · badge `🍯`
- **Thread:** *The Dance Points Off the Map.* The waggle dance encodes direction relative to the sun (real bee science); his bees point "straight off the map". His callback (from Myrrow): that's why the honey tastes like pine and salt some days, because "my girls been foraging the whole loop."

---

### 4.15 Lulu Static, Tea-Stall Keeper and Ex-Pirate DJ · Midnight Cassette Station (`doug-cassette-station`)

**Concept:** a retired late-night pirate radio host ("88.8 on your dial, three to six a.m., for the insomniacs and the heartbroken", shut down in '97) who now runs the 24H tea stall. She hid five mixtapes around the station, though she only ever made four.

- **Height & silhouette:** 1.55 m. Short and round-shouldered, with a big silver-grey bob with a blunt fringe. An oversized rain poncho over everything. **Over-ear headphones** always on her neck and a Walkman clipped to her belt.
- **Outfit layers:** (1) a vintage band tee for a band nobody's heard of; (2) a cosy mustard cardigan; (3) a translucent teal rain poncho beaded with rain; (4) a long pleated skirt over thick tights; (5) yellow rubber rain boots; (6) a tea-towel over one shoulder.
- **Signature prop:** a **cassette tape labelled "SIDE B"** in her own handwriting, the fifth mixtape, and a clay teapot always in her other hand.
- **Materials:** wet transparent PVC poncho with rain droplets (refraction plus a droplet normal map); chunky knit; glossy rubber; cassette plastic with a visible tape spool behind clear acrylic (emissive window pulses on the beat).
- **Palette:** `#0b1a2e` (blue hour) · `#d4a72c` (mustard) · `#e64b3c` (payphone red) · `#cbd5e1` (silver hair) · accent `#5eead4`
- **Face:** East Asian elder, round cheeks, deep crow's feet and a wry half-smile. Her eyes are often closed as she listens; they open bright and amused for `mischief`. Rain catches on her fringe.
- **Personality & voice:** a radio host's warm cadence: "night owl", "love", "ain't". Wry and kind. Treats every visitor like a caller on the line.
- **Idle:** pours tea, holds the cup to her ear like a seashell, listens, and nods.
- **Companion (environment):** Oolong, the station cat, "who hasn't moved since Tuesday". (Optional gag: on rare frames he faces the singing payphone a beat before it rings.)
- **Bubble:** `pixel` · bg `#0b1a2e` · accent `#5eead4` · text `#e0fffa` · tail `sharp` · font `mono` · effect `pulse` · badge `📼`
- **Thread:** *The Eighth Note in the Rain.* Side B holds different rain, surf on stones, a shiba, bees, and under everything one note: "G-sharp. Low and minor, and the rain falls on it at eighty-eight... every world in the loop is a speaker." Her callback (from Nori): "The question ain't who's broadcasting, love. It's who's tuning in."

---

## 5. Speech bubble assignments

All eight presets are in use, and no two keepers share an identical style (the test suite checks both). Every style passes `sanitizeSpeechBubbleStyle` unchanged.

| Keeper | Preset | bg | accent | text | tail | font | effect | badge |
|---|---|---|---|---|---|---|---|---|
| Kestrel | `cyber` | `#041a24` | `#22d3ee` | `#cffafe` | sharp | mono | glow | ◇ |
| Solenne | `glass` | `#fbf6dc` | `#79a756` | `#2f3a1c` | curved | serif | shimmer | ☀ |
| Fen | `comic` | `#fff6dc` | `#f08a9b` | `#2b2320` | curved | comic | sparkle | 🌿 |
| Uncle Keola | `glass` | `#e8fbf7` | `#14b8a6` | `#0f3b36` | curved | sans | none | 🐟 |
| Nori | `thought` | `#e0f7fb` | `#22b8cf` | `#0b3a45` | dots | sans | shimmer | 🫧 |
| Juno | `thought` | `#2b1d14` | `#f4a259` | `#fde7cc` | dots | serif | glow | ☕ |
| Cairn | `cyber` | `#06201b` | `#3ff2c8` | `#d1fff2` | none | mono | pulse | ◈ |
| Vesper | `parchment` | `#e9dcc4` | `#8f1119` | `#2a1a14` | sharp | serif | none | ☾ |
| Soraya | `aurora` | `#1d1433` | `#f2b866` | `#fff3dc` | curved | serif | sparkle | ✦ |
| Dex | `shout` | `#12001a` | `#ff2a85` | `#ffffff` | sharp | sans | pulse | ⚡ |
| Ermelin | `shout` | `#eef2ff` | `#818cf8` | `#1e1b4b` | curved | comic | sparkle | ❄ |
| Myrrow | `aurora` | `#04190f` | `#34d399` | `#d1fae5` | dots | serif | shimmer | 🍄 |
| Halcyon Vey | `parchment` | `#f6e7c1` | `#b7791f` | `#3b2a10` | curved | serif | shimmer | ☉ |
| Dré | `comic` | `#fff3c4` | `#d97706` | `#2a1a00` | sharp | comic | none | 🍯 |
| Lulu Static | `pixel` | `#0b1a2e` | `#5eead4` | `#e0fffa` | sharp | mono | pulse | 📼 |

**Why each pair differs:** the two `cyber` keepers are a bright drafting glow (Kestrel) versus a tail-less slow pulse (Cairn). The two `glass` keepers are a sunlit serif shimmer (Solenne) versus a plain, calm sans (Keola). The two `thought` keepers are rising sea bubbles (Nori) versus warm lamp-lit night thoughts (Juno). The two `parchment` keepers are a sharp, effect-less gothic page (Vesper) versus a shimmering gold-leaf star chart (Halcyon). The two `aurora` keepers are dusk-violet sparkle (Soraya) versus emerald-forest shimmer (Myrrow). The two `shout` keepers are a black-and-magenta club pulse (Dex) versus an icy hollered sparkle (Ermelin). The two `comic` keepers are flat leafy pink (Fen) versus honey-gold block-letter (Dré). `pixel` is Lulu's alone, a 90s CRT.

---

## 6. Writing guide (for anyone extending the dialogue)

- **Line limit:** at most 240 characters, and one to three sentences, so a line fits both the 3D bubble and the dialogue panel. **Barks:** at most 80 characters, exactly three per keeper.
- **Shape of a tree (6–8 nodes):** `greet` (entry) → `self` / `place` / a flavour node → `odd` (the uncanny noticed) → `clue` (`grantsClue: true`, the deep hint, always with a `point` gesture at something in the room) → `echo` (the callback, behind `requiresClue`) → `bye`. Every node offers 2–3 choices, at least one visible with no clues found, and the tree can always end (`nextNodeId: null`).
- **Tones:** `curious` asks, `playful` teases, `lore` leans into the mystery, `farewell` leaves.
- **Callbacks name the other keeper by role, not name** ("a tile master at the lagoon", "a lantern warden"). The answering keeper may use the name if it's natural, since the player has met them.
- **Voice before plot.** Each keeper's trade gives them their metaphors. If a line could be said by any keeper, rewrite it.
- **Cultural care.** Treat Keola's lines as the model: real practice, correct ʻokina and kahakō, no invented sacred content. Apply the same care to Soraya (Fes and Granada zellige), Juno and Lulu.
- **Validate:** `pnpm test` runs `npcDialogue.test.ts`, which checks node links, clue references, lengths, expressions and gestures, the bubble sanitizer round-trip, preset coverage, reachability, and the ten-or-more callback rule.

---

## 7. Integration notes

- `NPC_LIST`: the fifteen keepers in loop order.
- `NPC_SPECS[worldId]`: the keeper for any registry world. The three archived Visages studies resolve to Vesper.
- `NPC_BY_ID[id]`, `getNpcForWorld(worldId)`, `getNpcByClueId(clueId)`.
- `visibleChoices(node, foundClues)` hides callback choices until their clue is held.
- `NpcSpec.placement` is optional and left unset for now. Each room owner picks a spot beside their walkable path, away from both portals (Z = ±36.25), and can fill it in later.
- Barks, lines and badges are plain strings, so the existing 3D speech bubble (`AvatarSpeechBubble`) can render them with each keeper's `bubbleStyle` as-is.
