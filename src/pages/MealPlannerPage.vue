<script setup lang="ts">
/**
 * Meal Planner (#27) — the week-first "meal board". Desktop/tablet shows the
 * cookbook rail + days-across week grid; mobile shows a single-day stack. Hosts
 * the single MealEditModal + MealPickerSheet, copy-week (overwrite-warned), and
 * day/week share. All CRDT work goes through mealPlanStore (MVO).
 */
import { ref, computed, nextTick } from 'vue';
import RecipeRail from '@/components/mealplan/RecipeRail.vue';
import MealWeekBoard from '@/components/mealplan/MealWeekBoard.vue';
import MealDayStack from '@/components/mealplan/MealDayStack.vue';
import MealEditModal from '@/components/mealplan/MealEditModal.vue';
import MealPickerSheet from '@/components/mealplan/MealPickerSheet.vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useWeekNavigation } from '@/composables/useCalendarNavigation';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { mealDisplayName } from '@/utils/mealDisplayName';
import ExportSheet from '@/components/export/ExportSheet.vue';
import MealPlanExportBody from '@/components/export/MealPlanExportBody.vue';
import MealExportLegend from '@/components/export/MealExportLegend.vue';
import {
  exportElementToPng,
  pngBlobToPdf,
  ExportError,
  type ExportStage,
} from '@/composables/useSheetExport';
import { shareOrDownloadFile, downloadFile } from '@/utils/shareOrDownloadFile';
import {
  buildMealExportRows,
  type MealResolvers,
  type MealExportRows,
} from '@/utils/mealExportModel';
import { record as recordPerf } from '@/utils/perfTiming';
import { logEvent } from '@/services/telemetry/logEvent';
import { addDays, toDateInputValue, formatDayLong } from '@/utils/date';
import type { MealPlanEntry, MealSlot } from '@/types/models';

/** Faces the export sheet renders — forced into flight before capture (no FOUT). */
const EXPORT_FONTS = [
  '600 15px Outfit',
  '700 16px Outfit',
  '800 24px Outfit',
  '400 14px Inter',
  '700 22px Caveat',
];

/** Short weekday for the grid header (mirrors MealWeekBoard's en-US short format). */
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
function dayHeading(dateISO: string): { weekday: string; dayNum: string } {
  const d = new Date(`${dateISO}T00:00:00`);
  return { weekday: WEEKDAY_SHORT.format(d), dayNum: String(d.getDate()) };
}

const { t } = useTranslation();
const mealPlanStore = useMealPlanStore();
const recipesStore = useRecipesStore();
const familyStore = useFamilyStore();

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
    variant: 'danger',
    confirmLabel: 'mealPlanner.clear.confirmLabel',
  });
  if (ok) await mealPlanStore.clearDates([date]);
}

// ── Share / export the week ──────────────────────────────────────────────────
function cook(id?: string): { name: string; color?: string } | undefined {
  const m = id ? familyStore.members.find((mm) => mm.id === id) : undefined;
  return m ? { name: m.name, color: m.color } : undefined;
}

// Resolver object handed to `buildMealExportRows` so a meal is named/attributed
// identically everywhere. `dayLabel` (long form) is retained on the shared shape
// for `formatMealPlanShare`; the grid uses `dayHeading`.
const mealResolvers = computed<MealResolvers>(() => ({
  dayLabel: (d) => formatDayLong(d),
  dayHeading,
  slotLabel: (s: MealSlot) => t(`mealPlanner.slot.${s}`),
  mealName: (m) => mealDisplayName(m, recipesStore.recipes, t),
  cook,
}));

// ── Export the week as an image / PDF ────────────────────────────────────────
// One layout source (the off-screen ExportSheet) → PNG (share sheet) or PDF
// (download). The sheet always renders the whole viewed WEEK; the day/week
// toggle above governs only the text share.
type ExportFormat = 'image' | 'pdf';

const exportMounting = ref(false); // gates the declarative off-screen host
const exportRows = ref<MealExportRows | null>(null);
const exporting = ref(false); // busy flag — disables the chooser buttons
const sheetComp = ref<{ $el: HTMLElement } | null>(null);

