# Changelog

Notable changes and design decisions in **Portalverse**, newest first. Each section names the commit(s) it shipped in and the *why* behind each decision so contributors and their agents stay in sync across sessions.

## Jungle Path — spaced, perforated foliage layers — Unreleased (2026-11-28)

### Changed / Removed

- Replaced radial seven-finger leaf sprays and all opaque black shrub cores with individual, smooth-edged hanging leaves on seven curved foliage screens per side. Their scalloped crowns rise in uneven levels, and every screen has real geometric openings.
- Spaced the screens 2–3.5 m apart across a 16.5 m depth, following JP's request for more separation. Offset leaf placement exposes progressively cooler emerald, teal, and blue leaves through the foreground gaps; their combined overlap closes the view through the hedge.
- Reduced room geometry from about 2.8 million to 0.78 million triangles. Retained the winding dirt path, hedge collision, wind, sampled palette, and distance tint.

### Design & engineering decisions

- JP wanted the depth of overlapping perforated architectural skins, rather than marijuana-like rosettes covering black balls. The hedge now gets its opacity entirely from overlapping leaf silhouettes. Broad individual blades, visibly separated layers, and distinct depth colours make the intervening space readable through parallax.
- A geometry ray test checks real apertures and combined coverage: in 160 sampled sightlines, the nearest screen blocks 101 while the full stack blocks all 160. Existing traversal, isolated-mount, cooperative-loading, and resource-disposal checks remain in place. WebGPU renders were checked in both travel directions without shader errors.

## Jungle Path — Unreleased (2026-11-28)

### Added

- **`jp-jungle-path` / Jungle Path**: a winding dirt trail between 138 overlapping shrubs in three staggered tiers. Roughly 136,000 curved leaves form seven-blade sprays, with dark opaque interiors, uneven crowns, subtle wind, mossy banks, and dry leaf litter. Added between JP's Reef and Apartment rooms, with a quiet ambient music blend.
- Directly sampled emerald, olive, teal, blue, and shadow colours from JP's supplied jungle painting. Rear tiers are cooler, and a per-view distance tint turns receding foliage blue in either travel direction. The source artwork is not shipped; sampling provenance is recorded in the room's credits.
- A continuous hedge collider slides players along both bends, with clear, level landings at both portals. Flight is disabled for this enclosed walking room. Tests cover both travel directions, hedge containment, portal crossings, independent mounts, cooperative loading, and GPU disposal.

### Design & engineering decisions

- The request was for huge, nearly impenetrable abstract jungle hedges, with organic bushes and distinct levels. Real curved leaf geometry preserves silhouettes and parallax; rounded, irregular dark cores make the shrubs solid without transparent billboard overdraw. Instanced sprays and cores keep rendering to a small set of batches.
- The dirt shader follows the same centreline as collision, shading its irregular edges per pixel. Bush cores stay outside the entire curved trail, including at bends. Setup yields inside the foliage and ground loops, animation uses one uniform, and each mount owns and disposes its resources.

## Official room paths and final Relay floor — Unreleased (2026-11-28)

### Changed / Removed

- Renamed room IDs and folders to `jp-relay`, `jp-visage`, and `jp-apartment`; `jp-abyss` already matches. Updated catalog, room loading references, tour, music, metadata, tests, and current documentation. Old `?world=` bookmarks and incoming handoff destinations resolve to the new IDs; generated share links use the new paths.
- Removed Relay's floor tuning panel, sliders, style dropdown, H shortcut, saved settings, and inspection light. The approved flat mirror finish is now fixed. Apartment retains its separate lighting controls and saved preferences.

### Design & engineering decisions

- Official names should agree with URLs and source folders without breaking existing links. Remote handoff origin IDs and return URLs are preserved because another deployment may still use the older catalog.
- Flat reflections need no image distortion: restored direct blending over mirrored racks and removed ripple shaders and per-view framebuffer copies. This preserves the flat surface/reflection formula while removing copy bandwidth, temporary textures, and obsolete tuning code.

## Relay flat floor selected — Unreleased (2026-11-28)

### Changed

- Set **Flat mirror** as Relay's default finish following JP's choice. Reset the floor settings version so saved ripple experiments no longer override it. The other styles remain available in the dropdown; house lights default off.

## Relay ripple strength — Unreleased (2026-11-27)

### Added

- **Ripple strength** slider in Relay's floor panel: 0% is flat, 100% matches the glass/water preset, and 300% triples the distortion. It saves locally and is disabled for Flat mirror.

### Design & engineering decisions

- Controls the wave gradient shared by surface normals and full-image reflection distortion. Reflection brightness stays at its original full level. This replaces the briefly added reflection-brightness control following JP's clarification; any saved brightness setting is ignored while style and house lighting are preserved.

## Relay reflection-image distortion — Unreleased (2026-11-27)

### Fixed

- The floor presets previously warped only glyph coordinates inside the mirrored LED rims; rack silhouettes stayed straight. The floor now captures the already-rendered mirrored scene and distorts that image, visibly bending cage outlines and platters as well as their orange lights.
- Matched reflectance and roughness across all presets so switching styles no longer mostly changes brightness. Rippled glass has stationary distortion; Slow water animates it; Flat mirror samples without distortion.

### Design & engineering decisions

- A room-local, linear-filtered `ViewportTextureNode` performs one framebuffer copy per rendered view, with separate cached textures for portal targets. The floor writes the complete surface/reflection composite instead of alpha-blending an undistorted image behind it. Disposal tracks and releases all cached copies. This costs copy bandwidth and texture memory, but avoids re-rendering the scene.
- Screen-space distortion can draw nearby foreground pixels into object boundaries, and fades near screen edges. This remains an approximation, but now affects the reflection geometry visibly rather than only its display patterns.
- Compared all three styles in the running WebGPU browser: mirror outlines remain straight, glass outlines ripple, and water distortion changes over time. No browser console errors were reported during those checks. Production build and all 21 room tests pass.

## Relay reflective floor styles — Unreleased (2026-11-27)

### Changed / Removed

- Replaced localized bubble/blob normals and all floor sliders with a **Floor style** dropdown: **Rippled glass**, **Slow water**, and **Flat mirror**. Glass uses stationary continuous ripples; water uses three slowly moving waves driven by the shared room clock; mirror has zero distortion.
- Increased the reflective contribution and lowered glossy-surface roughness across the presets. Floor shading and reflected LEDs use the same analytic wave gradients, while the matte walkway remains flat.
- House lights is now an inspection checkbox. Settings use a new storage version, intentionally ignoring the retired bubble presets and their strong lighting values.

### Design & engineering decisions

- The former isolated domes looked like raised droplets at glancing angles. Continuous low-amplitude waves provide glass/water character without those bumps. Presets replace the many tuning parameters and switch via uniforms, with no extra draw calls or render targets. Reflection transport is still mirrored room geometry with approximate LED-coordinate distortion, not full-scene rippled reflection sampling.

## Denser irregular Relay bubbles — Unreleased (2026-11-27)

### Added / Changed

- Expanded **Bubble density** from 0–1 to 0–8 and layered three offset fields of compact domes. Above 1, cell spacing decreases; larger blobs overlap across layers without visible cell-edge discontinuities.
- Added **Blobby shapes**: randomized ellipse orientation, elongation and lobed contours, with an analytic surface gradient shared by floor shading and mirrored LEDs.
- Added **Reflection bend** (0–8), increasing both distortion gain and the previous fixed 2.5-LED cap, up to 20 LEDs. **Show orange ripples** applies a dense, stronger preset and dims house lighting to preserve the orange contrast.

### Design & engineering decisions

- The old bubbles were sparse circles and reflection distortion was tightly capped, making slider changes hard to read. The new controls expose those limitations directly. This increases shader arithmetic but adds no draw calls, geometry, textures, or render passes. Reflections still warp the existing mirrored LED surfaces rather than sampling additional scene geometry.

## Relay house lights for floor tuning — Unreleased (2026-11-27)

### Added

- **House lights** slider at the top of Relay's floor controls. Raises ambient fill and a low-angle white directional light to make the black surface and its bump highlights easier to inspect. Zero restores the original lighting; the setting persists locally and applies to mounted previews.

### Design & engineering decisions

- One unshadowed inspection light stays in the scene at zero intensity when off, so dragging changes light values without rebuilding materials, adding shadow maps, or changing shared renderer exposure. Floor uniforms remain separate from the lighting setting. The matte walkway intentionally has no irregularity; inspect the glossy sides.

## Official room names and Relay floor controls — Unreleased (2026-11-27)

### Added / Changed

- Official display names are now **Relay**, **Abyss**, **Visage**, and **Apartment**. Updated the catalog, current documentation, room/control headings and tour name assertion; archived Visage variants retain their distinguishing suffixes. Stable IDs, folder names and existing links remain compatible. Older changelog/research entries retain their historical names.
- Relay's active-room **Relay floor** button / **H** opens five sliders: overall irregularity, bubble height (mm), bubble width, bubble coverage, and broad ripple strength. Settings persist in the visitor's browser, update mounted previews and reset to the original subtle surface. Apartment's panel now says **Apartment lighting**.

### Design & engineering decisions

- Per-mount uniforms drive both floor shading and mirrored LED distortion, with no material rebuilds or geometry changes while dragging. Zero overall irregularity produces a flat normal; the matte walkway and physical collision remain flat. Bubble width is bounded so domes stay inside their noise cells. Reflection distortion retains the existing 2.5-pixel cap.

## Obsidian Relay white solo chases — Unreleased (2026-11-27)

### Added

- Occasional solo effects on one inner-rank rack at a time: a six-second burst of scattered white slashed-zero flashes, alternating with a fast white zero that visits all 32 display positions around each platter before moving down to the next. Each lap takes 0.8 seconds; the descent starts at the top and has exactly one lit glyph across the stack.
- `specials.ts` exposes timings and a deterministic event sampler. Every 26-second slot selects one nearby rack and starts after a 4–8-second delay. Other racks continue their orange sequences. Cage glow, haze and floor reflections follow the white tint.
- Tests verify all module positions and platter ordering, single-glyph descent, deterministic independent flashes, real-layout selection and quiet gaps.

### Design & engineering decisions

- A single shared solo scheduler prevents unrelated towers from flashing white simultaneously. The underlying orange cue clocks continue, so the chosen stack resumes its current program after the override. One tint attribute and CPU sampling reuse existing meshes and materials; no added draw calls, lights, render targets or post-processing.

## Night Loft lamp placement and glowing shades — Unreleased (2026-11-27)

### Fixed / Changed

- Replaced the bedroom's floating light over the middle of the bed with two half-strength lights located inside the bedside lamps. Living-room and reading-nook lights now follow the model's bulb position too, including its grounding and scale.
- Added warm shade-only emission to the lamp model; the metal stems and bases stay non-emissive. The Lamp light slider controls both emission and illumination. This adds one unshadowed point light overall (six total), no bloom passes or shadow maps.
- Adopted JP's visible tuning values as defaults: city 0.02, HDRI lighting 0.06, lamps 1.01. Ambient fill remains 0.15 because its value was obscured in the screenshot; existing browser-saved choices remain intact.

### Design & engineering decisions

- The bed's central hotspot came from a light at Z = −22 with no fixture. Bulb markers in the lamp model now determine light placement, while a local-space shade mask makes the fixture visibly luminous without turning the whole textured model emissive. The two bedroom lights split the former intensity instead of doubling it.

## Night Loft lighting controls — Unreleased (2026-11-27)

### Added / Changed

- **Room-local lighting controls (`worlds/jp-loft/lighting.ts`, `index.ts`):** an active-room “Loft lighting” button (or H) opens independent sliders for the visible HDR city, HDRI surface lighting/reflections, hemisphere fill, and the existing five warm point lights. Settings persist on the visitor's browser and update mounted Loft previews too; controls and subscriptions clean up on leaving/disposal.
- **Darker night defaults:** city multiplier 1.7 → 0.12, environment intensity 0.45 → 0.12, ambient fill 0.55 → 0.15. Lamp strengths stay unchanged by default. Reset restores these night settings.

### Design & engineering decisions

- The city and ambient lighting were washing out the interior. Separate controls let the skyline stay readable while retaining contrast around lamps. This changes room-local material/light values only, with no shared renderer exposure changes, new lights, shadow maps, or post-processing passes. Lamp shade emission and halos remain a proposed follow-up, not part of this change.

## Obsidian Relay room — Unreleased (2026-11-27)

### Added

- **`jp-obsidian-relay` (`worlds/jp-obsidian-relay/`, `registry.json`)**: a new room of JP's. A mirror-black floor runs either side of a matte walkway of 4 ft plates, and 169 square rack cages stand off in the dark. The racks are 4 ft square and 10.8–18.8 ft tall, holding 4 in platters with 12 in gaps. Each platter's rim is a ring of 32 orange 8 × 8 LED modules. A slashed zero chases round the bottom platter, the platters above join one beat apart a glyph behind, then tails of fading echoes grow up the tower. Each tower starts at its own deterministic time. You slide along the racks and can fly up and land on their lids. It sits between `jp-loft` and `jp-abyss` in the loop, so only JP's rooms get new neighbours (the Abyss → Visages → Palace order the tour test pins stays put).
- **Soundtrack vibe (`packages/core/src/audio/musicMix.ts`)**: one `ROOM_VIBES` line for the room, a dark `abyss-bed` under the `soft-beat` its chases are timed to. `musicMix.test.ts` requires a vibe for every room in rotation.
- **A lighting-console cue scheduler (`cues.ts`, `programs.ts`)**: programs are looping cue lists. Each cue fades attributes (dimmer, tail, falloff, phase, heads, glyph, spacing) with an easing and a per-platter delay fan from the top or bottom of the tower. Three named programs (`relay` as the default, plus `twist` and `weave`) are timed in beats of the soundtrack's 88 BPM. The schema and an example are in the room's `README.md`.
- **Tests (`relay.test.ts`)**: cover bottom-up activation one beat apart, the one-glyph lag at equal speed, tail growth order, seamless loop wraparound for every program at both tower heights, program validation, the layout's clearances and sizes, collision and lid landing, and a mount smoke test that checks disposal.
- **Cue authoring guards:** reject non-finite timings, negative rest jitter, and empty zero-duration loops before they can produce invalid display coordinates. Compare stored Float32 style values at the same precision so constant echo falloff does not trigger redundant GPU uploads.

### Design & engineering decisions

- **Pure time sampling:** every platter's state is a function of the engine's shared clock and the rack's integer seed: no timers, no `Math.random`, no `Date.now`. Previews, snapshots and the active view always agree. Glyph position is `speed × time`, not a cue attribute, so it never jumps when a cue fires or a loop wraps. `compileProgram` rejects any program whose fades would still be running when its loop wraps, and a cue only takes effect after its GO. Together these mean each loop ends exactly where the next one starts.
- **Shader-drawn LEDs, CPU-sampled cues:** 1,727 platters are drawn with one instanced draw for the rims and one for their faces (plus the mirrored copies). The CPU samples every platter into instanced attributes (about 0.25 ms a frame); `aStyle` and cage glow upload only when they change. The shader reads glyph bits from an 8 × 32 atlas. Where LEDs shrink below a pixel it switches to analytic coverage, so distant towers don't shimmer (the canvas has no MSAA).
- **Reflections without render targets:** the floor reflects a mirrored copy of the racks drawn under it. The floor is a translucent layer blended as `colour + behind × Fresnel`, and fogged by hand. Vinyl blisters exist only as surface normals; reflected LEDs are nudged by twice the floor slope. Players, portals and engine objects don't appear in the reflection (documented in the README).

## Relocate All Keeper NPCs to Eric's Rooms — Unreleased (2026-11-27)

### Changed

- **Multi-NPC room support & Eric-only Keeper placement (`packages/core/src/npc/dialogueData.ts`, `placements.ts`, `npcManager.ts`, `packages/core/src/__tests__/npcDialogue.test.ts`, `npcRuntime.test.ts`)**:
  - Removed all Keepers from non-Eric rooms (JP's, Doug's, and Charles's/`simplesessions` worlds now mount zero Keepers so contributors' rooms stay untouched).
  - Relocated all 14 Keepers across Eric's four rooms, spread across verified walkable spots (>= 11 m apart, clear of portals, water, and colliders):
    - **Palace Lagoon** (`eric-palace-lagoon`, 4): Soraya (Alhambra star plaza), Keola (rotunda north arch), Nori (lagoon cove bridge crest), Solenne (golden wildflower meadow).
    - **Bioluminescent Redwood Grove** (`eric-biolum-grove`, 4): Myrrow, Fen, Cairn, Vesper staggered down the illuminated forest trail.
    - **Sun Observatory** (`eric-sun-observatory`, 4): Halcyon & Ermelin on opposite rims of the central armillary plaza, Juno & Dex on the south and north marble bridge approaches.
    - **Starlight Dance Pavilion** (`eric-starlight-pavilion`, 2): Dre & Lulu bracketing the south and north lantern promenades while Soraya, Dex & Ermelin perform live on the central dance stage (zero duplicates).
  - Added `NPC_SPECS_BY_WORLD`, `getNpcsForWorld(worldId)`, `NPC_PLACEMENTS_BY_ID`, and multi-actor mounting in `NpcManager.mountForRoom` with one-at-a-time ambient bark gating so NPCs sharing a room never talk over each other.
  - Updated Seam Clue Journal links automatically via each Keeper's updated `worldId`, and added test coverage verifying Eric-only ownership, multi-NPC mounting, spacing, and portal clearance.

## Speech Bubble Framing & Clipping Fix — Unreleased (2026-11-27)

### Fixed

- **3D speech bubbles getting cut off at top of screen & inside thought/shout canvases (`packages/core/src/chat/speechBubble3D.ts`, `speechBubbleCanvas.ts`, `packages/core/src/npc/npcRig.ts`, `packages/core/src/engine/AvatarController.ts`, `app/styles.css`)**:
  - Scaled 3D speech bubble sprites from an oversized `3.45 m` down to a crisp, human-proportioned `2.0 m` wide (`1.55 m` voice, `1.35 m` typing), tightened NPC & remote player nameplates (`1.32 m` / `1.45 m`) and bubble `baseHeight`, and gently softened the NPC nameplate while a bubble is active — lowering a 4-line bubble's top edge by over `1.1 m` so close-up NPC conversations stay cleanly inside the viewport below the top HUD.
  - Added automatic font-size fitting and generous outer margins (`52–56 px` for `thought` clouds and `shout` bursts) in `renderSpeechBubbleToCanvas` so 3–4 line bubbles always stay strictly inside `fixedHeight` (`864×448`) without clipping cloud puffs/spikes or mutating WebGPU `CanvasTexture` dimensions after upload.
  - Tightened the desktop lower-third `.dialogue-panel` with `max-height: calc(100dvh - 80px); overflow-y: auto;` so all dialogue choices remain visible on shorter widescreen viewports.
  - Added regression coverage in `packages/core/src/__tests__/speechBubbles.test.ts`.

## Zero-Hitch FPS to Character Switching — Unreleased (2026-11-27)

### Fixed

- **Eliminated FPS → 3rd-person / character switch hitch (`packages/core/src/engine/PortalPreviews.ts`, `packages/core/src/engine/WorldEngine.ts`, `packages/core/src/engine/AvatarController.ts`, `app/characterSelect.ts`, `app/main.ts`)**:
  - Added `PortalPreviews.compileObject(object, targetScene, useSceneTarget)` to asynchronously pre-compile the hidden local avatar rig against the active room's lighting, fog, and render-target format (`HalfFloatType` scene target or direct swapchain on `mobile-lite`) while restoring `visible`, `frustumCulled`, and the active render target synchronously before awaiting so FPS frames never flash the character.
  - Pre-compiles the equipped character behind the startup loading gate (`warmUpPortals`), whenever entering a new room in FPS (`installRoom`), and when switching characters — preventing Three.js WebGPU from stalling for 100–400ms on the first frame `localRig.group.visible` flips to `true`.
  - Added `WorldEngine.prewarmCharacter`, `equipCharacter`, and `clearPrewarmedCharacter` wired to `CharacterSelectScreen.onPreview` so browsing a character in Character Select pre-builds and GPU-compiles its rig on `WorldEngine.renderer`, then adopts that exact rig directly on equip with zero rebuild or compile stall.
  - Deferred `transitRig` rebuilding off the character-equip click frame (with lazy sync before portal transit) so equipping a character never builds two identical rigs synchronously.
  - Made the FPS → 3rd-person camera pullback frame-rate independent (`1 - Math.exp(-12 * dt)`) and smoothly blended the look target from FPS aim to 3rd-person chase aim so switching out of FPS glides smoothly without an aim snap.
  - Added unit tests in `packages/core/src/__tests__/avatarSwitchPrewarm.test.ts`.

### Design & engineering decisions

- **Synchronous projection + restore around `WebGPURenderer.compileAsync(object, camera, targetScene)`:** In Three.js r181+ WebGPU, `compileAsync` synchronously projects `object` with `targetScene`'s lights before its first `await`. Temporarily setting `visible = true` only across that synchronous call lets us pre-compile hidden FPS avatars without a 1-frame pop or a separate staging scene, while serializing through `PortalPreviews`'s existing `compiling` lock prevents overlapping `compileAsync` races.

## Refractive liquid-glass snowglobes in the Meta View — Unreleased (2026-11-27)

### Changed

- **Snowglobe glass (`packages/core/src/meta/cosmicShaders.ts`, `CosmicMetaView.ts`)**:
  - The glass now refracts its interior: each pixel traces the refracted ray into the sphere, projects the point halfway to the far wall back onto the screen and samples the frame there, so the diorama and flurry magnify like a water-filled ball and compress toward the rim.
  - Chromatic aberration: the refraction is taken at 6 wavelengths (3 on phones) with a per-pixel jitter, giving smooth rainbow fringes on snowflakes and edges. Dispersion widens on hover and when the globe is shaken.
  - Fresnel-mixed reflections of a studio environment (mullioned window softbox, tall strip light, warm floor bounce, nebula band and star glints), thin-film iridescence that drifts across the surface, a dark total-internal-reflection edge with a bright accent rim, a tight key specular and a light sweep on hover.
  - An additive inner back wall drawn before the front glass, so its highlights get lensed by the front surface (the double highlight of real glass).
  - Shaking a globe (`Space`) sloshes the liquid lens.

### Design & engineering decisions

