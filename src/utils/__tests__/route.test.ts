import { describe, it, expect } from 'vitest';
import { isRouteActive } from '../route';

describe('isRouteActive', () => {
  it('returns true for exact match', () => {
    expect(isRouteActive('/pod', '/pod')).toBe(true);
    expect(isRouteActive('/dashboard', '/dashboard')).toBe(true);
  });

  it('returns true for descendant routes', () => {
    expect(isRouteActive('/pod/cookbook', '/pod')).toBe(true);
    expect(isRouteActive('/pod/scrapbook/album-1', '/pod')).toBe(true);
    expect(isRouteActive('/accounts/123', '/accounts')).toBe(true);
  });

  it('returns false for non-matching routes', () => {
    expect(isRouteActive('/pod', '/podium')).toBe(false);
    expect(isRouteActive('/podium', '/pod')).toBe(false);
    expect(isRouteActive('/dashboard', '/accounts')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isRouteActive('', '/pod')).toBe(false);
    expect(isRouteActive('/pod', '')).toBe(false);
    expect(isRouteActive('', '')).toBe(false);
  });

  it('guards root path from over-matching', () => {
    expect(isRouteActive('/anywhere', '/')).toBe(false);
    expect(isRouteActive('/dashboard/accounts', '/')).toBe(false);
    expect(isRouteActive('/', '/')).toBe(true);
  });

  it('handles trailing-slash differences predictably', () => {
    // currentPath usually has no trailing slash from vue-router
    expect(isRouteActive('/pod', '/pod/')).toBe(false);
    // itemPath without trailing slash matches descendants
    expect(isRouteActive('/pod/', '/pod')).toBe(true);
  });

  it('does not match a similar-prefixed sibling', () => {
    expect(isRouteActive('/podcast', '/pod')).toBe(false);
    expect(isRouteActive('/account-list', '/account')).toBe(false);
  });
});
