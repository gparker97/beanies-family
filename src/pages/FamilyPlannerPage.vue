<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import CalendarCommandBar from '@/components/planner/CalendarCommandBar.vue';
import { useMemberFilterChips } from '@/composables/useMemberFilterChips';
import { usePlannerNavigation, type PlannerView } from '@/composables/usePlannerNavigation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import CalendarGrid from '@/components/planner/CalendarGrid.vue';
import CalendarMonthStream, {
  type AnchorTarget,
} from '@/components/planner/CalendarMonthStream.vue';
import WeeklyCalendarView from '@/components/planner/WeeklyCalendarView.vue';
import DailyCalendarView from '@/components/planner/DailyCalendarView.vue';
import CalendarConnectNudge from '@/components/planner/CalendarConnectNudge.vue';
import ActivityModal from '@/components/planner/ActivityModal.vue';
import ActivityViewEditModal from '@/components/planner/ActivityViewEditModal.vue';
import TravelSegmentEditModal from '@/components/travel/TravelSegmentEditModal.vue';
import { showToast } from '@/composables/useToast';
import { validateSegmentTarget } from '@/utils/vacation';
import DayAgendaSidebar from '@/components/planner/DayAgendaSidebar.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import MagicTodoReviewDrawer from '@/components/ai/MagicTodoReviewDrawer.vue';
import type { TodoReviewReady } from '@/utils/magicTodoDrafts';
import { useTodoStore } from '@/stores/todoStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import HolidayDetailsModal from '@/components/planner/HolidayDetailsModal.vue';
import BirthdayDetailsModal from '@/components/planner/BirthdayDetailsModal.vue';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import { useToday } from '@/composables/useToday';
import { useActivityStore } from '@/stores/activityStore';
import { reportSessionActionFailed } from '@/utils/actionFailure';
import { useVacationStore } from '@/stores/vacationStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { useActivityScopeEdit } from '@/composables/useActivityScopeEdit';
import { useDeepLinkParam } from '@/composables/useDeepLinkParam';
import { useActivityReveal } from '@/composables/useActivityReveal';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { confirm } from '@/composables/useConfirm';
import { confirmAndDeleteActivity } from '@/composables/useActivityDelete';
import { useAccountsStore } from '@/stores/accountsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import { useActivityCategoryLabel } from '@/composables/useActivityCategoryLabel';
import {
  formatDateFull,
  parseLocalDate,
  toDateInputValue,
  monthGridRange,
  addDaysYmd,
  isRealYmd,
} from '@/utils/date';
import { useWeekNavigation } from '@/composables/useCalendarNavigation';
import { useSettingsStore } from '@/stores/settingsStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { uiLocale } from '@/utils/uiLocale';
import { deviceTimeZone, sameOffsetNow, zoneDisplayName } from '@/utils/timeZone';
import { useCalendarClashStore } from '@/stores/calendarClashStore';
import { findDuplicateActivity, mergeExtractionIntoActivity } from '@/utils/activityDuplicate';
import VacationWizard from '@/components/vacation/VacationWizard.vue';
import CreatedConfirmModal from '@/components/ui/CreatedConfirmModal.vue';
import type { ConfirmDetail } from '@/components/ui/CreatedConfirmModal.vue';
import { useDocumentToActivity } from '@/composables/useDocumentToActivity';
import { useMagicReader, useMagicReaderConsumer } from '@/composables/useMagicReader';
import { usePlannerTodayConsumer } from '@/composables/usePlannerToday';
import type { FieldConfidence, TodoExtractionResult } from '@/services/ai/types';
import type { ResultEnvelope } from '@/types/magicPayload';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  CurrencyCode,
  TodoItem,
  HolidayOccurrence,
} from '@/types/models';

const { t } = useTranslation();
// Month view has two sibling surfaces; this picks which one mounts.
const { isMobile } = useBreakpoint();
const { categoryLabel } = useActivityCategoryLabel();
const router = useRouter();
const { canEditActivities } = usePermissions();
// Gating + cross-surface dispatch for the photo→activity reader (#133) live in
// one place now (useMagicReader). `canReadPhoto` = canEditActivities && the dev
// flag; it gates the command-bar pill and (via the wizard) the activity modal.
const { canReadPhoto } = useMagicReader();
const activityStore = useActivityStore();
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

// Open activity view modal from query param (e.g. /activities?activity=abc).
// Robust to cold-start: only clears the param once the activity is found, and
// retries when the store hydrates (e.g. opening the link from Google Calendar).
// A `date` companion opens one session of a repeating activity (#114: a to-do's
// chip links to the session it belongs to). A malformed date is logged and
// ignored, so the activity still opens on its default session.
useDeepLinkParam({
  param: 'activity',
  companions: ['date'],
  open: (id, { date }) => {
    if (date && !isRealYmd(date)) {
      logEvent({
        level: 'warn',
        surface: 'activity-links',
        message: 'deeplink_date_invalid',
        context: { action: 'deeplink_date_invalid', detail: 'activity' },
      });
      return openViewModal(id);
    }
    return openViewModal(id, date);
  },
  ready: () => activityStore.activities.length,
});

