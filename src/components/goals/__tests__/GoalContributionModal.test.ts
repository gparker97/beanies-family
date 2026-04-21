import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import GoalContributionModal from '@/components/goals/GoalContributionModal.vue';
import type { Goal } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const contributeMock = vi.fn(async () => ({
  success: true,
  contributionId: 'c-new',
  appliedDelta: 100,
}));
vi.mock('@/composables/useContributeToGoal', () => ({
  useContributeToGoal: () => ({ contribute: contributeMock }),
}));

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g-1',
    memberId: 'member-1',
    name: 'College Fund',
    type: 'savings',
    targetAmount: 1000,
    currentAmount: 500,
    currency: 'USD',
    priority: 'medium',
    isCompleted: false,
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    ...overrides,
  };
}

function mountModal(open = true, g: Goal | null = goal()) {
  return mount(GoalContributionModal, {
    props: { open, goal: g },
    global: {
      stubs: {
        BeanieFormModal: {
          template:
            '<div><slot /><button class="_save" :disabled="saveDisabled" @click="$emit(\'save\')">save</button></div>',
          props: [
            'open',
            'title',
            'saveLabel',
            'saveDisabled',
            'variant',
            'icon',
            'size',
            'saveGradient',
            'isSubmitting',
          ],
          emits: ['save', 'close'],
        },
        AmountInput: {
          template:
            '<input data-test="amount" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
          props: ['modelValue', 'placeholder'],
          emits: ['update:modelValue'],
        },
        BaseInput: {
          template:
            '<input data-test="note" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          props: ['modelValue', 'placeholder', 'maxlength'],
          emits: ['update:modelValue'],
        },
        FormFieldGroup: { template: '<div><slot /></div>' },
      },
    },
  });
}

describe('GoalContributionModal', () => {
  beforeEach(() => contributeMock.mockClear());

  it('save button is disabled when amount is empty', async () => {
    const wrapper = mountModal();
    const saveBtn = wrapper.get('._save').element as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('save button enables once amount > 0 is entered', async () => {
    const wrapper = mountModal();
    await wrapper.get('input[data-test="amount"]').setValue('100');
    const saveBtn = wrapper.get('._save').element as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it('clicking save calls contribute with amount and optional note', async () => {
    const wrapper = mountModal();
    await wrapper.get('input[data-test="amount"]').setValue('150');
    await wrapper.get('input[data-test="note"]').setValue('  birthday money  ');
    await wrapper.get('._save').trigger('click');
    expect(contributeMock).toHaveBeenCalledWith('g-1', {
      amount: 150,
      note: 'birthday money',
    });
  });

  it('clicking save without note passes note: undefined', async () => {
    const wrapper = mountModal();
    await wrapper.get('input[data-test="amount"]').setValue('50');
    await wrapper.get('._save').trigger('click');
    expect(contributeMock).toHaveBeenCalledWith('g-1', {
      amount: 50,
      note: undefined,
    });
  });

  it('successful save emits contribution-added + close', async () => {
    const wrapper = mountModal();
    await wrapper.get('input[data-test="amount"]').setValue('50');
    await wrapper.get('._save').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('contribution-added')?.[0]).toEqual(['c-new']);
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('resets form state when modal opens', async () => {
    const wrapper = mountModal(false);
    await wrapper.setProps({ open: true });
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    const amountEl = wrapper.get('input[data-test="amount"]').element as HTMLInputElement;
    expect(amountEl.value).toBe('');
  });
});
