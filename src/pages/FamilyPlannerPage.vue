<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CalendarCommandBar from '@/components/planner/CalendarCommandBar.vue';
import { useMemberFilterChips } from '@/composables/useMemberFilterChips';
import { usePlannerNavigation, type PlannerView } from '@/composables/usePlannerNavigation';
import CalendarGrid from '@/components/planner/CalendarGrid.vue';
import WeeklyCalendarView from '@/components/planner/WeeklyCalendarView.vue';
import DailyCalendarView from '@/components/planner/DailyCalendarView.vue';
import ActivityModal from '@/components/planner/ActivityModal.vue';
import ActivityViewEditModal from '@/components/planner/ActivityViewEditModal.vue';
import TravelSegmentEditModal from '@/components/travel/TravelSegmentEditModal.vue';
import { showToast } from '@/composables/useToast';
import { validateSegmentTarget } from '@/utils/vacation';
import DayAgendaSidebar from '@/components/planner/DayAgendaSidebar.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import HolidayDetailsModal from '@/components/planner/HolidayDetailsModal.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useVacationStore } from '@/stores/vacationStore';
import { reportError } from '@/utils/errorReporter';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { useActivityScopeEdit } from '@/composables/useActivityScopeEdit';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { confirm } from '@/composables/useConfirm';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { getActivityFallbackEmoji, getActivityCategoryName } from '@/constants/activityCategories';
import { formatDateFull, parseLocalDate, toDateInputValue } from '@/utils/date';
import VacationWizard from '@/components/vacation/VacationWizard.vue';
import CreatedConfirmModal from '@/components/ui/CreatedConfirmModal.vue';
import type { ConfirmDetail } from '@/components/ui/CreatedConfirmModal.vue';
import DocumentExtractConsentModal from '@/components/ai/DocumentExtractConsentModal.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useDocumentToActivity } from '@/composables/useDocumentToActivity';
import { useAiCapability } from '@/composables/useAiCapability';
import { useFilePicker } from '@/composables/useFilePicker';
import type { FieldConfidence } from '@/services/ai/types';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  CurrencyCode,
  TodoItem,
  HolidayOccurrence,
} from '@/types/models';

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { canEditActivities } = usePermissions();
const activityStore = useActivityStore();
const settingsStore = useSettingsStore();
const accountsStore = useAccountsStore();
const recurringStore = useRecurringStore();
const transactionsStore = useTransactionsStore();
const vacationStore = useVacationStore();
// Instantiating the holiday store wires its self-loading watchers (country +
// online) — the calendar views just call holidaysInRange / holidayForDate.
useHolidayStore();
const { isAllActive, isMemberActive, onSelectAll, onSelectMember, activeMemberNames } =
  useMemberFilterChips();
const {
  viewingActivity,
  viewingOccurrenceDate,
  openViewModal,
  handleViewOpenEdit: scopedViewOpenEdit,
  handleScopedSave,
} = useActivityScopeEdit();

// Open activity view modal from query param (e.g. /activities?activity=abc)
function handleActivityQueryParam() {
  const activityId = route.query.activity as string | undefined;
  if (activityId) {
    openViewModal(activityId);
    router.replace({ query: {} });
  }
}
onMounted(handleActivityQueryParam);
watch(
  () => route.query.activity,
  (val) => {
    if (val) handleActivityQueryParam();
  }
);

const activeView = ref<PlannerView>('month');
// Single source of truth for the calendar's period — the views are controlled
// off this (props down); navigation intents flow back up (events).
const { referenceDate, label, goPrev, goNext, goToday } = usePlannerNavigation(activeView);
const showInactive = ref(false);
const showModal = ref(false);
const editingActivity = ref<FamilyActivity | null>(null);
const editingOccurrenceDate = ref<string | undefined>(undefined);
const selectedDate = ref<string | undefined>(undefined);
// Highlighted day on the monthly/weekly grid + the day the daily view
// jumps to when the user clicks a cell. Separate from `sidebarDate`
// (which drives the agenda drawer) so the two affordances don't
// share state.
const focusedDate = ref<string | null>(null);
const sidebarDate = ref<string | null>(null);
const defaultStartTime = ref<string | undefined>(undefined);

