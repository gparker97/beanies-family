/**
 * The disclosure hints (#93).
 *
 * `prepTime` / `cookTime` / `servings` may now be worked out by the reader rather than read
 * from the source, and the ONLY thing separating "beanies read this on the page" from
 * "beanies guessed this" is the hint beside the field. If the hint does not render, the form
 * presents a guessed cook time as if it had been read verbatim — which is the exact failure
 * the ingredient and step hints were added to prevent, on three more fields.
 *
 * It also pins the reset. The bug the three lists were collapsed into ONE ref to prevent was
 * "one of these was left behind", so a test that only proves the hint appears would miss the
 * half that matters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import { useRecipesStore } from '@/stores/recipesStore';
import type { RecipePrefill } from '@/utils/recipeExtractionToRecipe';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));

function prefill(over: Partial<RecipePrefill> = {}): RecipePrefill {
  return {
    fields: {
      name: 'Lemon Drizzle Cake',
      prepTime: '20 mins',
      cookTime: '45 mins',
      servings: 'Serves 8',
      ingredients: ['225g butter'],
      steps: ['Heat the oven.'],
    },
    inferredIngredients: [],
    inferredSteps: [],
    inferredTimes: [],
    taxonomyRejected: [],
    dishImage: null,
    confidence: { name: 1, ingredients: 1, steps: 1 },
    ...over,
  };
}

async function mountWith(p: RecipePrefill | null) {
  setActivePinia(createPinia());
  const store = useRecipesStore();
  store.recipes = [];
  store.createRecipe = vi.fn().mockResolvedValue({ id: 'r1' });

  const wrapper = mount(RecipeFormModal, {
    props: { open: false, prefill: p },
    global: {
      stubs: {
        BeanieFormModal: { template: '<div><slot /></div>' },
        PhotoAttachments: true,
        AiDocumentPicker: true,
        RecipeSourceStrip: true,
        DocumentExtractConsentModal: true,
      },
    },
  });
  await wrapper.setProps({ open: true });
  await nextTick();
  return wrapper;
}

beforeEach(() => vi.clearAllMocks());

describe('inferred time hints', () => {
  it('marks ONLY the times the reader worked out', async () => {
    const w = await mountWith(prefill({ inferredTimes: ['cookTime'] }));
    // One hint, not three: an unmarked field must still read as "we read this on the page".
    expect(w.findAll('[data-testid="inferred-hint"]')).toHaveLength(1);
    expect(w.text()).toContain('recipeExtract.inferred.times');
  });

  it('renders no hint when every time was read from the source', async () => {
    const w = await mountWith(prefill());
    expect(w.findAll('[data-testid="inferred-hint"]')).toHaveLength(0);
    expect(w.text()).not.toContain('recipeExtract.inferred.times');
  });

  it('marks all three when the reader worked out all three', async () => {
    const w = await mountWith(prefill({ inferredTimes: ['prepTime', 'cookTime', 'servings'] }));
    expect(w.findAll('[data-testid="inferred-hint"]')).toHaveLength(3);
  });

  it('still renders the ingredient and step hints beside them', async () => {
    const w = await mountWith(
      prefill({
        inferredIngredients: ['1 tsp salt'],
        inferredSteps: ['Bake for 45 minutes.'],
        inferredTimes: ['prepTime'],
      })
    );
    expect(w.findAll('[data-testid="inferred-hint"]')).toHaveLength(3);
    expect(w.text()).toContain('1 tsp salt');
    expect(w.text()).toContain('Bake for 45 minutes.');
  });

  it('CLEARS all three lists together on a blank new recipe', async () => {
    // The whole reason the three collapsed into one ref: the bug they carried was a reset
    // that left one behind, so a blank form kept the previous capture's hints.
    const w = await mountWith(
      prefill({ inferredIngredients: ['1 tsp salt'], inferredTimes: ['cookTime'] })
    );
    expect(w.findAll('[data-testid="inferred-hint"]').length).toBeGreaterThan(0);

    await w.setProps({ open: false });
    await w.setProps({ prefill: null });
    await w.setProps({ open: true });
    await nextTick();

    expect(w.findAll('[data-testid="inferred-hint"]')).toHaveLength(0);
  });
});
