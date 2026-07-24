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
import { addDaysYmd, extractDatePart, toDateInputValue } from '@/utils/date';

/** Days before the event each hint type fires. The one piece that is pure data. */
export const HINT_LEAD_DAYS: Record<HelpfulHintType, number> = {
  'birthday-present': 14,
  'birthday-party-gift': 2,
  'celebration-gift': 2,
  'anniversary-plan': 14,
  'trip-packing': 2,
  'trip-documents': 7,
};

/** Presentation + i18n metadata per hint type. One source of truth for "the list
 *  of hint types", shared by the engine, the row, and the Settings toggles. */
export const HINT_TYPE_META: Record<
  HelpfulHintType,
  { emoji: string; labelKey: string; titleKey: string }
> = {
  'birthday-present': {
    emoji: '🎁',
    labelKey: 'settings.helpfulHints.type.birthdayPresent',
    titleKey: 'todo.hint.title.birthdayPresent',
  },
  'birthday-party-gift': {
    emoji: '🎁',
    labelKey: 'settings.helpfulHints.type.birthdayPartyGift',
    titleKey: 'todo.hint.title.birthdayPartyGift',
  },
  'celebration-gift': {
    emoji: '🎉',
    labelKey: 'settings.helpfulHints.type.celebrationGift',
    titleKey: 'todo.hint.title.celebrationGift',
  },
  'anniversary-plan': {
    emoji: '💍',
    labelKey: 'settings.helpfulHints.type.anniversaryPlan',
    titleKey: 'todo.hint.title.anniversaryPlan',
  },
  'trip-packing': {
    emoji: '🧳',
    labelKey: 'settings.helpfulHints.type.tripPacking',
    titleKey: 'todo.hint.title.tripPacking',
  },
  'trip-documents': {
    emoji: '🛂',
    labelKey: 'settings.helpfulHints.type.tripDocuments',
    titleKey: 'todo.hint.title.tripDocuments',
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
  translate: HintTranslate;
  formatDate: HintFormatDate;
}

/** A hint that should currently exist. */
export interface DesiredHint {
  hintType: HelpfulHintType;
  hintKey: string;
  title: string;
  assigneeIds: string[];
  nudgeDate: string; // YYYY-MM-DD → TodoItem.dueDate
  eventDate: string; // YYYY-MM-DD → TodoItem.hintEventDate
}

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

/** Larger of two YYYY-MM-DD strings (lexicographic == chronological). */
function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
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

/** Build a DesiredHint for an in-window event, or null if outside its window /
 *  no audience. `scopeId` = the stable per-source id (member/activity/vacation). */
function buildDesired(
  input: HelpfulHintsInput,
  hintType: HelpfulHintType,
  scopeId: string,
  eventDate: string,
  name: string,
  assigneeIds: string[]
): DesiredHint | null {
  if (!assigneeIds.length) return null; // no audience → no hint
  if (eventDate < input.today) return null; // never retroactive
  const lead = HINT_LEAD_DAYS[hintType];
  // Absolute day distance is safe: eventDate >= today is guaranteed above.
  const daysUntil = daysApart(input.today, eventDate);
  if (daysUntil > lead) return null; // not yet inside the lead window
  // Nudge date = event − lead, clamped forward to today (we're already inside
  // the window, so this is effectively "today"): fires the notification promptly.
  const nudgeDate = maxYmd(addDaysYmd(eventDate, -lead), input.today);
  const title = input.translate(HINT_TYPE_META[hintType].titleKey, {
    name,
    date: input.formatDate(eventDate),
  });
  return {
    hintType,
    hintKey: buildHintKey(hintType, scopeId, eventDate),
    title,
    assigneeIds,
    nudgeDate,
    eventDate,
  };
}

/** Whole-day distance between two YYYY-MM-DD strings (non-negative). */
function daysApart(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.abs(Math.round(ms / 86_400_000));
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
}

/** Trigger 1 — member birthday −14d → present/party (adults excl. the birthday
 *  person & pets). */
function birthdayHints(input: HelpfulHintsInput, onError: () => void): DesiredHint[] {
  const out: DesiredHint[] = [];
  const adults = input.members.filter((m) => isAdultMember(m) && !m.isPet);
  for (const member of input.members) {
    try {
      if (member.isPet || !member.dateOfBirth) continue;
      const { month, day } = member.dateOfBirth;
      const eventDate = nextAnnualDate(input.today, month, day);
      const audience = adults.filter((a) => a.id !== member.id).map((a) => a.id);
      const hint = buildDesired(
        input,
        'birthday-present',
        member.id,
        eventDate,
        member.name,
        audience
      );
      if (hint) out.push(hint);
    } catch {
      onError();
    }
  }
  return out;
}

/** Triggers 2–4 — Party-group activity occurrences → gift/plan hints (attendees). */
function activityHints(input: HelpfulHintsInput, onError: () => void): DesiredHint[] {
  const out: DesiredHint[] = [];
  for (const occ of Object.values(input.occurrences).flat()) {
    try {
      const { activity, date } = occ;
      const hintType = activityTypeFor(activity.category);
      if (!hintType) continue;
      const audience = normalizeAssignees(activity);
      const hint = buildDesired(
        input,
        hintType,
        activity.id,
        extractDatePart(date),
        activity.title,
        audience
      );
      if (hint) out.push(hint);
    } catch {
      onError();
    }
  }
  return out;
}

/** Triggers 5–6 — trip −2d packing / −7d documents (travellers). */
function tripHints(input: HelpfulHintsInput, onError: () => void): DesiredHint[] {
  const out: DesiredHint[] = [];
  for (const trip of input.vacations) {
    try {
      if (!trip.startDate || !trip.assigneeIds.length) continue;
      const eventDate = extractDatePart(trip.startDate);
      for (const hintType of ['trip-packing', 'trip-documents'] as const) {
        const hint = buildDesired(input, hintType, trip.id, eventDate, trip.name, trip.assigneeIds);
        if (hint) out.push(hint);
      }
    } catch {
      onError();
    }
  }
  return out;
}

/** The full desired set + a count of records that threw (a data-bug signal). */
export function computeDesiredHints(input: HelpfulHintsInput): ComputeResult {
  let skipped = 0;
  const onError = () => {
    skipped += 1;
  };
  const hints = [
    ...birthdayHints(input, onError),
    ...activityHints(input, onError),
    ...tripHints(input, onError),
  ];
  return { hints, skipped };
}

/** Diff desired hints against existing hint to-dos.
 *  - toCreate: desired hints with no existing hint of the same `hintKey`.
 *  - toRemove: existing UN-acknowledged, UN-completed hints that have expired
 *    (event passed) OR are no longer desired (source deleted / moved out of
 *    window). Acknowledged or completed hints are the family's own to-dos and
 *    are never auto-removed. */
export function reconcileHints(
  desired: DesiredHint[],
  existing: TodoItem[],
  today: string
): { toCreate: DesiredHint[]; toRemove: TodoItem[] } {
  const desiredKeys = new Set(desired.map((d) => d.hintKey));
  const existingKeys = new Set(existing.map((t) => t.hintKey).filter(Boolean));
  const toCreate = desired.filter((d) => !existingKeys.has(d.hintKey));
  const toRemove = existing.filter((t) => {
    if (t.hintAcknowledged || t.completed) return false;
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
