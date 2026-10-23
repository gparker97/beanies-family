/**
 * ExitReasonSurvey: the delete drawer's required "why are you leaving?" wrapper over
 * `OptionSurvey`. Pins the option list (the shared `EXIT_REASON_IDS`, in order), which ids take
 * free text and with which placeholder, and the `ExitReason` it hands the page.
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { EXIT_REASON_IDS, type ExitReason } from '@beanies/brand/exitReason';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ExitReasonSurvey from '../ExitReasonSurvey.vue';

function render(modelValue: ExitReason | null = null) {
  const wrapper: VueWrapper = mount(ExitReasonSurvey, {
    props: {
      modelValue,
      'onUpdate:modelValue': (v: ExitReason | null) => {
        void wrapper.setProps({ modelValue: v });
      },
    },
  });
  return wrapper;
}

const last = (w: VueWrapper) => (w.emitted('update:modelValue') ?? []).at(-1)?.[0];
const tile = (w: VueWrapper, id: string) => w.get(`[data-testid="exit-survey-opt-${id}"]`);
const input = (w: VueWrapper) => w.find('[data-testid="exit-survey-other-input"]');

describe('ExitReasonSurvey', () => {
  it('renders the heading and every exit reason, in the shared order, with its label', () => {
    const w = render();
    expect(w.text()).toContain('settings.deleteFamilyReasonTitle');
    const ids = w
      .findAll('button')
      .map((b) => b.attributes('data-testid')!.replace('exit-survey-opt-', ''));
    expect(ids).toEqual([...EXIT_REASON_IDS]);
    for (const id of EXIT_REASON_IDS) {
      expect(tile(w, id).text()).toContain(`settings.deleteFamilyReason.${id}`);
    }
  });

  it('a plain reason emits { id } straight away', async () => {
    const w = render();
    await tile(w, 'too_slow').trigger('click');
    expect(last(w)).toEqual({ id: 'too_slow' });
    expect(input(w).exists()).toBe(false);
  });

  it.each([
    ['missing_feature', 'settings.deleteFamilyReasonFeaturePlaceholder'],
    ['other', 'settings.deleteFamilyReasonOtherPlaceholder'],
  ])('%s requires text, with its own placeholder', async (id, placeholder) => {
    const w = render();
    await tile(w, id).trigger('click');
    expect(last(w)).toBeNull();
    expect(input(w).attributes('placeholder')).toBe(placeholder);
    await input(w).setValue('  shared shopping lists ');
    expect(last(w)).toEqual({ id, text: 'shared shopping lists' });
  });

  it('shows a reason the page already holds (the drawer reopened after a failed export)', () => {
    const w = render({ id: 'missing_feature', text: 'meal plans' });
    expect(tile(w, 'missing_feature').attributes('aria-pressed')).toBe('true');
    expect((input(w).element as HTMLInputElement).value).toBe('meal plans');
  });
  it('caps the free text at EXIT_REASON_TEXT_MAX on the text options only', async () => {
    const w = render();
    await w.get('[data-testid="exit-survey-opt-missing_feature"]').trigger('click');
    expect(w.get('[data-testid="exit-survey-other-input"]').attributes('maxlength')).toBe('200');
    await w.get('[data-testid="exit-survey-opt-other"]').trigger('click');
    expect(w.get('[data-testid="exit-survey-other-input"]').attributes('maxlength')).toBe('200');
    await w.get('[data-testid="exit-survey-opt-too_slow"]').trigger('click');
    expect(w.find('[data-testid="exit-survey-other-input"]').exists()).toBe(false);
  });
});
