/**
 * `useTransactionCategoryGuess` (#152): the two-slot direction flip. Each direction remembers
 * one PICK; a flip puts the outgoing pick away (never a guess, never a category from the other
 * table) and shows the incoming one, then the guess runs from the description as usual.
 * `reset()` empties both slots, so a fill never swaps its own category and a reopen never
 * restores a previous session. Runs on the real keyword tables: "Coffee" is coffee and "Uber
 * ride" is taxi under Money Out; "Bonus" and "Salary" are salary under Money In.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';

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

import { useTransactionCategoryGuess } from '@/composables/useTransactionCategoryGuess';

let scope: EffectScope;
beforeEach(() => {
  scope = effectScope();
  logEvent.mockClear();
});
afterEach(() => scope.stop());

function setup() {
  const description = ref('');
  const category = ref('');
  const type = ref<'income' | 'expense'>('expense');
  const editing = ref(false);
  const guess = scope.run(() =>
    useTransactionCategoryGuess({
      kind: 'transaction',
      description,
      category,
      type: () => type.value,
      enabled: () => !editing.value,
      pickerEl: () => null,
    })
  )!;
  async function write(text: string) {
    description.value = text;
    await nextTick();
  }
  async function flip(next: 'income' | 'expense') {
    type.value = next;
    await nextTick();
  }
  /** A form's fill, as `onNew` / `onEdit` run it: reset first, direction, then category. */
  async function fill(next: 'income' | 'expense', id: string, edit: boolean) {
    guess.reset();
    editing.value = edit;
    type.value = next;
    category.value = id;
    await nextTick();
  }
  return { description, category, type, guess, write, flip, fill };
}

const actions = () => logEvent.mock.calls.map((c) => c[0].context.action);

