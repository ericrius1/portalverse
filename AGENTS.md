# Portalverse — Agent & Collaboration Guide

Portalverse is an open-source, community-built **Three.js WebGPU + TSL** portal metaverse. **Anyone** — no collaborator invite needed — can clone the repo, build rooms, or improve shared code with their coding agent and ship it live via `pnpm submit`. Pull requests targeting `main` are **automatically validated, merged into `main`, and deployed live to Railway** once CI passes.

## 1. Push & Auto-Deploy (Live Production)

Everything—both the Vite WebGPU frontend (`dist/`) and the authoritative multiplayer WebSocket server (`/ws`, `/api/health`, `/api/worlds`)—is hosted together on **Railway** and **auto-deploys from `origin/main`**. There is **no Vercel** deployment.

- **Live URL:** https://portalverse-server-production.up.railway.app
- **Health / Presence API:** https://portalverse-server-production.up.railway.app/api/health
- **Multiplayer WebSocket:** `wss://portalverse-server-production.up.railway.app/ws` (same-origin, no env vars needed)

### Always Keep `CHANGELOG.md` Updated (Shared Context for Contributors & Agents)
- **At the start of feature work**, skim the top of [CHANGELOG.md](./CHANGELOG.md) so you know what other contributors recently changed and *why*.
- **For every feature or notable change**, update [CHANGELOG.md](./CHANGELOG.md) (newest first) *before pushing* with:
  - **What changed** (`Added` / `Changed` / `Fixed` / `Removed`)
  - **Why it changed** (`Design & engineering decisions` — capture the prompting intent, problem solved, and tradeoffs so contributors and future agents stay aligned).

### When ANY contributor or maintainer asks to "push", "submit", or "deploy":

**Important for coding agents:** Do **NOT** stop or fail if `git push origin main` returns `403` / permission denied or if the user does not have a GitHub fork yet! Anyone can submit a new world seamlessly via automatic **Fork → Feature Branch → Pull Request**.

First, always complete steps 1–2 locally:
1. Make sure [CHANGELOG.md](./CHANGELOG.md) reflects the feature(s) and the *why* behind them.
2. Verify locally first:
   ```bash
   pnpm run build   # runs check:rooms && tsc --noEmit && vite build
   pnpm test        # runs full Vitest suite
   ```
3. Commit all changes cleanly, then check whether the current GitHub user has direct push access to `ericrius1/portalverse`:
   ```bash
   gh api repos/ericrius1/portalverse --jq '.permissions.push'
   ```

#### Path A — Anyone without direct push access (fully automated Fork → PR → Auto-Merge → Live Deploy):
Never push directly to `ericrius1/portalverse` `main`, and **never ask the user to manually create a fork or wait for a maintainer to add them as a collaborator**. Run the built-in helper (works even if the user cloned `ericrius1/portalverse` directly with no fork yet and committed on `main`):

```bash
pnpm submit        # forks if needed, checks for conflicts, pushes branch, opens PR
pnpm submit --wait # same, and waits until CI auto-merges into main & triggers deploy
```

`pnpm submit` (`scripts/submit-world.mjs`) automatically:
1. Fetches latest `main` and checks for merge conflicts before pushing (if `main` moved ahead, rebase with `git rebase upstream/main`, re-run `pnpm run build && pnpm test`, and re-run `pnpm submit`).
2. Moves commits off `main` onto a feature branch (`<github-handle>/<room-id>`), keeping local `main` clean.
3. Creates (or reuses) the user's GitHub fork (`<github-handle>/portalverse`) non-interactively via `gh repo fork ericrius1/portalverse --clone=false --remote=false --default-branch-only`.
4. Adds/updates the `fork` git remote and pushes the feature branch (`--force-with-lease` on personal forks so post-rebase resubmits work seamlessly).
5. Opens (or updates) a Pull Request against `ericrius1/portalverse` `main` and prints the clickable PR URL.

