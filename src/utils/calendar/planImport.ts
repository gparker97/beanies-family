/**
 * Decide what a one-time Google Calendar import (#94) would do, without doing any
 * of it. Pure, so every rule below is testable without a client, a store or a DOM.
 *
 * The output is a list the review screen renders and the user ticks. Nothing here
 * writes anything; `calendarImportStore` turns the ticked subset into one batch.
 *
 * ## The two axes, which are NOT the same axis
 *
 * `outcome` is what the ROW SAYS to the user. `origin` is what the ENGINE MAY DO
 * afterwards. They usually agree, and there is one deliberate case where they do
 * not: a series whose repeat pattern beanies cannot express is shown as a copy AND
 * pinned to `origin: 'external'` even when the user organizes it, because adopting
 * it would let a later ordinary edit destroy their whole Google series. See
 * `unsupported-recurrence` below.
 */

import type {
  CalendarEventLink,
  CreateFamilyActivityInput,
  FamilyActivity,
  UUID,
} from '@/types/models';
import type { CalendarEventFull } from '@/services/calendar/CalendarClient';
import { parseRecurrence } from './parseRrule';
import { googleTimesToActivityFields } from './activityToGoogleEvent';
import { activityShadowFromRule } from '@/services/recurrence/adapters';

/** What the review row tells the user will happen to this event. */
export type ImportOutcome = 'adopt' | 'copy' | 'unsupported-recurrence';

/** Why a candidate was dropped before the user ever saw it. */
export type ImportSkipReason =
  | 'cancelled'
  | 'series-instance'
  | 'beanies-own-event'
  | 'unreadable-times'
  | 'duplicate-across-calendars';

/**
 * A beanies-created event id: `deterministicEventId` emits `b` + 32 base32hex
 * chars. The destination calendar is full of these and they all pass `isOrganizer`,
 * so without this the import would offer beanies' own events back to the user. The
 * link check catches the normal case; this catches a beanies event whose link was
 * lost (a partial teardown, a delete that failed), which would otherwise import a
 * second activity for something beanies already owns.
 */
const BEANIES_EVENT_ID = /^b[0-9a-v]{32}$/;

export interface ImportCandidate {
  googleEventId: string;
  connectionId: string;
  calendarId: string;
  calendarLabel: string;
  outcome: ImportOutcome;
  /** What the ENGINE may do, recorded on the link. See the note at the top. */
  origin: NonNullable<CalendarEventLink['origin']>;
  /**
   * The ONLY copy of the activity fields. The review row renders from this, so the
   * list cannot disagree with what actually gets written.
   */
  draft: CreateFamilyActivityInput;
  /** Already imported on a previous run: shown, disabled, never re-created. */
  alreadyImported: boolean;
}

/**
 * Pin an `unsupported-recurrence` candidate to its NEXT occurrence instead of the
 * master's DTSTART.
 *
 * A master's start is its ORIGINAL start, which for a long-running series is often
 * years in the past. These candidates import as one-offs, so left on the DTSTART
 * they would land on a date the family will never scroll to — while the row, the
 * legend and the help article all promise "the next time it happens". The caller
 * resolves the occurrence via `listInstances`; this applies it.
 *
 * Pure, and deliberately narrow: it re-dates and nothing else, so the title, notes,
 * location, assignees and every other field stay exactly as planned.
 */
export function redateToOccurrence(
  candidate: ImportCandidate,
  start: { date?: string; dateTime?: string } | undefined,
  end: { date?: string; dateTime?: string } | undefined
): ImportCandidate {
  const times = googleTimesToActivityFields(start, end);
  if (!times) return candidate;
  // Drop the OLD span fields before spreading the new ones, or a master that had
  // an `endDate` would keep it while `date` moved forward.
  const {
    date: _d,
    endDate: _e,
    isAllDay: _a,
    startTime: _s,
    endTime: _t,
    ...rest
  } = candidate.draft as CreateFamilyActivityInput & { endDate?: string };
  return { ...candidate, draft: { ...rest, ...times } as CreateFamilyActivityInput };
}

export interface ImportDefaults {
  /** Member who is running the import; becomes creator and sole assignee. */
  memberId: UUID;
  /** Destination calendar of this connection, already normalized off 'primary'. */
  destinationCalendarId: string;
}

export interface ImportSource {
  connectionId: string;
  calendarId: string;
  calendarLabel: string;
  events: CalendarEventFull[];
}

export interface ImportPlan {
  candidates: ImportCandidate[];
  skipped: Array<{ id: string; reason: ImportSkipReason }>;
}

