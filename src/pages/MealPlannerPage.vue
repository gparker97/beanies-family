<script setup lang="ts">
/**
 * Meal Planner (#27) — the week-first "meal board". Desktop/tablet shows the
 * cookbook rail + days-across week grid; mobile shows a single-day stack. Hosts
 * the single MealEditModal + MealPickerSheet, copy-week (overwrite-warned), and
 * day/week share. All CRDT work goes through mealPlanStore (MVO).
 */
import { ref, computed } from 'vue';
import { useCalendarSlide } from '@/composables/useCalendarSlide';
import RecipeRail from '@/components/mealplan/RecipeRail.vue';
import MealWeekBoard from '@/components/mealplan/MealWeekBoard.vue';
import MealDayStack from '@/components/mealplan/MealDayStack.vue';
import MealEditModal from '@/components/mealplan/MealEditModal.vue';
import MealPickerSheet from '@/components/mealplan/MealPickerSheet.vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useWeekNavigation } from '@/composables/useCalendarNavigation';
import { SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import { useTranslation } from '@/composables/useTranslation';
import { useTranslationStore } from '@/stores/translationStore';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { mealDisplayName } from '@/utils/mealDisplayName';
import ExportSheet from '@/components/export/ExportSheet.vue';
import MealPlanExportBody from '@/components/export/MealPlanExportBody.vue';
import ExportPeopleLegend from '@/components/export/ExportPeopleLegend.vue';
import { useSheetExportRunner } from '@/composables/useSheetExportRunner';
import { useExportMemberResolver } from '@/composables/useExportMemberResolver';
import {
  buildMealExportRows,
  type MealResolvers,
  type MealExportRows,
} from '@/utils/mealExportModel';
import { logEvent } from '@/services/telemetry/logEvent';
import { addDays, toDateInputValue, formatDayLong } from '@/utils/date';
import type { MealPlanEntry, MealSlot, LanguageCode } from '@/types/models';

/** The meal body's faces beyond the shared shell's `SHEET_EXPORT_FONTS`. */
const MEAL_EXPORT_FONTS = [
  '500 15px Outfit', // .day-num
  'italic 600 14px Outfit', // .dish.type name
];

/** UI language → BCP-47 locale for the exported weekday headers. */
const WEEKDAY_LOCALE: Record<LanguageCode, string> = { en: 'en-US', zh: 'zh-CN' };

const { t } = useTranslation();
const translationStore = useTranslationStore();
const mealPlanStore = useMealPlanStore();
const recipesStore = useRecipesStore();
const { resolveMember } = useExportMemberResolver();

/** Short weekday + day-of-month for the grid header, localized to the UI
 *  language so a shared picture isn't half-translated (day number is locale-
 *  neutral). */
function dayHeading(dateISO: string): { weekday: string; dayNum: string } {
  const locale = WEEKDAY_LOCALE[translationStore.currentLanguage] ?? 'en-US';
  const d = new Date(`${dateISO}T00:00:00`);
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d),
    dayNum: String(d.getDate()),
  };
}

// ── Week navigation (desktop) + day navigation (mobile) ─────────────────────
const referenceDate = ref(new Date());
const { weekDays, weekLabel, prevWeek, nextWeek, goToToday } = useWeekNavigation(referenceDate);
const weekDates = computed(() => weekDays.value.map((d) => d.dateStr));
const isCurrentWeek = computed(() => weekDays.value.some((d) => d.isToday));

const mobileRef = ref(new Date());
const mobileDate = computed(() => toDateInputValue(mobileRef.value));
const mobileLabel = computed(() => formatDayLong(mobileDate.value));
function prevDay() {
  mobileRef.value = addDays(mobileRef.value, -1);
}
function nextDay() {
  mobileRef.value = addDays(mobileRef.value, 1);
}

/**
 * Swipe the mobile day stack left / right to change day.
 *
 * `useCalendarSlide` is the same composable the day, week and month views use, so the
 * gesture, its thresholds and its iOS-style slide are identical to the calendar rather
 * than a second implementation that would drift. It brings the guardrails with it: an
 * axis lock so vertical scrolling through the slots still works, an edge-ignore so it does
 * not fight iOS Safari's back-swipe, and reduced-motion support that changes the day with
 * no animation.
 *
 * Mobile only by construction — the container is `md:hidden`, so on desktop the element
 * never exists and the listeners are never attached. That also settles the one collision
 * worth checking: `MealCard` is `draggable` for drag-and-drop between cells, and HTML5 drag
 * is a mouse-only API, so the two gestures never contend on the same input.
 */
