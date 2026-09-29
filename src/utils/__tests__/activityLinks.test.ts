import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import {
  itemsForSession,
  linkForSession,
  listLink,
  listLinkPatch,
  resolveLink,
  sessionLinkMatcher,
  todoLink,
  todoLinkPatch,
  type ActivityLink,
  type ActivityLinkLookup,
} from '../activityLinks';

function activity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'one-off',
    title: 'Tournament',
    date: '2026-10-06',
    isActive: true,
    recurrence: 'none',
    ...overrides,
  } as FamilyActivity;
}

const master = activity({ id: 'series', date: '2026-09-01', recurrence: 'weekly' });
const ruleMaster = activity({
  id: 'rule-series',
  date: '2026-09-01',
  recurrence: undefined,
  rule: { frequency: 'weekly' } as never,
});
/** An edited session: replaces the 2026-10-06 occurrence, keeps its date. */
const edited = activity({ id: 'child', date: '2026-10-06', parentActivityId: 'series' });
/** A rescheduled session: replaces 2026-10-13, moved to 2026-10-14. */
const moved = activity({
  id: 'moved',
  date: '2026-10-14',
  originalOccurrenceDate: '2026-10-13',
  parentActivityId: 'series',
});

function lookupOf(all: FamilyActivity[]): ActivityLinkLookup {
  return {
    byId: (id) => all.find((a) => a.id === id),
    overrideFor: (seriesId, ymd) =>
      all.find(
        (a) =>
          a.parentActivityId === seriesId &&
          (a.originalOccurrenceDate ?? a.date).slice(0, 10) === ymd
      ),
  };
}

describe('linkForSession', () => {
  it('a one-off links to itself with no date', () => {
    expect(linkForSession(activity(), '2026-10-06')).toEqual({ activityId: 'one-off' });
  });

  it('a repeating master links to the series + the session date', () => {
    expect(linkForSession(master, '2026-10-06')).toEqual({
      activityId: 'series',
      activityDate: '2026-10-06',
    });
    expect(linkForSession(ruleMaster, '2026-10-06T09:00')).toEqual({
      activityId: 'rule-series',
      activityDate: '2026-10-06',
    });
  });

  it('an edited session links to the series + the ORIGINAL occurrence date', () => {
    expect(linkForSession(edited, '2026-10-06')).toEqual({
      activityId: 'series',
      activityDate: '2026-10-06',
    });
    // Rescheduled: the key is the replaced occurrence, not the new date.
    expect(linkForSession(moved, '2026-10-14')).toEqual({
      activityId: 'series',
      activityDate: '2026-10-13',
    });
  });
});

describe('sessionLinkMatcher', () => {
  const link = (activityId: string, activityDate?: string): ActivityLink =>
    activityDate ? { activityId, activityDate } : { activityId };

  it('never matches a missing link', () => {
    for (const a of [activity(), master, edited]) {
      expect(sessionLinkMatcher(a, '2026-10-06')(null)).toBeNull();
    }
  });

  it('repeating master: dateless → every-session, this date → session, other date → none', () => {
    const match = sessionLinkMatcher(master, '2026-10-06');
    expect(match(link('series'))).toBe('every-session');
    expect(match(link('series', '2026-10-06'))).toBe('session');
    expect(match(link('series', '2026-10-13'))).toBeNull();
    expect(match(link('other'))).toBeNull();
  });

  it('edited session: own id, series dateless, series + original date', () => {
    const match = sessionLinkMatcher(edited, '2026-10-06');
    expect(match(link('child'))).toBe('session');
    expect(match(link('series'))).toBe('every-session');
    expect(match(link('series', '2026-10-06'))).toBe('session');
    expect(match(link('series', '2026-10-13'))).toBeNull();
    expect(match(link('other'))).toBeNull();
  });

  it('rescheduled session matches on its ORIGINAL date, whatever sessionYmd is', () => {
    const match = sessionLinkMatcher(moved, '2026-10-14');
    expect(match(link('series', '2026-10-13'))).toBe('session');
    expect(match(link('series', '2026-10-14'))).toBeNull();
  });

  it('one-off: own id → session', () => {
    const match = sessionLinkMatcher(activity(), '2026-10-06');
    expect(match(link('one-off'))).toBe('session');
    expect(match(link('other'))).toBeNull();
  });

  it('fail-safe: a non-repeating activity ignores activityDate (repeating → one-off edit)', () => {
    const match = sessionLinkMatcher(activity({ id: 'series' }), '2026-10-06');
    expect(match(link('series', '2026-09-01'))).toBe('session');
    expect(match(link('series', '2030-01-01'))).toBe('session');
  });
});

describe('itemsForSession', () => {
  it('keeps input order and attaches the scope', () => {
    const items = [
      { id: 'a', activityId: 'series', activityDate: '2026-10-06' },
      { id: 'b', activityId: 'series' },
      { id: 'c', activityId: 'series', activityDate: '2026-10-13' },
      { id: 'd' },
    ];
    const out = itemsForSession(items, todoLink, master, '2026-10-06');
    expect(out.map((o) => [o.item.id, o.scope])).toEqual([
      ['a', 'session'],
      ['b', 'every-session'],
    ]);
  });
});

