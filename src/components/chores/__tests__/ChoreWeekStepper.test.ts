/**
 * Stars and rewards (#148): the week stepper. It walks the list it is given and cannot leave it:
 * "next" is disabled on this week (and "Back to This Week" hidden), "previous" on the oldest
 * week; the middle button returns to this week; a value outside the list reads as this week.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composables/useTranslation', async () => {
  const { computed } = await import('vue');
  const { UI_STRINGS } = await import('@/services/translation/uiStrings');
  const strings = UI_STRINGS as Record<string, string>;
  return {
    useTranslation: () => ({
      t: (k: string) => strings[k] ?? k,
      currentLanguage: computed(() => 'en'),
    }),
  };
});
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ weekStartDay: 1 }) }));

import ChoreWeekStepper from '../ChoreWeekStepper.vue';

const WEEKS = ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19'];
const TODAY = '2026-11-19';

function stepper(modelValue: string) {
  return mount(ChoreWeekStepper, {
    props: { weeks: WEEKS, modelValue, todayYmd: TODAY },
    global: { stubs: { BeanieIcon: true } },
  });
}
const prev = (w: ReturnType<typeof stepper>) => w.get('[aria-label="Previous period"]');
const next = (w: ReturnType<typeof stepper>) => w.get('[aria-label="Next period"]');

describe('ChoreWeekStepper', () => {
  it('this week: labelled, next disabled, no Back to This Week; previous steps back one', async () => {
    const w = stepper(WEEKS[0]!);
    expect(w.get('[data-testid="chore-week-stepper-label"]').text()).toContain('This week');
    expect(next(w).attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="calendar-today"]').exists()).toBe(false);
    await prev(w).trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([['2026-11-09']]);
  });

  it('a week back: "Last week", next steps forward, Back to This Week returns', async () => {
    const w = stepper(WEEKS[1]!);
    expect(w.get('[data-testid="chore-week-stepper-label"]').text()).toContain('Last week');
    await next(w).trigger('click');
    const back = w.get('[data-testid="calendar-today"]');
    expect(back.text()).toBe('Back to This Week');
    await back.trigger('click');
    expect(w.emitted('update:modelValue')).toEqual([['2026-11-16'], ['2026-11-16']]);
  });

  it('the oldest week: previous is disabled, so it cannot leave its list', async () => {
    const w = stepper(WEEKS[4]!);
    expect(prev(w).attributes('disabled')).toBeDefined();
    await prev(w).trigger('click');
    expect(w.emitted('update:modelValue')).toBeUndefined();
    // An earlier week reads its dates, not a relative name.
    expect(w.get('[data-testid="chore-week-stepper-label"]').text()).not.toMatch(/week/i);
  });

  it('a value outside the list reads as this week', () => {
    const w = stepper('2026-09-07');
    expect(w.get('[data-testid="chore-week-stepper"]').attributes('data-week')).toBe('2026-11-16');
    expect(next(w).attributes('disabled')).toBeDefined();
  });
});
