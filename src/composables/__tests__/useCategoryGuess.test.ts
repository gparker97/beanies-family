/**
 * The category guess rule (#152): a guess follows the words while it is still the guess, a
 * pick (by hand or any outside write) is never overridden, a deferred occasion is shown but
 * never written, a disabled form never writes, the hint and `pick` the forms bind, and the
 * `category-guess` event reports kept / changed / none against the final words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';

const reveal = vi.fn();
vi.mock('@/composables/useAttentionPulse', () => ({
  useAttentionPulse: () => ({ pulse: vi.fn(), reveal }),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

import { nextGuess, useCategoryGuess, type GuessState } from '@/composables/useCategoryGuess';
import { keywordSuggester } from '@/utils/keywordSuggest';
import { suggestActivityCategory } from '@/utils/categorySuggest';
import { isOccasionCategory } from '@/utils/occasions';

const hit = (value: string, word = value) => ({ value, word });
const NONE: GuessState = { written: null, pending: null };

describe('nextGuess', () => {
  it('a category the guess did not write is a pick: nothing changes, state clears', () => {
    expect(nextGuess('soccer', NONE, hit('softball'), false)).toEqual({ state: NONE });
    const guessed = { written: hit('softball'), pending: null };
    expect(nextGuess('soccer', guessed, hit('tennis'), false)).toEqual({ state: NONE });
    expect(nextGuess('soccer', { written: null, pending: hit('x') }, undefined, false)).toEqual({
      state: NONE,
    });
  });

  it('a hit on an empty category is written', () => {
    expect(nextGuess('', NONE, hit('softball'), false)).toEqual({
      state: { written: hit('softball'), pending: null },
      write: 'softball',
    });
  });

  it('a different hit replaces the guess; the same hit writes nothing', () => {
    const guessed = { written: hit('softball'), pending: null };
    expect(nextGuess('softball', guessed, hit('tennis'), false)).toEqual({
      state: { written: hit('tennis'), pending: null },
      write: 'tennis',
    });
    expect(nextGuess('softball', guessed, hit('softball', 'softballs'), false)).toEqual({
      state: { written: hit('softball', 'softballs'), pending: null },
    });
  });

  it('no hit clears a guessed category, and leaves an empty one alone', () => {
    const guessed = { written: hit('softball'), pending: null };
    expect(nextGuess('softball', guessed, undefined, false)).toEqual({ state: NONE, write: '' });
    expect(nextGuess('', { written: null, pending: hit('x') }, undefined, false)).toEqual({
      state: NONE,
    });
  });

  it('a deferred hit is pending, never written, and takes a previous guess off', () => {
    expect(nextGuess('', NONE, hit('anniversary'), true)).toEqual({
      state: { written: null, pending: hit('anniversary') },
    });
    const guessed = { written: hit('dining_out'), pending: null };
    expect(nextGuess('dining_out', guessed, hit('anniversary'), true)).toEqual({
      state: { written: null, pending: hit('anniversary') },
      write: '',
    });
  });

  it('an outside clear is not a pick: the next hit is written again', () => {
    const stale = { written: hit('softball'), pending: null };
    expect(nextGuess('', stale, hit('soccer'), false)).toEqual({
      state: { written: hit('soccer'), pending: null },
      write: 'soccer',
    });
  });
});

const TABLE = keywordSuggester<string>([
  { value: 'softball', words: ['softball'] },
  { value: 'soccer', words: ['soccer'] },
  { value: 'dining_out', words: ['dinner'] },
  { value: 'rent', words: ['rent'] },
]);
const INCOME = keywordSuggester<string>([{ value: 'rental', words: ['rent'] }]);

let scope: EffectScope;

beforeEach(() => {
  scope = effectScope();
  reveal.mockClear();
  logEvent.mockClear();
});

afterEach(() => {
  scope.stop();
  vi.restoreAllMocks();
});

function setup(
  opts: {
    suggest?: (text: string) => { value: string; word: string } | undefined;
    defer?: (id: string) => boolean;
    pickerEl?: HTMLElement | null;
    write?: (id: string) => void;
  } = {}
) {
  const text = ref('');
  const category = ref('');
  const enabled = ref(true);
  const el = 'pickerEl' in opts ? opts.pickerEl : document.createElement('div');
  const guess = scope.run(() =>
    useCategoryGuess({
      kind: 'activity',
      text,
      category,
      suggest: opts.suggest ?? ((t) => TABLE.suggest(t)),
      enabled: () => enabled.value,
      defer: opts.defer,
      pickerEl: () => el,
      describe: (id) => ({ icon: `icon:${id}`, label: `label:${id}` }),
      write: opts.write,
    })
  )!;
  async function type(value: string) {
    text.value = value;
    await nextTick();
  }
  return { text, category, enabled, guess, type, el };
}

describe('useCategoryGuess: the guess follows the words', () => {
  it('guesses as the words are typed, and shows the guess with its word', async () => {
    const { category, guess, type } = setup();
    await type('Softball practice');
    expect(category.value).toBe('softball');
    expect(guess.shown.value).toEqual(hit('softball'));
  });

  it('a different match replaces the guess; no match clears it', async () => {
    const { category, guess, type } = setup();
    await type('Softball');
    await type('Soccer');
    expect(category.value).toBe('soccer');
    await type('Meeting');
    expect(category.value).toBe('');
    expect(guess.shown.value).toBeNull();
  });
});

describe('useCategoryGuess: a pick is never overridden', () => {
  it('a pick by hand survives any further typing', async () => {
    const { category, guess, type } = setup();
    await type('Softball');
    category.value = 'soccer';
    guess.markPicked();
    expect(guess.shown.value).toBeNull();
    await type('Softball practice');
    await type('Meeting');
    expect(category.value).toBe('soccer');
  });

  it('an outside write is a pick by value, with no call needed (a prefill)', async () => {
    const { text, category, guess } = setup();
    // `onNew` with a prefill sets both in one tick; the guess runs after and sees a pick.
    text.value = 'Softball practice';
    category.value = 'soccer';
    await nextTick();
    expect(category.value).toBe('soccer');
    expect(guess.shown.value).toBeNull();
  });

  it('an outside write over a guess (a linked activity) is a pick by value', async () => {
    const { category, guess, type } = setup();
    await type('Softball');
    category.value = 'tennis';
    expect(guess.shown.value).toBeNull();
    await type('Meeting');
    expect(category.value).toBe('tennis');
  });

  it('an outside clear is not a pick: typing guesses again', async () => {
    const { category, type } = setup();
    await type('Softball');
    category.value = '';
    await type('Soccer');
    expect(category.value).toBe('soccer');
  });

  it('a same-value outside write followed by markPicked sticks (a tap on the guessed chip)', async () => {
    const { category, guess, type } = setup();
    await type('Softball');
    category.value = 'softball';
    guess.markPicked();
    expect(guess.shown.value).toBeNull();
    await type('Meeting');
    expect(category.value).toBe('softball');
  });

  it('without markPicked a same-value write still reads as the guess (why the call exists)', async () => {
    const { category, type } = setup();
    await type('Softball');
    category.value = 'softball';
    await type('Meeting');
    expect(category.value).toBe('');
  });
});

describe('useCategoryGuess: the surface the forms bind', () => {
  it('hint describes the shown guess for v-bind, and is empty with nothing shown', async () => {
    const { guess, type } = setup();
    expect(guess.hint.value).toEqual({});
    await type('Softball practice');
    expect(guess.hint.value).toEqual({
      icon: 'icon:softball',
      label: 'label:softball',
      word: 'softball',
    });
    await type('Meeting');
    expect(guess.hint.value).toEqual({});
  });

  it('pick writes the category and is a pick, even for the guessed value', async () => {
    const { category, guess, type } = setup();
    await type('Softball');
    guess.pick('softball');
    expect(category.value).toBe('softball');
    expect(guess.hint.value).toEqual({});
    await type('Meeting');
    expect(category.value).toBe('softball');
  });

  it("pick goes through the form's own writer when it passes one", async () => {
    const write = vi.fn();
    const { category, guess, type } = setup({ write });
    await type('Softball');
    guess.pick('soccer');
    expect(write).toHaveBeenCalledWith('soccer');
    // The writer owns the write; the guess only stepped aside.
    expect(category.value).toBe('softball');
    expect(guess.shown.value).toBeNull();
  });
});

describe('useCategoryGuess: disabled and reset', () => {
  it('a disabled form never guesses', async () => {
    const { category, enabled, guess, type } = setup();
    enabled.value = false;
    await type('Softball');
    expect(category.value).toBe('');
    expect(guess.shown.value).toBeNull();
  });

  it('disabling never writes the category (the drawer reopened for an edit)', async () => {
    const { text, category, enabled, guess, type } = setup();
    await type('Softball practice');
    expect(category.value).toBe('softball');
    // `onEdit` on the same drawer: reset, edit mode, the saved values in one tick.
    guess.reset();
    enabled.value = false;
    text.value = 'Team photo';
    category.value = 'softball';
    await nextTick();
    expect(category.value).toBe('softball');
    expect(guess.shown.value).toBeNull();
    await type('Something else');
    expect(category.value).toBe('softball');
  });

  it('disabling clears the guess state without a reset, and still writes nothing', async () => {
    const { category, enabled, guess, type } = setup();
    await type('Softball');
    enabled.value = false;
    await type('');
    expect(category.value).toBe('softball');
    expect(guess.shown.value).toBeNull();
  });

  it('reset forgets the guess, so nothing shows after a reopen', async () => {
    const { guess, type } = setup();
    await type('Softball');
    guess.reset();
    expect(guess.shown.value).toBeNull();
  });

  it('reset guesses again for unchanged words (a reopen with the same prefill)', async () => {
    const { category, guess, type } = setup();
    await type('Softball');
    guess.reset();
    // The form's fill: the same words, an empty category.
    category.value = '';
    await nextTick();
    expect(category.value).toBe('softball');
    expect(guess.shown.value).toEqual(hit('softball'));
  });

  it('after reset, a category the fill loads is a pick, and a disabled form writes nothing', async () => {
    const { category, enabled, guess, type } = setup();
    await type('Softball');
    guess.reset();
    category.value = 'soccer';
    await nextTick();
    expect(category.value).toBe('soccer');
    expect(guess.shown.value).toBeNull();

    guess.reset();
    enabled.value = false;
    category.value = '';
    await nextTick();
    expect(category.value).toBe('');
    expect(guess.shown.value).toBeNull();
  });
});

describe('useCategoryGuess: transactions re-guess on a direction flip', () => {
  it('the same word gives the table for the direction, and a flip re-guesses', async () => {
    const direction = ref<'income' | 'expense'>('expense');
    const { category, type } = setup({
      suggest: (t) => (direction.value === 'income' ? INCOME : TABLE).suggest(t),
    });
    await type('Rent');
    expect(category.value).toBe('rent');
    direction.value = 'income';
    await nextTick();
    expect(category.value).toBe('rental');
  });
});

describe('useCategoryGuess: occasions are shown, never written', () => {
  const occasionSetup = () =>
    setup({ suggest: (t) => suggestActivityCategory(t), defer: isOccasionCategory });

  it('a deferred occasion leaves the category empty and shows the occasion', async () => {
    const { category, guess, type } = occasionSetup();
    await type("Mia's birthday");
    expect(category.value).toBe('');
    expect(guess.shown.value).toEqual(hit('occasion_birthday', 'birthday'));
  });

  it('typed on in one go, a birthday party settles on Birthday Party', async () => {
    const { category, guess, type } = occasionSetup();
    await type("Mia's birthday");
    await type("Mia's birthday party");
    expect(category.value).toBe('birthday');
    expect(guess.shown.value).toEqual(hit('birthday'));
  });

  it('an occasion takes a previous guess off, so picker and chip agree', async () => {
    const { category, guess, type } = occasionSetup();
    await type('Dinner');
    expect(category.value).toBe('dining_out');
    await type('Anniversary dinner');
    expect(category.value).toBe('');
    expect(guess.shown.value?.value).toBe('anniversary');
  });

  it('a pending guess asks the hint to hold the focus; a written one does not', async () => {
    const { guess, type } = occasionSetup();
    await type("Mia's birthday");
    expect(guess.hint.value.holdFocus).toBe(true);
    await type('Softball');
    expect(guess.hint.value).not.toHaveProperty('holdFocus');
  });

  it('once committed from outside (leaving the title), the occasion is a pick', async () => {
    const { category, guess, type } = occasionSetup();
    await type("Mia's birthday");
    // `onTitleCommit` -> `onCategoryPicked(match, 'title-match')`.
    category.value = 'occasion_birthday';
    expect(guess.shown.value).toBeNull();
    await type("Mia's birthday party");
    expect(category.value).toBe('occasion_birthday');
  });
});

describe('useCategoryGuess: Change declines a pending guess', () => {
  const occasionSetup = () =>
    setup({ suggest: (t) => suggestActivityCategory(t), defer: isOccasionCategory });

  it('Change on a pending occasion takes it away and declines deferred guesses', async () => {
    const { category, guess, type, el } = occasionSetup();
    await type("Mia's birthday");
    guess.revealPicker();
    expect(reveal).toHaveBeenCalledWith(el, 'attention-halo');
    expect(guess.declined.value).toBe(true);
    expect(guess.shown.value).toBeNull();
    expect(guess.hint.value).toEqual({});
    expect(category.value).toBe('');
    expect(logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'category-guess',
      message: 'pending guess declined',
      context: { kind: 'activity', action: 'declined' },
    });
    // Typed on, a deferred hit stays off; a non-deferred guess still works.
    await type("Mia's birthday!");
    expect(guess.shown.value).toBeNull();
    await type("Mia's birthday party");
    expect(category.value).toBe('birthday');
    await type("Mia's birthday");
    expect(category.value).toBe('');
    expect(guess.shown.value).toBeNull();
  });

  it('the decline is by value: a different occasion is guessed, the declined one stays off', async () => {
    const { category, guess, type } = occasionSetup();
    await type("Bob's birthday");
    guess.revealPicker();
    expect(guess.declined.value).toBe(true);
    await type("Mum and Dad's anniversary");
    expect(guess.declined.value).toBe(false);
    expect(guess.shown.value?.value).toBe('anniversary');
    expect(category.value).toBe('');
    await type("Jo's birthday");
    expect(guess.declined.value).toBe(true);
    expect(guess.shown.value).toBeNull();
  });

  it('every decline holds: declining a second occasion never brings back the first', async () => {
    const { category, guess, type } = occasionSetup();
    await type("Bob's birthday");
    guess.revealPicker();
    await type("Mum and Dad's anniversary");
    expect(guess.shown.value?.value).toBe('anniversary');
    guess.revealPicker();
    expect(guess.declined.value).toBe(true);
    await type("Bob's birthday");
    expect(guess.declined.value).toBe(true);
    expect(guess.shown.value).toBeNull();
    expect(guess.hint.value).toEqual({});
    await type("Mum and Dad's anniversary");
    expect(guess.declined.value).toBe(true);
    expect(guess.shown.value).toBeNull();
    expect(category.value).toBe('');
  });

  it('a hand pick works after a decline', async () => {
    const { category, guess, type } = occasionSetup();
    await type("Mia's birthday");
    guess.revealPicker();
    guess.pick('occasion_birthday');
    expect(category.value).toBe('occasion_birthday');
  });

  it('reset() clears the decline', async () => {
    const { guess, type } = occasionSetup();
    await type("Mia's birthday");
    guess.revealPicker();
    guess.reset();
    expect(guess.declined.value).toBe(false);
    await type("Jo's birthday");
    expect(guess.shown.value?.value).toBe('occasion_birthday');
  });

  it('Change on a written guess only reveals the picker', async () => {
    const { category, guess, type } = occasionSetup();
    await type('Softball');
    guess.revealPicker();
    expect(guess.declined.value).toBe(false);
    expect(category.value).toBe('softball');
    expect(guess.shown.value?.value).toBe('softball');
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('useCategoryGuess: logOutcome', () => {
  const logged = () => logEvent.mock.calls.map((c) => c[0]);

  it('kept: the saved category is the guess', async () => {
    const { guess, type } = setup();
    await type('Softball');
    guess.logOutcome();
    expect(logged()).toEqual([
      {
        level: 'info',
        surface: 'category-guess',
        message: 'submitted',
        context: { kind: 'activity', action: 'kept' },
      },
    ]);
  });

  it('none: a guess passed on the way is not a guess turned down ("Gas" to "Gaston")', async () => {
    const table = keywordSuggester<string>([{ value: 'gas', words: ['gas'] }]);
    const { guess, type } = setup({ suggest: (t) => table.suggest(t) });
    await type('Gas');
    await type("Gaston's party");
    guess.logOutcome();
    expect(logged()[0].context).toEqual({ kind: 'activity', action: 'none' });
  });

  it('changed: the words name a category and something else is saved', async () => {
    const { category, guess, type } = setup();
    await type('Softball');
    category.value = 'soccer';
    guess.markPicked();
    guess.logOutcome();
    expect(logged()[0].context).toEqual({ kind: 'activity', action: 'changed' });
  });

  it('none: the final words name nothing, whatever was guessed before', async () => {
    const { guess, type } = setup();
    await type('Softball');
    guess.reset();
    await type('Meeting');
    guess.logOutcome();
    expect(logged()[0].context).toEqual({ kind: 'activity', action: 'none' });
  });

  it('none: no guess was ever shown (a hand pick before typing)', async () => {
    const { guess, type } = setup();
    guess.pick('soccer');
    await type('Softball');
    guess.logOutcome();
    expect(logged()[0].context).toEqual({ kind: 'activity', action: 'none' });
  });

  it('none: a prefill the guess never touched, even when its words name something else', async () => {
    const { text, category, guess } = setup();
    text.value = 'Softball practice';
    category.value = 'soccer';
    await nextTick();
    guess.logOutcome();
    expect(logged()[0].context).toEqual({ kind: 'activity', action: 'none' });
  });

  it('logs nothing while disabled (an edit, a transfer)', () => {
    const { enabled, guess } = setup();
    enabled.value = false;
    guess.logOutcome();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('never logs the typed text, the word or the category', async () => {
    const { guess, type } = setup();
    await type('Softball practice');
    guess.logOutcome();
    expect(JSON.stringify(logged())).not.toMatch(/softball/i);
  });
});

describe('useCategoryGuess: revealPicker', () => {
  it('scrolls to and pulses the picker with the field-group halo', () => {
    const { guess, el } = setup();
    guess.revealPicker();
    expect(reveal).toHaveBeenCalledWith(el, 'attention-halo');
  });

  it('warns, to the console and the firehose, when the picker element is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { guess } = setup({ pickerEl: null });
    guess.revealPicker();
    expect(reveal).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith({
      level: 'warn',
      surface: 'category-guess',
      message: 'picker not found',
      context: { kind: 'activity' },
    });
  });
});
