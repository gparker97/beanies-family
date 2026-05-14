import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import BaseCombobox, { type ComboboxOption } from '../BaseCombobox.vue';

// Echo translation keys verbatim EXCEPT the cap-hint, which carries
// interpolation slots used by the component.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'combobox.showingHint') {
        return 'Showing {visible} of {total} — keep typing to narrow';
      }
      return key;
    },
  }),
}));

function makeOptions(count: number, prefix = 'Option'): ComboboxOption[] {
  return Array.from({ length: count }, (_, i) => ({
    value: `${prefix.toLowerCase()}-${i}`,
    label: `${prefix} ${i}`,
  }));
}

/** Mount with Teleport stubbed inline so wrapper.find() reaches the popover. */
function factory(options: ComboboxOption[], extraProps: Record<string, unknown> = {}) {
  return mount(BaseCombobox, {
    props: { modelValue: '', options, ...extraProps },
    global: { stubs: { teleport: true } },
  });
}

async function openDropdown(wrapper: VueWrapper) {
  await wrapper.find('[data-testid="combobox-trigger"]').trigger('click');
  await nextTick();
}

async function setSearch(wrapper: VueWrapper, value: string) {
  await wrapper.find('[data-testid="combobox-search"]').setValue(value);
  await nextTick();
}

function visibleOptionValues(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-testid^="combobox-option-"]')
    .map((el) => el.attributes('data-testid')!.replace('combobox-option-', ''));
}

describe('BaseCombobox — cap + exact-badge promotion', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders all options when total ≤ cap; no hint shown', async () => {
    const wrapper = factory(makeOptions(10));
    await openDropdown(wrapper);
    expect(visibleOptionValues(wrapper)).toHaveLength(10);
    expect(wrapper.find('[data-testid="combobox-cap-hint"]').exists()).toBe(false);
  });

  it('caps rendered options at maxVisibleResults (default 50) and shows the hint', async () => {
    const wrapper = factory(makeOptions(200));
    await openDropdown(wrapper);
    expect(visibleOptionValues(wrapper)).toHaveLength(50);
    const hint = wrapper.find('[data-testid="combobox-cap-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toMatch(/Showing 50 of 200/);
  });

  it('empty-query renders first 50 of a large (4046-style) list with hint', async () => {
    const wrapper = factory(makeOptions(4046));
    await openDropdown(wrapper);
    const values = visibleOptionValues(wrapper);
    expect(values).toHaveLength(50);
    expect(values[0]).toBe('option-0');
    expect(values[49]).toBe('option-49');
    expect(wrapper.find('[data-testid="combobox-cap-hint"]').text()).toMatch(/Showing 50 of 4046/);
  });

  it('exact rich.badge match (uppercase query) promotes that option to position 0', async () => {
    // Several airports with "sin" in the label, plus SIN (Singapore Changi)
    // whose entry sits later in the array than other "sin" substring matches.
    const options: ComboboxOption[] = [
      {
        value: 'NSI',
        label: 'Bissinghen Sinland (NSI)',
        rich: { primary: 'Bissinghen', badge: 'NSI' },
      },
      {
        value: 'XSI',
        label: 'Sincelejo Las Brujas (XSI)',
        rich: { primary: 'Sincelejo', badge: 'XSI' },
      },
      {
        value: 'SIN',
        label: 'Singapore - Singapore Changi (SIN)',
        rich: { primary: 'Singapore', badge: 'SIN' },
      },
      { value: 'SST', label: 'Singen Region (SST)', rich: { primary: 'Singen', badge: 'SST' } },
    ];
    const wrapper = factory(options);
    await openDropdown(wrapper);
    await setSearch(wrapper, 'SIN');
    expect(visibleOptionValues(wrapper)[0]).toBe('SIN');
  });

  it('exact rich.badge match (lowercase query) also promotes — case-insensitive', async () => {
    const options: ComboboxOption[] = [
      {
        value: 'NSI',
        label: 'Bissinghen Sinland (NSI)',
        rich: { primary: 'Bissinghen', badge: 'NSI' },
      },
      {
        value: 'SIN',
        label: 'Singapore - Singapore Changi (SIN)',
        rich: { primary: 'Singapore', badge: 'SIN' },
      },
      { value: 'SST', label: 'Singen Region (SST)', rich: { primary: 'Singen', badge: 'SST' } },
    ];
    const wrapper = factory(options);
    await openDropdown(wrapper);
    await setSearch(wrapper, 'sin');
    expect(visibleOptionValues(wrapper)[0]).toBe('SIN');
  });

  it('partial badge match does NOT promote (only exact equality)', async () => {
    // Query "SI" — no option has badgeUpper === 'SI', so no promotion.
    // NSI comes first in props.options, so without promotion it stays first.
    const options: ComboboxOption[] = [
      {
        value: 'NSI',
        label: 'Bissinghen Sinland (NSI)',
        rich: { primary: 'Bissinghen', badge: 'NSI' },
      },
      {
        value: 'SIN',
        label: 'Singapore - Singapore Changi (SIN)',
        rich: { primary: 'Singapore', badge: 'SIN' },
      },
    ];
    const wrapper = factory(options);
    await openDropdown(wrapper);
    await setSearch(wrapper, 'SI');
    const values = visibleOptionValues(wrapper);
    expect(values[0]).toBe('NSI');
    expect(values).toContain('SIN');
  });

  it('options without rich.badge behave as today: substring filter, no promotion', async () => {
    const options: ComboboxOption[] = [
      { value: 'apple', label: 'Apple' },
      { value: 'banana', label: 'Banana' },
      { value: 'apricot', label: 'Apricot' },
    ];
    const wrapper = factory(options);
    await openDropdown(wrapper);
    await setSearch(wrapper, 'ap');
    expect(visibleOptionValues(wrapper)).toEqual(['apple', 'apricot']);
  });
});
