/**
 * The shopping lists a recipe has produced, and how to get to one (#88).
 *
 * ONE home for the question "does this recipe already have a shopping list?",
 * because two surfaces now ask it and they must never disagree: the recipe page
 * decides which action to offer, and the review sheet decides whether to say a
 * list already exists. An inline `filter` in each would be two places to change
 * when the link field or the ordering rule moves.
 *
 * Read-only and navigation-only. Creating a list stays in `RecipeListSheet` —
 * this composable deliberately owns no write, so neither caller becomes a second
 * lists client.
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { useListStore } from '@/stores/listStore';
import type { FamilyList } from '@/types/models';

export function useRecipeShoppingLists(
  recipeId: Ref<string | undefined> | ComputedRef<string | undefined>
) {
  const listStore = useListStore();
  const router = useRouter();

  /** Every list built from this recipe, NEWEST FIRST — a family's latest shop is the one they mean. */
  const lists = computed<FamilyList[]>(() => {
    const id = recipeId.value;
    if (!id) return [];
    return listStore.lists
      .filter((l) => l.linkedRecipeId === id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  /**
   * The list the family almost certainly means: the newest one still being shopped.
   *
   * ⚠️ Completed lists are deliberately excluded. Making "Open shopping list" the
   * first-class action on a recipe is only right while there is a live shop to
   * open — pointing it at a list that was ticked off and filed three months ago
   * would be worse than offering to make a new one. The finished ones are still
   * reachable: the review sheet lists every one of them.
   */
  const activeList = computed<FamilyList | null>(
    () => lists.value.find((l) => !l.completed) ?? null
  );

  /**
   * Go to a list.
   *
   * NAVIGATES rather than mounting a second copy of the ~700-line list drawer:
   * `BeanieListsPage` already opens `?view=<id>` immediately and strips the query
   * on close, and the route's own `requiresFlag: 'familyLists'` is a second, free
   * flag check. A family tapping "open my shopping list" is going shopping — the
   * Lists page is the destination, not a detour.
   */
  function openList(id: string): void {
    void router.push({ name: 'Lists', query: { view: id } });
  }

  return { lists, activeList, openList };
}
