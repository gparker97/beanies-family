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
import { isContinuationDay } from '@/utils/calendar/occurrence';
import type { FamilyMember, HelpfulHintType, TodoItem } from '@/types/models';
import type { NotificationOccurrence } from '@/utils/notifications';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { ACTIVITY_GROUP_MAP } from '@/constants/activityCategories';
import { isAdultMember } from '@/composables/useMemberInfo';
import { normalizeAssignees } from '@/utils/assignees';
import { daysBetween, extractDatePart } from '@/utils/date';
import {
  activityDisplayTitle,
  isOccasionCategory,
  occasionCount,
  OCCASION_TYPES,
  type OccasionCategory,
} from '@/utils/occasions';
import { containsPhrase } from '@/utils/textSimilarity';
// The ONE annual-date implementation. This file used to carry its own copy.
import { nextAnnualDate } from '@/utils/birthdays';

/** DEFAULT days before the event each hint type fires. Families can override
 *  per type in Settings (family-synced) — this is the fallback when unset. */
export const HINT_LEAD_DAYS: Record<HelpfulHintType, number> = {
  'birthday-present': 14,
  'birthday-party-gift': 2,
  'celebration-gift': 2,
  'anniversary-plan': 14,
  'trip-packing': 2,
  'trip-documents': 7,
  'occasion-heads-up': 7,
  'occasion-milestone': 30,
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
  'occasion-heads-up': {
    emoji: '💌',
    labelKey: 'settings.helpfulHints.type.occasionHeadsUp',
    titleKey: 'todo.hint.title.occasionHeadsUp',
    descKey: 'settings.helpfulHints.desc.occasionHeadsUp',
  },
  'occasion-milestone': {
    emoji: '🎉',
    labelKey: 'settings.helpfulHints.type.occasionMilestone',
    titleKey: 'todo.hint.title.occasionMilestone',
    descKey: 'settings.helpfulHints.desc.occasionMilestone',
  },
};

/** All hint types, in a stable display order (Settings toggle order). */
export const HELPFUL_HINT_TYPES = Object.keys(HINT_TYPE_META) as HelpfulHintType[];

/** Shown for a hint whose type this build does not know. */
export const UNKNOWN_HINT_EMOJI = '💡';

/** The emoji for a hint type, tolerant of a type this build has never heard of.
 *  `isHint` is only `!!hintType`, so a pod synced from a newer client (or a
 *  malformed record) can carry a `hintType` outside `HINT_TYPE_META`. A bare
 *  index would throw inside a render computed and blank the whole surface
 *  (the briefing, the to-do list) for one bad record; this degrades to a
 *  generic icon instead. Reconcile never prunes a hint whose type this build
 *  does not know (the newer client that made it owns its lifecycle), so such a
 *  record keeps the generic icon here until it expires or is handled. */
export function hintEmoji(hintType: HelpfulHintType | undefined): string {
  if (!hintType) return '';
  return HINT_TYPE_META[hintType]?.emoji ?? UNKNOWN_HINT_EMOJI;
}

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
  /** Who Owns What (#109): hint type → the single holder of its mapped card
   *  (`CARD_DEFAULTS.hint`). A holder who is in the computed audience becomes the sole
   *  assignee; one who isn't (e.g. the birthday person) is ignored. */
  cardHolders?: Partial<Record<HelpfulHintType, string>>;
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
  | 'malformed-record'
  /** An occasion birthday that duplicates a pod member's own (derived) birthday. */
  | 'duplicate-member-birthday';

/** A to-do that IS a hint: `hintType` is present, not merely optional. The
 *  narrowed type `isHint` produces, named so consumers (the store's hint feed,
 *  the briefing) can index `HINT_TYPE_META` without a `!` or a ternary. */
export type HintTodo = TodoItem & { hintType: HelpfulHintType };

/** The single predicate for "is this to-do an auto-generated hint?". */
export function isHint(todo: TodoItem): todo is HintTodo {
  return !!todo.hintType;
}

