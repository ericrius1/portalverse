import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import { BREATHE_SLICE_MS, breathe } from '../engine/breathe';
import { RoomInstance } from '../engine/RoomInstance';
import { defineRoom } from '../portal/defineRoom';
import { breathe as kitBreathe } from '../rooms/kit';

/** Keep the thread busy, as a long stretch of room setup would. */
const work = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* busy */ }
};

/** Queue some other work (standing in for the browser drawing a frame) and report whether it got to run. */
const queueOtherWork = () => {
  let ran = false;
  setTimeout(() => { ran = true; }, 0);
  return () => ran;
};

describe('breathe', () => {
  it('pauses so other work can run once a stretch of setup has used its slice', async () => {
    work(BREATHE_SLICE_MS + 2);
    const otherWorkRan = queueOtherWork();
    await breathe();
    expect(otherWorkRan()).toBe(true);
  });

  it('returns straight away while the slice still has time, so calling it often is cheap', async () => {
    work(BREATHE_SLICE_MS + 2);
    await breathe();
    const otherWorkRan = queueOtherWork();
    await breathe();
    expect(otherWorkRan()).toBe(false);
  });

  it('is the same helper on the room context and in the room kit', async () => {
    let fromContext: unknown;
    await RoomInstance.mount(
      defineRoom('eric-world', { mount: ctx => { fromContext = ctx.breathe; } }),
      {} as THREE.WebGPURenderer,
    );
    expect(fromContext).toBe(breathe);
    expect(kitBreathe).toBe(breathe);
  });
});
