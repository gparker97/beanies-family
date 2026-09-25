<script setup lang="ts">
/**
 * Family Cookbook — the secret-recipes page at `/pod/cookbook`. Hero
 * banner with stat strip, "Add a recipe" primary action, then a grid
 * of recipe cards. Cards click through to /pod/cookbook/:recipeId.
 *
 * Photos are optional per recipe — the card falls through to a
 * `PolaroidImage` placeholder illustration when no photo is set,
 * matching the mockup's kraft-paper style.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import CookbookControls from '@/components/pod/CookbookControls.vue';
import RecipeTaxonomyBadges from '@/components/pod/RecipeTaxonomyBadges.vue';
import { useCookbookView } from '@/composables/useCookbookView';
import { useRecipeCourseLabel } from '@/composables/useRecipeCourseLabel';
import { fillTemplate } from '@/utils/fillTemplate';
import PolaroidImage from '@/components/pod/shared/PolaroidImage.vue';
import RecipeFormModal from '@/components/pod/RecipeFormModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useRecipePhotoPending } from '@/composables/useRecipePhotoPending';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import MagicBeansDoor from '@/components/ai/MagicBeansDoor.vue';
import MagicReaderPill from '@/components/ai/MagicReaderPill.vue';
import { useMagicReader, useMagicReaderConsumer } from '@/composables/useMagicReader';
import { useRecipeCapture } from '@/composables/useRecipeCapture';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useRecipesStore } from '@/stores/recipesStore';
import { usePermissions } from '@/composables/usePermissions';
import { usePhotoStore } from '@/stores/photoStore';
import { useFamilyStore } from '@/stores/familyStore';
import type { Recipe } from '@/types/models';
import { consumeKeptRecipe } from '@/utils/recipeKeepStash';
import { sharedRecipeToPrefill } from '@/utils/recipeShareLink';
import type { RecipePrefill } from '@/utils/recipeExtractionToRecipe';
import type { ResultEnvelope } from '@/types/magicPayload';
import { IN_APP_ENV, refuseIfBusy } from '@/composables/useSharedDocumentIngest';

const router = useRouter();
const { t } = useTranslation();
const recipesStore = useRecipesStore();
const photoStore = usePhotoStore();
const { canEditActivities } = usePermissions();
const familyStore = useFamilyStore();

const modalOpen = ref(false);
const editing = ref<Recipe | null>(null);

// ── Magic-beans recipe reader (#72) ──────────────────────────────────────────
// Orchestration lives in useRecipeCapture, NOT here. This page only: opens the
// consent gate, opens the picker, opens the form with the prefill, and forwards
// the saved id back for the source attach.
const { canReadRecipe } = useMagicReader();
// The consent modal is mounted ONCE in App.vue (#64); this page only asks. The grant is
// held between the gate and the picker's file event — consent runs before the picker opens.
const prefill = ref<RecipePrefill | null>(null);
const prefillEnv = ref<ResultEnvelope | undefined>(undefined);
const { isPending } = useRecipePhotoPending();

/**
 * The ONE way this page opens the recipe form pre-filled.
 *
 * Two things arrive pre-filled now — an AI extraction and a recipe someone was sent (#92) —
 * and `useFormModal` runs `onNew` on the open TRANSITION only, so a caller that sets the
 * prefill in the wrong order gets a blank form and no error. Both paths go through here.
 */
function openWithPrefill(p: RecipePrefill, env?: ResultEnvelope): void {
  // ⚠️ `useFormModal` runs `onNew` on the OPEN TRANSITION only, so setting `modalOpen = true`
  // while it is already true delivers nothing: the prefill is silently dropped and the held
  // source attaches to whatever the user had typed. Close first and reopen on the next tick so
  // there is always a transition to seed from.
  if (modalOpen.value) {
    modalOpen.value = false;
    void nextTick(() => openWithPrefill(p, env));
    return;
  }
  prefill.value = p;
  // Carried down so the form can offer the free "not right?" correction. `undefined` on the
  // refetch path, which is not a magic-beans door and has no kind to have got wrong.
  prefillEnv.value = env;
  editing.value = null;
  modalOpen.value = true;
}

