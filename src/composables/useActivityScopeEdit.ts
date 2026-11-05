import { ref } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { chooseScope, type RecurringEditScope } from '@/composables/useRecurringEditScope';
import {
  toDateInputValue,
  addDays,
  parseLocalDate,
  extractDatePart,
  addDaysYmd,
  daysBetweenYmd,
} from '@/utils/date';
import { shiftSpan } from '@/utils/calendar/activityDays';
import { lastOccurrenceOf } from '@/utils/activitySeriesEnd';
import { reportSessionActionFailed } from '@/utils/actionFailure';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';
import { logEvent } from '@/services/telemetry';
import { activityShadowFromRule, resolveActivityRule } from '@/services/recurrence/adapters';
import { retargetRuleForAnchor } from '@/services/recurrence/retargetRule';
import type { FamilyActivity, ISODateString, UpdateFamilyActivityInput } from '@/types/models';

/**
 * What a scoped save did, so a caller can tell a cancel from a failure and build on the
 * write (the calendar drag's Undo, #142).
 *
 * - `saved`: `writtenId` is the record the branch wrote (the template for 'all', the
 *   override child for 'this-only', the new split template for 'this-and-future');
 *   `reapedCount` is the override children the truncation reap deleted (0 when it did not
 *   run).
 * - `cancelled`: the scope prompt was dismissed; nothing was written.
 * - `refused`: the multi-weekday guard refused a series-scope date move (it toasted).
 * - `failed`: a write failed (already reported to the user).
 */
export type ScopedSaveOutcome =
  | { kind: 'saved'; scope: RecurringEditScope; writtenId: string; reapedCount: number }
  | { kind: 'cancelled' }
  | { kind: 'refused'; reason: 'multi-weekday' }
  | { kind: 'failed' };

/**
 * Shared composable for scope-aware activity view/edit.
 * Used by FamilyPlannerPage and FamilyNookPage to avoid duplicating
 * the recurring-scope logic in both pages.
 *
 * Scope modal is deferred to save time (not shown when opening the edit modal).
 * Delete still shows scope modal before deleting.
 */
