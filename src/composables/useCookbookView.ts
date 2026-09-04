/**
 * The cookbook page's filter / sort / group state (#87) — WIRING ONLY.
 *
 * Every rule lives in `utils/recipeOrdering.ts`, which is pure and Vue-free; this composable
 * holds the reactive state and the order of operations, and nothing else. That split is what
 * makes the never-vanish invariant testable without mounting a page.
 *
 * ⚠️ ORDER OF OPERATIONS, fixed: count (UNFILTERED) → filter by course → sort → group.
 * Counting after filtering would zero every other pill the moment one was selected, and the
 * control would look broken.
 */
import { computed, ref, type Ref } from 'vue';
import { usePersistedChoice } from '@/composables/usePersistedChoice';
import { useRecipesStore } from '@/stores/recipesStore';
import {
  buildShelves,
  countByCourse,
  recipeComparator,
  COOKBOOK_GROUPS,
  RECIPE_SORTS,
  type CookbookGroup,
  type RecipeSort,
  type Shelf,
} from '@/utils/recipeOrdering';
import { isRecipeCourse } from '@/constants/recipeCourses';
import type { Recipe, RecipeCourse } from '@/types/models';

const SORT_KEY = 'beanies:cookbookSort';
const GROUP_KEY = 'beanies:cookbookGroup';

/** `null` is "all courses" — the leading pill. */
export type CourseFilter = RecipeCourse | null;

export function useCookbookView(recipes: Ref<Recipe[]>) {
  const recipesStore = useRecipesStore();

  const sortBy = usePersistedChoice<RecipeSort>(SORT_KEY, RECIPE_SORTS, 'name');
  const groupBy = usePersistedChoice<CookbookGroup>(GROUP_KEY, COOKBOOK_GROUPS, 'none');

  /**
   * ⚠️ Deliberately NOT persisted, unlike sort and group.
   *
   * Sort and group re-order what is on screen; a filter REMOVES things from it. Restoring one
   * on load means the user opens the cookbook and most of their recipes are simply gone, with
   * the reason two taps away inside a tray — which reads as data loss, precisely the failure
   * this whole feature is trying not to cause.
   */
  const course = ref<CourseFilter>(null);

  /**
   * One Map built in a single pass, passed INTO the comparator.
   *
   * Not `cookStatsForRecipe(id)`: that returns a fresh Vue `computed` per call, so using it
   * inside a sort would allocate one per comparison.
   */
  const cookCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const log of recipesStore.cookLogs) {
      counts.set(log.recipeId, (counts.get(log.recipeId) ?? 0) + 1);
    }
    return counts;
  });

  /** UNFILTERED — see the order-of-operations note above. */
  const courseCounts = computed(() => countByCourse(recipes.value));

  const totalCount = computed(() => recipes.value.length);

  const visible = computed(() => {
    const filter = course.value;
    const filtered = filter ? recipes.value.filter((r) => r.course === filter) : [...recipes.value];
    return filtered.sort(recipeComparator(sortBy.value, cookCounts.value));
  });

  const shelves = computed<Shelf[]>(() => buildShelves(visible.value, groupBy.value));

  const visibleCount = computed(() => visible.value.length);

  function clearFilter() {
    course.value = null;
  }

  /** Guards against a caller handing us something that is not a course. */
  function setCourse(next: string | null) {
    if (next === null) return clearFilter();
    if (!isRecipeCourse(next)) {
      console.warn(`[useCookbookView] ignoring unknown course filter "${next}"`);
      return;
    }
    course.value = next;
  }

  return {
    sortBy,
    groupBy,
    course,
    setCourse,
    clearFilter,
    shelves,
    courseCounts,
    totalCount,
    visibleCount,
  };
}
