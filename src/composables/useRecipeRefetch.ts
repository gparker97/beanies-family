/**
 * Ask beanies to read a recipe's source again (#93).
 *
 * THE GOVERNING IDEA: **a re-fetch is a capture with a different ending.** Every line of the
 * ladder — the JSON-LD rung, the page-text rung, the video rungs, the offline guard, the
 * in-flight guard, the four-way `assertNever` resolver switch, the per-rung telemetry, every
 * `ExtractionErrorCode` toast, the `catch`/`finally` — already exists in `useRecipeCapture`
 * and is reused verbatim. The genuinely new code here is the budget check, the diff, and the
 * modal it opens. **No failure mapping is written for this feature**, because every failure
 * is already mapped.
 *
 * What this second `useRecipeCapture` instance inherits, written down so nobody re-derives
 * it: `processUrl` passes `sourceFile: null` on every rung, so this instance's
 * `pendingSource`/`pendingCompressed` are null by construction and its `attachAfterSave` is
 * dish-only. `isProcessing` and `discardPendingSource` are instance-local, so this instance's
 * in-flight guard and the form modal's cannot interfere.
 */
import { ref } from 'vue';
import { useRecipeCapture } from './useRecipeCapture';
import { useDocumentConsent } from './useDocumentConsent';
import { useTranslation } from './useTranslation';
import { showToast } from './useToast';
import { useRecipesStore } from '@/stores/recipesStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { peekAttempt, consumeAttempt, type BudgetPolicy } from '@/utils/attemptBudget';
import { diffRecipe, type RecipeDiff } from '@/utils/recipeDiff';
import { fillTemplate } from '@/utils/fillTemplate';
import type { RecipePrefill } from '@/utils/recipeExtractionToRecipe';
import type { Recipe } from '@/types/models';

const SURFACE = 'recipe-refetch';

/**
 * One read per recipe per ten minutes.
 *
 * ⚠️ A per-recipe COOLDOWN, not a cost bound, and it must not be described as one. Keyed by
 * recipe id, a family with fifty recipes can still fire fifty reads — which is fine and
 * deliberate: the requirement is that pressing the button repeatedly is not free. The real
 * cost bound is the server's per-family limiter.
 *
 * It lives here rather than beside `SHARE_TEXT_BUDGET` in `services/share/types.ts`, whose
 * header scopes that file to "the one shape every share-target platform implements (#64)". A
 * recipe cooldown there would be cohesion rot for the sake of putting two constants side by
 * side. A cooldown IS a budget of one.
 */
const REFETCH_BUDGET: BudgetPolicy = { max: 1, windowMs: 10 * 60_000 };

/** Embeds a recipe id, so — like `shareTextBudgetKey`'s family id — it is NEVER logged. */
function refetchBudgetKey(recipeId: string): string {
  return `recipe-refetch:${recipeId}`;
}

