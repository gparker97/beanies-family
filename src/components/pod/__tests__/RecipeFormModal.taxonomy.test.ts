/**
 * 🚨 THE TEST THIS FEATURE EXISTS TO NOT NEED (#87).
 *
 * `RecipeFormModal` has FOUR seeding/save sites, not two: `useFormModal({ onEdit })` seeds the
 * refs when opening an EXISTING recipe, `applyPrefill` seeds them on capture, `baselinePayload`
 * says what the doc held, and `buildPayload` says what the form holds now.
 *
 * Miss `onEdit` and the failure is catastrophic and silent: opening a saved recipe leaves the
 * new refs blank, `buildPayload` sends ''/[], `baselinePayload` reports the stored values,
 * `diffPayload` sees a genuine change, and the clear is WRITTEN. Fixing a typo in the title
 * would erase that recipe's tags, course and meals — on every edit, for every user, with no
 * error anywhere.
 *
 * The first test below is the one that catches it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useRecipesStore } from '@/stores/recipesStore';
import type { Recipe } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));

const FILED: Recipe = {
  id: 'r1',
  name: 'Pumpkin Pie',
  ingredients: ['1 crust'],
  steps: ['bake'],
  course: 'dessert',
  mealSlots: ['dinner', 'snack'],
  tags: ['autumn', 'family favourite'],
  createdAt: '2026-08-25',
  updatedAt: '2026-08-25',
} as Recipe;

async function mountModal(recipe: Recipe = FILED) {
  setActivePinia(createPinia());
  const store = useRecipesStore();
  store.recipes = [recipe];
  store.updateRecipe = vi.fn().mockResolvedValue(recipe);
  store.createRecipe = vi.fn().mockResolvedValue(recipe);

  const wrapper = mount(RecipeFormModal, {
    props: { open: false, recipe },
    global: {
      stubs: {
        BeanieFormModal: {
          props: ['saveDisabled', 'isSubmitting', 'showDelete', 'title'],
          template: '<div><slot /></div>',
        },
        PhotoAttachments: true,
        AiDocumentPicker: true,
        RecipeSourceStrip: true,
        DocumentExtractConsentModal: true,
      },
    },
  });
  await wrapper.setProps({ open: true });
  await nextTick();
  return { wrapper, store };
}

async function save(wrapper: Awaited<ReturnType<typeof mountModal>>['wrapper']) {
  wrapper.findComponent(BeanieFormModal).vm.$emit('save');
  await nextTick();
  await nextTick();
}

describe('RecipeFormModal — sectioned layout', () => {
  it('groups the eleven fields into four labelled sections', async () => {
    const { wrapper } = await mountModal();
    const sections = wrapper.findAll('section[aria-labelledby]');
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.find('h3').text())).toEqual([
      'recipes.section.dish',
      'recipes.section.method',
      'recipes.section.filing',
      'recipes.section.personal',
    ]);
  });

  it('keeps the required name field in the first section, never nested away', async () => {
    const { wrapper } = await mountModal();
    const first = wrapper.findAll('section[aria-labelledby]')[0]!;
    expect(first.text()).toContain('recipes.field.name');
  });

  it('puts the source link with the dish, not adrift between steps and course', async () => {
    const { wrapper } = await mountModal();
    const first = wrapper.findAll('section[aria-labelledby]')[0]!;
    expect(first.find('input[type="url"]').exists()).toBe(true);
  });

  it('puts course, meals and tags together under one purpose-named heading', async () => {
    const { wrapper } = await mountModal();
    const filing = wrapper.findAll('section[aria-labelledby]')[2]!;
    expect(filing.find('select').exists()).toBe(true);
    expect(filing.text()).toContain('recipes.field.meals');
    expect(filing.text()).toContain('recipes.field.tags');
  });
});

describe('RecipeFormModal — course, meals and tags round-trip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes NOTHING when a fully-filed recipe is opened and saved untouched', async () => {
    const { wrapper, store } = await mountModal();
    await save(wrapper);

    const patch = (store.updateRecipe as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? {};
    // The assertion that would have failed had `onEdit` been missed: the patch would have
    // carried course: undefined, mealSlots: [], tags: [] — the silent wipe.
    expect(patch).not.toHaveProperty('course');
    expect(patch).not.toHaveProperty('mealSlots');
    expect(patch).not.toHaveProperty('tags');
  });

  it('seeds the course select from the stored recipe', async () => {
    const { wrapper } = await mountModal();
    const select = wrapper.find('select');
    expect((select.element as HTMLSelectElement).value).toBe('dessert');
  });

  it('seeds the tag pills from the stored recipe', async () => {
    const { wrapper } = await mountModal();
    const text = wrapper.text();
    expect(text).toContain('autumn');
    expect(text).toContain('family favourite');
  });

  it('writes a changed course and leaves the untouched fields out of the patch', async () => {
    const { wrapper, store } = await mountModal();
    await wrapper.find('select').setValue('main');
    await save(wrapper);

    const patch = (store.updateRecipe as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? {};
    expect(patch.course).toBe('main');
    expect(patch).not.toHaveProperty('tags');
    expect(patch).not.toHaveProperty('mealSlots');
  });

  it('persists a CLEARED course as undefined so the repository deletes it', async () => {
    const { wrapper, store } = await mountModal();
    await wrapper.find('select').setValue('');
    await save(wrapper);

    const patch = (store.updateRecipe as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? {};
    expect(patch).toHaveProperty('course');
    expect(patch.course).toBeUndefined();
  });

  it('writes nothing when the meal chips are toggled off and back on', async () => {
    const { wrapper, store } = await mountModal();
    // dinner is index 2 of breakfast/lunch/dinner/snack in the meal chip group.
    const chips = wrapper
      .findAll('button')
      .filter((b) => b.text().includes('mealPlanner.slot.dinner'));
    expect(chips.length).toBeGreaterThan(0);
    await chips[0]!.trigger('click');
    await chips[0]!.trigger('click');
    await save(wrapper);

    const patch = (store.updateRecipe as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? {};
    // Canonical ordering on both payload sides is what makes this true — diffPayload's array
    // equality is BY INDEX, so a re-added slot landing at the end would read as a change.
    expect(patch).not.toHaveProperty('mealSlots');
  });

  // ── The FIFTH seed site: applyPrefill as a MERGE into an already-open form ──
  //
  // `showSourceStrip` stays visible until `name` is non-empty, so ticking a meal and typing a
  // tag BEFORE pasting a recipe URL is a normal order of operations — and `tags` can never be
  // restored by a prefill, because RecipePrefill.fields has no `tags` member.
  it('keeps user-typed tags when an AI capture lands in an already-open form', async () => {
    const { wrapper } = await mountModal();
    const vm = wrapper.vm as unknown as {
      tags: string[];
      mealSlots: string[];
      course: string;
      applyPrefill: (p: unknown) => void;
    };
    vm.tags = ['nana special'];
    vm.mealSlots = ['dinner'];
    await nextTick();

    vm.applyPrefill({
      fields: { name: 'Captured Pie', ingredients: ['a'], steps: ['b'] },
      inferredIngredients: [],
      inferredSteps: [],
      taxonomyRejected: [],
      dishImage: null,
      confidence: { name: 1, ingredients: 1, steps: 1 },
    });
    await nextTick();

    expect(vm.tags).toEqual(['nana special']);
    // The model declined a course/meal, so the user's own tick survives rather than being
    // overwritten with "nothing".
    expect(vm.mealSlots).toEqual(['dinner']);
  });

  it('lets a confident capture replace the course and meals it does supply', async () => {
    const { wrapper } = await mountModal();
    const vm = wrapper.vm as unknown as {
      tags: string[];
      mealSlots: string[];
      course: string;
      applyPrefill: (p: unknown) => void;
    };
    vm.mealSlots = ['dinner'];
    await nextTick();

    vm.applyPrefill({
      fields: {
        name: 'Captured Pie',
        ingredients: ['a'],
        steps: ['b'],
        course: 'dessert',
        mealSlots: ['snack'],
      },
      inferredIngredients: [],
      inferredSteps: [],
      taxonomyRejected: [],
      dishImage: null,
      confidence: { name: 1, ingredients: 1, steps: 1 },
    });
    await nextTick();

    expect(vm.course).toBe('dessert');
    expect(vm.mealSlots).toEqual(['snack']);
  });

  it('still clears everything on the blank reset', async () => {
    const { wrapper } = await mountModal();
    const vm = wrapper.vm as unknown as {
      tags: string[];
      mealSlots: string[];
      course: string;
      applyPrefill: (p: unknown) => void;
    };
    vm.tags = ['x'];
    vm.mealSlots = ['dinner'];
    vm.course = 'main';
    await nextTick();

    vm.applyPrefill(null);
    await nextTick();

    expect(vm.tags).toEqual([]);
    expect(vm.mealSlots).toEqual([]);
    expect(vm.course).toBe('');
  });

  // `tags: 42` specifically: spreading a number THROWS, so without the Array.isArray guard in
  // `onEdit` the modal cannot be opened at all — and a recipe you cannot open is a recipe you
  // cannot repair.
  it('opens a recipe whose stored tags are not an array, so it can be repaired', async () => {
    const corrupt = { ...FILED, id: 'r3', tags: 42, mealSlots: 'dinner' };
    const { wrapper } = await mountModal(corrupt as unknown as Recipe);
    const vm = wrapper.vm as unknown as { tags: string[]; mealSlots: string[] };
    expect(vm.tags).toEqual([]);
    expect(wrapper.find('select').exists()).toBe(true);
  });

  it('opens blank for a recipe with none of the new fields, and saves no phantom change', async () => {
    const bare = { ...FILED, id: 'r2', course: undefined, mealSlots: undefined, tags: undefined };
    const { wrapper, store } = await mountModal(bare as Recipe);
    await save(wrapper);

    const patch = (store.updateRecipe as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? {};
    expect(patch).not.toHaveProperty('course');
    expect(patch).not.toHaveProperty('mealSlots');
    expect(patch).not.toHaveProperty('tags');
  });
});
