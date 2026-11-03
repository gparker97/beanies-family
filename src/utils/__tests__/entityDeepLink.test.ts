import { describe, it, expect } from 'vitest';
import { ENTITY_DEEP_LINKS, entityDeepLink, plannerDayLink } from '@/utils/entityDeepLink';
import { parsePlannerQuery } from '@/composables/usePlannerUrlState';

describe('entityDeepLink', () => {
  // The two kinds notifications actually deep-link (the rest stay covered by the
  // GlobalSearch navigation regression):
  it('todo → /todo?view=', () => {
    expect(entityDeepLink('todo', 't1')).toEqual({ path: '/todo', query: { view: 't1' } });
  });
  it('activity → /activities?activity=', () => {
    expect(entityDeepLink('activity', 'a1')).toEqual({
      path: '/activities',
      query: { activity: 'a1' },
    });
  });

  it('list → /lists?view=', () => {
    // Must match what `useOpenList().openList` pushes, or a tapped
    // reminder and an in-app "open list" land in two different places.
    expect(entityDeepLink('list', 'l1')).toEqual({ path: '/lists', query: { view: 'l1' } });
  });

  // Spot-check the rest match the pre-extraction selectResult switch.
  it('maps the remaining entity types to their original paths', () => {
    expect(entityDeepLink('vacation', 'x')).toEqual({ path: '/travel', query: { vacation: 'x' } });
    expect(entityDeepLink('account', 'x')).toEqual({ path: '/accounts', query: { view: 'x' } });
    expect(entityDeepLink('transaction', 'x')).toEqual({
      path: '/transactions',
      query: { view: 'x' },
    });
    expect(entityDeepLink('goal', 'x')).toEqual({ path: '/goals', query: { view: 'x' } });
    expect(entityDeepLink('asset', 'x')).toEqual({ path: '/assets', query: { view: 'x' } });
    expect(entityDeepLink('member', 'x')).toEqual({ path: '/family', query: { edit: 'x' } });
  });

  it('adds companion params, and the id param always wins (#114)', () => {
    expect(entityDeepLink('activity', 'a1', { date: '2026-10-10' })).toEqual({
      path: '/activities',
      query: { date: '2026-10-10', activity: 'a1' },
    });
    expect(entityDeepLink('activity', 'a1', { activity: 'other' })).toEqual({
      path: '/activities',
      query: { activity: 'a1' },
    });
  });
});

describe('plannerDayLink', () => {
  it('names the Day view on a date, or on today when no date is given', () => {
    expect(plannerDayLink('2026-11-03')).toEqual({
      path: ENTITY_DEEP_LINKS.activity.path,
      query: { view: 'day', d: '2026-11-03' },
    });
    expect(plannerDayLink()).toEqual({
      path: ENTITY_DEEP_LINKS.activity.path,
      query: { view: 'day' },
    });
  });

  // The external writer and the in-app reader are separate on purpose (this module stays
  // free of Vue); this round trip is what stops them drifting apart.
  it('round-trips through parsePlannerQuery', () => {
    expect(parsePlannerQuery(plannerDayLink('2026-11-03').query)).toEqual({
      view: 'day',
      ymd: '2026-11-03',
      invalid: [],
    });
    expect(parsePlannerQuery(plannerDayLink().query, '2026-10-19')).toEqual({
      view: 'day',
      ymd: '2026-10-19',
      invalid: [],
    });
  });
});
