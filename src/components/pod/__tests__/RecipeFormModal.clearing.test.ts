/**
 * Clearing an optional field must DELETE it, not silently keep the old value (#72).
 *
 * These fields were conditionally spread — omitted from the payload when blank. On create
 * that is equivalent, but on UPDATE the repository leaves absent keys untouched, so emptying
 * a field in the edit form kept the previous value. greg hit this asking to delete a
 * recipe's link; the subtitle, times, servings and notes were quietly the same.
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

const EXISTING: Recipe = {
  id: 'r1',
  name: 'Pumpkin Pie',
  subtitle: 'the good one',
  prepTime: '35 mins',
  cookTime: '55 mins',
  servings: '8',
  sourceUrl: 'https://www.youtube.com/watch?v=PmuCEQTy-9E',
  notes: 'chill the crust',
  ingredients: ['1 crust'],
  steps: ['bake'],
  createdAt: '2026-08-25',
  updatedAt: '2026-08-25',
} as Recipe;

async function mountModal() {
  setActivePinia(createPinia());
  const store = useRecipesStore();
  store.recipes = [EXISTING];
  store.updateRecipe = vi.fn().mockResolvedValue(EXISTING);
  store.createRecipe = vi.fn().mockResolvedValue(EXISTING);

  const wrapper = mount(RecipeFormModal, {
    props: { open: false, recipe: EXISTING },
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

describe('RecipeFormModal — clearing optional fields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pre-fills the link so it can be seen and edited', async () => {
    const { wrapper } = await mountModal();
    const urlInput = wrapper.find('input[type="url"]');
    expect(urlInput.exists()).toBe(true);
    expect((urlInput.element as HTMLInputElement).value).toBe(EXISTING.sourceUrl);
  });

  it('sends sourceUrl: undefined when the link is emptied, so the repo deletes it', async () => {
    const { wrapper, store } = await mountModal();
    await wrapper.find('input[type="url"]').setValue('');
    await nextTick();
    wrapper.findComponent(BeanieFormModal).vm.$emit('save');
    await nextTick();
    await nextTick();

    expect(store.updateRecipe).toHaveBeenCalled();
    const payload = vi.mocked(store.updateRecipe).mock.calls[0]![1] as Record<string, unknown>;
    // The KEY must be present and undefined. Absent would mean "leave it alone", which is
    // exactly the bug: the old link would survive.
    expect('sourceUrl' in payload).toBe(true);
    expect(payload.sourceUrl).toBeUndefined();
  });

  it('OMITS an untouched field entirely, so a concurrent edit is not clobbered', async () => {
    // The stronger contract, and the reason diffPayload is used here. Sending an untouched
    // field back at its old value is not harmless in a CRDT: if another device changed it
    // between load and save, the write lands on top of theirs. Absent means "leave it".
    const { wrapper, store } = await mountModal();
    wrapper.findComponent(BeanieFormModal).vm.$emit('save');
    await nextTick();
    await nextTick();
    const payload = vi.mocked(store.updateRecipe).mock.calls[0]![1] as Record<string, unknown>;
    expect('sourceUrl' in payload).toBe(false);
    expect('subtitle' in payload).toBe(false);
  });

  it('never sends a DELETE for a field that was already empty', async () => {
    // The regression this pins: always passing `undefined` meant every save deleted every
    // blank field. Device A edits only the name on a recipe with no subtitle; device B adds
    // a subtitle; A's save must not remove it.
    const noSubtitle = { ...EXISTING, subtitle: undefined } as Recipe;
    setActivePinia(createPinia());
    const store = useRecipesStore();
    store.recipes = [noSubtitle];
    store.updateRecipe = vi.fn().mockResolvedValue(noSubtitle);
    const wrapper = mount(RecipeFormModal, {
      props: { open: false, recipe: noSubtitle },
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
    await wrapper.findAll('input[type="text"]')[0]!.setValue('Renamed Pie');
    await nextTick();
    wrapper.findComponent(BeanieFormModal).vm.$emit('save');
    await nextTick();
    await nextTick();

    const payload = vi.mocked(store.updateRecipe).mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.name).toBe('Renamed Pie');
    // Present-with-undefined would DELETE it on the other device's value.
    expect('subtitle' in payload).toBe(false);
  });

  it('does the same for the other optional fields', async () => {
    const { wrapper, store } = await mountModal();
    for (const el of wrapper.findAll('textarea')) await el.setValue('');
    for (const el of wrapper.findAll('input[type="text"]')) await el.setValue('');
    await wrapper.find('input[type="url"]').setValue('');
    // Name is required, so put it back — the payload is only built for a saveable form.
    await wrapper.findAll('input[type="text"]')[0]!.setValue('Pumpkin Pie');
    await nextTick();
    wrapper.findComponent(BeanieFormModal).vm.$emit('save');
    await nextTick();
    await nextTick();

    const payload = vi.mocked(store.updateRecipe).mock.calls[0]![1] as Record<string, unknown>;
    for (const key of ['subtitle', 'prepTime', 'cookTime', 'servings', 'notes']) {
      // These all HAD values on EXISTING and were emptied, so each must be present and
      // undefined — the repository's delete signal. Absent would mean "leave it alone".
      expect({ key, present: key in payload }).toEqual({ key, present: true });
      expect(payload[key]).toBeUndefined();
    }
  });
});
