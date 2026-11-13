/**
 * The block hours: seeded from the family's hours, out-of-order hours shown inline in Heritage
 * Orange (never red) with nothing written, valid hours written whole, unchanged hours closing
 * without a write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/choreStore', async () => (await import('./choreTestKit')).choreStoreModule);

import ChoreHoursModal from '../ChoreHoursModal.vue';
import { choreActions, chores, resetKit } from './choreTestKit';

const TimeStub = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  template: '<span class="time">{{ modelValue }}</span>',
});

const stubs = {
  BeanieFormModal: {
    props: ['open', 'saveReady', 'isSubmitting'],
    template:
      '<div v-if="open"><slot /><button data-testid="save" :data-ready="String(saveReady)" @click="$emit(\'save\')" /></div>',
  },
  BeanieTimePicker: TimeStub,
};

async function openModal(): Promise<VueWrapper> {
  const w = mount(ChoreHoursModal, { props: { open: false }, global: { stubs } });
  await w.setProps({ open: true });
  await flushPromises();
  return w;
}

async function setHour(w: VueWrapper, block: string, value: string) {
  w.get(`[data-block="${block}"]`).findComponent(TimeStub).vm.$emit('update:modelValue', value);
  await flushPromises();
}

beforeEach(() => {
  resetKit();
  chores.starts = { morning: '06:30', afternoon: '12:00', evening: '17:00' };
  choreActions.setBlockStarts.mockResolvedValue(true);
});

describe('ChoreHoursModal', () => {
  it('shows the family’s hours and Anytime as all day', async () => {
    const w = await openModal();
    const times = w.findAllComponents(TimeStub).map((c) => c.props('modelValue'));
    expect(times).toEqual(['06:30', '12:00', '17:00']);
    expect(w.get('[data-block="anytime"]').text()).toContain('choreboard.hoursModal.allDay');
  });

  it('out of order: the refusal inline in Heritage Orange, Save not ready, nothing written', async () => {
    const w = await openModal();
    await setHour(w, 'afternoon', '05:00');
    const refusal = w.get('[data-testid="chore-hours-refusal"]');
    expect(refusal.text()).toBe('choreboard.error.badHours');
    expect(refusal.classes()).toContain('text-primary-700');
    expect(refusal.classes()).toContain('dark:text-accent-lift');
    expect(refusal.classes().some((c) => c.includes('red'))).toBe(false);
    expect(w.get('[data-testid="save"]').attributes('data-ready')).toBe('false');
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(choreActions.setBlockStarts).not.toHaveBeenCalled();
  });

  it('valid hours are written whole by the session grown-up, then it closes', async () => {
    const w = await openModal();
    await setHour(w, 'evening', '18:00');
    expect(w.find('[data-testid="chore-hours-refusal"]').exists()).toBe(false);
    await w.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(choreActions.setBlockStarts).toHaveBeenCalledWith(
      { morning: '06:30', afternoon: '12:00', evening: '18:00' },
      'mom'
    );
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('unchanged: closes without a write; a store null stays open', async () => {
    const w = await openModal();
    await w.get('[data-testid="save"]').trigger('click');
    expect(choreActions.setBlockStarts).not.toHaveBeenCalled();
    expect(w.emitted('close')).toHaveLength(1);

    choreActions.setBlockStarts.mockResolvedValue(null);
    const again = await openModal();
    await setHour(again, 'morning', '07:00');
    await again.get('[data-testid="save"]').trigger('click');
    await flushPromises();
    expect(again.emitted('close')).toBeUndefined();
  });
});
