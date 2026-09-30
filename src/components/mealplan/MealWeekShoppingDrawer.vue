<script setup lang="ts">
/**
 * The week's shopping list (#116): one section per recipe planned in the visible week,
 * ingredients AS WRITTEN with a Cook ×N count (who's eating vs the recipe's servings, nobody
 * picked = everyone), then one save to a New List or to a list the family already has.
 *
 * Duplicates sit in ONE "In More Than One Meal" section at the top: identical lines merge at
 * open (`mergeExactDuplicates`, no AI), and ✨ Find Duplicates asks magic beans once for the
 * same item written differently (`useFindDuplicates` owns the call, consent, toasts and its
 * telemetry; this drawer only reacts to the status). Every merged line is shown before save
 * and can be Split. The drawer's whole state is ONE `WeekShoppingState` replaced through the
 * pure reducer in `shoppingMerge.ts`.
 *
 * The sections are a SNAPSHOT taken at open; an edit elsewhere while the drawer is up never
 * rewrites lines the user is reviewing. One Find Duplicates run per open: each open gets its
 * own `AbortController`, and close aborts AND clears it, so a late answer is `stale` and is
 * dropped without a toast.
 *
 * A list made from the week is linked to no recipe (`linkedRecipeId` is single-valued).
 * The save, its guards, toasts and telemetry are `useShoppingListCommit`'s.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import IngredientChecklist from '@/components/pod/IngredientChecklist.vue';
import ShoppingListDestination from '@/components/pod/ShoppingListDestination.vue';
import CookCountPill from '@/components/mealplan/CookCountPill.vue';
import MagicBeansCardButton from '@/components/ai/MagicBeansCardButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAiCapability } from '@/composables/useAiCapability';
import { useMagicReader } from '@/composables/useMagicReader';
import { showToast } from '@/composables/useToast';
import { useFindDuplicates } from '@/composables/useFindDuplicates';
import {
  logShoppingSheetOpened,
  newListDestination,
  shoppingSaveLabel,
  useShoppingListCommit,
  type ShoppingDestination,
} from '@/composables/useShoppingListCommit';
import { logEvent } from '@/services/telemetry/logEvent';
import { useFamilyStore } from '@/stores/familyStore';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useTranslationStore } from '@/stores/translationStore';
import {
  buildWeekShoppingSections,
  linesToTitles,
  type ChecklistLine,
  type ShoppingSection,
  type ShoppingSectionMeal,
} from '@/utils/mealShoppingList';
import {
  applyDuplicateGroups,
  dedupeCandidates,
  dedupeRecipeCount,
  mergeExactDuplicates,
  restoreMergedLine,
  splitMergedLine,
  splitSnapshotOf,
  type SplitSnapshot,
  type WeekShoppingState,
} from '@/utils/shoppingMerge';
import { DEDUPE_MAX_PAYLOAD_BYTES } from '@/utils/dedupePayload';
import { formatServes } from '@/utils/recipeServings';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatUiDate } from '@/utils/uiLocale';

const props = defineProps<{ open: boolean; weekDates: string[] }>();
const emit = defineEmits<{ close: [] }>();

/** Same surface as `useFindDuplicates`, so one CloudWatch filter isolates the feature. */
const DUPES_SURFACE = 'meal-shopping-dupes';

const { t } = useTranslation();
const familyStore = useFamilyStore();
const mealPlanStore = useMealPlanStore();
const recipesStore = useRecipesStore();
const translationStore = useTranslationStore();
const { commit, isSubmitting } = useShoppingListCommit();
const { canReadAny } = useMagicReader();
const aiCapability = useAiCapability();
const { running, find } = useFindDuplicates();

const state = ref<WeekShoppingState>({ sections: [], merged: [] });
const destination = ref<ShoppingDestination>(newListDestination(''));

/** This open's run token; `null` while closed. */
let controller: AbortController | null = null;
/** What this open's ✨ Find Duplicates run came to: not run yet, merged some, found none. */
const dupesOutcome = ref<'idle' | 'found' | 'none'>('idle');
const foundCount = ref(0);
/**
 * The polite live region's text: the outcome of a run, ONLY when focus could not be moved to the
 * element that shows it. Focus is the announcement a screen reader reliably makes (it reads the
 * focused tile or header, which carries the same words); announcing both read it twice.
 */