const capture = useRecipeCapture({
  onRecipeReady: (ready) => openWithPrefill(ready.prefill, ready.env),
});

/**
 * A recipe kept from a share link, waiting since before sign-up (#92).
 *
 * Read-and-delete, so it can only land once. It goes through the normal review form rather
 * than straight into the pod — the same rule the inbound share boundary already follows:
 * nothing arriving from outside is persisted without the user confirming it. That also means
 * the save runs through `createRecipe` → `wrapAsync`, which already owns the failure toast
 * and the report, so there is nothing to catch here.
 *
 * A miss is silent BY DESIGN at this end: the common cause is that no recipe was ever kept.
 * The one case where a keep is genuinely lost (iOS clearing storage across the Drive OAuth
 * hop) is warned about on the share page BEFORE the hop, because after it there is nothing
 * left to detect it with.
 *
 * ⚠️ IT WAITS FOR THE ROSTER — it neither consumes without one nor gives up without one.
 * Both halves are load-bearing, and each was a bug in turn:
 *
 *   - Consuming immediately is wrong. On a cold boot straight to /pod/cookbook this page
 *     first mounts in App.vue's chrome-less branch, BEFORE any session exists, so
 *     `canEditActivities` is false and the stash would be destroyed with a permission error.
 *   - Giving up on an empty roster is ALSO wrong, and was the subtler failure. The layout
 *     branch swaps when auth resolves (App.vue step 2) while `loadMembers` runs inside
 *     `loadFamilyData` (step 5), so BOTH mounts see an empty roster and there is no third
 *     mount — `isLoadingData` only drives a `v-show`. The keep was dropped in silence on
 *     exactly the journey the guard existed to protect.
 *
 * A watcher covers both: it fires immediately when the roster is already there (the normal
 * sign-in journey, where `handleSignedIn` routes here after the person picker) and once more
 * when it arrives (the cold boot). It is scope-bound, so a podless session that never loads a
 * roster simply never fires.
 */
let keptRecipeHandled = false;

// ⚠️ A `let` DECLARED FIRST, plus the `handled` flag — not a `const` holding the watcher.
// With `immediate: true` the callback runs DURING the `watch()` call, before the returned
// stop function exists, on the very path that matters most (a roster already loaded). A
// `const` referenced there is in the temporal dead zone, and `?.()` does not help: the
// optional call still READS the binding, which is what throws. Declaring the `let` on its
// own line first makes the read safe (`undefined`), and the flag is what actually makes
// "decide exactly once" true whether or not the watcher has been stopped yet.
let stopKeptRecipeWatch: (() => void) | undefined;
stopKeptRecipeWatch = watch(
  () => familyStore.members.length,
  (count) => {
    if (!count || keptRecipeHandled) return;
    keptRecipeHandled = true;
    consumeKeptRecipeIfAllowed();
    stopKeptRecipeWatch?.();
  },
  { immediate: true }
);

function consumeKeptRecipeIfAllowed(): void {
  const kept = consumeKeptRecipe();
  if (!kept) return;
  // ⚠️ GATED, like every other add affordance on this page. `openWithPrefill` opens the full
  // add form, and neither `RecipeFormModal` nor `recipesStore.createRecipe` checks
  // permission — the gate lives on the call sites. Sharing is deliberately ungated (a
  // view-only member may send a recipe to a friend), so without this a view-only member
  // could open a share link, tap Keep, and reach the add form they can otherwise never
  // reach. The stash is already consumed, so telling them is the only honest option.
  if (!canEditActivities.value) {
    showToast('info', t('recipes.keep.notAllowed'), t('recipes.keep.notAllowedHelp'));
    return;
  }
  openWithPrefill(sharedRecipeToPrefill(kept));
}

