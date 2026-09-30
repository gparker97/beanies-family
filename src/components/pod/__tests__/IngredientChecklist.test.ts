/**
 * The shared ingredient checklist (#116): tick, tick all, edit, add, hidden merged parts
 * and the line-extra slot. Every change is a NEW array (never an in-place mutation),
 * which is what lets `rebatchLines` tell a hand edit apart.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ChecklistLine } from '@/utils/mealShoppingList';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) =>
      ({
        'ingredients.include': 'Include {item}',
        'ingredients.edit': 'Edit {item}',
      })[k] ?? k,
  }),
}));

import IngredientChecklist from '../IngredientChecklist.vue';

const LINES: ChecklistLine[] = [
  {
    id: 'a',
    source: '500 g ground beef',
    text: '500 g ground beef (×3)',
    checked: true,
    recipeId: 'tacos',
    batches: 3,
  },
  {
    id: 'b',
    source: 'Two eggs',
    text: 'Two eggs (×3)',
    checked: true,
    recipeId: 'tacos',
    batches: 3,
  },
  {
    id: 'c',
    source: 'Salt, to taste',
    text: 'Salt, to taste (×3)',
    checked: true,
    recipeId: 'tacos',
    batches: 3,
  },
];

function mounted(lines: ChecklistLine[] = LINES, headingsSkipped = 0, extra = {}) {
  // The v-model loop a parent would close: every emitted array becomes the new prop.
  const w = mount(IngredientChecklist, {
    props: {
      modelValue: lines,
      headingsSkipped,
      'onUpdate:modelValue': (v: ChecklistLine[]) => w.setProps({ modelValue: v }),
      ...extra,
    },
    slots: {
      title: '<h3 data-testid="slot-title">Beef Tacos</h3>',
      'line-extra': `<template #line-extra="{ line }"><span data-testid="extra">{{ line.id }}</span></template>`,
    },
  });
  return w;
}

const current = (w: ReturnType<typeof mounted>) => w.props('modelValue') as ChecklistLine[];

describe('IngredientChecklist', () => {
  it('renders a row per line, with the title slot in the header', () => {
    const w = mounted();
    expect(w.findAll('[data-testid="ingredient-line"]')).toHaveLength(3);
    expect(w.find('[data-testid="slot-title"]').text()).toBe('Beef Tacos');
  });

  it('names each tick and each text box after its line', () => {
    const w = mounted();
    expect(w.findAllComponents({ name: 'TickButton' })[0]!.props('label')).toBe(
      'Include 500 g ground beef (×3)'
    );
    expect(w.findAll('[data-testid="ingredient-text"]')[0]!.attributes('aria-label')).toBe(
      'Edit 500 g ground beef (×3)'
    );
  });

  it('shows each line exactly as given, suffix included, with the line-extra slot under it', () => {
    const w = mounted();
    expect(
      w
        .findAll('[data-testid="ingredient-text"]')
        .map((n) => (n.element as HTMLTextAreaElement).value)
    ).toEqual(['500 g ground beef (×3)', 'Two eggs (×3)', 'Salt, to taste (×3)']);
    expect(w.findAll('[data-testid="extra"]').map((n) => n.text())).toEqual(['a', 'b', 'c']);
  });

  it('hides lines standing behind a merged line; tick-all only touches the visible ones', async () => {
    const lines = LINES.map((l) => (l.id === 'b' ? { ...l, mergedInto: 'm1' } : l));
    const w = mounted(lines);
    expect(w.findAll('[data-testid="ingredient-line"]')).toHaveLength(2);
    await w.find('[data-testid="ingredients-toggle-all"]').trigger('click');
    expect(current(w).map((l) => [l.id, l.checked])).toEqual([
      ['a', false],
      ['b', true], // hidden part: untouched
      ['c', false],
    ]);
  });

  it('a section whose every line is merged collapses to "All in More Than One Meal"', () => {
    const w = mounted(LINES.map((l) => ({ ...l, mergedInto: 'm1' })));
    expect(w.findAll('[data-testid="ingredient-line"]')).toHaveLength(0);
    expect(w.find('[data-testid="ingredients-toggle-all"]').exists()).toBe(false);
    expect(w.find('[data-testid="ingredients-all-merged"]').text()).toBe('ingredients.allMerged');
    expect(mounted().find('[data-testid="ingredients-all-merged"]').exists()).toBe(false);
  });

  it('addable=false drops the "Add an item" row', () => {
    expect(
      mounted(LINES, 0, { addable: false }).find('[data-testid="ingredient-add"]').exists()
    ).toBe(false);
    expect(mounted().find('[data-testid="ingredient-add"]').exists()).toBe(true);
  });

  it('unticks one line without touching the others (a new array)', async () => {
    const w = mounted();
    const before = current(w);
    await w.findAllComponents({ name: 'TickButton' })[1]!.vm.$emit('toggle');
    const after = current(w);
    expect(after).not.toBe(before);
    expect(after.map((l) => l.checked)).toEqual([true, false, true]);
    expect(before[1]!.checked).toBe(true); // never mutated in place
  });

  it('one toggle ticks or unticks every line, and its label says which way', async () => {
    const w = mounted();
    const toggle = () => w.find('[data-testid="ingredients-toggle-all"]');
    expect(toggle().text()).toBe('ingredients.untickAll');
    await toggle().trigger('click');
    expect(current(w).every((l) => !l.checked)).toBe(true);
    expect(toggle().text()).toBe('ingredients.tickAll');
    await toggle().trigger('click');
    expect(current(w).every((l) => l.checked)).toBe(true);
  });

  it('an edit changes only that line’s text; its source stays, so it reads as edited', async () => {
    const w = mounted();
    await w.findAll('[data-testid="ingredient-text"]')[0]!.setValue('1 kg ground beef');
    expect(current(w)[0]).toMatchObject({
      text: '1 kg ground beef',
      source: '500 g ground beef',
      batches: 3,
    });
    expect(current(w)[1]).toEqual(LINES[1]);
  });

  it('Enter in a line never adds a line break', async () => {
    const w = mounted();
    const ta = w.findAll('[data-testid="ingredient-text"]')[0]!;
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    ta.element.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Enter on an existing line finishes the edit: the field lets go and the text stays', async () => {
    const w = mount(IngredientChecklist, {
      attachTo: document.body,
      props: {
        modelValue: LINES,
        'onUpdate:modelValue': (v: ChecklistLine[]) => w.setProps({ modelValue: v }),
      },
    });
    const ta = w.findAll('[data-testid="ingredient-text"]')[1]!;
    (ta.element as HTMLTextAreaElement).focus();
    await ta.setValue('Three eggs');
    expect(document.activeElement).toBe(ta.element);
    await ta.trigger('keydown', { key: 'Enter' });
    expect(document.activeElement).not.toBe(ta.element);
    expect(current(w)[1]).toMatchObject({ text: 'Three eggs', source: 'Two eggs' });
    expect((ta.element as HTMLTextAreaElement).value).toBe('Three eggs');
    // An emptied line is not removed by Enter: it stays on screen and is dropped on save.
    (ta.element as HTMLTextAreaElement).focus();
    await ta.setValue('');
    await ta.trigger('keydown', { key: 'Enter' });
    expect(current(w)).toHaveLength(LINES.length);
    expect(current(w)[1]!.text).toBe('');
    w.unmount();
  });

  it('adds a typed line, ticked, on Enter; ignores a blank one', async () => {
    const w = mounted();
    const add = w.find('[data-testid="ingredient-add"]');
    await add.setValue('   ');
    await add.trigger('keydown', { key: 'Enter' });
    expect(current(w)).toHaveLength(3);
    await add.setValue('Tortillas');
    await add.trigger('keydown', { key: 'Enter' });
    const added = current(w)[3]!;
    expect(added).toMatchObject({ text: 'Tortillas', checked: true, batches: 1 });
    expect(added.source).toBeUndefined();
    expect((add.element as HTMLInputElement).value).toBe('');
  });

  it('adds what was typed when the field loses focus', async () => {
    const w = mounted();
    const add = w.find('[data-testid="ingredient-add"]');
    await add.setValue('Limes');
    await add.trigger('blur');
    expect(current(w).map((l) => l.text)).toContain('Limes');
  });

  it('says how many headings were skipped, and nothing when none were', () => {
    expect(mounted(LINES, 0).find('[data-testid="inferred-hint"]').exists()).toBe(false);
    expect(mounted(LINES, 1).find('[data-testid="inferred-hint"]').text()).toBe(
      'lists.fromRecipe.headingsSkipped.one'
    );
    expect(mounted(LINES, 2).find('[data-testid="inferred-hint"]').text()).toBe(
      'lists.fromRecipe.headingsSkipped.other'
    );
  });

  it('hides the tick-all toggle when there is nothing to tick', () => {
    expect(mounted([]).find('[data-testid="ingredients-toggle-all"]').exists()).toBe(false);
  });
});