const activeView = ref<PlannerView>('month');
// Single source of truth for the calendar's period — the views are controlled
// off this (props down); navigation intents flow back up (events).
const { referenceDate, label, goPrev, goNext, goToday } = usePlannerNavigation(activeView);
const showInactive = ref(false);

// ── External-calendar clash nudge (#34) ──────────────────────────────────────
// Derive the VISIBLE window (the rendered grid, not the calendar month) + its
// activity occurrences from the active view — reusing the shared range helpers so
// the window can't drift from what the views render — and feed them to the
// read-only clash store. Decoration is async + non-blocking; the store no-ops
// unless the flag + toggle + freebusy scope are all present.
const settingsStore = useSettingsStore();
const clashStore = useCalendarClashStore();
const { getWeekStart } = useWeekNavigation(referenceDate);

/** The days the active view draws (the desktop month grid includes its padding days). */
const visibleRange = computed((): { startYmd: string; endYmd: string } => {
  const view = activeView.value;
  if (view === 'month') return monthGridRange(referenceDate.value, settingsStore.weekStartDay);
  if (view === 'week') {
    const startYmd = toDateInputValue(getWeekStart(referenceDate.value));
    return { startYmd, endYmd: addDaysYmd(startYmd, 6) };
  }
  const day = toDateInputValue(referenceDate.value);
  return { startYmd: day, endYmd: day };
});

const clashWindow = computed(() => {
  const { startYmd, endYmd } = visibleRange.value;
  // The DRAWN occurrences the grids show (tails included: `computeClashes` reads
  // a tail as its start-day event, and the self-exclusion set needs its id).
  const occurrences = activityStore.activitiesInRange(startYmd, endYmd);
  // Busy data one day either side: an overnight event's range crosses midnight,
  // so a tail on the first visible day checks the evening before, and an event
  // starting on the last visible day checks the morning after.
  return {
    timeMinIso: parseLocalDate(addDaysYmd(startYmd, -1)).toISOString(),
    // exclusive upper bound
    timeMaxIso: parseLocalDate(addDaysYmd(endYmd, 2)).toISOString(),
    occurrences,
  };
});

// Debounced so rapid prev/next navigation collapses to a single free/busy query.
let clashDebounce: ReturnType<typeof setTimeout> | null = null;
watch(
  [clashWindow, () => clashStore.isAvailable],
  () => {
    if (clashDebounce) clearTimeout(clashDebounce);
    clashDebounce = setTimeout(() => {
      const w = clashWindow.value;
      void clashStore.ensureBusyForWindow(w.timeMinIso, w.timeMaxIso, w.occurrences);
    }, 300);
  },
  { immediate: true }
);
// ── Reveal a just-created activity ───────────────────────────────────────────
// After a create, the calendar moves to the new activity's first occurrence and, once nothing
// covers it, scrolls to its chip and pulses it (the shared attention pulse).
const plannerRootRef = ref<HTMLElement | null>(null);

/**
 * Is `ymd` on screen in the active view? Two views draw less than `visibleRange`: the mobile
 * month stream shows whole months (no padding days), and mobile week shows only the focused
 * day's timeline below its strip.
 */
function isDateShown(ymd: string): boolean {
  const shownYmd = toDateInputValue(referenceDate.value);
  if (isMobile.value && activeView.value === 'month') {
    return ymd.slice(0, 7) === shownYmd.slice(0, 7);
  }
  if (isMobile.value && activeView.value === 'week') return ymd === shownYmd;
  const { startYmd, endYmd } = visibleRange.value;
  return ymd >= startYmd && ymd <= endYmd;
}

/** Move the view's period to `ymd` when it is not already on screen (same view, new period). */
function showDate(ymd: string): boolean {
  if (isDateShown(ymd)) return false;
  referenceDate.value = parseLocalDate(ymd);
  return true;
}

const activityReveal = useActivityReveal({
  root: plannerRootRef,
  showDate,
  viewKind: () => `${activeView.value}-${isMobile.value ? 'mobile' : 'desktop'}`,
});

const showModal = ref(false);
const editingActivity = ref<FamilyActivity | null>(null);
const editingOccurrenceDate = ref<string | undefined>(undefined);
const selectedDate = ref<string | undefined>(undefined);
const sidebarDate = ref<string | null>(null);
const defaultStartTime = ref<string | undefined>(undefined);

// Read-only public-holiday details popup (opened from a holiday chip/banner).
const selectedHoliday = ref<HolidayOccurrence | null>(null);
function handleHolidayClick(holiday: HolidayOccurrence) {
  selectedHoliday.value = holiday;
}

/** Reactive today, so an open birthday drawer does not go stale over midnight. */
const { today: todayStr, lastVisibleAt } = useToday();

