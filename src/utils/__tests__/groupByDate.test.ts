import { describe, it, expect } from 'vitest';
import { groupByDate } from '../groupByDate';

interface Item {
  id: string;
  date: string;
}

const getDate = (i: Item) => i.date;
const labelize = (d: string) => `Date: ${d}`;

describe('groupByDate', () => {
  it('returns an empty array for empty input', () => {
    expect(groupByDate<Item>([], getDate, labelize)).toEqual([]);
  });

  it('groups a single item', () => {
    const result = groupByDate([{ id: 'a', date: '2026-04-21' }], getDate, labelize);
    expect(result).toEqual([
      { date: '2026-04-21', label: 'Date: 2026-04-21', items: [{ id: 'a', date: '2026-04-21' }] },
    ]);
  });

  it('groups contiguous same-date items together', () => {
    const result = groupByDate(
      [
        { id: 'a', date: '2026-04-21' },
        { id: 'b', date: '2026-04-21' },
        { id: 'c', date: '2026-04-20' },
        { id: 'd', date: '2026-04-20' },
      ],
      getDate,
      labelize
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result[1]!.items.map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('preserves caller order within each group', () => {
    const result = groupByDate(
      [
        { id: 'z', date: '2026-04-21' },
        { id: 'm', date: '2026-04-21' },
        { id: 'a', date: '2026-04-21' },
      ],
      getDate,
      labelize
    );
    expect(result[0]!.items.map((i) => i.id)).toEqual(['z', 'm', 'a']);
  });

  it('creates a new group when the date changes back (does not merge)', () => {
    // If the caller's list isn't sorted, groupByDate does not merge — it emits
    // fresh groups each time the date differs from the previous item.
    const result = groupByDate(
      [
        { id: 'a', date: '2026-04-21' },
        { id: 'b', date: '2026-04-20' },
        { id: 'c', date: '2026-04-21' },
      ],
      getDate,
      labelize
    );
    expect(result.map((g) => g.date)).toEqual(['2026-04-21', '2026-04-20', '2026-04-21']);
  });

  it('uses the provided formatLabel function', () => {
    const result = groupByDate([{ id: 'a', date: '2026-04-21' }], getDate, (d) => `Custom(${d})`);
    expect(result[0]!.label).toBe('Custom(2026-04-21)');
  });
});
