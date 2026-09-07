/**
 * The kept-recipe handoff at the cookbook end (#92).
 *
 * 🚨 THIS LOGIC HAS BROKEN TWICE, in opposite directions, which is why it has its own file.
 *
 *   1. It consumed the stash immediately. On a cold boot the page first mounts before any
 *      session exists, so `canEditActivities` is false and the recipe was destroyed with a
 *      "you don't have permission" message shown to the pod's owner.
 *   2. The fix bailed when the roster was empty — and BOTH mounts of a cold boot see an
 *      empty roster (the layout branch swaps when auth resolves, `loadMembers` runs three
 *      steps later, and there is no third mount). The keep was dropped in silence on
 *      precisely the journey the guard was added to protect.
 *
 * So the two things worth asserting are "it waits" and "it does not give up".
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import FamilyCookbookPage from '@/pages/FamilyCookbookPage.vue';
import { consumeKeptRecipe } from '@/utils/recipeKeepStash';
import { showToast } from '@/composables/useToast';
import type { FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/composables/useQuickAddIntent', () => ({ useQuickAddIntent: vi.fn() }));
vi.mock('@/composables/useMagicReader', () => ({
  useMagicReader: () => ({ canReadRecipe: { value: false } }),
  useMagicReaderConsumer: vi.fn(),
}));
vi.mock('@/composables/useDocumentConsent', () => ({
  useDocumentConsent: () => ({ requestConsent: vi.fn() }),
}));
vi.mock('@/composables/useRecipeCapture', () => ({
  useRecipeCapture: () => ({
    isProcessing: ref(false),
    processUrl: vi.fn(),
    attachAfterSave: vi.fn(),
    discardPendingSource: vi.fn(),
  }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utils/recipeKeepStash', () => ({ consumeKeptRecipe: vi.fn() }));

let canEdit = true;
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({
    canEditActivities: {
      get value() {
        return canEdit;
      },
    },
  }),
}));

const members = ref<FamilyMember[]>([]);
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return members.value;
    },
  }),
}));

/** Held as a VALUE so `findComponent` can match it — a named string stub is not findable. */
const FormModalStub = defineComponent({
  name: 'RecipeFormModalStub',
  props: { open: Boolean, prefill: { type: Object, default: null } },
  template: '<div />',
});

const KEPT = { name: 'Lemon Drizzle Cake', ingredients: ['225g butter'], steps: ['Bake.'] };
const MEMBER = { id: 'm-1', name: 'Greg' } as FamilyMember;

function mountPage() {
  return mount(FamilyCookbookPage, {
    global: {
      stubs: {
        RecipeFormModal: FormModalStub,
        AiProcessingOverlay: true,
        AiDocumentPicker: true,
        RecipeLinkModal: true,
        MagicReaderPill: true,
        CookbookControls: true,
        AddEntityButton: true,
        AddTile: true,
        EmptyState: true,
        PolaroidImage: true,
        RecipeTaxonomyBadges: true,
        BeanieIcon: true,
      },
    },
  });
}

/** The prefill the form modal was actually opened with, or null. */
function openedPrefill(w: ReturnType<typeof mountPage>) {
  const modal = w.findComponent(FormModalStub);
  if (!modal.exists() || !modal.props('open')) return null;
  return modal.props('prefill') as { fields: typeof KEPT } | null;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  canEdit = true;
  members.value = [];
  vi.mocked(consumeKeptRecipe).mockReturnValue(null);
});

describe('when the roster is already loaded (the normal sign-in journey)', () => {
  it('opens the review form with the kept recipe', async () => {
    members.value = [MEMBER];
    vi.mocked(consumeKeptRecipe).mockReturnValue(KEPT);
    const w = mountPage();
    await nextTick();
    expect(openedPrefill(w)?.fields).toEqual(KEPT);
  });
});

describe('when the roster arrives later (the cold boot)', () => {
  it('WAITS, then delivers — it does not consume against an empty roster', async () => {
    vi.mocked(consumeKeptRecipe).mockReturnValue(KEPT);
    const w = mountPage();
    await nextTick();
    // Nothing yet: consuming here would hit `canEditActivities === false` and destroy it.
    expect(consumeKeptRecipe).not.toHaveBeenCalled();
    expect(openedPrefill(w)).toBeNull();

    members.value = [MEMBER];
    await nextTick();
    expect(consumeKeptRecipe).toHaveBeenCalledOnce();
    expect(openedPrefill(w)?.fields).toEqual(KEPT);
  });

  it('does not give up permanently — the bug the first fix introduced', async () => {
    // Both mounts of a cold boot see an empty roster and there is no third mount, so a
    // plain `if (!members.length) return` dropped the recipe in silence.
    vi.mocked(consumeKeptRecipe).mockReturnValue(KEPT);
    const w = mountPage();
    await nextTick();
    members.value = [MEMBER];
    await nextTick();
    expect(openedPrefill(w)).not.toBeNull();
  });

  it('decides exactly once, however often the roster changes', async () => {
    vi.mocked(consumeKeptRecipe).mockReturnValue(KEPT);
    mountPage();
    members.value = [MEMBER];
    await nextTick();
    members.value = [MEMBER, { id: 'm-2', name: 'Bean' } as FamilyMember];
    await nextTick();
    expect(consumeKeptRecipe).toHaveBeenCalledOnce();
  });
});

describe('permission', () => {
  it('tells a view-only member rather than opening an add form they cannot reach', async () => {
    canEdit = false;
    members.value = [MEMBER];
    vi.mocked(consumeKeptRecipe).mockReturnValue(KEPT);
    const w = mountPage();
    await nextTick();
    expect(openedPrefill(w)).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      'info',
      'recipes.keep.notAllowed',
      'recipes.keep.notAllowedHelp'
    );
  });

  it('says nothing at all when no recipe was kept', async () => {
    members.value = [MEMBER];
    const w = mountPage();
    await nextTick();
    expect(openedPrefill(w)).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });
});
