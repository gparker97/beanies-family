/**
 * cacheFailureCause (#100): the durability signal's detail, mapped to the cause a
 * person can act on. The banner and the Settings warning pick their copy from it,
 * so a wrong mapping tells someone to close tabs when their disk is full, or the
 * reverse.
 */
import { describe, it, expect } from 'vitest';
import { cacheFailureCause } from '@/utils/cacheFailureCause';

describe('cacheFailureCause', () => {
  it.each(['CacheOpenTimeoutError', 'DeleteBlocked', 'CacheDeleteTimeoutError'])(
    'an open that failed with %s is another tab holding the cache',
    (errorName) => {
      expect(cacheFailureCause({ kind: 'open', errorName })).toBe('other-tabs');
    }
  );

  it.each(['base', 'increment'] as const)(
    'a %s WRITE failure is storage, whatever the error: the database was reachable',
    (kind) => {
      expect(cacheFailureCause({ kind, errorName: 'UnknownError' })).toBe('storage');
    }
  );

  it.each(['QuotaExceededError', 'InvalidStateError'])(
    'an open refused with %s is storage (full, or a private window)',
    (errorName) => {
      expect(cacheFailureCause({ kind: 'open', errorName })).toBe('storage');
    }
  );

  it('anything else, including the impossible upgrade, is unknown and keeps the hedged copy', () => {
    expect(cacheFailureCause({ kind: 'open', errorName: 'CacheUpgradeElsewhere' })).toBe('unknown');
    expect(cacheFailureCause({ kind: 'open', errorName: 'UnknownError' })).toBe('unknown');
    expect(cacheFailureCause(null)).toBe('unknown');
  });
});
