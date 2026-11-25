# Co-Working Guide — Eric (`ericrius1`) & JP (`jpwhitaker`) in T3 Code

This repo is structured so you both—plus **Claude Opus 5.5** and **Gemini 4 Neon**—can build simultaneously with zero merge conflicts.

## 1. File Ownership (No Merge Hell)

- **Eric builds freely in:** `worlds/eric-world/` (plus any new `worlds/eric-*/` worlds)
- **JP builds freely in:** `worlds/jp-world/` (plus any new `worlds/jp-*/` worlds)
- **Shared Hub & SDK (`worlds/hub/`, `packages/core/`, `packages/server/`, `registry.json`):** Update via short PRs or in a shared T3 Code session.

### Adding a New World

1. Create `worlds/<your-world>/index.ts` exporting a default `WorldModule` (copy `worlds/eric-world/index.ts` or `worlds/jp-world/index.ts` as a starter).
2. Add its manifest entry to `registry.json`.
3. Add a lazy loader line in `app/main.ts` (`'your-world': () => import('@portalverse/worlds/your-world/index')`).
4. Link to it from `worlds/hub/index.ts` or spawn a live portal in-game with **`P`**.

## 2. Sharing a T3 Code Agent Space

Pick the workflow that fits your session:

1. **Live Pair Session (Fastest tonight — Guest Links)**
   - Host enables **T3 Connect** and **Settings → Labs → Guest links**.
   - Right-click the active thread → **Share with guest** and send the URL.
   - Guest watches the agent stream live and submits prompts (host approves requests).
2. **True Shared Agent Room (Shared Dev Box / VPS)**
   - Run T3 Code on a shared cloud VM (`npx t3 serve` + `npx t3 pair`, or T3 Connect + **Settings → Sharing & access → Authorized clients**).
   - Both of you connect your T3 Code clients to that environment and work in isolated git worktrees side by side.
3. **Linked Local Machines (Peer Agent Delegation)**
   - Both enable **Settings → Labs → Linked environments**.
   - Exchange a pairing link under **Settings → Sharing & access → Authorized clients → Create link**.
   - Your agents can inspect each other's threads and delegate tasks across machines.

## 3. Running Claude Opus 5.5 + Gemini 4 Neon Together

- **Split by strength in worktrees:**
  - **Claude Opus 5.5**: multiplayer protocol, server state (`packages/server/`), physics/collision, portal handoffs (`packages/core/src/portal/`), and tests.
  - **Gemini 4 Neon**: Three.js WebGPU + TSL shaders (`packages/core/src/shaders/`), 3D world design (`worlds/`), animations, and HUD (`app/`).
- **Cross-model review:** Before merging a PR into `main`, delegate a quick review to the opposite model.

## 4. Playing Together Over the Internet

Because Vite proxies `/ws` and `/api` through port `5173`, exposing a single URL (via Tailscale, Cloudflare Tunnel, or a small VPS deploy) gives both of you full 3D + live multiplayer on one link:

- **Share the Portal Hub (Fountains):** `<your-url>/?world=hub&hubStyle=fountains`
- **Share the Portal Hub (Solarpunk Meadow):** `<your-url>/?world=hub&hubStyle=meadow`
- **Share Eric's Room directly:** `<your-url>/?world=eric-world`
- **Share JP's Room directly:** `<your-url>/?world=jp-world`

You can also run **two completely separate servers** and connect them via **+ Link Portal (`P`) → Remote Federated URL**—stepping into the portal hands off your explorer name, aura color, and automatically spawns a glowing return portal back to your friend's server.