- **One linear-filtered framebuffer copy shared by all globes:** a single module-level `viewportTexture` node is sampled with `.sample(uv)` from every glass material. three keys the copy on the texture, so 16 globes cost one copy per frame, and linear filtering keeps the magnified interior smooth (`viewportSharedTexture` is nearest-filtered). The frame target is half-float linear (ACES runs in the output pass), so the copy needs no colour conversion.
- **Opaque output, depth write on:** what is behind the glass arrives through the refraction, so the glass writes alpha 1 and depth. Without depth write, the labels of globes further back (drawn later) painted over the lens unrefracted.
- **Tradeoff:** where two globes overlap on screen, the front one refracts the back one without its glass (the copy is taken before the first glass draws). That's rare in the layout and not worth a copy per globe.

## Cosmic Snowglobe Meta View & Celestial Constellations — Unreleased (2026-11-27)

### Added

- **Cosmic Snowglobe Meta View (`packages/core/src/meta/constellations.ts`, `cosmicShaders.ts`, `snowglobeDioramas.ts`, `CosmicMetaView.ts`, `app/metaViewUi.ts`)**:
  - Added a full-screen WebGPU + TSL **Cosmic Meta View** accessible from everywhere: a dedicated always-visible **`✦ Meta View`** button pinned next to the top-left world badge (never scrolled off-screen on narrow viewports), the **`O`** global hotkey (works even during pointer-lock, modals, or dialogue), a **`✦ Cosmic Meta View`** button on the opening loading gate, a **`✦ Meta`** quick pill in mobile touch controls, a top banner inside the Rooms (`M`) modal, and `/?view=meta`.
  - Crafted bespoke animated miniature 3D dioramas inside every world's snowglobe (`jp-world`, `jp-garden`, `fishpond`, `jp-reef`, `jp-loft`, `jp-abyss`, `jp-visages-synthesis`, `eric-palace-lagoon`, `laser-lab`, `alpine-sled`, `eric-biolum-grove`, `eric-sun-observatory`, `honey-hood`, `doug-cassette-station`, `eric-starlight-pavilion`, plus a dynamic accent-matched fallback diorama for community rooms like `frostfire-hollow`).
  - Built a TSL crystal glass dome shader (Fresnel rim glow, curved specular reflections, prismatic iridescence), lathe-turned obsidian & brass pedestals pulsing at 88 BPM, biome-themed swirling snow/bubble/spore/stardust flurries with interactive **Shake (`Space`)** vortex physics, golden orbital astrolabe halo marking your current room, and live multiplayer explorer firefly orbs circling rooms where friends are active.
  - Built a deep TSL cosmic sky dome (Milky Way nebula band, drifting translucent 3D nebula clouds, 2,200+ twinkling 3D parallax stars, periodic shooting stars) crowned by **12 interactive constellations** with starburst nodes, glowing star-to-star beams, and toggleable Uranometria-style celestial atlas art spanning **Creatures** (*The Great Buffalo*, *The Star Whale*, *The Lunar Moth*), **Aliens** (*The Star Visitor*, *The Star Saucer*), **Plants** (*The Cosmic Monstera*, *The Lotus of Worlds*, *The World Tree*), and **Concepts** (*The Seam Loop*, *The Luminous Idea*, *The Hourglass of Time*, *The Golden Spiral*).
  - Added smooth orbit/pitch/pinch-zoom controls, click-to-inspect World & Constellation inspector cards, double-click / CTA dive-into-snowglobe world entry, a filterable bottom Celestial Sky-Guide dock, and a dedicated `'__cosmic-meta__'` soundtrack shimmer vibe in `packages/core/src/audio/musicMix.ts`.
- **Shared overlay scene rendering in `WorldEngine` (`packages/core/src/engine/WorldEngine.ts`)**:
  - Added `engine.setOverlayView(...)` so full-screen 3D meta views render directly on Portalverse's shared `WebGPURenderer` with zero extra GPU context overhead while keeping the active room mounted in memory for instant return.
- **Automated test coverage (`packages/core/src/__tests__/cosmicMetaView.test.ts`)** covering all 12 constellations, orthonormal spherical projection, non-overlapping snowglobe layout math, bespoke & fallback diorama build/update/dispose across the full catalog, and headless `CosmicMetaView` focus/presence/shake/dive lifecycle.

### Removed

- **Eric's placeholder room (`worlds/eric-world/`, `registry.json`, `packages/core/src/npc/dialogueData.ts`, `placements.ts`, `musicMix.ts`)**:
  - Removed the original placeholder studio room `eric-world` ("Eric's Room") now that Eric's finished worlds are in the loop, promoted `jp-reef` ("Coral Reef Walk", first active room in rotation) to `defaultWorldId`, removed `KESTREL` from the active Keeper roster (re-linking Soraya's cross-world callback cleanly to Halcyon's Observatory clue so all 8 bubble presets and the full dialogue web remain intact), and updated affected catalog/server tests.

### Design & engineering decisions

- **Shared `WebGPURenderer` overlay pass instead of a second canvas/context:** Rendering `CosmicMetaView` directly on `WorldEngine`'s existing `WebGPURenderer` avoids creating a second WebGPU device (preventing mobile memory pressure and context loss), inherits automatic viewport/DPR syncing, and leaves the current room alive in memory so returning to the same room is instantaneous.
- **Instanced volumetric starlight beams & starburst sprites instead of 1px WebGPU `LineSegments`/`Points`:** Because WebGPU locks `PointList` and `LineList` primitives to 1 physical pixel regardless of DPI, drawing constellation edges as oriented additive instanced cylinders and stars as multi-point starburst sprites keeps constellations luminous and crisp on 2× Retina and 4K displays alike.
- **Bespoke lightweight procedural 3D dioramas + automatic fallback:** Building every room's miniature world out of shared low-poly primitives keeps draw calls and memory minimal across all globes while automatically welcoming any future community world added to `registry.json`.

## Mobile portrait viewport fix, Character Select mobile layout & Velveteen Moonbite — Unreleased (2026-11-27)

### Added

- **New playable character — Velveteen Moonbite (`packages/core/src/characters/moonMoth.ts`, `packages/core/src/characters/index.ts`, `packages/core/src/characters/types.ts`)**:
  - Built a procedural Three.js WebGPU + TSL velvet luna moth rig (`moon-moth`) with feathery instanced plume antennae, a floating emissive crescent-moon tiara (88 BPM beat pulse + boost flare), a cream-lilac fur-stole ruff, six articulated limbs (expressive upper opera arms + dainty middle hands that periodically dab her chin with a scalloped lace napkin), fluffy violet pantaloon legs grounded at `Y = 0`, and four scalloped TSL-shaded luna wings with crescent-SDF eyespots, iridescent scale-dust glitter, and articulated 4-segment swallowtail hindwing trains that fold into an opera cape on foot and sweep into a figure-eight hover & moondust-trail Moonbite Dash in flight.
- **Whimsical, subtly interconnected character backstories (`packages/core/src/characters/index.ts`, `app/characterSelect.ts`)**:
  - Expanded **Barnaby Buzz**, **Zephyr**, and **Velveteen Moonbite** with full whimsical backstories (collaborated with Claude Opus 5.5) containing quiet, mystery-movie-opening cross-references woven unobtrusively across the three bios.
- **Viewport sizing unit tests (`packages/core/src/engine/viewportSize.ts`, `packages/core/src/__tests__/viewportSize.test.ts`, `packages/core/src/__tests__/characters.test.ts`)**:
  - Added regression coverage for zero-height/zero-width mobile container startup, `visualViewport` keyboard resilience, camera aspect drift detection, and `moon-moth` rig grounding/animation/switching.

### Fixed

- **Mobile portrait stretched / collapsed 3D view (`packages/core/src/engine/WorldEngine.ts`, `packages/core/src/engine/viewportSize.ts`, `index.html`, `app/main.ts`)**:
  - Fixed a race condition on phones (especially iOS in-app browsers in vertical mode) where `new WorldEngine(viewport, ...)` initialized `PerspectiveCamera.aspect` from `Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight)` without falling back to `window.innerWidth`/`innerHeight` — so when `#viewport` had `clientHeight === 0` before stylesheet layout settled, `camera.aspect` stuck at `~390` (crushing the room into a narrow vertical strip) while `renderer.setSize` used full portrait dimensions and `window.resize` never fired.
  - Added critical inline `#viewport` sizing in `index.html`, `renderer.setSize(w, h, false)` so CSS keeps the canvas flush, `ResizeObserver` + `visualViewport` + `orientationchange` + `pageshow` + `visibilitychange` + startup self-healing sync in `WorldEngine`, explicit `camera.aspect` sync in `setPerformanceProfile()`, and a `setRenderTarget(null)` guard on the `mobile-lite` direct render path.
- **iPhone vertical Character Select & Speech Bubble Studio modal overlap (`app/styles.css`, `app/characterSelect.ts`, `index.html`)**:
  - Fixed flex-shrink overflow where `.character-select-layout` and `.bubble-studio-layout` had `min-height: 0` without `overflow-y: auto`, causing character cards and detail boxes to spill behind and overlap the modal footer buttons on vertical iPhone screens.
  - Made both modals clean 3-band flex layouts (pinned header, single smooth touch-scrolling body, pinned footer with safe-area insets), improved mobile 3D turntable camera framing so tall heads/antennae don't clip, hid desktop-only `<kbd>V</kbd>` hints on touch devices, and prevented narrow-screen mobile HUD pill collisions.

### Design & engineering decisions

- **Container-first sizing with per-axis fallback instead of raw `visualViewport`:** Using `#viewport`'s positive dimensions first (falling back per-axis to `window` and `visualViewport` only when `<= 0`) fixes pre-layout mobile portrait distortion without letting the iOS/Android software keyboard squash the full-screen 3D scene when typing in chat.
- **Three-band modal scroll on mobile portrait:** Removing nested `max-height` scroll boxes inside `.character-roster` on narrow viewports eliminates double-scroll friction on iOS touchscreens while keeping the action footer pinned and cleanly separated from character cards and backstories.

## Starlight Dance Pavilion (`eric-starlight-pavilion`) — Unreleased (2026-11-27)

### Added

- **New interactive dance & spellcraft room `eric-starlight-pavilion` (`worlds/eric-starlight-pavilion/`, `registry.json`, `packages/core/src/audio/musicMix.ts`)**:
  - **Live 3-Keeper Dancing Trio (`dancers.ts`)**: Mounts **Soraya Benali**, **Dex Arclight**, and **Ermelin** dancing together in synchronized 88 BPM choreography (full humanoid + bespoke bone animation for cloaks, tails, ears, lantern, and baton, plus `@ericrius1/cast` expressions & 3D speech bubbles).
  - **Seamless Dancer Takeover for Phone & Desktop (`controlsUi.ts`, `app/main.ts`)**: Click/tap any of the three dancers in 3D or on the stage HUD (or press `1`/`2`/`3`) to take over dancing them while the other two dynamically orbit as your backup crew. Supports **phone multi-touch drag-to-steer, directional swipes (`←/→` Spin, `↑` Leap, `↓` Bass Drop, circular swirl Tornado Twirl, two-finger camera orbit)** alongside **mouse/trackpad swipes, scroll gestures, `WASD`, and beat-synced `Space`**. Press `Esc` or tap **Walk Free** anytime to return to free exploration.
  - **6 Unique Character Powers / Spells (`spells.ts`, `audio.ts`)**:
    - **Soraya**: *Zellige Starburst* (8 spinning gold-teal star blades ringing totems & orbs) & *Aurora Canopy* (overhead aurora ribbons granting zero-G levitation to all 3 dancers).
    - **Dex**: *Prism Laser Nova* (360° rainbow concert laser fan supercharging disco orbs) & *Holo-Clone Rush* (3 translucent neon holographic dance clones).
    - **Ermelin**: *Blizzard Ribbon Twirl* (60 swirling snowflakes & frost-crystal floor shader) & *Lantern Comet Ring* (5 homing golden lantern comets auto-ringing all Chime Totems).
  - **4 Sculpted Blender Hero Stage Props (`worlds/eric-starlight-pavilion/assets/`, `tools/starlight_pavilion/build_stage_assets.py`)**: Uncompressed AA Art-Deco celestial GLBs (`2.18 MiB` combined) — `dance_gazebo.glb` (open octagonal pavilion with spinning `ChandelierCore`), `dj_gramophone.glb` (Celestial Turntable with spinning star-chart vinyl `TurntablePlatter` & 7 live-pulsing 88 BPM EQ bars `Starlight_Eq0`–`Starlight_Eq6`), `chime_totem.glb` (3 Harmonic Crystal Chime Totems that trigger **Starlight Overdrive** when all 3 resonate), and `star_fountain.glb` (2 walkable Zero-G Star Geyser Launch Pads), plus 12 musical G♯ minor floor tiles, 4 hovering mirror-prism disco orbs, and 8 rim sparkler cannons.
  - **Tests (`worlds/eric-starlight-pavilion/starlightPavilion.test.ts`, `packages/core/src/__tests__/npcDialogue.test.ts`)**: Verifies trio choreography, takeover movement & spells, unobstructed `X = 0` promenade corridor, Starlight Overdrive trigger, and uncompressed GLB node integrity.

### Design & engineering decisions

- **Non-invasive room input capture (`portalverse:room-capture`):** Instead of coupling dance logic into `WorldEngine` or `AvatarController`, entering Dance Takeover dispatches a lightweight custom event that cleanly locks Explorer movement and hides the mobile walking joystick while keeping chat, voice, music, and modals responsive, and automatically restores control on `Esc` or room exit.
- **Reusing `public/assets/npcs/` rigged models + compact 2.18 MiB stage GLBs:** Loading Soraya, Dex, and Ermelin from shared `/assets/npcs/<id>/model.glb` avoids duplicating character meshes while keeping `worlds/eric-starlight-pavilion/` at ~2.2 MiB (well inside the 12 MiB room budget).

## Keepers of the Loop: AA-rigged NPCs, KOTOR/Zelda branching dialogue & Seam Clue Journal — Unreleased (2026-11-27)

### Added

- **Story bible & branching dialogue graph (`docs/npc-bible.md`, `packages/core/src/npc/types.ts`, `packages/core/src/npc/dialogueData.ts`, `packages/core/src/npc/index.ts`)**:
  - Created 14 active Keepers across the portal promenade loop (with Vesper also shared across the 3 archived Visages comparison rooms) bound together by a subtle higher-dimensional mythos (**"The Seam & The G♯ Loom"**) tied to Portalverse's real 88 BPM G♯ minor soundtrack.
  - Each Keeper has a 7–8 node KOTOR/Zelda-style branching dialogue tree, `@ericrius1/cast` facial expressions, body gestures, 3 ambient approach barks, a bespoke custom `SpeechBubbleStyle` (spanning all 8 speech bubble presets), a discoverable journal clue, and a cross-world callback choice unlocked by clues found in other rooms.
- **Blender-modeled, rigged, PBR-textured GLB characters & 512×512 stylized portraits (`public/assets/npcs/<id>/{model.glb,portrait.webp}`, `tools/npcs/`)**:
  - Built a reusable Blender 4.5+ modeling/rigging/turnaround-sheet kit (`tools/npcs/blender_kit.py`), three modular build scripts (`tools/npcs/build_batch_a.py`, `build_batch_b.py`, `build_batch_c.py`), and a Pillow/NumPy PBR texture & GLB/portrait verification pipeline (`tools/npcs/process_textures.py`).
  - Exported all rigged Keepers as strictly uncompressed single-skin GLBs (`0.83–1.95 MiB`, zero Draco/meshopt/KTX2, feet grounded at `Y = 0`, facing `+Z`) alongside cohesive painterly 512×512 WebP dialogue portraits.
- **Core NPC runtime & `@ericrius1/cast` facial animation (`packages/core/src/npc/npcRig.ts`, `npcManager.ts`, `npcMemory.ts`, `placements.ts`, `packages/core/src/engine/WorldEngine.ts`)**:
  - Installed `@ericrius1/cast` (`0.7.6`) and integrated `Face` + `lineOf` into `NpcActor` for real-time phoneme lip-sync (`Jaw`), blinks/saccades/gaze tracking (`Head`, `Neck`, `EyeL`, `EyeR` with orientation-aware vertical blinking), 7 animated gestures, secondary bone physics (`Cloak`, `Tail1/2`, `EarL/R`, `Hat`, `Halo`, `Lantern`, `WingL/R`, `Tentacle1–4`), 88 BPM emissive pulsing, and floating 3D speech bubbles (`AvatarSpeechBubble`).
  - Wired `NpcManager` into `WorldEngine` to mount and live-ground each room's Keeper onto `terrainHeight` / `platforms` without modifying contributor `worlds/*` folders, handle proximity prompts (`R`, or `E` when no portal is closer) & ambient barks, and dispose cleanly on room switches.
- **KOTOR/Zelda Dialogue Panel & Seam Clue Journal UI (`app/dialogueUi.ts`, `index.html`, `app/main.ts`, `app/styles.css`)**:
  - Built a lower-third RPG dialogue overlay dynamically themed to each Keeper's custom `SpeechBubbleStyle` (preset, fill/accent/text colors, font, aura effect, flair badge) with live expression mood pills, typewriter reveal (`Space`/click to skip), `1–4` keyboard response hotkeys, highlighted cross-world thread choices (`✦ Thread from <Keeper>`), and a one-click **"Wear Bubble"** button to equip any Keeper's speech bubble for WebRTC player chat.
  - Added `NpcJournalStore` (`localStorage`-persisted) and the **Seam Journal** modal (`J` hotkey + top-bar counter) tracking discovered threads across the loop, quick room teleports, and the hidden final journal page (**"The Shuttle"**) unlocked once all clues are found.
- **Automated test coverage (`packages/core/src/__tests__/npcDialogue.test.ts`, `packages/core/src/__tests__/npcRuntime.test.ts`)** — validates all dialogue node links, reachability, clue web invariants, bubble presets, safe room placements, `NpcJournalStore` progression, headless `@ericrius1/cast` lip-sync/actor lifecycle, and on-disk portrait + uncompressed rigged GLB integrity.

### Design & engineering decisions

- **Central engine mounting + `public/assets/npcs/` lazy assets instead of editing `worlds/*`:** Mounting Keepers via `NpcManager` inside `WorldEngine` and serving GLBs/portraits lazily from `public/assets/npcs/<id>/` populates worlds automatically while respecting contributor room ownership and keeping every room well inside the 12 MiB per-room bundle budget.
- **Closed cross-world clue web ("the walker is the thread"):** Every Keeper holds one subtle sensory anomaly in their own trade and unlocks a unique callback when the player brings a clue from elsewhere in the loop, rewarding multi-lap exploration without breaking any room's standalone vibe (and keeping Uncle Keola's fishpond dialogue grounded in real loko iʻa stewardship with zero invented mythology).
- **Orientation-aware bone blinking & pure-data dialogue tests:** Inspecting each rig's `EyeL`/`EyeR` rest world quaternion on load guarantees vertical blinking across rigs regardless of Blender bone tail orientation, while keeping `dialogueData.ts` DOM/engine-free lets Vitest verify the entire branching narrative headlessly.

## WebRTC text & spatial voice chat + customizable 3D speech bubbles — Unreleased (2026-11-27)

### Added

- **WebRTC P2P full-mesh text & spatial voice chat (`packages/core/src/net/webrtcMesh.ts`, `packages/core/src/net/multiplayerClient.ts`, `packages/server/src/protocol.ts`, `packages/server/src/roomManager.ts`, `packages/server/src/index.ts`)**:
  - Added W3C Perfect Negotiation WebRTC signaling (`rtc_signal` offer/answer/ICE) scoped per room over the existing `/ws` multiplayer socket, plus `/api/rtc-config` (serving public STUN servers with optional `ICE_SERVERS_JSON` override for TURN deployments).
  - Established reliable peer-to-peer `RTCDataChannel`s (`"portalverse-chat"`) for instant room text chat, typing indicators, live voice status, and speech bubble style updates, with a deduplicated targeted WebSocket fallback (`chat_message`) whenever a peer's DataChannel is still negotiating or behind a strict NAT.
  - Added opt-in WebRTC microphone voice chat with a dedicated Web Audio graph (`PannerNode` HRTF 3D spatialization + distance attenuation, toggleable to room-wide stereo), live `AnalyserNode` voice activity detection, Open Mic or Push-to-Talk (`B`), Mute, Deafen, microphone device picker, and per-player mute controls in the Explorers roster.
- **Customizable 3D & HUD speech bubbles (`packages/core/src/chat/bubbleStyles.ts`, `packages/core/src/chat/speechBubbleCanvas.ts`, `packages/core/src/chat/speechBubble3D.ts`, `packages/core/src/engine/AvatarController.ts`)**:
  - Added 8 distinct speech bubble presets (**Portal Glass**, **Pop Comic**, **Thought Cloud**, **Neon Cyber**, **Action Shout**, **Retro 8-Bit**, **Arcane Scroll**, and **Prism Aurora**) plus mix-and-match customization for **Fill / Border / Text colors**, **4 tail shapes** (`curved`, `sharp`, `dots`, `none`), **4 fonts** (`sans`, `comic`, `mono`, `serif`), **5 aura effects** (`none`, `glow`, `shimmer`, `sparkle`, `pulse`), and **optional flair badges**.
  - Rendered matching animated speech bubbles in 3D above remote avatars (and your own avatar in 3rd-person view) for text messages, live voice-speaking equalizer waves, and `• • •` typing indicators using fixed-dimension WebGPU-safe `CanvasTexture` sprites.
  - Persisted customized speech bubble styles in `localStorage` and synced them across `hello`, `update_profile`, WebRTC DataChannels, and federated `PortalHandoffPayload` links.
- **Chat Dock, Voice Bar & Speech Bubble Studio (`index.html`, `app/chatUi.ts`, `app/bubbleCustomizer.ts`, `app/mobileControls.ts`, `app/styles.css`, `app/main.ts`)**:
  - Added bottom-left speech-bubble Chat Dock (`T` / `Enter` to type, collapsible on mobile, auto-dimming when idle), top-bar Voice split control with live level meter and settings popover (`B` to toggle mic or hold for PTT), and the interactive **Speech Bubble Studio** modal (`U` or from Chat / Avatar Settings) with a live Text / Voice Wave / Typing preview canvas.
- **Automated test coverage (`packages/core/src/__tests__/speechBubbles.test.ts`, `packages/core/src/__tests__/webrtcMesh.test.ts`, `packages/server/src/__tests__/roomManager.test.ts`, `packages/core/src/__tests__/handoffAndRegistry.test.ts`)** — added unit and integration tests for bubble sanitization/lifecycle, two-peer WebRTC Perfect Negotiation + DataChannel chat + voice track controls, room-scoped signaling relay, `/api/rtc-config`, and federated handoff round-tripping.

### Design & engineering decisions