async function runExport(format: ExportFormat): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  const started = performance.now();
  logEvent({
    level: 'info',
    surface: 'plan-export',
    message: 'export started',
    context: { action: 'export-start', format },
  });
  let stage: ExportStage = 'render';
  try {
    // 1. Build the row view-model + mount the sheet off-screen.
    exportRows.value = buildMealExportRows(
      mealPlanStore.mealsForWeek(weekDates.value),
      weekDates.value,
      mealResolvers.value
    );
    exportMounting.value = true;
    await nextTick();
    const el = sheetComp.value?.$el;
    if (!el) throw new ExportError('render', new Error('export sheet did not mount'));

    // 2. Rasterize (fonts-ready gated inside the engine).
    stage = 'rasterize';
    const png = await exportElementToPng(el, { fonts: EXPORT_FONTS, backgroundColor: '#F8F9FA' });
    recordPerf('plan-export', performance.now() - started);

    // 3. Pick the delivered blob per format (PDF wraps the same PNG).
    let blob = png;
    let ext = 'png';
    let mime = 'image/png';
    if (format === 'pdf') {
      stage = 'pdf';
      blob = await pngBlobToPdf(png);
      ext = 'pdf';
      mime = 'application/pdf';
    }

    // 4. Deliver: "Share" hands the image to the OS share sheet; "Export as PDF"
    //    downloads straight to the device (the conventional download action).
    stage = 'deliver';
    const filename = `beanies-meal-plan-${weekDates.value[0]}.${ext}`;
    const result =
      format === 'pdf'
        ? downloadFile(blob, filename)
        : await shareOrDownloadFile(blob, filename, mime, t('mealPlanner.share.title'));
    if (result.outcome === 'failed') throw new ExportError('deliver', result.error);
    if (result.outcome === 'cancelled') {
      logEvent({
        level: 'info',
        surface: 'plan-export',
        message: 'export cancelled',
        context: { action: 'export-cancelled', format },
      });
      return;
    }
    logEvent({
      level: 'info',
      surface: 'plan-export',
      message: 'export delivered',
      context: {
        action: result.outcome === 'shared' ? 'export-shared' : 'export-downloaded',
        format,
      },
    });
  } catch (err) {
    const failStage = err instanceof ExportError ? err.stage : stage;
    // ONE call: showToast('error') auto-invokes reportError with this
    // surface/error/context, so a separate reportError would double-report.
    showToast('error', t('mealPlanner.export.failed'), t('mealPlanner.export.failedHelp'), {
      surface: 'plan-export',
      error: err,
      context: { format, stage: failStage },
    });
  } finally {
    // Unmounting the host in `finally` means a thrown error can never leak it.
    exportMounting.value = false;
    exporting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col px-3 py-5 sm:px-6 md:h-full">
    <!-- Header -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="font-outfit text-secondary-500 text-2xl font-bold dark:text-slate-100">
          🍲 {{ t('mealPlanner.title') }}
        </h1>
        <PageWelcomeSubtitle :text="t('mealPlanner.welcome')" />
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="isCurrentWeek"
          type="button"
          class="font-outfit text-secondary-500 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold dark:text-slate-100"
          @click="copyLastWeek"
        >
          ⧉ {{ t('mealPlanner.copyLastWeek') }}
        </button>
        <button
          v-else
          type="button"
          class="font-outfit text-secondary-500 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold dark:text-slate-100"
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
          <BeanieIcon v-if="!exporting" name="share" size="sm" />
          {{ exporting ? t('mealPlanner.export.building') : t('mealPlanner.export.share') }}
        </button>
        <button
          type="button"
          class="font-outfit text-secondary-500 inline-flex items-center gap-1.5 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold disabled:opacity-60 dark:text-slate-100"
          :disabled="exporting"
          @click="runExport('pdf')"
        >
          <BeanieIcon v-if="!exporting" name="download" size="sm" />
          {{ exporting ? t('mealPlanner.export.building') : t('mealPlanner.export.exportPdf') }}
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
      <span class="font-outfit text-secondary-500 text-base font-bold dark:text-slate-100">{{
        weekLabel
      }}</span>
      <button
        v-if="!isCurrentWeek"
        type="button"
        class="font-outfit text-sm font-semibold text-[#F15D22]"
        @click="goToToday"
      >
        {{ t('mealPlanner.thisWeek') }}
      </button>
      <span class="flex-1"></span>
      <button
        v-if="mealPlanStore.weekHasMeals(weekDates)"
        type="button"
        class="font-outfit text-sm font-semibold text-[rgba(44,62,80,0.5)] hover:text-[#F15D22] dark:text-slate-400"
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
      <span class="font-outfit text-secondary-500 text-base font-bold dark:text-slate-100">{{
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
      class="mt-4 hidden overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--soft-shadow)] md:grid md:max-h-[52rem] md:min-h-0 md:flex-1 md:grid-cols-[15rem_1fr] md:grid-rows-[minmax(0,1fr)] dark:bg-slate-800"
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
    <div
      class="mt-4 overflow-hidden rounded-[var(--sq)] bg-white shadow-[var(--soft-shadow)] md:hidden dark:bg-slate-800"
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
         i18n / theme; unmounted by flipping `exportMounting` in the handler's
         `finally`, so a thrown error can never leak it. -->
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
          <MealExportLegend
            v-if="exportRows"
            :cooks-label="t('mealPlanner.export.cooksLabel')"
            :cooks="exportRows.cooks"
            :hint="t('mealPlanner.export.legendHint')"
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
  background: var(--color-slate-800, #1e293b);
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
