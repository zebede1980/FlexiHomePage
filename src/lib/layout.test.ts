import { describe, expect, it } from 'vitest';
import { arrangeColumns, moveBetweenColumns } from './layout';

const id = (s: string) => s;

describe('arrangeColumns', () => {
  it('deals round-robin when nothing is saved', () => {
    expect(arrangeColumns(['a', 'b', 'c', 'd', 'e'], id, [], 2)).toEqual([
      ['a', 'c', 'e'],
      ['b', 'd'],
    ]);
  });

  it('follows the saved layout regardless of bookmark order', () => {
    const saved = [['d', 'a', 'b'], ['c']];
    expect(arrangeColumns(['a', 'b', 'c', 'd'], id, saved, 2)).toEqual(saved);
  });

  it('puts unknown cards in the column with the fewest cards and skips missing ones', () => {
    const saved = [['a', 'gone', 'b'], ['c']];
    expect(arrangeColumns(['a', 'b', 'c', 'new'], id, saved, 2)).toEqual([
      ['a', 'b'],
      ['c', 'new'],
    ]);
  });

  it('folds extra saved columns into a narrower window and leaves extra columns empty in a wider one', () => {
    const saved = [['a'], ['b'], ['c']];
    expect(arrangeColumns(['a', 'b', 'c'], id, saved, 2)).toEqual([['a', 'c'], ['b']]);
    expect(arrangeColumns(['a', 'b', 'c'], id, saved, 4)).toEqual([['a'], ['b'], ['c'], []]);
  });

  it('places folders that share a title', () => {
    const cards = [
      { id: '1', t: 'Work' },
      { id: '2', t: 'Work' },
    ];
    const cols = arrangeColumns(cards, (c) => c.t, [['Work'], ['Work']], 2);
    expect(cols.map((c) => c.map((x) => x.id))).toEqual([['1'], ['2']]);
  });
});

describe('moveBetweenColumns', () => {
  const cols = [['a', 'b', 'c'], ['d']];

  it('moves to the bottom of a shorter column without touching the rest', () => {
    expect(moveBetweenColumns(cols, { col: 0, index: 0 }, { col: 1, index: 1 })).toEqual([['b', 'c'], ['d', 'a']]);
  });

  it('reorders within a column', () => {
    expect(moveBetweenColumns(cols, { col: 0, index: 0 }, { col: 0, index: 2 })).toEqual([['b', 'c', 'a'], ['d']]);
  });

  it('does not mutate its input', () => {
    moveBetweenColumns(cols, { col: 0, index: 0 }, { col: 1, index: 0 });
    expect(cols).toEqual([['a', 'b', 'c'], ['d']]);
  });
});
