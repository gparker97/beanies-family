/**
 * Helpful Hints (#40) — the reactive orchestrator (MVO orchestrator layer).
 *
 * Init ONCE from App.vue, alongside useLocalNotifications(). Holds NO business
 * rules — it purely: guards → assembles inputs (injecting the app's translator +
 * date formatter) → calls the pure engine (`utils/helpfulHints`) → applies the
 * desired/existing diff through existing `todoStore` actions → emits telemetry.
 *
 * It deliberately does NOT watch `todoStore.todos`, so creating a hint to-do can
 * never re-enter this watcher (no reconcile↔reschedule loop): the reminder path
 * observes `todos`, this observes only the source data + the master switch.
 */
import { watch } from 'vue';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useActivityStore } from '@/stores/activityStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';
import { isFlagEnabled } from '@/config/flags';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { assembleOccurrencesByDate } from '@/utils/occurrenceAssembly';
import { computeDesiredHints, reconcileHints } from '@/utils/helpfulHints';
import { toAssigneePayload } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { addDaysYmd, formatDateWithDay, parseLocalDate } from '@/utils/date';
import type { TodoItem } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

const DEBOUNCE_MS = 1000;
/** Floor for the occurrence-assembly window (the largest configured lead may
 *  extend it). Keeps the window sane if every lead were set very small. */
const MIN_WINDOW_DAYS = 14;
const SURFACE = 'helpful-hints';

let initialized = false;

/** Reset the module singleton — TEST ONLY. */
export function __resetHelpfulHintsForTesting(): void {
  initialized = false;
}

export function useHelpfulHints(): void {
  if (initialized) return;
  if (!isFlagEnabled('helpfulHints')) return;
  initialized = true;

  const { today } = useToday();
  const { t } = useTranslation();
  const familyStore = useFamilyStore();
  const activityStore = useActivityStore();
  const vacationStore = useVacationStore();
  const settingsStore = useSettingsStore();
  const todoStore = useTodoStore();

  // Adapt the app's key-only t() + fillTemplate into the engine's pure translator.
  const translate = (key: string, params?: Record<string, string>) =>
    params ? fillTemplate(t(key as UIStringKey), params) : t(key as UIStringKey);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let rerunQueued = false;

  async function removeAll(hints: TodoItem[]): Promise<number> {
    let removed = 0;
    for (const h of hints) {
      // deleteTodo is wrapAsync-guarded (toast + telemetry on failure, returns
      // false); never throws, so one failed delete can't abort the batch.
      if (await todoStore.deleteTodo(h.id)) removed++;
    }
    return removed;
  }

  async function reconcile(): Promise<void> {
    const currentMember = familyStore.currentMember;
    // Family doc not loaded → never reconcile against an empty world (mirrors the
    // reminder path's null-guard), else we'd delete every hint on a cold start.
    if (!currentMember) return;

    const flagOn = true; // guaranteed by the init guard
    const masterOn = settingsStore.helpfulHintsEnabled;
    const existing = todoStore.hintTodos;

    // Master OFF (family-synced) → remove un-acknowledged, un-completed hints and
    // generate nothing. Acknowledged/completed hints are the family's own to-dos.
    if (!masterOn) {
      const stale = existing.filter((h) => !h.hintAcknowledged && !h.completed);
      const pruned = await removeAll(stale);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'reconcile',
        context: {
          hint_flag_on: flagOn,
          hint_master_on: false,
          hint_generated: 0,
          hint_expired: 0,
          hint_pruned_stale: pruned,
          hint_total: existing.length - pruned,
          hint_skipped_records: 0,
        },
      });
      return;
    }

    const todayStr = today.value;
    const leadDays = settingsStore.helpfulHintLeadDays;
    // Assemble occurrences out to the largest configured lead, so a family that
    // sets, say, a 30-day anniversary lead still sees those occurrences.
    const windowDays = Math.max(MIN_WINDOW_DAYS, ...Object.values(leadDays));
    const start = parseLocalDate(todayStr);
    const end = parseLocalDate(addDaysYmd(todayStr, windowDays));
    const occurrences = assembleOccurrencesByDate(
      activityStore.activeActivitiesForMonth,
      start,
      end
    );

    const { hints, skipped } = computeDesiredHints({
      today: todayStr,
      members: familyStore.humans,
      occurrences,
      vacations: vacationStore.upcomingVacations,
      leadDays,
      translate,
      formatDate: (ymd) => formatDateWithDay(ymd),
    });

    const { toCreate, toRemove } = reconcileHints(hints, existing, todayStr);

    // Create. Final race guard: skip if an existing hint already claims the key.
    const seen = new Set(existing.map((h) => h.hintKey).filter(Boolean));
    let generated = 0;
    for (const d of toCreate) {
      if (seen.has(d.hintKey)) continue;
      const created = await todoStore.createTodo({
        title: d.title,
        ...toAssigneePayload(d.assigneeIds),
        dueDate: d.nudgeDate,
        dueTime: '09:00',
        completed: false,
        createdBy: currentMember.id,
        hintType: d.hintType,
        hintKey: d.hintKey,
        hintEventDate: d.eventDate,
      });
      if (created) {
        generated++;
        seen.add(d.hintKey);
      }
    }

    // Remove (expired + stale). Split the count for triage.
    const expiredCount = toRemove.filter(
      (h) => h.hintEventDate && h.hintEventDate < todayStr
    ).length;
    const removed = await removeAll(toRemove);

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'reconcile',
      context: {
        hint_flag_on: flagOn,
        hint_master_on: true,
        hint_generated: generated,
        hint_expired: Math.min(expiredCount, removed),
        hint_pruned_stale: Math.max(removed - expiredCount, 0),
        hint_total: existing.length - removed + generated,
        hint_skipped_records: skipped,
      },
    });
  }

  // Single entry point. A thrown reconcile would otherwise silently kill the
  // watcher (Vue stops re-running a watcher whose effect throws), disabling all
  // future hint generation — so the whole body is guarded and self-heals on the
  // next input change.
  async function runReconcile(): Promise<void> {
    if (inFlight) {
      rerunQueued = true;
      return;
    }
    inFlight = true;
    try {
      await reconcile();
    } catch (error) {
      reportError({
        surface: SURFACE,
        severity: 'error',
        message: 'reconcile failed; hint generation skipped this cycle',
        error,
      });
    } finally {
      inFlight = false;
      if (rerunQueued) {
        rerunQueued = false;
        queueReconcile();
      }
    }
  }

  function queueReconcile(): void {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void runReconcile(), DEBOUNCE_MS);
  }

  // Reactive to the day clock, the roster, the activity/vacation sources, and the
  // family master switch — NOT to `todos` (see file header). Debounced; runs once
  // on mount. Deep so an in-place edit (e.g. a member's dateOfBirth) is caught.
  watch(
    [
      today,
      () => familyStore.humans,
      () => activityStore.activeActivities,
      () => vacationStore.upcomingVacations,
      () => settingsStore.helpfulHintsEnabled,
    ],
    queueReconcile,
    { immediate: true, deep: true }
  );
}