// Read-only public-holiday details popup (opened from a holiday chip/banner).
const selectedHoliday = ref<HolidayOccurrence | null>(null);
function handleHolidayClick(holiday: HolidayOccurrence) {
  selectedHoliday.value = holiday;
}

// Activity created confirmation modal. `lastCreatedDate` holds the date the
// just-created activity was scheduled on, so the "+ add another" link in the
// confirmation modal can pre-fill the new form with the same date — meaningful
// friction relief for batch-create flows (kid's term-of-school routine,
// vacation-week setup, etc.) where the user is doing 4-6 activities in a row
// on the same day.
const createdConfirm = ref<{
  open: boolean;
  title: string;
  message: string;
  details: ConfirmDetail[];
  lastCreatedDate?: string;
}>({ open: false, title: '', message: '', details: [], lastCreatedDate: undefined });

function handleCreateAnother() {
  const date = createdConfirm.value.lastCreatedDate;
  createdConfirm.value.open = false;
  // openAddModal resets all defaults; passing the prior date pre-fills it.
  // Time + member are intentionally NOT carried forward — most batch creates
  // use different times or assignees per activity (piano @ 4pm for kid A,
  // swim @ 5pm for kid B). Date is the dimension that almost always stays.
  openAddModal(date);
}

const defaultAssigneeId = ref<string | undefined>(undefined);

// --- Add from a photo (#133) ---
// Extraction prefill handed to ActivityModal for a new activity, plus consent-modal state.
const activityPrefill = ref<Partial<CreateFamilyActivityInput> | undefined>(undefined);
const activityPrefillConfidence = ref<FieldConfidence | undefined>(undefined);
// The compressed source document, attached to the activity ActivityModal creates (#133).
const activitySourcePhoto = ref<File | undefined>(undefined);
const consentOpen = ref(false);
let consentResolver: ((granted: boolean) => void) | null = null;
const { tier: aiTier } = useAiCapability();

/**
 * Promise-based consent gate the wedge awaits before any document leaves the device.
 * If the family has opted into "don't ask again" we resolve immediately WITHOUT touching
 * the modal lifecycle (no `consentResolver` assignment → none can be left dangling).
 */
function requestPhotoConsent(): Promise<boolean> {
  if (settingsStore.skipDocumentConsentPrompt) return Promise.resolve(true);
  return new Promise((resolve) => {
    consentResolver = resolve;
    consentOpen.value = true;
  });
}
function resolvePhotoConsent(granted: boolean): void {
  consentOpen.value = false;
  consentResolver?.(granted);
  consentResolver = null;
}

/** Persist the family-scoped consent-skip. Isolated + awaited so failures are caught (not silent). */
async function persistConsentSkip(): Promise<void> {
  await settingsStore.setSkipDocumentConsentPrompt(true);
}

/**
 * Confirm handler for the consent modal. Proceeds for this document regardless; if the user
 * ticked "remember", persist the skip — but a persist failure must never strand the wedge,
 * so we resolve consent in `finally`.
 */
async function onConsentConfirm(remember: boolean): Promise<void> {
  try {
    if (remember) await persistConsentSkip();
  } catch (e) {
    reportError({
      surface: 'ai-consent',
      message: 'Failed to save the AI consent preference',
      error: e,
    });
  } finally {
    resolvePhotoConsent(true);
  }
}

/** Open a fresh new-activity form pre-filled from the extracted document. */
function onPhotoActivityReady(ready: {
  prefill: Partial<CreateFamilyActivityInput>;
  confidence: FieldConfidence;
  sourcePhoto?: File;
}): void {
  sidebarDate.value = null;
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
  selectedDate.value = undefined;
  defaultStartTime.value = undefined;
  defaultAssigneeId.value = undefined;
  activityPrefill.value = ready.prefill;
  activityPrefillConfidence.value = ready.confidence;
  activitySourcePhoto.value = ready.sourcePhoto;
  showModal.value = true; // last → ActivityModal.onNew reads the prefill set above
}

