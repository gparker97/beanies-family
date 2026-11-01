/**
 * Occasion mode for the activity drawer (#137): everything `ActivityModal` does differently
 * when the category is in the Occasions group (a birthday, anniversary or day to remember for
 * someone outside the pod). Kept out of the modal, which is already large, the same way
 * `useTransferForm` keeps the transfer-only state out of `TransactionModal`.
 *
 * What it owns:
 *  - the create-drawer defaults an occasion implies (yearly, all-day, a reminder, the creator
 *    remembering), applied at most once per drawer session and only over fresh-form values;
 *  - the "set for Occasions" notes, shown while a field still holds the value the default
 *    wrote (a value comparison, no watchers, so the defaults' own writes cannot clear them);
 *  - the title matcher ("Uncle Bob's birthday" files itself under Occasions on commit);
 *  - the optional year: its validity, its live preview and the "big one" note;
 *  - moving a past-year anchor date (7 Nov 1966) into the year field, so a yearly series
 *    never expands sixty years of occurrences;
 *  - the `occasions` telemetry surface.
 *
 * The modal keeps only template bindings and its two validation rule spreads. `reset()` must
 * be called from BOTH `onNew` and `onEdit`: the drawer is never unmounted, so state from a
 * create session would otherwise leak into the next edit.
 */
import { computed, nextTick, ref, watch, type Ref } from 'vue';
import type { ActivityCategory, ReminderMinutes } from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { cadenceToRule, ruleKey } from '@/services/recurrence/cadence';
import { firstDueOnOrAfter } from '@/services/recurrence/recurrenceEngine';
import { logEvent } from '@/services/telemetry/logEvent';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { DEFAULT_ACTIVITY_LEAD, toActivityLeadOption } from '@/utils/reminderSchedule';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateWithDay, localToday } from '@/utils/date';
import { nextOccasionAnchor } from '@/utils/occasionAnchor';
import {
  OCCASION_TYPES,
  isOccasionCategory,
  matchOccasionCategory,
  occasionCount,
  occasionMilestone,
  validateOccasionYear,
  yearOf,
  type OccasionYearIssue,
} from '@/utils/occasions';

const SURFACE = 'occasions';

/** The drawer fields an occasion default can write, each with its own note and pulse. */
export type OccasionAutoField = 'schedule' | 'allDay' | 'reminder' | 'people';

/** How the drawer entered occasion mode: a picker tap, or the title matcher. */
export type OccasionDefaultsAction = 'category-pick' | 'title-match';

const YEAR_ERROR_KEYS: Record<Exclude<OccasionYearIssue, 'ok'>, UIStringKey> = {
  future: 'planner.occasion.yearError.future',
  'too-early': 'planner.occasion.yearError.tooEarly',
  format: 'planner.occasion.yearError.format',
};

export interface OccasionFormOptions {
  category: Ref<ActivityCategory>;
  title: Ref<string>;
  date: Ref<string>;
  mode: Ref<'one-off' | 'recurring'>;
  rule: Ref<RecurrenceRule | null>;
  isAllDay: Ref<boolean>;
  reminderMinutes: Ref<ReminderMinutes>;
  assigneeIds: Ref<string[]>;
  /** The optional year. Empty, `0` and `''` all read as "no year". */
  occasionYear: Ref<number | undefined>;
  /** The modal's "both date refs are seeded" flag; nothing normalises before it is set. */
  seriesAnchorReady: Ref<boolean>;
  /** True while the drawer creates a new activity (never for an edit). */
  isCreate: () => boolean;
  /** The member creating the activity, the default rememberer. */
  authorId: () => string | undefined;
  /** The element of each auto-set field group, for its one-shot pulse. */
  fieldEl: (field: OccasionAutoField) => HTMLElement | null | undefined;
  /** Today as `YYYY-MM-DD`. Injected for tests; defaults to the device's local date. */
  today?: () => string;
}

/** An empty year field: never typed, cleared (`''` from `v-model.number`), or zero. */
function isEmptyYear(year: unknown): boolean {
  return year === undefined || year === null || year === '' || year === 0;
}