export function useRecipeRefetch() {
  const { t } = useTranslation();
  const { requestConsent } = useDocumentConsent();
  const recipesStore = useRecipesStore();

  const diff = ref<RecipeDiff | null>(null);
  const isOpen = ref(false);
  /** Held between the fetch and the apply, so a taken photo can go through the real attach. */
  const pendingPrefill = ref<RecipePrefill | null>(null);
  const target = ref<Recipe | null>(null);

  const capture = useRecipeCapture({
    onRecipeReady: ({ prefill }) => {
      const recipe = target.value;
      if (!recipe) return;

      const result = diffRecipe(recipe, prefill);
      if (!result.changed) {
        // "Worked, nothing new" is a different outcome from "did not work", and the failure
        // rate is only meaningful if the two are told apart.
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'refetch found no changes',
          context: { action: 'refetch_nochange' },
        });
        showToast('info', t('recipes.refetch.noChange'));
        return;
      }

      pendingPrefill.value = prefill;
      diff.value = result;
      isOpen.value = true;
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'refetch produced a diff',
        context: {
          action: 'refetch_completed',
          count: result.rows.length,
          detail: result.photo ? 'with_photo' : 'no_photo',
        },
      });
    },
  });

  /**
   * ONE refusal path for both the peek and the consume, so the two can never drift into
   * saying different things — and so a refusal always names when it lifts.
   */
  function refuse(resetsAt: number): void {
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'refetch refused by the local budget',
      // Same vocabulary as the share budget, so the two are one CloudWatch query.
      context: { action: 'refused', detail: 'quota' },
    });
    showToast(
      'info',
      fillTemplate(t('recipes.refetch.cooldown'), {
        resetsAt: new Date(resetsAt).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        }),
      })
    );
  }

  /**
   * Read the source again.
   *
   * Order matters and is the whole of the logic here:
   *   1. peek — refuse cheaply, before asking the user for anything;
   *   2. consent (ADR-030) — a decline is a silent no-op by design;
   *   3. consume — immediately before the call, so a declined consent never burns the slot;
   *   4. hand off to the existing ladder.
   */
  async function start(recipe: Recipe): Promise<void> {
    if (!recipe.sourceUrl) return;

    const key = refetchBudgetKey(recipe.id);
    const peeked = peekAttempt(key, REFETCH_BUDGET);
    if (!peeked.ok) {
      refuse(peeked.resetsAt);
      return;
    }

    // ADR-030: `processUrl` requires a branded `ConsentGrant`, so skipping this gate is a
    // compile error rather than a review question. Stated anyway, because a new mount point
    // inheriting a capture WITHOUT its gate has happened before (RecipeFormModal.vue:286).
    const grant = await requestConsent();
    if (!grant) return;

    const allowed = consumeAttempt(key, REFETCH_BUDGET);
    if (!allowed.ok) {
      refuse(allowed.resetsAt);
      return;
    }

    target.value = recipe;
    await capture.processUrl(recipe.sourceUrl, grant);
  }

  /**
   * Take the changes.
   *
   * ⚠️ `updateRecipe` NEVER THROWS. It runs inside `wrapAsync`, which catches, toasts with
   * the error attached (which IS the Slack path) and returns `undefined`, so the store
   * returns `null`. A `try/catch` here would catch nothing and a second toast would
   * double-report one failure. Check the RETURN VALUE, exactly as `RecipeFormModal.handleSave`
   * does — and log rather than `reportError`, for the same reason.
   */
  async function take(): Promise<void> {
    const recipe = target.value;
    const current = diff.value;
    const prefill = pendingPrefill.value;
    if (!recipe || !current) return;

    if (current.rows.length) {
      const updated = await recipesStore.updateRecipe(recipe.id, current.patch);
      if (!updated) {
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'refetch changes could not be saved',
          context: { action: 'apply_failed' },
        });
        // The store already toasted and reported. Stay open so the user can retry.
        return;
      }
    }

    // The existing attach path: appends via `usePhotos`, honours the four-photo cap and the
    // cloud check, runs the candidate ladder, logs `image_resolved`/`image_none`. The
    // argument is passed, never re-read from a ref — see `attachAfterSave`'s own warning.
    if (current.photo && prefill?.dishImage) {
      void capture.attachAfterSave(recipe.id, prefill.dishImage);
    }

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'refetch changes taken',
      // The acceptance rate is the measure of whether the diff is any good.
      context: { action: 'refetch_applied', count: current.rows.length },
    });
    dismiss();
  }

  function dismiss(): void {
    isOpen.value = false;
    diff.value = null;
    pendingPrefill.value = null;
    target.value = null;
  }

  // Deliberately NOT re-exported: `processFile`, `deliverRecipe`, `discardPendingSource`. A
  // composable that leaks its dependency's whole API is a second public door onto the
  // capture ladder.
  return { start, isProcessing: capture.isProcessing, diff, isOpen, take, dismiss };
}
