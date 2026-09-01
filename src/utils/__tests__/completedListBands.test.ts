import { describe, it, expect } from 'vitest';
import { groupCompletedByRecency } from '@/utils/completedListBands';
import type { FamilyList } from '@/types/models';

// A Wednesday, so the Monday anchor is 2026-08-31 and last week starts 2026-08-24.
const TODAY = '2026-09-02';

function filed(id: string, completedAt?: string, updatedAt = ''): FamilyList {
  return { id, title: id, items: [], completedAt, updatedAt } as unknown as FamilyList;
}

const keys = (lists: FamilyList[]) => groupCompletedByRecency(lists, TODAY).map((b) => b.key);

describe('groupCompletedByRecency', () => {
  it('separates this week, last week and older months', () => {
    const bands = groupCompletedByRecency(
      [
        filed('today', `${TODAY}T09:00:00.000Z`),
        filed('monday', '2026-08-31T09:00:00.000Z'),
        filed('lastweek', '2026-08-26T09:00:00.000Z'),
        filed('july', '2026-07-14T09:00:00.000Z'),
      ],
      TODAY
    );
    expect(bands.map((b) => b.key)).toEqual(['this-week', 'last-week', '2026-07']);
    expect(bands[0]!.items.map((l: { id: string }) => l.id)).toEqual(['today', 'monday']);
  });

  it('anchors the week on Monday, so Sunday belongs to the week before', () => {
    // 2026-08-30 is the Sunday before this week's Monday (08-31).
    // Local-time construction: these timestamps are compared against a LOCAL week
    // boundary, so a literal `Z` fixture only expresses "Sunday evening" near UTC.
    expect(keys([filed('sun', new Date('2026-08-30T20:00:00').toISOString())])).toEqual([
      'last-week',
    ]);
    expect(keys([filed('mon', new Date('2026-08-31T00:00:00').toISOString())])).toEqual([
      'this-week',
    ]);
  });

  it('coarsens to whole months once past last week, one band per month', () => {
    const bands = groupCompletedByRecency(
      [
        filed('a', '2026-08-10T09:00:00.000Z'),
        filed('b', '2026-08-02T09:00:00.000Z'),
        filed('c', '2026-06-02T09:00:00.000Z'),
      ],
      TODAY
    );
    expect(bands.map((b) => b.key)).toEqual(['2026-08', '2026-06']);
    expect(bands[0]!.items).toHaveLength(2);
    expect(bands[0]!.isLabelKey).toBe(false);
  });

  it('preserves the incoming order within a band, so newest-first survives', () => {
    const bands = groupCompletedByRecency(
      [filed('newer', '2026-09-01T18:00:00.000Z'), filed('older', '2026-09-01T08:00:00.000Z')],
      TODAY
    );
    expect(bands[0]!.items.map((l: { id: string }) => l.id)).toEqual(['newer', 'older']);
  });

  it('falls back to updatedAt, and files a list with no date at all rather than dropping it', () => {
    const bands = groupCompletedByRecency(
      [filed('viaUpdated', undefined, '2026-09-01T09:00:00.000Z'), filed('nodate')],
      TODAY
    );
    expect(bands.map((b) => b.key)).toEqual(['this-week', 'undated']);
    // The catch-all sorts last however the input arrived.
    expect(bands.at(-1)!.key).toBe('undated');
  });
});