export function useOccasionForm(opts: OccasionFormOptions) {
  const settingsStore = useSettingsStore();
  const { t } = useTranslation();
  const { reveal } = useAttentionPulse();
  const today = opts.today ?? localToday;
  const {
    category,
    title,
    date,
    mode,
    rule,
    isAllDay,
    reminderMinutes,
    assigneeIds,
    occasionYear,
    seriesAnchorReady,
  } = opts;

  const occasionMode = computed(() => isOccasionCategory(category.value));

  // ── Defaults ──────────────────────────────────────────────────────────────────────────

  let defaultsApplied = false;
  /** The date `onNew` opened the form on: a past-year calendar click is not a birth year. */
  let seededDate: string | undefined;
  /** The comparable value each default wrote, by field. Cleared by `reset()`. */
  const autoSet = ref(new Map<OccasionAutoField, string>());

  /** A field's current value in the same comparable form `autoSet` stores. */
  function currentValue(field: OccasionAutoField): string {
    switch (field) {
      case 'schedule':
        return mode.value === 'recurring' && rule.value ? ruleKey(rule.value) : '';
      case 'allDay':
        return String(isAllDay.value);
      case 'reminder':
        return String(reminderMinutes.value);
      case 'people':
        return assigneeIds.value.join(',');
    }
  }

  async function applyOccasionDefaults(action: OccasionDefaultsAction): Promise<void> {
    if (defaultsApplied) return;
    defaultsApplied = true;
    const written: OccasionAutoField[] = [];
    const record = (field: OccasionAutoField) => {
      autoSet.value.set(field, currentValue(field));
      written.push(field);
    };

    // Rule FIRST, then mode, in the same tick: `RecurrencePicker` mounts with a rule and does
    // not publish its weekly default over it.
    if (mode.value === 'one-off' && rule.value === null) {
      rule.value = cadenceToRule({ unit: 'year', interval: 1 });
      mode.value = 'recurring';
      record('schedule');
    }
    if (!isAllDay.value) {
      isAllDay.value = true;
      record('allDay');
    }
    // `0` is the chip's "None". A family lead of 0 would leave the occasion with no reminder
    // at all, so the app default stands in for it.
    if (reminderMinutes.value === 0) {
      reminderMinutes.value =
        settingsStore.activityReminderLead || toActivityLeadOption(DEFAULT_ACTIVITY_LEAD);
      record('reminder');
    }
    if (assigneeIds.value.length === 0) {
      const author = opts.authorId();
      if (author) {
        assigneeIds.value = [author];
        record('people');
      } else {
        // Left empty, which the hint engine reads as "all adults": correct, but worth knowing.
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'no author for default rememberer',
          context: { kind: category.value, action },
        });
      }
    }

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'defaults applied',
      context: { kind: category.value, action, count: written.length },
    });

    // After the tick: the schedule group only mounts once `mode` is recurring. `written` is in
    // drawer order, so the scroll lands on the schedule when it was set; the halo pulse sits
    // outside each group so it never overdraws the controls.
    if (written.length === 0) return;
    await nextTick();
    reveal(written.map(opts.fieldEl), 'attention-halo');
  }

  /**
   * The picker's (and the title matcher's) way in. Defaults hang off this user-intent path,
   * never off a watch on `category`, which also fires when an edit populates the form.
   */
  function onCategoryPicked(
    id: string,
    action: OccasionDefaultsAction = 'category-pick'
  ): Promise<void> {
    category.value = id as ActivityCategory;
    if (opts.isCreate() && isOccasionCategory(id)) return applyOccasionDefaults(action);
    return Promise.resolve();
  }

  /**
   * The title input's `change` (blur or Enter), never `input`: typed letter by letter,
   * "Birthday party" would match at "Birthday" before "party" exists. Only in a new form with
   * no category yet, so it never overrides a pick and never runs on an edit.
   */
  function onTitleCommit(): Promise<void> {
    if (!opts.isCreate() || category.value) return Promise.resolve();
    const match = matchOccasionCategory(title.value);
    return match ? onCategoryPicked(match, 'title-match') : Promise.resolve();
  }

  /** "Set for Occasions" while the field still holds what the default wrote. */
  function autoSetHint(field: OccasionAutoField): string | undefined {
    if (!occasionMode.value) return undefined;
    const stored = autoSet.value.get(field);
    return stored !== undefined && stored === currentValue(field)
      ? t('planner.occasion.setFor')
      : undefined;
  }

  // ── Year ──────────────────────────────────────────────────────────────────────────────

  /** The one validity source: the save rule, the error text and the payload all read it. */
  const yearIssue = computed<OccasionYearIssue>(() =>
    validateOccasionYear(occasionYear.value, today())
  );

  const yearLabel = computed(() =>
    isOccasionCategory(category.value) ? t(OCCASION_TYPES[category.value].yearLabelKey) : ''
  );

  const yearErrorMessage = computed(() => {
    const issue = yearIssue.value;
    return issue === 'ok' ? undefined : t(YEAR_ERROR_KEYS[issue]);
  });

  /**
   * Show the reason as soon as a whole year has been typed (four digits or more), without
   * waiting for Save, so "2030" is flagged at once; "19" mid-typing is not. Save marks it
   * either way, through the validation rule.
   */
  const yearErrorNow = computed(() => {
    const year = occasionYear.value;
    return typeof year === 'number' && year >= 1000 && yearIssue.value !== 'ok';
  });

  /** The year the payload may carry: a valid one in occasion mode, otherwise none. */
  const payloadYear = computed(() =>
    occasionMode.value && !isEmptyYear(occasionYear.value) && yearIssue.value === 'ok'
      ? occasionYear.value
      : undefined
  );

  /** The occurrence the preview describes: the series' next one, or the one-off's date. */
  const previewDate = computed(() => {
    if (!date.value) return '';
    if (mode.value !== 'recurring' || !rule.value) return date.value;
    return firstDueOnOrAfter(rule.value, date.value, today()) ?? date.value;
  });

  const previewFields = computed(() => ({
    category: category.value,
    occasionYear: payloadYear.value,
  }));

  /** "turns 60 on Sat, 7 Nov", or nothing when there is no valid year or no count. */
  const yearPreview = computed(() => {
    if (!previewDate.value) return undefined;
    const milestone = occasionMilestone(previewFields.value, previewDate.value, t);
    if (!milestone) return undefined;
    return fillTemplate(t('planner.occasion.yearPreview'), {
      milestone,
      date: formatDateWithDay(previewDate.value),
    });
  });

  /** A round number (60th birthday, 25th anniversary), which also gets a month's notice. */
  const isBigOne = computed(() => {
    if (!previewDate.value || !isOccasionCategory(category.value)) return false;
    const n = occasionCount(previewFields.value, previewDate.value);
    return n !== undefined && OCCASION_TYPES[category.value].isRound(n);
  });

  /** The big-one note, naming the family's own lead for that hint (Settings can change it). */
  const bigOneNote = computed(() => {
    // No promise of a nudge the family has switched off.
    if (!isBigOne.value || !settingsStore.helpfulHintsEnabled) return undefined;
    const days = settingsStore.helpfulHintLeadDays['occasion-milestone'];
    return days === 1
      ? t('planner.occasion.bigOne.one')
      : fillTemplate(t('planner.occasion.bigOne.other'), { days });
  });

  // ── Past-year anchor date ─────────────────────────────────────────────────────────────

  const dateMoved = ref<{ anchor: string; year?: number } | null>(null);
  /** The anchor this watcher last wrote, so its own write is not mistaken for a pick. */
  let lastWrittenAnchor: string | undefined;
  /** The year this drawer moved in from a date, so a second past-year pick can replace it. */
  let autoMovedYear: number | undefined;

  /**
   * Picking 7 Nov 1966 for a yearly occasion moves 1966 into the year field and the date to
   * the next occurrence. Its own watcher, deliberately not folded into the modal's
   * anchor-delta watcher: writing `date` here re-enters that one, which shifts the series
   * anchor by the same delta (unchanged behaviour). Both orders work, date then category or
   * category then date, because category (via `occasionMode`) and the schedule are sources.
   * One-off occasions are left alone.
   */
  watch([date, occasionMode, mode, () => rule.value?.unit], () => {
    if (!opts.isCreate() || !seriesAnchorReady.value || !occasionMode.value) return;
    if (mode.value !== 'recurring' || rule.value?.unit !== 'year') return;
    const picked = date.value;
    const now = today();
    if (!(yearOf(picked) < yearOf(now))) return;

    const next = nextOccasionAnchor(picked, now);
    if (!next) {
      // Impossible for a never-ending yearly rule; the date is left as picked.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'next occurrence unresolved',
        context: { kind: category.value },
      });
      return;
    }
    // Our own write re-enters this watcher; only a date the person picked is handled. (A pick
    // that IS already the anchor, e.g. 29 Feb of the latest leap year, still moves its year.)
    if (picked === lastWrittenAnchor) return;

    const yearIsOurs = isEmptyYear(occasionYear.value) || occasionYear.value === autoMovedYear;
    const moveYear = yearIsOurs && picked !== seededDate;
    if (moveYear) {
      occasionYear.value = next.year;
      autoMovedYear = next.year;
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'year moved from date',
        context: { kind: category.value },
      });
    }
    if (next.anchor === picked && !moveYear) return; // nothing to move
    dateMoved.value = { anchor: next.anchor, year: moveYear ? next.year : undefined };
    lastWrittenAnchor = next.anchor;
    if (next.anchor !== picked) date.value = next.anchor;
  });

  /** Says what moved, while the date is still the one this moved it to. */
  const dateMovedCaption = computed(() => {
    const moved = dateMoved.value;
    if (!moved || date.value !== moved.anchor || !occasionMode.value) return undefined;
    // Never names a date: the picker shows the series anchor, which for 29 February is a past
    // leap year, and the recurrence summary already says when it repeats.
    return moved.year !== undefined
      ? fillTemplate(t('planner.occasion.dateMoved.withYear'), { year: moved.year })
      : t('planner.occasion.dateMoved.dateOnly');
  });

  /** Called from BOTH `onNew` (with the date the form opened on) and `onEdit`. */
  function reset(openedOnDate?: string): void {
    defaultsApplied = false;
    seededDate = openedOnDate;
    autoSet.value = new Map();
    dateMoved.value = null;
    autoMovedYear = undefined;
    lastWrittenAnchor = undefined;
  }

  return {
    occasionMode,
    onCategoryPicked,
    onTitleCommit,
    autoSetHint,
    yearIssue,
    yearLabel,
    yearErrorMessage,
    yearErrorNow,
    payloadYear,
    yearPreview,
    isBigOne,
    bigOneNote,
    dateMovedCaption,
    reset,
  };
}