*(If running the steps manually instead of `pnpm submit`:)*
```bash
HANDLE=$(gh api user --jq .login)
git checkout -b "${HANDLE}/<room-id>"                    # if commits are currently on main
gh repo fork ericrius1/portalverse --clone=false --remote=false --default-branch-only
git remote add fork "https://github.com/${HANDLE}/portalverse.git" 2>/dev/null || git remote set-url fork "https://github.com/${HANDLE}/portalverse.git"
git push --force-with-lease -u fork HEAD
gh pr create --repo ericrius1/portalverse --base main --head "${HANDLE}:$(git rev-parse --abbrev-ref HEAD)" --fill
```

Only ask the user for action if `gh` is not installed or `gh auth status` is logged out (in which case tell them to run `gh auth login` once, then re-run `pnpm submit`).

**What happens after the PR opens (`.github/workflows/pr-automerge.yml`):**
- GitHub Actions runs immediately — **even for first-time contributors** (no manual maintainer workflow approval needed!).
- It validates the PR in an isolated read-only job (`pnpm install --frozen-lockfile && pnpm run build && pnpm test`).
- As soon as checks pass, GitHub Actions **automatically merges the PR into `main` and deploys it live to Railway** (~1–2 minutes).
- **Opt-outs & safety guardrails:**
  - Open a **Draft PR** (`pnpm submit --draft`) or add a `hold` / `do-not-merge` / `wip` label to pause auto-merge.
  - PRs touching `.github/` (CI/workflows/deploy scripts) are protected and require manual maintainer merge.
  - If validation fails or another PR caused a merge conflict, the bot posts a status comment with exact fix/sync steps; pushing a fix automatically re-runs and merges.

#### Path B — Maintainer (`permissions.push` is `true`):
1. Sync cleanly with `origin/main` (never force-push `main`):
   ```bash
   git fetch origin
   git checkout main
   git pull --rebase origin main
   ```
   *(If working on a feature branch like `<handle>/<topic>`, merge it cleanly into `main`, re-run `pnpm run build && pnpm test`, then push.)*
2. Push to `main`:
   ```bash
   git push origin main
   ```
3. **Auto-deploy happens automatically via GitHub Actions → Railway** once the `validate` job passes on `main` (typically ~1–2 minutes; works for any maintainer or merged PR author with no Railway CLI login or manual approval needed).
4. Verify the live redeploy before finishing:
   - Check `GET https://portalverse-server-production.up.railway.app/api/health` returns `200 OK` with `"ok": true` and includes any newly added room IDs in `worlds`.
   - Check `GET https://portalverse-server-production.up.railway.app/` returns `200 OK`.

## 2. File Ownership & Branch Conventions

- **Rooms**: each contributor builds freely in their own room folders under `worlds/`. A room's `owner` in `registry.json` says whose it is; don't change someone else's room without their OK. Folder names often start with the owner's handle (`worlds/eric-*/`, `worlds/jp-*/`).
- **Branches**: `<handle>/<topic>` (for example `jp/abyss-room`). Contributors without write access work in a fork and open a pull request.
- **Shared code** (`packages/core/`, `packages/server/`, `app/`, `registry.json`): keep changes small, well-tested, and synced cleanly with `origin/main`.
- **Shared T3 Code threads**: prefix thread titles with your name in brackets (for example **`[JP]`**) or **`[Shared]`**, so everyone can tell whose thread is whose.

## 3. Adding or Editing a Room

