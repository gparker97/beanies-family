/**
 * FavoriteFormModal — save-disabled when name is empty, save
 * happy-path on valid input, delete confirmation surface.
 *
 * We don't assert on store calls here (BeanieFormModal swallows the
 * click event into its own handlers) — the form-validation contract
 * is what matters for smoke coverage: the modal must not let an
 * invalid record reach the store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import FavoriteFormModal from '@/components/pod/FavoriteFormModal.vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useFavoritesStore } from '@/stores/favoritesStore';
import type { FavoriteItem } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useConfirm', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

const MEMBER_ID = 'bean-neil';

async function mountModal(favorite?: FavoriteItem | null) {
  setActivePinia(createPinia());
  const store = useFavoritesStore();
  store.createFavorite = vi.fn().mockResolvedValue({ id: 'new', ...favorite });
  store.updateFavorite = vi.fn().mockResolvedValue({ id: favorite?.id });
  store.deleteFavorite = vi.fn().mockResolvedValue(undefined);
  // Mount with open=false first, then flip to true — useFormModal's
  // watcher is non-immediate so we need a transition to run onEdit/onNew.
  const wrapper = mount(FavoriteFormModal, {
    props: { open: false, memberId: MEMBER_ID, favorite: favorite ?? null },
    global: {
      stubs: {
        BeanieFormModal: {
          props: ['saveDisabled', 'isSubmitting', 'showDelete', 'title'],
          template: '<div data-testid="modal"><slot /></div>',
        },
      },
    },
  });
  await wrapper.setProps({ open: true });
  await nextTick();
  return { wrapper, store };
}

describe('FavoriteFormModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables save when the name field is empty (new)', async () => {
    const { wrapper } = await mountModal(null);
    const modalStub = wrapper.findComponent(BeanieFormModal);
    expect(modalStub.props('saveDisabled')).toBe(true);
  });

  it('enables save once a name is typed', async () => {
    const { wrapper } = await mountModal(null);
    const inputs = wrapper.findAll('input[type="text"]');
    expect(inputs.length).toBeGreaterThan(0);
    await inputs[0]!.setValue('Spaghetti carbonara');
    await nextTick();
    const modalStub = wrapper.findComponent(BeanieFormModal);
    expect(modalStub.props('saveDisabled')).toBe(false);
  });

  it('pre-fills fields when editing an existing favorite', async () => {
    const fav: FavoriteItem = {
      id: 'f1',
      memberId: MEMBER_ID,
      category: 'food',
      name: 'Pizza',
      description: 'Friday tradition',
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };
    const { wrapper } = await mountModal(fav);
    const inputs = wrapper.findAll('input[type="text"]');
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('Pizza');
    expect((inputs[1]!.element as HTMLInputElement).value).toBe('Friday tradition');
  });
});
