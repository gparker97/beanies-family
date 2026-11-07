/**
 * The dev-only daily fetch budget (#143) against happy-dom's localStorage: grants up to the cap
 * per UTC day, persists across "reloads", resets at UTC midnight, and fails closed to a fresh
 * day's count on a corrupt record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STORAGE_KEYS } from '@/constants/storageKeys';
import { DEV_DAILY_FETCH_CAP, devFetchBudgetActive, takeDevFetchTokens } from '../devFetchBudget';

const DAY = Date.parse('2026-12-12T09:00:00Z');
const NEXT_DAY = Date.parse('2026-12-13T00:00:01Z');

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('takeDevFetchTokens', () => {
  it('grants up to the cap across calls and persists the count', () => {
    expect(takeDevFetchTokens(4, DAY)).toEqual({ granted: 4, used: 4, cap: DEV_DAILY_FETCH_CAP });
    expect(takeDevFetchTokens(4, DAY)).toEqual({ granted: 4, used: 8, cap: DEV_DAILY_FETCH_CAP });
    // Only two left: a batch of four is trimmed, not refused outright.
    expect(takeDevFetchTokens(4, DAY)).toEqual({
      granted: 2,
      used: 10,
      cap: DEV_DAILY_FETCH_CAP,
    });
    expect(takeDevFetchTokens(1, DAY).granted).toBe(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.FLIGHT_STATUS_DEV_BUDGET)!)).toEqual({
      day: '2026-12-12',
      count: 10,
    });
  });

  it('a new UTC day starts a fresh count', () => {
    takeDevFetchTokens(DEV_DAILY_FETCH_CAP, DAY);
    expect(takeDevFetchTokens(1, DAY).granted).toBe(0);
    expect(takeDevFetchTokens(1, NEXT_DAY)).toMatchObject({ granted: 1, used: 1 });
  });

  it('a corrupt or foreign record counts as a fresh day, never as unlimited', () => {
    localStorage.setItem(STORAGE_KEYS.FLIGHT_STATUS_DEV_BUDGET, '{"day":"2026-12-12","count":"x"}');
    expect(takeDevFetchTokens(3, DAY)).toMatchObject({ granted: 3, used: 3 });
    localStorage.setItem(STORAGE_KEYS.FLIGHT_STATUS_DEV_BUDGET, 'not json');
    expect(takeDevFetchTokens(DEV_DAILY_FETCH_CAP + 5, DAY).granted).toBe(DEV_DAILY_FETCH_CAP);
  });

  it('a zero request spends nothing and writes nothing', () => {
    expect(takeDevFetchTokens(0, DAY)).toMatchObject({ granted: 0, used: 0 });
    expect(localStorage.getItem(STORAGE_KEYS.FLIGHT_STATUS_DEV_BUDGET)).toBeNull();
  });
});

describe('devFetchBudgetActive', () => {
  it('follows the build flag, read at call time', () => {
    vi.stubEnv('DEV', false);
    expect(devFetchBudgetActive()).toBe(false);
    vi.stubEnv('DEV', true);
    expect(devFetchBudgetActive()).toBe(true);
  });
});