const announcement = ref('');
const mergedHeader = ref<HTMLElement | null>(null);
const noneTile = ref<HTMLElement | null>(null);

function closeRun(): void {
  controller?.abort();
  controller = null;
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      closeRun();
      return;
    }
    const recipes = new Map(recipesStore.recipes.map((r) => [r.id, r]));
    const sections = buildWeekShoppingSections(
      mealPlanStore.mealsForWeek(props.weekDates),
      recipes,
      familyStore.humans.map((m) => m.id)
    );
    state.value = mergeExactDuplicates({ sections, merged: [] });
    closeRun();
    controller = new AbortController();
    dupesOutcome.value = 'idle';
    foundCount.value = 0;
    announcement.value = '';
    // Reset on every open: a due date left over from last week would arm a reminder
    // for a shop nobody dated.
    destination.value = newListDestination(familyStore.currentMember?.id ?? '');
    logShoppingSheetOpened({
      kind: 'week',
      sections: sections.length,
      lines: sections.reduce((n, s) => n + s.lines.length, 0),
      exactMerges: state.value.merged.length,
    });
  },
  { immediate: true }
);
onBeforeUnmount(closeRun);

const sections = computed(() => state.value.sections);

/** "Sep 28" (en-US) or "9月28日", in the UI language rather than the browser's. */
const weekStart = computed(() =>
  props.weekDates[0]
    ? formatUiDate(props.weekDates[0], translationStore.currentLanguage, {
        month: 'short',
        day: 'numeric',
      })
    : ''
);

const subtitle = computed(() => {
  const r = sections.value.length;
  const m = sections.value.reduce((n, s) => n + s.meals.length, 0);
  return fillTemplate(t('mealPlanner.shopping.subtitle'), {
    date: weekStart.value,
    recipes:
      r === 1
        ? t('mealPlanner.shopping.recipes.one')
        : fillTemplate(t('mealPlanner.shopping.recipes.other'), { n: String(r) }),
    meals:
      m === 1
        ? t('mealPlanner.shopping.meals.one')
        : fillTemplate(t('mealPlanner.shopping.meals.other'), { n: String(m) }),
  });
});

const defaultTitle = computed(() =>
  fillTemplate(t('mealPlanner.shopping.listTitle'), { date: weekStart.value })
);

const titles = computed(() =>
  linesToTitles([...state.value.merged, ...sections.value.flatMap((s) => s.lines)])
);
const saveLabel = computed(() => shoppingSaveLabel(destination.value, titles.value.length, t));

/** "Serves 4", or "No servings set, so one batch per meal." */
function whyLine(s: ShoppingSection): string {
  return s.servings === undefined
    ? t('mealPlanner.shopping.noServingsPerMeal')
    : formatServes(s.servings, t);
}

/** "Tue, 5 Eating" or "Thu, Everyone (5)". */
function mealPill(m: ShoppingSectionMeal): string {
  const day = formatUiDate(m.date, translationStore.currentLanguage, { weekday: 'short' });
  return fillTemplate(
    t(m.everyone ? 'mealPlanner.shopping.everyonePill' : 'mealPlanner.shopping.eatingPill'),
    { day, n: String(m.eating) }
  );
}

// ── Duplicates ──────────────────────────────────────────────────────────────────────

const recipeNames = computed(
  () => new Map(sections.value.map((s) => [s.recipeId, s.recipeName] as const))
);

/**
 * Could the card show at all, before looking at the lines: the same gate as every other magic
 * beans affordance (a reader the member may use AND a configured AI tier), 2+ recipes, and no
 * run back yet this open. Checked FIRST, so the line walk below never runs (on every tick or
 * edit) for a member who could not use it anyway.
 */
const findCardAllowed = computed(
  () =>
    dupesOutcome.value === 'idle' &&
    canReadAny.value &&
    aiCapability.isConfigured.value &&
    sections.value.length >= 2
);

