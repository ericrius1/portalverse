# Room window loader — design

## Intent

Improve efficiency: faster startup and less memory. Today every local room is mounted
during the loading gate. With 10 rooms (`main`) all stay mounted; with 11 they are all
mounted once and most are then disposed.

## Goals

- Keep a window of five rooms around the player: current, plus two each way in the loop.
- Each crossing loads one room ahead and drops the one left furthest behind.
- Background loading causes no noticeable stutter.
- Startup time and memory drop, measured before and after.

**Non-goals:** pre-made snapshot images, preserving a dropped room's state, moving room
building off the main thread, changing any room or the room contract.

**Failure:** crossings that stall or hitch more than today, even if startup is faster.

## Approaches (how portals show rooms that are not loaded)

1. **Snapshot on arrival (chosen).** Photograph a room when it first loads and keep the
   picture. Least work, no upkeep. Distant portals show the swirl placeholder until visited.
2. Pre-made snapshot images. No placeholders, but needs a capture script and goes stale.
3. Background tour of all rooms. Placeholders vanish sooner, but still does the work for
   every room and adds chances to stutter.

## Behaviour

- **Window:** radius 2 over the local rooms in `registry.json` order, wrapping around.
- **Startup:** the gate waits for the current room and its two neighbours, including their
  snapshots. The two outer rooms are queued as soon as those are done.
- **Crossing:** the window re-centres. Missing rooms are queued, the side you are heading
  toward first. Direction comes from the crossing, not from velocity.
- **Dropping:** a room outside the window is unpinned and disposed after 4 s unseen (the
  existing rule), so stepping back and forth does not reload it. More than five rooms can
  be mounted briefly.
- **Jumps** (Rooms menu, joining a friend): load the destination first, then re-centre.
- **Portals outside the loop** (side or custom portals): load on demand while visible, as
  today, then drop.
- **Not ready in time:** unchanged. The portal shows its snapshot or placeholder, and
  entering waits for the mount.

## Avoiding stutter

- One background mount at a time, started in idle time (timer fallback), never on the
  crossing frame.
- Before a room counts as ready: compile its shaders with `renderer.compileAsync` against
  the shared scene render-target format, then capture its snapshots on a later frame.
- The far portal in a previewed room must not bypass the queue by loading its room itself.
- `mount()` is synchronous for the heavy part of some rooms and cannot be split from
  outside. Measure each room's longest frame; report any that still hitches.

## Snapshots

- Captured on every load (a reload refreshes the picture) and kept until the engine is cleared.
- New snapshots are applied to portals in rooms already mounted.
- At startup keep the two passes, so nearby pictures show real rooms in their portals.
  Later arrivals are captured once; a portal inside one may show the placeholder.

## Scope

- `packages/core/src/engine/PortalPreviews.ts`: window pinning, load queue, snapshot on
  load. Replaces `MAX_HOT_ROOMS` and the all-rooms prewarm.
- `packages/core/src/engine/WorldEngine.ts`, `app/main.ts`: startup sequence and gate text.
- Tests in `packages/core/src/__tests__/`: window membership and wrap-around, load order,
  eviction, jumps, a mount that finishes after its room left the window, snapshot retention.
- `AGENTS.md` (the `MAX_HOT_ROOMS` note) and `CHANGELOG.md`.

## Verification

`pnpm run build` and `pnpm test`; in the browser, record startup time, renderer memory and
longest frames before and after, and walk a full lap in both directions.

## Left to the builder

Queue structure, where the window calculation lives, and idle-scheduling details.