const { isProcessing: isReadingPhoto, processFile: processPhoto } = useDocumentToActivity({
  requestConsent: requestPhotoConsent,
  onActivityReady: onPhotoActivityReady,
});

const photoPicker = useFilePicker({
  accept: 'image/jpeg,image/png,image/heic,image/heif',
  capture: 'environment', // mobile opens the rear camera
  onPick: (files) => {
    if (files[0]) void processPhoto(files[0]);
  },
});

// Vacation wizard state
const showVacationWizard = ref(false);
const vacationWizardDefaults = ref<{ assigneeIds: string[]; date: string }>({
  assigneeIds: [],
  date: '',
});
const editingVacation = ref<import('@/types/models').FamilyVacation | null>(null);
const editVacationStep = ref<number | undefined>(undefined);

function handleStartVacationWizard(defaults: { assigneeIds: string[]; date: string }) {
  showModal.value = false;
  vacationWizardDefaults.value = defaults;
  editingVacation.value = null;
  editVacationStep.value = undefined;
  showVacationWizard.value = true;
}

function handleVacationClick(id: string) {
  router.push({ path: '/travel', query: { vacation: id } });
}

// ── Travel-segment in-place editor ─────────────────────────────────────────
// Click a travel-segment chip on the calendar → open TravelSegmentEditModal
// directly here (no /travel navigation). Identity is `{vacationId,
// segmentIndex}` — modal already uses this contract on TravelPlansPage.
const editingSegment = ref<{ vacationId: string; segmentIndex: number } | null>(null);
const editingSegmentValue = computed(() => {
  if (!editingSegment.value) return undefined;
  return vacationStore.getVacationById(editingSegment.value.vacationId)?.travelSegments[
    editingSegment.value.segmentIndex
  ];
});

function reportSegmentNotFound(reason: string) {
  console.error(`[FamilyPlannerPage] ${reason}`);
  showToast('error', t('error.travelSegmentNotFound'), t('error.travelSegmentNotFoundHelp'));
}

function handleViewSegment(vacationId: string, segmentIndex: number) {
  const result = validateSegmentTarget(
    vacationStore.getVacationById(vacationId),
    vacationId,
    segmentIndex
  );
  if (!result.ok) return reportSegmentNotFound(result.reason);
  editingSegment.value = { vacationId, segmentIndex };
}

function closeSegmentModal() {
  editingSegment.value = null;
}

// Vanish-mid-edit defense: if the segment being edited is removed by a
// concurrent Automerge merge, close the modal and surface a warning toast
// rather than silently dropping the form into empty-create mode.
watch(editingSegmentValue, (next, prev) => {
  if (prev && !next && editingSegment.value) {
    console.warn(
      `[FamilyPlannerPage] segment vanished mid-edit (vacation ${editingSegment.value.vacationId}, idx ${editingSegment.value.segmentIndex}) — closing modal`
    );
    showToast('warning', t('error.travelSegmentVanished'), t('error.travelSegmentVanishedHelp'));
    editingSegment.value = null;
  }
});

function openAddModal(date?: string, time?: string, memberId?: string) {
  // A manual add is never a photo prefill — clear any leftover so it can't leak in
  // (incl. the source photo, or it would attach to the next manually-added activity).
  activityPrefill.value = undefined;
  activityPrefillConfidence.value = undefined;
  activitySourcePhoto.value = undefined;
  sidebarDate.value = null;
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
  selectedDate.value = date;
  defaultStartTime.value = time;
  defaultAssigneeId.value = memberId;
  showModal.value = true;
}

// Quick-add FAB → open the Add Activity modal with default state.
useQuickAddIntent((action) => {
  if (action === 'add-activity') openAddModal();
});

function handleCalendarDateClick(date: string) {
  // Clicking a day in the monthly/weekly grid drills into that day's
  // timeline. Sets the shared reference date so the Day view opens on it.
  focusedDate.value = date;
  referenceDate.value = parseLocalDate(date);
  activeView.value = 'day';
}

// Mobile week-strip day pick — change the focused day but STAY in week view.
function handleSelectDay(date: string) {
  focusedDate.value = date;
  referenceDate.value = parseLocalDate(date);
}

