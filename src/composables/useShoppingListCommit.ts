/**
 * Write a reviewed ingredient checklist to a family list (#116): the ONE save path behind
 * every shopping-list surface (the recipe page's sheet, the edit-meal drawer's ingredients
 * panel and the meal planner's week list).
 *
 * It owns the guards, the write, the toasts and the telemetry; callers own only their own
 * default destination and title. `kind` is telemetry-only, so a new entry point never
 * edits this file.
 *
 * Guards, in order (each refuses, explains and reports, and writes nothing):
 *   1. a second tap while the first write is in flight (`isSubmitting`);
 *   2. no current member: a list needs a creator, and a dangling `createdBy` is worse than
 *      a failure the user can retry (`no_current_member`);
 *   3. the linked recipe was deleted on another device while the surface was open: its
 *      cascade has already run, so a link written now would dangle forever
 *      (`recipe_missing`).
 * The OWNER is not re-checked here: `listStore.createList` already refuses an unresolved
 * owner with its own toast and report (`lists` / `create_unknown_owner`).
 *
 * A filed (completed) target list is allowed: `addItems` re-opens it, which is what adding
 * new things to buy means.
 */
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useOpenList } from '@/composables/useOpenList';
import { useFamilyStore } from '@/stores/familyStore';
import { useListStore } from '@/stores/listStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { buildShoppingListSeed } from '@/utils/listSeed';
import { fillTemplate } from '@/utils/fillTemplate';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import type { FamilyList } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

/** #88's CloudWatch filter. Kept for every shopping-list surface so the filter continues. */
export const SHOPPING_LIST_SURFACE = 'list-from-recipe';

/** Where the ticked lines go. */
export type ShoppingDestination =
  | {
      mode: 'new';
      /** Blank falls back to the caller's default title. */
      title: string;
      ownerId: string;
      /** ymd, or '' for none. Empty by default: a due date arms a reminder. */
      dueDate: string;
    }
  | { mode: 'existing'; listId: string };

/** Which surface a list was made from. Telemetry only. */
export type ShoppingListKind = 'recipe' | 'meal' | 'week';

/**
 * A fresh New List destination. The owner defaults to whoever is standing here (matching
 * `NewListSheet.startBlank`); the due date deliberately defaults to EMPTY, because a due
 * date is a commitment that arms a reminder the family never asked for.
 */
export function newListDestination(ownerId: string): ShoppingDestination {
  return { mode: 'new', title: '', ownerId, dueDate: '' };
}

/**
 * The save button's label: "Create List", or "Add N Items" when adding to a list the
 * family already has (so the count being written is visible before the tap).
 */
export function shoppingSaveLabel(
  destination: ShoppingDestination,
  count: number,
  t: (key: UIStringKey) => string
): string {
  if (destination.mode === 'new') return t('lists.destination.createList');
  return count === 1
    ? t('lists.destination.addItems.one')
    : fillTemplate(t('lists.destination.addItems.other'), { n: String(count) });
}

/** Sections as a fixed bucket, so the firehose gets a closed set rather than a number. */
function sectionsBucket(n: number): 'one' | 'two' | 'three' | 'many' {
  if (n <= 1) return 'one';
  if (n === 2) return 'two';
  if (n === 3) return 'three';
  return 'many';
}

/**
 * A shopping-list surface opened on purpose (the recipe sheet, the week drawer; the
 * edit-meal drawer's passive panel does not log this). `sections` = recipe sections shown
 * (1 for the recipe page), `lines` = ingredient lines offered, `exactMerges` = identical
 * lines merged at open into "In More Than One Meal" (always 0 for the recipe page), so how
 * often a week's recipes share a line is measurable.
 */
export function logShoppingSheetOpened(args: {
  kind: ShoppingListKind;
  sections: number;
  lines: number;
  exactMerges: number;
}): void {
  logEvent({
    level: 'info',
    surface: SHOPPING_LIST_SURFACE,
    message: 'shopping-list surface opened',
    context: {
      action: 'sheet_opened',
      kind: args.kind,
      count: args.sections,
      ingredient_count: args.lines,
      inferred_count: args.exactMerges,
    },
  });
}

export interface ShoppingListCommit {
  destination: ShoppingDestination;
  /** The item titles to write (already cleaned by `linesToTitles`). */
  titles: string[];
  /** The New List name when the user left it blank. */
  defaultTitle: string;
  /** Set when the list is made from ONE recipe; a week's list is linked to none. */
  linkedRecipeId?: string;
  kind: ShoppingListKind;
  /** Headings dropped from the recipe(s). #88's `count`, meaning unchanged. */
  headingsSkipped: number;
  /** Recipe sections the titles came from (1 for the recipe page and meal panel). */
  sections: number;
}

