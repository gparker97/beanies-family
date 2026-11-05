/**
 * Calendar drag and drop (#142): the orchestrator. MVO: the drag binding (`useCalendarDrag`)
 * works out WHAT was grabbed and WHERE it landed; this module turns a drop into store writes,
 * the confirmation toast and its Undo. Views never call the store for a drag.
 *
 * - `resolveDragSource` turns the DOM's source reference into a `DragSource` (the live
 *   record from the store, the occurrence start a repeat keys on).
 * - `commitCalendarMove` writes one drop: a one-off or override child through
 *   `updateActivity`, a repeat through the edit sheet's own scoped save (the prompt, the
 *   multi-weekday guard, the anchor shift, the rule re-target, the reap and their telemetry).
 * - `undoCalendarMove` runs the recipe `undoRecipeFor` chose.
 *
 * Every store failure is already toasted by the time it reaches here (`wrapAsync`, or the
 * scoped save's `reportSessionActionFailed`), so this module adds no second error toast;
 * the one exception is an Undo whose record vanished, which nothing else reports.
 *
 * Plan: `~/projects/beanies-ops/docs/plans/2026-11-05-calendar-drag-and-drop-142.md`.
 */
import { DRAG_SURFACE } from '@/composables/drag/dragTelemetry';
import { useActivityScopeEdit } from '@/composables/useActivityScopeEdit';
import type { ScopedSaveOutcome } from '@/composables/useActivityScopeEdit';
import type { RecurringEditScope } from '@/composables/useRecurringEditScope';
import { showToast, UNDO_TOAST_MS } from '@/composables/useToast';
import { getAllCalendarEventLinks } from '@/services/automerge/repositories/calendarRepository';
import { logEvent } from '@/services/telemetry';
import { useActivityStore } from '@/stores/activityStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { FamilyActivity, UpdateFamilyActivityInput } from '@/types/models';
import { reportSessionActionFailed } from '@/utils/actionFailure';
import { isAllDayActivity, isRepeatingActivity } from '@/utils/calendar/activityDays';
import {
  captureBefore,
  MOVE_KEYS,
  undoRecipeFor,
  type UndoRecipe,
} from '@/utils/calendar/activityUndo';
import type { DragSourceRef } from '@/utils/calendar/dragDom';
import type { DragInput } from '@/utils/calendar/dragGesture';
import {
  dragItemKindOf,
  isDraggableActivity,
  type DragGesture,
  type DragSource,
  type DragView,
  type DropTarget,
  type PatchResult,
} from '@/utils/calendar/dragMath';
import { beaniesMayPush } from '@/utils/calendar/linkOwnership';
import {
  dayOfMonth,
  extractDatePart,
  formatTime12,
  minutesToHHmm,
  weekdayShort,
} from '@/utils/date';
import { reportError } from '@/utils/errorReporter';
import { fillTemplate } from '@/utils/fillTemplate';

export type MoveEffect = Extract<PatchResult, { kind: 'patch' }>['effect'];

/** What a drop did. Cancelled / refused / failed reuse the scoped save's own shapes. */
export type MoveOutcome =
  | {
      kind: 'saved';
      scope: RecurringEditScope | 'single';
      effect: MoveEffect;
      /** `null` when the drop cannot be undone (this and future, or an 'all' move that reaped). */
      undo: UndoRecipe | null;
    }
  | Exclude<ScopedSaveOutcome, { kind: 'saved' }>;

/** Who dropped what, where: the context every `drop` event carries. */
export interface DropContext {
  source: DragSource;
  view: DragView;
  gesture: DragGesture;
  input: DragInput;
}

export interface CalendarMoveRequest extends DropContext {
  /** The `dropPatch` result's minimal diff. */
  patch: UpdateFamilyActivityInput;
  effect: MoveEffect;
}

export type DropStage = 'saved' | 'noop' | 'cancelled' | 'refused' | 'failed' | 'invalid';

/**
 * The ONE `drop` event (surface `calendar-drag`), for every outcome: `commitCalendarMove`
 * logs saved / cancelled / refused / failed, and the binding logs the drops that never reach
 * it (`noop`, a `dropPatch` refusal, `invalid`). Allowlisted keys only, fixed per surface:
 * `format` = view, `kind` = item kind, `detail` = input, `recur_outcome` = gesture.
 */
export function logDrop(
  ctx: DropContext,
  stage: DropStage,
  scope?: RecurringEditScope | 'single'
): void {
  logEvent({
    surface: DRAG_SURFACE,
    level: stage === 'failed' || stage === 'invalid' ? 'warn' : 'info',
    message: 'drop',
    context: {
      action: 'drop',
      stage,
      format: ctx.view,
      kind: dragItemKindOf(ctx.source.activity),
      detail: ctx.input,
      recur_outcome: ctx.gesture,
      ...(scope ? { recur_scope: scope } : {}),
      activity_id: ctx.source.activity.id,
    },
  });
}

/** "Fri 13", or "Fri 13, 4:30pm" when a time is given. */
function whenLabel(ymd: string, hhmm?: string): string {
  const day = `${weekdayShort(ymd)} ${dayOfMonth(ymd)}`;
  return hhmm ? `${day}, ${formatTime12(hhmm)}` : day;
}

