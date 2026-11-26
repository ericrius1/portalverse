# Portalverse — Agent & Collaboration Guide

Portalverse is a co-op **Three.js WebGPU + TSL** portal metaverse co-developed by **Eric (`ericrius1`)** and **JP (`jpwhitaker`)**.

## 1. Push & Auto-Deploy (Live Production)

Everything—both the Vite WebGPU frontend (`dist/`) and the authoritative multiplayer WebSocket server (`/ws`, `/api/health`, `/api/worlds`)—is hosted together on **Railway** and **auto-deploys from `origin/main`**. There is **no Vercel** deployment.

- **Live URL:** https://portalverse-server-production.up.railway.app
- **Health / Presence API:** https://portalverse-server-production.up.railway.app/api/health
- **Multiplayer WebSocket:** `wss://portalverse-server-production.up.railway.app/ws` (same-origin, no env vars needed)

### Always Keep `CHANGELOG.md` Updated (Shared Context Between Eric, JP & Agents)
- **At the start of feature work**, skim the top of [CHANGELOG.md](./CHANGELOG.md) so you know what the other collaborator recently changed and *why*.
- **For every feature or notable change**, update [CHANGELOG.md](./CHANGELOG.md) (newest first) *before pushing* with:
  - **What changed** (`Added` / `Changed` / `Fixed` / `Removed`)
  - **Why it changed** (`Design & engineering decisions` — capture the prompting intent, problem solved, and tradeoffs so both collaborators and future agents stay aligned).

### When Eric or JP asks to "push" or "deploy":
1. Make sure [CHANGELOG.md](./CHANGELOG.md) reflects the feature(s) and the *why* behind them.
2. Verify locally first:
   ```bash
   pnpm run build   # runs check:rooms && tsc --noEmit && vite build
   pnpm test        # runs full Vitest suite
   ```
3. Sync cleanly with `origin/main` (never force-push `main`):
   ```bash
   git fetch origin
   git checkout main
   git pull --rebase origin main
   ```
   *(If working on a feature branch like `eric/...` or `jp/...`, merge it cleanly into `main`, re-run `pnpm run build && pnpm test`, then push.)*
4. Push to `main`:
   ```bash
   git push origin main
   ```
5. **Auto-deploy happens automatically on Railway** (typically ~45–90 seconds; no Railway CLI login is required for either collaborator).
6. Verify the live redeploy before finishing:
   - Check `GET https://portalverse-server-production.up.railway.app/api/health` returns `200 OK` with `"ok": true` and includes any newly added room IDs in `worlds`.
   - Check `GET https://portalverse-server-production.up.railway.app/` returns `200 OK`.

## 2. File Ownership & Branch Conventions

- **Eric (`ericrius1`)**: builds freely in `worlds/eric-world/` and `worlds/eric-*/` (branches: `eric/<topic>`).
- **JP (`jpwhitaker`)**: builds freely in `worlds/jp-world/` and `worlds/jp-*/` (branches: `jp/<topic>`).
- **Shared code** (`packages/core/`, `packages/server/`, `app/`, `registry.json`): keep changes small, well-tested, and synced cleanly with `origin/main`.
- **Shared T3 Code threads**: prefix thread titles with **`[Eric]`**, **`[JP]`**, or **`[Shared]`** so both collaborators can immediately tell whose thread is whose.

## 3. Adding or Editing a Room

1. Create `worlds/<room-id>/index.ts` exporting `defineRoom('<room-id>', { mount(ctx) { ... } })`.
2. Add a matching `"kind": "local"` entry to `registry.json` (catalog order defines the circular portal promenade loop).
3. Update the expected room order lists in `packages/core/src/__tests__/roomPortals.test.ts` and `packages/core/src/__tests__/handoffAndRegistry.test.ts` if adding/reordering rooms.
4. Follow the room contract:
   - **Portal alignment**: Engine places `entrance` at `Z = +36.25` and `exit` at `Z = -36.25`, both at `X = 0`. There must be a walkable path from portal to portal, level at `Y = 0` where it passes through each portal. Between the portals it may wind, rise and fall, as long as nothing blocks it. Make it walkable with `ctx.addPlatform(...)` and/or `ctx.setTerrainHeight(...)`.
   - **Falling (opt-in)**: Rooms have a floor everywhere unless they call `ctx.allowFalling(...)`. A room that allows falling returns `NO_GROUND` (from `@portalverse/core/rooms/kit`) from its terrain height where there's nothing to stand on. With `respawnBelow`, falling past that height dims the screen and offers a Respawn button, which puts the player back where they entered the room. Leave it out if the room has its own ground further down to land on; the engine still catches anyone below -400 m.
   - **Instance isolation & cleanup**: Keep all meshes/state inside `mount(ctx)` (the engine mounts rooms in both `'active'` and `'preview'` modes). Dispose every geometry, material, texture, and helper in `ctx.onDispose(...)`.
   - **Player reactivity**: Read `ctx.player?.position` inside `ctx.onUpdate` (`null` while in preview mode). Use `ctx.onActivate` for active-only listeners/audio and return a cleanup function.
   - **Budgets** (enforced by `pnpm run check:rooms` and `pnpm run build`):
     - Max **12 MiB** per room folder and per room production bundle
     - Max **4 MiB** per single file
     - Max **2048 px** per edge for standalone PNG/KTX2 textures
     - GLB models must be uncompressed (no Draco, meshopt, or KTX2); credit third-party assets in `worlds/<room-id>/CREDITS.md`.
5. Keep `MAX_HOT_ROOMS` in `packages/core/src/engine/PortalPreviews.ts` in mind (currently `10`; rooms beyond that still work and transparently unload/remount as you travel).

## 4. Local Development & Tooling

- Package manager is pinned to **`pnpm@12.23.0`** (`packageManager` in `package.json`; use `corepack pnpm` if `pnpm` is not directly on `PATH`).
- `pnpm dev` runs the multiplayer server (`:3001`) and Vite WebGPU client (`:5173`, proxying `/ws` and `/api` to `:3001`).
- See [COLLAB.md](./COLLAB.md) for full room-authoring examples and T3 Code sharing setups.