export function useShoppingListCommit() {
  const { t } = useTranslation();
  const familyStore = useFamilyStore();
  const listStore = useListStore();
  const recipesStore = useRecipesStore();
  const { openList } = useOpenList();

  const isSubmitting = ref(false);

  /** Resolves to the list written, or null when nothing was (already toasted + reported). */
  async function commit(args: ShoppingListCommit): Promise<FamilyList | null> {
    // Guard AND the callers' bound `is-submitting`: one write is atomic, which prevents a
    // partial list, not a second list. Without this a double-tap makes two.
    if (isSubmitting.value || args.titles.length === 0) return null;

    const memberId = familyStore.currentMember?.id;
    if (!memberId) {
      // `silent`: reported below under a precise surface. An un-silenced error toast
      // auto-reports on the catch-all `app` surface, so one failure would emit two
      // firehose events and double any rate built on `action`.
      showToast('error', t('lists.fromRecipe.noMemberError'), t('lists.fromRecipe.noMemberHelp'), {
        silent: true,
      });
      reportError({
        surface: SHOPPING_LIST_SURFACE,
        message:
          'no current member — refusing to write a shopping list with no creator. Check familyStore.currentMember is resolved before a shopping-list surface can open.',
        severity: 'error',
        context: { action: 'no_current_member', kind: args.kind },
      });
      return null;
    }

    // Read the STORE mirror the page renders, never the projection (MVO).
    if (args.linkedRecipeId && !recipesStore.recipes.some((r) => r.id === args.linkedRecipeId)) {
      showToast(
        'error',
        t('lists.fromRecipe.recipeGoneError'),
        t('lists.fromRecipe.recipeGoneHelp'),
        { silent: true }
      );
      reportError({
        surface: SHOPPING_LIST_SURFACE,
        message:
          'the recipe was deleted while its shopping list was being reviewed — refusing to write a link that would dangle. Likely a delete on another device.',
        severity: 'error',
        context: { action: 'recipe_missing', kind: args.kind },
      });
      return null;
    }

    const { destination } = args;
    isSubmitting.value = true;
    try {
      let written: FamilyList | null;
      if (destination.mode === 'new') {
        written = await listStore.createList(
          buildShoppingListSeed({
            titles: args.titles,
            title: destination.title.trim() || args.defaultTitle,
            ownerId: destination.ownerId || memberId,
            // NOT the owner: the creator is whoever is standing here, and the
            // `list-completed` bell entry depends on the two being distinguishable.
            createdBy: memberId,
            dueDate: destination.dueDate,
            linkedRecipeId: args.linkedRecipeId,
          })
        );
        // Falsy, not `=== null`: the store folds a throw and a graceful stop into one
        // sentinel and has already toasted + reported either way. A second toast here
        // would page twice. The caller keeps its surface open for a retry.
        if (!written) return null;
      } else {
        written = await listStore.addItems(destination.listId, args.titles);
        if (!written) {
          // `addItems` is silent on a missing list by contract (a throw is reported and
          // toasted by `updateList`); only a list that is really gone is ours to explain.
          if (!listStore.lists.some((l) => l.id === destination.listId)) {
            showToast(
              'error',
              t('lists.destination.listGoneError'),
              t('lists.destination.listGoneHelp'),
              { silent: true }
            );
            reportError({
              surface: SHOPPING_LIST_SURFACE,
              message:
                'the chosen shopping list was deleted before the ingredients were added. Likely a delete on another device while the surface was open.',
              severity: 'error',
              context: { action: 'add_items_list_missing', kind: args.kind },
            });
          }
          return null;
        }
      }

      logEvent({
        level: 'info',
        surface: SHOPPING_LIST_SURFACE,
        message:
          destination.mode === 'new'
            ? 'shopping list created from ingredients'
            : 'ingredients added to a shopping list',
        context: {
          action: destination.mode === 'new' ? 'list_created' : 'items_added',
          kind: args.kind,
          count: args.headingsSkipped,
          ingredient_count: args.titles.length,
          stage: destination.mode,
          detail: sectionsBucket(args.sections),
        },
      });

      // An action toast, not a bare one: a list the user cannot get to is a dead end. The
      // longer dismiss is what `durationMs` exists for; an action nobody has time to tap
      // is not an action. (Interactive toasts are exempt from dedupe.)
      const listId = written.id;
      showToast(
        'success',
        destination.mode === 'new'
          ? t('lists.fromRecipe.created')
          : t('lists.destination.itemsAdded'),
        undefined,
        {
          actionLabel: t('lists.fromRecipe.view'),
          actionFn: () => openList(listId),
          durationMs: 8000,
        }
      );
      return written;
    } finally {
      isSubmitting.value = false;
    }
  }

  return { commit, isSubmitting };
}