const mobileSwipeRef = ref<HTMLElement | null>(null);
useCalendarSlide(mobileSwipeRef, { onNext: nextDay, onPrev: prevDay });

// ── Editor + picker (single hosted instances) ───────────────────────────────
const editMeal = ref<MealPlanEntry | null>(null);
const editorOpen = ref(false);
function openMeal(meal: MealPlanEntry) {
  editMeal.value = meal;
  editorOpen.value = true;
}

const pickerOpen = ref(false);
const pickerTarget = ref<{ date: string; slot: MealSlot }>({ date: '', slot: 'dinner' });
function openPicker(date: string, slot: MealSlot) {
  pickerTarget.value = { date, slot };
  pickerOpen.value = true;
}

// ── Copy week ───────────────────────────────────────────────────────────────
/** The actual current calendar week's dates (target for "copy to this week"). */
function currentWeekDates(): string[] {
  const ref2 = ref(new Date());
  return useWeekNavigation(ref2).weekDays.value.map((d) => d.dateStr);
}

async function doCopy(fromDates: string[], toDates: string[]) {
  if (!mealPlanStore.weekHasMeals(fromDates)) {
    showToast('info', t('mealPlanner.copy.empty'), t('mealPlanner.copy.emptyHelp'));
    return;
  }
  // Capture BEFORE the copy — afterwards the target always holds meals, so the
  // overwrote metric would be permanently true.
  const overwrote = mealPlanStore.weekHasMeals(toDates);
  if (overwrote) {
    const ok = await confirm({
      title: 'mealPlanner.copy.confirmTitle',
      message: 'mealPlanner.copy.confirmMessage',
      variant: 'info',
      confirmLabel: 'mealPlanner.copy.confirmLabel',
    });
    if (!ok) return;
  }
  const ok = await mealPlanStore.copyWeek(fromDates, toDates);
  if (ok) {
    showToast('success', t('mealPlanner.copy.done'));
    logEvent({
      level: 'info',
      surface: 'meal-planner',
      message: 'week copied',
      context: { action: 'week-copied', overwrote },
    });
  }
}

function copyLastWeek() {
  const prevDates = weekDays.value.map((d) => toDateInputValue(addDays(d.date, -7)));
  void doCopy(prevDates, weekDates.value);
}
function copyViewedToCurrent() {
  void doCopy(weekDates.value, currentWeekDates());
}

// ── Clear ─────────────────────────────────────────────────────────────────────
async function clearWeek() {
  const ok = await confirm({
    title: 'mealPlanner.clear.weekTitle',
    message: 'mealPlanner.clear.weekMessage',
    variant: 'danger',
    confirmLabel: 'mealPlanner.clear.confirmLabel',
  });
  if (ok) await mealPlanStore.clearDates(weekDates.value);
}
async function clearDay(date: string) {
  const ok = await confirm({
    title: 'mealPlanner.clear.dayTitle',
    message: 'mealPlanner.clear.dayMessage',
    // NAMES THE DAY. Seven identical ✕ buttons sit across the board and the copy is
    // "Clear this day?" — so the confirm could not tell you which column was about to be
    // wiped, and the wrong one is unrecoverable. `detail` is a plain string by contract,
    // which is why the date is formatted here rather than interpolated into a key.
    detail: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    variant: 'danger',
    confirmLabel: 'mealPlanner.clear.confirmLabel',
  });
  if (ok) await mealPlanStore.clearDates([date]);
}

// ── Share / export the week ──────────────────────────────────────────────────

/**
 * The footer key, built from what the sheet actually contains.
 *
 * It used to be a fixed "⏰ serve time · 👥 guests" printed on every export, so a plan
 * with neither still carried a key for two symbols that appeared nowhere — which reads as
 * "these are missing" rather than "these do not apply", and sends the reader looking.
 */
const exportHint = computed(() => {
  const rows = exportRows.value;
  if (!rows) return '';
  const parts: string[] = [];
  if (rows.hasServeTime) parts.push(t('mealPlanner.export.legendServeTime'));
  if (rows.hasGuests) parts.push(t('mealPlanner.export.legendGuests'));
  return parts.join(' · ');
});
// Resolver object handed to `buildMealExportRows` so a meal is named/attributed
// identically across the exported grid.
const mealResolvers = computed<MealResolvers>(() => ({
  dayHeading,
  slotLabel: (s: MealSlot) => t(SLOT_LABEL_KEYS[s]),
  mealName: (m) => mealDisplayName(m, recipesStore.recipes, t),
  cook: resolveMember,
}));

