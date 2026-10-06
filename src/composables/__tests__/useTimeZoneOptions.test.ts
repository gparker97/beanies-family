import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useTimeZoneOptions } from '@/composables/useTimeZoneOptions';
import type { CountryCode } from '@/types/models';

describe('useTimeZoneOptions', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('builds nothing until enabled', () => {
    const enabled = ref(false);
    const { timeZoneOptions } = useTimeZoneOptions(
      ref<CountryCode | null>(null),
      ref<string | undefined>('Asia/Singapore'),
      enabled
    );
    expect(timeZoneOptions.value).toEqual([]);
    enabled.value = true;
    expect(timeZoneOptions.value.length).toBeGreaterThan(0);
  });

  it('shapes a row as generic name + city, with city secondary and an offset badge', () => {
    const { timeZoneOptions } = useTimeZoneOptions(
      ref<CountryCode | null>(null),
      ref<string | undefined>('Asia/Singapore'),
      ref(true)
    );
    const sg = timeZoneOptions.value.find((o) => o.value === 'Asia/Singapore')!;
    expect(sg.label).toBe(`${sg.rich!.primary} · Singapore`);
    expect(sg.rich!.secondary).toBe('Singapore');
    expect(sg.rich!.badge).toMatch(/^GMT\+08:00$/);
    expect(sg.rich!.primary).toContain('Singapore');
  });

  it('turns underscores in the city into spaces', () => {
    const { timeZoneOptions } = useTimeZoneOptions(
      ref<CountryCode | null>(null),
      ref<string | undefined>('America/Los_Angeles'),
      ref(true)
    );
    const la = timeZoneOptions.value.find((o) => o.value === 'America/Los_Angeles')!;
    expect(la.rich!.secondary).toBe('Los Angeles');
  });

  it('always includes the current value, even an id this engine does not list', () => {
    const { timeZoneOptions } = useTimeZoneOptions(
      ref<CountryCode | null>(null),
      ref<string | undefined>('Mars/Olympus_Mons'),
      ref(true)
    );
    const row = timeZoneOptions.value.find((o) => o.value === 'Mars/Olympus_Mons')!;
    expect(row).toBeDefined();
    expect(row.label).toContain('Olympus Mons');
    expect(row.rich!.badge).toBe('');
  });

  it('memoises rows per (locale, zone)', () => {
    const args = [
      ref<CountryCode | null>(null),
      ref<string | undefined>('Asia/Tokyo'),
      ref(true),
    ] as const;
    const a = useTimeZoneOptions(...args).timeZoneOptions.value.find(
      (o) => o.value === 'Asia/Tokyo'
    );
    const b = useTimeZoneOptions(...args).timeZoneOptions.value.find(
      (o) => o.value === 'Asia/Tokyo'
    );
    expect(a).toBe(b);
  });

  it('rebuilds rows in a new hour, so a DST switch cannot leave stale offset badges', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-01T08:30:00Z'));
      const args = [
        ref<CountryCode | null>(null),
        ref<string | undefined>('America/Los_Angeles'),
        ref(true),
      ] as const;
      const row = () =>
        useTimeZoneOptions(...args).timeZoneOptions.value.find(
          (o) => o.value === 'America/Los_Angeles'
        );
      const before = row();
      expect(before?.rich?.badge).toBe('GMT-07:00');
      vi.setSystemTime(new Date('2026-11-01T10:30:00Z')); // after the 09:00Z PDT -> PST switch
      const after = row();
      expect(after).not.toBe(before);
      expect(after?.rich?.badge).toBe('GMT-08:00');
    } finally {
      vi.useRealTimers();
    }
  });
});
