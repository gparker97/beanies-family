/** `useMonthGridPrefs` (#141): one spec table, one setter, one snapshot. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import {
  flippedPrefValue,
  MONTH_GRID_PREF_SPECS,
  useMonthGridPrefs,
  type MonthPrefChange,
  type MonthPrefValues,
} from '@/composables/useMonthGridPrefs';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { logEvent } from '@/services/telemetry/logEvent';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(logEvent).mockClear();
});

describe('useMonthGridPrefs', () => {
  it('defaults come from the spec table', () => {
    const { values } = useMonthGridPrefs();
    expect(values.value).toEqual({
      density: 'compact',
      times: 'shown',
      soloFaces: 'shown',
      phoneMode: 'grid',
      phoneDensity: 'titles',
    });
  });

  it('reads stored values and ignores an unknown stored one', () => {
    localStorage.setItem(STORAGE_KEYS.MONTH_GRID_DENSITY, 'comfortable');
    localStorage.setItem(STORAGE_KEYS.PHONE_MONTH_DENSITY, 'nonsense');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { values } = useMonthGridPrefs();
    expect(values.value.density).toBe('comfortable');
    expect(values.value.phoneDensity).toBe('titles');
  });

  it('setPref updates the snapshot and persists under the spec key', async () => {
    const { values, setPref } = useMonthGridPrefs();
    setPref({ name: 'density', value: 'comfortable' }, 'menu');
    setPref({ name: 'phoneMode', value: 'list' }, 'm_pill');
    await nextTick();
    expect(values.value.density).toBe('comfortable');
    expect(values.value.phoneMode).toBe('list');
    expect(localStorage.getItem(MONTH_GRID_PREF_SPECS.density.key)).toBe('comfortable');
    expect(localStorage.getItem(MONTH_GRID_PREF_SPECS.phoneMode.key)).toBe('list');
  });

  it('logs pref_changed with the name, value and origin', () => {
    const { setPref } = useMonthGridPrefs();
    setPref({ name: 'phoneDensity', value: 'faces' }, 'pinch');
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'calendar-month-grid',
      message: 'pref_changed',
      context: { action: 'pref_changed', kind: 'phoneDensity', detail: 'faces', stage: 'pinch' },
    });
  });

  it('names the Settings page as the origin of a change made there', () => {
    const { setPref } = useMonthGridPrefs();
    setPref({ name: 'phoneDensity', value: 'bars' }, 'settings');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'pref_changed',
        context: expect.objectContaining({
          kind: 'phoneDensity',
          detail: 'bars',
          stage: 'settings',
        }),
      })
    );
  });

  it('ignores an invalid value and logs invalid_pref_value', async () => {
    const { values, setPref } = useMonthGridPrefs();
    setPref({ name: 'times', value: 'bogus' } as unknown as MonthPrefChange, 'menu');
    await nextTick();
    expect(values.value.times).toBe('shown');
    expect(localStorage.getItem(STORAGE_KEYS.MONTH_GRID_TIMES)).toBeNull();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: 'invalid_pref_value',
        context: expect.objectContaining({ kind: 'times', stage: 'menu' }),
      })
    );
  });

  it('values is a computed snapshot that tracks later changes', () => {
    const { values, setPref } = useMonthGridPrefs();
    const first = values.value;
    setPref({ name: 'soloFaces', value: 'hidden' }, 'menu');
    expect(values.value.soloFaces).toBe('hidden');
    expect(first.soloFaces).toBe('shown');
  });
});

describe('flippedPrefValue', () => {
  const base: MonthPrefValues = {
    density: 'compact',
    times: 'shown',
    soloFaces: 'shown',
    phoneMode: 'grid',
    phoneDensity: 'titles',
  };

  it('returns the other value for each two-value spec', () => {
    expect(flippedPrefValue('times', base)).toBe('hidden');
    expect(flippedPrefValue('times', { ...base, times: 'hidden' })).toBe('shown');
    expect(flippedPrefValue('soloFaces', base)).toBe('hidden');
    expect(flippedPrefValue('soloFaces', { ...base, soloFaces: 'hidden' })).toBe('shown');
    expect(flippedPrefValue('phoneMode', base)).toBe('list');
    expect(flippedPrefValue('phoneMode', { ...base, phoneMode: 'list' })).toBe('grid');
  });
});
