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
  'cancelled' | 'series-instance' | 'beanies-own-event' | 'unreadable-times';

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
  /** Repeat pattern for the chip. Absent for a one-off. Presentation only. */
  recurrenceSummary?: string;
  /**
   * The ONLY copy of the activity fields. The review row renders from this, so the
   * list cannot disagree with what actually gets written.
   */
  draft: CreateFamilyActivityInput;
  /** Already imported on a previous run: shown, disabled, never re-created. */
  alreadyImported: boolean;
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

/** Human-readable repeat pattern for the row chip. Presentation only. */
function summariseRecurrence(rule: { unit: string; interval: number }): string {
  const { unit, interval } = rule;
  if (interval === 1) {
    return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[unit] ?? 'Repeats';
  }
  if (unit === 'week' && interval === 2) return 'Fortnightly';
  return `Every ${interval} ${unit}s`;
}

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

      const parsed = parseRecurrence(ev.recurrence, times.date);
      const isRecurringInGoogle = (ev.recurrence?.length ?? 0) > 0;

      let outcome: ImportOutcome;
      let origin: NonNullable<CalendarEventLink['origin']>;
      let recurrenceSummary: string | undefined;
      let recurrenceFields: Partial<FamilyActivity> = { recurrence: 'none' };

      if (parsed.ok) {
        outcome = adoptable ? 'adopt' : 'copy';
        origin = adoptable ? 'adopted' : 'external';
        recurrenceSummary = summariseRecurrence(parsed.rule);
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
        recurrenceSummary,
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

  return { candidates, skipped };
}
