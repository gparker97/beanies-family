/**
 * Servings is a NUMBER in the form and a digit STRING on disk (#116).
 *
 * The two guarantees that matter most: the stored value is always a string (pre-0.26 clients
 * call `.trim()` on it), and an untouched save never rewrites an old free-text value — a
 * "12 muffins" recipe edited for its name keeps "12 muffins".
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useRecipesStore } from '@/stores/recipesStore';
import type { Recipe } from '@/types/models';
import type { RecipePrefill } from '@/utils/recipeExtractionToRecipe';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));

function recipe(servings: string | undefined): Recipe {
  return {
    id: 'r1',
    name: 'Pumpkin Pie',
    ...(servings !== undefined ? { servings } : {}),
    ingredients: ['1 crust'],
    steps: ['bake'],
    createdAt: '2026-08-25',
    updatedAt: '2026-08-25',
  } as Recipe;
}

const STUBS = {
  BeanieFormModal: {
    props: ['saveDisabled', 'isSubmitting', 'showDelete', 'title'],
    template: '<div><slot /></div>',
  },
  PhotoAttachments: true,
  AiDocumentPicker: true,
  RecipeSourceStrip: true,
  DocumentExtractConsentModal: true,
};

async function mountModal(props: { recipe?: Recipe | null; prefill?: RecipePrefill | null }) {
  setActivePinia(createPinia());
  const store = useRecipesStore();
  store.recipes = props.recipe ? [props.recipe] : [];
  store.updateRecipe = vi.fn().mockResolvedValue(props.recipe);
  store.createRecipe = vi.fn().mockResolvedValue({ ...recipe(undefined), id: 'new' });
  const wrapper = mount(RecipeFormModal, {
    props: { open: false, recipe: null, prefill: null, ...props },
    global: { stubs: STUBS },
  });
  await wrapper.setProps({ open: true });
  await nextTick();
  return { wrapper, store };
}

type Wrapper = Awaited<ReturnType<typeof mountModal>>['wrapper'];

function servingsInput(wrapper: Wrapper) {
  return wrapper.get('[data-testid="recipe-servings"]');
}

async function rename(wrapper: Wrapper) {
  await wrapper.findAll('input[type="text"]')[0]!.setValue('Renamed Pie');
}

async function save(wrapper: Wrapper) {
  wrapper.findComponent(BeanieFormModal).vm.$emit('save');
  await nextTick();
  await nextTick();
}

function updatePatch(store: ReturnType<typeof useRecipesStore>): Record<string, unknown> {
  return vi.mocked(store.updateRecipe).mock.calls[0]![1] as Record<string, unknown>;
}

describe('RecipeFormModal — servings', () => {
  it('reads old free text as its people count', async () => {
    const { wrapper } = await mountModal({ recipe: recipe('Serves 4-6') });
    expect((servingsInput(wrapper).element as HTMLInputElement).value).toBe('4');
  });

  it('reads text with no people count as blank', async () => {
    const { wrapper } = await mountModal({ recipe: recipe('12 muffins') });
    expect((servingsInput(wrapper).element as HTMLInputElement).value).toBe('');
  });

  it('an untouched save of a "Serves 4-6" recipe does not write servings', async () => {
    const { wrapper, store } = await mountModal({ recipe: recipe('Serves 4-6') });
    await rename(wrapper);
    await save(wrapper);
    const patch = updatePatch(store);
    expect(patch.name).toBe('Renamed Pie');
    expect('servings' in patch).toBe(false);
  });

  it('an untouched save of a "12 muffins" recipe keeps its text', async () => {
    const { wrapper, store } = await mountModal({ recipe: recipe('12 muffins') });
    await rename(wrapper);
    await save(wrapper);
    expect('servings' in updatePatch(store)).toBe(false);
  });

  it('writes a changed count as a digit string, never a number', async () => {
    const { wrapper, store } = await mountModal({ recipe: recipe('Serves 4') });
    await wrapper.get('[data-testid="stepper-increase"]').trigger('click');
    await save(wrapper);
    const patch = updatePatch(store);
    expect(patch.servings).toBe('5');
    expect(typeof patch.servings).toBe('string');
  });

  it('clearing the count deletes it', async () => {
    const { wrapper, store } = await mountModal({ recipe: recipe('Serves 4') });
    await servingsInput(wrapper).setValue('');
    await save(wrapper);
    const patch = updatePatch(store);
    expect('servings' in patch).toBe(true);
    expect(patch.servings).toBeUndefined();
  });

  it('seeds the stepper from a capture prefill and creates with the digit string', async () => {
    const prefill: RecipePrefill = {
      fields: { name: 'Tacos', servings: '6', ingredients: ['tortillas'], steps: [] },
      inferredIngredients: [],
      inferredSteps: [],
      inferredTimes: [],
      dishImage: null,
      taxonomyRejected: [],
      servingsUnparsed: false,
      confidence: { name: 1, ingredients: 1, steps: 1 },
    };
    const { wrapper, store } = await mountModal({ prefill });
    expect((servingsInput(wrapper).element as HTMLInputElement).value).toBe('6');
    await save(wrapper);
    const payload = vi.mocked(store.createRecipe).mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.servings).toBe('6');
  });
});
