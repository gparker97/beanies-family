import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CREATE_ATTEMPT_MAX_AGE_MS,
  currentCreateAttempt,
  hydrateCreateAttempt,
  setCreateAttempt,
  __resetCreateAttemptForTesting,
  type CreateAttempt,
} from '../createAttemptState';

const KEY = 'beanies:create-attempt';
const NOW = 1_800_000_000_000;

// happy-dom's localStorage methods live on the instance and `vi.restoreAllMocks` does not undo a
// spy on them (the storedJson and attributionStash suites restore by hand too), so every storage
// spy goes through here.
const storageSpies: Array<{ mockRestore: () => void }> = [];
function refuse(method: 'getItem' | 'setItem' | 'removeItem', error: Error): void {
  storageSpies.push(
    vi.spyOn(localStorage, method).mockImplementation(() => {
      throw error;
    })
  );
}

function stored(): unknown {
  const raw = localStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
}

function attempt(overrides: Partial<CreateAttempt> = {}): CreateAttempt {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    startedAt: NOW,
    step: 'storage',
    ...overrides,
  };
}

describe('createAttemptState', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetCreateAttemptForTesting();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    storageSpies.splice(0).forEach((spy) => spy.mockRestore());
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('hydrateCreateAttempt', () => {
    it('missing: nothing stored, nothing open', () => {
      expect(hydrateCreateAttempt(NOW)).toEqual({ kind: 'missing', attempt: null });
      expect(currentCreateAttempt()).toBeNull();
    });

    it('ok: a live record becomes the open attempt', () => {
      localStorage.setItem(KEY, JSON.stringify(attempt({ startedAt: NOW - 60_000 })));
      const res = hydrateCreateAttempt(NOW);
      expect(res.kind).toBe('ok');
      expect(res.attempt).toEqual(attempt({ startedAt: NOW - 60_000 }));
      expect(currentCreateAttempt()).toEqual(attempt({ startedAt: NOW - 60_000 }));
      expect(stored()).not.toBeNull(); // kept
    });

    it('expired: older than 24 h is cleared, not opened, and returned for the log', () => {
      const old = attempt({ startedAt: NOW - CREATE_ATTEMPT_MAX_AGE_MS - 1, step: 'kit' });
      localStorage.setItem(KEY, JSON.stringify(old));
      expect(hydrateCreateAttempt(NOW)).toEqual({ kind: 'expired', attempt: old });
      expect(currentCreateAttempt()).toBeNull();
      expect(stored()).toBeNull();
    });

    it('expired: a record stamped in the future is not trusted either', () => {
      localStorage.setItem(KEY, JSON.stringify(attempt({ startedAt: NOW + 60_000 })));
      expect(hydrateCreateAttempt(NOW).kind).toBe('expired');
      expect(currentCreateAttempt()).toBeNull();
    });

    it('corrupt: unparseable JSON is cleared', () => {
      localStorage.setItem(KEY, '{not json');
      expect(hydrateCreateAttempt(NOW)).toEqual({ kind: 'corrupt', attempt: null });
      expect(stored()).toBeNull();
      expect(currentCreateAttempt()).toBeNull();
    });

    it.each([
      ['an unknown step', { ...attempt(), step: 'nope' }],
      ['a missing id', { startedAt: NOW, step: 'pin' }],
      ['a non-numeric startedAt', { ...attempt(), startedAt: 'yesterday' }],
      ['a non-object', 42],
    ])('corrupt: %s is the wrong shape and is cleared', (_label, value) => {
      localStorage.setItem(KEY, JSON.stringify(value));
      expect(hydrateCreateAttempt(NOW)).toEqual({ kind: 'corrupt', attempt: null });
      expect(stored()).toBeNull();
    });

    it('never throws when storage reads are refused (folds into missing)', () => {
      localStorage.setItem(KEY, JSON.stringify(attempt()));
      refuse('getItem', new Error('SecurityError'));
      expect(hydrateCreateAttempt(NOW)).toEqual({ kind: 'missing', attempt: null });
    });
  });

  describe('setCreateAttempt', () => {
    it('writes through and updates the cache', () => {
      expect(setCreateAttempt(attempt())).toEqual({ ok: true });
      expect(currentCreateAttempt()).toEqual(attempt());
      expect(stored()).toEqual(attempt());
    });

    it('null clears both the cache and storage', () => {
      setCreateAttempt(attempt());
      expect(setCreateAttempt(null)).toEqual({ ok: true });
      expect(currentCreateAttempt()).toBeNull();
      expect(stored()).toBeNull();
    });

    it('a refused write is returned, not thrown, and the cache still holds the attempt', () => {
      const err = new Error('QuotaExceededError');
      refuse('setItem', err);
      const res = setCreateAttempt(attempt());
      expect(res).toEqual({ ok: false, error: err });
      expect(currentCreateAttempt()).toEqual(attempt());
    });

    it('caches a copy, so mutating the caller object does not move the open attempt', () => {
      const a = attempt();
      setCreateAttempt(a);
      a.step = 'done';
      expect(currentCreateAttempt()?.step).toBe('storage');
    });
  });
});
