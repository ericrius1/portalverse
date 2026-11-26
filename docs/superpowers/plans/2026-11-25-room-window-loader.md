# Room Window Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep only a five-room window mounted around the player, loading rooms in the background, to cut startup time and memory.

**Architecture:** A pure function computes the window from the catalog order. `PortalPreviews` loads the two neighbours immediately, queues the outer rooms one at a time, and counts a room ready only after its shaders are compiled and its snapshots captured. Rooms outside the window are unpinned and fall to the existing 4 s eviction.

**Tech Stack:** TypeScript, Three.js 0.187 WebGPU, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-25-room-window-loader-design.md`

## Global Constraints

- Window radius is 2 over `kind: "local"` rooms in `registry.json` order, wrapping.
- The loading gate waits for the current room and its two neighbours only.
- A room outside the window is disposed after 4 s unseen.
- One background mount at a time, started in idle time, never on the crossing frame.
- Shaders compile against the `createSceneTarget` format before a room is ready.
- No changes under `worlds/` and no change to the room contract.
- `pnpm run build` and `pnpm test` pass after every task (`corepack pnpm` if `pnpm` is missing).
- Never commit `bun.lock`. Do not push.

## Review Focus

1. Stepping back and forth across one gate: no room is disposed and remounted within 4 s. (Task 3)
2. Menu jump while rooms are still queued: stale queued rooms are never mounted. (Task 3)
3. A room that fails to load: the queue continues and the room is retried later. (Task 3)
4. `clear()` while a room is still preparing: it is disposed and no snapshot target is created afterwards. (Task 2)
5. A loop smaller than the window: no duplicate or self entries. (Task 1)

---

### Task 1: Branch, baseline and window calculation

**Files:**
- Create: `packages/core/src/engine/roomWindow.ts`
- Test: `packages/core/src/__tests__/roomWindow.test.ts`

**Interfaces:**
- Produces:
  - `type Heading = 1 | -1` (1 = toward the next room in catalog order, i.e. through `exit`)
  - `const ROOM_WINDOW_RADIUS = 2`
  - `function roomWindow(order: readonly string[], center: string, heading?: Heading): Array<{ id: string; distance: number }>`, in load-priority order, excluding `center`; default heading `1`

- [ ] **Step 1: Create the branch.** From `feat/honey-hood-room` create `feat/room-window-loader`, then `git merge fix/portal-crossing-stutter`. Keep both `CHANGELOG.md` sections in the one expected conflict. (The merge is needed because that fix makes preview lighting match active lighting, so precompiled shaders stay valid.) Run build and test: both pass.

- [ ] **Step 2: Record the baseline** with the `run` skill, in a production build (`vite build`, server plus `preview`), before any source change. Save to the scratchpad: ms from navigation to the loading gate getting class `ready`; JS heap after the gate and after one full lap; Chrome GPU process memory at the same two points; frames over 33 ms during the lap in each direction. Keep the script so Task 4 repeats it unchanged. If WebGPU is unavailable to the automated browser, report that and ask the user to take the readings.

- [ ] **Step 3: Write the failing test**

```ts
const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const ids = (w: Array<{ id: string }>) => w.map(r => r.id);