/** A drop target as people read it ("Fri 13" / "Fri 13, 4pm"), for toasts and announcements. */
export function dropWhenLabel(target: DropTarget): string {
  return target.kind === 'time'
    ? whenLabel(target.date, minutesToHHmm(target.minutes))
    : whenLabel(target.date);
}

/**
 * The DOM's source reference → the `DragSource` the patch math needs, or `null` when there
 * is nothing that may be dragged. The record always comes from the store, never the DOM: a
 * repeat keys on the start of the occurrence under the finger (`repeatStartFor`), a one-off
 * or override child on its own date. `grab` is the drop target under the pointer at press;
 * the source's `data-occurrence-date` is only the fallback (the desktop month popover).
 */
export function resolveDragSource(
  ref: DragSourceRef | null,
  grab: DropTarget | null
): DragSource | null {
  if (!ref) return null;
  const activityStore = useActivityStore();
  const activity = activityStore.activities.find((a) => a.id === ref.activityId);
  if (!activity) {
    // The view drew a record the store no longer has: an invariant break, not a user error.
    reportError({
      surface: DRAG_SURFACE,
      message: 'A drag source resolved to no activity',
      severity: 'error',
      context: { action: 'resolve', detail: 'missing-activity' },
    });
    return null;
  }
  if (!isDraggableActivity(activity)) {
    logEvent({
      surface: DRAG_SURFACE,
      level: 'debug',
      message: 'ineligible',
      context: {
        action: 'ineligible',
        detail: activity.vacationId ? 'vacation' : 'inactive',
        activity_id: activity.id,
      },
    });
    return null;
  }
  const grabDate = grab?.date ?? ref.occurrenceDate;
  return {
    activity,
    seriesDate: isRepeatingActivity(activity)
      ? activityStore.repeatStartFor(activity, grabDate)
      : extractDatePart(activity.date),
    grabDate,
    ...(grab?.kind === 'time' ? { grabMinutes: grab.minutes } : {}),
    ...(ref.columnMemberId ? { columnMemberId: ref.columnMemberId } : {}),
  };
}

/**
 * Is any Google link for this activity (or, for an override child, its series) someone
 * else's event, which beanies never writes? A read failure is logged and treated as "no
 * link": the note is informational and must never block the toast.
 */
async function googleCopyUnchanged(activity: FamilyActivity): Promise<boolean> {
  const ids = new Set([activity.id, activity.parentActivityId].filter(Boolean));
  try {
    const connectionIds = new Set(useCalendarSyncStore().connections.map((c) => c.id));
    if (connectionIds.size === 0) return false;
    // One scan of the link table, filtered to this family's live connections. The master's
    // link decides (an `exceptionOf` link is a per-occurrence override, not ownership).
    const links = await getAllCalendarEventLinks();
    return links.some(
      (l) =>
        connectionIds.has(l.connectionId) &&
        ids.has(l.activityId) &&
        !l.exceptionOf &&
        !beaniesMayPush(l)
    );
  } catch (error) {
    logEvent({
      surface: DRAG_SURFACE,
      level: 'warn',
      message: 'Could not read the Google links of a moved activity',
      context: { action: 'google-link-lookup', stage: 'failed', activity_id: activity.id },
      error,
    });
    return false;
  }
}

/** The confirmation line for a saved drop, read off the record as it now stands. */
function savedTitle(req: CalendarMoveRequest, scope: RecurringEditScope | 'single'): string {
  const { t } = useTranslationStore();
  const { activity, seriesDate } = req.source;
  const after = { ...activity, ...req.patch } as FamilyActivity;
  const date = req.patch.date ? extractDatePart(req.patch.date) : seriesDate;
  const timed = !isAllDayActivity(after) && req.view !== 'month' && !!after.startTime;
  const vars = {
    title: activity.title,
    when: whenLabel(date, timed ? after.startTime : undefined),
    time: after.endTime ? formatTime12(after.endTime) : '',
    member: '',
  };
  if (req.effect === 'resized') return fillTemplate(t('planner.drag.resized'), vars);
  if (req.effect === 'reassigned') {
    const memberId = req.patch.assigneeIds?.[0];
    vars.member = useFamilyStore().members.find((m) => m.id === memberId)?.name ?? '';
    return fillTemplate(t('planner.drag.reassigned'), vars);
  }
  return fillTemplate(
    t(scope === 'this-and-future' ? 'planner.drag.movedSeries' : 'planner.drag.moved'),
    vars
  );
}

/** The drop toast's Undo action, when the drop can be undone. */
function undoAction(undo: UndoRecipe | null) {
  if (!undo) return undefined;
  return {
    actionLabel: useTranslationStore().t('action.undo'),
    actionFn: () => undoCalendarMove(undo),
    durationMs: UNDO_TOAST_MS,
  };
}