// ── Export the week as an image / PDF ────────────────────────────────────────
// One layout source (the off-screen ExportSheet) → PNG (Share → OS share sheet)
// or PDF (download on desktop/Android; share sheet on iOS, where <a download>
// can't save). The sheet always renders the whole viewed WEEK.
const exportRows = ref<MealExportRows | null>(null);
const sheetComp = ref<{ $el: HTMLElement } | null>(null);

const {
  exportMounting,
  exportingFormat,
  exporting,
  run: runExport,
} = useSheetExportRunner({
  surface: 'plan-export',
  perfName: 'plan-export',
  build: () => {
    exportRows.value = buildMealExportRows(
      mealPlanStore.mealsForWeek(weekDates.value),
      weekDates.value,
      mealResolvers.value
    );
  },
  el: () => sheetComp.value?.$el,
  filename: () => `beanies-meal-plan-${weekDates.value[0]}`,
  kind: { image: 'meal-plan-png', pdf: 'meal-plan-pdf' },
  shareTitle: () => t('mealPlanner.share.title'),
  failedKey: 'mealPlanner.export.failed',
  failedHelpKey: 'mealPlanner.export.failedHelp',
  fonts: MEAL_EXPORT_FONTS,
});
</script>

<template>
  <div class="flex flex-col px-3 py-5 sm:px-6 md:h-full">
    <!-- Header -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="font-outfit text-secondary-500 dark:text-ink text-2xl font-bold">
          🍲 {{ t('mealPlanner.title') }}
        </h1>
        <PageWelcomeSubtitle :text="t('mealPlanner.welcome')" />
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="isCurrentWeek"
          type="button"
          class="font-outfit text-secondary-500 dark:text-ink rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold"
          @click="copyLastWeek"
        >
          ⧉ {{ t('mealPlanner.copyLastWeek') }}
        </button>
        <button
          v-else
          type="button"
          class="font-outfit text-secondary-500 dark:text-ink rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold"
          @click="copyViewedToCurrent"
        >
          ⧉ {{ t('mealPlanner.copyHere') }}
        </button>
        <!-- Two conventional actions: social Share (image → OS share sheet) and
             Export as PDF (downloads the week). Both always cover the week. -->
        <button
          type="button"
          class="from-primary-500 to-terracotta-400 font-outfit inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          :disabled="exporting"
          @click="runExport('image')"
        >
          <BeanieIcon v-if="exportingFormat !== 'image'" name="share" size="sm" />
          {{
            exportingFormat === 'image'
              ? t('mealPlanner.export.building')
              : t('mealPlanner.export.share')
          }}
        </button>
        <button
          type="button"
          class="font-outfit text-secondary-500 dark:text-ink inline-flex items-center gap-1.5 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
          :disabled="exporting"
          @click="runExport('pdf')"
        >
          <BeanieIcon v-if="exportingFormat !== 'pdf'" name="download" size="sm" />
          {{
            exportingFormat === 'pdf'
              ? t('mealPlanner.export.building')
              : t('mealPlanner.export.exportPdf')
          }}
        </button>
      </div>
    </div>

    <!-- Week nav (desktop) -->
    <div class="mt-4 hidden items-center gap-3 md:flex">
      <button type="button" class="mp-arrow" :aria-label="t('common.previous')" @click="prevWeek">
        ‹
      </button>
      <button type="button" class="mp-arrow" :aria-label="t('common.next')" @click="nextWeek">
        ›
      </button>
      <span class="font-outfit text-secondary-500 dark:text-ink text-base font-bold">{{
        weekLabel
      }}</span>
      <button
        v-if="!isCurrentWeek"
        type="button"
        class="font-outfit dark:text-accent-lift text-sm font-semibold text-[#F15D22]"
        @click="goToToday"
      >
        {{ t('mealPlanner.thisWeek') }}
      </button>
      <span class="flex-1"></span>
      <button
        v-if="mealPlanStore.weekHasMeals(weekDates)"
        type="button"
        class="font-outfit dark:text-ink-soft text-sm font-semibold text-[rgba(44,62,80,0.5)] hover:text-[#F15D22]"
        @click="clearWeek"
      >
        {{ t('mealPlanner.clearWeek') }}
      </button>
    </div>

    <!-- Day nav (mobile) -->
    <div class="mt-4 flex items-center gap-3 md:hidden">
      <button type="button" class="mp-arrow" :aria-label="t('common.previous')" @click="prevDay">
        ‹
      </button>
      <button type="button" class="mp-arrow" :aria-label="t('common.next')" @click="nextDay">
        ›
      </button>
      <span class="font-outfit text-secondary-500 dark:text-ink text-base font-bold">{{
        mobileLabel
      }}</span>
    </div>

    <!-- Board (desktop/tablet): rail + week grid. Fills the leftover vertical
         space (md:flex-1) but caps its height so tall monitors don't stretch the
         four slot rows into cartoonish bands — the remainder stays as margin. The
         cap is generous enough for a full four-slot week; a busier week scrolls
         inside the board (MealWeekBoard is overflow-auto) rather than clipping.
         grid-rows-[minmax(0,1fr)] is load-bearing: a grid's implicit row is
         content-sized, which would let the rail/week-grid grow past the board's
         box (clipping the rail's alternatives). Constraining the single row to
         the board height forces both columns to fit and scroll internally. -->
    <div
      class="dark:bg-surface-raised mt-4 hidden overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--soft-shadow)] md:grid md:max-h-[52rem] md:min-h-0 md:flex-1 md:grid-cols-[15rem_1fr] md:grid-rows-[minmax(0,1fr)]"
    >
      <RecipeRail />
      <MealWeekBoard
        :week-days="weekDays"
        @open-meal="openMeal"
        @add-meal="openPicker"
        @clear-day="clearDay"
      />
    </div>

    <!-- Day stack (mobile) -->
    <!--
      `touch-action: pan-y` is required, not decorative: without it the browser claims the
      horizontal pan before our pointer handler sees it, and the swipe silently never fires.
      Same pairing every calendar view uses.
    -->
    <div
      ref="mobileSwipeRef"
      class="dark:bg-surface-raised mt-4 overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--soft-shadow)] md:hidden"
      style="touch-action: pan-y; will-change: transform"
    >
      <MealDayStack :date="mobileDate" @open-meal="openMeal" @add-meal="openPicker" />
    </div>

    <!-- Modals -->
    <MealEditModal :open="editorOpen" :meal="editMeal" @close="editorOpen = false" />
    <MealPickerSheet
      :open="pickerOpen"
      :date="pickerTarget.date"
      :meal-slot="pickerTarget.slot"
      @close="pickerOpen = false"
    />

    <!-- Off-screen export sheet: rendered declaratively so it inherits Pinia /
         i18n / theme; unmounted by useSheetExportRunner's `finally`, so a thrown
         error can never leak it. -->
    <div v-if="exportMounting" class="export-host" aria-hidden="true">
      <ExportSheet
        ref="sheetComp"
        :heading="t('mealPlanner.export.heading')"
        :accent="t('mealPlanner.export.accent')"
        :date-label="t('mealPlanner.export.weekOf')"
        :date-range="weekLabel"
        :tagline="t('app.tagline')"
      >
        <MealPlanExportBody v-if="exportRows" :rows="exportRows" />
        <template #legend>
          <ExportPeopleLegend
            v-if="exportRows"
            :label="t('mealPlanner.export.cooksLabel')"
            :people="exportRows.cooks"
            :hint="exportHint"
          />
        </template>
      </ExportSheet>
    </div>
  </div>
</template>

<style scoped>
.mp-arrow {
  background: white;
  border: 1.5px solid rgb(44 62 80 / 12%);
  border-radius: 0.75rem;
  color: var(--color-secondary-500);
  display: grid;
  font-size: 1rem;
  height: 2.25rem;
  place-items: center;
  width: 2.25rem;
}

.dark .mp-arrow {
  background: var(--color-slate-800, #1e2a36);
}

/* Off-screen host for the export sheet: kept in the layout (so fonts/images
   load and it has real dimensions to rasterise) but pushed far off-screen and
   out of the a11y tree. Mirrors the existing off-screen pattern in
   useFilePicker.ts. */
.export-host {
  left: -99999px;
  pointer-events: none;
  position: fixed;
  top: 0;
}
</style>