- **Dedicated Voice `AudioContext` separate from `Soundtrack`.** Because `Soundtrack.setMuted(true)` suspends its own `AudioContext` to save CPU when music is muted, routing WebRTC voice through an independent `AudioContext` guarantees voice chat remains audible whether soundtrack music is muted or playing.
- **Fixed-size bottom-anchored WebGPU `CanvasTexture` sprites for 3D speech bubbles.** Keeping every 3D bubble sprite canvas at a constant `768×400` avoids WebGPU `GPUTexture` dimension-mismatch errors when message line counts change, while bottom-anchoring the bubble keeps the tail planted cleanly above each character's nameplate regardless of bubble height.
- **Zero-prompt P2P DataChannels with opt-in microphone tracks.** Negotiating the `"portalverse-chat"` DataChannel on room entry makes peer-to-peer text chat and typing indicators work immediately without triggering a browser microphone permission prompt; enabling Voice seamlessly attaches the local audio track via Perfect Negotiation renegotiation.

## Visages pentagram response — Unreleased (2026-11-27)

### Changed

- Darkened the pentagram carving by 15%. Walking over it eases the purple floor glow up to half strength over 0.35 seconds, without the vertical ring glow.
- Added a subtle flicker to the dim engraving and a smooth 0.35-second fade-out for the floor and rim. Re-entry blends from the current glow to avoid snapping during quick jumps or steps across the edge.
- Full glow arrives after three seconds grounded within the carving, including while walking. The prayer prompt fades in one second later. Jumping or leaving resets the charge; movement within the pentagram preserves it.

### Design & engineering decisions

- Control the engraving and vertical rim separately: only the later charge raises the rim, with both effects easing to full strength over the final 0.45 seconds of the wait. Reuse the prompt's 0.35-second fade-in (respecting reduced-motion preferences), delayed until one second after full glow.

## Room rotation and Abyss apparition fade — Unreleased (2026-11-27)

### Changed

- Removed Breezy Plant Garden, Kāneʻohe Fishpond, and JP's Solarpunk Meadow from the normal play rotation, directory, and portal previews; retained their source files and catalog metadata.
- The Abyss shadow figure stays fully opaque through 75% of its spawn animation, then fades smoothly to zero opacity at 100%.

### Design & engineering decisions

- An optional `inRotation` catalog flag lets rooms leave the shared play loop without deleting their implementation or treating them as comparison studies.
- Tie the apparition's fade to animation playback time so it disappears as the clip finishes, instead of lingering through an additional fade afterward. Preserve its once-per-landing trigger.

## Adventurers default to Platformer physics — Unreleased (2026-11-27)

### Changed

- Both adventurers start with Platformer physics on startup and when switching to them. Their character sheets mention the default and the G shortcut for changing physics.

### Design & engineering decisions

- Store the default in character metadata and prevent an old global Classic preference from overriding it on startup. Characters without an explicit default retain the existing saved-physics behavior; manual physics switching remains available.

## Adventurer turning and foot stability — Unreleased (2026-11-27)

### Changed

- Added a 720°/second cap to the adventurers’ existing eased third-person turns so quick left/right reversals visibly turn instead of snapping. Bee and sky drake controls remain unchanged.
- Increased the authored walk clip’s playback cadence by 40%; retained the existing run playback rate.

### Fixed

- Keep each independent foot control attached to its animated ankle during grounded clip blending as well as flight. Repeated direction changes previously separated feet and shins by up to 34–37 cm, stretching the boot meshes.
- Interrupted animation fades now start from their current weights, and movement clips preserve their step phase instead of restarting each time direction changes.

### Design & engineering decisions

- Preserve the original GLBs and authored animation curves, with a small runtime foot attachment constraint applied after sampling. This corrects the mismatch between independently blended foot positions and leg rotations.
- Added rapid-reversal checks at 30/60/120 fps, a repeated interrupted-transition regression on both real models, and authored-clip comparisons confirming the faster walk cadence and unchanged run timing.

## Adventurer third-person adventure controls — Unreleased (2026-11-27)

### Changed

- The man and woman now turn smoothly toward travel in third person, while WASD/touch movement remains relative to the camera. Stationary mouse/drag/touch orbit can circle around to their face without turning their body. Flight facing and pitch follow travel rather than camera look.
- Added an adventure-controls explanation to their character selection sheets. First-person strafing stays familiar, and the bee and sky drake retain their existing camera-facing controls.

### Design & engineering decisions

- Opt in through character metadata; this control style is independent of the Classic/Platformer physics setting. Separate camera heading from body heading, and transmit body heading to multiplayer peers and portal proxies. Rotated portals carry both headings and adventure momentum together.
- Retain facing at rest, ease turns along the shortest yaw arc, and use body-relative motion telemetry for the existing authored animation clips. Added regression coverage for both adventurers, both existing characters, both physics modes, orbit, flight, portal rotation, respawn, first person, and character switching.

## Adventurer flight hands and matte materials — Unreleased (2026-11-27)

### Fixed

- Turned both adventurers’ hands inward during flight and boost so the thumbs face each other. The wrist roll blends out when returning to the authored ground animations.
- Set roughness to 1 on every material of both adventurers to remove their overly glossy appearance.

### Design & engineering decisions

- Apply the hand correction only to the procedural flight pose; preserve Quaternius’s original animation clips. Override roughness on each instance’s materials without changing the source GLBs or the selected skin color.

## Adventurer characters and skin customization — Unreleased (2026-11-27)

### Added

- Both supplied Quaternius Adventurer models (man and woman) in character select, with their embedded idle, walk, run, backward and strafe clips. Procedural jump, landing, flight and boost poses follow the existing movement telemetry; the preview now includes Run and Jump.
- Continuous Skin tone and Undertone sliders, live material preview, and a warm medium-brown default. Appearance persists through character changes, profile saves, multiplayer joins/updates/reconnects, and remote portal handoffs.
- Equal-probability adventurer selection at startup until the player explicitly equips a character. Explicit choices are remembered in a separate preference, including the existing bee and drake.

### Design & engineering decisions

- Use an artist-authored skin-color ramp with Oklab interpolation and restrained rosy/golden undertone adjustment: hue and chroma change with tone, rather than simply darkening one color. Research and asset attribution are recorded in `packages/core/src/characters/assets/CREDITS.md`; UI and data use color parameters only.
- Preserve the source GLBs and their animation clips. Each live rig owns its skeleton and materials; shared geometry is released after the last instance. Skin alone is recolored and uses nonmetallic rough shading. Airborne posing carries the separate foot controls with the shins so the boots stay attached.
- Keep the legacy network fallback character stable. The new startup preference distinguishes a deliberate selection from an old automatically saved default. Optional bounded appearance fields keep older clients compatible without resetting customized skin.
- Model loading exposes readiness/error feedback in character select and ignores late results after disposal. Added real-asset tests for rig scale, animation states, resource isolation, tone range, startup choice, and appearance transport.

## Avenue of Visages prayer — Unreleased (2026-11-27)

### Added

- A pentagram is carved into the cobbles halfway between the portals. Six seconds of grounded contact light the grooves bright violet. Patches of light flicker upward around the rim. At seven seconds, “Press E to pray” turns the camera toward the nearest visage and calls twin shafts of light from its irises.

### Design & engineering decisions

- The darker, 3.1 cm grooves catch the avenue’s moonlight. The ring uses the same vertical falloff as Honey Hood’s stepping tiles. Beam origins follow the exposed eye openings. The camera turns along the shortest yaw arc, with duration proportional to the angle and immediate manual override. Jumping or leaving interrupts the invitation. Once invoked, the gaze follows the player until they move nine metres from the carving, then releases over 0.35 seconds.

## Sector 9 Rain Corner — Neo-Tokyo Blade Runner Evolution (`doug-cassette-station`) — Unreleased (2026-11-27)

### Changed

- **Transformed `worlds/doug-cassette-station/` (`"Sector 9 Rain Corner"`, owner `douglascalhoun`)** into a single dense, living **Neo-Tokyo Blade Runner street corner**:
  - **Dead-Channel Static Sky, Day/Night Cycle & Dynamic Rain (`shaders.ts`, `worldState.ts`)**: replaced blue sky with a fog-exempt TSL television-static sky peeking eerily behind drifting low rain clouds and wispy smog across a continuous Dusk → Midnight → Pre-Dawn → Hazy Static Day cycle, paired with dynamic rain (~70% downpour/drizzle, ~30% misty static-sky breaks) driving raindrops, wet-puddle ripples, NPC neon umbrellas, and dynamic pink-noise rain audio.
  - **Four Scheduled Street-Corner Shops & Bustle (`city.ts`)**: built the iconic Blade Runner **White Dragon Noodle Bar** (`龍麺`) with open-air chrome counter, 6 outdoor stools, sizzling broth cauldron, interactive noodle ordering, and Chef Kenta; **Kuro's Cyber-Optics & Bio-Mod Clinic** with floating holo-eyes & hovering calibration drone; **Analog Ghost** CRT & cassette shop with channel-switching 1990s monitors; and **Gekko Mart 24H Conbini** with glowing vending machines and stray bio-cat Mochi-X — each running its own day/night schedule and attached NPC routine.
  - **Future-Punks, Bio-Engineered Animal-Hybrid Humans, Neon Scooters & Polygon-Mesh Dissolve (`characters.ts`)**: fully modeled articulated future-punks and 4 bio-hybrid species (kitsune, neko, okami, usagi) walking sidewalks, dining, waiting at the bus stop, and cruising on neo-futuristic scooters — smoothly dissolving from solid meshes into translucent glowing cyan/magenta polygon wireframes (`computeDissolveFactors`) before disappearing at the edge of the street.
  - **Rare Electro-Punk Trolley (`city.ts`, `worldState.ts`)**: sparking streetcar that materializes from wireframes, stops smoothly at the covered Sector 9 bus stop with live countdown signage, opens its doors to board waiting commuters, and dissolves back into polygons as it departs.
  - **Perpendicular East–West Traffic Boulevard & Sculpted Life-Like 3D Models (`models.ts`, `city.ts`, `characters.ts`)**: routed all vehicle traffic (6 Akira-inspired sculpted cyber-scooters with curved fairings, hubless glowing wheels, telescopic forks & volumetric headlights) and the sculpted beveled **Electro-Punk Trolley** (with rounded roof, wheel bogies, diamond scissor pantograph, interior illuminated windows, volumetric beams & bi-parting doors) **perpendicular (East ↔ West along X)** across the player's North–South pedestrian crosswalk avenue, with the covered Line 09 Bus Stop and four corner shops framing all four intersection quadrants; upgraded all future-punks and bio-hybrid characters to smooth-shaded anatomically sculpted `LatheGeometry` heads/torsos/limbs, storm-collar coats, curved wrap-around LED visors, sculpted inner-pinna ears, and sinuous `TubeGeometry` tails.
  - **Blender 5.3 High-Detail PBR GLB Hero Assets & Blade Runner Nighttime Lighting (`tools/build_assets.py`, `assets/*.glb`, `CREDITS.md`)**: authored 5 uncompressed glTF 2.0 `.glb` models in Blender 5.3 (~1.07 MiB total) — `white_dragon_noodle_bar.glb` (open-air stainless/cedar noodle bar with corrugated awning, steel trusses, exhaust hood & vertical ducting, 6 padded swivel diner stools, copper stockpots, bowls, condiment jars & ribbed lanterns), `neo_tokyo_tower.glb` (layered brutalist megastructures with 3D recessed windows, balconies, railings, exterior AC condensers, vertical conduits, water tank & aviation beacon), `electro_trolley.glb` (beveled tram hull, rail bogies, flanged wheels, rooftop HVAC, scissor pantograph & named bi-parting doors), `cyber_scooter.glb` (beveled curved sport-scooter with forks, grooved tires, hubless rims, windscreen & mirrors), and `cyber_human.glb` (articulated wet-vinyl trenchcoat humans with named limb pivots) — paired with a procedural Neon-Rain equirectangular IBL environment map and 5 local moody Blade Runner corner PointLights so chrome, wet coats, and architecture gleam in the rain instead of going flat black.
  - **Interactive NPC Dialogue, Subplots & 5 Easter Eggs (`audioHud.ts`)**: proximity cyberpunk dialogue terminal with `[F]` line cycling across interconnected rumors about the static sky and Block 32 wireframe boundary, plus 5 hidden secrets (Foil Origami Unicorn, Cassette `DEAD CHANNEL 88`, Voight-Class Iris Scanner, Trolley Pass #404, and Bio-Cat Mochi-X).

### Design & engineering decisions

- **Single dense street corner + simulation-seam storytelling**: concentrated architecture tightly around one rain-washed intersection while keeping the portal-to-portal road strictly flat at `Y = 0`, turning distance culling into an intentional aesthetic & narrative centerpiece (dissolving into glowing polygon wireframes alongside the dead-channel static sky).
- **Zero-bloat procedural WebGPU performance**: kept all buildings, articulated characters, scooters, trolley, neon signs, CRT screens, and TSL shaders 100% procedural (~0.10 MiB folder size vs. 12 MiB budget) with `await ctx.breathe()` yields and strict active-only cleanup for audio and HUD DOM elements.

## Frostfire Hollow: a lava cave that freezes at the flip of a switch — Unreleased (2026-11-26)

### Added

- **Frostfire Hollow (`worlds/frostfire-hollow/`, owner `simplesessions`)** — a lava cave after Honey Hood in the loop. A broad (6 m), hilly path of broken hexagonal basalt slabs, from big flagstones to small chips, rolling up to about 1.8 m and flat at the portals and switches, with lava glowing in the cracks, splits around a hole in the floor where a big horned lava monster lives (chest up). He stands tall out of his pool and looms over you: slabbed pecs, spiked shoulders and back, small burning eyes sunk under a heavy brow that slopes down into a scowl, an angular snout and jaw with bared fangs, always half-snarling. He rises right up out of the lava to roar down at you. His arms are rigged (shoulder, elbow, wrist and four clawed fingers, each on a spring): he wades through the lava when he moves, leans in and claws at you as you come close, flings his arms wide to draw breath and thrusts them out on the roar. His arms feel for the rim: if a hand would go into the rock he lifts it, lays it flat on top and hooks his claws over the edge. Boulders and stalactites range from pebbles and nubs to a few huge ones. He follows you with a top speed and momentum, so he trails and settles, his head turning ahead of his body, and he bobs in his pool. Lava lakes sit 0.6 m below the path with rocky islands.
- **The roar** — at random times (5–12 s apart) while you're within 13 m of him, he rears back with smoke curling from his jaws, then roars for under 3 s, breathing a jet of rolling fire at you (freezing smoke when he's ice). Shockwave rings fly at you too, and the blast shoves you off the path into the lake.
- **Catching fire** — walk through the lava and flames lick up your body with a flickering light. You keep burning for 2.5 s after stepping out, and ice puts you out.
- **Magical light** — glowing crystal clusters (violet by lava, aqua by ice) light the cave's edges. Soft shafts of light fall from the ceiling, wisps drift over the lakes, and faint veins glow across the ceiling. The ceiling stays lava-lit, with ember veins, and turns aqua in ice.
- **Linked fire/ice switches** — one at each fork: a horizontal rocker with a flame and a snowflake, set in a recessed bezel so it never clips, and only the active half glows. Step on the stone plate in front of either one to flip both. Going to ice the lava crusts over and drains, a cold gust blows out of the hollow at you for 5 s: billowing puffs of frosty smoke, like the cave's cold breath, roll past you with a gentle push, and the broken basalt slides together under snow into one solid path, in a wave out from the switch you stepped on. Icicles grow from the ceiling and the rim, the lakes freeze slippery, and the monster turns pale crystal with ice horns and drifting snowflakes, still moving through icy water. Flipping back thaws it all, and the cave quakes as the lava surges back: a sharp jolt and a rumbling camera shake that settles over about 3.5 s, while rocks shake loose from the ceiling, bounce off the path and sink into the lava. It starts on fire every mount and isn't saved.
- **Soundtrack mix** for the room in `packages/core/src/audio/musicMix.ts` (the soundtrack test requires every room to have one).

### Design & engineering decisions

