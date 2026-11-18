/**
 * Quick add (#152): Description sits above Category so the category can be guessed from it,
 * the guess follows the direction, a hand pick sticks, and one `category-guess` event is logged
 * per save. The matcher is faked: this pins the form's wiring, not the keyword lists.
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    isEnglish: { value: true },
    isBeanieMode: { value: false },
  }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

vi.mock('@/utils/categorySuggest', () => ({
  suggestTransactionCategory: (text: string, type: 'income' | 'expense') =>
    /\brent\b/i.test(text)
      ? { value: type === 'income' ? 'rental' : 'rent', word: 'rent' }
      : undefined,
}));

import QuickAddTransactionModal from '@/components/budget/QuickAddTransactionModal.vue';
import CategoryGuessHint from '@/components/ui/CategoryGuessHint.vue';
import CategoryChipPicker from '@/components/ui/CategoryChipPicker.vue';
import { useAccountsStore } from '@/stores/accountsStore';

type Vm = {
  direction: 'expense' | 'income';
  description: string;
  amount: number | undefined;
  category: string;
  accountId: string;
  handleSave: () => void;
};

beforeEach(() => {
  setActivePinia(createPinia());
  logEvent.mockClear();
  useAccountsStore().accounts.push({
    id: 'account-1',
    memberId: 'member-1',
    name: 'Test Account',
    type: 'checking',
    currency: 'USD',
    balance: 1000,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
});

async function openQuickAdd() {
  const w = mount(QuickAddTransactionModal, {
    props: { open: false },
    global: { stubs: { BeanieFormModal: { template: '<div><slot /></div>' }, teleport: true } },
  });
  await w.setProps({ open: true });
  await nextTick();
  return { w, vm: w.vm as unknown as Vm };
}

/** A pick from the real picker, so the template wiring (`categoryGuess.pick`) is pinned. */
async function pick(w: Awaited<ReturnType<typeof openQuickAdd>>['w'], id: string) {
  w.findComponent(CategoryChipPicker).vm.$emit('update:modelValue', id);
  await nextTick();
}

const outcomes = () =>
  logEvent.mock.calls
    .map((c) => c[0] as { surface: string; message: string; context: Record<string, unknown> })
    .filter((e) => e.surface === 'category-guess' && e.message === 'submitted')
    .map((e) => e.context);

describe('QuickAddTransactionModal: category guess', () => {
  it('puts Description above Category', async () => {
    const { w } = await openQuickAdd();
    const labels = w.findAll('[data-form-label]').map((el) => el.attributes('data-form-label'));
    expect(labels.indexOf('budget.quickAdd.description')).toBeGreaterThan(
      labels.indexOf('budget.quickAdd.amount')
    );
    expect(labels.indexOf('budget.quickAdd.description')).toBeLessThan(
      labels.indexOf('budget.quickAdd.category')
    );
  });

  it('guesses from the description and re-guesses when the direction flips', async () => {
    const { w, vm } = await openQuickAdd();
    vm.description = 'Rent';
    await nextTick();
    expect(vm.category).toBe('rent');
    expect(w.findComponent(CategoryGuessHint).props('word')).toBe('rent');
    vm.direction = 'income';
    await nextTick();
    expect(vm.category).toBe('rental');
  });

  it('a hand pick survives further typing', async () => {
    const { w, vm } = await openQuickAdd();
    vm.description = 'Rent';
    await nextTick();
    await pick(w, 'rent');
    vm.description = 'Lunch';
    await nextTick();
    expect(vm.category).toBe('rent');
  });

  it('a flip clears a hand pick from the other table, and re-guesses from the new one', async () => {
    const { w, vm } = await openQuickAdd();
    await pick(w, 'groceries');
    vm.direction = 'income';
    await nextTick();
    expect(vm.category).toBe('');
    vm.description = 'Rent';
    await nextTick();
    expect(vm.category).toBe('rental');
  });

  it('with words typed, a flip that clears a pick guesses from the new table at once', async () => {
    const { w, vm } = await openQuickAdd();
    vm.description = 'Rent';
    await nextTick();
    await pick(w, 'groceries');
    vm.direction = 'income';
    await nextTick();
    expect(vm.category).toBe('rental');
  });

  it('a guess here never holds the focus (no phone keyboard kept up)', async () => {
    const { w, vm } = await openQuickAdd();
    vm.description = 'Rent';
    await nextTick();
    expect(w.findComponent(CategoryGuessHint).props('holdFocus')).toBeFalsy();
  });

  it('a reopen starts clean: the last session is neither cleared by the fill nor restored', async () => {
    const { w, vm } = await openQuickAdd();
    vm.direction = 'income';
    await pick(w, 'salary');
    await w.setProps({ open: false });
    await nextTick();
    logEvent.mockClear();
    await w.setProps({ open: true });
    await nextTick();
    expect(vm.direction).toBe('expense');
    expect(vm.category).toBe('');
    vm.direction = 'income';
    await nextTick();
    expect(vm.category).toBe('');
    expect(
      logEvent.mock.calls.some((c) => String(c[0].context?.action).startsWith('direction-slot'))
    ).toBe(false);
  });

  it('logs the outcome once per save', async () => {
    const { vm } = await openQuickAdd();
    vm.description = 'Rent';
    vm.amount = 12;
    await nextTick();
    vm.handleSave();
    expect(outcomes()).toEqual([{ kind: 'quick-add', action: 'kept' }]);
  });
});