// "Times are in {zone}" caption for a member whose device is in a different zone from
// the family's home zone (the calendar renders bare wall-clock times = home wall clock).
// Shown only for a real home zone (family / country), never the device fallback, and
// only when the UTC OFFSETS differ (Kuala Lumpur device, Singapore home: nothing).
// Reads `lastVisibleAt` so a device that crossed zones re-evaluates on foreground.
const homeTimeZoneNote = computed(() => {
  void lastVisibleAt.value;
  const { zone, source } = settingsStore.resolveHomeTimeZoneNow();
  if (source === 'device-fallback' || sameOffsetNow(zone, deviceTimeZone())) return undefined;
  return fillTemplate(t('planner.homeTimeZoneNote'), {
    zone: zoneDisplayName(zone, uiLocale(settingsStore.language)),
  });
});

// Read-only birthday details popup. A birthday is DERIVED from the bean's
// profile rather than stored, so this drawer shows and explains; it never edits.
const selectedBirthday = ref<BirthdayOccurrence | null>(null);
function handleBirthdayClick(birthday: BirthdayOccurrence) {
  selectedBirthday.value = birthday;
}
function openBeanProfile(memberId: string) {
  selectedBirthday.value = null;
  void router.push({ name: 'BeanDetail', params: { id: memberId } });
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
  /** The activity just created, for the confirmation's "View Activity" action. */
  activityId?: string;
}>({ open: false, title: '', message: '', details: [], lastCreatedDate: undefined });

/** OK / dismiss: the calendar is uncovered now, so reveal the activity it already moved to. */
function handleCreatedConfirmClose() {
  createdConfirm.value.open = false;
  void activityReveal.flush('confirm_close');
}

/**
 * "View Activity": open the new activity's view modal. The reveal stays parked and runs when
 * that modal closes (see `closeViewModal`), so the pulse is never spent behind a dialog.
 */
async function handleCreatedView() {
  const id = createdConfirm.value.activityId;
  createdConfirm.value.open = false;
  if (!id) return;
  // One dialog at a time (the WebKit stall precedent in `handleSave`).
  await nextTick();
  const date =
    activityReveal.pending.value?.id === id ? activityReveal.pending.value.date : undefined;
  if (!openViewModal(id, date)) {
    activityReveal.cancel();
    reportError({
      surface: 'planner-reveal',
      message: 'the activity just created was not found when opening it from the confirmation',
      severity: 'warning',
      context: { action: 'view_created_missing', activity_id: id },
    });
  }
}

/**
 * Deleted from the view modal (it emits `deleted`, then `close`): nothing is left to reveal, so
 * drop the reveal parked by "View Activity" before `closeViewModal` would flush it.
 */
function handleViewDeleted(id: string) {
  if (activityReveal.pending.value?.id === id) activityReveal.cancel();
}

/** The view modal closed: finish a reveal parked for this activity by "View Activity". */
function closeViewModal() {
  const id = viewingActivity.value?.id;
  viewingActivity.value = null;
  if (id && activityReveal.pending.value?.id === id) void activityReveal.flush('view_close');
}

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
// The envelope the extraction arrived in — what lets ActivityModal offer the free correction.
const activityPrefillEnv = ref<ResultEnvelope | undefined>(undefined);

// Shared per-document consent gate. The modal itself is mounted ONCE in App.vue (#64), so
// this page only asks; it hosts no consent UI. The grant is held between the gate and the
// picker's file event because consent runs BEFORE the picker opens (privacy-correct order)
// while the extraction call that needs the token happens after a file is chosen.

type PhotoActivityReady = {
  prefill: Partial<CreateFamilyActivityInput>;
  confidence: FieldConfidence;
  sourcePhoto?: File;
  /** Carried through to `ActivityModal` so it can offer the free "not right?" correction. */
  env: ResultEnvelope;
  /** To-dos the same read found for this activity (#113): reviewed before the form opens. */
  todo?: TodoExtractionResult;
};

// --- Magic beans to-dos (#113) ---
// A shared result (an activity AND to-dos) opens the to-do review drawer FIRST. Its `ready` is
// parked meanwhile; once the to-dos are saved the capture carries on down the normal path
// (duplicate check, then the pre-filled activity form), and the saved ids wait in
// `pendingTodoLinkIds` until the activity is saved, when `commitTodoLink` links them.
const TODO_REVIEW_SURFACE = 'magic-todo-review';
const todoStore = useTodoStore();
const todoReview = ref<TodoReviewReady | null>(null);
let parkedCapture: PhotoActivityReady | null = null;
const pendingTodoLinkIds = ref<string[]>([]);

/**
 * Drop to-do ids that were waiting for an activity which will now never be saved (the form
 * closed unsaved, or a new capture replaced this one). The to-dos stay, unlinked; logged so
 * the unlinked rate is measurable.
 */
function dropPendingTodoLink(): void {
  const count = pendingTodoLinkIds.value.length;
  if (!count) return;
  pendingTodoLinkIds.value = [];
  logEvent({
    level: 'info',
    surface: TODO_REVIEW_SURFACE,
    message: 'link_skipped',
    context: { action: 'link_skipped', count },
  });
}