async function showSavedToast(
  req: CalendarMoveRequest,
  scope: RecurringEditScope | 'single',
  undo: UndoRecipe | null
): Promise<void> {
  const { t } = useTranslationStore();
  // An IndexedDB / CRDT read: fast enough to await before the toast, so the note is in it.
  const note = (await googleCopyUnchanged(req.source.activity))
    ? t('planner.drag.googleUnchanged')
    : undefined;
  showToast('success', savedTitle(req, scope), note, undoAction(undo));
}

/**
 * Write one drop. A one-off or override child is one `updateActivity`; a repeat goes through
 * `handleScopedSave` (the scope prompt on every drop). On `saved`, shows the confirmation
 * toast, with Undo when the outcome can be undone.
 */
export async function commitCalendarMove(req: CalendarMoveRequest): Promise<MoveOutcome> {
  const activityStore = useActivityStore();
  // The record as it is NOW (another device may have written since the press).
  const activity =
    activityStore.activities.find((a) => a.id === req.source.activity.id) ?? req.source.activity;

  let outcome: MoveOutcome;
  if (!isRepeatingActivity(activity)) {
    const before = captureBefore(activity, MOVE_KEYS);
    // An override child's first move pins its occurrence key (Recurring Invariant 4):
    // without it the master's slot stops being suppressed and the session renders twice.
    const patch =
      activity.parentActivityId && !activity.originalOccurrenceDate
        ? { ...req.patch, originalOccurrenceDate: extractDatePart(activity.date) }
        : req.patch;
    const updated = await activityStore.updateActivity(activity.id, patch, { source: 'drag' });
    if (!updated) {
      // `null` without a store toast is possible (a missing record), so report here.
      reportSessionActionFailed();
      outcome = { kind: 'failed' };
    } else {
      outcome = {
        kind: 'saved',
        scope: 'single',
        effect: req.effect,
        undo: { kind: 'restore', id: activity.id, before },
      };
    }
  } else {
    // Capture both possible Undo subjects before the write: the template ('all') and an
    // override child that a 'this only' save would REUSE (another device created it since
    // render), which Undo must restore rather than delete.
    const beforeTemplate = captureBefore(activity, MOVE_KEYS);
    const child = activityStore.findOverride(activity.id, req.source.seriesDate);
    const beforeChild = child ? captureBefore(child, MOVE_KEYS) : null;
    const { handleScopedSave } = useActivityScopeEdit();
    const saved = await handleScopedSave(activity.id, req.source.seriesDate, req.patch, {
      source: 'drag',
    });
    outcome =
      saved.kind === 'saved'
        ? {
            kind: 'saved',
            scope: saved.scope,
            effect: req.effect,
            undo: undoRecipeFor(saved, beforeTemplate, beforeChild),
          }
        : saved;
  }

  if (outcome.kind === 'saved') {
    logDrop(req, 'saved', outcome.scope);
    // The write is already in; a toast failure (a formatter on a malformed time, a link read)
    // must not turn a saved drop into a reported failure. Report it on its own, and still
    // confirm the move with its Undo: a plain title that needs no time or date formatting.
    try {
      await showSavedToast(req, outcome.scope, outcome.undo);
    } catch (error) {
      reportError({
        surface: DRAG_SURFACE,
        message: 'Saved a dragged move but could not show its toast',
        severity: 'error',
        error,
        context: { action: 'toast', stage: 'failed', activity_id: activity.id },
      });
      const { t } = useTranslationStore();
      const title = fillTemplate(t('planner.drag.movedPlain'), { title: activity.title });
      showToast('success', title, undefined, undoAction(outcome.undo));
    }
  } else {
    // failed: already toasted; refused: the guard toasted; cancelled: the person said no.
    logDrop(req, outcome.kind, isRepeatingActivity(activity) ? undefined : 'single');
  }
  return outcome;
}

/** Run an Undo recipe from the drop toast. Never throws; every failure is reported once. */
export async function undoCalendarMove(recipe: UndoRecipe): Promise<void> {
  const activityStore = useActivityStore();
  const logUndo = (stage: 'restored' | 'removed-override' | 'failed', id: string) =>
    logEvent({
      surface: DRAG_SURFACE,
      level: stage === 'failed' ? 'warn' : 'info',
      message: 'undo',
      context: { action: 'undo', stage, activity_id: id },
    });

  if (recipe.kind === 'restore') {
    // `before` always carries `endDate`, so no span rebase runs on the way back.
    const restored = await activityStore.updateActivity(recipe.id, recipe.before, {
      source: 'drag-undo',
    });
    if (restored) {
      logUndo('restored', recipe.id);
      return;
    }
    // The one unreported null: the record vanished (deleted on another device). An error
    // toast auto-reports with this context.
    const { t } = useTranslationStore();
    showToast('error', t('error.saveFailed'), t('error.generic'), {
      surface: DRAG_SURFACE,
      context: { action: 'undo', stage: 'failed', activity_id: recipe.id },
    });
    console.error(
      '[calendar-drag] undo did not apply: the record may have been deleted on another device, or the write failed and was already reported; look for a preceding store-write error'
    );
    return;
  }

  // `deleteActivity` already toasts its own failure; only the event is added here.
  const removed = await activityStore.resetOccurrenceToSeries(recipe.childId);
  logUndo(removed ? 'removed-override' : 'failed', recipe.childId);
}