/** An open hint nobody has kept yet: it offers Keep / Dismiss (to-do row, drawer, briefing). */
export function isFreshHint(todo: TodoItem): boolean {
  return isHint(todo) && !todo.hintAcknowledged && !todo.completed;
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

/** The dismissed-hint entries (`hintKey` → event date) whose event has passed: nothing
 *  can regenerate them any more, so they only grow the document. The key is opaque and
 *  never parsed; an entry whose value is not a plain date is kept. */
export function pastDismissedHintKeys(
  dismissed: Readonly<Record<string, string>>,
  today: string
): string[] {
  return Object.entries(dismissed)
    .filter(([, eventDate]) => /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && eventDate < today)
    .map(([key]) => key);
}

/** What happened to a mapped card holder on a generated hint (#109). */
export type CardHolderOutcome = 'used' | 'ineligible';

/** Callbacks the source functions use to tally why a candidate was skipped, what
 *  happened to its card holder, and when an occasion fell back to all adults. */
interface Recorder {
  skip: (reason: HintSkipReason) => void;
  holder: (outcome: CardHolderOutcome) => void;
  fallback: () => void;
}

/** One candidate hint: its type, the stable per-source id, the event date, the name in
 *  its title, and its default audience. `titleKey` overrides the type's title. */
interface HintSpec {
  hintType: HelpfulHintType;
  scopeId: string;
  eventDate: string;
  name: string;
  assigneeIds: string[];
  titleKey?: UIStringKey;
}

/** Build a DesiredHint for an in-window event, or null if outside its window /
 *  no audience (recording the reason). */
function buildDesired(input: HelpfulHintsInput, rec: Recorder, spec: HintSpec): DesiredHint | null {
  const { hintType, scopeId, eventDate, name, assigneeIds } = spec;
  if (!assigneeIds.length) {
    rec.skip('no-audience');
    return null;
  }
  if (eventDate < input.today) {
    rec.skip('retroactive');
    return null;
  }
  const lead = input.leadDays[hintType];
  // eventDate >= today is guaranteed above, so daysBetween (absolute) is the
  // forward distance. Reuse the shared date helper rather than re-implement it.
  if (daysBetween(input.today, eventDate) > lead) {
    rec.skip('out-of-window');
    return null;
  }
  // The card holder narrows the audience only from WITHIN it, so a surprise-sensitive
  // exclusion (the birthday person) can never be undone by a card.
  const holder = input.cardHolders?.[hintType];
  let audience = assigneeIds;
  if (holder) {
    if (assigneeIds.includes(holder)) {
      audience = [holder];
      rec.holder('used');
    } else {
      rec.holder('ineligible');
    }
  }
  const title = input.translate(spec.titleKey ?? HINT_TYPE_META[hintType].titleKey, {
    name,
    date: input.formatDate(eventDate),
  });
  return {
    hintType,
    hintKey: buildHintKey(hintType, scopeId, eventDate),
    title,
    assigneeIds: audience,
    eventDate,
  };
}

/** Which hint type (if any) a Party-group activity category maps to. `birthday` is
 *  handled specially before the generic Party-group fallback. Occasions (anniversary
 *  included) are a separate trigger, `occasionHints`. */
function activityTypeFor(category: string): HelpfulHintType | null {
  if (category === 'birthday') return 'birthday-party-gift';
  if (ACTIVITY_GROUP_MAP[category] === 'Party') return 'celebration-gift';
  return null;
}

/**
 * The heads-up each occasion type gets, and its title when it is not the type's own.
 * Exhaustive, so a new occasion type fails to compile until it is wired here.
 *
 * Anniversary keeps its 14-day `anniversary-plan` as its only heads-up (greg, 2026-11-01);
 * remembrance gets a gentler title than "card, gift or a call?".
 */
const OCCASION_HINTS: Record<
  OccasionCategory,
  { headsUp: HelpfulHintType; titleKey?: UIStringKey }
> = {
  anniversary: { headsUp: 'anniversary-plan' },
  remembrance: {
    headsUp: 'occasion-heads-up',
    titleKey: 'todo.hint.title.occasionHeadsUpRemembrance',
  },
  occasion_birthday: { headsUp: 'occasion-heads-up' },
  other_occasion: { headsUp: 'occasion-heads-up' },
};

export interface ComputeResult {
  hints: DesiredHint[];
  /** Count of records skipped by a thrown error (data bug signal, not a normal
   *  degradation like "no date of birth"). */
  skipped: number;
  /** Per-reason tally of candidates that did NOT become a hint (normal
   *  degradations + malformed-record) — for "why no hint for X?" triage. */
  reasons: Partial<Record<HintSkipReason, number>>;
  /** Who Owns What (#109): desired hints assigned to their card holder, and hints whose
   *  card holder was outside the audience (so the default audience was kept). */
  cardHolder: { used: number; ineligible: number };
  /** Occasion occurrences with nobody remembering, whose hints went to all adults. */
  audienceFallback: number;
}

/** Trigger 1 — member birthday −14d → present/party (adults excl. the birthday
 *  person & pets). */
function birthdayHints(
  input: HelpfulHintsInput,
  adultIds: readonly string[],
  rec: Recorder
): DesiredHint[] {
  const out: DesiredHint[] = [];
  for (const member of input.members) {
    try {
      if (member.isPet) continue;
      if (!member.dateOfBirth) {
        rec.skip('no-dob');
        continue;
      }
      const { month, day } = member.dateOfBirth;
      const eventDate = nextAnnualDate(input.today, month, day);
      const audience = adultIds.filter((id) => id !== member.id);
      const hint = buildDesired(input, rec, {
        hintType: 'birthday-present',
        scopeId: member.id,
        eventDate,
        name: member.name,
        assigneeIds: audience,
      });
      if (hint) out.push(hint);
    } catch {
      rec.skip('malformed-record');
    }
  }
  return out;
}

/** Every activity occurrence once per event (a multi-day party's later days are not
 *  events of their own), each visited inside its own try/catch so one malformed record
 *  counts as `malformed-record` and never aborts the run. Shared by the activity
 *  triggers. */
function forEachEventOccurrence(
  input: HelpfulHintsInput,
  rec: Recorder,
  visit: (occ: NotificationOccurrence) => void
): void {
  for (const occ of Object.values(input.occurrences).flat()) {
    try {
      if (isContinuationDay(occ)) continue;
      visit(occ);
    } catch {
      rec.skip('malformed-record');
    }
  }
}

/** Triggers 2–3 — Party-group activity occurrences → gift hints (attendees). */
function activityHints(input: HelpfulHintsInput, rec: Recorder): DesiredHint[] {
  const out: DesiredHint[] = [];
  forEachEventOccurrence(input, rec, ({ activity, date }) => {
    const hintType = activityTypeFor(activity.category);
    if (!hintType) return; // not a hint-worthy category — not a "skip"
    const hint = buildDesired(input, rec, {
      hintType,
      scopeId: activity.id,
      eventDate: extractDatePart(date),
      name: activity.title,
      assigneeIds: normalizeAssignees(activity),
    });
    if (hint) out.push(hint);
  });
  return out;
}

/** An occasion birthday that is really a pod member's own birthday (same month/day as
 *  their date of birth, and their name in the title), which `birthday-present` covers. */
function duplicatesMemberBirthday(
  activity: { date: string; title: string },
  members: FamilyMember[]
): boolean {
  const anchor = extractDatePart(activity.date);
  const month = Number(anchor.slice(5, 7));
  const day = Number(anchor.slice(8, 10));
  return members.some(
    (m) =>
      !m.isPet &&
      m.dateOfBirth?.month === month &&
      m.dateOfBirth?.day === day &&
      !!m.name?.trim() &&
      containsPhrase(activity.title ?? '', m.name)
  );
}

/** Triggers 4 + 7–8 — Occasions occurrences → the type's heads-up (anniversary-plan for
 *  anniversaries) and, for a round count with a year, the big-occasion hint. Audience is
 *  whoever is remembering; nobody (or only removed members / pets) → all adults. */
function occasionHints(
  input: HelpfulHintsInput,
  adultIds: readonly string[],
  rec: Recorder
): DesiredHint[] {
  const out: DesiredHint[] = [];
  const humanIds = new Set(input.members.filter((m) => !m.isPet).map((m) => m.id));
  forEachEventOccurrence(input, rec, ({ activity, date }) => {
    const category = activity.category;
    if (!isOccasionCategory(category)) return; // not an occasion — not a "skip"

    if (category === 'occasion_birthday' && duplicatesMemberBirthday(activity, input.members)) {
      rec.skip('duplicate-member-birthday');
      return;
    }

    let audience = normalizeAssignees(activity).filter((id) => humanIds.has(id));
    const fellBack = !audience.length;
    if (fellBack) audience = [...adultIds];

    const eventDate = extractDatePart(date);
    const name = activityDisplayTitle(activity, eventDate, (k) => input.translate(k));
    const { headsUp, titleKey } = OCCASION_HINTS[category];
    const base = { scopeId: activity.id, eventDate, name, assigneeIds: audience };

    const hint = buildDesired(input, rec, { ...base, hintType: headsUp, titleKey });
    if (hint) out.push(hint);
    let generated = !!hint;

    const count = occasionCount(activity, eventDate);
    if (count !== undefined && OCCASION_TYPES[category].isRound(count)) {
      const big = buildDesired(input, rec, { ...base, hintType: 'occasion-milestone' });
      if (big) out.push(big);
      generated ||= !!big;
    }
    // Count the fallback only when it actually produced a hint, so the rate means
    // "adults were nudged because nobody was remembering", not "an occasion is in the window".
    if (fellBack && generated) rec.fallback();
  });
  return out;
}

/** Triggers 5–6 — trip −2d packing / −7d documents (travellers). */
function tripHints(input: HelpfulHintsInput, rec: Recorder): DesiredHint[] {
  const out: DesiredHint[] = [];
  for (const trip of input.vacations) {
    try {
      if (!trip.startDate) {
        rec.skip('no-start-date');
        continue;
      }
      if (!trip.assigneeIds.length) {
        rec.skip('no-attendees');
        continue;
      }
      const eventDate = extractDatePart(trip.startDate);
      for (const hintType of ['trip-packing', 'trip-documents'] as const) {
        const hint = buildDesired(input, rec, {
          hintType,
          scopeId: trip.id,
          eventDate,
          name: trip.name,
          assigneeIds: trip.assigneeIds,
        });
        if (hint) out.push(hint);
      }
    } catch {
      rec.skip('malformed-record');
    }
  }
  return out;
}

/** The full desired set + skip diagnostics (error count + per-reason tally). */
export function computeDesiredHints(input: HelpfulHintsInput): ComputeResult {
  const reasons: Partial<Record<HintSkipReason, number>> = {};
  const cardHolder = { used: 0, ineligible: 0 };
  let audienceFallback = 0;
  const rec: Recorder = {
    skip: (reason) => {
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    },
    holder: (outcome) => {
      cardHolder[outcome] += 1;
    },
    fallback: () => {
      audienceFallback += 1;
    },
  };
  // `isAdultMember` already excludes pets.
  const adultIds = input.members.filter(isAdultMember).map((m) => m.id);
  const hints = [
    ...birthdayHints(input, adultIds, rec),
    ...activityHints(input, rec),
    ...occasionHints(input, adultIds, rec),
    ...tripHints(input, rec),
  ];
  return {
    hints,
    skipped: reasons['malformed-record'] ?? 0,
    reasons,
    cardHolder,
    audienceFallback,
  };
}

/** Diff desired hints against the family's existing hint to-dos.
 *
 *  `existing` must be ALL hint to-dos — including COMPLETED ones — so a completed
 *  hint's `hintKey` blocks regeneration (completing a hint = keeping it).
 *  `dismissed` is the family's dismissed hint keys: a dismissed hint was DELETED, so
 *  without it the key would look new and come straight back.
 *
 *  - toCreate: desired hints with no existing hint of the same `hintKey`, and not
 *    dismissed.
 *  - toRemove (only ever UN-acknowledged, UN-completed hints — the family's own
 *    kept/completed hints are never auto-removed):
 *    - cross-device DUPLICATE copies (same `hintKey`, different id): keep one
 *      primary (an acknowledged/completed copy if any, else the earliest-created)
 *      and remove the safe extras — otherwise buildTodoReminders double-notifies.
 *    - EXPIRED: the event has passed (`hintEventDate < today`).
 *    - STALE: no longer desired (source deleted / moved out of window). Only for a
 *      `hintType` this build knows (`HINT_TYPE_META`): a type added by a newer client
 *      is never desired here, so pruning it would ping-pong with that client.
 *    - DISMISSED: its key is dismissed (a copy an older build regenerated). */
export function reconcileHints(
  desired: DesiredHint[],
  existing: TodoItem[],
  today: string,
  dismissed: ReadonlySet<string> = new Set()
): { toCreate: DesiredHint[]; toRemove: TodoItem[] } {
  const desiredKeys = new Set(desired.map((d) => d.hintKey));
  const existingKeys = new Set(existing.map((t) => t.hintKey).filter(Boolean));
  const toCreate = desired.filter((d) => !existingKeys.has(d.hintKey) && !dismissed.has(d.hintKey));

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
    if (t.hintKey && dismissed.has(t.hintKey)) return true; // dismissed elsewhere
    if (t.hintKey && winnerByKey.get(t.hintKey) !== t) return true; // duplicate copy
    if (t.hintEventDate && t.hintEventDate < today) return true; // expired
    // Stale, but only for a type this build can generate (see the doc comment). An unknown
    // type is kept only while it carries an event date, so expiry still removes it later.
    const unknownType = !t.hintType || !Object.hasOwn(HINT_TYPE_META, t.hintType);
    if (unknownType && t.hintEventDate) return false;
    if (!t.hintKey || !desiredKeys.has(t.hintKey)) return true; // stale
    return false;
  });
  return { toCreate, toRemove };
}

/** Collapse hints sharing a `hintKey` (two devices generated the same one before
 *  syncing) to the earliest-created — the CRDT-merge collision resolver, mirroring
 *  the recurring-transaction dedup.
 *
 *  Generic so the store's `filter(isHint)` narrowing survives (→ `HintTodo[]`)
 *  while the reminder scheduler's mixed feed (`useScheduledReminders`, which
 *  passes ALL active to-dos and relies on non-hints passing through) still comes
 *  back as `TodoItem[]`. The bound must stay `TodoItem`, never `HintTodo`. */
export function dedupeHintsByKey<T extends TodoItem>(hints: T[]): T[] {
  const byKey = new Map<string, T>();
  const out: T[] = [];
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
