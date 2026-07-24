/**
 * Helpful Hints (#40) — the pure rule engine.
 *
 * Given a plain snapshot of family data + the reactive "today", produce the set
 * of hint to-dos that SHOULD currently exist, and diff it against the hints that
 * DO exist. Fully pure + side-effect-free (no Vue, no stores, no `Date.now()`):
 * `today` and the i18n/format functions are injected, so it is exhaustively
 * unit-testable. It MUST NEVER throw — each record is processed in its own
 * try/catch and a malformed one is counted + skipped, never aborting the rest
 * (mirrors `deriveNotifications` / `buildTodoReminders`).
 *
 * A hint is delivered as a normal dated to-do: its `dueDate` is the NUDGE date
 * (so the #55 timed-to-do reminder path fires the notification at a useful lead
 * time — see docs/plans/2026-07-24-helpful-hints.md), while the real event date
 * lives in `hintEventDate` for expiry + display.
 */
import type { FamilyMember, HelpfulHintType, TodoItem } from '@/types/models';
import type { NotificationOccurrence } from '@/utils/notifications';
import { ACTIVITY_GROUP_MAP } from '@/constants/activityCategories';
import { isAdultMember } from '@/composables/useMemberInfo';
import { normalizeAssignees } from '@/utils/assignees';
import { daysBetween, extractDatePart, toDateInputValue } from '@/utils/date';

/** DEFAULT days before the event each hint type fires. Families can override
 *  per type in Settings (family-synced) — this is the fallback when unset. */
export const HINT_LEAD_DAYS: Record<HelpfulHintType, number> = {
  'birthday-present': 14,
  'birthday-party-gift': 2,
  'celebration-gift': 2,
  'anniversary-plan': 14,
  'trip-packing': 2,
  'trip-documents': 7,
};

/** Selectable lead-time options (days before the event) for the Settings picker. */
export const HINT_LEAD_OPTIONS = [1, 2, 3, 5, 7, 10, 14, 21, 30] as const;

/** Presentation + i18n metadata per hint type. One source of truth for "the list
 *  of hint types", shared by the engine, the row, and the Settings toggles. */
export const HINT_TYPE_META: Record<
  HelpfulHintType,
  { emoji: string; labelKey: string; titleKey: string; descKey: string }
> = {
  'birthday-present': {
    emoji: '🎁',
    labelKey: 'settings.helpfulHints.type.birthdayPresent',
    titleKey: 'todo.hint.title.birthdayPresent',
    descKey: 'settings.helpfulHints.desc.birthdayPresent',
  },
  'birthday-party-gift': {
    emoji: '🎉',
    labelKey: 'settings.helpfulHints.type.birthdayPartyGift',
    titleKey: 'todo.hint.title.birthdayPartyGift',
    descKey: 'settings.helpfulHints.desc.birthdayPartyGift',
  },
  'celebration-gift': {
    emoji: '🎊',
    labelKey: 'settings.helpfulHints.type.celebrationGift',
    titleKey: 'todo.hint.title.celebrationGift',
    descKey: 'settings.helpfulHints.desc.celebrationGift',
  },
  'anniversary-plan': {
    emoji: '💍',
    labelKey: 'settings.helpfulHints.type.anniversaryPlan',
    titleKey: 'todo.hint.title.anniversaryPlan',
    descKey: 'settings.helpfulHints.desc.anniversaryPlan',
  },
  'trip-packing': {
    emoji: '🧳',
    labelKey: 'settings.helpfulHints.type.tripPacking',
    titleKey: 'todo.hint.title.tripPacking',
    descKey: 'settings.helpfulHints.desc.tripPacking',
  },
  'trip-documents': {
    emoji: '🛂',
    labelKey: 'settings.helpfulHints.type.tripDocuments',
    titleKey: 'todo.hint.title.tripDocuments',
    descKey: 'settings.helpfulHints.desc.tripDocuments',
  },
};