/**
 * The card: allowed, and lines from 2+ recipes left to compare (a group merges across recipes).
 * Only the recipe count is reactive; the bounded payload is built at tap time.
 */
const showFindCard = computed(() => findCardAllowed.value && dedupeRecipeCount(state.value) >= 2);
/** BYOK users pay their own provider, so "Free" is only true on the managed tier. */
const showFreeTag = computed(() => aiCapability.tier.value === 'managed');

const foundLabel = computed(() =>
  foundCount.value === 1
    ? t('mealPlanner.shopping.dupes.found.one')
    : fillTemplate(t('mealPlanner.shopping.dupes.found.other'), { n: String(foundCount.value) })
);
async function onFindDuplicates(): Promise<void> {
  const run = controller;
  if (!run || running.value || !showFindCard.value) return;
  // Built from the list as it is at the tap (bounded so the read stays free).
  const { payload, idMap, skipped } = dedupeCandidates(state.value, DEDUPE_MAX_PAYLOAD_BYTES);
  if (payload.length === 0) return;
  const { status, groups } = await find(payload, run, { skipped });
  // declined / failed / offline: the card stays for another tap (the composable toasted).
  // stale, or a result from a previous open: dropped.
  if (status !== 'done' || run !== controller) return;
  const result = applyDuplicateGroups(state.value, groups, idMap);
  state.value = result.state;
  foundCount.value = result.applied;
  dupesOutcome.value = result.applied > 0 ? 'found' : 'none';
  logEvent({
    level: 'info',
    surface: DUPES_SURFACE,
    message: 'groups applied',
    // `find_done` (the composable) counts groups returned; only here is it known how many
    // survived validation against the list.
    context: { action: 'groups_applied', count: result.applied, inferred_count: result.dropped },
  });
  // The card that had focus is gone: move focus to what replaced it. A run that found nothing
  // is replaced by the "No other duplicates" tile, even when exact merges put a merged header
  // on screen too.
  await nextTick();
  const target = dupesOutcome.value === 'none' ? noneTile.value : mergedHeader.value;
  if (target) target.focus();
  else
    announcement.value =
      dupesOutcome.value === 'none' ? t('mealPlanner.shopping.dupes.none') : foundLabel.value;
}

function recipeNameOf(id: string): string {
  return recipeNames.value.get(id) ?? '';
}

async function onSplit(line: ChecklistLine): Promise<void> {
  const snapshot = splitSnapshotOf(state.value, line.id);
  if (!snapshot) return;
  const kind = line.merged ?? 'exact';
  logEvent({
    level: 'info',
    surface: DUPES_SURFACE,
    message: 'merged line split',
    context: { action: 'split', kind },
  });
  state.value = splitMergedLine(state.value, line.id);
  // The house Undo toast. Bound to THIS open: after a close or reopen the parts are gone, so
  // the undo is skipped (and logged) rather than applied to a different list.
  const openRun = controller;
  showToast(
    'info',
    fillTemplate(t('mealPlanner.shopping.dupes.splitDone'), {
      n: String(snapshot.parts.length),
    }),
    undefined,
    {
      actionLabel: t('action.undo'),
      actionFn: () => undoSplit(snapshot, openRun, kind),
      durationMs: 6000,
    }
  );
  // The Split button that had focus is gone.
  await nextTick();
  mergedHeader.value?.focus();
}

function undoSplit(
  snapshot: SplitSnapshot,
  openRun: AbortController | null,
  kind: 'exact' | 'ai'
): void {
  const restored =
    openRun !== null && openRun === controller
      ? restoreMergedLine(state.value, snapshot)
      : state.value;
  if (restored === state.value) {
    // A part was edited, merged again, or the drawer was closed since: nothing to put back.
    logEvent({
      level: 'info',
      surface: DUPES_SURFACE,
      message: 'undo split skipped',
      context: {
        action: 'undo_split_skipped',
        kind,
        stage: openRun !== null && openRun === controller ? 'changed' : 'closed',
      },
    });
    return;
  }
  state.value = restored;
  logEvent({
    level: 'info',
    surface: DUPES_SURFACE,
    message: 'split undone',
    context: { action: 'undo_split', kind },
  });
}

