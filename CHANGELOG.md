# Changelog

Notable changes and design decisions in **Portalverse**, newest first. Each section names the commit it shipped in. `Unreleased` is work on `jp/seamless-portals` that hasn't been committed yet.

## [Unreleased] — `jp/seamless-portals` (2026-11-24)

### Added

- **Three new rooms** linked into a five-room loop (`eric-world` → `jp-world` → `fishpond` → `laser-lab` → `alpine-sled` → `eric-world`):
  - **Kāneʻohe Fishpond (`worlds/fishpond/index.ts`)** — a Hawaiian coastal *loko iʻa* inspired by `water-pro-fishpond` & `ahupuaa`: a timber-and-basalt *kuapā* boardwalk, animated TSL turquoise lagoon water with caustics and specular glints, lava-rock walls, coral sandbars, swaying coconut palms, 90 instanced reef fish, and fluted Koʻolau cliffs.
  - **Laser Forcefield Arena (`worlds/laser-lab/index.ts`)** — a pitch-black light-show hall inspired by `laser`: a neon TSL runway grid, gantry emitters sweeping 24 additive TSL laser beams, pulsing scanline forcefield walls, and hovering obsidian prisms.
  - **Alpine Snow Run (`worlds/alpine-sled/index.ts`)** — a twilight alpine valley inspired by `sled2` & `christmas`: TSL crystal-glint snow, split-rail sled fences, amber lantern posts, 136 snow-dusted firs, alpenglow peaks, toboggans, gift stacks, and 450 drifting snowflakes.
- **Round loading gate (`index.html`, `app/styles.css`, `app/main.ts`)** — split obsidian curtains around a circular medallion with a rising liquid fill and progress ring. It tracks the real startup phases (WebGPU init → first room → adjacent rooms → portal snapshots → ripple warm-up), locks controls until ready, then shows **ENTER**.
- **Snapshots for distant portals (`PortalPreviews.ts`)** — during the loading gate, every room's entrance and exit sightline is captured into a 512×512 snapshot, in two passes so portals inside snapshots show real rooms too. The avatar is hidden during capture. Portals two rooms away sample these snapshots with POV parallax and fog, then crossfade over 0.55 s to the live view when you enter the room in front of them.
- **Far-portal de-emphasis (`roomLayout.ts`, `PortalPreviews.ts`)** — the active room's portals always stay at 1.0× scale. Route gates seen *inside* the next room start at 0.30× (from 145 m) and grow to 1.0× by the time you reach the threshold (72.5 m), so the next room's own scenery dominates and nothing jumps on entry.
- **Distance-compressed portal lens (`roomLayout.ts`, `PortalPreviews.ts`)** — `effectivePortalDistance` is exact inside 12 m and eases to 15.5 m at 72.5 m, widening a live window seen from across the room from a ±2.3° keyhole to the snapshot's framing, while pixels on the opening's plane stay registered to the ring.
- **Threshold-aligned fog in live windows (`PortalPreviews.ts`)** — the destination's linear fog is offset by the virtual camera's compressed distance, so fog starts at the threshold instead of behind it.
- **Always-on liquid wave pass (`PortalRipplePass.ts`, `WorldEngine.ts`)** — the frame always renders through one persistent post-processing target. A flowing wave fades in from 75% of portal vertical FOV, peaks at the threshold, fades out symmetrically on the far side, and strengthens with movement speed.
- **Room-crossing tests (`packages/core/src/__tests__/roomCrossing.test.ts`)** — 19 tests cover threshold detection, camera-crossing promotion, arrival transforms for every route gate in the catalog, the active/preview room lifecycle, snapshot-material cleanup, live-window resolution, and federated arrival placement. The crossing rules moved from `WorldEngine` into a pure module (`engine/portalCrossing.ts`) so they run without a GPU.

### Changed

- **Circular portals everywhere (`PortalMesh.ts`, `RoomInstance.ts`)** — the square gilt `PaintingPortal` is replaced by the circular starlight ring (`createArchwayPortal`, `PORTAL_RADIUS = 2.85`) with grounded side plinths and a clear `Y = 0` threshold.
- **3rd-person portal traversal (`WorldEngine.ts`, `AvatarController.ts`, `PortalPreviews.ts`)**:
  - The camera no longer dips into first person on approach (`blendToEye`) or swoops on click (`approachPainting`).
  - While crossing, the character is mirrored into the destination preview by a transit rig (`createStylizedAvatarRig`). The destination `RoomInstance` is promoted synchronously on the frame the camera crosses the plane (`takeReady` + `promotePortalSync`).
  - Clicking a portal, or pressing `E`, walks the character through the opening with the chase camera following.