// Period navigation (command bar + view swipe). Clearing focusedDate drops the
// drilled-in day highlight when the user explicitly pages the period.
function handlePrev() {
  goPrev();
  focusedDate.value = null;
}
function handleNext() {
  goNext();
  focusedDate.value = null;
}
// Bumped on every "Today" tap so the views always re-scroll to today — even
// when the reference date doesn't change (already on the current month/day),
// where a plain `watch(referenceDate)` would never fire.
const todayTick = ref(0);
function handleToday() {
  goToday();
  focusedDate.value = null;
  todayTick.value++;
}
function setView(view: string) {
  activeView.value = view as PlannerView;
}

function handleOpenAgenda() {
  // Day-view agenda action lives in the command bar now — the open day is the
  // shared reference date.
  sidebarDate.value = toDateInputValue(referenceDate.value);
}

function handleSidebarAdd() {
  const date = sidebarDate.value ?? undefined;
  sidebarDate.value = null;
  defaultStartTime.value = '09:00';
  openAddModal(date);
}

function handleSidebarEdit(id: string, date: string) {
  sidebarDate.value = null;
  openViewModal(id, date);
}

async function handleViewOpenEdit(activity: FamilyActivity) {
  // `scopedViewOpenEdit` closes the view modal (sets viewingActivity=null)
  // and synchronously returns the target. Without `await nextTick()` here,
  // the view modal's v-if removal and the edit modal's mount would happen
  // in the SAME render pass — two role=dialog overlays coexist for one
  // tick, which webkit's a11y/focus engine under CI contention has stalled
  // on for >15s. Same shape as the 2026-05-03 handleSave fix; see
  // docs/E2E_HEALTH.md for the cross-entity history.
  const { activity: target, occurrenceDate } = scopedViewOpenEdit(activity);
  await nextTick();
  editingActivity.value = target;
  editingOccurrenceDate.value = occurrenceDate;
  showModal.value = true;
}

async function handleSave(
  data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }
) {
  // Track payment changes (adding or removing linked recurring payment)
  const isUpdate = 'id' in data && 'data' in data;
  const isAddingPayment =
    isUpdate && data.data.payFromAccountId && !editingActivity.value?.linkedRecurringItemId;
  const isRemovingPayment =
    isUpdate && !data.data.payFromAccountId && !!editingActivity.value?.linkedRecurringItemId;
  const isPaymentChange = isAddingPayment || isRemovingPayment;

  if (isUpdate) {
    // When removing a linked payment, delete generated transactions BEFORE the activity update
    // (must happen here because activityStore can't import transactionsStore — circular dep)
    if (isRemovingPayment && editingActivity.value?.linkedRecurringItemId) {
      await transactionsStore.deleteTransactionsByRecurringItemId(
        editingActivity.value.linkedRecurringItemId
      );
    }

    if (
      editingOccurrenceDate.value &&
      editingActivity.value?.recurrence !== 'none' &&
      !isPaymentChange
    ) {
      // Recurring occurrence edit (not payment-related) — show scope modal
      const saved = await handleScopedSave(data.id, editingOccurrenceDate.value, data.data);
      if (!saved) return; // cancelled — keep modal open
    } else {
      // Direct update: non-recurring, adding/removing payment (always applies to template)
      await activityStore.updateActivity(data.id, data.data);
    }
  } else {
    const created = await activityStore.createActivity(data as CreateFamilyActivityInput);
    // Close the ActivityModal BEFORE opening CreatedConfirmModal so two
    // role=dialog / aria-modal=true overlays never coexist in the DOM.
    // WebKit under CI contention has been observed to stall the second
    // modal's visibility for >15s when the first is still teleported in
    // — surfaces as the recurring "Activity Created" E2E flake (see
    // docs/E2E_HEALTH.md 2026-05-03 entry). nextTick lets Vue flush the
    // v-if removal of the first dialog before we mount the second.
    showModal.value = false;
    if (created) {
      await nextTick();
      showActivityCreatedConfirmation(data as CreateFamilyActivityInput);
    }
    return;
  }

  // When fee amount changes on a linked activity, update future materialized transactions
  // to match the new monthly amount (past transactions are historical and unchanged)
  if (isUpdate && !isRemovingPayment) {
    await nextTick();
    const savedActivity = activityStore.activities.find(
      (a) => a.id === (data as { id: string }).id
    );
    if (savedActivity?.linkedRecurringItemId) {
      const ri = recurringStore.getRecurringItemById(savedActivity.linkedRecurringItemId);
      if (ri) {
        const today = new Date().toISOString().slice(0, 10);
        const futureTxs = transactionsStore.transactions.filter(
          (tx) =>
            tx.recurringItemId === ri.id && tx.date.slice(0, 10) >= today && tx.amount !== ri.amount
        );
        for (const tx of futureTxs) {
          await transactionsStore.updateTransaction(tx.id, { amount: ri.amount });
        }
      }
    }
  }

  showModal.value = false;

  // Show success confirmation when a new linked payment was created
  if (isAddingPayment) {
    await nextTick();
    const savedActivity = activityStore.activities.find(
      (a) => a.id === (data as { id: string }).id
    );
    if (savedActivity?.linkedRecurringItemId) {
      const ri = recurringStore.getRecurringItemById(savedActivity.linkedRecurringItemId);
      const acct = accountsStore.accounts.find((a) => a.id === savedActivity.payFromAccountId);
      if (ri && acct) {
        const amt = formatCurrencyWithCode(ri.amount, ri.currency as CurrencyCode);
        const freq = ri.frequency === 'yearly' ? '/yr' : '/mo';
        const confirmed = await confirm({
          title: 'recurringPrompt.paymentCreated',
          message: 'recurringPrompt.paymentCreatedDetail',
          detail: `${amt}${freq} from ${acct.name}`,
          variant: 'info',
          confirmLabel: 'recurringPrompt.viewTransactions',
          cancelLabel: 'action.close',
        });
        if (confirmed) {
          router.push('/transactions');
        }
      }
    }
  }

  // Show confirmation when a linked payment was removed
  if (isRemovingPayment) {
    await nextTick();
    await confirm({
      title: 'recurringPrompt.paymentRemoved',
      message: 'recurringPrompt.paymentRemovedDetail',
      variant: 'info',
      showCancel: false,
    });
  }

  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
}

