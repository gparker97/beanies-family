/**
 * The whole family's scrapbook feed, every type: the one call the Everyone spread, the
 * family timeline and the wall's sleep slideshow all make.
 *
 * The roster is every family member, so departed members' entries stay hidden as they do
 * everywhere else. The type set is the feed's empty set, which means ALL types: a caller
 * with type switches (the wall) must apply them itself, because an empty set of enabled
 * switches would otherwise read as "show everything".
 */
import { ref } from 'vue';
import { useScrapbookFeed, type ScrapType } from '@/composables/useScrapbookFeed';
import { useFamilyStore } from '@/stores/familyStore';

export function useFamilyScrapbookFeed() {
  const familyStore = useFamilyStore();
  return useScrapbookFeed({
    memberIds: () => familyStore.members.map((m) => m.id),
    contentTypes: ref(new Set<ScrapType>()),
  });
}
