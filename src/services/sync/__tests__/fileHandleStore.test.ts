// Default happy-dom env (gives us localStorage); add fake-indexeddb/auto on
// top so the `idb` wrapper used by fileHandleStore has a backing impl.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'fam-test'),
}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

import { reportError } from '@/utils/errorReporter';

const reportErrorMock = reportError as ReturnType<typeof vi.fn>;

// Fresh import per test to reset the module-level `handleDb` cache.
let store: typeof import('../fileHandleStore');

describe('fileHandleStore — refresh token storage shape (2026-05-20)', () => {
  let testIdCounter = 0;
  let famKey: string;
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    // Each test uses a unique family key so IDB state from earlier tests
    // doesn't bleed in. (fake-indexeddb is process-global; deleting the
    // database between tests deadlocks on `await` since the request is
    // not natively a Promise.)
    testIdCounter += 1;
    famKey = `fam-${testIdCounter}`;
    reportErrorMock.mockClear();
    store = await import('../fileHandleStore');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('round-trip', () => {
    it('stores the new {token, issuedAt} shape and reads it back', async () => {
      const before = Date.now();
      await store.storeGoogleRefreshToken(famKey, 'tok-abc');
      const after = Date.now();

      const got = await store.getGoogleRefreshToken(famKey);
      expect(got).not.toBeNull();
      expect(got?.token).toBe('tok-abc');
      expect(typeof got?.issuedAt).toBe('number');
      // `issuedAt` defaults to Date.now() at write time.
      expect(got?.issuedAt).toBeGreaterThanOrEqual(before);
      expect(got?.issuedAt).toBeLessThanOrEqual(after);
    });

    it('respects an explicit numeric issuedAt', async () => {
      await store.storeGoogleRefreshToken(famKey, 'tok', { issuedAt: 1700000000000 });
      const got = await store.getGoogleRefreshToken(famKey);
      expect(got).toEqual({ token: 'tok', issuedAt: 1700000000000 });
    });

    it('respects an explicit null issuedAt (migratePending forwarding legacy)', async () => {
      await store.storeGoogleRefreshToken(famKey, 'tok', { issuedAt: null });
      const got = await store.getGoogleRefreshToken(famKey);
      expect(got).toEqual({ token: 'tok', issuedAt: null });
    });
  });

  describe('legacy bare-string IDB entry', () => {
    it('reader treats a legacy bare-string IDB value as issuedAt:null', async () => {
      // Open the same DB and write a bare string directly, bypassing
      // storeGoogleRefreshToken to simulate a pre-2026-05-20 entry.
      const { openDB } = await import('idb');
      const db = await openDB('beanies-file-handles', 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('handles')) {
            db.createObjectStore('handles');
          }
        },
      });
      await db.put(
        'handles',
        'legacy-token' as unknown as FileSystemFileHandle,
        `googleRefreshToken-${famKey}`
      );
      db.close();

      // Re-import after seeding so the store opens its own connection fresh.
      vi.resetModules();
      store = await import('../fileHandleStore');

      const got = await store.getGoogleRefreshToken(famKey);
      expect(got).toEqual({ token: 'legacy-token', issuedAt: null });
    });
  });

  describe('localStorage fallback', () => {
    it('reader falls back to localStorage when IDB has no entry, with issuedAt:null', async () => {
      localStorage.setItem(`beanies_grt_${famKey}`, 'fallback-tok');
      const got = await store.getGoogleRefreshToken(famKey);
      expect(got).toEqual({ token: 'fallback-tok', issuedAt: null });
    });

    it('returns null when neither IDB nor localStorage has anything', async () => {
      const got = await store.getGoogleRefreshToken(famKey);
      expect(got).toBeNull();
    });
  });

  describe('non-silent failure surfacing', () => {
    it('localStorage-read failure does NOT call reportError (private-mode noise)', async () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: localStorage disabled');
      });
      // IDB has nothing; fallback path is triggered.
      const got = await store.getGoogleRefreshToken(famKey);
      expect(got).toBeNull();
      expect(reportErrorMock).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('localStorage-write failure logs but does not throw', async () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      // Should not throw — IDB is still the primary store.
      await expect(store.storeGoogleRefreshToken(famKey, 'tok')).resolves.toBeUndefined();
      spy.mockRestore();
    });

    it('clear localStorage failure logs but does not throw', async () => {
      const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      await expect(store.clearGoogleRefreshToken(famKey)).resolves.toBeUndefined();
      spy.mockRestore();
    });
  });
});