function showActivityCreatedConfirmation(data: CreateFamilyActivityInput) {
  const dateStr = formatDateFull(data.date);
  const details: ConfirmDetail[] = [
    { label: t('planner.field.title'), value: data.title },
    { label: t('form.category'), value: getActivityCategoryName(data.category) },
    { label: t('form.date'), value: dateStr },
  ];
  if (data.startTime) {
    const time = data.endTime ? `${data.startTime} - ${data.endTime}` : data.startTime;
    details.push({ label: t('planner.field.startTime'), value: time });
  }
  if (data.isAllDay) {
    details.push({ label: t('planner.allDay'), value: '✓' });
  }
  if (data.recurrence !== 'none') {
    details.push({
      label: t('planner.field.recurrence'),
      value: t(`planner.recurrence.${data.recurrence}` as any),
    });
  }
  if (data.location) {
    details.push({ label: t('planner.field.location'), value: data.location });
  }
  createdConfirm.value = {
    open: true,
    title: t('planner.activityCreatedTitle'),
    message: t('planner.activityCreatedMessage'),
    details,
    lastCreatedDate: data.date,
  };
}

async function handleDelete() {
  if (!editingActivity.value) return;
  const activityToDelete = editingActivity.value;
  showModal.value = false;
  const confirmed = await confirm({
    title: 'planner.deleteActivity',
    message: 'planner.deleteConfirm',
    variant: 'danger',
  });
  if (confirmed) {
    await activityStore.deleteActivity(activityToDelete.id);
  }
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
}

// --- Todo view/edit modal ---
const selectedTodo = ref<TodoItem | null>(null);

function openTodoViewModal(todo: TodoItem) {
  selectedTodo.value = todo;
}

function handleActivitySwapped(newId: string) {
  const newActivity = activityStore.activities.find((a) => a.id === newId);
  if (newActivity) viewingActivity.value = newActivity;
}
</script>

