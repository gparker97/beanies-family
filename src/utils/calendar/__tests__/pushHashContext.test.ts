import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ resolveHomeTimeZoneNow: resolveMock }),
}));
vi.mock('../memberNames', () => ({
  makeMemberNameResolver: () => (id: string) => (id === 'm1' ? 'Mia' : undefined),
}));

import { makePushHashContext } from '../pushHashContext';

describe('makePushHashContext', () => {
  beforeEach(() => resolveMock.mockReset());

  it('stamps the resolved zone and hashes only the PERSISTED one', () => {
    resolveMock.mockReturnValue({
      zone: 'Asia/Singapore',
      source: 'family',
      hashZone: 'Asia/Singapore',
      invalidStored: false,
    });
    const ctx = makePushHashContext();
    expect(ctx).toMatchObject({
      timeZone: 'Asia/Singapore',
      hashZone: 'Asia/Singapore',
      source: 'family',
      invalidStored: false,
    });
    expect(ctx.memberName('m1')).toBe('Mia');
  });

  it('a country or device zone is stamped but NEVER hashed', () => {
    resolveMock.mockReturnValue({
      zone: 'America/Los_Angeles',
      source: 'device-fallback',
      hashZone: '',
      invalidStored: false,
    });
    expect(makePushHashContext()).toMatchObject({ timeZone: 'America/Los_Angeles', hashZone: '' });
  });

  it('re-resolves on every call (a device that crossed zones gets the new one)', () => {
    resolveMock.mockReturnValue({
      zone: 'UTC',
      source: 'device-fallback',
      hashZone: '',
      invalidStored: false,
    });
    makePushHashContext();
    makePushHashContext();
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });
});