it('takes two rooms each way, nearest first, heading side first', () => {
  expect(roomWindow(order, 'd')).toEqual([
    { id: 'e', distance: 1 }, { id: 'c', distance: 1 },
    { id: 'f', distance: 2 }, { id: 'b', distance: 2 },
  ]);
  expect(ids(roomWindow(order, 'd', -1))).toEqual(['c', 'e', 'b', 'f']);
});
it('wraps around the loop', () => {
  expect(ids(roomWindow(order, 'a'))).toEqual(['b', 'g', 'c', 'f']);
});
it('never repeats a room or includes the centre in a small loop', () => {
  expect(roomWindow(['a', 'b', 'c'], 'a')).toEqual([{ id: 'b', distance: 1 }, { id: 'c', distance: 1 }]);
  expect(roomWindow(['a'], 'a')).toEqual([]);
});
it('is empty for a room outside the loop', () => {
  expect(roomWindow(order, 'elsewhere')).toEqual([]);
});
```

- [ ] **Step 4:** `pnpm test roomWindow` fails (module missing).
- [ ] **Step 5:** Implement `roomWindow` as specified.
- [ ] **Step 6:** `pnpm test roomWindow` passes.
- [ ] **Step 7: Commit** the two files plus the spec and this plan: `feat: add room window calculation`.

---

### Task 2: Prepare each room as it loads

**Files:**
- Modify: `packages/core/src/engine/PortalPreviews.ts` (`destination`, `prewarmSnapshots`, `clear`, constructor)
- Modify: `packages/core/src/engine/WorldEngine.ts:259-283`, `app/main.ts:784-793`
- Test: `packages/core/src/__tests__/roomLoading.test.ts` (new); update `roomCrossing.test.ts`, `portalLighting.test.ts`

**Interfaces:**
- Produces:
  - `new PortalPreviews(renderer, load, options?: { order?: readonly string[]; idle?: () => Promise<void> })`. `order` defaults to the local ids in `registry.json`; `idle` defaults to `requestIdleCallback` with a 200 ms timeout, else `setTimeout(0)`
  - `refreshSnapshots(activeRoom: RoomInstance): Promise<void>` replaces `prewarmSnapshots`: apply snapshot materials to the active and all mounted rooms, then recapture both ends of each
  - `WorldEngine.warmUpPortals(): Promise<void>` replaces `prewarmPortalSnapshots`: `refreshSnapshots`, then the existing ripple warm-up and one render

- [ ] **Step 1: Write the failing tests** in `roomLoading.test.ts`. Use a fake renderer like `roomCrossing.test.ts`, plus `compileAsync: vi.fn(async () => {})`; `idle: () => Promise.resolve()`.
  - `compiles a room against a scene target before it is ready`: inside `compileAsync`, record `getRenderTarget()` and the scene; assert `takeReady` is `undefined` while that promise is unresolved, the target's `texture.type` is `THREE.HalfFloatType` with `samples === 0`, and the previous render target is restored before the promise resolves.
  - `compiles objects outside the camera view, then restores culling`: a room with one mesh; `frustumCulled` is `false` during the `compileAsync` call and `true` after ready.
  - `captures both snapshots on load`: after `await prepare('jp-world')`, two renders of its scene, and an already mounted room's portal to `jp-world` has a new aperture material after `refreshSnapshots` has registered it as active.
  - `still delivers the room when compiling fails`: `compileAsync` rejects; `prepare` resolves with the room.
  - `disposes a room cleared mid-preparation and captures nothing after clear`: hold `compileAsync` open, call `clear()`, release; room `onDispose` ran once and no render happened after `clear()`.
- [ ] **Step 2:** `pnpm test roomLoading` fails.
- [ ] **Step 3: Implement.** `ready` becomes mount, `idle()`, compile, `idle()`, capture `entrance`, `idle()`, capture `exit`, then apply snapshot materials to the active and mounted rooms. Compile errors and capture errors warn and continue. A generation counter bumped by `clear()` skips remaining steps. For compile: set `frustumCulled = false` on the scene's objects, set a reused 1×1 `createSceneTarget`, call `renderer.compileAsync(room.scene, camera)`, restore the previous target immediately after the call (three snapshots state synchronously), await, then restore culling.
- [ ] **Step 4:** Update the engine and `app/main.ts`. Drop the avatar-hiding wrapper only if the capture on load cannot see the avatar; `refreshSnapshots` runs after the avatar is in the room, so keep it there. Gate label stays `RENDERING PORTAL PREVIEWS` at 68, then 100.
- [ ] **Step 5:** In existing tests replace `prewarmSnapshots(ids, active)` with `await prepare(id)` for each non-active id followed by `refreshSnapshots(active)`; add `compileAsync` to the fake renderers.
- [ ] **Step 6:** Build and full tests pass.
- [ ] **Step 7: Commit** `feat: compile and snapshot rooms as they load`.

---

### Task 3: Window pinning and background queue

**Files:**
- Modify: `packages/core/src/engine/PortalPreviews.ts` (`MAX_HOT_ROOMS`, `syncPinnedForRoom`, `render`, `renderFarPortal`)
- Modify: `packages/core/src/engine/WorldEngine.ts` (`mountWorld`, `installRoom`, `promotePortalSync`)
- Test: `packages/core/src/__tests__/roomLoading.test.ts`

**Interfaces:**
- Consumes: `roomWindow`, `Heading` (Task 1); constructor options (Task 2)
- Produces:
  - `syncPinnedForRoom(room: RoomInstance, heading?: Heading): Promise<void>`, resolving when the distance-1 rooms are ready
  - `keeps(centerId: string, id: string): boolean` (id is in the window around centerId)

Behaviour of `syncPinnedForRoom`: remember the active room; `prepare` distance-1 rooms and any non-remote `entrance`/`exit` target at once; replace the queue with the unmounted distance-2 ids in window order; pin exactly the window; for each room that becomes unpinned set `lastSeen` to the last render time so the 4 s starts now. A single pump takes one queued id at a time after `idle()` and awaits it. `render` and `renderFarPortal` request rooms through a path that returns nothing for a still-queued id and otherwise behaves like `destination`. Remove the eager adjacent preload at the top of `render`, and `MAX_HOT_ROOMS`. `clear()` empties the queue.

- [ ] **Step 1: Write the failing tests** with `order` = seven ids `a`–`g` and a loader that records calls. Rooms outside the catalog get no route gates, so these assert on loads and disposals.
  - `loads neighbours at once and the outer rooms one at a time`: centre `d`; after the returned promise `c` and `e` are loaded; `f` then `b` load in that order, `b` not before `f` is ready.
  - `queues the side you are heading toward first`: heading `-1` loads `b` before `f`.
  - `drops a room 4 s after it leaves the window`: sync `d`, then `e`; render at elapsed 3 s: `b` not disposed; at 5 s: disposed once.
  - `keeps rooms when you step back within 4 s`: `d`, `e`, `d`; render at 10 s: `b` load count is 1 and never disposed.
  - `never mounts rooms left in the queue by a jump`: hold `f` open, then sync `a`; `b` is not queued for `d`'s window any more and every later load is in `a`'s window.
  - `carries on past a room that fails to load`: loader rejects `f` once; `b` still loads; a later sync after 5000 ms (fake timers) loads `f` again.
  - `keeps` returns true for `('d', 'b')`, false for `('d', 'a')`.
- [ ] **Step 2:** `pnpm test roomLoading` fails.
- [ ] **Step 3:** Implement in `PortalPreviews`.
- [ ] **Step 4:** In `WorldEngine`, pass `heading` to `installRoom` (`-1` when the portal crossed or entered is the route gate `entrance`, else `1`) from `promotePortalSync` and from `mountWorld`'s `fromPortal`. Retain the previous room when `previews.keeps(newId, prevId)` or the new room links back to it.
- [ ] **Step 5:** Build and full tests pass, including the existing crossing and lighting tests.
- [ ] **Step 6: Commit** `feat: keep a five-room window loaded around the player`.

---

### Task 4: Verify in the browser and document

**Files:**
- Modify: `AGENTS.md` (section 3, item 5), `CHANGELOG.md`, `COLLAB.md` if it mentions `MAX_HOT_ROOMS`

- [ ] **Step 1:** Repeat the Task 1 measurement unchanged. Also walk a lap each way, use the Rooms menu to jump across the loop, and cross back and forth at one gate; no console errors, no missing rooms. For every frame over 33 ms, record which room was loading.
- [ ] **Step 2:** Replace the `MAX_HOT_ROOMS` note with the window rule. Add a `CHANGELOG.md` entry (Changed / Why / tradeoffs: first-visit placeholders, dropped rooms reset, any room that still hitches) with the measured before and after numbers.
- [ ] **Step 3:** Build and full tests pass.
- [ ] **Step 4: Commit** `docs: record the room window loader`. Report the numbers, including any that got worse.
