/**
 * The sign-up handoff. The properties that matter: single-consume, TTL, and never throwing
 * when storage is unavailable — a user in private mode must get a message, not a crash.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const telemetry = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: telemetry.fn }));

import {
  stashKeptRecipe,
  consumeKeptRecipe,
  hasPendingKeptRecipe,
  clearKeptRecipe,
  __resetKeptRecipeSessionForTests,
} from '../recipeKeepStash';
import type { SharedRecipeFields } from '../recipeShareLink';

const FIELDS: SharedRecipeFields = { name: 'Cake', ingredients: ['flour'], steps: ['bake'] };

beforeEach(() => {
  localStorage.clear();
  // ⚠️ REQUIRED. Single-consume is backed by module state, so without this reset a second
  // `consumeKeptRecipe()` in the file returns at the guard and never touches storage —
  // which silently turned two of the tests below into assertions about nothing.
  __resetKeptRecipeSessionForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

describe('recipeKeepStash', () => {
  it('round-trips a recipe', () => {
    expect(stashKeptRecipe(FIELDS)).toBe(true);
    expect(hasPendingKeptRecipe()).toBe(true);
    expect(consumeKeptRecipe()).toEqual(FIELDS);
  });

  it('consumes exactly once', () => {
    stashKeptRecipe(FIELDS);
    expect(consumeKeptRecipe()).toEqual(FIELDS);
    expect(consumeKeptRecipe()).toBeNull();
    expect(hasPendingKeptRecipe()).toBe(false);
  });

  it('returns null when nothing is waiting', () => {
    expect(consumeKeptRecipe()).toBeNull();
    expect(hasPendingKeptRecipe()).toBe(false);
  });

  it('expires after the TTL, and deletes the entry even when expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T10:00:00Z'));
    stashKeptRecipe(FIELDS);
    vi.setSystemTime(new Date('2026-09-07T11:30:00Z')); // 90 minutes later
    expect(consumeKeptRecipe()).toBeNull();
    // A stale recipe must not resurface later.
    expect(hasPendingKeptRecipe()).toBe(false);
    expect(telemetry.fn).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ action: 'keep_stash_lost' }) })
    );
  });

  it('reports false rather than throwing when storage refuses the write', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The caller routes the user on the strength of this boolean, so it must be honest.
    expect(stashKeptRecipe(FIELDS)).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(telemetry.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'keep_stash_write_failed' }),
      })
    );
    spy.mockRestore();
    warn.mockRestore();
  });

  it('survives a throwing read', () => {
    const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(consumeKeptRecipe()).toBeNull();
    expect(hasPendingKeptRecipe()).toBe(false);
    // The read must actually have been ATTEMPTED. Without this the test passes just as
    // happily when `consumeKeptRecipe` returns early at the session guard and never touches
    // storage at all — which is exactly what happened once.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });

  it('treats a corrupt envelope as nothing, and clears it', () => {
    localStorage.setItem('beanies_kept_recipe', '{not json');
    expect(consumeKeptRecipe()).toBeNull();
    expect(hasPendingKeptRecipe()).toBe(false);
    // "and clears it" — asserted, not assumed. `hasPendingKeptRecipe` returns false for a
    // corrupt envelope whether or not it was removed, so it cannot carry this on its own.
    expect(localStorage.getItem('beanies_kept_recipe')).toBeNull();
  });

  it('clears on demand', () => {
    stashKeptRecipe(FIELDS);
    clearKeptRecipe();
    expect(hasPendingKeptRecipe()).toBe(false);
  });
});

describe('the two agreements the routing decision depends on', () => {
  it('hasPendingKeptRecipe applies the SAME TTL as the consumer', () => {
    // A bare presence check would route someone to their cookbook, where the consumer then
    // finds the entry expired and opens nothing — a redirect they did not ask for.
    stashKeptRecipe({ name: 'Cake', ingredients: [], steps: [] });
    expect(hasPendingKeptRecipe()).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect(hasPendingKeptRecipe()).toBe(false);
    expect(consumeKeptRecipe()).toBeNull();
    vi.useRealTimers();
  });

  it('does NOT lose a recipe it already read when the delete throws', () => {
    // Safari private mode permits reads and throws on writes. A shared read/delete block
    // discarded a perfectly good recipe here, and left it in storage to surprise the user.
    stashKeptRecipe({ name: 'Cake', ingredients: ['flour'], steps: ['bake'] });
    const spy = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(consumeKeptRecipe()).toEqual({ name: 'Cake', ingredients: ['flour'], steps: ['bake'] });
    // ...and it is STILL consumed exactly once. The entry survives in storage because the
    // delete threw, so without the session guard the add form would re-open pre-filled on
    // every cookbook visit for the rest of the TTL.
    expect(consumeKeptRecipe()).toBeNull();
    spy.mockRestore();
  });

  it('lets a SECOND recipe be kept in the same session', () => {
    stashKeptRecipe({ name: 'First', ingredients: [], steps: [] });
    expect(consumeKeptRecipe()?.name).toBe('First');
    stashKeptRecipe({ name: 'Second', ingredients: [], steps: [] });
    expect(consumeKeptRecipe()?.name).toBe('Second');
  });
});