// Cross-surface dispatch: the global FAB card sets `pendingMagic` and routes here;
// without this the chip would navigate to the cookbook and then silently do nothing.
// A share arrives already extracted (#64) and is DELIVERED rather than re-read.
//
// It MUST be delivered into THIS `useRecipeCapture()` instance: `deliverRecipe` sets the
// pending source that `attachAfterSave` later consumes, and that state is composable-local.
// A fresh instance would save the recipe with no photo attached — silently.
// ⚠️ The payload-less `else` is UNREACHABLE since #84 deleted `openRecipeReader` along with
// the three magic chips — nothing calls `openReader('recipe')` any more. Kept for the same
// reason as the planner's: the handler signature is shared with 'document', which still uses
// that branch. See `FamilyPlannerPage.vue`.
useMagicReaderConsumer(
  'recipe',
  (payload) => {
    if (payload) capture.deliverRecipe(payload.source, payload.env);
  },
  canReadRecipe
);

const recipes = computed(() => recipesStore.recipes);

// Filter / sort / group state. All rules live in `utils/recipeOrdering.ts`; this is wiring.
// The page's old inline `[...recipes].sort(localeCompare)` is gone — alphabetical recipe order
// now has exactly one definition (`byRecipeName`), shared with `useRecipeSearch`.
const {
  groupBy,
  sortBy,
  course,
  setCourse,
  clearFilter,
  shelves,
  courseCounts,
  totalCount,
  visibleCount,
} = useCookbookView(recipes);
const { courseLabel } = useRecipeCourseLabel();

/** Named for the filtered-empty message. Never reached with a null course. */
const filteredEmptyMessage = computed(() =>
  fillTemplate(t('cookbook.filteredEmpty'), {
    course: course.value ? courseLabel(course.value) : '',
  })
);

const totalCookCount = computed(() => recipesStore.cookLogs.length);

const avgRating = computed(() => {
  if (recipesStore.cookLogs.length === 0) return 0;
  const sum = recipesStore.cookLogs.reduce((acc, c) => acc + c.rating, 0);
  return Math.round((sum / recipesStore.cookLogs.length) * 10) / 10;
});

// Per-recipe hero thumbnail — resolved synchronously via
// `photoStore.getPublicUrl` (ADR-021 public-link rendering). Returns
// null when the recipe has no photos or the first photo is tombstoned
// / unresolved; PolaroidImage renders its placeholder in that case.
function thumbFor(recipe: Recipe): string | null {
  const id = recipe.photoIds?.[0];
  if (!id) return null;
  return photoStore.getPublicUrl(id, 'thumb');
}

function openAdd(): void {
  // The `add-recipe` quick-add intent can fire programmatically, and opening the blank form
  // here would strand an in-flight extraction: `useFormModal` runs `onNew` on the open
  // TRANSITION only, so a prefill arriving afterwards would never apply and the held source
  // would attach to whatever the user typed instead.
  //
  // ⚠️ Asked of the SPINE, not of `capture.isProcessing`. That flag is set only by
  // `processUrl`, which this page no longer calls — every capture here now runs through
  // `MagicBeansDoor`, so a guard written against it is dead code that reads as live.
  // `refuseIfBusy` also says so out loud, where the old guard returned in silence.
  if (refuseIfBusy(IN_APP_ENV)) return;
  // Still dropped: the window between tapping ✨ and choosing a file is not "reading" yet,
  // and a source held from an abandoned capture must never attach to a hand-typed recipe.
  capture.discardPendingSource();
  editing.value = null;
  prefill.value = null;
  prefillEnv.value = undefined;
  modalOpen.value = true;
}

// Quick-add FAB handlers.
//
// - `add-recipe` opens the RecipeFormModal directly.
// - `add-cooklog` with a `recipeId` forwards to the recipe detail page
//   where RecipeDetailPage's existing handler opens the CookLogFormModal.
//   The sheet's picker guarantees recipeId is always present when this
//   action routes through the cookbook index.
useQuickAddIntent(async (action, { recipeId }) => {
  if (action === 'add-recipe') {
    openAdd();
    return;
  }
  if (action === 'add-cooklog' && recipeId) {
    await router.push({ path: `/pod/cookbook/${recipeId}`, query: { action } });
  }
});

function openRecipe(r: Recipe): void {
  router.push(`/pod/cookbook/${r.id}`);
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
  // Abandoning the form drops the held source, so it can never attach to a later recipe.
  prefill.value = null;
  // And the envelope with it. Left behind, the next BLANK Add-Recipe form would offer to
  // correct the PREVIOUS capture — spending its one-use grant on a document the user is no
  // longer looking at, and routing away from the form they are filling in.
  prefillEnv.value = undefined;
  capture.discardPendingSource();
}

