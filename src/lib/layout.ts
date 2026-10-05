// Card column layout. Pure, so it stays unit-testable.
//
// The user's arrangement is saved as columns of card keys (pathKey()s). Card
// order within the bookmark folder doesn't affect it, so moving one card never
// reflows the others into different columns.

/**
 * Deals `cards` into `count` columns, following `saved` where it can.
 * Saved columns beyond `count` (a narrower window) fold back in from the left.
 * Cards the layout doesn't mention (new or renamed folders) go to the column
 * with the fewest cards, which is plain round-robin when nothing is saved.
 */
export function arrangeColumns<T>(cards: T[], keyOf: (card: T) => string, saved: string[][], count: number): T[][] {
  const columns: T[][] = Array.from({ length: count }, () => []);

  // Queues rather than a plain map, so two folders with the same title both get placed.
  const byKey = new Map<string, T[]>();
  for (const card of cards) {
    const k = keyOf(card);
    byKey.set(k, [...(byKey.get(k) ?? []), card]);
  }

  const placed = new Set<T>();
  saved.forEach((keys, c) => {
    for (const k of keys) {
      const card = byKey.get(k)?.shift();
      if (card) {
        columns[c % count].push(card);
        placed.add(card);
      }
    }
  });

  for (const card of cards) {
    if (placed.has(card)) continue;
    const shortest = columns.reduce((best, col, i) => (col.length < columns[best].length ? i : best), 0);
    columns[shortest].push(card);
  }
  return columns;
}

/** Layout key of the to-do card. Folder keys are JSON arrays, so this can't clash with one. */
export const TODO_CARD_KEY = 'todo';

/**
 * `saved` with `key` at the top of column `col`, unless the user has already
 * placed it somewhere. Not saved, so the default follows the window width.
 */
export function withDefaultPlace(saved: string[][], key: string, col: number): string[][] {
  if (saved.some((c) => c.includes(key))) return saved;
  const next = saved.map((c) => [...c]);
  while (next.length <= col) next.push([]);
  next[col].unshift(key);
  return next;
}

/** Moves one item between columns. `to.index` counts positions with the moved item already taken out. */
export function moveBetweenColumns<T>(
  columns: T[][],
  from: { col: number; index: number },
  to: { col: number; index: number },
): T[][] {
  const next = columns.map((col) => [...col]);
  const [item] = next[from.col].splice(from.index, 1);
  next[to.col].splice(to.index, 0, item);
  return next;
}
