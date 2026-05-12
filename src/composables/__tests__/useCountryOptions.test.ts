import { describe, it, expect } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useCountryOptions } from '@/composables/useCountryOptions';
import { COUNTRIES } from '@/constants/countries';

describe('useCountryOptions', () => {
  it('returns a "Not set" sentinel first, then every country (alpha-sorted), with rich rendering', () => {
    setActivePinia(createPinia()); // useTranslation reaches into stores
    const { countryOptions } = useCountryOptions();
    const opts = countryOptions.value;

    // Leading sentinel.
    expect(opts[0]!.value).toBe('');

    // One option per country, in the same order COUNTRIES is sorted (by name).
    expect(opts.length).toBe(COUNTRIES.length + 1);
    expect(opts.slice(1).map((o) => o.value)).toEqual(COUNTRIES.map((c) => c.code));

    // Searchable label includes the code; rich rendering carries the flag + badge.
    const sg = opts.find((o) => o.value === 'SG')!;
    expect(sg.label).toContain('SG');
    expect(sg.label).toContain('Singapore');
    expect(sg.rich?.badge).toBe('SG');
    expect(sg.rich?.primary).toContain('Singapore');
  });
});