async function onSave(): Promise<void> {
  if (titles.value.length === 0) return;
  const written = await commit({
    destination: destination.value,
    titles: titles.value,
    defaultTitle: defaultTitle.value,
    kind: 'week',
    headingsSkipped: sections.value.reduce((n, s) => n + s.headingsSkipped, 0),
    sections: sections.value.length,
  });
  // A refusal or failure is already toasted + reported; stay open for a retry.
  if (written) emit('close');
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    variant="drawer"
    :title="t('mealPlanner.shopping.title')"
    icon="🛒"
    icon-bg="var(--tint-success-10)"
    :save-label="saveLabel"
    :save-disabled="titles.length === 0"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onSave"
  >
    <div class="space-y-4">
      <p
        class="font-inter dark:text-ink-soft text-sm text-[var(--color-text-muted)]"
        data-testid="week-shopping-subtitle"
      >
        {{ subtitle }}
      </p>

      <!-- Persistent, so a result is announced (a region that appears together with its text is
           not reliably read out). Filled only when focus could not move to the result. -->
      <p class="sr-only" aria-live="polite" data-testid="dupes-announce">{{ announcement }}</p>

      <MagicBeansCardButton
        v-if="showFindCard"
        class="px-4 py-3"
        :busy="running"
        data-testid="find-duplicates"
        @click="onFindDuplicates"
      >
        <span class="flex items-center gap-2.5">
          <!-- While the read is in flight: two drawn sparks twinkle around the ✨ (inside the
               card, which clips), the label sweeps (`.magic-text-shimmer`, re-inked for the
               orange card below) and the card's sheen runs fast (`busy`). Reduced motion stops
               all three through the shared CSS. -->
          <span class="relative inline-flex" aria-hidden="true">
            ✨
            <template v-if="running">
              <span
                class="magic-sparkle pointer-events-none -top-1.5 -right-2 h-2.5 w-2.5 text-white"
                data-testid="find-duplicates-sparkle"
              />
              <span
                class="magic-sparkle pointer-events-none -bottom-1 -left-2 h-2 w-2 text-white"
                style="animation-delay: 1.1s"
              />
            </template>
          </span>
          <span
            v-if="running"
            class="font-outfit dupes-running-label magic-text-shimmer min-w-0 flex-1 text-base font-bold"
            data-testid="find-duplicates-running"
          >
            {{ t('mealPlanner.shopping.dupes.running') }}
          </span>
          <span v-else class="font-outfit min-w-0 flex-1 text-base font-bold">
            {{ t('mealPlanner.shopping.dupes.find') }}
          </span>
          <span
            v-if="showFreeTag && !running"
            class="font-outfit rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold text-white"
            data-testid="find-duplicates-free"
          >
            {{ t('mealPlanner.shopping.dupes.free') }}
          </span>
        </span>
      </MagicBeansCardButton>

      <div
        v-else-if="dupesOutcome === 'none'"
        ref="noneTile"
        tabindex="-1"
        class="font-outfit dark:bg-surface-overlay dark:text-ink-soft dark:focus-visible:ring-offset-surface-raised flex items-center gap-1.5 rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5 text-sm font-semibold text-[var(--color-text-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:ring-offset-2"
        data-testid="dupes-none"
      >
        <span aria-hidden="true">✨</span>{{ t('mealPlanner.shopping.dupes.none') }}
      </div>

      <section
        v-if="state.merged.length > 0"
        class="dark:border-line dark:bg-surface-overlay rounded-2xl border border-transparent bg-[var(--tint-silk-20)] px-3 pt-3 pb-1"
        data-testid="week-shopping-merged"
      >
        <IngredientChecklist v-model="state.merged" :addable="false">
          <template #title>
            <h3
              ref="mergedHeader"
              tabindex="-1"
              class="font-outfit text-secondary-500 dark:text-ink dark:focus-visible:ring-offset-surface-overlay flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md text-base leading-snug font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:ring-offset-2"
              data-testid="week-shopping-merged-title"
            >
              {{ t('mealPlanner.shopping.dupes.title') }}
              <span
                class="font-inter dark:text-ink-soft text-xs font-semibold text-[var(--color-text-muted)] tabular-nums"
              >
                {{ state.merged.length }}
              </span>
              <span
                v-if="dupesOutcome === 'found'"
                class="font-outfit text-primary-600 dark:text-accent-lift inline-flex items-center gap-1 text-xs font-bold"
                data-testid="dupes-found"
              >
                <span aria-hidden="true">✨</span>{{ foundLabel }}
              </span>
            </h3>
          </template>
          <template #line-extra="{ line }">
            <div class="mt-1 flex flex-wrap items-center gap-1.5" data-testid="merged-line-extra">
              <span
                v-for="rid in line.recipeIds ?? []"
                :key="rid"
                class="font-outfit dark:bg-surface-hover dark:text-ink-soft max-w-full rounded-full bg-white px-2 py-0.5 text-xs font-semibold wrap-anywhere text-[var(--color-text-muted)]"
                data-testid="merged-source-pill"
              >
                {{ recipeNameOf(rid) }}
              </span>
              <span
                v-if="line.merged === 'ai'"
                role="img"
                :aria-label="t('ingredients.byMagic')"
                class="text-primary-600 dark:text-accent-lift text-xs"
                data-testid="merged-by-magic"
                >✨</span
              >
              <button
                type="button"
                class="font-outfit text-primary-600 dark:text-accent-lift text-xs font-semibold underline underline-offset-2"
                :aria-label="fillTemplate(t('ingredients.splitAria'), { item: line.text })"
                data-testid="merged-split"
                @click="onSplit(line)"
              >
                {{ t('ingredients.split') }}
              </button>
            </div>
          </template>
        </IngredientChecklist>
      </section>

      <section
        v-for="s in state.sections"
        :key="s.recipeId"
        class="dark:border-line dark:bg-surface-overlay rounded-2xl border border-[var(--tint-slate-10)] bg-white px-3 pt-3 pb-1"
        data-testid="week-shopping-section"
      >
        <IngredientChecklist v-model="s.lines" :headings-skipped="s.headingsSkipped">
          <template #title>
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <h3
                  class="font-outfit text-secondary-500 dark:text-ink text-base leading-snug font-bold wrap-anywhere"
                >
                  {{ s.recipeName }}
                </h3>
                <p
                  class="font-inter dark:text-ink-soft mt-0.5 text-xs text-[var(--color-text-muted)]"
                >
                  {{ whyLine(s) }}
                </p>
              </div>
              <CookCountPill :count="s.batches" />
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              <span
                v-for="(m, i) in s.meals"
                :key="`${m.date}-${m.slot}-${i}`"
                class="font-outfit dark:bg-surface-hover dark:text-ink-soft max-w-full rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-xs font-semibold wrap-anywhere text-[var(--color-text-muted)] tabular-nums"
                data-testid="meal-pill"
              >
                {{ mealPill(m) }}
              </span>
            </div>
          </template>
        </IngredientChecklist>
      </section>

      <div>
        <p
          class="font-outfit dark:text-ink-faint mb-2 text-xs font-bold tracking-wider text-[var(--color-text-muted)] uppercase"
        >
          {{ t('lists.destination.heading') }}
        </p>
        <ShoppingListDestination v-model="destination" :default-title="defaultTitle" />
      </div>
    </div>
  </BeanieFormModal>
</template>

<style scoped>
/*
 * The shared wait sweep (`.magic-text-shimmer`) is inked for a page or card surface (Deep Slate
 * → Heritage Orange). On the orange gradient card an orange stop would vanish into the card, so
 * the tokens are re-set here: white ink with a warm cream highlight, both readable on the card.
 * Tokens ONLY, never `color` (see the warning on `.magic-text-shimmer` in style.css), and the
 * dark rule repeats them because `html.dark .magic-text-shimmer` would otherwise re-ink it.
 */
.dupes-running-label {
  --magic-text-ink: #fff;
  --magic-text-spark: #fde7cf;
}

html.dark .dupes-running-label {
  --magic-text-ink: #fff;
  --magic-text-spark: #fde7cf;
}
</style>