/** All hint types, in a stable display order (Settings toggle order). */
export const HELPFUL_HINT_TYPES = Object.keys(HINT_TYPE_META) as HelpfulHintType[];

/** Injected translator: `(key, params?) => string`. The orchestrator adapts the
 *  app's `t()` + `fillTemplate` into this shape so the engine stays pure. */
export type HintTranslate = (key: string, params?: Record<string, string>) => string;
/** Injected date formatter: YYYY-MM-DD → a human, localized date string. */
export type HintFormatDate = (ymd: string) => string;

export interface HelpfulHintsInput {
  /** Reactive "today" as YYYY-MM-DD (from useToday) — never `new Date()`. */
  today: string;
  members: FamilyMember[];
  /** Activity occurrences bucketed by date — from `assembleOccurrencesByDate`. */
  occurrences: Record<string, NotificationOccurrence[]>;
  /** Upcoming vacations (vacationStore.upcomingVacations). */
  vacations: { id: string; name: string; startDate?: string; assigneeIds: string[] }[];
  /** Fully-resolved lead-days per type (family overrides merged over the
   *  defaults) — how many days before the event each hint fires. */
  leadDays: Record<HelpfulHintType, number>;
  translate: HintTranslate;
  formatDate: HintFormatDate;
}

/** A hint that should currently exist. The actual notification `dueDate` is
 *  computed by the orchestrator from `eventDate` + the current clock (so the
 *  reminder fires at the next 09:00 rather than a past instant) — the engine
 *  stays pure and time-of-day-agnostic. */
export interface DesiredHint {
  hintType: HelpfulHintType;
  hintKey: string;
  title: string;
  assigneeIds: string[];
  eventDate: string; // YYYY-MM-DD → TodoItem.hintEventDate
}

/** Why a candidate hint was NOT generated — a normal degradation, not an error.
 *  Tallied per reconcile so a "why no hint for X?" report is triageable. */
export type HintSkipReason =
  | 'no-audience'
  | 'retroactive'
  | 'out-of-window'
  | 'no-dob'
  | 'no-start-date'
  | 'no-attendees'
  | 'malformed-record';

/** The single predicate for "is this to-do an auto-generated hint?". */
export function isHint(todo: TodoItem): todo is TodoItem & { hintType: HelpfulHintType } {
  return !!todo.hintType;
}

/** The single producer of the dedup key. Opaque downstream — compared only for
 *  equality, never parsed. Locale-independent, so locale changes never churn. */
export function buildHintKey(
  hintType: HelpfulHintType,
  scopeId: string,
  eventDateISO: string
): string {
  return `${hintType}:${scopeId}:${eventDateISO}`;
}

/** The next annual occurrence (YYYY-MM-DD) of month/day on or after `today`.
 *  Uses the local-Date constructor for overflow correctness (e.g. Feb 29 in a
 *  non-leap year rolls to Mar 1, matching the app's date convention). */
function nextAnnualDate(today: string, month: number, day: number): string {
  const thisYear = Number(today.slice(0, 4));
  const at = (year: number) => toDateInputValue(new Date(year, month - 1, day));
  const candidate = at(thisYear);
  return candidate >= today ? candidate : at(thisYear + 1);
}

/** Callback used by the source functions to tally why a candidate was skipped. */
type SkipRecorder = (reason: HintSkipReason) => void;

/** Build a DesiredHint for an in-window event, or null if outside its window /
 *  no audience (recording the reason). `scopeId` = the stable per-source id. */
