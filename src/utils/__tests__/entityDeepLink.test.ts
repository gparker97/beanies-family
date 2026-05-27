import { describe, it, expect } from 'vitest';
import { entityDeepLink } from '@/utils/entityDeepLink';

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
});
