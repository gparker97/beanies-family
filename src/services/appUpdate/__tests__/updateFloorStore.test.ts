/**
 * The persisted update floor: what the KDF write gate reads synchronously.
 *
 * A missing record is `null` (gate closed); a valid one round-trips; anything else is
 * removed with ONE `persisted_invalid` warning (so it does not warn on every boot) and
 * reads as `null`. A refused write warns `persist_refused` and never throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/constants/storageKeys';

const h = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));

import { persistUpdateFloor, readPersistedUpdateFloor } from '../updateFloorStore';

const KEY = STORAGE_KEYS.UPDATE_FLOOR;

function events(message: string) {
  return h.logEvent.mock.calls
    .map((c) => c[0] as { level: string; surface: string; message: string; error?: unknown })
    .filter((e) => e.surface === 'app-update' && e.message === message);
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readPersistedUpdateFloor', () => {
  it('is null when nothing was ever persisted, and says nothing', () => {
    expect(readPersistedUpdateFloor()).toBeNull();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('round-trips a persisted floor', () => {
    persistUpdateFloor('0.93');
    expect(localStorage.getItem(KEY)).toBe('"0.93"');
    expect(readPersistedUpdateFloor()).toBe('0.93');
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['corrupt JSON', 'not json {', 'corrupt'],
    ['a non-string', '0.93', 'not_version'],
    ['an incomparable string', '"v0.93-beta"', 'not_version'],
    ['null', 'null', 'not_version'],
  ])('removes %s, warns once, and reads null', (_label, raw, detail) => {
    localStorage.setItem(KEY, raw);
    expect(readPersistedUpdateFloor()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();

    // The second boot finds nothing to warn about.
    expect(readPersistedUpdateFloor()).toBeNull();
    const warned = events('persisted_invalid');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({
      level: 'warn',
      context: { action: 'persisted_invalid', detail },
    });
  });

  it('carries the removal error when the bad record cannot be removed', () => {
    localStorage.setItem(KEY, '"nope"');
    const boom = new Error('storage disabled');
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw boom;
    });
    expect(readPersistedUpdateFloor()).toBeNull();
    expect(events('persisted_invalid')[0]!.error).toBe(boom);
  });
});

describe('persistUpdateFloor', () => {
  it('warns persist_refused on a refused write and does not throw', () => {
    const boom = new Error('QuotaExceededError');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw boom;
    });
    expect(() => persistUpdateFloor('0.93')).not.toThrow();
    const refused = events('persist_refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ level: 'warn', error: boom });
  });
});
