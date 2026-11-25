# Changelog

Notable changes and design decisions in **Portalverse**, newest first. Each section names the commit(s) it shipped in and the *why* behind each decision so Eric, JP, and their agents stay synced across sessions.

## Five-room window loader — `feat/room-window-loader` (2026-11-25)

### Changed

- **Only five rooms stay mounted (`engine/roomWindow.ts`, `PortalPreviews.ts`)** — the player's room and two each way. The loading gate waits for the middle three; the outer two load one at a time behind them. A room left outside the window is disposed after 4 s unseen. This replaces `MAX_HOT_ROOMS` and the startup pass that mounted every room to photograph it.
- **A room is ready only after its shaders are compiled and both snapshots taken.**

### Fixed

- **Black screen while rooms precompile** (found during this branch, never shipped) — three.js leaves the renderer on the precompile target each time it resumes, so the final composite is now drawn to the screen explicitly.

### Design & engineering decisions

- **Why**: efficiency, as the loop grows. Five matches what portals draw live; farther portals show snapshots.
- **Measured** (headless Chrome, Apple Metal, 11 rooms, two runs each, before → after, shader cache warm):

  | | before | after |
  |---|---|---|
  | Loading gate ready | 3.0–3.1 s | 2.9 s |
  | GPU process memory at the gate | 721–769 MB | 600–607 MB |
  | GPU process memory after one lap | 942–948 MB | 694–758 MB |
  | JS heap after one lap | 30 MB | 31 MB |
  | Frames over 33 ms per lap | 4–7 (worst 100 ms) | 0–1 (worst 33 ms) |
  | Rooms-menu jump | 140–230 ms (one run) | 240–420 ms (one run) |

- **Snapshot on arrival**, not pre-made images: no upkeep.
  - *Tradeoff*: Until a room has been visited or neared, portals to it show the placeholder, and a snapshot taken later may contain one.
- **Dropped rooms start fresh** when you return.
- **Tradeoff**: Jumping to an unloaded room waits for its shaders and snapshots, so it is slower than before.

## Honey in da Hood Ya Heard room — `feat/honey-hood-room` (2026-11-25)

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

## Stutter when crossing portals — `fix/portal-crossing-stutter` (2026-11-25)

### Fixed

- **Freezes on every portal crossing (`engine/PortalPreviews.ts`)** — previews and snapshots hid the arrival portal along with its point light. The arrival portal's meshes are still hidden there, but its light now stays on.

### Design & engineering decisions

- **A room is lit the same in preview and when active**
  - *Why*: Three.js builds shaders for a room's set of lights. One light fewer in preview meant every lit object in the room you entered, and the one you left, was rebuilt on the crossing frame (50–120 ms), with a further freeze of up to 2.7 s on first visits.
  - *Decision*: Hide a portal by taking its meshes off all camera layers, which leaves lights underneath it on. In a headless Chrome run on Apple Metal, 23 consecutive crossings then stayed at 17 ms.
  - *Tradeoff*: Preview rooms now include the arrival gate's glow, as they do once you are inside.

## Platformer jump timing — `jp/platformer-input-fixes` (2026-11-25)

### Fixed

- Platformer jumps follow the same vertical trajectory at 20–240 FPS for the same hold duration. Movement now accounts for the time spent rising and falling within each frame. A held jump still matches Classic at 60 FPS, so players can clear the same ledges across frame rates in Platformer.
- Two Space taps between frames now start flight when the first tap launches a jump. The controller counts presses until its next update so a frame hitch cannot swallow the second tap.

## Platformer physics toggle — `feat/platformer-physics` (2026-11-25)

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