<template>
  <!-- No `space-y-*` here: the calendar view must butt flush against the sticky
       command bar (its docked header sits at `top: var(--planner-cmdbar-h)`).
       The only in-flow gap we want is below the view, handled by `mt-*` on the
       inactive-activities block; everything else here is a Teleport/overlay. -->
  <div>
    <!-- Sticky command bar — period hero + nav + view toggle + filter + Add
         + trip ribbon. The calendar is the page hero; nothing above it. -->
    <CalendarCommandBar
      :label="label"
      :active-view="activeView"
      :can-add="canEditActivities"
      :is-all-active="isAllActive"
      :is-member-active="isMemberActive"
      :active-member-names="activeMemberNames"
      @prev="handlePrev"
      @next="handleNext"
      @today="handleToday"
      @update:active-view="setView"
      @add="openAddModal()"
      @add-from-photo="photoPicker.open()"
      @open-agenda="handleOpenAgenda"
      @select-all="onSelectAll"
      @select-member="onSelectMember"
      @vacation-click="handleVacationClick"
    />

    <!-- Calendar views (conditional on activeView), controlled by referenceDate -->
    <CalendarGrid
      v-if="activeView === 'month'"
      :reference-date="referenceDate"
      :selected-date="focusedDate ?? undefined"
      :today-tick="todayTick"
      @select-date="handleCalendarDateClick"
      @prev="handlePrev"
      @next="handleNext"
      @vacation-click="handleVacationClick"
      @view-segment="handleViewSegment"
      @view-activity="(id: string, date: string) => openViewModal(id, date)"
      @holiday-click="handleHolidayClick"
    />

    <WeeklyCalendarView
      v-else-if="activeView === 'week'"
      :reference-date="referenceDate"
      :selected-date="focusedDate ?? undefined"
      :today-tick="todayTick"
      @select-date="handleCalendarDateClick"
      @select-day="handleSelectDay"
      @prev="handlePrev"
      @next="handleNext"
      @add-activity="(date: string, time?: string) => openAddModal(date, time)"
      @view-activity="(id: string, date: string) => openViewModal(id, date)"
      @view-todo="openTodoViewModal"
      @vacation-click="handleVacationClick"
      @view-segment="handleViewSegment"
      @holiday-click="handleHolidayClick"
    />

    <DailyCalendarView
      v-else-if="activeView === 'day'"
      :reference-date="referenceDate"
      :today-tick="todayTick"
      @select-date="handleCalendarDateClick"
      @prev="handlePrev"
      @next="handleNext"
      @add-activity="
        (date: string, time?: string, memberId?: string) => openAddModal(date, time, memberId)
      "
      @view-activity="(id: string, date: string) => openViewModal(id, date)"
      @view-todo="openTodoViewModal"
      @vacation-click="handleVacationClick"
      @view-segment="handleViewSegment"
      @holiday-click="handleHolidayClick"
    />

    <!-- Inactive activities toggle (month view only) -->
    <div v-if="activeView === 'month' && activityStore.inactiveActivities.length > 0" class="mt-4">
      <button
        type="button"
        class="text-secondary-500/50 hover:text-secondary-500 flex items-center gap-2 text-sm transition-colors dark:text-gray-500 dark:hover:text-gray-300"
        @click="showInactive = !showInactive"
      >
        <span class="text-xs opacity-50">{{ showInactive ? '&#x25B2;' : '&#x25BC;' }}</span>
        <span class="font-semibold">
          {{ t('planner.inactiveActivities') }}
          ({{ activityStore.inactiveActivities.length }})
        </span>
      </button>

      <div v-if="showInactive" class="mt-3 space-y-1.5">
        <button
          v-for="activity in activityStore.inactiveActivities"
          :key="activity.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white/60 px-3 py-2.5 text-left opacity-60 shadow-[0_2px_10px_rgba(44,62,80,0.03)] transition-all hover:opacity-100 hover:shadow-[0_4px_16px_rgba(44,62,80,0.06)] dark:bg-slate-800/60"
          style="border-left-color: #95a5a6"
          @click="openViewModal(activity.id)"
        >
          <span class="flex-shrink-0 text-base leading-none opacity-50">
            {{ activity.icon ?? getActivityFallbackEmoji(activity.category) }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 min-w-0 flex-1 truncate text-sm font-semibold dark:text-gray-400"
          >
            {{ activity.title }}
          </span>
          <span class="text-secondary-500/30 flex-shrink-0 text-xs dark:text-gray-500">
            {{ t('planner.showInactive') }}
          </span>
        </button>
      </div>
    </div>

    <!-- Day agenda sidebar -->
    <DayAgendaSidebar
      :date="sidebarDate ?? ''"
      :open="sidebarDate !== null"
      @close="sidebarDate = null"
      @add-activity="handleSidebarAdd"
      @edit-activity="handleSidebarEdit"
      @view-todo="openTodoViewModal"
      @vacation-click="handleVacationClick"
      @holiday-click="handleHolidayClick"
    />

    <!-- Public-holiday details popup (read-only) -->
    <HolidayDetailsModal
      :holiday="selectedHoliday"
      :open="selectedHoliday !== null"
      @close="selectedHoliday = null"
    />

    <!-- Activity modal -->
    <ActivityModal
      :open="showModal"
      :activity="editingActivity"
      :default-date="selectedDate"
      :default-start-time="defaultStartTime"
      :default-assignee-ids="defaultAssigneeId ? [defaultAssigneeId] : undefined"
      :prefill="activityPrefill"
      :prefill-confidence="activityPrefillConfidence"
      :source-photo="activitySourcePhoto"
      :read-only="!canEditActivities"
      :occurrence-date="editingOccurrenceDate"
      @close="
        showModal = false;
        defaultStartTime = undefined;
        defaultAssigneeId = undefined;
        activityPrefill = undefined;
        activityPrefillConfidence = undefined;
        activitySourcePhoto = undefined;
      "
      @save="handleSave"
      @delete="handleDelete"
      @start-vacation-wizard="handleStartVacationWizard"
    />

    <!-- Add from a photo (#133): consent gate, hidden picker input, and processing overlay -->
    <DocumentExtractConsentModal
      :open="consentOpen"
      :tier="aiTier"
      @confirm="onConsentConfirm"
      @cancel="resolvePhotoConsent(false)"
    />
    <input
      :ref="(el) => (photoPicker.inputRef.value = el as HTMLInputElement)"
      v-bind="photoPicker.bindings"
      class="hidden"
    />
    <div
      v-if="isReadingPhoto"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm"
    >
      <div
        class="flex flex-col items-center gap-3 rounded-3xl bg-white px-8 py-6 shadow-[var(--soft-shadow)] dark:bg-slate-800"
      >
        <BeanieSpinner size="lg" :halo="true" />
        <p class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t('ai.processing') }}
        </p>
      </div>
    </div>

    <!-- Vacation wizard -->
    <VacationWizard
      :open="showVacationWizard"
      :vacation="editingVacation"
      :edit-step="editVacationStep"
      :default-assignee-ids="vacationWizardDefaults.assigneeIds"
      :default-date="vacationWizardDefaults.date"
      @close="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
      @saved="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
    />

    <TodoViewEditModal :todo="selectedTodo" @close="selectedTodo = null" />

    <ActivityViewEditModal
      :activity="viewingActivity"
      :occurrence-date="viewingOccurrenceDate"
      @close="viewingActivity = null"
      @open-edit="handleViewOpenEdit"
      @activity-swapped="handleActivitySwapped"
    />

    <!-- Travel segment in-place editor (opened from calendar travel-segment chips) -->
    <TravelSegmentEditModal
      :open="editingSegment !== null"
      :segment="editingSegmentValue"
      :vacation-id="editingSegment?.vacationId ?? ''"
      :segment-index="editingSegment?.segmentIndex ?? -1"
      @close="closeSegmentModal"
    />

    <!-- Activity Created Confirmation -->
    <CreatedConfirmModal
      :open="createdConfirm.open"
      :title="createdConfirm.title"
      :message="createdConfirm.message"
      :details="createdConfirm.details"
      allow-create-another
      @close="createdConfirm.open = false"
      @create-another="handleCreateAnother"
    />
  </div>
</template>