/**
 * Link the waiting to-dos to the activity just saved. Called in exactly two places in
 * `handleSave` (create, and a successful update or scoped save), BEFORE the modal state is
 * cleared. The ids are taken now; the write runs after the form has closed, so a slow or
 * failed link never holds the form open. A failure is toasted + reported by the store.
 */
function commitTodoLink(activityId: string | undefined): void {
  const ids = pendingTodoLinkIds.value;
  if (!ids.length) return;
  if (!activityId) return dropPendingTodoLink();
  pendingTodoLinkIds.value = [];
  void (async () => {
    await nextTick();
    const linked = await todoStore.linkTodosToActivity(ids, { activityId });
    if (!linked) return;
    logEvent({
      level: 'info',
      surface: TODO_REVIEW_SURFACE,
      message: 'linked',
      context: { action: 'linked', count: linked.length, activity_id: activityId },
    });
    // `patchMany` skips a to-do deleted meanwhile (another device), which is correct but must
    // not be silent: the shortfall is what tells a race apart from a projection divergence.
    const skipped = ids.length - linked.length;
    if (skipped > 0) {
      logEvent({
        level: 'warn',
        surface: TODO_REVIEW_SURFACE,
        message: 'link_partial',
        context: { action: 'link_partial', count: skipped, activity_id: activityId },
      });
    }
  })().catch((err) => {
    reportError({
      surface: TODO_REVIEW_SURFACE,
      message: 'linking saved to-dos to their activity threw',
      severity: 'error',
      error: err,
      context: { action: 'link_failed', count: ids.length, activity_id: activityId },
    });
  });
}

/** The drawer is done (saved, or could not build): carry the parked capture on to the form. */
async function resumeParkedCapture(savedIds: string[], stage: string): Promise<void> {
  const ready = parkedCapture;
  parkedCapture = null;
  // Never two dialogs at once: the drawer fully closes before the duplicate confirm or the
  // activity form can open (the WebKit stall precedent in `handleSave`).
  todoReview.value = null;
  pendingTodoLinkIds.value = savedIds;
  await nextTick();
  if (!ready) return;
  try {
    await continueActivityCapture(ready);
  } catch (err) {
    showToast('error', t('ai.error.title'), t('ai.error.generic'), {
      surface: TODO_REVIEW_SURFACE,
      context: { stage },
      error: err,
    });
  }
}

/**
 * The drawer only emits `saved` for the capture it is still showing: a save that lands after a
 * newer capture superseded it is dropped there (`MagicTodoReviewDrawer` checks its `ready`
 * identity after the write), so this always belongs to the parked capture.
 */
function onTodoReviewSaved(ids: string[]): void {
  void resumeParkedCapture(ids, 'resume_after_save');
}

function onTodoReviewBuildFailed(): void {
  void resumeParkedCapture([], 'resume_after_build_failed');
}

/** ✕ on the drawer: nothing saved, nothing opened (the drawer logs `dismissed`). */
function onTodoReviewClose(): void {
  todoReview.value = null;
  parkedCapture = null;
}

/**
 * Reset the shared modal context and close-then-reopen so ActivityModal's open-watch re-fires
 * (onNew or onEdit, depending on whether editingActivity is set) even when a modal is already
 * open (the in-modal "Perform magic" path). Runs only on a successful extraction — a declined
 * consent or a failed read never reaches here, so an open modal is left exactly as it was.
 */
function openExtractionModalReset(): void {
  sidebarDate.value = null;
  editingOccurrenceDate.value = undefined;
  selectedDate.value = undefined;
  defaultStartTime.value = undefined;
  defaultAssigneeId.value = undefined;
  showModal.value = false;
  void nextTick(() => {
    showModal.value = true;
  });
}

/** Open a fresh new-activity form pre-filled from the extracted document (today's behavior). */
function applyAddNew(ready: PhotoActivityReady): void {
  editingActivity.value = null;
  activityPrefill.value = ready.prefill;
  activityPrefillConfidence.value = ready.confidence;
  activitySourcePhoto.value = ready.sourcePhoto;
  activityPrefillEnv.value = ready.env;
  openExtractionModalReset();
}

/** Open the matched activity in edit mode, merged non-destructively with the extracted info. */
function applyUpdateExisting(match: FamilyActivity, ready: PhotoActivityReady): void {
  editingActivity.value = mergeExtractionIntoActivity(match, ready.prefill);
  // Prefill/confidence belong to the new-activity path only — clear so nothing leaks into edit.
  activityPrefill.value = undefined;
  activityPrefillConfidence.value = undefined;
  activitySourcePhoto.value = ready.sourcePhoto;
  // Kept even on the EDIT path: "this was never an activity" is a correction the user can only
  // make here, and it is just as true of a merge into an existing one.
  activityPrefillEnv.value = ready.env;
  openExtractionModalReset();
}

/**
 * After a successful extraction, detect whether the prefill duplicates an existing activity. If
 * it matches exactly one, ask the user whether to update it instead of adding a duplicate; 0 or
 * 2+ matches (or a detection error) fall back to today's add-new behavior.
 */
