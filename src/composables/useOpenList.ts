/**
 * Go to a family list (#88, shared by every shopping-list surface since #116).
 *
 * NAVIGATES rather than mounting a second copy of the ~700-line list drawer:
 * `BeanieListsPage` already opens `?view=<id>` immediately and strips the query
 * on close, and the route's own `requiresFlag: 'familyLists'` is a second, free
 * flag check. A family tapping "open my shopping list" is going shopping — the
 * Lists page is the destination, not a detour.
 *
 * Its own composable (not part of `useRecipeShoppingLists`) because the week's
 * shopping list and the meal drawer open lists too and have no recipe to scope by.
 */
import { useRouter } from 'vue-router';

export function useOpenList() {
  const router = useRouter();

  function openList(id: string): void {
    void router.push({ name: 'Lists', query: { view: id } });
  }

  return { openList };
}
