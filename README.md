# Portalverse

A co-op **Three.js WebGPU + TSL** portal metaverse built for **Eric (`ericrius1`)** and **JP (`jpwhitaker`)** to co-develop in parallel — with isolated personal rooms linked in a seamless circular portal loop, live perspective-correct portal previews, real-time multiplayer presence, live portal linking, and federated cross-URL portal handoffs.

Edit [your room module](./worlds/jp-world/index.ts) and walk or sprint through the circular portals to explore the connected loop. The [room authoring guide](./COLLAB.md#building-your-room) covers the shared `defineRoom` contract, spawns, and budgets. See [CHANGELOG.md](./CHANGELOG.md) for recent changes and architectural decisions.

## Features

- **10-Room Seamless Circular Loop** (`registry.json`):
  1. **Eric's Room (`worlds/eric-world/index.ts`)** — Cyan holographic studio (`ericrius1`).
  2. **JP's Solarpunk Meadow (`worlds/jp-world/index.ts`)** — Sunlit meadow with 26,000 Bezier-elastica grass blades, California wildflowers, and solar arches.
  3. **Breezy Plant Garden (`worlds/jp-garden/index.ts`)** — Giant flat-coloured tropical plants from JP's portfolio garden, swaying in the breeze and bending away as you pass.
  4. **Kāneʻohe Fishpond (`worlds/fishpond/index.ts`)** — Hawaiian coastal *loko iʻa* boardwalk over turquoise TSL lagoon water, basalt walls, swaying palms, reef fish, and Koʻolau cliffs.
  5. **Coral Reef Walk (`worlds/jp-reef/index.ts`)** — A sea-floor path through a coral canyon with caustic light, jellyfish, fish schools, a turtle and a manta ray.
  6. **Night Loft (`worlds/jp-loft/index.ts`)** — An open-plan loft above the night city, with warm lamps and a shiba that follows you around.
  7. **Laser Forcefield Arena (`worlds/laser-lab/index.ts`)** — Pitch-black light-show gallery with sweeping volumetric TSL laser fans, pulsing scanline forcefield walls, and floating prisms.
  8. **Alpine Snow Run (`worlds/alpine-sled/index.ts`)** — Twilight snow promenade with lantern-lit sled fences, frosted fir forests, alpenglow peaks, toboggans, and drifting snow.
  9. **Bioluminescent Redwood Grove (`worlds/eric-biolum-grove/index.ts`)** — Nocturnal redwood cathedral under TSL aurora curtains, player-reactive glowing mushrooms, and drifting firefly spores.
  10. **Golden Cloud Observatory (`worlds/eric-sun-observatory/index.ts`)** — Floating marble-and-brass celestial bridge above a sunset TSL cloud sea, crowned by colossal rotating brass armillary rings.
- **Seamless Circular Portals & 3rd-Person Traversal**:
  - Perspective-correct live portal windows at screen resolution, two rooms deep along the loop, so the portal at the far end of the next room is already live and stays steady as you walk through. Portals beyond that show snapshots.
  - A distance-compressed lens that keeps distant doors small, zero-dip 3rd-person walk-through crossings (forward or backing in) with mirrored character transit, and an organic liquid-membrane warp that builds as you walk into a portal's warp zone, strongest at the ring and a little stronger when you're moving.
- **Round Preload Gate**:
  - Preloads WebGPU, adjacent rooms, portal snapshots, and post-processing pipelines behind a circular click-to-enter curtain gate for stutter-free room transitions.
- **Direct Shareable Links & Real-Time Co-op (`M` / `P`)**:
  - Copy direct room deep links (`?world=eric-world`, `?world=jp-world`, `?world=fishpond`, `?world=laser-lab`, `?world=alpine-sled`), see who is in each room, click a friend to join them, or spawn new local/federated portals (`P`).

## Quick Start

```bash
pnpm install
pnpm dev
```

The repo pins pnpm 12.23.0 through `packageManager` in `package.json`, and CI installs the same version. *(`npm run dev` also works once dependencies are installed.)*

- **Client (Vite + WebGPU):** `http://localhost:5173` (proxies `/ws` and `/api` to the multiplayer server)
- **Multiplayer Server (`ws`):** `http://localhost:3001`

### Controls

- **Look (FPS + Pointer Lock):** Click the 3D scene to lock your mouse and look around (`Esc` unlocks cursor for menus)
- **Move / Fly:** `WASD` or Arrow keys
- **Sprint:** Hold `Shift` while moving (the two circular gates are 5 sprint seconds apart)
- **Enter Portal:** Walk/fly straight through any circular portal, or press `E` while facing it nearby
- **Ascend / Descend (Flight) / Jump:** `Space` / `C` (or `Q`)
- **Toggle Flight Mode:** `F`
- **Toggle 1st / 3rd Person Camera:** `V` (defaults to 1st-person FPS)
- **Controls & Interactive Tutorial:** `H` or `?` (or choose **Interactive Tutorial** on the loading gate)
- **Debug — Warp zones:** tick the checkbox in the controls bar to see each portal's warp zone (a wireframe sphere, and the floor circle the warp is measured on)
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
├── worlds/
│   ├── eric-world/          # Eric's personal room
│   ├── jp-world/            # JP's Solarpunk Meadow (and its meadow shaders)
│   ├── jp-garden/           # Breezy Plant Garden
│   ├── fishpond/            # Kāneʻohe Fishpond
│   ├── jp-reef/             # Coral Reef Walk
│   ├── jp-loft/             # Night Loft
│   ├── laser-lab/           # Laser Forcefield Arena
│   └── alpine-sled/         # Alpine Snow Run
├── registry.json            # World catalog, loop order & spawn manifest
└── CHANGELOG.md             # Feature history & design decisions
```

## Scripts

```bash
pnpm dev         # Run multiplayer server + Vite client together
pnpm check:rooms # Check room folders, side links, and asset sizes
pnpm typecheck   # Strict TypeScript check
pnpm test        # Run Vitest suite (server, protocol, handoff, registry, portals, room crossings)
pnpm build       # Production build
```

See [COLLAB.md](./COLLAB.md) for the Eric + JP co-working guide in **T3 Code**, and [CHANGELOG.md](./CHANGELOG.md) for detailed change history and engineering decisions.
