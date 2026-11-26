# Changelog

Notable changes and design decisions in **Portalverse**, newest first. Each section names the commit(s) it shipped in and the *why* behind each decision so contributors and their agents stay in sync across sessions.

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