/** Save completed — hand the id back so the source document can be attached. */
async function handleSaved(id: string): Promise<void> {
  prefill.value = null;
  prefillEnv.value = undefined;
  await capture.attachAfterSave(id);
}
</script>

<template>
  <div class="space-y-6">
    <header
      class="dark:bg-surface-paper relative mb-6 overflow-hidden rounded-[var(--sq)] border border-[rgb(230_126_34_/_15%)] bg-[#fbf3e3] px-5 py-6 sm:px-9 sm:py-8 dark:border-[rgb(240_160_90_/_18%)]"
    >
      <span
        class="pointer-events-none absolute top-2.5 right-8 text-[9.375rem] opacity-[0.09]"
        style="transform: rotate(-8deg)"
        aria-hidden="true"
      >
        🍳
      </span>
      <button
        type="button"
        class="font-outfit text-secondary-500/60 hover:text-primary-500 dark:text-ink-soft mb-1 flex items-center gap-1 text-xs font-semibold transition-colors"
        @click="router.push('/pod')"
      >
        <BeanieIcon name="chevron-left" size="xs" />
        <span>{{ t('bean.backToPod') }}</span>
      </button>
      <h1
        class="font-outfit text-secondary-500 dark:text-ink text-2xl leading-tight font-extrabold break-words sm:text-3xl sm:leading-none"
      >
        {{ t('cookbook.title') }}
      </h1>
      <p class="font-caveat dark:text-terracotta-lift mt-1 text-xl text-[#E67E22]">
        {{ t('cookbook.subtitle') }}
      </p>

      <div class="relative mt-4 flex flex-wrap items-end gap-4 sm:gap-6">
        <div class="flex flex-col">
          <span
            class="text-primary-500 dark:text-accent-lift font-outfit text-2xl leading-none font-extrabold"
          >
            {{ recipes.length }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 dark:text-ink-soft mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase"
          >
            {{ t('cookbook.stats.recipes') }}
          </span>
        </div>
        <div class="flex flex-col">
          <span
            class="text-primary-500 dark:text-accent-lift font-outfit text-2xl leading-none font-extrabold"
          >
            {{ totalCookCount }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 dark:text-ink-soft mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase"
          >
            {{ t('cookbook.stats.cooked') }}
          </span>
        </div>
        <div v-if="avgRating > 0" class="flex flex-col">
          <span
            class="text-primary-500 dark:text-accent-lift font-outfit text-2xl leading-none font-extrabold"
          >
            ⭐ {{ avgRating }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 dark:text-ink-soft mt-1 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase"
          >
            {{ t('cookbook.stats.avgRating') }}
          </span>
        </div>

        <div class="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
          <!-- The cookbook's door now opens the SAME sheet as every other, so a recipe link,
               a photo, a PDF or pasted text all arrive here — and something that turns out not
               to be a recipe routes to the page that owns it instead of failing. -->
          <MagicBeansDoor hint="recipe">
            <template #trigger="{ open }">
              <MagicReaderPill
                :label="t('ai.magic.perform')"
                :aria-label="t('recipeExtract.reader.aria')"
                @click="open"
              />
            </template>
          </MagicBeansDoor>
          <AddEntityButton
            v-if="canEditActivities"
            :label="t('cookbook.addRecipe')"
            class="w-full sm:w-auto"
            @click="openAdd"
          />
        </div>
      </div>
    </header>

    <CookbookControls
      v-if="recipes.length"
      v-model:group-by="groupBy"
      v-model:sort-by="sortBy"
      :course="course"
      :course-counts="courseCounts"
      :total-count="totalCount"
      @update:course="setCourse($event)"
    />

    <!--
      ONE rendering path. `groupBy: 'none'` returns a single shelf with `titleKey: null`, so
      there is no v-if fork between "flat" and "grouped" — the fork is where a recipe would
      go missing from one branch and not the other.
    -->
    <template v-if="recipes.length && visibleCount">
      <section v-for="shelf in shelves" :key="shelf.key" class="mb-8 last:mb-0">
        <h2
          v-if="shelf.titleKey"
          class="font-outfit text-secondary-500 dark:text-ink mb-3 flex items-center gap-2 text-lg font-bold"
        >
          <span v-if="shelf.emoji" aria-hidden="true">{{ shelf.emoji }}</span>
          {{ t(shelf.titleKey) }}
          <span class="font-inter text-xs font-normal text-[var(--color-text-muted)]">{{
            shelf.items.length
          }}</span>
        </h2>
        <div
          class="grid gap-5"
          style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))"
        >
          <article
            v-for="r in shelf.items"
            :key="r.id"
            class="group dark:bg-surface-raised cursor-pointer overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)] transition-all hover:-translate-y-1 hover:shadow-[var(--card-hover-shadow)]"
            @click="openRecipe(r)"
          >
            <PolaroidImage
              :src="thumbFor(r)"
              :variant-seed="r.id"
              :loading="!thumbFor(r) && isPending(r.id)"
              :caption="
                thumbFor(r)
                  ? undefined
                  : isPending(r.id)
                    ? t('recipeExtract.attaching')
                    : t('cookbook.card.noPhoto')
              "
              aspect-ratio="16 / 10"
            />
            <div class="p-4">
              <h3 class="font-outfit text-secondary-500 dark:text-ink text-base font-bold">
                {{ r.name }}
              </h3>
              <p
                v-if="r.subtitle"
                class="font-inter text-secondary-500/60 dark:text-ink-soft mt-1 text-xs"
              >
                {{ r.subtitle }}
              </p>
              <RecipeTaxonomyBadges :course="r.course" :tags="r.tags" />
              <div
                class="font-inter text-secondary-500/60 dark:text-ink-soft mt-3 flex flex-wrap gap-4 text-xs"
              >
                <span v-if="r.cookTime"
                  >🔥
                  <strong class="font-outfit text-secondary-500 dark:text-ink font-semibold">{{
                    r.cookTime
                  }}</strong></span
                >
                <span v-if="r.prepTime"
                  >🕐
                  <strong class="text-secondary-500 font-outfit dark:text-ink font-semibold">{{
                    r.prepTime
                  }}</strong></span
                >
                <span v-if="r.servings"
                  >🍽️
                  <strong class="text-secondary-500 font-outfit dark:text-ink font-semibold">{{
                    r.servings
                  }}</strong></span
                >
                <span v-if="r.ingredients?.length">
                  🌿
                  <strong class="text-secondary-500 font-outfit dark:text-ink font-semibold">
                    {{ r.ingredients.length }} {{ t('cookbook.card.ingredients') }}
                  </strong>
                </span>
              </div>
            </div>
          </article>

          <!-- The add tile belongs to the LAST shelf only; one per group would be noise. -->
          <AddTile
            v-if="canEditActivities && shelf.key === shelves.at(-1)?.key"
            :label="t('cookbook.addRecipe')"
            min-height="16rem"
            @click="openAdd"
          />
        </div>
      </section>
    </template>

    <!-- Filter matched nothing. Distinct from the empty cookbook, and always offers a way back. -->
    <div
      v-else-if="recipes.length"
      class="dark:bg-surface-raised rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)]"
    >
      <EmptyState
        emoji="🔍"
        :message="filteredEmptyMessage"
        :action-label="t('cookbook.showAll')"
        @action="clearFilter()"
      />
    </div>

    <div
      v-else
      class="dark:bg-surface-raised rounded-[var(--sq)] bg-white px-6 py-12 shadow-[var(--card-shadow)]"
    >
      <EmptyState
        emoji="🍝"
        :message="t('cookbook.empty')"
        :action-label="canEditActivities ? t('cookbook.emptyCTA') : ''"
        @action="openAdd"
      />
    </div>

    <RecipeFormModal
      :open="modalOpen"
      :recipe="editing"
      :prefill="prefill"
      :prefill-env="prefillEnv"
      @close="closeModal"
      @saved="handleSaved"
    />
  </div>
</template>