- **Live portal windows render at screen resolution (`PortalPreviews.ts`)** — each window's target matches the drawing buffer, and each frame renders only the opening's on-screen rectangle into it at one texel per screen pixel. Windows are pooled and resize only when the browser window does, so crossings still allocate nothing, and small distant portals cost less than before. This replaces a fixed 1024×1024 window from earlier on this branch, which blurred openings that filled most of the screen.
- **One render-target format for every room pass (`engine/sceneTarget.ts`)** — the main view, live windows and snapshots all render to `rgba16float` with one sample, so a preview room promoted to active reuses pipelines it already compiled. The cost is no MSAA; change it in that one function to change all three passes together.
- **Federated return portal (`handoff.ts`, `app/main.ts`)** — a traveller arriving from another server appears 6 m into the room with the return portal right behind them: turn around and walk back through it to go home. It is one-way, so walking down the room from the entrance passes harmlessly through its back. It used to stand on the central path 45 m ahead.
- **Remote portals trigger by walking through the ring**, like local portals, instead of on proximity.
- **`ctx.onActivate` may return a cleanup** that runs when the player leaves and the room drops back to a preview.
- **Performance (`PortalPreviews.ts`, `PortalRipplePass.ts`, `WorldEngine.ts`, `app/main.ts`)** — pooled live-window rigs with precompiled TSL materials, the ripple pass prewarmed during the loading gate, all five rooms kept mounted (`MAX_HOT_ROOMS = 6`), fewer per-frame allocations, no DOM rebuilds for hidden modals on crossing, and `history.replaceState` deferred off the crossing frame.
- **Fog tuning (`worlds/jp-world/meadow.ts`, `worlds/fishpond/index.ts`, `worlds/alpine-sled/index.ts`, `worlds/laser-lab/index.ts`)** — linear fog now starts beyond the 72.5 m promenade, so sunlit rooms stay crisp and far horizons keep their haze.
- **Tooling** — `pnpm dev` runs its halves with `npm run`, so `npm run dev` works too, and the repo pins pnpm 12.23.0 through `packageManager`.

### Fixed

- **CI install** — the workflow installed with pnpm 8, which can't read the regenerated v9 lockfile or a `pnpm-workspace.yaml` without `packages`. `allowBuilds.esbuild` also still held pnpm's placeholder, which fails `--frozen-lockfile` installs with `ERR_PNPM_IGNORED_BUILDS`. CI now uses the pinned pnpm, and esbuild's install script is allowed.
- **Rooms you left stayed "active"** — a room kept as a preview after you left still reported `mode: 'active'`, kept its portal-entry callback, and re-ran `onActivate` on each return without stopping anything. Rooms now deactivate when they go back into the preview cache.
- **Snapshot-material leak** — jumping to a room that isn't next door (the Rooms menu, or joining a friend) disposed the old room but kept the snapshot materials on its portals.
- **Snapshots upside down on the WebGL fallback** — the snapshot lookup flipped V for WebGL, but three.js already samples render targets top-down in both backends.

### Removed

- **Portal hub & style switcher** — `worlds/hub/index.ts`, its registry entry (the default world is now `eric-world`), and the `[✦ Fountains | ✿ Meadow | ◎ Nexus]` switcher in `index.html`, `app/styles.css` and `app/main.ts`.
- **Hub leftovers** — the `HubStyle` type and the `hubStyle` / `targetHubStyle` / `defaultHubStyle` fields threaded through the engine, registry, handoff payload and server protocol, plus about 600 lines of unused fountain and flower portal builders and their shaders. Old `?hubStyle=` links still open the named room. JP's meadow shaders moved from `packages/core` to `worlds/jp-world/`.
- **Square portal & portal chrome** — `packages/core/src/engine/PaintingPortal.ts`, the floating title signs above portals, and the hover tooltip (`#hover-tooltip`).

### Design & engineering decisions

- **Promote when the camera crosses, with a transit character (not when the feet cross, with a first-person dip)**
  - *Problem*: swapping rooms when the feet reached the plane left the 3rd-person camera 5.6 m behind in the old room, which forced a dip into first person (`blendToEye`) and hid the character.
  - *Decision*: stay in 3rd person throughout. Once the character steps past the plane, mirror it into the destination preview (clipped by the portal's oblique near plane, while the source-side opening hides the original), then promote the destination on the frame the *camera* crosses.
- **Threshold snapshots with a fog offset**
  - *Problem*: capturing snapshots from 72.5 m back (about a 10.8° telephoto FOV) compressed the next room so the room two hops away filled half the portal (pitch-black Laser Lab inside sunlit Kāneʻohe), while linear fog washed out the foreground.
  - *Decision*: capture from 15.5 m behind each threshold (`SNAPSHOT_REF_DISTANCE`, equal to the lens reference distance), with a 6.2 m half-height window, for a 43.6° FOV, and the near plane on the threshold. Offset linear fog by that distance during capture, and give snapshot apertures `fog = true` so distant nested portals recede into haze.
- **De-emphasize far portals, but never the active room's**
  - *Problem*: scaling portals by distance made the active room's doors visibly shrink as you walked toward them, and made portals inside the next room dominate its preview.
  - *Decision*: keep the active room's portals at 1.0×, and scale only route gates seen inside preview rooms (`farPortalScale`: 0.30× at 145 m growing to 1.0× at 72.5 m), so they reach 1.0× exactly as you enter.
- **Distance-compressed live lens matched to the snapshots**
  - *Problem*: physically exact framing put the virtual camera 72.5 m behind the destination threshold, a ±2.3° keyhole that cropped side trees, fences and lanterns, and caused a visible FOV pop when the wider snapshot handed over to the live view.
  - *Decision*: apply a portal-local Z compression in `framePortal` (`effectivePortalDistance`: exact to 12 m, 15.5 m at 72.5 m, the same as `SNAPSHOT_REF_DISTANCE`), so pixels on the opening's plane stay registered, far rooms keep a wide framing, and the snapshot-to-live handover has no pop.
- **One target format and an always-on wave pass**
  - *Problem*: toggling an offscreen post-processing pass switched colour format and sample count (`bgra8unorm` MSAA → `rgba16float` single-sample), compiling duplicate scene pipelines right at the threshold; a one-shot timer also felt disconnected from the player's position and speed.
  - *Decision*: keep `PortalRipplePass` always on in the same format as live windows and snapshots, now enforced by `createSceneTarget`. Drive the wave phase continuously and set its strength from a bell curve around the threshold, scaled by movement speed.
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