describe('readers', () => {
  it('todoLink / listLink read the link or null', () => {
    expect(todoLink({})).toBeNull();
    expect(todoLink({ activityId: 'x' })).toEqual({ activityId: 'x' });
    expect(todoLink({ activityId: 'x', activityDate: '2026-10-06' })).toEqual({
      activityId: 'x',
      activityDate: '2026-10-06',
    });
    // A date without an id is not a link.
    expect(todoLink({ activityDate: '2026-10-06' })).toBeNull();
    expect(listLink({})).toBeNull();
    expect(listLink({ linkedActivityId: 'y', activityDate: '2026-10-06' })).toEqual({
      activityId: 'y',
      activityDate: '2026-10-06',
    });
  });
});

describe('writers always carry both keys', () => {
  it('todoLinkPatch', () => {
    const whole = todoLinkPatch({ activityId: 'x' });
    expect(Object.keys(whole).sort()).toEqual(['activityDate', 'activityId']);
    expect(whole).toEqual({ activityId: 'x', activityDate: undefined });
    expect(todoLinkPatch({ activityId: 'x', activityDate: '2026-10-06' })).toEqual({
      activityId: 'x',
      activityDate: '2026-10-06',
    });
    const cleared = todoLinkPatch(null);
    expect(Object.keys(cleared).sort()).toEqual(['activityDate', 'activityId']);
    expect(Object.values(cleared)).toEqual([undefined, undefined]);
  });

  it('listLinkPatch', () => {
    const whole = listLinkPatch({ activityId: 'x' });
    expect(Object.keys(whole).sort()).toEqual(['activityDate', 'linkedActivityId']);
    expect(listLinkPatch({ activityId: 'x', activityDate: '2026-10-06' })).toEqual({
      linkedActivityId: 'x',
      activityDate: '2026-10-06',
    });
    const cleared = listLinkPatch(null);
    expect(Object.keys(cleared).sort()).toEqual(['activityDate', 'linkedActivityId']);
    expect(Object.values(cleared)).toEqual([undefined, undefined]);
  });

  it('a list round-trips through its writer and reader', () => {
    const l: ActivityLink = { activityId: 'series', activityDate: '2026-10-06' };
    expect(listLink(listLinkPatch(l))).toEqual(l);
    expect(todoLink(todoLinkPatch(l))).toEqual(l);
    expect(listLink(listLinkPatch(null))).toBeNull();
  });
});

describe('resolveLink', () => {
  const all = [activity(), master, edited, moved];
  const lookup = lookupOf(all);

  it('a dateless link resolves to its activity alone', () => {
    expect(resolveLink({ activityId: 'one-off' }, lookup)).toEqual({ activity: all[0] });
    expect(resolveLink({ activityId: 'series' }, lookup)).toEqual({ activity: master });
  });

  it('an unresolvable activity resolves to null', () => {
    expect(resolveLink({ activityId: 'gone' }, lookup)).toBeNull();
    expect(resolveLink({ activityId: 'gone', activityDate: '2026-10-06' }, lookup)).toBeNull();
  });

  it('a session that was not edited resolves to the series + date', () => {
    expect(resolveLink({ activityId: 'series', activityDate: '2026-10-20' }, lookup)).toEqual({
      activity: master,
      date: '2026-10-20',
    });
  });

  it('an edited session resolves to the override child and ITS (shown) date', () => {
    expect(resolveLink({ activityId: 'series', activityDate: '2026-10-06' }, lookup)).toEqual({
      activity: edited,
      date: '2026-10-06',
    });
    expect(resolveLink({ activityId: 'series', activityDate: '2026-10-13' }, lookup)).toEqual({
      activity: moved,
      date: '2026-10-14',
    });
  });

  it('drops a stale session date once the activity no longer repeats (fail-safe)', () => {
    const nowOneOff = { ...master, recurrence: 'none', daysOfWeek: undefined } as FamilyActivity;
    expect(
      resolveLink({ activityId: 'series', activityDate: '2026-10-20' }, lookupOf([nowOneOff]))
    ).toEqual({ activity: nowOneOff });
  });
  it('a cancelled edited session resolves to null so its chip hides', () => {
    const cancelled = { ...edited, isActive: false };
    expect(
      resolveLink(
        { activityId: 'series', activityDate: '2026-10-06' },
        lookupOf([master, cancelled])
      )
    ).toBeNull();
  });
});

describe('round-trip invariant: the resolved session accepts every link it wrote', () => {
  // An orphaned child (series gone, its own delete failed) must round-trip too.
  const orphan = activity({ id: 'orphan', date: '2026-11-03', parentActivityId: 'deleted-series' });
  const cases: [string, FamilyActivity, string][] = [
    ['one-off', activity(), '2026-10-06'],
    ['master session', master, '2026-10-20'],
    ['master session that has an edited child', master, '2026-10-06'],
    ['rule master session', ruleMaster, '2026-10-20'],
    ['edited session', edited, '2026-10-06'],
    ['rescheduled session', moved, '2026-10-14'],
    ['orphaned edited session', orphan, '2026-11-03'],
  ];
  const lookup = lookupOf([activity(), master, ruleMaster, edited, moved, orphan]);

  it.each(cases)('%s', (_name, a, ymd) => {
    const link = linkForSession(a, ymd);
    const resolved = resolveLink(link, lookup);
    expect(resolved).not.toBeNull();
    const scope = sessionLinkMatcher(resolved!.activity, resolved!.date ?? ymd)(link);
    expect(scope).toBe('session');
  });
});
