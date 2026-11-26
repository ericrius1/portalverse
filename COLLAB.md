# Contributor Guide

Portalverse is an open-source, community-built portal metaverse. Each contributor builds their own rooms in their own folders, so many people, and their AI agents (such as **Claude Opus 5.5** and **Gemini 4 Neon**), can build at once without merge conflicts.

## 1. File Ownership (No Merge Hell)

- **Your rooms**: build freely in your own room folders under `worlds/`. Each room's `owner` in `registry.json` says whose it is; ask the owner before changing someone else's room. Starting folder names with your handle (as in `worlds/eric-world/` and `worlds/jp-abyss/`) makes them easy to tell apart.
- **Shared code (`packages/core/`, `packages/server/`, `app/`, `registry.json`)**: change it through short, tested pull requests, or in a shared T3 Code session.
- **Without write access?** Fork the repo and open a pull request; a maintainer reviews and merges it.

### Building your room

Open `/?world=<your-room>` while editing `worlds/<your-room>/index.ts`. To see your room through a portal, open a second tab at the room before yours in the loop (for `jp-world` that's `/?world=eric-world`) and look down the room at its exit. Move sideways to check the perspective, then walk through the opening to enter.

Each room exports `defineRoom(id, { mount(ctx) })`. The engine calls the same builder for a visit and for a view through a local portal. Keep mutable scene objects inside `mount` so each instance can animate and unload independently.

```ts
import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';

export default defineRoom('jp-world', {
  mount(ctx) {
    const geometry = new THREE.IcosahedronGeometry(1);
    const material = new THREE.MeshBasicMaterial({ color: '#ffbf47' });
    const sculpture = new THREE.Mesh(geometry, material);
    sculpture.position.y = 1.65;
    ctx.scene.add(sculpture);
    ctx.onUpdate((dt) => { sculpture.rotation.y += dt; });
    ctx.onDispose(() => {
      geometry.dispose();
      material.dispose();
    });

  },
});
```

The engine gives every local room a framed entrance and exit on the Z axis. Keep a walkable path from one to the other: it must be level at Y = 0 where it passes through each portal, and may wind, rise and fall in between. The entrance stands at Z = +36.25 and the exit at Z = −36.25. Shift+W covers the 72.5 metres in five seconds. Local rooms follow their order in `registry.json`, with the last connected back to the first. Adding a room inserts its two connections automatically.

- Add `worlds/<id>/index.ts` and a local entry with a default spawn in `registry.json`. The room directory and route discover it automatically. Use `[0, 0, 35.75]` and yaw zero to start just inside the entrance.
- Put scenery and animation in `mount`. Use `ctx.onDispose` for cleanup. Keep permanent scene objects instance-local.
- Read `ctx.player` in `onUpdate` to react to the player: it holds their feet position while your room is active and is `null` while it's a preview. The garden bends plants away from it and the loft's shiba follows it.
- Use `ctx.onActivate` for player-only behavior such as input listeners or audio, and return a function that stops it. The engine keeps the room a player just left mounted as a preview so turning back is instant, so a room can activate and deactivate many times. `ctx.mode` reports `'active'` or `'preview'`.
- Rooms have a floor everywhere by default. To let players fall, call `ctx.allowFalling({ respawnBelow })` and return `NO_GROUND` (from `@portalverse/core/rooms/kit`) from `ctx.setTerrainHeight` where there's nothing underfoot. Below `respawnBelow` the screen dims and offers a Respawn button that returns the player to where they entered the room. Leave `respawnBelow` out if your room has ground further down to land on and walk around. The abyss room uses this.
- Use the manifest’s `portals` array for up to five optional links. Each takes an ID, label, position, and target world. Use the target spawn `entrance` or `exit` to meet its main route, or name a spawn in the target manifest.
- For custom portal art, reserve slots with `customPortalSlots` in the manifest, then use `ctx.addPortal` or `ctx.registerCustomPortal` during mount. Unreserved slots are available to player-placed portals, including offline play.
- Every local preview uses the destination scene and a common up direction, rendered at screen resolution. Crossing a main frame preserves the player’s position relative to the threshold and viewing direction. Up to four visible windows render live, along with the route gate at the far end of each room they show; portals beyond those show snapshots. Remote links use URL handoffs.

### Loading: about 10 seconds, in small pieces

Only five rooms are loaded at a time: the player's room and two each way (`packages/core/src/engine/roomWindow.ts`). A room starts loading when the player is two rooms away from it, so it has two rooms of travel (72.5 m each) to get ready:

| Player | Speed | Time to get ready |
|---|---|---|
| Walking | 8.2 m/s | about 18 s |
| Sprinting | 14.5 m/s | about 10 s |
| Boosting in flight | 31 m/s | about 5 s |

After `mount` returns, the engine still compiles the room's shaders and takes its portal snapshots, so aim to finish setup well inside 5 seconds. Rooms near the starting room load behind the loading screen, and a jump from the Rooms menu shows the warp screen until its room is ready.

That's plenty of time, but it's all on one thread: the JavaScript thread that also draws every frame of the room the player is in. A single 50 ms stretch of setup drops three frames there, however early it starts. So spend the time in small pieces:

- **`await ctx.breathe()`** between steps of `mount` and inside long loops.
  - Once the current stretch of work has run for 6 ms, it pauses so the browser can draw, then carries on. Otherwise it returns straight away, so it's cheap to call often.
  - Code outside `mount`, such as module-level builders, can import the same `breathe` from `@portalverse/core/rooms/kit`.
  - Aim for no stretch over about 8 ms, half a frame. A helper that loops over many items can take a `pause` callback and call it every few dozen items, as `buildStoneGeometry` in `worlds/jp-abyss/geometry.ts` does.
- **Build once, share across mounts.**
  - A room that leaves the window is disposed and mounted fresh when it comes back, often several times a session. Anything that's always the same can be built once at module level and reused: a seeded layout, a generated texture, vertex arrays.
  - Give each mount its own `BufferGeometry` around the shared arrays, so it uploads and disposes its own GPU copy.
  - `abyssLayout()` in `worlds/jp-abyss/index.ts` does this. The first load is spread over about 100 ms with no stretch over 14 ms, and every later mount takes about 2 ms.
- **Web Workers for heavy pure maths.**
  - Noise, procedural terrain, path layouts and geometry arrays can be built entirely off the main thread. Create the worker with `new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' })`.
  - Send the typed arrays back with `postMessage(result, [result.buffer])` so they move between threads without being copied.
  - A worker can't touch the scene, three.js objects or the GPU, so make meshes and materials on the main thread from what it sends back.
- **Already off the main thread**: shader compilation (the loader uses three.js's `compileAsync`, which builds WebGPU pipelines asynchronously) and image decoding.

To check a room, time its `mount`. Also record a trace in the browser's Performance panel while walking toward the room and look for long tasks.

### Your room's music

The soundtrack is a live mix of shared stems (Suno Studio loops, all 88 BPM in D minor, so any of them play together). Pick your room's blend in `ROOM_VIBES` in `packages/core/src/audio/musicMix.ts`: stem ids with levels from 0 to 1. Rooms that aren't listed get `DEFAULT_VIBE`. Near a gate you hear a faint hint of the next room; stepping through crossfades to its blend.

### Room budgets

Keep room assets under `worlds/<id>/` and import them through Vite (for example, `import mural from './mural.png?url'`, or `import.meta.glob('./assets/*.glb', { query: '?url', import: 'default', eager: true })` for a folder). `@portalverse/core/rooms/kit` has `loadGLB`, `groundModel`, `disposeObject` and `seededRandom` for rooms that load models, plus `breathe` for spreading slow setup and `NO_GROUND` for rooms that allow falling; models must be uncompressed (no Draco, meshopt or KTX2). Note where third-party assets came from in a `CREDITS.md` in the room folder. Run `npm run check:rooms` while authoring and `npm run build` before submitting.

| Check | Starting limit |
| --- | --- |
| Room folder, including source and assets | 12 MiB |
| Room-specific production bundle and imported dependencies, beyond shared startup | 12 MiB uncompressed |
| Any single file in either check | 4 MiB |
| Standalone PNG and KTX2 images in the room folder | 2048 pixels per edge |

The shared limits live in `scripts/room-budgets.json`. The Room checks workflow runs the production build and tests on pull requests. Repository maintainers can require its `validate` job before merge.

The byte totals cover local files and bundled imports. Runtime downloads, textures embedded in models, procedural geometry, and GPU frame time need separate controls. For public submissions, review code and package contributed assets locally. A future automated performance check can mount a room and its neighbor on a fixed test device and measure frame time and GPU resource usage during a crossing.

## 2. Sharing a T3 Code Agent Space

Pick the workflow that fits your session:

1. **Live Pair Session (Fastest — Guest Links)**
   - Host enables **T3 Connect** and **Settings → Labs → Guest links**.
   - Right-click the active thread → **Share with guest** and send the URL.
   - Guest watches the agent stream live and submits prompts (host approves requests).
2. **True Shared Agent Room (Shared Dev Box / VPS)**
   - Run T3 Code on a shared cloud VM (`npx t3 serve` + `npx t3 pair`, or T3 Connect + **Settings → Sharing & access → Authorized clients**).
   - Everyone connects their T3 Code clients to that environment and works in isolated git worktrees side by side.
3. **Linked Local Machines (Peer Agent Delegation)**
   - Each person enables **Settings → Labs → Linked environments**.
   - Exchange a pairing link under **Settings → Sharing & access → Authorized clients → Create link**.
   - Your agents can inspect each other's threads and delegate tasks across machines.

## 3. Running Claude Opus 5.5 + Gemini 4 Neon Together

- **Split by strength in worktrees:**
  - **Claude Opus 5.5**: multiplayer protocol, server state (`packages/server/`), physics/collision, portal handoffs (`packages/core/src/portal/`), and tests.
  - **Gemini 4 Neon**: Three.js WebGPU + TSL shaders (`packages/core/src/shaders/`), 3D world design (`worlds/`), animations, and HUD (`app/`).
- **Cross-model review:** Before merging a PR into `main`, delegate a quick review to the opposite model.

## 4. Playing Together & Auto-Deploying (Railway)

Portalverse runs full-stack (Vite WebGPU frontend + authoritative `/ws` multiplayer server on one origin) on **Railway** and **auto-deploys whenever a maintainer pushes or merges to `main`**:

- **Live Main URL:** `https://portalverse-server-production.up.railway.app`
- **Health / Presence API:** `https://portalverse-server-production.up.railway.app/api/health`
- **Share a room:** `https://portalverse-server-production.up.railway.app/?world=eric-world`
- **Share any room, arriving at its far end:** `https://portalverse-server-production.up.railway.app/?world=fishpond&spawn=exit`

To deploy changes, a maintainer runs `pnpm run build && pnpm test`, merges cleanly into `main`, and runs `git push origin main`. Railway automatically rebuilds and redeploys within ~1 minute (no Railway CLI login or Vercel account required). See [AGENTS.md](./AGENTS.md) for the full agent checklist.

The Rooms menu (`M`) copies a link to every room.

You can also run **two completely separate servers** and connect them via **+ Link Portal (`P`) → Remote Federated URL**. Walking through the portal carries your explorer name and aura color to your friend's server, where you arrive with a return portal right behind you: turn around and walk back through it to go home.
