import { describe, it, expect } from 'vitest';
import { groupByDay } from '../groupByDay';

type Row = { id: string; date: string };
const r = (id: string, date: string): Row => ({ id, date });
const byDate = (x: Row) => x.date;

describe('groupByDay', () => {
  it('returns no groups for no rows', () => {
    expect(groupByDay([], byDate)).toEqual([]);
  });

  it('groups consecutive rows of the same day, preserving input order', () => {
    const rows = [r('a', '2026-09-01'), r('b', '2026-09-01'), r('c', '2026-09-02')];
    expect(groupByDay(rows, byDate)).toEqual([
      { ymd: '2026-09-01', rows: [rows[0], rows[1]] },
      { ymd: '2026-09-02', rows: [rows[2]] },
    ]);
  });

  it('groups consecutively, not globally: a day that recurs later starts a new group', () => {
    const rows = [r('a', '2026-09-01'), r('b', '2026-09-02'), r('c', '2026-09-01')];
    expect(groupByDay(rows, byDate).map((g) => [g.ymd, g.rows.map((x) => x.id)])).toEqual([
      ['2026-09-01', ['a']],
      ['2026-09-02', ['b']],
      ['2026-09-01', ['c']],
    ]);
  });

  it('never reorders rows, including descending input', () => {
    const rows = [r('a', '2026-09-03'), r('b', '2026-09-02'), r('c', '2026-09-02')];
    expect(groupByDay(rows, byDate).flatMap((g) => g.rows.map((x) => x.id))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
