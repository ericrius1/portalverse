/**
 * Room loading runs on the same thread that draws every frame. A room that does
 * its setup in one long go stalls the room the player is walking through. Call
 * `breathe()` between steps and inside long loops: once the current stretch of
 * work has run for `BREATHE_SLICE_MS`, it pauses so the browser can draw, then
 * carries on. Until then it returns straight away, so calling it often is cheap.
 */

/** How long to work before pausing: well under a 16 ms frame, leaving the engine room to draw. */
export const BREATHE_SLICE_MS = 6;

let sliceStart = now();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

type YieldingScheduler = { yield?: () => Promise<void> };

/** Give the event loop a turn, so a frame can be drawn if one is due. */
function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: YieldingScheduler }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function breathe(): Promise<void> {
  if (now() - sliceStart < BREATHE_SLICE_MS) return;
  await yieldToBrowser();
  sliceStart = now();
}
