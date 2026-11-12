/**
 * The family timeline's pure model.
 *
 * Pinned to Asia/Singapore (UTC+8), where the month-edge bug is real: a favorite
 * added at 07:00 on 1 November is stamped `2026-10-31T23:00Z`, and both raw-string
 * sorting and slicing would file it under October.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteItem, MemberNote, Milestone, SayingItem } from '@/types/models';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

import { buildScrapbookTimeline, timelineKeyOf } from '@/utils/scrapbookTimeline';

const ALL = new Set<ScrapType>(['milestone', 'favorite', 'saying', 'note']);

function entry(
  type: ScrapType,
  id: string,
  createdAt: string,
  opts: { memberId?: string | null; effectiveDate?: string; saidOn?: string } = {}
): ScrapbookEntry {
  const memberId = 'memberId' in opts ? (opts.memberId ?? null) : 'm1';
  const payload =
    type === 'saying'
      ? ({ id, memberId, words: 'hi', saidOn: opts.saidOn, createdAt } as SayingItem)
      : type === 'milestone'
        ? ({ id, memberId, createdAt } as unknown as Milestone)
        : type === 'favorite'
          ? ({ id, memberId, createdAt } as unknown as FavoriteItem)
          : ({ id, memberId, createdAt } as unknown as MemberNote);
  return {
    id,
    type,
    memberId,
    effectiveDate: opts.effectiveDate ?? createdAt,
    createdAt,
    payload,
  };
}

function ids(months: ReturnType<typeof buildScrapbookTimeline>): string[][] {
  return months.map((m) => m.entries.map((e) => e.id));
}

const tz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Singapore';
});
afterAll(() => {
  process.env.TZ = tz;
});
beforeEach(() => {
  reportErrorMock.mockClear();
});

describe('timelineKeyOf', () => {
  it('reads a timestamp in local time', () => {
    expect(timelineKeyOf(entry('favorite', 'f1', '2026-10-31T23:00:00.000Z'))).toBe(
      '2026-11-01T07:00'
    );
  });

  it('gives a date-only milestone local midnight', () => {
    const m = entry('milestone', 'ms1', '2026-11-05T02:00:00.000Z', {
      effectiveDate: '2026-11-01',
    });
    expect(timelineKeyOf(m)).toBe('2026-11-01T00:00');
  });

  it('dates a saying by saidOn when present, else createdAt', () => {
    const said = entry('saying', 's1', '2026-11-05T02:00:00.000Z', { saidOn: '2026-03-02' });
    const unsaid = entry('saying', 's2', '2026-11-05T02:00:00.000Z');
    expect(timelineKeyOf(said)).toBe('2026-03-02T00:00');
    expect(timelineKeyOf(unsaid)).toBe('2026-11-05T10:00');
  });

  it('falls back to createdAt for an invalid saidOn, without a report on every recompute', () => {
    const s = entry('saying', 's3', '2026-11-05T02:00:00.000Z', { saidOn: 'not a date' });
    expect(timelineKeyOf(s)).toBe('2026-11-05T10:00');
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});

describe('buildScrapbookTimeline', () => {
  it('files a UTC timestamp that is the 1st locally beside a date-only 1st', () => {
    const months = buildScrapbookTimeline(
      [
        entry('milestone', 'ms-nov1', '2026-11-02T00:00:00.000Z', { effectiveDate: '2026-11-01' }),
        // 1 Nov 07:00 local
        entry('favorite', 'f-nov1', '2026-10-31T23:00:00.000Z'),
        // 31 Oct 23:00 local
        entry('note', 'n-oct31', '2026-10-31T15:00:00.000Z'),
      ],
      { memberId: null, types: ALL }
    );
    expect(months.map((m) => m.key)).toEqual(['2026-11', '2026-10']);
    expect(ids(months)).toEqual([['f-nov1', 'ms-nov1'], ['n-oct31']]);
    expect(months[0]).toMatchObject({ year: 2026, monthIndex: 10 });
    expect(months[1]).toMatchObject({ year: 2026, monthIndex: 9 });
  });

  it('puts a saying in the month it was said', () => {
    const months = buildScrapbookTimeline(
      [
        entry('saying', 's1', '2026-11-05T02:00:00.000Z', { saidOn: '2026-03-02' }),
        entry('favorite', 'f1', '2026-11-05T02:00:00.000Z'),
      ],
      { memberId: null, types: ALL }
    );
    expect(months.map((m) => m.key)).toEqual(['2026-11', '2026-03']);
    expect(ids(months)).toEqual([['f1'], ['s1']]);
  });

  it('keeps a bean plus whole-family moments, or everyone when no bean is chosen', () => {
    const list = [
      entry('favorite', 'mine', '2026-11-05T02:00:00.000Z', { memberId: 'm1' }),
      entry('favorite', 'theirs', '2026-11-04T02:00:00.000Z', { memberId: 'm2' }),
      entry('milestone', 'family', '2026-11-03T02:00:00.000Z', { memberId: null }),
    ];
    // A whole-family moment with no memberId field at all, as older data may be.
    const absent = entry('milestone', 'family-absent', '2026-11-02T02:00:00.000Z');
    delete (absent as Partial<ScrapbookEntry>).memberId;
    list.push(absent);

    expect(ids(buildScrapbookTimeline(list, { memberId: 'm1', types: ALL }))).toEqual([
      ['mine', 'family', 'family-absent'],
    ]);
    expect(ids(buildScrapbookTimeline(list, { memberId: null, types: ALL }))).toEqual([
      ['mine', 'theirs', 'family', 'family-absent'],
    ]);
  });

  it('shows nothing for an empty type set, and only the enabled types otherwise', () => {
    const list = [
      entry('favorite', 'f1', '2026-11-05T02:00:00.000Z'),
      entry('note', 'n1', '2026-11-04T02:00:00.000Z'),
    ];
    expect(buildScrapbookTimeline(list, { memberId: null, types: new Set() })).toEqual([]);
    expect(ids(buildScrapbookTimeline(list, { memberId: null, types: new Set(['note']) }))).toEqual(
      [['n1']]
    );
  });

  it('orders same-minute entries by id whatever the input order', () => {
    const a = entry('favorite', 'a', '2026-11-05T02:00:00.000Z');
    const b = entry('note', 'b', '2026-11-05T02:00:30.000Z');
    const c = entry('saying', 'c', '2026-11-05T02:00:00.000Z');
    const opts = { memberId: null, types: ALL };
    expect(ids(buildScrapbookTimeline([c, b, a], opts))).toEqual([['a', 'b', 'c']]);
    expect(ids(buildScrapbookTimeline([a, c, b], opts))).toEqual([['a', 'b', 'c']]);
  });

  it('skips an unparseable date and reports it once per entry', () => {
    const bad = entry('favorite', 'bad-1', 'garbage');
    const good = entry('note', 'good', '2026-11-05T02:00:00.000Z');
    const opts = { memberId: null, types: ALL };

    expect(ids(buildScrapbookTimeline([bad, good], opts))).toEqual([['good']]);
    buildScrapbookTimeline([bad, good], opts);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'scrapbook',
        severity: 'warning',
        context: { kind: 'favorite', stage: 'timeline-key' },
      })
    );

    // A different entry is its own report.
    buildScrapbookTimeline(
      [entry('milestone', 'bad-2', 'x', { effectiveDate: '2026-02-30' })],
      opts
    );
    expect(reportErrorMock).toHaveBeenCalledTimes(2);
  });
});
