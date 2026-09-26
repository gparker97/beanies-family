/**
 * NewListSheet — Who Owns What (#109) template default: a template mapped to a card
 * owns the new list with the card's single holder, while the current member stays the
 * creator; the tile explains it before the pick.
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const createFromTemplate = vi.fn(async () => ({ id: 'new-list' }));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({ createFromTemplate, createList: vi.fn() }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ currentMember: { id: 'me' } }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/composables/useCardDefaultHint', () => ({
  useCardDefaultHint: () => ({
    holderFor: (t: { key: string }) =>
      t.key === 'grocery' ? { memberId: 'sofia', cardId: 'grocery-shopping' } : null,
    holdsHint: (t: { key: string }) => (t.key === 'grocery' ? 'sofia holds grocery' : ''),
  }),
}));

import NewListSheet from '../NewListSheet.vue';

const stubs = {
  BaseModal: { template: '<div><slot /></div>' },
  ListCategoryPills: true,
  BaseButton: { template: '<button><slot /></button>' },
};

function tile(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))!;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('NewListSheet — card holder default (#109)', () => {
  it('shows the hint on the mapped tile only', () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    const hints = wrapper.findAll('[data-testid="inferred-hint"]');
    expect(hints).toHaveLength(1);
    expect(hints[0]!.text()).toBe('sofia holds grocery');
  });

  it('owns the list with the holder and keeps the current member as creator', async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await tile(wrapper, 'lists.template.grocery.name').trigger('click');
    expect(createFromTemplate).toHaveBeenCalledWith('grocery', 'me', { ownerId: 'sofia' });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'lists',
        message: 'card_default_applied',
        context: expect.objectContaining({ detail: 'grocery' }),
      })
    );
  });

  it("keeps today's owner default for an unmapped template", async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await tile(wrapper, 'lists.template.honeydo.name').trigger('click');
    expect(createFromTemplate).toHaveBeenCalledWith('honey-do', 'me', {});
    expect(logEvent).not.toHaveBeenCalled();
  });
});
