/**
 * OptionSurvey: the shared single-question tile survey behind the create flow's "how did you
 * hear about us?" and the delete drawer's "why are you leaving?". Pins the `v-model` contract
 * both hosts depend on: `{ id }`, `{ id, text }` (trimmed) or `null` while nothing valid is
 * selected, emitted on every change.
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import OptionSurvey, {
  type OptionSurveyAnswer,
  type OptionSurveyOption,
} from '../OptionSurvey.vue';

const OPTIONS: OptionSurveyOption[] = [
  { id: 'a', label: 'Alpha', icon: '🅰️' },
  { id: 'b', label: 'Bravo', icon: '🅱️' },
  { id: 'feat', label: 'Feature', icon: '🧩', requiresText: true, textPlaceholder: 'Which?' },
  { id: 'other', label: 'Other', icon: '✨', requiresText: true, textPlaceholder: 'Tell us' },
];

/** Mounted like a `v-model` host: every emit is fed back as the new `modelValue`. */
function render(modelValue: OptionSurveyAnswer | null = null) {
  const wrapper: VueWrapper = mount(OptionSurvey, {
    props: {
      options: OPTIONS,
      modelValue,
      testidPrefix: 'q',
      'onUpdate:modelValue': (v: OptionSurveyAnswer | null) => {
        void wrapper.setProps({ modelValue: v });
      },
    },
  });
  return wrapper;
}

const emitted = (w: VueWrapper) =>
  (w.emitted('update:modelValue') ?? []).map((e) => e[0] as OptionSurveyAnswer | null);
const last = (w: VueWrapper) => emitted(w).at(-1);
const tile = (w: VueWrapper, id: string) => w.get(`[data-testid="q-opt-${id}"]`);
const input = (w: VueWrapper) => w.find('[data-testid="q-other-input"]');

describe('OptionSurvey', () => {
  it('renders every option in order with its label, icon and prefixed testid', () => {
    const w = render();
    const tiles = w.findAll('button');
    expect(tiles.map((b) => b.attributes('data-testid'))).toEqual([
      'q-opt-a',
      'q-opt-b',
      'q-opt-feat',
      'q-opt-other',
    ]);
    expect(tiles[0]!.text()).toContain('Alpha');
    expect(tiles[0]!.text()).toContain('🅰️');
    expect(tiles.every((b) => b.attributes('aria-pressed') === 'false')).toBe(true);
    expect(input(w).exists()).toBe(false);
  });

  it('emits { id } for an option without text and marks it pressed', async () => {
    const w = render();
    await tile(w, 'a').trigger('click');
    expect(last(w)).toEqual({ id: 'a' });
    expect(tile(w, 'a').attributes('aria-pressed')).toBe('true');
    expect(input(w).exists()).toBe(false);
  });

  it('is single-select: picking another option replaces the first', async () => {
    const w = render();
    await tile(w, 'a').trigger('click');
    await tile(w, 'b').trigger('click');
    expect(last(w)).toEqual({ id: 'b' });
    expect(tile(w, 'a').attributes('aria-pressed')).toBe('false');
  });

  it('tapping the selected option again clears it and emits null', async () => {
    const w = render();
    await tile(w, 'a').trigger('click');
    await tile(w, 'a').trigger('click');
    expect(last(w)).toBeNull();
    expect(tile(w, 'a').attributes('aria-pressed')).toBe('false');
  });

  it('a requiresText option emits null until its text is non-empty after trimming', async () => {
    const w = render();
    await tile(w, 'feat').trigger('click');
    expect(last(w)).toBeNull();
    // The tile stays picked although the answer is still null (the echo is not re-applied).
    expect(tile(w, 'feat').attributes('aria-pressed')).toBe('true');
    expect(input(w).exists()).toBe(true);

    await input(w).setValue('   ');
    expect(last(w)).toBeNull();
    await input(w).setValue('  meal plans  ');
    expect(last(w)).toEqual({ id: 'feat', text: 'meal plans' });
    await input(w).setValue('');
    expect(last(w)).toBeNull();
    expect(tile(w, 'feat').attributes('aria-pressed')).toBe('true');
  });

  it('shows the selected option’s own placeholder', async () => {
    const w = render();
    await tile(w, 'feat').trigger('click');
    expect(input(w).attributes('placeholder')).toBe('Which?');
    await tile(w, 'other').trigger('click');
    expect(input(w).attributes('placeholder')).toBe('Tell us');
  });

  it('keeps each text option’s typing separate', async () => {
    const w = render();
    await tile(w, 'feat').trigger('click');
    await input(w).setValue('calendar');
    await tile(w, 'other').trigger('click');
    expect((input(w).element as HTMLInputElement).value).toBe('');
    expect(last(w)).toBeNull();
    await tile(w, 'feat').trigger('click');
    expect((input(w).element as HTMLInputElement).value).toBe('calendar');
    expect(last(w)).toEqual({ id: 'feat', text: 'calendar' });
  });

  it('switching from a text option to a plain one emits { id } with no text', async () => {
    const w = render();
    await tile(w, 'other').trigger('click');
    await input(w).setValue('something');
    await tile(w, 'b').trigger('click');
    expect(last(w)).toEqual({ id: 'b' });
    expect(input(w).exists()).toBe(false);
  });

  it('adopts an initial value, text included (a remounted drawer keeps the answer)', () => {
    const w = render({ id: 'other', text: 'moving abroad' });
    expect(tile(w, 'other').attributes('aria-pressed')).toBe('true');
    expect((input(w).element as HTMLInputElement).value).toBe('moving abroad');
    expect(emitted(w)).toEqual([]);
  });

  it('adopts a host reset to null', async () => {
    const w = render();
    await tile(w, 'a').trigger('click');
    await w.setProps({ modelValue: null });
    expect(tile(w, 'a').attributes('aria-pressed')).toBe('false');
  });

  it('a host reset to null also forgets typed text, so a discarded answer cannot resurrect', async () => {
    const w = render();
    await tile(w, 'other').trigger('click');
    await input(w).setValue('abc');
    expect(last(w)).toEqual({ id: 'other', text: 'abc' });
    await w.setProps({ modelValue: null });
    expect(tile(w, 'other').attributes('aria-pressed')).toBe('false');
    // Re-picking the same tile starts empty: null until something is typed again.
    await tile(w, 'other').trigger('click');
    expect(last(w)).toBeNull();
    expect((input(w).element as HTMLInputElement).value).toBe('');
  });

  it('tap-to-clear forgets the tile’s typed text too (no resurrection on the next tap)', async () => {
    const w = render();
    await tile(w, 'other').trigger('click');
    await input(w).setValue('abc');
    expect(last(w)).toEqual({ id: 'other', text: 'abc' });
    await tile(w, 'other').trigger('click'); // deselect
    expect(last(w)).toBeNull();
    await tile(w, 'other').trigger('click'); // re-pick
    expect(last(w)).toBeNull();
    expect((input(w).element as HTMLInputElement).value).toBe('');
  });

  it('binds the host’s text cap to the input and leaves it off when none is given', async () => {
    const capped: OptionSurveyOption[] = [
      { id: 'x', label: 'X', icon: '✖️', requiresText: true, textMaxLength: 7 },
      { id: 'y', label: 'Y', icon: '✔️', requiresText: true },
    ];
    const w = mount(OptionSurvey, {
      props: { options: capped, modelValue: null, testidPrefix: 'q' },
    });
    await tile(w, 'x').trigger('click');
    expect(input(w).attributes('maxlength')).toBe('7');
    await tile(w, 'y').trigger('click');
    expect(input(w).attributes('maxlength')).toBeUndefined();
  });
});
