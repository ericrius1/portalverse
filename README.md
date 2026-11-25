# Portalverse

A co-op **Three.js WebGPU + TSL** portal metaverse built for **Eric (`ericrius1`)** and **JP (`jpwhitaker`)** to co-develop in parallel — with isolated personal rooms linked in a seamless circular portal loop, live perspective-correct portal previews, real-time multiplayer presence, live portal linking, and federated cross-URL portal handoffs.

Edit [your room module](./worlds/jp-world/index.ts) and walk or sprint through the circular portals to explore the connected loop. The [room authoring guide](./COLLAB.md#building-your-room) covers the shared `defineRoom` contract, spawns, and budgets. See [CHANGELOG.md](./CHANGELOG.md) for recent changes and architectural decisions.

## Features

- **5-Room Seamless Circular Loop** (`registry.json`):
  1. **Eric's Room (`worlds/eric-world/index.ts`)** — Cyan holographic studio (`ericrius1`).
  2. **JP's Solarpunk Meadow (`worlds/jp-world/index.ts`)** — Sunlit meadow with 26,000 Bezier-elastica grass blades, California wildflowers, and solar arches.
  3. **Kāneʻohe Fishpond (`worlds/fishpond/index.ts`)** — Hawaiian coastal *loko iʻa* boardwalk over turquoise TSL lagoon water, basalt walls, swaying palms, reef fish, and Koʻolau cliffs.
  4. **Laser Forcefield Arena (`worlds/laser-lab/index.ts`)** — Pitch-black light-show gallery with sweeping volumetric TSL laser fans, pulsing scanline forcefield walls, and floating prisms.
  5. **Alpine Snow Run (`worlds/alpine-sled/index.ts`)** — Twilight snow promenade with lantern-lit sled fences, frosted fir forests, alpenglow peaks, toboggans, and drifting snow.
- **Seamless Circular Portals & 3rd-Person Traversal**:
  - Perspective-correct live portal windows at screen resolution, two rooms deep along the loop, so the portal at the far end of the next room is already live and stays steady as you walk through. Portals beyond that show snapshots.
  - Shared forced-perspective scaling for distant doors, zero-dip 3rd-person walk-through crossings with mirrored character transit, and a brief organic liquid-membrane wobble post-process triggered as the portal fills the screen.
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

- **Move / Fly:** `WASD` or Arrow keys
- **Sprint:** Hold `Shift` while moving (the two circular gates are 5 sprint seconds apart)
- **Look:** Click & drag anywhere on canvas
- **Enter Portal:** Walk/fly straight through any circular portal, or press `E` while facing it nearby
- **Ascend / Descend (Flight) / Jump:** `Space` / `C` (or `Q`)
- **Toggle Flight Mode:** `F`
- **Toggle 1st / 3rd Person Camera:** `V`
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
│   │   └── src/portal/      # defineRoom, roomLayout, WorldRegistry & federated URL handoff
│   └── server/              # Authoritative WebSocket room, presence & dynamic portal server
├── worlds/
│   ├── eric-world/          # Eric's personal room
│   ├── jp-world/            # JP's Solarpunk Meadow (and its meadow shaders)
│   ├── fishpond/            # Kāneʻohe Fishpond
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
