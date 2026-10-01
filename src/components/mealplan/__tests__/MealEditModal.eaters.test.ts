/**
 * Who's eating in the edit-meal drawer (#116): nobody stored has always meant everyone, so
 * the chips SHOW everyone picked, with the Clear / Everyone toggle switched on; saving with
 * everyone (or nobody) picked stores no `eaterMemberIds`, a subset stores the subset.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const h = vi.hoisted(() => ({
  updateMeal: vi.fn(async (_id: string, _patch: Record<string, unknown>) => ({})),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ humans: ['a', 'b', 'c'].map((id) => ({ id })) }),
}));
vi.mock('@/stores/mealPlanStore', () => ({
  useMealPlanStore: () => ({ updateMeal: h.updateMeal, deleteMeal: vi.fn() }),
}));
vi.mock('@/stores/recipesStore', () => ({
  useRecipesStore: () => ({ recipes: [], cookLogs: [], cookLogsByRecipe: () => ({ value: [] }) }),
}));
vi.mock('@/composables/useCardDefaultHint', () => ({
  useCardDefaultHint: () => ({ holderFor: () => undefined, holdsHint: () => '' }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import MealEditModal from '../MealEditModal.vue';

const MEAL = {
  id: 'm1',
  kind: 'eat_out',
  date: '2026-09-29',
  slot: 'dinner',
  position: 0,
  cooked: false,
  createdAt: 'x',
  updatedAt: 'x',
};

function mounted(meal: Record<string, unknown>) {
  return mount(MealEditModal, {
    props: { open: true, meal: meal as never },
    global: {
      stubs: {
        BeanieFormModal: { name: 'BeanieFormModal', template: '<div><slot /></div>' },
        FamilyChipPicker: {
          name: 'FamilyChipPicker',
          props: { modelValue: null, mode: String, allToggle: Boolean },
          emits: ['update:modelValue'],
          template: '<div />',
        },
        TimePresetPicker: true,
        TogglePillGroup: true,
        InferredHint: true,
        CookLogFormModal: true,
        RecipeFormModal: true,
        MealIngredientsPanel: true,
      },
    },
  });
}
const eaters = (w: ReturnType<typeof mounted>) =>
  w.findAllComponents({ name: 'FamilyChipPicker' }).find((c) => c.props('mode') === 'multi')!;
const save = async (w: ReturnType<typeof mounted>) => {
  w.findComponent({ name: 'BeanieFormModal' }).vm.$emit('save');
  await flushPromises();
  return h.updateMeal.mock.calls.at(-1)![1];
};

beforeEach(() => h.updateMeal.mockClear());

describe('MealEditModal who’s eating', () => {
  it('shows everyone picked when the meal stores no eaters, with the toggle on', async () => {
    const w = mounted(MEAL);
    await flushPromises();
    expect(eaters(w).props('modelValue')).toEqual(['a', 'b', 'c']);
    expect(eaters(w).props('allToggle')).toBe(true);
  });

  it('shows the stored subset, dropping members who left', async () => {
    const w = mounted({ ...MEAL, eaterMemberIds: ['b', 'gone'] });
    await flushPromises();
    expect(eaters(w).props('modelValue')).toEqual(['b']);
  });

  it('saving with everyone picked stores no eaterMemberIds', async () => {
    const w = mounted(MEAL);
    await flushPromises();
    expect((await save(w)).eaterMemberIds).toBeUndefined();
  });

  it('Clear then Save also stores everyone', async () => {
    const w = mounted(MEAL);
    eaters(w).vm.$emit('update:modelValue', []);
    expect((await save(w)).eaterMemberIds).toBeUndefined();
  });

  it('a subset saves the subset', async () => {
    const w = mounted(MEAL);
    eaters(w).vm.$emit('update:modelValue', ['a', 'c']);
    expect((await save(w)).eaterMemberIds).toEqual(['a', 'c']);
  });

  describe('snapshot diff', () => {
    const FULL = { ...MEAL, label: 'Pizza night', note: 'extra cheese', serveTime: '18:00' };

    it('an edit writes only the changed fields', async () => {
      const w = mounted(FULL);
      await flushPromises();
      eaters(w).vm.$emit('update:modelValue', ['a', 'c']);
      expect(await save(w)).toEqual({ eaterMemberIds: ['a', 'c'] });
    });

    it('an untouched save writes an empty patch, so a concurrent edit is not clobbered', async () => {
      const w = mounted(FULL);
      await flushPromises();
      expect(await save(w)).toEqual({});
    });
  });
});