async function onPhotoActivityReady(ready: PhotoActivityReady): Promise<void> {
  // Each capture owns the pending link. A second capture (the form's own magic beans card)
  // must not link capture A's to-dos to capture B's activity.
  dropPendingTodoLink();
  // A capture that arrives while the drawer is still open for an earlier one (the OS share
  // sheet reaches the page behind the drawer) supersedes it: close the drawer and drop the
  // parked capture first, so the new form never opens over the drawer and a later save of the
  // stale drawer can never resume capture A over capture B.
  if (todoReview.value) {
    todoReview.value = null;
    parkedCapture = null;
    logEvent({
      level: 'info',
      surface: TODO_REVIEW_SURFACE,
      message: 'dismissed',
      context: { action: 'dismissed', stage: 'superseded' },
    });
    await nextTick();
  }
  if (ready.todo?.items.length) {
    // Never a drawer over the form: close it first (it may be open for the capture above).
    if (showModal.value) {
      closeActivityModal();
      await nextTick();
    }
    parkedCapture = ready;
    todoReview.value = {
      result: ready.todo,
      eventSummary: {
        title: ready.prefill.title ?? '',
        icon: ready.prefill.category ? getActivityFallbackEmoji(ready.prefill.category) : undefined,
        date: ready.prefill.date,
        startTime: ready.prefill.isAllDay ? undefined : ready.prefill.startTime,
        endTime: ready.prefill.isAllDay ? undefined : ready.prefill.endTime,
        location: ready.prefill.location,
        link: ready.prefill.link,
      },
      env: ready.env,
      primaryKind: 'event',
      // Only a hint for flagging to-dos already linked to it; the confirm step below runs
      // its own check, and the user's choice there stands.
      probableActivityId: detectDuplicateActivity(ready.prefill, 'todo_hint')?.id,
    };
    return;
  }
  return continueActivityCapture(ready);
}

/**
 * Captures whose duplicate lookup already threw and was reported. A capture with to-dos looks up
 * twice (`todo_hint`, then `confirm` on the SAME parked prefill object), and a deterministic
 * throw would otherwise be reported twice for one capture.
 */
const duplicateLookupReported = new WeakSet<PhotoActivityReady['prefill']>();

/**
 * The one caller of `findDuplicateActivity` on this page, so the fallback lives in one place:
 * a lookup that throws is reported (once per capture) and the capture is treated as new.
 */
function detectDuplicateActivity(
  prefill: PhotoActivityReady['prefill'],
  stage: 'todo_hint' | 'confirm'
): FamilyActivity | null {
  try {
    return findDuplicateActivity(prefill, activityStore.activeActivities);
  } catch (err) {
    if (duplicateLookupReported.has(prefill)) {
      // Already reported for this capture; still leave a trace of this stage's fallback.
      logEvent({
        level: 'debug',
        surface: 'ai-activity-capture',
        message: 'duplicate_check_failed_repeat',
        context: { action: 'duplicate_check_failed_repeat', stage },
      });
      return null;
    }
    duplicateLookupReported.add(prefill);
    reportError({
      surface: 'ai-activity-capture',
      severity: 'warning',
      message:
        stage === 'todo_hint'
          ? 'duplicate activity lookup failed; no duplicate hint'
          : 'duplicate activity lookup failed; treating as new',
      error: err,
      context: { action: 'duplicate_check_failed', stage },
    });
    return null;
  }
}

/** The duplicate check, then the pre-filled form: the path every event capture ends on. */
async function continueActivityCapture(ready: PhotoActivityReady): Promise<void> {
  const match = detectDuplicateActivity(ready.prefill, 'confirm');
  if (!match) return applyAddNew(ready);

  const update = await confirm({
    title: 'planner.duplicate.title',
    message: 'planner.duplicate.message',
    detail: `${match.title} • ${formatDateFull(match.date)}`,
    variant: 'info',
    confirmLabel: 'planner.duplicate.updateExisting',
    cancelLabel: 'planner.duplicate.addAnyway',
  });
  return update ? applyUpdateExisting(match, ready) : applyAddNew(ready);
}

// DELIVERY only. The capture half — the picker, consent, the busy guard, the extract call —
// moved to `MagicBeansDoor` and the shared spine, so every door validates, locks, counts and
// logs identically instead of five near-copies drifting apart.
const { deliverEvent } = useDocumentToActivity({
  onActivityReady: onPhotoActivityReady,
});

// Photo-reader cross-surface dispatch: the global FAB card sets `pendingMagic`
// and navigates here; pick it up (watch + onMounted) and run the same handler.
// A capture arrives already extracted (#64, #84) and is DELIVERED rather than re-read; no
// payload means an affordance asked to open the picker instead.
//
// ⚠️ The payload-less `else` is UNREACHABLE for 'photo'. It was already unreachable once the
// three magic chips went; now the door owns opening entirely, so there is nothing left that
// could call `openReader('photo')` without a payload. The branch is kept because
// `useMagicReaderConsumer`'s handler signature is shared with 'document', which still uses it
// (`VacationStep1`) — making one of three consumers a different shape would gain nothing.
useMagicReaderConsumer(
  'photo',
  (payload) => {
    if (payload) deliverEvent(payload.data, payload.env, payload.todo);
  },
  canReadPhoto
);

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

