/**
 * The retired machine-translation cache delete (TEMPORARY, remove with the
 * function after 2026-12-01). One-time per device via a localStorage marker; a
 * blocked delete is reported as `blocked` (by the shared `deleteDB`), not
 * passed off as success, and leaves the marker unset so a later boot retries.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/services/automerge/worker/docClient', () => ({}));
vi.mock('@/services/sync/photoUploadQueue', () => ({ deletePhotoQueueDatabase: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

import { logEvent } from '@/services/telemetry';
import { deleteRetiredTranslationDatabase } from '../database';

type FakeRequest = {
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
};

let request: FakeRequest;

const MARKER = 'beanies:retired-translation-db-cleaned';

beforeEach(() => {
  vi.mocked(logEvent).mockClear();
  localStorage.clear();
  request = { error: null, onsuccess: null, onerror: null, onblocked: null };
  vi.stubGlobal('indexedDB', {
    deleteDatabase: vi.fn(() => request),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('deleteRetiredTranslationDatabase', () => {
  it('deletes once, sets the marker and emits one deleted event', async () => {
    const done = deleteRetiredTranslationDatabase();
    request.onsuccess?.();
    await done;
    expect(indexedDB.deleteDatabase).toHaveBeenCalledWith('beanies-translations');
    expect(localStorage.getItem(MARKER)).toBe('1');
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'idb-legacy-cleanup',
      message: 'retired translation database removed',
      context: { action: 'deleted' },
    });
  });

  it('returns early without an IndexedDB request once the marker is set', async () => {
    localStorage.setItem(MARKER, '1');
    await deleteRetiredTranslationDatabase();
    expect(indexedDB.deleteDatabase).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('reports a blocked delete as blocked, resolves, and leaves the marker unset', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const done = deleteRetiredTranslationDatabase();
    request.onblocked?.();
    await done;
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith({
      level: 'warn',
      surface: 'idb-delete',
      message: 'database beanies-translations delete blocked',
      context: { action: 'blocked' },
    });
    expect(localStorage.getItem(MARKER)).toBeNull();
  });

  it('reports an errored delete as failed and never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const done = deleteRetiredTranslationDatabase();
    request.error = new DOMException('nope', 'UnknownError');
    request.onerror?.();
    await expect(done).resolves.toBeUndefined();
    expect(localStorage.getItem(MARKER)).toBeNull();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'idb-legacy-cleanup',
        context: { action: 'failed', error_code: 'UnknownError' },
      })
    );
  });
});