function buildDesired(
  input: HelpfulHintsInput,
  hintType: HelpfulHintType,
  scopeId: string,
  eventDate: string,
  name: string,
  assigneeIds: string[],
  skip: SkipRecorder
): DesiredHint | null {
  if (!assigneeIds.length) {
    skip('no-audience');
    return null;
  }
  if (eventDate < input.today) {
    skip('retroactive');
    return null;
  }
  const lead = input.leadDays[hintType];
  // eventDate >= today is guaranteed above, so daysBetween (absolute) is the
  // forward distance. Reuse the shared date helper rather than re-implement it.
  if (daysBetween(input.today, eventDate) > lead) {
    skip('out-of-window');
    return null;
  }
  const title = input.translate(HINT_TYPE_META[hintType].titleKey, {
    name,
    date: input.formatDate(eventDate),
  });
  return {
    hintType,
    hintKey: buildHintKey(hintType, scopeId, eventDate),
    title,
    assigneeIds,
    eventDate,
  };
}

/** Which hint type (if any) an activity category maps to. `birthday`/`anniversary`
 *  are handled specially before the generic Party-group fallback. */
function activityTypeFor(category: string): HelpfulHintType | null {
  if (category === 'birthday') return 'birthday-party-gift';
  if (category === 'anniversary') return 'anniversary-plan';
  if (ACTIVITY_GROUP_MAP[category] === 'Party') return 'celebration-gift';
  return null;
}

export interface ComputeResult {
  hints: DesiredHint[];
  /** Count of records skipped by a thrown error (data bug signal, not a normal
   *  degradation like "no date of birth"). */
  skipped: number;
  /** Per-reason tally of candidates that did NOT become a hint (normal
   *  degradations + malformed-record) — for "why no hint for X?" triage. */
  reasons: Partial<Record<HintSkipReason, number>>;
}

/** Trigger 1 — member birthday −14d → present/party (adults excl. the birthday
 *  person & pets). */
function birthdayHints(input: HelpfulHintsInput, skip: SkipRecorder): DesiredHint[] {
  const out: DesiredHint[] = [];
  const adults = input.members.filter((m) => isAdultMember(m) && !m.isPet);
  for (const member of input.members) {
    try {
      if (member.isPet) continue;
      if (!member.dateOfBirth) {
        skip('no-dob');
        continue;
      }
      const { month, day } = member.dateOfBirth;
      const eventDate = nextAnnualDate(input.today, month, day);
      const audience = adults.filter((a) => a.id !== member.id).map((a) => a.id);
      const hint = buildDesired(
        input,
        'birthday-present',
        member.id,
        eventDate,
        member.name,
        audience,
        skip
      );
      if (hint) out.push(hint);
    } catch {
      skip('malformed-record');
    }
  }
  return out;
}

/** Triggers 2–4 — Party-group activity occurrences → gift/plan hints (attendees). */
function activityHints(input: HelpfulHintsInput, skip: SkipRecorder): DesiredHint[] {
  const out: DesiredHint[] = [];
  for (const occ of Object.values(input.occurrences).flat()) {
    try {
      const { activity, date } = occ;
      const hintType = activityTypeFor(activity.category);
      if (!hintType) continue; // not a hint-worthy category — not a "skip"
      const audience = normalizeAssignees(activity);
      const hint = buildDesired(
        input,
        hintType,
        activity.id,
        extractDatePart(date),
        activity.title,
        audience,
        skip
      );
      if (hint) out.push(hint);
    } catch {
      skip('malformed-record');
    }
  }
  return out;
}

/** Triggers 5–6 — trip −2d packing / −7d documents (travellers). */
function tripHints(input: HelpfulHintsInput, skip: SkipRecorder): DesiredHint[] {
  const out: DesiredHint[] = [];
  for (const trip of input.vacations) {
    try {
      if (!trip.startDate) {
        skip('no-start-date');
        continue;
      }
      if (!trip.assigneeIds.length) {
        skip('no-attendees');
        continue;
      }
      const eventDate = extractDatePart(trip.startDate);
      for (const hintType of ['trip-packing', 'trip-documents'] as const) {
        const hint = buildDesired(
          input,
          hintType,
          trip.id,
          eventDate,
          trip.name,
          trip.assigneeIds,
          skip
        );
        if (hint) out.push(hint);
      }
    } catch {
      skip('malformed-record');
    }
  }
  return out;
}

