import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TripDatesInput from '../TripDatesInput.vue';
import BeanieDatePicker from '../BeanieDatePicker.vue';
import FormFieldGroup from '../FormFieldGroup.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('TripDatesInput', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function factory(startDate = '', endDate = '') {
    return mount(TripDatesInput, {
      props: { startDate, endDate },
    });
  }

  describe('validity', () => {
    it('emits isValid=false on mount when both dates are empty', () => {
      const wrapper = factory();
      expect(wrapper.emitted('update:isValid')?.at(-1)).toEqual([false]);
    });

    it('emits isValid=true when both dates are set and end ≥ start', async () => {
      const wrapper = factory('2026-06-01', '2026-06-10');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:isValid')?.at(-1)).toEqual([true]);
    });

    it('emits isValid=true for a same-day trip (end = start)', async () => {
      const wrapper = factory('2026-06-01', '2026-06-01');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:isValid')?.at(-1)).toEqual([true]);
    });

    it('emits isValid=false when end is before start', async () => {
      const wrapper = factory('2026-06-10', '2026-06-01');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:isValid')?.at(-1)).toEqual([false]);
    });

    it('emits isValid=false when only one date is set', async () => {
      const wrapper = factory('2026-06-10', '');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:isValid')?.at(-1)).toEqual([false]);
    });
  });

  describe('error messages', () => {
    it('emits null errorMessage on a completely empty form (no shouting)', async () => {
      const wrapper = factory();
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:errorMessage')?.at(-1)).toEqual([null]);
    });

    it('emits errorMissing when only one date is set', async () => {
      const wrapper = factory('2026-06-10', '');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:errorMessage')?.at(-1)).toEqual(['travel.dates.errorMissing']);
    });

    it('emits errorEndBeforeStart when end < start', async () => {
      const wrapper = factory('2026-06-10', '2026-06-01');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:errorMessage')?.at(-1)).toEqual([
        'travel.dates.errorEndBeforeStart',
      ]);
    });

    it('renders the error message inline with role="alert"', async () => {
      const wrapper = factory('2026-06-10', '2026-06-01');
      await wrapper.vm.$nextTick();
      const alert = wrapper.find('[role="alert"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('travel.dates.errorEndBeforeStart');
    });

    it('emits a unique error id with the trip-dates-error- prefix', async () => {
      const wrapper = factory('2026-06-10', '2026-06-01');
      await wrapper.vm.$nextTick();
      const alert = wrapper.find('[role="alert"]');
      expect(alert.attributes('id')).toMatch(/^trip-dates-error-/);
    });
  });

  describe('error prop (parent tried to save with empty dates)', () => {
    function groupErrors(wrapper: ReturnType<typeof factory>) {
      return wrapper.findAllComponents(FormFieldGroup).map((g) => g.props('error'));
    }

    it('marks the empty start, not the filled end, with or without a Save attempt', async () => {
      const wrapper = mount(TripDatesInput, { props: { startDate: '', endDate: '2026-06-05' } });
      await wrapper.vm.$nextTick();
      expect(groupErrors(wrapper)).toEqual([true, false]);
      await wrapper.setProps({ error: true });
      expect(groupErrors(wrapper)).toEqual([true, false]);
    });

    it('marks only the empty date when one is filled', async () => {
      const wrapper = mount(TripDatesInput, {
        props: { startDate: '2026-06-01', endDate: '', error: true },
      });
      await wrapper.vm.$nextTick();
      expect(groupErrors(wrapper)).toEqual([false, true]);
    });

    it('marks both date groups and says the dates are missing when error is set', async () => {
      const wrapper = mount(TripDatesInput, {
        props: { startDate: '', endDate: '', error: true },
      });
      await wrapper.vm.$nextTick();
      expect(groupErrors(wrapper)).toEqual([true, true]);
      expect(wrapper.find('[role="alert"]').text()).toContain('travel.dates.errorMissing');
      expect(wrapper.emitted('update:errorMessage')?.at(-1)).toEqual(['travel.dates.errorMissing']);
    });

    it('stays quiet on empty dates when error is absent', async () => {
      const wrapper = factory();
      await wrapper.vm.$nextTick();
      expect(groupErrors(wrapper)).toEqual([false, false]);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('clears the empty-state message once error goes back to false', async () => {
      const wrapper = mount(TripDatesInput, {
        props: { startDate: '', endDate: '', error: true },
      });
      await wrapper.setProps({ error: false });
      expect(groupErrors(wrapper)).toEqual([false, false]);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });
  });

  describe('quick-add chips', () => {
    // Quick-add chips carry aria-disabled so they can be scoped tightly
    // alongside the BeanieDatePicker trigger buttons.
    function quickAddChips(wrapper: ReturnType<typeof factory>) {
      return wrapper.findAll('button[aria-disabled]');
    }

    it('disables all chips when start is empty', () => {
      const wrapper = factory();
      const chips = quickAddChips(wrapper);
      expect(chips.length).toBe(3);
      for (const chip of chips) {
        expect(chip.attributes('disabled')).toBeDefined();
        expect(chip.attributes('aria-disabled')).toBe('true');
      }
    });

    it('enables chips when a start date is set', async () => {
      const wrapper = factory('2026-06-01', '');
      await wrapper.vm.$nextTick();
      const chips = quickAddChips(wrapper);
      for (const chip of chips) {
        expect(chip.attributes('disabled')).toBeUndefined();
      }
    });

    it('+3 days chip emits end = start + 3', async () => {
      const wrapper = factory('2026-06-01', '');
      await wrapper.vm.$nextTick();
      const chips = quickAddChips(wrapper);
      await chips[0]!.trigger('click');
      expect(wrapper.emitted('update:endDate')?.at(-1)).toEqual(['2026-06-04']);
    });

    it('+1 week chip emits end = start + 7', async () => {
      const wrapper = factory('2026-06-01', '');
      await wrapper.vm.$nextTick();
      const chips = quickAddChips(wrapper);
      await chips[1]!.trigger('click');
      expect(wrapper.emitted('update:endDate')?.at(-1)).toEqual(['2026-06-08']);
    });

    it('+2 weeks chip emits end = start + 14', async () => {
      const wrapper = factory('2026-06-01', '');
      await wrapper.vm.$nextTick();
      const chips = quickAddChips(wrapper);
      await chips[2]!.trigger('click');
      expect(wrapper.emitted('update:endDate')?.at(-1)).toEqual(['2026-06-15']);
    });
  });

  describe('summary', () => {
    it('renders the live summary once both dates are valid', async () => {
      const wrapper = factory('2026-06-01', '2026-06-10');
      await wrapper.vm.$nextTick();
      const html = wrapper.html();
      expect(html).toContain('2026-06-01');
      expect(html).toContain('2026-06-10');
      expect(html).toContain('10'); // duration
      expect(html).toContain('travel.dates.dayLabelPlural');
    });

    it('uses singular day label for a 1-day trip', async () => {
      const wrapper = factory('2026-06-01', '2026-06-01');
      await wrapper.vm.$nextTick();
      expect(wrapper.html()).toContain('travel.dates.dayLabelSingular');
    });

    it('does not render summary while invalid', async () => {
      const wrapper = factory('2026-06-10', '2026-06-01');
      await wrapper.vm.$nextTick();
      expect(wrapper.html()).not.toContain('dayLabel');
    });
  });

  describe('two-way binding', () => {
    it('emits update:startDate when the start picker emits a new value', async () => {
      const wrapper = factory();
      const pickers = wrapper.findAllComponents(BeanieDatePicker);
      pickers[0]!.vm.$emit('update:modelValue', '2026-06-15');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:startDate')?.at(-1)).toEqual(['2026-06-15']);
    });

    it('emits update:endDate when the end picker emits a new value', async () => {
      const wrapper = factory();
      const pickers = wrapper.findAllComponents(BeanieDatePicker);
      pickers[1]!.vm.$emit('update:modelValue', '2026-06-20');
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted('update:endDate')?.at(-1)).toEqual(['2026-06-20']);
    });
  });
});
