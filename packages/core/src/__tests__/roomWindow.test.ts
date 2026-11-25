import { describe, expect, it } from 'vitest';
import { roomWindow } from '../engine/roomWindow';

const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const ids = (window: Array<{ id: string }>) => window.map(room => room.id);

describe('room window', () => {
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
});