export function useActivityScopeEdit() {
  const activityStore = useActivityStore();
  const { t } = useTranslationStore();

  const viewingActivity = ref<FamilyActivity | null>(null);
  const viewingOccurrenceDate = ref<string | undefined>();

  /**
   * The day the repeat drawn on `date` starts: the occurrence KEY every scope
   * edit, override, split and delete uses. `viewingOccurrenceDate` stays the day
   * that was clicked, because duty ticks are per day (a Sunday tick belongs to
   * Sunday even when the weekend repeat started on Friday).
   */
  function seriesDateOf(activity: FamilyActivity, date: string): string {
    return activityStore.repeatStartFor(activity, date);
  }

  function openViewModal(id: string, date?: string): boolean {
    const activity = activityStore.activities.find((a) => a.id === id);
    if (activity) {
      viewingActivity.value = activity;
      viewingOccurrenceDate.value = date;
      return true;
    }
    return false;
  }

  /**
   * Handle "Edit" from the view modal. Returns the activity to open in the
   * full edit modal, along with the occurrence date for context.
   * Scope is deferred to save time — no scope modal shown here.
   */
  function handleViewOpenEdit(activity: FamilyActivity): {
    activity: FamilyActivity;
    occurrenceDate?: string;
  } {
    const clicked = viewingOccurrenceDate.value;
    const occurrenceDate = clicked ? seriesDateOf(activity, clicked) : undefined;
    viewingActivity.value = null;
    return { activity, occurrenceDate };
  }

  /**
   * Delete override children stranded past a newly-truncated series end.
   *
   * The cut date must come from whichever representation actually carries the
   * end. Gating on `typeof changes.recurrenceEndDate === 'string'` alone was
   * correct only while "ends on a date" was the sole option: #70's picker also
   * offers "after N times", which lives ONLY in `rule.end` and writes NO
   * `recurrenceEndDate`. Setting a 20-session series to "after 5 times" left
   * the 15 override children past the cut rendering on the calendar and in the
   * Google push forever — the Recurring Invariant 7 breach this reap exists to
   * prevent. Switching onDate -> afterCount was worse: `recurrenceEndDate` is
   * present-but-`undefined`, so it was explicitly cleared too.
   */
  async function reapOrphansAfterTruncation(
    id: string,
    changes: UpdateFamilyActivityInput
  ): Promise<number> {
    let cutYmd: string | null = null;
    if (typeof changes.recurrenceEndDate === 'string') {
      cutYmd = changes.recurrenceEndDate;
    } else if (changes.rule) {
      const template = activityStore.activities.find((a) => a.id === id);
      const anchor = template ? extractDatePart(template.date) : null;
      // The last occurrence the truncated rule still owns; everything after it
      // is an orphan. `null` for a never-ending rule — nothing to reap.
      if (anchor) cutYmd = lastOccurrenceOf(changes.rule, anchor);
    }
    if (!cutYmd) return 0;
    return activityStore.deleteChildrenFrom(
      id,
      toDateInputValue(addDays(parseLocalDate(cutYmd), 1))
    );
  }

  /**
   * A date move at a SERIES scope with no rule in the patch (the calendar drag, #142: it has
   * no form, so nothing re-anchored the rule the way `RecurrencePicker` does for the edit
   * sheet) re-targets the record's rule onto the new anchor, so a weekly Wednesday series
   * moved to a Thursday repeats on Thursdays. The legacy shadow is rewritten with it
   * (minus `recurrenceEndDate`, which the move does not change): a stale `daysOfWeek` would
   * permanently refuse series-scope moves and poison the Google push hash.
   *
   * Empty when the patch already carries a rule (the form supplied its own), when the
   * anchor did not move, or when the re-targeted rule is unchanged (a daily series). A
   * record whose rule cannot be resolved is left alone and logged at `warn`.
   */
  function retargetedRulePatch(
    record: FamilyActivity,
    oldAnchor: string,
    newAnchor: string,
    changes: UpdateFamilyActivityInput,
    scope: RecurringEditScope
  ): UpdateFamilyActivityInput {
    if ('rule' in changes || oldAnchor === newAnchor) return {};
    const source = resolveActivityRule(record)?.rule;
    if (!source) {
      logEvent({
        surface: 'activity-scope-edit',
        level: 'warn',
        message: 'Could not resolve the rule of a moved series; its rule was not re-targeted',
        context: { action: 'rule-retarget-skipped', recur_scope: scope },
      });
      return {};
    }
    const rule = retargetRuleForAnchor(source, oldAnchor, newAnchor);
    if (JSON.stringify(rule) === JSON.stringify(source)) return {};
    const { recurrenceEndDate: _end, ...shadow } = activityShadowFromRule(rule);
    void _end;
    return { rule, ...shadow };
  }

  /**
   * How many weekdays a series repeats on, read from its RULE (the source of truth; a
   * rule-only record carries no `daysOfWeek` shadow), or from the legacy shadow when no rule
   * resolves. Only a weekly rule names weekdays; any other unit counts 0.
   */
  function seriesWeekdayCount(record: FamilyActivity): number {
    const rule = resolveActivityRule(record)?.rule;
    if (!rule) return record.daysOfWeek?.length ?? 0;
    return rule.unit === 'week' ? (rule.weekdays?.length ?? 0) : 0;
  }

  /**
   * Scope-aware save. Shows the scope modal when saving changes to a recurring
   * activity occurrence, and says what happened (see `ScopedSaveOutcome`).
   * `opts.source` names the calling path for the store's `span_rebased` event
   * (defaults: 'scope-all' / 'scope-this-and-future').
   */
  async function handleScopedSave(
    templateId: string,
    occurrenceDate: string,
    changes: UpdateFamilyActivityInput,
    opts: { source?: string } = {}
  ): Promise<ScopedSaveOutcome> {
    const scope = await chooseScope();
    if (!scope) return { kind: 'cancelled' };

    const template = activityStore.activities.find((a) => a.id === templateId);
    // `changes` is a minimal diff, so `date` is present ONLY if the user
    // actually edited the date field.
    const movedTo = changes.date && changes.date !== occurrenceDate ? changes.date : null;

    // A date edit at a SERIES scope means "shift the schedule by this much" —
    // which is only expressible when the series has a single weekday. On a
    // multi-weekday series (Mon+Wed) "move this Wednesday to Thursday, for all"
    // is ambiguous, and the form's `daysOfWeek` watcher deliberately leaves the
    // chips alone in that case. Shifting the start date anyway would discard the
    // move AND push the first occurrence before the new start, dropping it from
    // the calendar. Refuse with guidance instead of corrupting the series.
    if (movedTo && scope !== 'this-only' && template && seriesWeekdayCount(template) > 1) {
      showToast(
        'error',
        t('planner.multiDayMoveBlocked.title'),
        t('planner.multiDayMoveBlocked.message'),
        {
          surface: 'activity-scope-edit',
          context: { action: 'multi-weekday-move-refused', recur_scope: scope },
        }
      );
      return { kind: 'refused', reason: 'multi-weekday' };
    }

    /** The moved occurrence's day-shift, applied to a series anchor date. */
    function shiftAnchor(anchor: ISODateString): ISODateString {
      return addDaysYmd(anchor, daysBetweenYmd(occurrenceDate, movedTo!));
    }

    /**
     * A "Lasts" edit arrives as an `endDate` relative to the FORM's date (the
     * occurrence, or where it was moved to). Re-express it on `targetDate`, the
     * start of the record the patch is actually written to.
     */
    function lastsOnto(targetDate: string): Pick<UpdateFamilyActivityInput, 'endDate'> {
      if (!('endDate' in changes)) return {};
      const formDate = movedTo ?? occurrenceDate;
      return {
        endDate: shiftSpan({ date: formDate, endDate: changes.endDate }, targetDate),
      };
    }

    let writtenId: string;
    let reapedCount = 0;
    if (scope === 'all') {
      // Apply the DELTA to the template's start rather than assigning the
      // occurrence date to it (which would drag the series start forward to
      // this one occurrence). Single-weekday only, per the guard above, so the
      // shifted start keeps the same weekday as the moved occurrence and stays
      // consistent with the form's watcher-updated `daysOfWeek`.
      const patch = { ...changes };
      // #70: `if (movedTo && template)` silently DROPPED the user's date move
      // when the template lookup above missed — and the save then reported
      // success. Fail loudly instead. Scoped to `all` deliberately: the
      // `this-only` and `this-and-future` branches never dereference `template`,
      // so a blanket guard here would break two working paths.
      if (movedTo && !template) {
        showToast(
          'error',
          t('planner.scopeEditFailed.title'),
          t('planner.scopeEditFailed.message'),
          {
            surface: 'activity-scope-edit',
            context: { action: 'template-missing', recur_scope: scope },
          }
        );
        return { kind: 'failed' };
      }
      if (movedTo && template) {
        patch.date = shiftAnchor(template.date);
        Object.assign(
          patch,
          retargetedRulePatch(template, template.date, patch.date, changes, scope)
        );
      }
      const targetDate = patch.date ?? template?.date;
      const withLasts = targetDate ? { ...patch, ...lastsOnto(targetDate) } : patch;
      // A move carries the series' span along (`updateActivity` owns that rule).
      if (
        !(await activityStore.updateActivity(templateId, withLasts, {
          source: opts.source ?? 'scope-all',
        }))
      ) {
        reportSessionActionFailed();
        return { kind: 'failed' };
      }
      writtenId = templateId;
      // An "ends" edit (or a re-targeted rule with an end) truncates the series in
      // place: same orphan risk as the delete path, same reap, against the PATCHED
      // rule so it cuts at the new anchor's last occurrence.
      reapedCount = await reapOrphansAfterTruncation(templateId, withLasts);
    } else if (scope === 'this-only') {
      // An untouched date is simply ABSENT from the diff, so `materializeOverride`
      // resolves it to `occurrenceDate` — the occurrence stays where the user
      // clicked. A present date is a deliberate reschedule.
      const child = await activityStore.materializeOverride(templateId, occurrenceDate, changes);
      if (!child) {
        reportSessionActionFailed();
        return { kind: 'failed' };
      }
      writtenId = child.id;
    } else {
      const newTemplate = await activityStore.splitActivity(templateId, occurrenceDate);
      if (!newTemplate) {
        reportSessionActionFailed();
        return { kind: 'failed' };
      }
      // `splitActivity` anchors the new template at `occurrenceDate`, so the
      // form's raw `date` must not overwrite it (Recurring Invariant 3) — but a
      // deliberate MOVE must still apply, shifted the same way scope 'all'
      // shifts the template. Dropping `date` outright discarded the move
      // silently, and for a same-weekday move or any non-weekly recurrence the
      // remaining patch was empty, so the reschedule vanished without a trace.
      //
      // `recurrenceEndDate` is likewise no longer blanket-stripped: the diff
      // only carries it when the user deliberately edited the "ends on" field.
      const { date: _d, ...rest } = changes as Record<string, unknown>;
      void _d;
      const moved = movedTo ? { date: shiftAnchor(newTemplate.date) } : {};
      const safeChanges = {
        ...rest,
        ...moved,
        ...(moved.date
          ? retargetedRulePatch(newTemplate, newTemplate.date, moved.date, changes, scope)
          : {}),
        ...lastsOnto(moved.date ?? newTemplate.date),
      } as UpdateFamilyActivityInput;
      if (
        Object.keys(safeChanges).length > 0 &&
        !(await activityStore.updateActivity(newTemplate.id, safeChanges, {
          source: opts.source ?? 'scope-this-and-future',
        }))
      ) {
        reportSessionActionFailed();
        return { kind: 'failed' };
      }
      writtenId = newTemplate.id;
      // Truncating a series via an "ends on" edit strands the children past the
      // cut exactly as the delete path does (Recurring Invariant 7).
      reapedCount = await reapOrphansAfterTruncation(newTemplate.id, safeChanges);
    }
    logEvent({
      surface: 'activity-scope-edit',
      level: 'info',
      message: 'Applied a scoped edit to a recurring activity',
      context: {
        action: 'scoped-save',
        recur_scope: scope,
        recur_occurrence_ymd: occurrenceDate,
        recur_rescheduled: 'date' in changes,
      },
    });
    return { kind: 'saved', scope, writtenId, reapedCount };
  }

  return {
    viewingActivity,
    viewingOccurrenceDate,
    openViewModal,
    handleViewOpenEdit,
    handleScopedSave,
  };
}