- **Slipping, wind and the roar's shove live in the room's collider.** The engine has no friction or push API, so `ctx.setCollider({ move })` keeps a slide velocity: on ice it follows your input slowly and keeps gliding, elsewhere it is instant. The gust and the roar's blast are added on top. No shared engine code changed. Long jumps (spawns, portals) and flying high reset it.
- **Pressure plates, not a key.** `F` already toggles flight and `E` descends. The plates sit beside the path, not on it, because every walk through the cave passes both switches and a plate on the path would flip it twice. They work on phones too.
- **Arm collision is feedback, not IK.** Each frame the elbow, wrist and claws are checked against `groundAt`; how deep they sit in the rock raises that arm's shoulder (fast in, slow out), and touching the rim sets a grip that flattens the hand and curls the claws. Cheap, springy, and tested by sinking him low and making him reach at a player on the rim.
- **The quake shakes the camera, not the room.** The engine sets the camera fresh each frame before the room's update, so the room adds a small layered-sine offset and roll on top through `ctx.player.camera`. Nothing builds up, collision is untouched, and preview mode (no player) never shakes.
- **Cold air is smoke, hot air is streaks.** The gust (and the ice monster's roar) draws camera-facing puffs with a per-instance fade and seed, so each has its own drifting wisps; the monster's breath uses the same puff pools (`puffs.ts`): additive for fire, cooling white-hot → orange → red with age, normal-blended for frost. The old wind streaks are gone. Falling rocks are one 70-rock instanced pool.
- **The roar's push carries further** (out to 20 m) so it still clears the wider path.
- **One `frost` value drives everything.** It runs 0..1 over 4 s and splits into `drain` and `ice` uniforms that every TSL material reads, so the change can reverse from anywhere mid-way.
- **The floor is built once and shared.** It is a module-level layout built in small pieces with `breathe()`, so a mount only copies it.

## Leaner screen output and compressed downloads — Unreleased (2026-11-26)

### Changed

- **One full-screen pass instead of two** — `PortalRipplePass` now applies tone mapping and the sRGB conversion in its own shader and draws straight to the canvas. The desktop profile no longer asks for a multisampled canvas.
- **Compressed downloads** — the build writes Brotli and gzip copies of its scripts, styles, models and HDR image (`scripts/precompress.ts`), and the server sends them to browsers that accept them.

### Design & engineering decisions

- The 4× MSAA buffer smoothed nothing: rooms are drawn into a single-sample target, and only a full-screen quad reached the multisampled buffer. With tone mapping set on the renderer, Three also routed that quad through an extra buffer and a second full-screen pass. The picture is meant to be unchanged, and the GPU memory and fill work for both are gone.
- If something is ever drawn directly to the canvas on a profile that uses the ripple pass, it gets no antialiasing and, inside `composite()`, no tone mapping. Draw it inside `renderScene` instead.
- Compressing once at build time costs a few seconds per build and nothing per request. The server only picks a file, so it stays dependency-free.

## Fully automated open PR validation, auto-merge & live deploy — Unreleased (2026-11-27)

### Added

- **Open PR validate, auto-merge & live Railway deploy workflow (`.github/workflows/pr-automerge.yml`, `.github/workflows/deploy.yml`, `.github/scripts/automerge-policy.mjs`)**:
  - Automatically runs on every open non-draft PR targeting `main` via `pull_request_target` — including PRs from **first-time external fork contributors** — with no collaborator invite or manual maintainer "Approve and run" / "Merge" click required.
  - Strictly isolates untrusted PR validation (`validate` job: read-only `contents: read`, `persist-credentials: false`, zero Actions secrets, no `main` pnpm cache writes, exact SHA merge check) from the trusted base-branch `gate` and serialized `merge` jobs.
  - Blocks auto-merge on PRs touching `.github/` (protecting CI workflows, this policy module, and `RAILWAY_TOKEN`), draft PRs, PRs labeled `hold` / `do-not-merge` / `manual-merge` / `wip`, oversized PRs exceeding the GitHub files API pagination cap, and conflicting PRs — posting/updating a single sticky status comment with actionable fix or rebase instructions.
  - Chains directly into the shared reusable Railway deploy workflow (`.github/workflows/deploy.yml`) after merging (working around GitHub's restriction where `GITHUB_TOKEN` merges do not trigger `on: push` workflows), re-validating merged `main` first if another PR landed concurrently.
- **Unit test suite for auto-merge policy (`packages/core/src/__tests__/prAutomergePolicy.test.ts`)** covering allowed room/code PRs, `.github/` path & rename protection, hold labels, draft/non-main/head-moved guards, pagination caps, merge conflicts, and sticky comments.

### Changed

- **Refactored `.github/workflows/rooms.yml`** to focus on `push` / `workflow_dispatch` validation and call the shared `.github/workflows/deploy.yml` reusable workflow (eliminating duplicate PR runs and first-time-contributor "awaiting approval" banners).
- **Enhanced `scripts/submit-world.mjs` (`pnpm submit`)** with read-only pre-flight merge conflict detection (`git merge-tree --write-tree`) against `upstream/main`, `--force-with-lease` on personal fork branches after rebases, `--branch main` guard, optional `--wait` / `-w` polling until auto-merge completes, and updated tests in `packages/core/src/__tests__/submitWorld.test.ts`.
- **Updated contributor & agent docs (`AGENTS.md`, `README.md`, `COLLAB.md`, `.github/pull_request_template.md`)** so anyone finding the repo and their coding agents know they can add rooms or improve code and ship live automatically via `pnpm submit`.

### Design & engineering decisions

- **Why `pull_request_target` with strict job isolation instead of `pull_request` + `workflow_run`:** GitHub pauses `on: pull_request` workflows for first-time contributors from public forks until a maintainer manually clicks "Approve and run" (as happened on PR #7), and `GITHUB_TOKEN` cannot approve fork runs via API. Splitting `pull_request_target` into a zero-secret, read-only `validate` job (merging the exact verified `head_sha` with `persist-credentials: false` and no cache writes) plus base-branch-only `gate` / `merge` jobs and a separate reusable `deploy` job gives true zero-touch onboarding for strangers while keeping `RAILWAY_TOKEN` and `.github/` strictly isolated from untrusted PR code.
- **Why reusable `deploy.yml` instead of relying on `on: push`:** Merges performed by `GITHUB_TOKEN` intentionally do not fire downstream `on: push` or `workflow_dispatch` events. Invoking `.github/workflows/deploy.yml` via `workflow_call` shares the exact `railway-production-deploy` concurrency group across both direct pushes and auto-merged PRs without requiring an extra Personal Access Token secret.

## Midnight Cassette Station (`doug-cassette-station`) — Unreleased (2026-11-27)

### Added

- **New room `doug-cassette-station` (`worlds/doug-cassette-station/`, `"Midnight Cassette Station"`, owner `douglascalhoun`)**, added after `honey-hood` in `registry.json` (connecting seamlessly into `eric-world` so its soft cyan/rose holographic aesthetic bridges directly into Eric's holographic studio).
  - **Nostalgic blue-hour rain atmosphere & TSL WebGPU shaders (`shaders.ts`, `terrain.ts`)**: fog-exempt blue-hour twilight sky dome with crescent moon, twinkling stars, and rose dusk clouds; rain-slicked dark slate promenade with glowing moss seams, mirror-like neon-reflecting puddles, continuous raindrop micro-rings, and live player footstep splash ripples; 1,600 falling diagonal raindrops; and 9 GPU-undulating translucent **holographic koi fish** swimming overhead through the mist.
  - **Handcrafted nostalgic cyber-station vignettes (`scenery.ts`)**: giant translucent spinning **Cassette Archway** spanning the promenade, overhead glowing paper lantern catenaries, rain-sheltered waiting gazebo with retro CRT departure board, umbrella stand & sleeping calico cat, row of 3 illuminated Japanese vending machines (Warm Matcha, Peach Fizz, Star Ramune), open-air 24H Tea & Ramen stall with swaying *noren* curtains and rising bowl steam, 5 stacked 1990s CRT monitors under a glass rain canopy, glowing red payphone booth, glowing moss & cyber-bonsai planters, misty twilight skyline billboards, and a silent elevated commuter train gliding across the rear glass viaduct.
  - **Interactive experiences & calming lo-fi soundscape (`interactions.ts`)**: 5 recessed neon glass synth pads playing warm Rhodes tones in Portalverse's shared B major / G# minor key, vending machines that chime and project floating holographic drinks, a CRT shrine that switches retro channels when approached, a singing payphone booth, a purring station cat, puddle footsteps, active-only gentle filtered pink-noise rain audio, and 5 hidden glowing mixtape cassettes with an unobtrusive lo-fi discovery toast.
  - Added soundtrack mix in `packages/core/src/audio/musicMix.ts` and unit tests in `worlds/doug-cassette-station/cassetteStation.test.ts`.

### Design & engineering decisions

- **Distinct collective niche**: intentionally pivoted away from a daytime grass meadow (which overlapped `jp-world`) to an unoccupied mood in the Portalverse collective — **nostalgic, calming, rain-washed lo-fi cyberpunk** — offering warm amber shelter and playful retro surprises without competing with `laser-lab`'s high-energy rave or `jp-loft`'s interior apartment.
- **Smooth loading & zero asset bloat**: 100% procedural WebGPU/TSL shaders, geometry, and crisp CanvasTextures (~0.08 MiB folder size vs. the 12 MiB budget) with `await ctx.breathe()` yields across mount phases and strict active-only cleanup for Web Audio and DOM toasts.

## One-command fork & PR world submission (`pnpm submit`) + conflict-free room tests — Unreleased (2026-11-27)

### Added

- **Automatic fork & PR helper (`scripts/submit-world.mjs`, `pnpm submit`, `packages/core/src/__tests__/submitWorld.test.ts`)** — lets any community contributor (or their coding agent) submit a new world with one command even if they cloned `ericrius1/portalverse` directly with no fork yet and committed on `main`. Automatically checks `permissions.push`, moves commits off `main` onto `<handle>/<room-id>`, creates/reuses their GitHub fork non-interactively via `gh repo fork`, pushes the branch, and opens/updates a Pull Request against `ericrius1/portalverse`.
- **Pull Request template (`.github/pull_request_template.md`)** — lightweight checklist for room submissions.

### Changed

- **Contributor & agent submission docs (`AGENTS.md`, `README.md`, `COLLAB.md`)** — added explicit Path A (external contributor fork + PR via `pnpm submit` or raw `gh` commands) alongside Path B (maintainer push to `main`), explicitly instructing agents never to stall on `403 Permission denied` or missing forks.
- **Dynamic room catalog tests (`packages/core/src/__tests__/roomPortals.test.ts`, `handoffAndRegistry.test.ts`)** — validate circular portal links and registry invariants directly from `registry.json` instead of duplicating a hardcoded list of every room ID, eliminating unnecessary test failures and merge conflicts when multiple contributors add rooms concurrently.

### Design & engineering decisions

- **Automate the fork + PR path instead of assuming write access** — new contributors cloning `ericrius1/portalverse` hit GitHub `403` errors when their agent followed the old `git push origin main` instructions and stalled because no fork existed yet. Giving both humans and agents a single idempotent `pnpm submit` command (plus explicit fallback `gh` steps in `AGENTS.md`) removes manual browser forking and keeps `main` safe while GitHub Actions auto-deploys every merged PR to Railway.

## Palace live portal projection — `bf18462` (2026-11-26)

### Fixed

- Palace Lagoon's distant live portal no longer shows a solid brown wall when the viewer looks slightly down or sideways. The shared weft adapter now preserves the complete portal projection, including tilted clipping planes and the distance-adjusted lens, in both its main and reflection views. Layer depth is converted directly from the matching reversed projection.

### Design & engineering decisions

- The earlier snapshot fix handled only perpendicular clipping. Reproducing the reported view 21.25 m from the portal with a -0.08 radian pitch showed the adapter falling back to a 0.1 m near plane, exposing geometry behind the doorway. Preserve the supplied matrix instead of approximating it with field of view and near distance; no Palace artwork or material-facing settings change. Regression tests cover near/far views, pitch/yaw, doorway occlusion, pixel/depth agreement and reuse of the shared camera.

## Palace portal snapshot clipping — c30b33d (2026-11-26)

### Fixed

- Preserve a standard preview camera's near clipping distance through the shared weft adapter, including its reflection cameras and depth conversion. Palace Lagoon snapshots now clip geometry between the capture camera and the entrance instead of photographing the back of nearby walls.

### Design & engineering decisions

- The snapshot camera already placed its near plane at the doorway (15.5 m ahead), but the adapter reset it to 0.1 m. Recover the near plane from the WebGPU projection so clipping happens before geometry can occlude the room. Keep existing behavior for oblique live views, whose tilted planes cannot be represented by a scalar near distance. No Palace geometry or material-facing settings changed. Verified the cached snapshot with live portal rendering temporarily disabled.

## Music opt-in on arrival — Unreleased (2026-11-26)

### Changed

- Music starts muted on every page visit, including browsers that previously saved music as enabled. The Music button or N enables it for the current visit, and the initial button markup reflects the muted state.

### Design & engineering decisions

- Keep entering the world separate from consenting to music. Stop restoring the old saved mute preference so a previous visit cannot cause unexpected playback; music remains enabled across room changes until muted or the page is reloaded.

## Visages performance, persistent liquid footsteps and custom portal alignment — Unreleased (2026-11-26)

### Changed

- Added offline Blender medium/far head and eye assets while preserving the original close-up mesh, winner A eye material, per-head weathering and endless row layout. Each scene pass now selects detail from its own camera distance and culls individual heads; rubble and pillars use spatial batches with bounds. Removed runtime far-head decimation and the old fixed-Z detail split.
- Replaced the rings attached to the moving player with a bounded history of alternating foot impacts. Waves remain at their world positions, expand with soft crests/troughs, and dissipate over three seconds. Only near-ground impacts in liquid emit waves; teleports, stationary feet and airborne travel do not create trails. Leaving the room clears transient impacts.
- Custom route-gate previews and continuous crossings use the actual upright doorway frame rather than a separate safe teleport spawn. This retains Palace Lagoon's safe summit landing without offsetting its outgoing portal view or return crossing.

### Design & engineering decisions

- Shared geometry already saved loading work; the remaining cost came from submitting the full avenue and shading it. Preserve the full near material/mesh and use 9.3k/2.5k skin LODs and 1.2k/472-triangle eye LODs farther away. Camera-specific selection also applies to portal and snapshot views. Avoid baking/replacing the approved crack/grime shaders while visibility/geometry savings address the observed frame pacing.
- Use twelve reusable ripple slots rather than a fluid simulation: fixed-cost expanding wave packets produce a persistent trail without unbounded allocation. CPU liquid detection samples the same procedural texture data as the shader, with a conservative wetness threshold.
- The blank local Palace portal was reproduced as Vite's `504 Outdated Optimize Dep` after a dependency update; restarting the local client rebuilt its cache. No room-link removal or Palace artwork change was needed. Reciprocal local crossings were checked after the restart.

## Visages approved lighting and hidden development controls — Unreleased (2026-11-26)

### Changed

- Set production and development defaults to the user's approved screenshot: **50% room brightness, 55% blood brightness, blood color `#86090b` (approximately 359° hue)**. The same settings drive lights, reflections, pool colors and face trails, retaining the dark patches in the liquid.
- Visages development controls start hidden and toggle with **H**, matching Abyss's tuning shortcut (Abyss uses I for its island editor). Opening releases pointer lock; leaving the room removes the panel and shortcut. Production builds include neither the panel nor the shortcut.
- Updated the portal arrival regression test to retain Palace Lagoon's newer courtyard spawn after syncing main, while continuing to check standard entrance alignment for the other rooms.

### Design & engineering decisions

- Apply approved settings outside the development guard so the deployed room matches the chosen local appearance. Keep optional browser overrides separate and reset their storage version to the newly approved baseline; panel visibility is never persisted.

## Final Avenue of Visages, winning eyes and local tuning — Unreleased (2026-11-26)

### Changed

- Promoted the synthesis to **Avenue of Visages**, using the blind comparison's winning A eye treatment (Claude's black moon-mirror eyes) across every avenue head. Its stable room ID remains `jp-visages-synthesis`.
- The normal portal loop now runs **Abyss → Avenue of Visages → Palace Lagoon**. The three earlier rooms are marked `comparisonOnly`: they stay tracked and accessible through `?tour=visages`, but no longer appear in the normal directory, route or preview window. The optional A–D eye study keeps all four original eye treatments.

### Added

- Development-only Visages panel with room brightness, blood brightness, blood hue and a color picker, plus reset. Changes update lights and shader uniforms immediately; blood color also updates the face trails while retaining darker pool interiors. Settings persist in this browser's local storage. The panel mounts only for the active room and its module is excluded from production builds.

### Design & engineering decisions

- Preserve the experiments before promoting the winner: commit `ac5acb0` contains all four room implementations, and `8bdac66` records the darker weathering and blind A–D study, on feature branch `jp/visages-final`.
- Use the same eye-material factory for A and the final room so the chosen treatment stays exact. Retain comparison access without making visitors walk through abandoned alternatives. Keep tuning local and development-only so experiments never rewrite shared production defaults or affect other rooms.

## Visages: blind A–D eye comparison — Unreleased (2026-11-26)

### Added

- `?eyes=compare&world=jp-visages-synthesis` adds four side-by-side, upright comparison heads near the entrance in the synthesis room's existing lighting and scenery. Matching scale, geometry, grime, cracks and blood trails isolate the four eye treatments; only A–D labels appear in the scene. The fixed shuffled answer key is kept in `worlds/jp-visages-synthesis/eyeStudy.ts`.
- Comparison heads and plinths have collision protection while leaving the central portal route clear. Share links preserve the optional view, and the ordinary avenue remains available without the query flag.

### Design & engineering decisions

- Let the user choose eye materials in context without knowing their authors. Preserve each treatment's highlight/reflection settings, align analytic moon glints to the synthesis sky, and use identical faces at equal height so the comparison is about eyes rather than competing room art. A stable ordering keeps letters meaningful across reloads and later feedback.

## Visages synthesis: darker light, subdued blood and weathered faces — Unreleased (2026-11-26)

### Changed

- Reduced the synthesis room's moonlight, ambient and cross-corridor fill, and red bounce while retaining silhouette light and glossy eyes. Darkened the blood's shallow and deep colors, reduced its added glow and reflection strength, and preserved its depth patches, wet borders and ripples.
- Strengthened varied vertical face stains, added broad charcoal/mineral deposits, extended grime above the buried chin, and subdued fresh pale chips. Face direction, layout, crack relief and the three original variants remain unchanged.

### Design & engineering decisions

- Follow the user's request for a darker, long-forgotten realm without making it as dark as the darkest comparison. Reduce fill lighting more than rim lighting to retain readable silhouettes, and darken the blood material itself so its added glow cannot overpower the mood. Patchy, per-head grime restores the original Neon's dirty stone character rather than merely lowering every face's brightness uniformly.

## Portal arrival and preview alignment — Unreleased (2026-11-26)

### Fixed

- Route-gate spawns place players 0.5 m inside the destination room, while portal previews and continuous crossings use the exact gate plane through `RoomInstance.portalAnchor()`.

### Design & engineering decisions

- Separate safe arrival positions from portal alignment anchors so entering a room clears the doorway without shifting the preview or continuous crossing by the same inset.

## Visages — Synthesis (fourth comparison room) — Unreleased (2026-11-26)

### Added

- **New room `jp-visages-synthesis` (`worlds/jp-visages-synthesis/`, `"Visages — Synthesis (Neon)"`)**, added right after `jp-visages-codex` in `registry.json` while keeping the three original blind implementations (`jp-visages`, `jp-visages-claude`, `jp-visages-codex`) byte-for-byte untouched for side-by-side comparison.
  - Synthesizes the strongest visual qualities from each study based on user critique: Neon's overall composition, ruined monolith pillars, scattered rubble, pale stone visages with dark smudges, readable moonlit lighting, and shader-integrated organic blood pools (wet halos, arterial color/depth shifts, ambient + live footstep ripples); Claude's metric recessed & asymmetrically patchy face cracks, thin multi-rivulet blood trails weeping from the eyes, moon-and-cloud night sky, and textured uneven dirt beside the road (without triangular snow particles); and Codex's truly endless procession (`29` pairs / `58` upright heads spanning `±392 m` with near/far LOD) and rich HDR environment reflections on glossy obsidian eyeballs.
  - **Single-layer cobblestones (`textures.ts`)**: replaced Neon's overlapping multi-scale Voronoi noise (which produced "cobblestones within cobblestones") with one coherent 512×512 seamless laid-stone atlas storing exact mortar edge distance, per-stone constant tone/elevation ID, beveled convex crown height, and occasional hairline fractures strictly confined inside ~28% of individual stones, paired with a separate non-Voronoi mineral grain map.
  - **Non-tiled 3D rubble & pillars (`index.ts`)**: switched rubble and ruined monolith shading to per-instance offset 3D procedural noise (`aRubble` / `aPillar` instanced attributes) so boulders and obelisks never show tiled 2D skin.
  - Added soundtrack mix (`packages/core/src/audio/musicMix.ts`), unit tests (`worlds/jp-visages-synthesis/visagesSynthesis.test.ts`), and honest asset provenance (`worlds/jp-visages-synthesis/CREDITS.md`).
- **Four-room `?tour=visages` loop (`roomTour.ts`, `app/main.ts`, `roomTour.test.ts`)**: extended `VISAGES_TOUR` to **Neon → Claude → Codex → Synthesis → Neon** (and reverse through entrance portals), removed hardcoded `3` counts/labels in the HUD and tour validation/tests, and kept the normal full-world catalog loop intact.

### Design & engineering decisions

- **Fix nested cobblestones structurally rather than tuning noise weights.** User critique called out Neon's biggest flaw as a larger Voronoi pattern overlaid on a smaller Voronoi pattern with no alignment, plus tiled stone skin on rubble. Encoding one coherent primary stone layout in `cobbleTex` (with per-stone IDs and boundary-clipped internal fractures) and removing Voronoi completely from the mineral grain texture (`stoneNoiseTex`) guarantees internal stone detail reads as wear/grain or isolated cracks rather than a competing cobblestone grid.
- **Unite Claude's recessed face detailing with Neon's brighter readability and Codex's endlessness.** Using screen-space metric height derivatives (`bumpNormal`) gives face cracks the appearance of carved depth without changing the mesh, while per-head directional bias (`crackAngle`, `crackDensity`) makes cracks cluster asymmetrically across faces. Combining Codex's equirectangular HDR reflection map with Claude's analytic moon glint and `FogExp2` (`VOID_DARK`) delivers crisp mirror reflections on the black eyeballs and crimson pools that fade smoothly into darkness well before the `±392 m` rows end.
- **Keep original blind rooms unchanged.** Preserving `worlds/jp-visages/`, `worlds/jp-visages-claude/`, and `worlds/jp-visages-codex/` byte-for-byte lets anyone walk `/?tour=visages` and compare all four rooms directly.

## Visages comparison portal loop — Unreleased (2026-11-26)

### Added

- Integrated the independently built `jp-visages-claude` and `jp-visages-codex` rooms alongside Neon's `jp-visages`, including their assets, credits, tests and soundtrack mixes. The full catalog now places the three variants together after `jp-abyss`.
- Open `/?tour=visages` to start in Neon and walk a closed **Neon → Claude → Codex → Neon** loop. Walking back reverses that order. The HUD identifies the variant and its position in the comparison; portal labels identify the destination. Share links and URL updates preserve the tour on reload. All three default arrivals start just inside the entrance gate, so each walk covers the full path.

### Design & engineering decisions

- Keep the blind implementations visually unchanged. Both were completed independently before integration; this change only connects them for comparison. A shared startup catalog selects the same three-room order for the directory, mounted gates and preview loading, while the ordinary URL keeps the full world loop. Multiplayer still uses the existing room IDs; no server protocol or room-geometry changes are needed.
- Limit the comparison directory and dynamic links to its three rooms, so a normal shared-world portal or roster shortcut cannot unexpectedly leave the comparison. Tour selection is per browser and does not rewrite the persistent catalog.

## Visages (Claude variant): endless rows of colossal stone heads — Unreleased (2026-11-26)

### Added

- **New room `jp-visages-claude` (`worlds/jp-visages-claude/`)**, JP's, placed beside the other Visages variants in the comparison integration. Two rows of colossal heads, buried to the chin, face each other across the path. Each head is about 40 m tall and carved from ancient stone, cracked, stained and lichened. Their eyes are polished black and catch the moon, and some of them weep blood down their cheeks. The path is rough matte cobbles with pebbles and loose stones, and wet red pools lie along it, rippling now and then. The rows, the path and the rubble run about 400 m past both portals and fade into fog and night, so the avenue seems to go on forever. Ash drifts down through the dark.
- **Head model processing (`headModel.ts`)** — the supplied `female_human_head_game.glb` (shipped unmodified, ~1 MB, no textures, no compression) is used upright, as modelled, facing +Z. At load we split the two loose eyeballs from the skin (connected components), centre the skull between the eyes, trim the shoulders (they are always underground) and build a vertex-clustered far copy (~32k → ~10k triangles) for heads deep in the fog. Every head and eye is instanced.
- `layout.ts` (seeded terrain, head rows, blood pools, stones), `visages.test.ts`, `CREDITS.md`, a registry entry and the room in both expected-order tests.
- `packages/core/src/audio/musicMix.ts` — a `ROOM_VIBES` line for the new room (the eerie abyss stems), which the soundtrack test requires for every room in the loop.

### Design & engineering decisions

- **Not tilted.** With its node transform applied, the bust already stands upright and looks straight ahead. Each head only turns about Y (±90° plus a little jitter) to face the path, and sinks so its chin meets the ground, as in the reference image.
- **"Forever" means fog, not geometry to infinity.** The rows stop at about ±400 m, inside the 450 m draw distance. Exponential fog matches the sky's horizon colour, so the far heads fade into the dark instead of ending. Heads more than 140 m from the middle use the decimated skin, which the fog hides.
- **Procedural everything else.** The stone, the cobbles, the blood and the sky are TSL node shaders with screen-space bump, so the room ships one asset. The black eyes and the blood pools fake their mirror reflections (sky, cloud light and a sharp moon glint), so they read as shiny and liquid without an environment map.
- **Loading.** The model is processed once per page and cached as typed arrays, and each mount wraps them in its own geometries and disposes them. The long loops (welding, splitting, decimating, building the ground) yield through `breathe`.
- **Safety.** The path is dead level (y = 0) within 5.5 m of the centre line, so it passes level through both portals, which stay clear. Walk bounds of ±12 m keep players, even flying ones, between the rows and out of the noses.

## The Unending Witnesses — Codex — Unreleased (2026-11-26)

### Added

- **`jp-visages-codex` / The Unending Witnesses — Codex**: two ranks of 30-metre upright stone heads facing a flat, rubble-strewn portal path, with glossy black eyes, fractured limestone, mineral streaks, and irregular crimson pools with subtle animated ripples. Forty-two heads continue from z=-320 to +320, far beyond both route gates, fading into black distance fog.
- Prepared the supplied female head GLB into separate stone and eyeball surfaces, with original detail near the route and a clustered distant mesh. Included reproducible preparation and honest source/unknown-license provenance in the room's credits. Registered the room with JP's ownership and updated route-order expectations.

### Design & engineering decisions

- Follow the supplied reference's ancient stone / black eyes / red liquid contrast while honoring the request for level, inward-facing heads. Preserve the supplied face and eye shapes, remove the shoulders, and use physically reflective eyes and liquid against fully matte ground.
- Keep the gates incidental to a much longer procession: rows and ground continue deep into fog, with no end walls or final statues visible. Reserve a clear centre lane at y=0 through both portals and give each head a conservative collision envelope.
- Use instancing, a distant model variant, small generated reflection data, cooperative setup yields, and mount-owned resource disposal. The existing soundtrack contract requires a room blend, so add a quiet abyss-only mix to the shared audio catalog. No engine behavior or other-room edits are needed; the room remains below 1 MiB of bundled assets/code.

## Avenue of Visages room (`worlds/jp-visages`) — Unreleased (2026-11-26)

### Added

- **Fourteenth room, `worlds/jp-visages/`**, placed between `jp-abyss` and `eric-palace-lagoon` in the loop: two endless rows of colossal, upright ancient stone heads facing inward across a rough matte stone path pooled with glossy red liquid, flanked by jagged ruined monolith pillars and piles of broken rubble.
  - Uses `worlds/jp-visages/assets/female_human_head_game.glb` (996 KB, uncompressed), split once at load time (`headGeometry.ts`) into two cached geometries: the weathered ancient limestone visage (with buried shoulder geometry trimmed below ground) and its two separate glossy obsidian-black eyeballs.
  - 42 instanced heads (`21` opposing pairs at `28 m` intervals from `Z = -280 m` to `+280 m`, ~25 m tall above the rubble floor) extend well past both portals (`Z = ±36.25`) and fade seamlessly into pitch darkness (`#04060b`) so the corridor reads as infinite in either direction.
  - WebGPU TSL ground shader pairs ultra-matte fractured pale slate stone (`roughness: 0.96`) with domain-warped glossy crimson liquid pools (`roughness: 0.06`), wet stone rims, cold moonlight Fresnel reflections, and live concentric ripples around the walking player.
  - Registered in `registry.json`, assigned the eerie abyss stem blend in `packages/core/src/audio/musicMix.ts`, and verified in `worlds/jp-visages/visages.test.ts` plus updated catalog tests.

### Design & engineering decisions

- **Split the single-primitive GLB by welded connected components at load time.** The source GLB shipped as one primitive with a single material, but its two eyeballs are clean disconnected mesh islands (`988` and `986` vertices). Splitting them once into `skin` and `eyes` (and computing exact local eye centers) lets us shade the skin as matte fractured ancient limestone with cavernous dark eye sockets and weeping rust-crimson streaks while rendering the eyeballs as high-clearcoat obsidian glass with crisp moonlight and red-pool glints — all in just two instanced draw calls.
- **Bury the bust shoulders below ground and drop underground triangles.** Sinking the model to `HEAD_SINK_Y = 3.05` rests the colossal chins naturally in the rocky rubble while culling triangles fully below ground cuts vertex work across the 42 instances.
- **Extended walk bounds (`Z ∈ [-175, +175]`) with radial darkness fade finishing by `238 m`.** Players can walk or fly past either portal down the avenue without ever reaching the end of the rows or seeing a far-plane clip edge.
## Smooth 60+ fps shadows in Palace Lagoon — Unreleased (2026-11-26)

### Fixed

- **Flip-book low-framerate shadow stepping (`worlds/eric-palace-lagoon/renderer.ts`, `shaders/common.wgsl`)** — `SHADOW_REBAKE` was set to `0.004 rad` (`0.23°`), which at low grazing sunset altitude (`+4.2°`) only re-baked the orthographic shadow map every ~15–25 frames while walking, making column and tree shadows jump in ~3–5 fps flip-book steps across the colonnade. Lowered `SHADOW_REBAKE` to `1e-5 rad` (so shadows glide at full display framerate while walking and still skip the shadow pass completely when standing still or during the dark sun→moon swap), fixed `frameDusk` to include `this.player[1]` (`y`) so climbing the spiral keeps shadows synced with time-of-day, tightened the shadow ortho frustum (`halfWidth: 200 → 155 m`, +66% texel density across the full walk bounds), upgraded `sunShadow()` to a smooth 3×3 Gaussian PCF kernel, and triggered a bake when `baseReady` settles so tree/path shadows are always present on frame 1.

### Design & engineering decisions

- **Update the single depth-only shadow pass on every moving frame rather than quantizing sun angle.** At grazing sunset angles (`< 5°`), even a `0.1°` angular deadband translates into tens of centimetres of visible shadow teleportation across vertical columns; keeping the zero-movement short-circuit (`turned <= 1e-5`) preserves zero shadow cost when stationary while making shadow motion completely fluid while walking.

## Palace Lagoon: confine exit portal inside the circular ring & keep Alhambra tiled dome solid — Unreleased (2026-11-26)

### Fixed

- **Exit portal aperture confined strictly to the summit ring (`worlds/eric-palace-lagoon/domePortal.ts`)** — moved the live destination portal aperture off the 34 m dome vault onto a circular `CircleGeometry` strictly inside the `2.55 m` glowing summit portal ring, and made the Alhambra / Granada Spanish ceramic tile dome a solid, opaque inner vault (`depthWrite: true`, no radial dissolve) so everything outside the circular portal stays tiled Granada ceramic work instead of being taken over by the next room.

### Design & engineering decisions

- **Standard upright portal frame at the spiral summit** — placing the portal root upright at `PORTAL_THRESHOLD_FRAME` (`useFullOrientation` omitted) gives the summit portal exact 1:1 perspective-correct projection, seamless mirrored 3rd-person walk-through crossings, and 2-room-deep live previews, while depth-testing cleanly in front of the opaque Alhambra dome and behind the weft-drawn cedar handrails.

## Palace Lagoon Alhambra Granada tile dome, warm cedar spiral, colonnade entrance & obvious portal threshold — `4b02527` (2026-11-26)

### Changed

- **Longer ground approach starting behind the north colonnade arches (`worlds/eric-palace-lagoon/layout.ts`, `index.ts`, `path/curve.ts`, `path/mesh.ts`, `shaders/common.wgsl`, `shaders/lanterns.wgsl`, `trees/placement.ts`, `registry.json`)** — moved Palace Lagoon's entrance portal and default spawn back into the sunlit courtyard behind the monumental 4-column garlanded north colonnade portico (`(-13.05, 0, 61.05)`, facing through `(-6.27, 53.30)`), nearly doubling the ground walk to ~63 m through the classical arches, golden meadow, reflecting lagoon cove boardwalk, and rotunda north arch before ascending. Extended `onWalk` in `common.wgsl` so meadow grass and ground bronze lanterns stay clear of the new wooden approach.
- **Single fluid wooden ascending spiral with zero 90° turn (`worlds/eric-palace-lagoon/path/curve.ts`, `path/mesh.ts`, `path/path.wgsl`)** — removed `SUMMIT_DECK` and the sharp 90° turn into `SUMMIT_RANGE`, replacing them with a single C1-continuous analytical spiral (270° outer nave sweep smoothly joining a constant `7.0 m`-radius inner sweep) climbing at a steady ~17° grade straight across `(0, 26.2, -14)` heading `-Z`. Rebuilt the spiral deck and structure as handcrafted warm Spanish cedar planks, carved dark-walnut timber beam stringers, solid walnut box-girder underside & knee-brackets, wood-and-brass railings with hanging Moroccan lanterns, carved walnut/brass Moorish horseshoe arches (transitioning to glowing cyan-gold portal-beacon arches near the top), and a subtle anti-aliased Granada *azulejo* ceramic center runner — eliminating the noisy black-and-white procedural pattern.
- **Granada / Alhambra Spanish ceramic tile dome & unmistakable portal threshold (`worlds/eric-palace-lagoon/domePortal.ts`, `index.ts`, `assets/alhambra-dome.jpg`)** — replaced the polar-stretched procedural dome shader with a high-detail circular Granada Alhambra Nasrid ceramic zellige dome texture (1024×1024 JPEG, 566 KB, preloaded inside `mount()` so teleports wait for it too) mapped with seamless azimuthal equidistant projection (zero polar pinching or UV seam), kiln-fired Fresnel ceramic luster, and a 16-petal molten-gold radial dissolve blooming earlier (`24 m → 9 m`). Mounted an unmistakable glowing Portalverse energy ring, spinning halo, glowing threshold sill bar, translucent shimmer rim, and floating destination room sign (`createFloatingLabel`) right across the wooden spiral at `(0, 26.2, -14)`.

### Design & engineering decisions

- **Analytical piecewise-C1 outer + `R = 7.0 m` inner circular spiral.** Spline approximations tended to tighten turn radius near the dome zenith or dip vertically off `ENTRY_PLAZA`; joining the 270° outer nave sweep tangentially onto an exact `R = 7.0 m` arc centered at `(-7, 0)` guarantees `minTurnR = 7.0 m` everywhere, zero dips, zero pier hits, and dead-straight `-Z` crossing at `(0, 26.2, -14)` aligned with the dome portal's live preview orientation.
- **Azimuthal equidistant UV projection for the Alhambra dome.** Mapping a circular Nasrid ceiling artwork directly from zenith angle `rho = acos(-nz)/(pi/2)` avoids spherical-UV pole pinching and eliminates the 2π seam while putting the 16-pointed zenith rosette cleanly at the crown and the gilded cornice band cleanly along the dome springline.

## Palace Lagoon R2 mirror, full-load teleport overlay, spiral walking fix & weft 0.2.19 anti-z-fighting — `0e9f0ba` (2026-11-26)

### Fixed

- **Palace mesh blocked in live production (`worlds/eric-palace-lagoon/layout.ts`, `renderer.ts`, `index.ts`)** — `sf-assets.ericrius1.workers.dev` enforces an origin allowlist that returned `403 x-world-assets: blocked-origin` for `https://portalverse-server-production.up.railway.app` (while allowing `localhost:5173`), causing the Palace geometry to silently fail forever while bundled `palace.json` colliders stayed active as invisible walls. Mirrored `palace.bin` (SHA-256 verified) onto Portalverse's own CORS-open R2 worker (`https://portalverse-assets.ericrius1.workers.dev/objects/8112524c5b092f2953325f69669b94d3356e15d0d02cf3544d12dc0ce6b27667/palace.bin`), removed the 15 s `Promise.race` cutoff that opened the room mid-download on 5 Mbps links, added retryable `ensureReady()` (so transient failures never permanently cache an empty Palace), skipped the 1.6 s dither reveal when the mesh is already loaded before the first frame, and gated Palace colliders on `lagoon.hasPalace` so an unreachable mesh can never create invisible walls.
- **Teleporting to uncached rooms on slow connections (`app/main.ts`, `app/styles.css`, `WorldEngine.ts`, `PortalPreviews.ts`, `Soundtrack.ts`)** — local teleports (Rooms list, Explorer roster clicks, and un-preloaded portals) now check `engine.isRoomReady(worldId)` and, whenever the target room still needs to download assets or compile shaders, show the `#warp-overlay` loading screen, lock input until `engine.mountWorld()` completes and paints the new room's first frame, and bypass any prior 5 s background retry backoff on urgent `travelTo()` calls. Also changed `Soundtrack.load()` to trickle non-initial stems sequentially instead of firing all 9 audio fetches concurrently so background music doesn't starve room teleports on a 5 Mbps connection.
- **Spiral stairway bouncing & glitching (`worlds/eric-palace-lagoon/path/curve.ts`, `packages/core/src/engine/AvatarController.ts`)** — fixed `pathSurface()` taking `Math.max` across every path segment within the 1.74 m half-width radius (which returned uphill spiral segments up to `+0.843 m` above the actual visual deck and caused violent vertical snapping on lateral movement), and extended the spiral's top plateau from `v = 0.955` to `v = 0.925` so it arrives flush before meeting `SUMMIT_DECK` (removing a 32 cm edge step). Each contiguous strip now contributes only its single closest centerline point (`0.000 m` centerline error across all 250 frames), added smooth `pathCollider` handrail guardrails along the spiral/boardwalk (still allowing jumping over the 0.92 m rail or flying), and scaled downhill `GROUND_SNAP` gently with horizontal step size (capped at `0.55 m`) so sprinting down steep slopes stays grounded even at 25 fps.
- **Z-fighting in Palace Lagoon & weft upgrade (`pnpm-lock.yaml`, `worlds/eric-palace-lagoon/path/mesh.ts`, `palaceMesh.worker.ts`, `renderer.ts`, `path/index.ts`, `shaders/palace.wgsl`, `path/path.wgsl`)** — updated `@ericrius1/weft` from `0.2.17` to `0.2.19` (picking up `0.2.18`'s engine-level anti-z-fighting: automatic per-shader reversed-Z hardware depth bias, semantic `depthLayer`, `@ericrius1/weft/coplanar`, and `clipAtFacing`), tagged `ground`/`palace`/`path` with `'terrain'`/`'base'`/`'detail'` depth layers, switched double-sided `palace.wgsl` and `path.wgsl` to `clipAtFacing(o.world, o.n)`, trimmed celestial slabs out of `ENTRY_PLAZA` and `SUMMIT_DECK` footprints, removed interior segment end-caps and coplanar inlay bottoms, and ran `separateCoplanar()` in both `buildPathMesh()` (dropping coplanar pairs from 7,914 to 32) and `palaceMesh.worker.ts` (separating 9,326 pairs off-thread).

### Design & engineering decisions

- **Mirror Palace mesh to Portalverse's own `portalverse-assets` R2 worker rather than bypassing origin checks.** `portalverse-assets.ericrius1.workers.dev` already serves the soundtrack with open CORS and content-addressed immutable edge caching (`deploy/assets/worker.js`), keeping 5 MB binary data out of git and Railway while honoring `sf-assets`'s hotlink policy.
- **Show `#warp-overlay` only when `!engine.isRoomReady(worldId)`.** Preloaded promenade neighbours still promote seamlessly in zero frames, while cold teleports from the Rooms modal or slow connections block cleanly behind the loading screen until every GLB, HDR, worker mesh, and GPU pipeline is finished.
- **One closest centerline sample per contiguous strip.** Treating a curved elevated ramp as a union of overlapping circles breaks as soon as `halfWidth > segmentLength`; selecting the minimum-distance centerline projection per strip is both exact on curves and immune to uphill look-ahead.

## Open creator infrastructure brainstorm — Unreleased (2026-11-26)

### Added

- `InfrastructureBrainstorm.md` consolidates independent Claude, Codex, and Antigravity assessments and cross-reviews into a proposal for creator-hosted rooms, public registration, execution isolation, package integrity, performance budgets, and branching discovery. The repository evidence is refreshed against the shared-device WebGPU layer API and Palace Lagoon.

### Design & engineering decisions

- Preserve the goal of PR-free publishing and broad creative freedom without presenting signatures, worker isolation, or graphics budgets as stronger guarantees than they provide. The document keeps unresolved tradeoffs explicit and proposes profiling plus isolated-renderer and constrained-runtime prototypes before choosing a public room contract. This is a brainstorm, not an approved runtime implementation.

## Fix frozen controls after falling & respawn + Palace dome mosaic polish — Unreleased (2026-11-26)

### Fixed

- **Controls permanently locked after falling and respawning (`app/main.ts`, `app/mobileControls.ts`, `packages/core/src/engine/WorldEngine.ts`, `packages/core/src/engine/AvatarController.ts`)** — fixed a state-aliasing bug where falling below `fallLimit` triggered `onFallChange(true)` → `closeAllModals()`, which passed `engine.hasFallen` into `engine.setInputLocked(true)` and left `WorldEngine.inputLocked` stuck `true` after `engine.respawn()` cleared `this.fallen`. Players on both mobile touch controls and desktop were completely unable to move, look, or re-lock the cursor after clicking Respawn.
  - Separated UI modal/gate lock (`!gateExited || isAnyModalOpen()`) from `engine.hasFallen` via a single `syncInputLocks()` helper in `app/main.ts`, and blocked opening modals while fallen.
  - Added `lostpointercapture` listeners and safe `releasePointerCapture` cleanup in `app/mobileControls.ts` so interrupted touch gestures during a fall/overlay transition can never strand a touch pointer ID.
  - Restored grounded state immediately in `AvatarController.snapToGroundIfWalking()`, cleared any active portal walk-through on `WorldEngine.respawn()`, and guarded `triggerNearestPortal()` while fallen.
- **Palace Lagoon dome mosaic & attic ceiling cutout (`worlds/eric-palace-lagoon/domePortal.ts`, `worlds/eric-palace-lagoon/shaders/palace.wgsl`, `packages/core/src/engine/PortalPreviews.ts`)** — cut the interior circular aperture out of the solid rotunda attic slab (`mat == PODIUM` above `y = 30 m`) so the overhead mosaic portal is unobstructed to the zenith, upgraded the Moroccan zellige/girih dome to a 24-fold / 10-tier Rub el Hizb star lattice with Shamsa sunburst rays and continuous star-SDF petal dissolve, and softly clamped `framePortal` vertical/lateral parallax for `useFullOrientation` domes so the virtual eye never dips under the destination room floor.

### Design & engineering decisions

- **Keep external UI lock orthogonal to internal engine fall state.** `WorldEngine` already computes effective avatar lock as `this.inputLocked || this.fallen`; feeding `engine.hasFallen` back into `engine.setInputLocked(...)` copied transient fall state into persistent UI lock state. Routing all gate/modal/fall lock transitions through `syncInputLocks()` eliminates the feedback loop for both desktop and mobile controls.

## Palace Lagoon boardwalk over water, arching celestial ascent, Arabic mosaic dome-roof portal & colonnade Z-fighting fix — `3bde4ec` (2026-11-26)

### Added

- **Custom large / overhead route gates (`packages/core/`)** — added `ctx.customizeRouteGate(end, build)` to `WorldContext` (`RoomInstance.ts`, `types.ts`) plus `openingRadius`, `portalCenterY`, `useFullOrientation`, and `arrivalSpawn` on `PortalVisualHandle`. `PortalPreviews.ts` now clips all 8 bounding-box corners in `portalPixels` for curved 3D apertures and maps full 3D aperture orientation rigidly into the destination doorway in `framePortal` (so looking straight up into a ceiling dome portal frames the next room right-side up, above its floor, with true parallax). `portalCrossing.ts` and `WorldEngine.ts` support ascending crossings and clean upright arrival.
- **Earth-style boardwalk over water & trippy arching sky-path (`worlds/eric-palace-lagoon/path/`)** — carved a north reflecting lagoon cove between the entrance and the rotunda's north arch (`layout.ts`, `shaders/common.wgsl`, `shaders/water.wgsl`). Built a procedural weft `RoomFeature` (`path/curve.ts`, `path/mesh.ts`, `path/path.wgsl`) featuring:
  - An Earth `jamwalk.ts`-inspired teak-plank boardwalk on timber piles with brass waterline collars, brass handrails & bronze cables, hanging washi paper lanterns on curved brass crooks with miniature solar tiles, moss/ivy, and terracotta entry pots guiding you over the mirror lagoon and straight through the north arch.
  - An inlaid 8-point Arabic star compass plaza inside the rotunda launching into a dreamlike 360° ascending celestial spiral with procedural iridescent girih tiles, upward-flowing golden-turquoise veins, player footstep glow ripples, 11 floating pointed Moorish ogee rib-arches, an octagonal celestial viewing deck (`y = 24.8 m`), and a final crystal-gold arch rising right into the dome roof (`y = 27.4 m`).
- **Full-dome iridescent Arabic mosaic portal (`worlds/eric-palace-lagoon/domePortal.ts`)** — replaced the exit route gate with a giant 34 m inward-facing hemispherical live portal filling the entire inner dome vault (`y = 25.5..42.6 m`, opening the inner `COFFER` shell in `palace.wgsl` while keeping the outer `DOME` intact). Overlaid a WebGPU TSL iridescent Moroccan zellige & girih star-tile dome shell (16-fold royal Shamsa crown rosette, interlocking Rub el Hizb stars, cobalt/turquoise/emerald/gold glaze with thin-film Fresnel shift) that dissolves tile-by-tile in a molten-gold wave as you ascend closer to reveal the live next room across the entire dome ceiling.

### Fixed

- **Colonnade & podium Z-fighting (`worlds/eric-palace-lagoon/palaceMesh.worker.ts`, `layout.ts`, `shaders/common.wgsl`, `collide.ts`)** — eliminated deep Z-fighting under the 4-column colonnade clusters where Earth's `box_cluster` square pads and `build_wing` stylobate emitted overlapping coplanar `PAVING` faces at `STYLO = 0.2 m` (the worker now lifts cluster pad `PAVING`/`PODIUM` corners by `+2.4 cm`), and depressed `terrainHeight` cleanly under the rotunda podium and colonnade wings so ground geometry never Z-fights with the lowered stone base. Also opened the hollow inner dome cavity in `collide.ts` while preserving outer dome landing.

### Design & engineering decisions

- **Layered mosaic shell over the live portal aperture.** Keeping the iridescent Arabic mosaic as an inner transparent TSL dome shell just inside the live `PortalPreviews` aperture lets live views, snapshot fallbacks, and tile-by-tile proximity dissolution work seamlessly without coupling custom room art into `PortalPreviews`'s internal slot shaders.
- **Full 3D orientation without keyhole warp for giant domes.** Because a 34 m overhead dome spans 60°–150° of the screen, `framePortal` applies a pure rigid quaternion mapping (`Q_dest * inv(Q_src)`) with floor-safe vertical clamping instead of depth-axis shear, preserving distortion-free perspective and right-side-up framing from underneath.

## The Palace at night: the walk through the rotunda, sunset to aurora, projection mapping — Unreleased (2026-11-26)

### Added

- **Projection mapping module (`packages/core/src/rooms/projection/`)** — real projectors for any weft scene, made to be reused anywhere (other rooms, and Earth). `ProjectionRig` keeps up to 16 projectors. Each has a frustum, a lamp, an image painted once a frame into a texture array (`content.wgsl`), and a depth map of what it sees, redrawn only when it moves (a couple a frame). A surface shader `#include`s `light.wgsl`, spreads `rig.bindings` into its draw and adds `projectionTake(albedo) * projectedLight(p, n)`. Light lands only where the projector reaches: columns cast shadows, and the backs of things stay dark. Each projector has a mapping. `throw` is the image in its own frame, as a real projector throws it. `cylinder` and `plane` are the image in a surface's coordinates (calibrated projection mapping: aligned with a rotunda's columns or a façade). Optional: `rig.drones(pass)` draws the drones (graphite pods with nav lights, a strobe and a lens that blazes when you look down its beam), and `rig.beams(pass, depth)` draws the beams in the haze. The beams carry each image, and occluders cut shafts through them.
- **Eight projection programs by Gemini 4 Neon (`programs.wgsl`, `PROGRAMS.md`)** — solarpunk light art: lagoon caustics, komorebi canopy, Maybeck vines, dragonfly venation, golden phyllotaxis (the dome's rosette), unfurling ferns, a mycelial network and evening pollen. Each is dark-first, slow and seedable, and the notes include a choreography guide.
- **The Palace across the walk (`worlds/eric-palace-lagoon`)** — the rotunda now stands on the portal path, at (0, −14) and lowered so its podium deck is the portals' y = 0. You arrive on the lawn, walk up onto the podium, in through the north arch and under the dome. The exit portal stands in the south arch itself (tested: its ring clears the piers). The lagoon lies in front of the rotunda to the east, inside the colonnade's embrace. A gravel walk with 18 bronze lanterns leads to it.
- **Sunset to night along the walk (`timeOfDay.ts`, `shaders/sky.wgsl` by Neon)** — time runs with the walk instead of the clock. Each view takes its time of day from where its eye is (the player's feet in the active room), so a portal preview from the room before shows the sunset and one from the room after shows the night. The arc: the sun going down over the lagoon, the afterglow and the belt of Venus, blue hour, then the moon rising behind you, the Milky Way and a 360° aurora ported from Earth's (it reflects in the lagoon). The key light swaps from the sun to the moon while it's dark, and its shadow is re-baked as it moves.
- **The drones' show (`show.ts`)** — twelve drones. One under the dome's crown throws the phyllotaxis rosette into the coffers, and three around it throw caustics, venation and pollen up the dome. Four outside the rotunda are mapped to its cylinder, climbing the piers with vines, ferns and mycelium. Four over the lawns cover the colonnade's wings. Each dwells ~55 s on a program and crossfades over 6 s, staggered, and drifts between two stations now and then. The show comes up as the dark does.
- **A magical grove (`trees/`, built by a Claude agent from Earth's `web/src/trees`)** — 51 hand-placed hero trees: monumental live oaks hung with lanterns, Italian and Monterey cypresses, weeping willows along both banks, jacarandas and cherries. Around them, 169 shrubs and ferns and 421 trees in the woods on the hills. Crowns are grown as clumps in a worker and lit through a leaf atlas, with wind and gold backlit rims at sunset. At night their florets pulse, willow tips glow teal and glow-seeds rise. Trunks and shrubs are solid (`TREE_TRUNKS`). About 0.45 ms on the 5090 at 1440p.
- **Creatures (`life/`, built by a Claude agent from Earth's `web/src/birds`)** — a 3072-starling GPU murmuration over the lagoon at sunset, with a peregrine stooping through it. It spirals down to roost as dusk deepens and rises again if you walk back. Great egrets stalk the shallows and flush when you come close, a great heron stands on the far bank, and mute swans glide with wakes. At night: 2000 fireflies flashing in rolling synchronous bursts and parting round you, moths spiralling in the drones' beams, and 30 lantern jellies drifting over the lagoon and under the dome, mirrored in the water. About 0.15–0.3 ms.
- **Night lighting** — Earth's baked floodlight share lights the stone's foot warm. The lanterns throw pools on the gravel and the grass. Three.js lights for players follow the walk's light, with a warm lamp near the player at night.

### Design & engineering decisions

- **Real projectors, with surface mapping as a mode (Eric asked for the comparison).** Earth's current Palace show colours the stone by its world position inside each drone's cone. That is cheap and aligned with the architecture, but it has no occlusion, needs a mapping per building, and a moving drone doesn't move its image. A projector with a depth map and a painted image gives shadows, beams and any geometry for free. The `cylinder` and `plane` mappings keep the aligned look where you want it. Earth's show could move onto this module and keep its look.
- **Images are painted once per projector, not per pixel.** A 512² rgba16f layer per projector, painted by one compute dispatch a frame, so a complex program costs the same however much stone it covers. Surfaces pay one sample and one 4-tap depth compare per projector that reaches them. Depth maps (1024²) are redrawn only for projectors that moved, so drones holding station cost nothing.
- **Time of day per view, not per room.** The engine renders a room in several views a frame (the active view and portal previews), so the light is a function of each view's eye, set in that view's uniforms. The walk *is* the clock.
- **The night is dark on purpose.** Earth's floodlights divide by Earth's auto-exposure; here the exposure is fixed, so they're kept to a low warm wash at the stone's foot. That leaves the projections, the lanterns and the aurora to carry the night.
- **Two-sided faces light the side that's seen.** The Palace mesh is drawn with no culling, and some of its faces point away from where they're seen (the dome's underside through the inner dome's crown). The Palace shader turns each normal toward the eye, so the drones' light lands there too.
- **Built with other agents in parallel.** Neon (Gemini 4 Neon) wrote the projection programs and the sky. Two Claude agents built the trees (`trees/`) and the creatures (`life/`) against one interface (`env.ts`: `RoomEnv`, `FrameState`, `RoomFeature`). Each part declares its draws into the room's phased passes (`opaque`, `water`, `sky`, `glow`) and its per-frame computes, and the renderer stays the one place that orders the frame.

## Playable characters, Character Select screen & mobile support — `81f5a30` (2026-11-26)

### Added

- **Extensible playable character system (`packages/core/src/characters/`)** — replaced the static capsule avatar with an articulated, motion-driven `CharacterRig` registry (`CHARACTERS`, `createCharacterRig`, `AvatarMotionState`) driving local, portal-transit, remote multiplayer, and character-select preview avatars.
- **Barnaby Buzz (`suit-bee`)** — the fuzzy Honey Hood bumblebee in a tailored navy suit, crisp white shirt, pocket square, gold buttons, and crimson necktie, rebuilt as a fully rigged playable character (`Y = 0` soles, facing `-Z`) with articulated bipedal legs, swinging arms, bouncing antennae, blinking eyes, fluttering tie, tilting striped abdomen, and iridescent TSL buzzing wings for walking, jumping, hovering, and boosting.
- **Zephyr (`sky-drake`)** — a second playable creature co-crafted as a celestial Prism Sky Drake: articulated skeleton with IK bipedal foot placement, dynamic billowing aurora wing membranes that fold neatly on foot and unfurl wide in flight, 4-segment sinuous tail with glowing star-vane, flowing cosmic scarf, and ten procedural DataTexture + TSL WebGPU shaders (beveled twilight scales with normal/roughness maps, ivory belly plates, carved pearl-gold horns, star-veined translucent aurora wings, slit-pupil amber irises, and flight/boost energy pulses).
- **Character Select screen (`C` key & HUD button, `app/characterSelect.ts`)** — glassmorphic hero roster modal featuring a live interactive 360° WebGPU turntable preview with **Idle / Walk / Fly / Boost** animation modes, character trait cards, optional auto-switch to 3rd-person view, keyboard navigation, and `localStorage` persistence.
- **Multiplayer character & flight sync (`packages/core/src/types.ts`, `packages/server/src/protocol.ts`, `packages/server/src/roomManager.ts`, `packages/core/src/net/multiplayerClient.ts`)** — extended `hello`, `update_profile`, `state`, and `PortalHandoffPayload` with optional `characterId` and `isFlying` fields so co-op friends see each other's chosen character and live walking/flying animations.
- **Mobile multi-touch controls (`app/mobileControls.ts`, `AvatarController.ts`, `index.html`, `app/styles.css`)** — added full iPhone/iPad/Android touch playability: floating analog left thumbstick with outer-rim auto-sprint, independent multi-touch right drag-look pad, ergonomic right-hand Jump/Rise, Fly/Land, Boost/Sprint, 1st/3rd View, and Character Select buttons, tappable portal prompts, safe-area inset padding (`viewport-fit=cover`, `100dvh`), and a compact mobile HUD.
- **iPhone, Android & Mobile Lite optimization profiles (`packages/core/src/engine/performanceProfile.ts`, `PortalPreviews.ts`, `WorldEngine.ts`, `roomWindow.ts`)** — automatic device detection and runtime-switchable profiles in the Controls modal (`Auto`, `Desktop`, `iPhone / iPad`, `Android`, `Mobile Lite`) tuning DPR caps (`1.5×` iPhone, `1.35×` Android, `1.0×` Lite), MSAA, 3-room memory window (`roomWindowRadius = 1` to avoid iOS Safari Jetsam tab reloads), live portal count & resolution scaling (`75%`/`70%`/`55%`), 256 px portal snapshots, depth-2 far-portal skipping, and optional direct-render bypass of the liquid ripple pass on low-RAM phones.

### Changed

- **Flight descend keybinding (`packages/core/src/engine/AvatarController.ts`)** — freed `C` from the undocumented flight-descend alias (keeping `E` and `ControlLeft`) so pressing `C` opens/closes the Character Select screen cleanly whether walking or flying.

### Design & engineering decisions

- **Shared `AvatarMotionState` telemetry across every rig context** — computing speed, local forward/strafe velocity, turn rate, pitch, boost blend, grounded state, and landing squash impulse once in `AvatarController` (and inferring it for remote players) lets every future character plug into the registry without touching controller physics or portal-transit rendering.
- **Deterministic headless-safe `DataTexture` procedural maps + ref-counted texture cache** — building Zephyr's normal, roughness, scale, iris, scarf, and wing-vein textures as pure `THREE.DataTexture` buffers ensures identical rendering on WebGPU and zero-DOM crashes in Vitest, while ref-counting prevents disposing a preview or remote rig from breaking an active player's textures.

## Palace collisions and room walls — Unreleased (2026-11-26)

### Added

- **Room colliders (`ctx.setCollider`, `RoomCollider`)** — rooms can now have walls. Each step the avatar (classic, platformer and flight) asks the room's collider where a step from its feet's last position to the new one ends up, pushed out of whatever is solid at the player's height, so players slide along walls and round columns.
- **Room walk bounds (`ctx.setWalkBounds`)** — the fixed ±95 m clamp is now a per-room setting with the same default, for rooms bigger than that.
- **The Palace of Fine Arts is solid (`worlds/eric-palace-lagoon/collide.ts`)** — Earth's own Palace solids, moved into the room's frame. You walk round the 132 colonnade columns and urns, stop at the rotunda's eight piers and their pedestals and at the exhibition hall, and walk through the arches onto the podium and under the dome. Flying, you can't pass through the ring, the drum, the dome or the colonnade's entablature, and you can land on any of their tops, the dome's crown included. The room's walk bounds now reach round the whole Palace and the hall behind it.

### Fixed

- **The Palace was out of reach** — the old ±95 m clamp stopped players at x = −95, short of the rotunda at x = −110.

### Design & engineering decisions

- **The collider answers "where does this step end up", not "is this solid".** That is the shape Earth's solids already had, and it gives sliding for free: a step into a column is pushed out to its edge along the way it came in, so movement continues round it instead of stopping dead.
- **Roofs are floors from above.** Tops are part of the room's terrain height function, which already receives the feet's height before the vertical move (`fromY`), so a flier above the dome lands on it while someone walking under it sees only the podium.
- **The collision outline is bundled; the mesh stays on R2.** `palace.json` (12 KB, Earth's `pipeline/palace_model.py` solids) ships with the room; the 5 MB mesh is still fetched from Earth's R2.

## Rooms drawn with any WebGPU code, and the Palace Lagoon — Unreleased (2026-11-26)

### Added

- **Shared GPU device (`packages/core/src/engine/gpuDevice.ts`, `WorldEngine.init`)** — portalverse now requests the WebGPU device itself (every adapter feature, raised buffer/binding limits) and hands it to Three.js. Rooms reach the same device through `ctx.gpu`.
- **GPU layers (`ctx.addGpuLayer`, `packages/core/src/engine/gpuLayers.ts`)** — a room can draw with its own WebGPU renderer. For every view of the room (main view, live portal windows, the far portal, snapshots) the engine calls the layer with that view's matrices and viewport. The layer returns colour and depth textures. A small WGSL pass turns the layer's depth into Three.js's, and a fullscreen backdrop writes the colour with that depth before anything else in the room's scene, so portals and players occlude and are occluded correctly.
- **weft adapter (`packages/core/src/rooms/weft.ts`)** — `weftKit` (one weft Kit per device) and `WeftLayer` (maps each view to weft's camera, off-axis lens shift included, sizes the targets, runs the room's passes). weft is a dependency now, with its Vite plugin for typed `.wgsl` imports. It loads only with the rooms that import it (a 45 KB gzipped chunk).
- **Palace Lagoon (`worlds/eric-palace-lagoon`)** — the first room not drawn by Three.js. Earth's Palace of Fine Arts (Earth's own mesh and stone materials, from github.com/ericrius1/world) across a mirror-still lagoon at golden hour, seen from a wind-blown wildflower meadow. Planar reflection, a sun shadow baked once, GPU-generated terrain and two rings of grass with poppies and lupines. Mid-loop, after Abyss.

### Design & engineering decisions

- **Three.js stays the compositor; other engines plug in as layers.** Everything that makes portals work (off-axis cameras, live windows, crossfades, snapshots, the crossing) already funnels through "draw this room from this camera into this viewport". A layer only ever answers that question, so none of the portal code changed and a weft room can be previewed, snapshotted and walked into like any other. Swapping Three.js out as the compositor stays possible later; the layer contract would carry over.
- **One device, not two.** Textures can only be shared within a device, so the engine asks for the device and gives it to Three.js (`parameters.device`) rather than letting each engine create its own.
- **The layer's depth convention is declared, not imposed.** weft uses reversed-Z with an infinite far plane; Three.js doesn't. Each layer says what it uses and the engine linearises and reprojects it, so any engine can plug in unchanged.
- **The Palace links to Earth's R2 object instead of copying it.** The mesh (5 MB on the wire) is content-addressed and immutable on `sf-assets.ericrius1.workers.dev` with CORS open, so nothing is duplicated and nothing is hosted on Railway. A Web Worker fetches, inflates, moves it into the room's frame and packs it from 36 to 28 bytes a vertex. The main thread only uploads it in 1 MiB slices with `breathe()`, so loading never stalls a frame. The terrain, grass, water and sky are generated on the GPU from the vertex index, with nothing uploaded.
- **Mid-loop placement.** The loop wraps, so the rooms furthest from the default start are in the middle of the list, not at the end. The Palace Lagoon sits six rooms from `eric-world` either way, so a normal start never loads it.
- **Measured cost.** weft's GPU timestamps for the whole room at 2048×1536: about 1.4 ms for the reflection and 2.3 ms for the scene.
## One key, one song per room, DJ drops at portals — Unreleased (2026-11-26)

### Fixed

- **Stems were in different keys** — Suno ignored the requested D minor. The takes came out in about six keys (E minor, G minor, E-flat major, C major, B-flat major, D major), so layers clashed even inside one room. Every pitched stem is now transposed from its original take into **G-sharp minor / B major** with Rubber Band. That key needed the smallest shifts (at most 4 semitones). Each stem is also fine-tuned to concert pitch within a few cents, then re-cut into seamless loops. The portal hum is retuned to G-sharp, and the whoosh plays only on chord tones.

### Changed

- **One room's music at a time** — there is no bleed from neighbouring rooms. Each room's blend is a "song" on its own deck, and its stems start together from the top.
- **DJ transition on crossing** — the current song's filter sweeps down under the whoosh. On the next beat, at least 0.3 s later, the next room's song drops in from its top and its filter opens over 1.6 s.
- **Consonant room blends** — the abyss bed and motif carry A- and G-naturals for their eerie colour, so they only play in the Abyss. Other rooms layer only the B-major family. Measured key fit of each room's mix is 0.79–0.93.

### Design & engineering decisions

- Keys were measured with chroma analysis (Krumhansl profiles) and tuning with pitch tracking. The shifted takes stay sample-aligned to the bar grid (within 3 ms), and every loop still wraps without a click.
- Decks replace the spatial blend entirely. `enterRoom()` schedules the sweep and drop from the crossing callback on the audio clock, so the change lands on the beat even if the new room's mount stalls the frame loop.

## Scrollable Rooms modal, GitHub links & open contributor README — Unreleased (2026-11-26)

### Fixed

- **Scrollable Rooms directory & viewport-clamped modals (`app/styles.css`, `app/main.ts`)** — constrained `.modal` to `calc(100dvh - 32px)` in a flex column and made `.world-cards` an independent vertical scroll container (`flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain`) with `flex-shrink: 0` on `.world-card`, fixing the bug where the 12-room list overflowed off the top and bottom of the screen and couldn't be scrolled.

### Added

- **GitHub link in the HUD & Rooms modal (`index.html`, `app/styles.css`)** — added a direct GitHub button in the top-right HUD action bar and a footer CTA in the Rooms modal linking to `https://github.com/ericrius1/portalverse`.

### Changed

- **Community-first README & GitHub repo metadata (`README.md`)** — rewrote `README.md` with a step-by-step "Clone & Run Locally" + "Add Your Own Room" guide right up front, updated the project layout for all 12 rooms, and updated the GitHub repository About description & live Railway homepage URL so anyone visiting knows they can clone and contribute their own room.

### Design & engineering decisions

- **Inner list scrolling with pinned header/footer** — keeping the modal header, close button, and GitHub CTA pinned while scrolling only `.world-cards` ensures the close button stays reachable at any viewport height while all other modals also fall back to `overflow-y: auto` on short screens.

## Tighter soundtrack transitions — `d21dc06` (2026-11-26)

### Changed

- **Each room plays its own music** — the next room is no longer mixed in from 40 m away. Within 10 m of a gate you hear only a faint, muffled hint of it (at most 30%, and never on top of a stem both rooms share).
- **The switch happens at the crossing** — stepping through crossfades to the new room's blend in under a second, together with a 1.3 s filter sweep. The room you came from stays out while you're still at the gate you came in by.
- **Lighter portal effects** — the warp darkens the music to 5 kHz (was ~1.8 kHz), with less reverb and a quieter hum and whoosh. The limiter now only catches peaks, so the whoosh no longer pumps the music.

### Design & engineering decisions

- Playtesting showed the long spatial blend kept two rooms' beds clashing for most of the walk, and left the old room hanging after arrival. The transition belongs to the moment of crossing, so `enterRoom()` schedules the crossfade from the crossing callback itself, not from a frame that may arrive late while the new room mounts.
- The crossing sweep has its own filter, so the warp filter and the sweep never override each other.

## Adaptive soundtrack and portal sounds — `6d841b0` (2026-11-26)

### Added

- **Live-mixed soundtrack (`packages/core/src/audio/`)** — eight stems made in Suno Studio (abyss bed and motif, holo, golden, lagoon and lofi beds, a soft beat, shimmer bells) loop together on one bar grid (later retuned into one key; see above). Each room picks a blend in `ROOM_VIBES`. Walking toward a gate fades in the next room's blend, muffled at first as if heard through the portal and opening up as you arrive. It reaches half and half at the portal, so crossing is a blend, not a cut.
- **Variation** — every 4-bar phrase reshuffles which melodic layers and drums are up (beds stay). The beat follows your speed: quiet when standing, full when running or flying.
- **Portal sounds** — a soft synthesized drone and a reverb wash swell with the portal screen warp. Each crossing or teleport plays a Suno cosmic whoosh at a random pitch, with a DJ-style filter sweep on the music.
- **Music toggle** — a **Music** button in the HUD and the **N** key, remembered between visits. `?mute=1` runs the soundtrack at zero volume for automated tests. Falling into the void ducks and darkens the music.
- **Asset hosting** — the audio lives on Cloudflare R2 (`portalverse-assets` bucket behind `deploy/assets`, content-addressed), mapped in `musicAssets.json` by `scripts/publish-music.mjs`. Opus/WebM with an AAC fallback for Safari, about 2.4 MB in total.

### Design & engineering decisions

- **One key and tempo for everything** — every stem is generated at 88 BPM in D minor, so any blend of rooms is in tune and on the beat, the way a DJ beat-matches before mixing. Stems start offset to the shared grid, so a layer that fades in late still lands in phase.
- **Seamless loops from generated takes** — Studio takes fade in from silence. Each loop is bars 2–9 of a 12-bar take, with bar 10 crossfaded into the head. Bar 10 sits at the same point in the 4-bar phrase as bar 2, so the seam has no audible join.
- **Families of vibes, not one track per room** — ten Suno generations in total (nine stems plus the whoosh) cover twelve rooms by mixing shared stems in different proportions. Rooms that share a stem flow into each other more smoothly.
- **Mixing logic is pure** — `musicMix.ts` has no Web Audio, and `musicMix.test.ts` checks that the mix is identical on both sides of a crossing.

## Abyss secret path smoke and footsteps — `6e1c179`

### Changed

- The latest editor export sets the default secret path and Shadow Man placement. Landing on the destination island summons the man with the chest hidden.
- Each added stepping stone trails one smoke ribbon. In path order the three ribbons are faint and wispy, medium, and full strength.
- Walking again on the same stone relights its cracks. Continued strides refresh the trail and standing still lets it fade.

### Design & engineering decisions

- The hidden chest anchor preserves the exported position and rotation of the apparition. Smoke shares the room’s existing material and tuning. Footsteps measure horizontal travel so island levitation leaves the idle fade intact.

## Abyss treasure encounter — `6e1c179`

### Added

- A treasure chest rides the far side of the large floating stone beyond the secret path. Landing on that stone summons the Shadow Man at the chest. His original emergence animation plays once and fades out. Leaving and landing again can replay the encounter.
- The dev island editor can move and rotate authored stones, the chest, and the shadow’s spawn on all three axes. Drafts and JSON exports include their transforms. Earlier island layouts open with the default encounter.

### Design & engineering decisions

- The chest follows the landing surface’s rise and tilt. Its child spawn stays attached when the chest is moved. Rotated jump stones use their rendered top and bevel for footing.

## Abyss floating island editor — `6e1c179`

### Added

- Abyss now loads JP’s three-island secret jump path by default, using the exact rock shapes, sizes and positions from the editor export.
- In dev mode, press **I** in Abyss or choose **Edit islands** in the **H** panel. Add rocks, cycle through three shapes and three sizes, and drag their axes or enter coordinates. **Playtest** returns to the game with the islands in place.
- Island drafts save in the current browser. **Export JSON** downloads a layout that can replace `worlds/jp-abyss/secret-path.json` to ship the path.

### Design & engineering decisions

- Authored islands use the Abyss rock material, footstep glow and beveled landing surface. Their positions stay fixed so jump distances remain reproducible while editing and playing.

## YOU DIED fall screen — `d522dd5`

### Changed

- Falling into the void fades the room to grayscale and reveals a crimson **YOU DIED** across a dark band. **Respawn** and **or press Enter** use the same locally hosted Cormorant Garamond serif in warm ivory.

### Design & engineering decisions

- The scene stays visible behind the title to echo the Souls reference. Respawn is available throughout the reveal, and reduced-motion preferences skip the animation.

## Room starts at the entrance — Unreleased

### Changed

- All 12 local rooms now start players half a meter past the entrance portal, facing into the room. This applies to first load, the room directory and direct `?world=` links. Links to `spawn=exit` start the same distance inside the exit and face back down the path.

### Design & engineering decisions

- Use the room authoring guide's existing entrance position so players see the path ahead on arrival. Portal previews and walk-through transitions still use the exact gate planes to keep the view continuous.

## Landable floating stones in Abyss — `834306f`

### Added

- Players can land on all 46 stones floating around the path. Each landing surface follows its stone's tilt, drift and beveled rim. Touching down lights that stone's cracks.

### Design & engineering decisions

- Loose stones use their individual outlines so players can walk off the edges. Terrain queries receive the player's feet height before vertical movement, allowing players to fly beneath a high slab or land on a lower one even where two slabs overlap.

## Abyss glow, smoke and footstep tuning — `9fec114`

### Changed

- The default preset uses the original seeded brightness, colors and pulse, path smoke lengths of 4–10 m, stray smoke lengths of 8–17 m, and smoke opacity of 0.32.
- Each smoke ribbon samples length, opacity and tail falloff independently. The development panel exposes both ends of each range and offers a **Varied wisps** smoke preset so a short, faint ribbon can sit beside a long one with a lingering tail. The range endpoints are included in the version 2 JSON export.

### Added

- In development, press **H** in Abyss to open or hide its Leva panel. Tune rock and glow brightness, breathing strength, speed and randomness, smoke length, width, opacity and falloff, and the footstep trail. **Export JSON** downloads the active settings. **Reset to defaults** restores the room preset.
- Footsteps light the full path width by default. The nearest stone starts immediately, and the glow travels outward with a 0.08-second delay per neighboring stone. Each stone rises to 0.50 over 0.62 seconds, then fades over 4.3 seconds with a curve of 1.5. The **Neighbor delay (s)** slider adjusts the spacing, and **Full path width** switches between the row and the individual stone.

### Design & engineering decisions

- The stagger makes the point of contact visible even when the full row lights. Overlapping footsteps arrive in time order, and a glowing stone continues its fade until the new pulse reaches it.
- Footsteps now use the same ground calculation as walking. In a supported crack, the closest stone edge starts the glow so the trail continues between slabs.
- Artists can try more variation against the original room and share an exact preset. Leva loads on first open in development and is excluded from production. The **?** shortcut opens Help in every room.

## Collaborator-friendly Railway auto-deploy via GitHub Actions — Unreleased (2026-11-25)

### Changed

- **GitHub Actions deploys `main` to Railway (`.github/workflows/rooms.yml`, `AGENTS.md`)** — after `validate` (`pnpm run build` + `pnpm test`) passes on a push or PR merge to `main`, a `deploy` job deploys `portalverse-server` using a scoped Railway project token (`RAILWAY_TOKEN`), replacing Railway's built-in GitHub trigger.

### Design & engineering decisions

- **Deploy from GitHub Actions instead of Railway's native GitHub trigger**
  - *Why*: Railway's native GitHub trigger held every commit authored or merged by GitHub users outside the Railway Hobby workspace (e.g. `jpwhitaker`, `simplesessions`) in `NEEDS_APPROVAL`, silently preventing collaborators' rooms from going live without manual owner approval or paid Railway Pro seats.
  - *Decision*: Trigger Railway deploys from GitHub Actions on `push` to `main` (never on untrusted PRs) after `validate` passes, authenticated via a production-scoped Railway project token. Every maintainer push and every merged contributor PR now deploys automatically.

## `breathe()` and the 10-second loading budget — `963ff44`, `328c349` (2026-11-25)

### Added

- **`ctx.breathe()`, also exported from `rooms/kit` (`engine/breathe.ts`)**
  - Once the current stretch of setup has run for 6 ms, it pauses so the browser can draw a frame (`scheduler.yield()` where available, otherwise `setTimeout(0)`). Otherwise it returns at once, so rooms can call it often.
  - `__tests__/breathe.test.ts` checks that it lets other work run after a full slice, doesn't before, and is the same helper on the context and in the kit.
- **Docs on the loading budget and how to use it**
  - COLLAB.md has a new section, "Loading: about 10 seconds, in small pieces". AGENTS.md gains rule 6, and the README gains a short summary near the top.
  - They give how long a room has to get ready at each travel speed. The section covers why that time is all on the drawing thread, and the techniques: `breathe`, building once and sharing across mounts, Web Workers for heavy pure maths, and what's already off the main thread.

### Changed

- **The abyss room uses `breathe` throughout.**
  - Its noise texture builds one channel at a time and its stone geometry pauses every 40 stones. Its `mount` breathes between sections, so the first-time creation of its materials is split up too.
  - On the very first load (Node, cold), its longest stretch of work fell from 32 ms to 14 ms, inside one frame. Later mounts still take about 2 ms and never pause.
  - Its layout is unchanged, checked against a hash of the stones and of the noise pixels.

### Design & engineering decisions

- **Time-slicing over workers as the default**
  - *Why*: It works for every room, including ones that load models, with a one-line change. Workers can't touch three.js or the GPU, so they only help with pure maths.
  - *Decision*: Rooms with heavy procedural generation can still move that maths to a worker, and the docs show how.
- **A 6 ms slice**
  - *Why*: It leaves most of a 16 ms frame for the engine to draw the room the player is in.
  - *Tradeoff*: Setup takes a little longer overall, which is fine with 5–10 seconds to spare.

## Opt-in falling and a looser path rule — `jp/abyss-room`, merged in `61512a6` (2026-11-25)

### Added

- **Rooms can let players fall (`ctx.allowFalling`, `engine/falling.ts`)**
  - A room that opts in returns `NO_GROUND` (exported from `rooms/kit`) from its terrain height wherever there's nothing to stand on, and players drop there.
  - With `respawnBelow`, falling past that height dims the screen to "You fell" with a Respawn button (or press Enter). Respawning puts you back where you entered the room, facing the same way.
  - A room can instead leave the limit out and give players ground further down, such as a floor at the bottom of a chasm, to land on and walk around. Anyone who falls past everything is still caught at -400 m.
  - Rooms that don't opt in are unchanged: there is a floor everywhere, and nobody sinks below -10 m.
- `__tests__/falling.test.ts` checks the following:
  - Rooms don't allow falling unless they opt in.
  - A room's respawn height is used.
  - The -400 m catch applies to rooms with their own ground further down.

### Changed

- **The room contract asks for a walkable path from portal to portal (AGENTS.md, COLLAB.md)**
  - It used to require a straight 8 m corridor down the middle. Now the path only has to be level at y = 0 where it passes through each portal, and between them it may wind, rise and fall.
  - *Why*: The abyss path swings 8.5 m to the side. With falling, walking straight from gate to gate there drops you, which is intended.
- **Classic walking follows the ground down (`AvatarController.ts`)**
  - Walking now sticks to ground that drops away by up to 0.3 m, as Platformer mode already did. Before, you hopped off slopes, stairs and sinking surfaces for a frame or two at a time. Jumps and real drops still fall normally.
- **Fallen players are frozen until they respawn**
  - Their input is locked and the cursor is freed for the button. Space doesn't respawn you, because players mash it while falling.
  - Arriving in any room also clears a fall.
- Player-placed portals over a drop with no ground now use the player's own height.

## Abyss Stepping Stones room — `jp/abyss-room`, merged in `61512a6` (2026-11-25)

### Added

- **Twelfth room, `worlds/jp-abyss/`**, between `jp-loft` and `laser-lab` in the loop: a crooked path of ancient floating stones high above a chasm, at night.
  - The stones are Voronoi cells cut along the path, with gaps between them, chipped corners, chamfered edges, and a jagged rock hanging beneath each one.
  - Each stone drifts up and down and tilts slightly, like drei's `Float`.
  - The stones are weathered grey, with lichen on top, dark cracks and worn edges.
  - Underneath, bioluminescent lichen glows, sparkles drift, and a soft halo of light leaks up through the gaps. Some stones' cracks glow faintly.
  - Smoke falls from the stones' undersides, twisting and blowing like JP's coffee-smoke exercise but falling instead of rising.
  - About 45 loose stones float off the path at many depths.
  - Five fog layers lie 76–150 m below.
  - Skinny spires rise out of the fog, from about 6 m to 410 m away. The tallest reach halfway from the top of the fog to the walkway, 38 m below it.
- `worlds/jp-abyss/abyss.test.ts` covers the following:
  - The path runs straight and level through both gates.
  - Stones are convex and never overlap.
  - There's ground all along the middle of the path, gaps included.
  - There's none past the path's edges or beyond its ends.
  - The stones at the gates hold still.
  - Deep inside a stone you stand exactly on its top.
  - Height changes by under 4 cm per 5 cm walked, even as the stones drift.
  - Loose stones stay clear of the path and the views through the gates.

### Design & engineering decisions

- **The surface you walk on moves with the stones**
  - *Why*: Floating stones you sink into or hover over would break the effect.
  - *Decision*: `path.ts` defines each stone's drift as a few sine waves out of step, and the stone shader repeats the same formula on a shared clock, so you ride each stone up and down.
- **The walking surface blends smoothly between stones**
  - *Why*: Standing on whichever stone was nearest made you step up or drop at every edge as neighbouring stones drifted out of step, which JP saw as jitter.
  - *Decision*: Each nearby stone's top is weighted by how close its edge is, falling off over about 0.35 m. Well inside a stone you stand exactly on it; crossing a gap, you glide from one stone's height to the next.
  - *Tradeoff*: Right at an edge your feet can sit a few centimetres off the stone.
- **Step off the edge and you fall**
  - *Decision*: Your footing holds up to 0.45 m past a stone's edge, which bridges every gap between stones. Beyond that there is no ground. A few edge stones are missing, so there are holes near the sides too. Reaching the top fog layer, 76 m down, dims the screen and offers a respawn.
  - *Decision*: The room skips `addPlatform`, because a flat platform at y = 0 would hold you above stones as they dip.
- **The path bends hard but meets the gates cleanly**
  - *Decision*: The bends are pairs of waves matched so they reach zero, and level, at z = ±32. The path then runs straight and flat through each gate, and the stones there are fixed at y = 0. The tightest bend has a radius of about 4 m, and the path rises and dips by up to 1.1 m.
- **The fog is ordinary geometry**
  - *Decision*: Five large planes drift at their own heights, speeds and directions, so they slide past each other as you walk, which sells the depth. The bottom one is opaque and sets the colour; the upper ones are translucent, swell into low mounds where they're thickest, and have slightly brighter crests. There is no raymarching, so the fog shows the same through portals.
  - *Decision*: Everything far below fades into the horizon colour by its true distance from the eye, from 150 m to 420 m. The fade finishes inside the camera's 450 m draw distance, and the sky below the horizon is that same colour.
  - *Why*: At first the fog sheets ended about 450 m out. The draw distance cut them along a line that swung as you turned your head, and the scene fog, which works by depth along the view, did nothing to hide it. The sheets now reach 550 m, past where the fade completes, so the fog looks endless.
  - *Decision*: The spires fade into the fog colour toward their roots, which hides where they cut through each fog plane. Far-off spires fade into the haze the same way the fog does.
- **No bats**
  - *Why*: The first version had bats flapping 20–60 m below the path. JP didn't like them darting about, so they were removed.
- **The noise is a small baked texture**
  - *Why*: The fog, smoke and stone shaders sample texture instead of computing noise per pixel.
  - *Decision*: `noise.ts` builds one seamless 256² texture once and every mount shares it. The channels are two soft noises, cell edges for cracks, and fine speckle.
- **The whole room is procedural**
  - *Decision*: There are no asset files, and the layout is seeded, so the room looks the same on every visit.
  - *Decision*: The stones are one mesh, the smoke one mesh, and the sparkles and halos one instanced sprite mesh each, to keep the draw-call count low while the room renders as a preview through portals.
- **Mounting is quick, for the five-room window loader**
  - *Why*: The loader mounts rooms while you walk, so a slow `mount` stalls the frame. At first this room took 33–50 ms per mount, and about 100 ms the first time.
  - *Decision*: The layout and all vertex data are built once per page and shared by every mount. Each mount only wraps the shared arrays in its own geometries and makes its materials, which takes about 2 ms.
  - *Decision*: The first build runs in steps with a pause between each so the browser can draw. The noise texture also takes 29 ms instead of 45 after a loop rewrite that gives identical pixels. The `breathe()` entry above splits the first build up further.
  - *Decision*: The sparkle and halo instance buffers are shared too, so remounting the room doesn't add GPU buffers.

## Five-room window loader — `feat/room-window-loader` (2026-11-25)

### Changed

- **Only five rooms stay mounted (`engine/roomWindow.ts`, `PortalPreviews.ts`)** — the player's room and two each way. The loading gate waits for the middle three; the outer two then load one at a time. A menu jump holds that queue until the destination is ready. A room left outside the window is disposed after 4 s unseen. This replaces `MAX_HOT_ROOMS` and the startup pass that mounted every room to photograph it.
- **A room is ready only after its shaders are compiled and both snapshots taken.**

### Fixed

- **Black screen while rooms precompile** (found during this branch, never shipped) — three.js leaves the renderer on the precompile target each time it resumes, so the final composite is now drawn to the screen explicitly.

- Menu jumps now give the selected room priority from the start of its download. The current room and its neighbours can finish preparing during startup without waiting for browser idle time. A slow load from the previous window no longer holds up the new window.
- Retried rooms keep their place in the five-room window. A queued room can appear through a portal as soon as its load finishes. Returning rooms use existing neighbour pictures when capturing their own portal snapshots. On shutdown, an in-flight shader compile finishes before its render target and renderer are released.

### Design & engineering decisions

- **Why**: efficiency, as the loop grows. Five matches what portals draw live; farther portals show snapshots.
- **Measured** (headless Chrome, Apple Metal, 11 rooms, before → after, shader cache warm; two to three runs):

  | | before | after |
  |---|---|---|
  | Loading gate ready | 3.0–3.1 s | 2.9 s |
  | GPU process memory at the gate | 721–769 MB | 600–607 MB |
  | GPU process memory after one lap | 942–948 MB | 694–758 MB |
  | JS heap after one lap | 30 MB | 31 MB |
  | Frames over 33 ms per lap | 4–7 (worst 100 ms) | 0–1 (worst 33 ms) |
  | Rooms-menu jump | 125–230 ms | 220–420 ms |

- **Snapshot on arrival**, not pre-made images: no upkeep.
  - *Tradeoff*: Until a room has been visited or neared, portals to it show the placeholder, and a snapshot taken later may contain one.
- **Dropped rooms start fresh** when you return.
- **Tradeoff**: Jumping to an unloaded room waits for its shaders and snapshots, so it is slower than before.

## Honey in da Hood Ya Heard room — [PR #3](https://github.com/ericrius1/portalverse/pull/3), `7c9050d` (2026-11-25)

### Added

- **Eleventh room, `worlds/honey-hood/`**, between `eric-sun-observatory` and `eric-world` in the loop: a winding road through tall trees that drip honey into puddles lasting 3.5 s, golden plants, a red fire hydrant off the road near the middle, and a giant fuzzy bee in a blue jacket and red tie. Every few seconds a bird appears; the bee chases it down and eats it.

### Design & engineering decisions

- **The bee is just above a held jump**
  - *Why*: The brief asked for it to be just out of jump height. Its lowest point stays at about 5.8 m, above the roughly 5.5 m a jumping player reaches.
  - *Tradeoff*: Flight stays on, so players can still fly up to it (`allowFlight` is not enforced by the engine yet).
- **The road bends, the walkable ground does not**
  - *Why*: Rooms must keep the central corridor flat and clear. Trees, plants and the hydrant stay outside it, and the road is flat decoration.
- **Behaviour lives in `logic.ts`**
  - *Why*: Road shape, placement, honey timing and the hunt are tested without a browser.
- **Each client runs its own bee and birds**
  - *Tradeoff*: Players in the room together see different hunts. Syncing them would need server and protocol changes.
- **All geometry is procedural**, so the room adds no asset files.
- **The road is paved with tiles that light up underfoot**
  - *Why*: To make walking the road playful.
  - *Decision*: Each slab spans the road and is about 5 m long. The one under your feet lights at once and fades over 1.5 s, with a soft light rising about 1 m from its edges. Jumping or flying over a tile does not light it. The slabs share one mesh and their light another.
  - *Why the size and rising light*: Small tiles underfoot were off screen in first person, where the ground nearer than about 2.7 m is out of view.
  - *Tradeoff*: Only your own steps light tiles; other players' steps do not.
- **The fire hydrant talks**
  - *Decision*: Within 5 m a speech bubble pops up reading はちみつタイム ("honey time"), and it goes away past 6 m.

## Stutter when crossing portals — [PR #2](https://github.com/ericrius1/portalverse/pull/2), `d2b21e1`, `aaa52cb` (2026-11-25)

### Fixed

- **Freezes on every portal crossing (`engine/PortalPreviews.ts`)** — previews and snapshots hid the arrival portal along with its point light. The arrival portal's meshes are still hidden there, but its light now stays on.
- The regression tests check which lights the camera can see in both live portal windows and loading snapshots. Both tests fail if hiding the arrival gate also hides its light.

### Design & engineering decisions

- **A room is lit the same in preview and when active**
  - *Why*: Three.js builds shaders for a room's set of lights. One light fewer in preview meant every lit object in the room you entered, and the one you left, was rebuilt on the crossing frame (50–120 ms), with a further freeze of up to 2.7 s on first visits.
  - *Decision*: Hide a portal by taking its meshes off all camera layers, which leaves lights underneath it on. In a headless Chrome run on Apple Metal, 23 consecutive crossings then stayed at 17 ms.
  - *Tradeoff*: Preview rooms now include the arrival gate's glow, as they do once you are inside.

JP confirmed the crossing stutter was gone in a local playtest.

## Platformer jump timing — [PR #1](https://github.com/ericrius1/portalverse/pull/1), `4b097a6` (2026-11-25)

### Fixed

- Platformer jumps follow the same vertical trajectory at 20–240 FPS for the same hold duration. Movement now accounts for the time spent rising and falling within each frame. A held jump still matches Classic at 60 FPS, so players can clear the same ledges across frame rates in Platformer.
- Two Space taps between frames now start flight when the first tap launches a jump. The controller counts presses until its next update so a frame hitch cannot swallow the second tap.

## Platformer physics toggle — [PR #1](https://github.com/ericrius1/portalverse/pull/1), `c7ea955`, `2793e7d` (2026-11-25)

### Added

- **`G` switches walking physics between Classic and Platformer (`engine/movement.ts`, `AvatarController.ts`)** — Platformer ramps speed up over 0.25 s and brakes over 0.15 s, allows 35% steering in mid-air, falls faster than it rises, and scales jump height with how long `Space` is held (about 0.9 m tapped to 3.5 m held; a held jump peaks level with Classic's). Jumps still work just after running off a ledge. The HUD shows the mode and the browser remembers it. Platformer momentum turns with the player through portals.

### Design & engineering decisions

- **Opt-in, and the same in every room**
  - *Why*: Walking felt floaty for platforming. A toggle lets people try a heavier feel without changing anyone's default.
  - *Decision*: Classic is the default and runs the existing code. Per-room physics (such as gravity) is left for later.
- **Platformer lives in a pure module**
  - *Why*: It can be tested without a browser, and its numbers sit in one tuning object that per-room physics could override.
  - *Decision*: `AvatarController` copies velocity and footing into the module each step, so flight, portals and menus keep using the existing fields.
- **Double-tap flight works in both modes**
  - *Why*: It is the established control.
  - *Tradeoff*: A second `Space` during a Platformer jump takes off, even just before landing. The early-press allowance therefore only applies to falls that did not start with a jump.

## Railway all-in-one hosting, 10-room loop, FPS + tutorial, and Earth-style flight — `dd6aa95`..`2a8d19c` (2026-11-25)

### Added

- **All-in-one Railway deployment (`packages/server/Dockerfile`, `packages/server/src/index.ts`, `.railway/railway.ts`, `.dockerignore`)** — multi-stage Docker build runs `pnpm run build` and serves the built Vite frontend (`dist/` with immutable caching for `/assets/*` and SPA fallback for room deep links) alongside the authoritative `/ws` WebSocket server, `/api/health`, and `/api/worlds` on one origin (`https://portalverse-server-production.up.railway.app`), auto-deploying on every push to `main`.
- **Two new Eric rooms**, completing a **10-room loop** (`eric-world` → `jp-world` → `jp-garden` → `fishpond` → `jp-reef` → `jp-loft` → `laser-lab` → `alpine-sled` → `eric-biolum-grove` → `eric-sun-observatory`):
  - **Bioluminescent Redwood Grove (`worlds/eric-biolum-grove/index.ts`)** — nocturnal redwood cathedral with a mossy TSL mycelial-vein floor, overhead TSL emerald-to-violet aurora ribbons, redwood trunks, drifting firefly spores, and glowing mushrooms that brighten and pulse as `ctx.player` passes.
  - **Golden Cloud Observatory (`worlds/eric-sun-observatory/index.ts`)** — floating marble-and-brass promenade above a rolling sunset TSL sea of clouds, flanked by player-reactive astrolabe beacons and crowned by colossal rotating brass armillary rings and orbiting moons.
- **Agent onboarding & auto-deploy guide (`AGENTS.md`, `CLAUDE.md`)** — auto-loaded by Claude, Codex, and Gemini/Antigravity agents so either Eric or JP can ask their agent to push/deploy and it knows the exact checks, `main` push → Railway auto-deploy verification flow, file/branch/thread conventions, and `CHANGELOG.md` update requirement.
- **Controls context & optional interactive tutorial (`app/tutorial.ts`, `index.html`, `app/styles.css`, `app/main.ts`)**:
  - Loading gate quick-controls strip plus a ready-state choice between **Interactive Tutorial (30s)** (highlighted for first-time visitors) and **Jump Right In** / **ENTER**.
  - Live 5-step interactive tutorial HUD card (Look Around → Walk & Sprint → Take Flight & Land → Switch Camera View → Step Through a Portal), always skippable and replayable.
  - Full **Controls & How to Play** modal (`H`, `?`, or the top-bar `Controls` button), subtle FPS center reticle when pointer-locked, and an unlocked-cursor context pill.

### Changed

- **FPS + Pointer Lock by default (`AvatarController.ts`, `WorldEngine.ts`)** — starts in 1st-person (`firstPerson = true`) with a level horizon (`pitch = 0`) and requests browser Pointer Lock on gate entry and canvas clicks (keeping drag-look as a fallback for touch/unsupported contexts, clamping pointer-lock delta spikes, and releasing lock cleanly on `Esc` or modal open). Pressing `V` still switches to 3rd-person.
- **Earth-repo-style flight (`AvatarController.ts`, `WorldEngine.ts`)** — modeled after Eric's `world` (Earth) repo (`camera/controls.ts`):
  - `Space` jumps (holding briefly extends jump height); pressing `Space` again while airborne launches smoothly into flight with upward takeoff drift.
  - While flying: `WASD` steers along look direction with smooth throttle ramp & coasting glide, `Shift` boosts (and flies forward alone if no direction key is held), `Q` (or `Space`) rises, and holding `E` descends (easing gently near the floor) and lands cleanly on foot. Diving low after flying above 4.5 m also releases flight smoothly onto your feet with carried momentum.
  - While airborne in flight, `E` belongs to descending/landing rather than the portal interact prompt (fly straight through portals instead).
- **Future-proof room crossing test (`roomCrossing.test.ts`)** — depth-2 portal crossing tests now look up `eric-world`'s neighbors dynamically from `registry.json` instead of hardcoding `alpine-sled`/`laser-lab`, so adding new rooms won't break crossing assertions.

### Removed

- **Vercel hosting (`vercel.json`, `.vercel.app` fallback branch in `app/main.ts`)** — deleted the Vercel project and removed Vercel-specific static fallback code.

### Design & engineering decisions

- **Single-origin Railway over Vercel + separate WS server**
  - *Why*: Vercel's Hobby tier blocked JP's collaborator commits behind a Pro account paywall and couldn't host persistent WebSockets, forcing a split frontend/backend setup.
  - *Decision*: Serve both `dist/` and `/ws` from `packages/server` in one Railway container auto-deploying from `main`. Both collaborators can push freely, multiplayer works out of the box on the main URL with zero env vars, and `packages/server` tests remain unaffected because static serving is enabled only when `staticDir` is passed (auto-detected when run as main).
- **FPS + pointer lock default with explicit control context & opt-in tutorial**
  - *Why*: Drag-look 3rd-person felt indirect for new visitors exploring the rooms, and first-time players had no quick onboarding for portals, flight, or unlocking the cursor.
  - *Decision*: Default to FPS + pointer lock with clear on-screen context (`Esc` for cursor, `H` for controls), and offer an interactive 5-step tutorial right on the loading gate that players can choose or skip in one click.
- **Earth-style double-jump flight (`Space ×2`, `Q` up, hold `E` down/land)**
  - *Why*: Eric wanted flying to feel intuitive and match the muscle memory from his `world` (Earth) repo rather than requiring a separate `F` toggle and `Space`/`C` keys.
  - *Decision*: Port the core feel from `world/web/src/camera/controls.ts` (variable-height jump, mid-air double-jump takeoff, damped throttle/coast flight, `Q` rise, gentle ground-proximity sink + hold-`E` landing, and `E` yielding portal-use while flying), tuned to Portalverse's 72.5 m room scale.
- **Keep `AGENTS.md` + `CHANGELOG.md` updated on every feature**
  - *Why*: With two collaborators and multiple agents working in parallel, commit diffs alone lose the *why* behind UX and architecture choices.
  - *Decision*: Require agents in `AGENTS.md` to read recent `CHANGELOG.md` entries for context and append the *what* and *why* (prompt rationale + design decisions) for every feature before pushing.

## Seamless portals & eight-room loop — `9a7253d` (2026-11-25)

### Added

- **Three new rooms** linked into a five-room loop (`eric-world` → `jp-world` → `fishpond` → `laser-lab` → `alpine-sled` → `eric-world`):
  - **Kāneʻohe Fishpond (`worlds/fishpond/index.ts`)** — a Hawaiian coastal *loko iʻa* inspired by `water-pro-fishpond` & `ahupuaa`: a timber-and-basalt *kuapā* boardwalk, animated TSL turquoise lagoon water with caustics and specular glints, lava-rock walls, coral sandbars, swaying coconut palms, 90 instanced reef fish, and fluted Koʻolau cliffs.
  - **Laser Forcefield Arena (`worlds/laser-lab/index.ts`)** — a pitch-black light-show hall inspired by `laser`: a neon TSL runway grid, gantry emitters sweeping 24 additive TSL laser beams, pulsing scanline forcefield walls, and hovering obsidian prisms.
  - **Alpine Snow Run (`worlds/alpine-sled/index.ts`)** — a twilight alpine valley inspired by `sled2` & `christmas`: TSL crystal-glint snow, split-rail sled fences, amber lantern posts, 136 snow-dusted firs, alpenglow peaks, toboggans, gift stacks, and 450 drifting snowflakes.
- **Three more of JP's rooms**, inspired by and built from assets in his older three.js projects, making an eight-room loop (`eric-world` → `jp-world` → `jp-garden` → `fishpond` → `jp-reef` → `jp-loft` → `laser-lab` → `alpine-sled`):
  - **Breezy Plant Garden (`worlds/jp-garden/`)** — from `portfolio-3`: giant flat-coloured elephant ears, taro, and rosettes of monstera, banana and fan palm leaves in the portfolio's no-shading style. Monstera leaves use the portfolio's three grayscale mask textures (`monstera-base-mask.png`, `monstera-rib-mask.png`, `monstera-vein-mask.png`) in a TSL node material for fenestrated lobes, central rib and veins; kalo (`textured-plant.glb`, `elephant-1.glb`) leaf proportions and stem attachments are tuned so stems meet the underside piko cleanly without poking through or extending into the notch, and rigid junction bones keep leaves locked to their stem tips while swaying. Stems are a shade darker than the leaves, and kalo and elephant ear leaves turn their fronts toward the path. Each plant is rigged; a breeze, gusts rolling down the garden and a push away from the player bend its bone chain through a spring, so plants give way as you pass and wobble back.
  - **Coral Reef Walk (`worlds/jp-reef/`)** — from `react-fiber-sea-floor`, `longHome` and `collectivSea`: a sandy path through a coral canyon with caustic light on the sand and corals, light shafts, a shimmering surface overhead, swaying seaweed, pulsing jellyfish, schools of fish, a turtle and a manta ray, and marine snow.
  - **Night Loft (`worlds/jp-loft/`)** — from `apartment` and `white-fiber`: an open-plan loft with window bays onto a night-city panorama (a Poly Haven HDRI), generously scaled loft furniture (couches, side tables, lamps, rugs, architectural door, king bed, dining table/benches and kitchen island) lit by warm lamps, and a smooth, matte animated shiba that bounds ahead into view, circles around you, dashes out and races back with jumps (`Gallop_Jump`, `Jump_ToIdle`), playful bows (`Attack`) and floor-sniffing (`Eating`), returning to its bed when you leave.
- **`ctx.player` for rooms (`types.ts`, `RoomInstance.ts`, `WorldEngine.ts`)** — the player's feet position while a room is active, `null` while it's a preview.
- **Room kit (`packages/core/src/rooms/kit.ts`)** — `loadGLB`, `groundModel`, `disposeObject` and `seededRandom` for rooms that load models.
- **Round loading gate (`index.html`, `app/styles.css`, `app/main.ts`)** — split obsidian curtains around a circular medallion with a rising liquid fill and progress ring. It tracks the real startup phases (WebGPU init → first room → adjacent rooms → portal snapshots → ripple warm-up), locks controls until ready, then shows **ENTER**.
- **Snapshots for distant portals (`PortalPreviews.ts`)** — during the loading gate, every room's entrance and exit sightline is captured into a 512×512 snapshot, in two passes so portals inside snapshots show real rooms too. The avatar is hidden during capture. Portals three or more rooms away show these snapshots with POV parallax and the same un-fogged vibrancy as live windows. A portal whose room finishes loading while it's on screen crossfades from its snapshot to the live view over 0.55 s.
- **The portal two rooms ahead is live (`PortalPreviews.ts`)** — looking through a portal, the route gate at the far end of that room shows its own room live, drawn through the same lens it will use once you walk in. Crossing hands that view straight over, so it keeps its size and position.
- **Distance-compressed portal lens (`roomLayout.ts`, `PortalPreviews.ts`)** — `effectivePortalDistance` is exact inside 12 m and eases to 15.5 m at 72.5 m, widening a live window seen from across the room from a ±2.3° keyhole to the snapshot's framing, while pixels on the opening's plane stay registered to the ring.
- **Threshold-aligned fog in live windows (`PortalPreviews.ts`)** — the destination's linear fog is offset by the virtual camera's compressed distance, so fog starts at the threshold instead of behind it.
- **Always-on liquid wave pass (`PortalRipplePass.ts`, `WorldEngine.ts`)** — the frame always renders through one persistent post-processing target, so the wave never has to be set up or torn down.
- **Portal warp zones (`engine/portalWarp.ts`, `WorldEngine.ts`, `index.html`, `app/main.ts`)** — each portal has a warp zone: a circle on the floor (`WARP_RADIUS`, 4.5 m) around its centre. The wave starts as your character's feet enter it, eases in from the edge, and is strongest at the ring, ignoring height. Moving adds up to 20% at a sprint using smoothed speed, so a run counts more than a walk and a stop-start walk less again, without jumping between frames. A **Warp zones** checkbox in the controls bar shows each zone as a wireframe sphere with its equator on the floor, and is remembered between reloads.
- **Room-crossing tests (`packages/core/src/__tests__/roomCrossing.test.ts`)** — 28 tests cover threshold detection, the `[E]` prompt, camera-crossing promotion, backing through a portal, arrival transforms for every route gate in the catalog, the active/preview room lifecycle, snapshot-material cleanup and un-fogged parity, live-window resolution, the portal two rooms ahead staying steady through a crossing (centred and off-centre) without rendering the gate behind the camera, and federated arrival placement. The crossing rules moved from `WorldEngine` into a pure module (`engine/portalCrossing.ts`) so they run without a GPU.

### Changed

- **Circular portals everywhere (`PortalMesh.ts`, `RoomInstance.ts`)** — the square gilt `PaintingPortal` is replaced by the circular starlight ring (`createArchwayPortal`, `PORTAL_RADIUS = 2.85`) with grounded side plinths and a clear `Y = 0` threshold.
- **3rd-person portal traversal (`WorldEngine.ts`, `AvatarController.ts`, `PortalPreviews.ts`)**:
  - The camera no longer dips into first person on approach (`blendToEye`) or swoops on click (`approachPainting`).
  - While crossing, the character is mirrored into the destination preview by a transit rig (`createStylizedAvatarRig`). The destination `RoomInstance` is promoted synchronously on the frame the camera crosses the plane (`takeReady` + `promotePortalSync`).
  - Clicking a portal, or pressing `E`, walks the character through the opening with the chase camera following.
- **Live portal windows render at screen resolution (`PortalPreviews.ts`)** — each window's target matches the drawing buffer, and each frame renders only the opening's on-screen rectangle into it at one texel per screen pixel. Windows are pooled and resize only when the browser window does, so crossings still allocate nothing, and small distant portals cost less than before. This replaces a fixed 1024×1024 window from earlier on this branch, which blurred openings that filled most of the screen.
- **One render-target format for every room pass (`engine/sceneTarget.ts`)** — the main view, live windows and snapshots all render to `rgba16float` with one sample, so a preview room promoted to active reuses pipelines it already compiled. The cost is no MSAA; change it in that one function to change all three passes together.
- **Federated return portal (`handoff.ts`, `app/main.ts`, `WorldEngine.ts`)** — a traveller arriving from another server appears 12 m into the room with the one-way return portal 6.5 m behind them (behind the 3rd-person chase camera and clear of the entrance gate), never crowded out by a room's 5 optional side slots. The `[E]` prompt only appears when you're on the entry side and facing the portal.
- **No click-to-enter on portals (`WorldEngine.ts`, `PortalMesh.ts`, `types.ts`)** — removed portal click/hover raycasting and invisible click targets; enter portals by walking/flying through the circular opening or pressing `E` while facing one.
- **Circular opening crossing check (`portalCrossing.ts`)** — `detectFeetCrossing` checks radial distance inside the circular ring rather than a bounding rectangle, preventing flight crossings through the outer corners.
- **Remote portals trigger by walking through the ring**, like local portals, instead of on proximity.
- **`ctx.onActivate` may return a cleanup** that runs when the player leaves and the room drops back to a preview.
- **Center-of-room initial spawn (`registry.json`)** — every room's `default` spawn starts at `[0, 0, 0]` (facing `-Z`), with `eric-world` as the default room when loaded without query parameters; portal crossings still arrive at each gate's `entrance`/`exit` threshold.
- **Performance (`PortalPreviews.ts`, `PortalRipplePass.ts`, `WorldEngine.ts`, `app/main.ts`, `app/styles.css`)** — pooled live-window rigs with precompiled TSL materials, the ripple pass prewarmed during the loading gate, every room kept mounted (`MAX_HOT_ROOMS` raised from 6 to 10 for the eight-room loop), fewer per-frame allocations, no DOM rebuilds for hidden modals on crossing, `history.replaceState` and HUD/roster DOM updates deferred off the crossing `rAF` (with roster deduplication), and CSS layout containment (`contain`) isolating `#hud` from `#viewport`.
- **Fog tuning (`worlds/jp-world/meadow.ts`, `worlds/fishpond/index.ts`, `worlds/alpine-sled/index.ts`, `worlds/laser-lab/index.ts`)** — linear fog now starts beyond the 72.5 m promenade, so sunlit rooms stay crisp and far horizons keep their haze.
- **Tooling** — `pnpm dev` runs its halves with `npm run`, so `npm run dev` works too, and the repo pins pnpm 12.23.0 through `packageManager`.

### Fixed

- **CI install** — the workflow installed with pnpm 8, which can't read the regenerated v9 lockfile or a `pnpm-workspace.yaml` without `packages`. `allowBuilds.esbuild` also still held pnpm's placeholder, which fails `--frozen-lockfile` installs with `ERR_PNPM_IGNORED_BUILDS`. CI now uses the pinned pnpm, and esbuild's install script is allowed.
- **Rooms you left stayed "active"** — a room kept as a preview after you left still reported `mode: 'active'`, kept its portal-entry callback, and re-ran `onActivate` on each return without stopping anything. Rooms now deactivate when they go back into the preview cache.
- **Snapshot-material leak** — jumping to a room that isn't next door (the Rooms menu, or joining a friend) disposed the old room but kept the snapshot materials on its portals.
- **Snapshots upside down on the WebGL fallback** — the snapshot lookup flipped V for WebGL, but three.js already samples render targets top-down in both backends.
- **Backing through a portal snapped the scenery around it** — walking backward, the 3rd-person camera reaches the portal about 5.6 m before your feet. Rooms only switched when the feet crossed, so for that stretch the camera looked back from the far side of the portal at the room's exterior, and everything around the ring snapped when the feet arrived. The crossing now starts when the camera passes through the opening, which shows the same picture on both sides. Until the feet follow, the portal you came through counts as a crossing back in progress, so backing fully in completes it and walking away switches straight back (`beginCrossing` in `portalCrossing.ts`).
- **The portal two rooms ahead changed size as you crossed** — walking from Eric's room into Alpine, the Laser portal at the far end ballooned to about 2.2× over the last 20 m (true perspective is about 1.3×), snapped by a few percent when crossing off-centre, then zoomed again as its snapshot crossfaded into a live view that didn't match it (5–19 px off on a 35 px ring at 1080p). It now keeps its true size and stays live through the crossing.
- **Depth-3 portal saturation pop-in & crossing-frame glitch (`PortalPreviews.ts`, `WorldEngine.ts`)** — snapshot materials previously had `fog = true` while live portal windows had `fog = false`, so nested depth-3 portals inside foggy rooms (like Kāneʻohe inside Plant Garden) looked washed out and popped to full saturation when promoted to depth-2 live; snapshots now match live windows (`fog = false`). Also fixed `portalPixels` returning full-screen bounds for the gate just behind the camera after crossing (which stole pooled targets and triggered mid-crossing target allocations), clamped live window UVs inside each sub-viewport to prevent edge bleed, and synced the transit avatar rig on promotion.

### Removed

- **Portal hub & style switcher** — `worlds/hub/index.ts`, its registry entry (the default world is now `eric-world`), and the `[✦ Fountains | ✿ Meadow | ◎ Nexus]` switcher in `index.html`, `app/styles.css` and `app/main.ts`.
- **Hub leftovers** — the `HubStyle` type and the `hubStyle` / `targetHubStyle` / `defaultHubStyle` fields threaded through the engine, registry, handoff payload and server protocol, plus about 600 lines of unused fountain and flower portal builders and their shaders. Old `?hubStyle=` links still open the named room. JP's meadow shaders moved from `packages/core` to `worlds/jp-world/`.
- **Square portal & portal chrome** — `packages/core/src/engine/PaintingPortal.ts`, the floating title signs above portals, and the hover tooltip (`#hover-tooltip`).
- **Avatar halo (`AvatarController.ts`, `WorldEngine.ts`)** — removed the floating torus halo ring above local, remote and transit avatars and lowered remote nameplates slightly to sit cleanly above the capsule.
- **Far-portal de-emphasis** — route gates seen inside the next room were drawn at 0.30–1.0× scale depending on your distance (`farPortalScale`). Any scale that changes with distance makes the portal grow faster than perspective as you approach, so it was removed; the distance-compressed lens already keeps far portals small.

### Design & engineering decisions

- **Promote when the camera crosses, with a transit character (not when the feet cross, with a first-person dip)**
  - *Problem*: swapping rooms when the feet reached the plane left the 3rd-person camera 5.6 m behind in the old room, which forced a dip into first person (`blendToEye`) and hid the character.
  - *Decision*: stay in 3rd person throughout. Once the character steps past the plane, mirror it into the destination preview (clipped by the portal's oblique near plane, while the source-side opening hides the original), then promote the destination on the frame the *camera* crosses.
- **Threshold snapshots with a fog offset**
  - *Problem*: capturing snapshots from 72.5 m back (about a 10.8° telephoto FOV) compressed the next room so the room two hops away filled half the portal (pitch-black Laser Lab inside sunlit Kāneʻohe), while linear fog washed out the foreground.
  - *Decision*: capture from 15.5 m behind each threshold (`SNAPSHOT_REF_DISTANCE`, equal to the lens reference distance), with a 6.2 m half-height window, for a 43.6° FOV, and the near plane on the threshold. Offset linear fog by that distance during capture, and keep snapshot apertures `fog = false` to match live portal windows so depth-3 previews don't pop in saturation when promoted to depth-2 live.
- **Distance-compressed live lens matched to the snapshots**
  - *Problem*: physically exact framing put the virtual camera 72.5 m behind the destination threshold, a ±2.3° keyhole that cropped side trees, fences and lanterns, and framed far rooms very differently from their snapshots.
  - *Decision*: apply a portal-local Z compression in `framePortal` (`effectivePortalDistance`: exact to 12 m, 15.5 m at 72.5 m, the same as `SNAPSHOT_REF_DISTANCE`), so pixels on the opening's plane stay registered and far rooms keep a wide framing.
- **Draw the portal two rooms ahead live, not a scaled snapshot**
  - *Problem*: the far gate of the room you were looking into showed a snapshot, first scaled down (`farPortalScale`) and then swapped for a live view as you crossed. The scale made it grow faster than perspective, and a flat snapshot can't reproduce the live lens's depth-dependent parallax, so the handover always slid or zoomed.
  - *Decision*: render that gate live through the same lens it will use once you're in its room. `portalMapping` gives the transform a portal view applies to its destination; a stand-in for the far gate is placed in this world with it and framed like any other opening, and only its on-screen pixels inside the near opening are drawn. When you cross, the gate becomes an opening in the active room and its window carries on, so nothing changes. Snapshots remain for portals three rooms away and for rooms still loading.
- **One target format and an always-on wave pass**
  - *Problem*: toggling an offscreen post-processing pass switched colour format and sample count (`bgra8unorm` MSAA → `rgba16float` single-sample), compiling duplicate scene pipelines right at the threshold; a one-shot timer also felt disconnected from the player's position and speed.
  - *Decision*: keep `PortalRipplePass` always on in the same format as live windows and snapshots, now enforced by `createSceneTarget`. Drive the wave phase continuously and set its strength from the player's place in a portal's warp zone and their smoothed speed.
- **Measure the warp from the feet, on a floor circle**
  - *Problem*: the warp followed the camera's distance to the portal plane, faded out by about 6 m, and needed the camera facing the ring. In 3rd person the camera is still 5.6 m back when the character reaches the ring, so there was almost no warp before the threshold.
  - *Decision*: measure flat distance from the character's feet to each portal's centre inside a 4.5 m circle, so standing at the ring warps strongly on its own and speed only adds up to 20%. The circle is the same doorway on both sides of a crossing, so the warp doesn't jump when rooms switch.
- **Screen-resolution live windows without reallocation**
  - *Problem*: the fixed 1024×1024 window was cheap to pool but blurry close up, while sizing a target to the opening (as in `8536daf`) reallocates it as you walk.
  - *Decision*: pool windows sized to the drawing buffer, and limit each frame's render to the opening with the target's viewport. Resolution matches the screen, memory is one screen-sized target per visible window (usually one or two), and fragment cost follows the opening's size on screen.
- **Rooms switch between active and preview**
  - *Problem*: keeping the room you just left mounted makes turning back instant, but rooms only knew how to activate, so player-only behavior piled up.
  - *Decision*: `RoomInstance` has `activate`/`deactivate`, the preview cache deactivates every room it takes, and `ctx.onActivate` callbacks can return a cleanup.
- **A dedicated `CHANGELOG.md`** keeps the README short for onboarding, while the change and decision log grows across branches and rooms.

## Room authoring and seamless portal crossings — `8536daf` (2026-11-24)

### Added

- **Shared room contract.** Contributors register a room in `registry.json` and export `defineRoom(id, { mount(ctx) })` from `worlds/<id>/index.ts`. The client discovers it automatically and uses the same scene builder for live previews and visits.
- **Entrance, exit, and optional links.** Every local room gets two aligned, framed openings 72.5 metres apart, a five-second sprint at 14.5 m/s. Catalog order connects the rooms in a loop. Each room has five more slots shared by authored and player-placed portals, enforced in multiplayer and offline play.
- **Contribution budgets.** `check:rooms` and pull-request build checks. The room folder and the room-specific production bundle each have a 12 MiB budget, with a 4 MiB limit per file. Standalone PNG and KTX2 textures in a room folder are limited to 2048 pixels per edge.

### Changed

- **JP's and Eric's rooms.** JP's amber studio became the solarpunk wildflower meadow. Eric kept his cyan holographic workshop, with the exhibits moved clear of the running path. The route ran from the hub through JP's meadow and Eric's workshop, then back to the hub.
- **Portal travel.** Framed paintings show the actual destination with a level horizon and parallax as the viewer moves. Walking through a frame, or clicking to glide into it, promotes the preloaded scene, keeping its animation and the viewer's position relative to the doorway.

### Fixed

- **Pixelation at the threshold.** The fixed 384×384 preview became a render sized to the opening's on-screen pixels. Once the opening fills the view, the renderer draws the destination directly. The camera handoff also removed a one-frame backward jump during sprint crossings.

## Initial build — `e419104`, `f238cb3` (2026-11-24)

- **Scaffold and shared contracts** — the pnpm/Vite/Vitest setup, the shared `WorldModule`, portal and network types in `packages/core/src/types.ts`, and the first `registry.json`.
- **WebGPU world engine** — Three.js WebGPU + TSL rendering, the avatar controller with walking, flight and 1st/3rd-person cameras, and portal meshes and shaders.
- **Rooms** — Eric's and JP's rooms, and a portal hub with switchable Fountains, Solarpunk Meadow and Nexus styles (since removed).
- **Multiplayer** — an authoritative WebSocket server (`packages/server`) for presence, room switching and player-spawned portals, with strict message validation and tests.
- **Federated handoffs** — portals to other Portalverse servers carry a sanitized `?handoff=` payload with the traveller's name, colour and a return URL.