1. Create `worlds/<room-id>/index.ts` exporting `defineRoom('<room-id>', { mount(ctx) { ... } })`.
2. Add a matching `"kind": "local"` entry to `registry.json` (catalog order defines the circular portal promenade loop — core tests validate `registry.json` dynamically, so you do **not** need to edit core test files just to add a room).
3. Follow the room contract:
   - **Portal alignment**: Engine places `entrance` at `Z = +36.25` and `exit` at `Z = -36.25`, both at `X = 0`. There must be a walkable path from portal to portal, level at `Y = 0` where it passes through each portal. Between the portals it may wind, rise and fall, as long as nothing blocks it. Make it walkable with `ctx.addPlatform(...)` and/or `ctx.setTerrainHeight(...)`.
   - **Falling (opt-in)**: Rooms have a floor everywhere unless they call `ctx.allowFalling(...)`. A room that allows falling returns `NO_GROUND` (from `@portalverse/core/rooms/kit`) from its terrain height where there's nothing to stand on. With `respawnBelow`, falling past that height dims the screen and offers a Respawn button, which puts the player back where they entered the room. Leave it out if the room has its own ground further down to land on; the engine still catches anyone below -400 m.
   - **Instance isolation & cleanup**: Keep all meshes/state inside `mount(ctx)` (the engine mounts rooms in both `'active'` and `'preview'` modes). Dispose every geometry, material, texture, and helper in `ctx.onDispose(...)`.
   - **Walls and big rooms**: `ctx.setCollider({ move(from, to, radius, height) })` pushes each step out of anything solid so players slide along it (walls, columns, trunks). Players stay within 95 m of the room's middle unless the room calls `ctx.setWalkBounds(...)`.
   - **Not just Three.js**: a room can draw with any WebGPU code on the shared device (`ctx.gpu`, `ctx.addGpuLayer`; weft rooms use `WeftLayer` from `@portalverse/core/rooms/weft`). The engine composites it with depth under the room's Three.js scene. See [Rooms drawn with your own WebGPU code](./COLLAB.md#rooms-drawn-with-your-own-webgpu-code); `worlds/eric-palace-lagoon` is the example.
   - **Player reactivity**: Read `ctx.player?.position` inside `ctx.onUpdate` (`null` while in preview mode). Use `ctx.onActivate` for active-only listeners/audio and return a cleanup function.
   - **Budgets** (enforced by `pnpm run check:rooms` and `pnpm run build`):
     - Max **12 MiB** per room folder and per room production bundle
     - Max **4 MiB** per single file
     - Max **2048 px** per edge for standalone PNG/KTX2 textures
     - GLB models must be uncompressed (no Draco, meshopt, or KTX2); credit third-party assets in `worlds/<room-id>/CREDITS.md`.
5. Only a window of rooms stays mounted: the player's room plus `ROOM_WINDOW_RADIUS` (currently `2`) each way in the loop (`packages/core/src/engine/roomWindow.ts`). A room left outside it is disposed after a few seconds unseen and mounted fresh on return, so keep nothing that must survive a visit.
6. **Loading budget: about 10 seconds, in small pieces.** A room starts loading when the player is two rooms away, so it has two rooms of travel to get ready: about 10 s at a sprint, but only about 5 s for someone boosting in flight. Shader compiling and portal snapshots come after `mount`, so finish setup well inside that.
   - *The catch*: `mount` runs on the same thread that draws the room the player is in. Any single stretch of work longer than about 8 ms stutters their frame, however early it starts.
   - *The fix*:
     - `await ctx.breathe()` between steps and inside long loops. It pauses only after 6 ms of work, so calling it often is cheap. Code outside `mount` can use `breathe` from `@portalverse/core/rooms/kit`.
     - Build fixed data (seeded layouts, generated textures, vertex arrays) once at module level and share it across mounts.
     - Move heavy pure maths to a Web Worker.
   - See [Loading: about 10 seconds, in small pieces](./COLLAB.md#loading-about-10-seconds-in-small-pieces) for the details. `worlds/jp-abyss` is the worked example.

## 4. Local Development & Tooling

- Package manager is pinned to **`pnpm@12.23.0`** (`packageManager` in `package.json`; use `corepack pnpm` if `pnpm` is not directly on `PATH`).
- `pnpm dev` runs the multiplayer server (`:3001`) and Vite WebGPU client (`:5173`, proxying `/ws` and `/api` to `:3001`).
- See [COLLAB.md](./COLLAB.md) for full room-authoring examples and T3 Code sharing setups.
