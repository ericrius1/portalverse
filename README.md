# Portalverse

A co-op **Three.js WebGPU + TSL** portal metaverse built for **Eric (`ericrius1`)** and **JP (`jpwhitaker`)** to co-develop in parallel — with isolated personal rooms, switchable Portal Hub representations, real-time multiplayer presence, live portal linking, and federated cross-URL portal handoffs.

## Features

- **Switchable Portal Hub (`worlds/hub/index.ts`)** — Pick between 3 portal hub representations live from the HUD or via URL:
  - **✦ Fountains (`?world=hub&hubStyle=fountains`)**: Hover high above a 5×5 grid of erupting blue magic fountains with TSL glowing water plumes — **fly down into any fountain or click directly on it** to enter that world.
  - **✿ Solarpunk Meadow (`?world=hub&hubStyle=meadow`)**: Wind-swept sunlit meadow modeled on the `world` project's cubic-Bezier elastica grass blades, coherent rolling wind waves, silvery wind sheen, California wildflower drifts (poppies, lupines, oxeye daisies, buttercups, checkerbloom), and **giant blooming flowers whose petals open to reveal glowing portals inside**.
  - **◎ Starlight Nexus (`?world=hub&hubStyle=nexus`)**: Obsidian starlight courtyard with glowing portal archways.
- **Unmistakable Placeholder Rooms**:
  - **Eric's Room (`worlds/eric-world/index.ts`)** — Cyan holographic studio clearly marked `ERIC'S ROOM · ericrius1`.
  - **JP's Room (`worlds/jp-world/index.ts`)** — Warm amber solar studio clearly marked `JP'S ROOM · jpwhitaker`.
- **Direct Shareable Links**:
  - Click **Share Link** in the HUD or open **Rooms (`M`)** to copy direct deep links to the Portal Hub (in any style), Eric's Room (`?world=eric-world`), or JP's Room (`?world=jp-world`).
- **Real-Time Co-op & Live Portal Spawning (`P`)**:
  - Walk/fly together across rooms, see who is in which room (click a friend's name to join them), and drop new portals pointing to local worlds or external federated URLs.

## Quick Start

```bash
pnpm install
pnpm dev
```

- **Client (Vite + WebGPU):** `http://localhost:5173` (proxies `/ws` and `/api` to the multiplayer server)
- **Multiplayer Server (`ws`):** `http://localhost:3001`

### Controls

- **Move / Fly:** `WASD` or Arrow keys
- **Look:** Click & drag anywhere on canvas
- **Enter Portal:** Click any fountain / blooming flower / portal arch, walk/fly right into it, or press `E` nearby
- **Ascend / Descend (Flight) / Jump:** `Space` / `C` (or `Q`)
- **Toggle Flight Mode:** `F`
- **Toggle 1st / 3rd Person Camera:** `V`
- **Spawn Live Portal:** `P`
- **Rooms & Direct Share Links:** `M`

## Project Layout

```text
portalverse/
├── app/                     # Client entrypoint & glassmorphic HUD
├── packages/
│   ├── core/
│   │   ├── src/types.ts     # Shared WorldModule, Portal, & Net contracts
│   │   ├── src/engine/      # WebGPU WorldEngine, Portal prefabs, AvatarController
│   │   ├── src/shaders/     # Three.js WebGPU TSL portal, fountain & meadow shaders
│   │   ├── src/net/         # MultiplayerClient (WebSocket + auto-reconnect + offline mode)
│   │   └── src/portal/      # WorldRegistry & federated URL handoff encoder/decoder
│   └── server/              # Authoritative WebSocket room, presence & dynamic portal server
├── worlds/
│   ├── hub/index.ts         # Switchable Portal Hub (Fountains / Solarpunk Meadow / Nexus)
│   ├── eric-world/index.ts  # Eric's personal room (edit freely!)
│   └── jp-world/index.ts    # JP's personal room (edit freely!)
└── registry.json            # World catalog & spawn manifest
```

## Scripts

```bash
pnpm dev        # Run multiplayer server + Vite client together
pnpm typecheck  # Strict TypeScript check
pnpm test       # Run Vitest suite (server, protocol, handoff, registry)
pnpm build      # Production build
```

See [COLLAB.md](./COLLAB.md) for the Eric + JP co-working guide in **T3 Code** with **Claude Opus 5.5 + Gemini 4 Neon**.
