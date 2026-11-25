# Co-Working Guide — Eric (`ericrius1`) & JP (`jpwhitaker`) in T3 Code

This repo is structured so you both—plus **Claude Opus 5.5** and **Gemini 4 Neon**—can build simultaneously with zero merge conflicts.

## 1. File Ownership (No Merge Hell)

- **Eric builds freely in:** `worlds/eric-world/` (plus any new `worlds/eric-*/` worlds)
- **JP builds freely in:** `worlds/jp-world/` (plus any new `worlds/jp-*/` worlds)
- **Shared Hub & SDK (`worlds/hub/`, `packages/core/`, `packages/server/`, `registry.json`):** Update via short PRs or in a shared T3 Code session.

### Building your room

Open `/?world=jp-world` while editing `worlds/jp-world/index.ts`. Eric can do the same in `worlds/eric-world/index.ts`. Open a second tab at `/?world=hub&hubStyle=nexus` to see both rooms through their arches. Move sideways to check the perspective, then click the opening to enter.

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

The engine gives every local room a framed entrance and exit on the Z axis. Leave the central path clear and level at Y = 0. The entrance stands at Z = +36.25 and the exit at Z = −36.25. Shift+W covers the 72.5 metres in five seconds. Local rooms follow their order in `registry.json`, with the last connected back to the first. Adding a room inserts its two connections automatically.

- Add `worlds/<id>/index.ts` and a local entry with a default spawn in `registry.json`. The room directory and route discover it automatically. Use `[0, 0, 35.75]` and yaw zero to start just inside the entrance.
- Put scenery and animation in `mount`. Use `ctx.onActivate` to start player-only behavior when a preloaded scene becomes active. Use `ctx.onDispose` for cleanup. Keep permanent scene objects instance-local.
- Use the manifest’s `portals` array for up to five optional links. Each takes an ID, label, position, and target world. Use the target spawn `entrance` or `exit` to meet its main route, or name a spawn in the target manifest.
- For custom portal art, reserve slots with `customPortalSlots` in the manifest, then use `ctx.addPortal` or `ctx.registerCustomPortal` during mount. The hub reserves three slots across its visual styles. Unreserved slots are available to player-placed portals, including offline play.
- Every local preview uses the destination scene and a common up direction. Crossing a main frame preserves the player’s position relative to the threshold and viewing direction. Up to four visible windows render one level deep. Remote links use URL handoffs.

### Room budgets

Keep room assets under `worlds/<id>/` and import them through Vite (for example, `import mural from './mural.png?url'`). Run `npm run check:rooms` while authoring and `npm run build` before submitting.

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