/** The full desired set + skip diagnostics (error count + per-reason tally). */
export function computeDesiredHints(input: HelpfulHintsInput): ComputeResult {
  const reasons: Partial<Record<HintSkipReason, number>> = {};
  const skip: SkipRecorder = (reason) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };
  const hints = [
    ...birthdayHints(input, skip),
    ...activityHints(input, skip),
    ...tripHints(input, skip),
  ];
  return { hints, skipped: reasons['malformed-record'] ?? 0, reasons };
}

/** Diff desired hints against the family's existing hint to-dos.
 *
 *  `existing` must be ALL hint to-dos — including COMPLETED ones — so a completed
 *  hint's `hintKey` blocks regeneration (completing a hint = keeping it).
 *
 *  - toCreate: desired hints with no existing hint of the same `hintKey`.
 *  - toRemove (only ever UN-acknowledged, UN-completed hints — the family's own
 *    kept/completed hints are never auto-removed):
 *    - cross-device DUPLICATE copies (same `hintKey`, different id): keep one
 *      primary (an acknowledged/completed copy if any, else the earliest-created)
 *      and remove the safe extras — otherwise buildTodoReminders double-notifies.
 *    - EXPIRED: the event has passed (`hintEventDate < today`).
 *    - STALE: no longer desired (source deleted / moved out of window). */
export function reconcileHints(
  desired: DesiredHint[],
  existing: TodoItem[],
  today: string
): { toCreate: DesiredHint[]; toRemove: TodoItem[] } {
  const desiredKeys = new Set(desired.map((d) => d.hintKey));
  const existingKeys = new Set(existing.map((t) => t.hintKey).filter(Boolean));
  const toCreate = desired.filter((d) => !existingKeys.has(d.hintKey));

  const removable = (t: TodoItem) => !t.hintAcknowledged && !t.completed;

  // Per key, choose the ONE copy to keep (prefer an acknowledged/completed copy,
  // else the earliest-created) so duplicates from a CRDT merge collapse to one.
  const byKey = new Map<string, TodoItem[]>();
  for (const t of existing) {
    if (!t.hintKey) continue;
    const arr = byKey.get(t.hintKey);
    if (arr) arr.push(t);
    else byKey.set(t.hintKey, [t]);
  }
  const winnerByKey = new Map<string, TodoItem>();
  for (const [key, items] of byKey) {
    winnerByKey.set(
      key,
      items.find((t) => t.hintAcknowledged || t.completed) ??
        [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!
    );
  }

  const toRemove = existing.filter((t) => {
    if (!removable(t)) return false;
    if (t.hintKey && winnerByKey.get(t.hintKey) !== t) return true; // duplicate copy
    if (t.hintEventDate && t.hintEventDate < today) return true; // expired
    if (!t.hintKey || !desiredKeys.has(t.hintKey)) return true; // stale
    return false;
  });
  return { toCreate, toRemove };
}

/** Collapse hints sharing a `hintKey` (two devices generated the same one before
 *  syncing) to the earliest-created — the CRDT-merge collision resolver, mirroring
 *  the recurring-transaction dedup. */
export function dedupeHintsByKey(hints: TodoItem[]): TodoItem[] {
  const byKey = new Map<string, TodoItem>();
  const out: TodoItem[] = [];
  for (const h of hints) {
    if (!h.hintKey) {
      out.push(h);
      continue;
    }
    const existing = byKey.get(h.hintKey);
    if (!existing) {
      byKey.set(h.hintKey, h);
      out.push(h);
    } else if (h.createdAt < existing.createdAt) {
      // Replace the later duplicate with the earlier one, in place.
      byKey.set(h.hintKey, h);
      out[out.indexOf(existing)] = h;
    }
  }
  return out;
}
