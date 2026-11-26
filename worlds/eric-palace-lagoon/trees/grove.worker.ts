/// <reference lib="webworker" />
/**
 * Off the main thread: every kind of the grove grown (grow.ts: ~50 ms of curves, tubes and cards), handed back
 * without a copy.
 */
import { growAll } from './grow';

self.onmessage = () => {
  try {
    const grown = growAll();
    const transfer = grown.flatMap(g => [g.cards.buffer, g.bark.buffer, g.lanterns.buffer]);
    (self as unknown as Worker).postMessage({ grown }, transfer as ArrayBuffer[]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: String(error) });
  }
};