/** Fields Google cannot tell us, chosen once, here, rather than at each call site. */
function activityDefaults(
  memberId: UUID
): Pick<
  FamilyActivity,
  'category' | 'feeSchedule' | 'reminderMinutes' | 'isActive' | 'createdBy' | 'assigneeIds'
> {
  return {
    // The neutral catch-all. Guessing a category from a title would be wrong more
    // often than it was right, and the user can change it in one tap afterwards.
    category: 'other_activity',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: memberId,
    // The activity form requires at least one assignee, and `createActivity` does
    // not validate, so an import writing none would produce activities the rest of
    // the app treats as malformed.
    assigneeIds: [memberId],
  };
}

/**
 * The date an RRULE is anchored on, in the EVENT's own timezone.
 *
 * Google gives an offset-bearing `dateTime` plus the `timeZone` the series was
 * authored in. `BYDAY=TU` means Tuesday THERE, not Tuesday on whatever device
 * happens to be running the import, so the anchor-agreement checks in
 * `parseRecurrence` have to use this rather than the device-local date.
 * All-day events carry a bare `date`, which is already zone-free.
 */
function recurrenceAnchorYmd(ev: CalendarEventFull): string | null {
  if (ev.start?.date) return ev.start.date.slice(0, 10);
  const dt = ev.start?.dateTime;
  if (!dt) return null;
  const zone = ev.start?.timeZone;
  const at = new Date(dt);
  if (Number.isNaN(at.getTime())) return null;
  if (!zone) {
    // No zone given: the offset in the string is the best available truth, so
    // read the wall-clock date straight out of it rather than re-projecting.
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(dt);
    return m ? m[1] : null;
  }
  try {
    // `en-CA` yields YYYY-MM-DD, which is the shape the rest of the app uses.
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at);
  } catch {
    // An unknown IANA zone must not fail the whole scan; fall back to the offset.
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(dt);
    return m ? m[1] : null;
  }
}

// NOTE: there is deliberately no local recurrence summariser here. The row's
// repeat chip renders through `useRecurrenceLabel().describe`, which wraps the
// one canonical `describeRule`. A second generator here would have been the
// fourth such formatter in the app's history and — being a plain string in a
// `.ts` file — would have shipped hardcoded English straight past the template
// i18n lint.

/**
 * Build the review list.
 *
 * `existingLinks` are this family's links across ALL connections, which is how
 * re-running the import re-creates nothing: it is a property of the data, not of a
 * stored cursor, so it survives a reinstall and a second device.
 */
