# Portalverse

An open-source, community-built **Three.js WebGPU + TSL** portal metaverse where **anyone can clone the repo, build their own 3D room, and open a PR to join the shared portal loop**.

- **Play Live:** [portalverse-server-production.up.railway.app](https://portalverse-server-production.up.railway.app)
- **Add Your Room:** Fork or clone this repo, drop a folder in `worlds/<your-room>/`, register it in `registry.json`, and open a Pull Request!

Every contributed room is linked into one seamless circular promenade loop with live perspective-correct portal previews, real-time multiplayer presence, live portal linking, and federated portal handoffs between servers.

## Clone & Run Locally

```bash
git clone https://github.com/ericrius1/portalverse.git
cd portalverse
pnpm install
pnpm dev
```

*(Planning to submit a room? You can clone directly like above — `pnpm submit` will automatically create your GitHub fork and open a Pull Request when you're ready! Or start with `gh repo fork ericrius1/portalverse --clone`.)*

The repo pins `pnpm@12.23.0` via `packageManager` in `package.json` (you can also run `npx pnpm@12.23.0 install` if your global `pnpm` is older). *(`npm run dev` also works once dependencies are installed.)*

- **Client (Vite + WebGPU):** `http://localhost:5173` (proxies `/ws` and `/api` to the multiplayer server)
- **Multiplayer Server (`ws`):** `http://localhost:3001`

## Add Your Own Room (5-Minute Guide)

Anyone is welcome to contribute a room — by hand or with your favorite coding agent!

1. **Fork & clone** the repo and start the dev server (`pnpm dev`).
2. **Create `worlds/<your-room>/index.ts`** exporting `defineRoom(...)`:

   ```ts
   import * as THREE from 'three/webgpu';
   import { defineRoom } from '@portalverse/core/portal/defineRoom';

   export default defineRoom('my-room', {
     mount(ctx) {
       const geo = new THREE.IcosahedronGeometry(1);
       const mat = new THREE.MeshStandardMaterial({ color: '#38bdf8' });
       const mesh = new THREE.Mesh(geo, mat);
       mesh.position.y = 1.8;
       ctx.scene.add(mesh);

       ctx.onUpdate((dt) => {
         mesh.rotation.y += dt;
       });
       ctx.onDispose(() => {
         geo.dispose();
         mat.dispose();
       });
     },
   });
   ```

   Keep a walkable path between the entrance (`Z = +36.25`) and exit (`Z = -36.25`), level at `Y = 0` where it passes through each portal. Preview your room directly at `http://localhost:5173/?world=<your-room>`.

3. **Register your room in `registry.json`** by adding a `"kind": "local"` entry (with your GitHub handle as `owner`). Core tests discover rooms directly from `registry.json`, so you don't need to edit core test files.
4. **Keep loading smooth:** Rooms load while players walk through neighbors (~10 s sprinting, ~5 s boosting in flight) on the main thread. Break heavy setup into small slices with `await ctx.breathe()`, build static geometry/data once and reuse across mounts, and offload heavy pure math to Web Workers. See [Loading: about 10 seconds, in small pieces](./COLLAB.md#loading-about-10-seconds-in-small-pieces).
5. **Validate & submit a PR:** Run `pnpm run build && pnpm test` (which checks room asset budgets, types, bundle, and tests), add a short note to [CHANGELOG.md](./CHANGELOG.md), commit your changes, and run:

   ```bash
   pnpm submit
   ```

   `pnpm submit` automatically creates your GitHub fork if you don't have one yet, pushes a feature branch, and opens a Pull Request against `ericrius1/portalverse`. Once a maintainer merges your PR to `main`, GitHub Actions automatically deploys your room live!

See [COLLAB.md](./COLLAB.md#building-your-room) for the full room authoring contract, assets & budgets, falling/terrain APIs, and agent workflows.

## Community Rooms & Features

- **Seamless Circular Portal Loop (`registry.json`)** — currently 13 community rooms and growing:
  1. **Eric's Room (`worlds/eric-world`)** — Cyan holographic studio (`ericrius1`).
  2. **JP's Solarpunk Meadow (`worlds/jp-world`)** — Sunlit meadow with 26,000 Bezier-elastica grass blades, California wildflowers, and solar arches (`jpwhitaker`).
  3. **Breezy Plant Garden (`worlds/jp-garden`)** — Giant flat-coloured tropical plants swaying in the breeze and bending away as you pass (`jpwhitaker`).
  4. **Kāneʻohe Fishpond (`worlds/fishpond`)** — Hawaiian coastal *loko iʻa* boardwalk over turquoise TSL lagoon water, basalt walls, swaying palms, reef fish, and Koʻolau cliffs (`jpwhitaker`).
  5. **Coral Reef Walk (`worlds/jp-reef`)** — A sea-floor path through a coral canyon with caustic light, jellyfish, fish schools, a turtle, and a manta ray (`jpwhitaker`).
  6. **Night Loft (`worlds/jp-loft`)** — An open-plan loft above the night city, with warm lamps and a shiba that follows you around (`jpwhitaker`).
  7. **Abyss Stepping Stones (`worlds/jp-abyss`)** — A crooked path of ancient floating stones high above a chasm of drifting fog, glowing from beneath and trailing smoke, with needle spires rising out of the murk (`jpwhitaker`).
  8. **Palace Lagoon (`worlds/eric-palace-lagoon`)** — Earth's Palace of Fine Arts across a mirror-still lagoon at golden hour, from a wind-blown wildflower meadow. The first room drawn with [weft](https://github.com/ericrius1/weft) instead of Three.js, composited with depth through the engine's GPU layers (`ericrius1`).
  9. **Laser Forcefield Arena (`worlds/laser-lab`)** — Pitch-black light-show gallery with sweeping volumetric TSL laser fans, pulsing scanline forcefield walls, and floating prisms (`jpwhitaker`).
  10. **Alpine Snow Run (`worlds/alpine-sled`)** — Twilight snow promenade with lantern-lit sled fences, frosted fir forests, alpenglow peaks, toboggans, and drifting snow (`jpwhitaker`).
  11. **Bioluminescent Redwood Grove (`worlds/eric-biolum-grove`)** — Nocturnal redwood cathedral under TSL aurora curtains, player-reactive glowing mushrooms, and drifting firefly spores (`ericrius1`).
  12. **Golden Cloud Observatory (`worlds/eric-sun-observatory`)** — Floating marble-and-brass celestial bridge above a sunset TSL cloud sea, crowned by colossal rotating brass armillary rings (`ericrius1`).
  13. **Honey in da Hood Ya Heard (`worlds/honey-hood`)** — A winding road of light-up tiles through honey-dripping trees, golden plants, and a fire hydrant, under a giant bee in a blue jacket who eats passing birds (`simplesessions`).
  14. **Midnight Cassette Station (`worlds/doug-cassette-station`)** — A calming blue-hour rain-washed cyber-tramway and glowing moss conservatory with neon-reflecting rain puddles, floating holographic koi, a spinning cassette archway, sleeping station calico, glowing vending machines, 24H steaming tea kiosk, channel-switching 90s CRT shrine, singing red payphone, lo-fi synth tiles, elevated twilight commuter train, and five hidden mixtapes (`douglascalhoun`).
- **Seamless Circular Portals & 3rd-Person Traversal**:
  - Perspective-correct live portal windows at screen resolution, two rooms deep along the loop, so the portal at the far end of the next room is already live and stays steady as you walk through. Portals beyond that show snapshots.
  - A distance-compressed lens that keeps distant doors small, zero-dip 3rd-person walk-through crossings (forward or backing in) with mirrored character transit, and an organic liquid-membrane warp that builds as you walk into a portal's warp zone.
- **Round Preload Gate**:
  - Preloads WebGPU, adjacent rooms, portal snapshots, and post-processing pipelines behind a circular click-to-enter curtain gate for stutter-free room transitions.
- **Direct Shareable Links & Real-Time Co-op (`M` / `P`)**:
  - Copy direct room deep links (`?world=<room-id>`), see who is in each room, click a friend to join them, or spawn new local/federated portals (`P`).

### Controls

- **Look (FPS + Pointer Lock):** Click the 3D scene to lock your mouse and look around (`Esc` unlocks cursor for menus)
- **Move / Steer in Flight:** `WASD` or Arrow keys
- **Sprint / Flight Boost:** Hold `Shift` (sprint on foot, smooth boost in flight)
- **Jump & Fly:** `Space` to jump (hold for higher); press `Space` again while in the air to take off into flight
- **Rise / Descend & Land:** `Q` (or `Space`) rises up while flying; hold `E` to descend and land onto the ground
- **Enter Portal:** Walk or fly straight through any circular portal (or press `E` nearby on foot)
- **Toggle 1st / 3rd Person Camera:** `V` (defaults to 1st-person FPS)
- **Toggle Walking Physics:** `G` switches between **Classic** (default) and **Platformer** (momentum, faster falls, jump height follows how long you hold `Space`); your browser remembers the choice
- **Controls & Interactive Tutorial:** `H` or `?` (or choose **Interactive Tutorial** on the loading gate)
- **Debug — Warp zones:** tick the checkbox in the controls bar to see each portal's warp zone
- **Spawn Live Portal:** `P`
- **Rooms & Direct Share Links:** `M`

## Project Layout

```text
portalverse/
├── app/                     # Client entrypoint, loading gate & glassmorphic HUD
├── packages/
│   ├── core/
│   │   ├── src/types.ts     # Shared WorldModule, Portal & Net contracts
│   │   ├── src/engine/      # WebGPU WorldEngine, room crossings, PortalPreviews, PortalRipplePass, AvatarController
│   │   ├── src/shaders/     # Three.js WebGPU TSL portal shaders
│   │   ├── src/net/         # MultiplayerClient (WebSocket + auto-reconnect + offline mode)
│   │   ├── src/portal/      # defineRoom, roomLayout, WorldRegistry & federated URL handoff
│   │   └── src/rooms/       # kit.ts: model loading, grounding & cleanup helpers for rooms
│   └── server/              # Authoritative WebSocket room, presence & dynamic portal server
├── worlds/                  # One folder per community room — add yours here!
│   ├── <your-room>/         # Your contributed room (index.ts + local assets)
│   └── ...                  # 12 community rooms currently in the loop
├── registry.json            # World catalog, loop order & spawn manifest
├── COLLAB.md                # Full contributor & room authoring guide
├── AGENTS.md                # Coding agent conventions & deploy checklist
└── CHANGELOG.md             # Feature history & design decisions
```

## Scripts

```bash
pnpm dev         # Run multiplayer server + Vite client together
pnpm check:rooms # Check room folders, side links, and asset sizes
pnpm typecheck   # Strict TypeScript check
pnpm test        # Run Vitest suite (server, protocol, handoff, registry, portals, room crossings)
pnpm build       # Production build (check:rooms + typecheck + vite build)
pnpm submit      # Auto-fork (if needed), push a feature branch, and open a PR to ericrius1/portalverse
```

See [COLLAB.md](./COLLAB.md) for the full contributor guide, [AGENTS.md](./AGENTS.md) for agent/maintainer conventions, and [CHANGELOG.md](./CHANGELOG.md) for recent changes and engineering decisions.
