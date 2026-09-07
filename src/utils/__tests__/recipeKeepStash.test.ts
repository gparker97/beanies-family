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
} from '../recipeKeepStash';
import type { SharedRecipeFields } from '../recipeShareLink';

const FIELDS: SharedRecipeFields = { name: 'Cake', ingredients: ['flour'], steps: ['bake'] };

beforeEach(() => {
  localStorage.clear();
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
    spy.mockRestore();
    warn.mockRestore();
  });

  it('treats a corrupt envelope as nothing, and clears it', () => {
    localStorage.setItem('beanies_kept_recipe', '{not json');
    expect(consumeKeptRecipe()).toBeNull();
    expect(hasPendingKeptRecipe()).toBe(false);
  });

  it('clears on demand', () => {
    stashKeptRecipe(FIELDS);
    clearKeptRecipe();
    expect(hasPendingKeptRecipe()).toBe(false);
  });
});