/**
 * Everything the activity modal leaves behind, dropped in ONE place.
 *
 * ⚠️ Called from `handleSave` too, not only from `@close`. `handleSave` sets `showModal = false`
 * directly, so the inline clears this replaced never ran on the save path — `activitySourcePhoto`
 * survived an AI-created activity and was then staged onto the NEXT activity opened for edit,
 * uploading the previous document and linking it with no prompt. Six refs cleared in four places
 * is the shape that half-updates; this is the one place.
 */
function clearActivityModalState(): void {
  defaultStartTime.value = undefined;
  defaultAssigneeId.value = undefined;
  activityPrefill.value = undefined;
  activityPrefillConfidence.value = undefined;
  activitySourcePhoto.value = undefined;
  activityPrefillEnv.value = undefined;
  // To-dos still waiting here are for an activity that was not saved (a save commits them
  // first via `commitTodoLink`), so they stay unlinked.
  dropPendingTodoLink();
}

function closeActivityModal(): void {
  showModal.value = false;
  clearActivityModalState();
}

function openAddModal(date?: string, time?: string, memberId?: string) {
  // A manual add is never a photo prefill — clear any leftover so it can't leak in
  // (incl. the source photo, or it would attach to the next manually-added activity).
  clearActivityModalState();
  // A new add supersedes revealing the previous one ("+ add another" lands here too).
  activityReveal.cancel();
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
  referenceDate.value = parseLocalDate(date);
  activeView.value = 'day';
}

// Mobile week-strip day pick: move the reference date but STAY in week view.
function handleSelectDay(date: string) {
  referenceDate.value = parseLocalDate(date);
}

/**
 * ONE imperative channel into the mobile month stream. `todayTick` still serves
 * the week/day views (they take it directly); the stream takes this instead, so
 * a "Today" tap and a swipe landing can never race two separate signals.
 */
const streamAnchor = ref<{ tick: number; target: AnchorTarget }>({ tick: 0, target: 'today' });
function bumpStreamAnchor(target: AnchorTarget) {
  streamAnchor.value = { tick: streamAnchor.value.tick + 1, target };
}

/**
 * The stream scrolled into a different month — follow it with the shared
 * reference date so the command-bar label (and everything else keyed off the
 * period) stays honest. The stream's re-anchor rule makes this loop-safe: it
 * ignores a reference-date change that names the month already in view.
 */
// Period navigation (command bar + view swipe).
function handlePrev() {
  goPrev();
  bumpStreamAnchor('month-start');
}
function handleNext() {
  goNext();
  bumpStreamAnchor('month-start');
}
// Bumped on every "Today" tap so the views always re-scroll to today — even
// when the reference date doesn't change (already on the current month/day),
// where a plain `watch(referenceDate)` would never fire.
const todayTick = ref(0);
function handleToday() {
  goToday();
  todayTick.value++;
  bumpStreamAnchor('today');
}
function handleMonthInView(firstOfMonth: Date) {
  // Keep the day-of-month. `referenceDate` is SHARED with the week and day
  // views, so writing the 1st here meant scrolling the mobile month stream and
  // then tapping "Day" opened the 1st instead of the day you were looking at —
  // a regression the old day-stack never had, because scrolling it never
  // touched the shared date at all.
  const y = firstOfMonth.getFullYear();
  const m = firstOfMonth.getMonth();
  const daysInTarget = new Date(y, m + 1, 0).getDate();
  referenceDate.value = new Date(y, m, Math.min(referenceDate.value.getDate(), daysInTarget));
}

// A calendar nav tap (center button / Planning-stack Activities) jumps to today —
// incl. the already-on-this-page case where router.push is a no-op.
usePlannerTodayConsumer(handleToday);
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
  // Editing it now: a reveal parked by "View Activity" would fire on some later close.
  activityReveal.cancel();
  await nextTick();
  // Opening an EXISTING activity is never a correction of a document, and it must not inherit
  // the previous capture's source photo either — see `clearActivityModalState`.
  clearActivityModalState();
  editingActivity.value = target;
  editingOccurrenceDate.value = occurrenceDate;
  showModal.value = true;
}