export function planImport(
  sources: ImportSource[],
  existingLinks: CalendarEventLink[],
  defaults: ImportDefaults
): ImportPlan {
  const linkedGoogleIds = new Set(existingLinks.map((l) => l.googleEventId));
  const candidates: ImportCandidate[] = [];
  const skipped: ImportPlan['skipped'] = [];

  // Masters with at least one REMOVED occurrence. Google records those as separate
  // cancelled instances rather than as an EXDATE on the master, so the master's
  // own `recurrence[]` looks clean and would otherwise be adopted verbatim,
  // putting back a lesson the family deliberately deleted.
  const mastersWithRemovedOccurrences = new Set<string>();
  for (const source of sources) {
    for (const ev of source.events) {
      if (ev.status === 'cancelled' && ev.recurringEventId) {
        mastersWithRemovedOccurrences.add(ev.recurringEventId);
      }
    }
  }

  for (const source of sources) {
    for (const ev of source.events) {
      if (ev.status === 'cancelled') {
        skipped.push({ id: ev.id, reason: 'cancelled' });
        continue;
      }
      // A modified or cancelled INSTANCE of a series. The master carries the whole
      // series, so importing an instance too would double it.
      if (ev.recurringEventId) {
        skipped.push({ id: ev.id, reason: 'series-instance' });
        continue;
      }
      if (BEANIES_EVENT_ID.test(ev.id)) {
        skipped.push({ id: ev.id, reason: 'beanies-own-event' });
        continue;
      }

      const times = googleTimesToActivityFields(ev.start, ev.end);
      if (!times) {
        skipped.push({ id: ev.id, reason: 'unreadable-times' });
        continue;
      }

      // Adoption needs BOTH: the user must organize it (Google refuses a patch
      // otherwise), and it must live on the calendar this connection writes to,
      // because the link carries no calendarId and every push targets the
      // destination. An adopted event on another calendar would 404 and then be
      // re-inserted onto the destination as a duplicate.
      const onDestination = source.calendarId === defaults.destinationCalendarId;
      const adoptable = ev.isOrganizer && onDestination;

      // ⚠️ The recurrence anchor is the event's OWN start date, not the importing
      // device's local date. `times.date` is device-local wall clock (correct for
      // the activity's own fields), but an RRULE's BYDAY/BYMONTHDAY is anchored in
      // the event's zone. Using the device date meant a Singapore 16:00 Tuesday
      // series, imported from a device west of that zone, resolved to Monday and
      // was silently demoted to `unsupported-recurrence`; a bare FREQ=MONTHLY was
      // worse, landing on the wrong day of every month with no refusal at all.
      // Reproducible: TZ=Pacific/Honolulu turned three of this module's tests red.
      const parsed = mastersWithRemovedOccurrences.has(ev.id)
        ? ({ ok: false, reason: 'extra-date-lines' } as const)
        : parseRecurrence(ev.recurrence, recurrenceAnchorYmd(ev) ?? times.date);
      const isRecurringInGoogle = (ev.recurrence?.length ?? 0) > 0;

      let outcome: ImportOutcome;
      let origin: NonNullable<CalendarEventLink['origin']>;
      let recurrenceFields: Partial<FamilyActivity> = { recurrence: 'none' };

      if (parsed.ok) {
        outcome = adoptable ? 'adopt' : 'copy';
        origin = adoptable ? 'adopted' : 'external';
        recurrenceFields = {
          rule: parsed.rule,
          // The ONLY sanctioned derivation of the legacy shadow trio. Setting
          // recurrence/daysOfWeek/recurrenceEndDate by hand breaks the fidelity
          // contract `activityInWindow` and `computePushHash` depend on.
          ...activityShadowFromRule(parsed.rule),
        };
      } else if (isRecurringInGoogle) {
        // 🔴 NEVER adopted, whoever organizes it. This imports as a ONE-OFF, and
        // `GoogleEventResource.recurrence` is a REQUIRED field that a non-recurring
        // activity fills with `[]`. So if this were adopted, the user's first
        // ordinary edit in beanies would PATCH the Google master with an empty
        // recurrence and collapse their entire series into a single event, silently
        // destroying every future occurrence. `external` makes that push impossible.
        outcome = 'unsupported-recurrence';
        origin = 'external';
      } else {
        outcome = adoptable ? 'adopt' : 'copy';
        origin = adoptable ? 'adopted' : 'external';
      }

      candidates.push({
        googleEventId: ev.id,
        connectionId: source.connectionId,
        calendarId: source.calendarId,
        calendarLabel: source.calendarLabel,
        outcome,
        origin,
        alreadyImported: linkedGoogleIds.has(ev.id),
        draft: {
          title: ev.summary?.trim() || '',
          // Google's body goes to `notes`, NOT `description`. Only `notes` is
          // pushed back out (`eventDescription.ts`), so importing into
          // `description` would mean the first push WIPES the user's event body in
          // Google. This one line is what makes adoption near-lossless.
          ...(ev.description ? { notes: ev.description } : {}),
          ...(ev.location ? { location: ev.location } : {}),
          ...times,
          ...recurrenceFields,
          ...activityDefaults(defaults.memberId),
        } as CreateFamilyActivityInput,
      });
    }
  }

  // Google cannot order this read for us: `orderBy=startTime` requires
  // `singleEvents=true`, and this read deliberately uses false to get masters.
  candidates.sort((a, b) => a.draft.date.localeCompare(b.draft.date));

  // ONE row per Google event id, whatever how many of the chosen calendars carry
  // it. An invitation appears with the SAME id on the organizer's calendar and on
  // every attendee's, so scanning two of the family's calendars would otherwise
  // offer the school concert twice — and committing both would write two
  // activities whose links share one `googleEventId`, which the reconcile engine
  // has no way to tell apart. The ADOPTABLE copy wins (it is the one on the
  // destination calendar, so beanies can keep it in step); otherwise the first by
  // date, which the sort above has already settled.
  const deduped: ImportCandidate[] = [];
  const seen = new Map<string, number>();
  for (const c of candidates) {
    const at = seen.get(c.googleEventId);
    if (at === undefined) {
      seen.set(c.googleEventId, deduped.length);
      deduped.push(c);
      continue;
    }
    const keep = deduped[at].origin === 'adopted' ? deduped[at] : c;
    const drop = keep === c ? deduped[at] : c;
    deduped[at] = keep;
    skipped.push({ id: drop.googleEventId, reason: 'duplicate-across-calendars' });
  }

  return { candidates: deduped, skipped };
}