describe('useTransactionCategoryGuess: the two-slot direction flip', () => {
  it('(a) a guess is never remembered: Coffee does not come back after a retype', async () => {
    const { category, guess, write, flip } = setup();
    await write('Coffee');
    expect(category.value).toBe('coffee');
    expect(guess.isGuess.value).toBe(true);
    await flip('income');
    expect(category.value).toBe('');
    await write('Uber ride');
    await flip('expense');
    expect(category.value).toBe('taxi');
    expect(guess.isGuess.value).toBe(true);
    expect(actions()).toEqual([]);
  });

  it('(a) with no expense guess for the new words, the category stays empty', async () => {
    const { category, write, flip } = setup();
    await write('Coffee');
    await flip('income');
    await write('Paycheck from work');
    await flip('expense');
    expect(category.value).toBe('');
  });

  it('(b) a hand pick over the guess comes back as a pick after a round trip', async () => {
    const { category, guess, write, flip } = setup();
    await write('Bonus lunch with team');
    expect(category.value).toBe('dining_out');
    guess.pick('entertainment');
    await flip('income');
    // The income guess may fill the empty category from the words.
    expect(category.value).toBe('salary');
    await flip('expense');
    expect(category.value).toBe('entertainment');
    expect(guess.isGuess.value).toBe(false);
    // Still a pick: further typing never moves it.
    await write('Coffee');
    expect(category.value).toBe('entertainment');
    expect(actions()).toEqual(['direction-slot-saved', 'direction-slot-restored']);
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'category-guess',
      message: 'category restored on direction flip',
      context: { kind: 'transaction', action: 'direction-slot-restored' },
    });
  });

  it('(b) the income guess written on the way is not remembered for income', async () => {
    const { category, write, flip, guess } = setup();
    await write('Bonus lunch with team');
    guess.pick('entertainment');
    await flip('income');
    await flip('expense');
    await write('Coffee');
    await flip('income');
    // Salary was the guess, not a pick: income shows what "Coffee" names there (nothing).
    expect(category.value).toBe('');
  });

  it('(c) an edit keeps its saved category through a flip and back', async () => {
    const { category, fill, flip } = setup();
    await fill('expense', 'groceries', true);
    await flip('income');
    expect(category.value).toBe('');
    await flip('expense');
    expect(category.value).toBe('groceries');
  });

  it('(c) a legacy or custom id on an edit survives the round trip too', async () => {
    const { category, fill, flip } = setup();
    await fill('expense', 'food', true);
    await flip('income');
    expect(category.value).toBe('');
    await flip('expense');
    expect(category.value).toBe('food');
  });

  it('(d) a pick from the other table never saves on the new direction', async () => {
    const { category, guess, write, flip } = setup();
    guess.pick('groceries');
    await flip('income');
    expect(category.value).toBe('');
    await write('Salary');
    expect(category.value).toBe('salary');
    expect(guess.isGuess.value).toBe(true);
  });

  it('(d) a category from the wrong table is never remembered for the outgoing direction', async () => {
    const { category, flip } = setup();
    // An outside write (a prefill) of an income category on an expense.
    category.value = 'salary';
    // It belongs to the incoming table, so the flip carries it over...
    await flip('income');
    expect(category.value).toBe('salary');
    // ...but it was never put away for expense: the flip back leaves nothing to restore.
    await flip('expense');
    expect(category.value).toBe('');
  });

  it('a mismatched record keeps its category when the flip corrects its direction', async () => {
    const { category, guess, fill, flip } = setup();
    // An income saved with Groceries by an older build that never cleared on a flip.
    await fill('income', 'groceries', true);
    await flip('expense');
    expect(category.value).toBe('groceries');
    expect(guess.isGuess.value).toBe(false);
    expect(actions()).toEqual([]);
    // From here it is an ordinary expense pick: put away on a flip, back on the flip back.
    await flip('income');
    expect(category.value).toBe('');
    await flip('expense');
    expect(category.value).toBe('groceries');
  });

  it('a pick dropped by a flip is logged; a guess or an empty category is not', async () => {
    const { category, guess, write, flip } = setup();
    await write('Coffee');
    await flip('income');
    await flip('expense');
    expect(actions()).toEqual([]);

    guess.pick('groceries');
    await flip('income');
    // An outside write of an expense category on the income; expense already holds Groceries.
    category.value = 'coffee';
    await flip('expense');
    expect(category.value).toBe('groceries');
    expect(actions()).toEqual([
      'direction-slot-saved',
      'direction-slot-restored',
      'direction-slot-dropped',
    ]);
    expect(logEvent).toHaveBeenLastCalledWith({
      level: 'info',
      surface: 'category-guess',
      message: 'picked category dropped on direction flip',
      context: { kind: 'transaction', action: 'direction-slot-dropped' },
    });
  });

  it('(e) a new form or an edit opening never clears or swaps its own category', async () => {
    const { category, type, fill } = setup();
    await fill('income', 'salary', false);
    expect(type.value).toBe('income');
    expect(category.value).toBe('salary');
    // The reused form opened for an expense edit: its direction write meets an empty category.
    await fill('expense', 'groceries', true);
    expect(category.value).toBe('groceries');
    expect(actions()).toEqual([]);
  });

  it('(f) a reopen never restores a previous session slot', async () => {
    const { category, guess, flip, fill } = setup();
    guess.pick('groceries');
    await flip('income');
    logEvent.mockClear();
    await fill('income', '', false);
    await flip('expense');
    expect(category.value).toBe('');
    expect(actions()).toEqual([]);
  });

  it('a reopen with the same words guesses again', async () => {
    const { category, guess, write, fill } = setup();
    await write('Coffee');
    expect(category.value).toBe('coffee');
    // Cancelled and reopened with the same prefill: nothing the guess reads has changed.
    await fill('expense', '', false);
    expect(category.value).toBe('coffee');
    expect(guess.isGuess.value).toBe(true);
    expect(guess.shown.value?.value).toBe('coffee');
  });

  it('an edit opened after a create never clears or guesses, whatever the words', async () => {
    const { category, guess, write, fill } = setup();
    await write('Coffee');
    await fill('expense', 'groceries', true);
    expect(category.value).toBe('groceries');
    expect(guess.shown.value).toBeNull();
    await fill('expense', '', true);
    expect(category.value).toBe('');
    expect(guess.shown.value).toBeNull();
  });

  it('a create opened with a loaded category keeps it as a pick', async () => {
    const { category, guess, write, fill } = setup();
    await write('Coffee');
    await fill('expense', 'groceries', false);
    expect(category.value).toBe('groceries');
    expect(guess.isGuess.value).toBe(false);
    await write('Uber ride');
    expect(category.value).toBe('groceries');
  });

  it('a hand-cleared category leaves nothing to restore', async () => {
    const { category, guess, flip } = setup();
    guess.pick('groceries');
    category.value = '';
    await flip('income');
    await flip('expense');
    expect(category.value).toBe('');
  });
});
