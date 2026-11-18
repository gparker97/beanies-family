/**
 * EveryoneSpread: the photo tap (#154). Each of its four card blocks (the hero, the supporting
 * cluster, the per-bean corners and the family moments) forwards a card's `photo-click` to the
 * page, unchanged, beside the existing `entry-click`.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import type { FamilyMember } from '@/types/models';

const { entriesHolder } = vi.hoisted(() => ({ entriesHolder: { value: [] as unknown[] } }));

vi.mock('@/composables/useTranslation', async () => {
  const { ref } = await import('vue');
  return { useTranslation: () => ({ t: (key: string) => key, isBeanieMode: ref(false) }) };
});
vi.mock('@/composables/useFamilyScrapbookFeed', async () => {
  const { computed } = await import('vue');
  return {
    useFamilyScrapbookFeed: () => ({
      entries: computed(() => entriesHolder.value as ScrapbookEntry[]),
    }),
  };
});
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    sortedMembers: [{ id: 'm1', name: 'Leo', color: '#123456' } as FamilyMember],
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyName: 'Test Family' }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  getMemberAvatarUrl: () => undefined,
  markMemberAvatarError: vi.fn(),
}));
vi.mock('@/components/scrapbook/ScrapbookEntryCard.vue', () => ({
  default: {
    name: 'ScrapbookEntryCard',
    props: ['entry', 'noteIndex', 'emphasizePhoto'],
    emits: ['click', 'photo-click'],
    template: '<div class="card-stub" :data-id="entry.id" />',
  },
}));

import EveryoneSpread from '../EveryoneSpread.vue';

function entry(
  id: string,
  type: ScrapbookEntry['type'],
  memberId: string | null,
  payload: object
): ScrapbookEntry {
  return {
    id,
    type,
    memberId,
    effectiveDate: '2026-11-10',
    createdAt: '2026-11-10T12:00:00',
    payload: { id, ...payload },
  } as unknown as ScrapbookEntry;
}

describe('EveryoneSpread', () => {
  it('forwards photo-click from every card block, with the entry', async () => {
    const hero = entry('hero', 'milestone', 'm1', { title: 'Swim', photoIds: ['p1', 'p2'] });
    const fav = entry('fav', 'favorite', 'm1', { name: 'Ramen', category: 'food' });
    const family = entry('family', 'milestone', null, { title: 'Move', photoIds: ['p3'] });
    entriesHolder.value = [hero, fav, family];

    const w = mount(EveryoneSpread, { global: { stubs: { BeanieAvatar: true } } });
    const cards = w.findAllComponents({ name: 'ScrapbookEntryCard' });
    // Hero, two supporting, two in Leo's corner, one family moment: all four blocks render.
    expect(cards).toHaveLength(6);

    for (const card of cards) card.vm.$emit('photo-click', card.props('entry'));
    await w.vm.$nextTick();

    const forwarded = (w.emitted('photo-click') ?? []).map(([e]) => (e as ScrapbookEntry).id);
    expect(forwarded).toEqual(['hero', 'fav', 'family', 'hero', 'fav', 'family']);
    expect(w.emitted('entry-click')).toBeUndefined();
  });

  it('a card tap still emits entry-click, not photo-click', async () => {
    entriesHolder.value = [entry('fav', 'favorite', 'm1', { name: 'Ramen', category: 'food' })];
    const w = mount(EveryoneSpread, { global: { stubs: { BeanieAvatar: true } } });
    w.findComponent({ name: 'ScrapbookEntryCard' }).vm.$emit('click', entriesHolder.value[0]);
    await w.vm.$nextTick();
    expect(w.emitted('entry-click')).toHaveLength(1);
    expect(w.emitted('photo-click')).toBeUndefined();
  });
});