async function handleSave(
  data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }
) {
  // Track payment changes (adding or removing linked recurring payment).
  //
  // `data.data` is a MINIMAL DIFF, so an untouched `payFromAccountId` is ABSENT
  // — not falsy. Both checks must therefore gate on the key being PRESENT
  // (Recurring Invariant 6: absent means "untouched", never "cleared").
  // Without this, every occurrence edit of a paid activity would read as a
  // "remove", deleting its generated transactions AND routing the save around
  // the scope modal into a template-wide update.
  //
  // One named predicate, deliberately — two independently-written `in`
  // expressions is exactly how FamilyNookPage drifted out of step here.
  const isUpdate = 'id' in data && 'data' in data;
  // An update-shaped save with no activity opened for edit is ActivityModal's eager create (it
  // created the activity early to attach a photo): new to the person, so it is revealed too.
  const isEagerCreate = isUpdate && !editingActivity.value;
  const touchedPayment = isUpdate && 'payFromAccountId' in data.data;
  const isAddingPayment =
    touchedPayment && !!data.data.payFromAccountId && !editingActivity.value?.linkedRecurringItemId;
  const isRemovingPayment =
    touchedPayment && !data.data.payFromAccountId && !!editingActivity.value?.linkedRecurringItemId;
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
      // Direct update: non-recurring, or adding/removing a payment (a payment is
      // a SERIES-level concern, so it always applies to the template).
      //
      // The payment bypass skips the scope modal, so a date edit made in the
      // same save would land on the template — and since the form now seeds
      // `date` from the clicked OCCURRENCE, that would silently jump the whole
      // series to this one session's date (and re-anchor the new fee item to
      // it). Drop the schedule fields on this path: the user's intent here is
      // the payment, and a date move has its own scoped path.
      const patch = { ...data.data };
      if (isPaymentChange && editingActivity.value?.recurrence !== 'none') {
        // A payment-only change deliberately skips the scope modal, so it must
        // not carry ANY schedule field — a date move has its own scoped path.
        // #70: `rule` and `recurrenceEndDate` belong here too. `rule` is now the
        // authoritative schedule, so leaving it in rewrote the whole series with
        // no scope prompt, and left `daysOfWeek` stale relative to it (breaking
        // the shadow-fidelity contract that the multi-weekday guard and the
        // Google push hash both depend on).
        delete patch.date;
        delete patch.daysOfWeek;
        delete patch.rule;
        delete patch.recurrence;
        delete patch.recurrenceEndDate;
        // A "Lasts" change is relative to the OPENED repeat, not the template's
        // start; written raw here it would stretch every repeat. It has its own
        // scoped path too.
        delete patch.endDate;
      }
      if (!(await activityStore.updateActivity(data.id, patch))) {
        reportSessionActionFailed();
        return;
      }
    }
  } else {
    const created = await activityStore.createActivity(data as CreateFamilyActivityInput);
    commitTodoLink(created?.id);
    // Close the ActivityModal BEFORE opening CreatedConfirmModal so two
    // role=dialog / aria-modal=true overlays never coexist in the DOM.
    // WebKit under CI contention has been observed to stall the second
    // modal's visibility for >15s when the first is still teleported in
    // — surfaces as the recurring "Activity Created" E2E flake (see
    // docs/E2E_HEALTH.md 2026-05-03 entry). nextTick lets Vue flush the
    // v-if removal of the first dialog before we mount the second.
    showModal.value = false;
    clearActivityModalState();
    if (created) {
      // Move the calendar to it now, behind the confirmation; the scroll + pulse run once the
      // confirmation is dismissed (`handleCreatedConfirmClose`), where they can be seen.
      activityReveal.prepare(created.id, 'created');
      await nextTick();
      showActivityCreatedConfirmation(data as CreateFamilyActivityInput, created.id);
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

  commitTodoLink((data as { id: string }).id);
  showModal.value = false;
  clearActivityModalState();

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

  // No "Activity Created" confirmation follows an eager create, so reveal it now (after any
  // payment dialog above has closed, so the pulse is not spent behind it).
  if (isEagerCreate) void activityReveal.revealNow((data as { id: string }).id, 'eager_create');
}

function showActivityCreatedConfirmation(data: CreateFamilyActivityInput, activityId: string) {
  const dateStr = formatDateFull(data.date);
  const details: ConfirmDetail[] = [
    { label: t('planner.field.title'), value: data.title },
    { label: t('form.category'), value: categoryLabel(data.category) },
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
    activityId,
  };
}

async function handleDelete() {
  if (!editingActivity.value) return;
  const activityToDelete = editingActivity.value;
  showModal.value = false;
  clearActivityModalState();
  await confirmAndDeleteActivity(activityToDelete);
  editingActivity.value = null;
  editingOccurrenceDate.value = undefined;
}

// --- Todo view/edit modal ---
const selectedTodo = ref<TodoItem | null>(null);

function openTodoViewModal(todo: TodoItem) {
  selectedTodo.value = todo;
}

function handleActivitySwapped(newId: string) {
  // A swap follows an inline edit (an override or a split replaced the record on view). Editing
  // it drops a reveal parked by "View Activity", as `handleViewOpenEdit` does; left parked for
  // the old id, it would never match a close again and fire on some much later flush.
  activityReveal.cancel();
  const newActivity = activityStore.activities.find((a) => a.id === newId);
  if (newActivity) viewingActivity.value = newActivity;
}
</script>

<template>
  <!-- No `space-y-*` here: the calendar view must butt flush against the sticky
       command bar (its docked header sits at `top: var(--planner-cmdbar-h)`).
       The only in-flow gap we want is below the view, handled by `mt-*` on the
       inactive-activities block; everything else here is a Teleport/overlay. -->
  <div ref="plannerRootRef">
    <!-- Sticky command bar — period hero + nav + view toggle + filter + Add
         + trip ribbon. The calendar is the page hero; nothing above it. -->
    <CalendarCommandBar
      :label="label"
      :note="homeTimeZoneNote"
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
      @open-agenda="handleOpenAgenda"
      @select-all="onSelectAll"
      @select-member="onSelectMember"
      @vacation-click="handleVacationClick"
    />

    <!-- Calendar views (conditional on activeView), controlled by referenceDate.
         Month view has two sibling surfaces: the continuous day-stack stream on
         mobile, the 7-column grid at md+. Mounting them here (rather than
         branching inside CalendarGrid) keeps the grid's interface untouched. -->
    <CalendarMonthStream
      v-if="activeView === 'month' && isMobile"
      :reference-date="referenceDate"
      :anchor="streamAnchor"
      @select-date="handleCalendarDateClick"
      @prev="handlePrev"
      @next="handleNext"
      @month-in-view="handleMonthInView"
      @vacation-click="handleVacationClick"
      @view-segment="handleViewSegment"
      @view-activity="(id: string, date: string) => openViewModal(id, date)"
      @holiday-click="handleHolidayClick"
      @birthday-click="handleBirthdayClick"
    />

    <CalendarGrid
      v-else-if="activeView === 'month'"
      :reference-date="referenceDate"
      @select-date="handleCalendarDateClick"
      @prev="handlePrev"
      @next="handleNext"
      @vacation-click="handleVacationClick"
      @view-segment="handleViewSegment"
      @view-activity="(id: string, date: string) => openViewModal(id, date)"
      @holiday-click="handleHolidayClick"
      @birthday-click="handleBirthdayClick"
    />

    <WeeklyCalendarView
      v-else-if="activeView === 'week'"
      :reference-date="referenceDate"
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
      @birthday-click="handleBirthdayClick"
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
      @birthday-click="handleBirthdayClick"
    />

    <!-- Connect-Google-Calendar nudge — below the calendar (month view), self-
         gating (flag on + not connected + not dismissed). Never above the grid.
         The mt-4 falls through to the banner root, which only renders when the
         nudge is actually shown, so there's no empty spacer when it's hidden. -->
    <CalendarConnectNudge v-if="activeView === 'month'" class="mt-4" />

    <!-- Inactive activities toggle (month view only) -->
    <div v-if="activeView === 'month' && activityStore.inactiveActivities.length > 0" class="mt-4">
      <button
        type="button"
        class="text-secondary-500/50 hover:text-secondary-500 dark:text-ink-faint dark:hover:text-ink-soft flex items-center gap-2 text-sm transition-colors"
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
          class="dark:bg-surface-raised/60 flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white/60 px-3 py-2.5 text-left opacity-60 shadow-[0_2px_10px_rgba(44,62,80,0.03)] transition-all hover:opacity-100 hover:shadow-[0_4px_16px_rgba(44,62,80,0.06)]"
          style="border-left-color: #95a5a6"
          @click="openViewModal(activity.id)"
        >
          <span class="flex-shrink-0 text-base leading-none opacity-50">
            {{ activity.icon ?? getActivityFallbackEmoji(activity.category) }}
          </span>
          <span
            class="font-outfit text-secondary-500/60 dark:text-ink-soft min-w-0 flex-1 truncate text-sm font-semibold"
          >
            {{ activity.title }}
          </span>
          <span class="text-secondary-500/30 dark:text-ink-faint flex-shrink-0 text-xs">
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
      @birthday-click="handleBirthdayClick"
    />

    <!-- Birthday details popup (read-only - see BirthdayDetailsModal) -->
    <BirthdayDetailsModal
      :birthday="selectedBirthday"
      :open="selectedBirthday !== null"
      :today-ymd="todayStr"
      @close="selectedBirthday = null"
      @open-profile="openBeanProfile"
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
      :prefill-env="activityPrefillEnv"
      :source-photo="activitySourcePhoto"
      :read-only="!canEditActivities"
      :occurrence-date="editingOccurrenceDate"
      @close="closeActivityModal"
      @save="handleSave"
      @delete="handleDelete"
      @start-vacation-wizard="handleStartVacationWizard"
    />

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

    <!-- Magic beans to-dos (#113): reviewed before the activity form opens. -->
    <MagicTodoReviewDrawer
      :open="todoReview !== null"
      :ready="todoReview"
      @close="onTodoReviewClose"
      @saved="onTodoReviewSaved"
      @build-failed="onTodoReviewBuildFailed"
    />

    <ActivityViewEditModal
      :activity="viewingActivity"
      :occurrence-date="viewingOccurrenceDate"
      @close="closeViewModal"
      @deleted="handleViewDeleted"
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
      allow-view
      :view-label="t('planner.viewCreatedActivity')"
      @close="handleCreatedConfirmClose"
      @create-another="handleCreateAnother"
      @view="handleCreatedView"
    />
  </div>
</template>
