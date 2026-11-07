/**
 * Live flight checks (#143): every human sentence the chip, the change notice, the notes line,
 * the briefing row, the bell and the OS notification say, in ONE place, so the wording cannot
 * drift between surfaces.
 *
 * Pure: each builder takes the translator `t` FIRST (the `DeriveInput.t` precedent in
 * `utils/notifications.ts`) and never imports the translation store, so the derivers and
 * `planChange` that call it stay pure. Placeholders go through `fillTemplate`. Dates are
 * formatted by the band's own `formatDateShort` ("13 Dec"); times are the stored wall clock rendered by
 * `clockTime` (the band's `formatTime12`, "6:30pm"), the notes line included, so a card shows
 * one time format.
 */
import type { LanguageCode } from '@/types/models';
import type { FlightVerification, ScheduleTuple } from '@/types/flightStatus';
import type { TranslateFn } from '@/utils/format';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort, formatTime12 } from '@/utils/date';
import { diffTuple, normaliseTerminal, type TupleField } from './schedule';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "13 Dec": the same `formatDateShort` the "when" band and the timeline use, so one card never
 * says "Dec 13" in its notice beside "13 Dec" in its band. Like the band, it is not localised;
 * `_lang` is kept so callers need not change if the band's formatter ever becomes language
 * aware. A malformed value is returned as written, never dropped.
 */
export function shortDate(ymd: string | undefined, _lang?: LanguageCode): string {
  const d = /^\d{4}-\d{2}-\d{2}/.exec(ymd?.trim() ?? '')?.[0];
  if (!d) return ymd?.trim() ?? '';
  return formatDateShort(d);
}

/**
 * A stored wall-clock time as the app shows it everywhere else ("6:30pm", "5pm"): the same
 * `formatTime12` the "when" band uses, so a card never says "18:30" in its notice beside
 * "6:30pm" in its band. Deterministic (no locale), so two devices writing the same notes line
 * write the same bytes. A value that is not a time is returned trimmed, never dropped; ''
 * for none.
 */
export function clockTime(value: string | undefined): string {
  const v = value?.trim() ?? '';
  return /^\d{1,2}:\d{2}/.test(v) ? formatTime12(v) : v;
}

/** The device-local calendar date of an instant, `YYYY-MM-DD` (the notes line's "until"). */
export function localYmd(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "Terminal 3" from any spelling ("3", "T3", "terminal 3"); '' for none. */
export function terminalLabel(t: TranslateFn, raw: string | undefined): string {
  const id = normaliseTerminal(raw);
  return id ? fillTemplate(t('flightChecks.terminal'), { terminal: id }) : '';
}

/** The airline's display name, or "the airline" when neither the leg nor the booking has one.
 *  A booking value that carries a code ("Singapore Airlines (SQ)") loses the code. */
export function airlineName(t: TranslateFn, name: string | undefined): string {
  const v = name?.replace(/\s*\([A-Z0-9]{2,3}\)\s*$/, '').trim();
  return v || t('flightChecks.theAirline');
}

/**
 * The change announcement (chip notice, bell, briefing, OS notification):
 * "SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated."
 *
 * `now` is the schedule as applied, `was` the prior values (`liveWas`: the CHANGED fields
 * only). The departure date is named only when it changed; an arrival-only change says when
 * it now lands. `updated: false` drops "Your plan has been updated." for a change this device
 * has not written (the caller says so instead).
 */
export function changeSentence(
  t: TranslateFn,
  flight: string,
  now: ScheduleTuple,
  was: ScheduleTuple,
  lang?: LanguageCode,
  updated = true
): string {
  const departureMoved =
    was.departureDate !== undefined ||
    was.departureTime !== undefined ||
    was.terminal !== undefined;
  const terminal = terminalLabel(t, now.terminal);
  let lead: string;
  if (!departureMoved && (was.arrivalDate !== undefined || was.arrivalTime !== undefined)) {
    lead =
      was.arrivalDate !== undefined
        ? fillTemplate(t('flightChecks.change.landsOn'), {
            flight,
            date: shortDate(now.arrivalDate, lang),
            time: clockTime(now.arrivalTime),
          })
        : fillTemplate(t('flightChecks.change.lands'), {
            flight,
            time: clockTime(now.arrivalTime),
          });
  } else if (was.departureDate === undefined && was.departureTime === undefined && terminal) {
    lead = fillTemplate(t('flightChecks.change.leavesFrom'), { flight, terminal });
  } else {
    const dated = was.departureDate !== undefined;
    const key = dated
      ? terminal
        ? 'flightChecks.change.leavesOnTerminal'
        : 'flightChecks.change.leavesOn'
      : terminal
        ? 'flightChecks.change.leavesTerminal'
        : 'flightChecks.change.leaves';
    lead = fillTemplate(t(key), {
      flight,
      time: clockTime(now.departureTime),
      date: shortDate(now.departureDate, lang),
      terminal,
    });
  }
  if (!updated) return lead;
  // Chinese sentences end on a full-width stop and are not space-separated.
  const sep = /[。！？]$/.test(lead) ? '' : ' ';
  return `${lead}${sep}${t('flightChecks.change.updated')}`;
}

/** "Singapore Airlines cancelled SQ318 on 13 Dec. This flight is now pending." */
export function cancelSentence(
  t: TranslateFn,
  input: { airline?: string; flight: string; date?: string },
  lang?: LanguageCode
): string {
  const vars = {
    airline: input.airline?.trim() ?? '',
    flight: input.flight,
    date: shortDate(input.date, lang),
  };
  return fillTemplate(
    t(vars.airline ? 'flightChecks.cancel.airline' : 'flightChecks.cancel.noAirline'),
    vars
  );
}

/**
 * The prior values, as a phrase: "Was 5pm from Terminal 2", "Was 13 Dec at 5pm",
 * "Was from Terminal 2", "Was landing at 11:10pm". '' when `was` holds nothing.
 */
export function wasLine(t: TranslateFn, was: ScheduleTuple, lang?: LanguageCode): string {
  const terminal = terminalLabel(t, was.terminal);
  const time = was.departureTime !== undefined ? clockTime(was.departureTime) : undefined;
  const date = was.departureDate !== undefined ? shortDate(was.departureDate, lang) : '';
  if (date && time) {
    return fillTemplate(
      t(terminal ? 'flightChecks.was.dateTimeTerminal' : 'flightChecks.was.dateTime'),
      { date, time, terminal }
    );
  }
  if (date) return fillTemplate(t('flightChecks.was.date'), { date });
  if (time) {
    return fillTemplate(t(terminal ? 'flightChecks.was.timeTerminal' : 'flightChecks.was.time'), {
      time,
      terminal,
    });
  }
  if (terminal) return fillTemplate(t('flightChecks.was.terminal'), { terminal });
  if (was.arrivalTime !== undefined) {
    return fillTemplate(t('flightChecks.was.landing'), { time: clockTime(was.arrivalTime) });
  }
  if (was.arrivalDate !== undefined) {
    return fillTemplate(t('flightChecks.was.landingOn'), {
      date: shortDate(was.arrivalDate, lang),
    });
  }
  return '';
}

/** The notes line an applied change appends: "Was 5pm from Terminal 2 until 12 Dec".
 *  `untilYmd` is the day the change was applied. */
export function changeNoteLine(
  t: TranslateFn,
  was: ScheduleTuple,
  untilYmd: string,
  lang?: LanguageCode
): string {
  return fillTemplate(t('flightChecks.note.was'), {
    was: wasLine(t, was, lang),
    date: shortDate(untilYmd, lang),
  });
}

/** The change notice's second line: "Was 5pm from Terminal 2. Changed by Singapore Airlines ·
 *  checked 12 min ago." `airline` is a display name (`airlineName`). */
export function changedByLine(
  t: TranslateFn,
  was: ScheduleTuple,
  airline: string,
  ago: string,
  lang?: LanguageCode
): string {
  return fillTemplate(t('flightChecks.notice.changedBy'), {
    was: wasLine(t, was, lang),
    airline,
    ago,
  });
}

const FIELD_KEY = {
  departureDate: 'flightChecks.field.departureDate',
  departureTime: 'flightChecks.field.departureTime',
  arrivalDate: 'flightChecks.field.arrivalDate',
  arrivalTime: 'flightChecks.field.arrivalTime',
} as const;

/**
 * The notes line a QUIET FILL appends (the airline published a value the segment never had):
 * "Terminal 3 added from Singapore Airlines, 12 Dec". `airline` is a display name.
 */
export function fillNoteLine(
  t: TranslateFn,
  fields: readonly TupleField[],
  provider: ScheduleTuple,
  airline: string,
  dateYmd: string,
  lang?: LanguageCode
): string {
  const what = fields
    .map((f) => {
      if (f === 'terminal') return terminalLabel(t, provider.terminal);
      const raw = provider[f] ?? '';
      const value = f.endsWith('Date') ? shortDate(raw, lang) : clockTime(raw);
      return fillTemplate(t(FIELD_KEY[f]), { value });
    })
    .filter((s) => s.length > 0)
    .join(', ');
  return fillTemplate(t('flightChecks.note.filled'), {
    what,
    airline,
    date: shortDate(dateYmd, lang),
  });
}

/** The notes line a recorded cancellation appends: "Cancelled by Singapore Airlines, 12 Dec". */
export function cancelNoteLine(
  t: TranslateFn,
  airline: string,
  dateYmd: string,
  lang?: LanguageCode
): string {
  return fillTemplate(t('flightChecks.note.cancelled'), {
    airline,
    date: shortDate(dateYmd, lang),
  });
}

/**
 * One side of a Conflict as a short schedule phrase, naming only `fields`:
 * "5pm from Terminal 2 on 13 Dec", "landing at 12:40am". A field this side does not have
 * reads "not set".
 */
function schedulePhrase(
  t: TranslateFn,
  tuple: ScheduleTuple,
  fields: readonly TupleField[],
  lang?: LanguageCode
): string {
  const has = (f: TupleField) => fields.includes(f);
  const parts: string[] = [];
  const notSet = t('travel.live.notSet');
  if (has('departureTime')) parts.push(clockTime(tuple.departureTime) || notSet);
  if (has('terminal')) {
    const terminal = terminalLabel(t, tuple.terminal);
    parts.push(
      terminal ? fillTemplate(t('travel.live.phrase.fromTerminal'), { terminal }) : notSet
    );
  }
  if (has('departureDate')) {
    const date = shortDate(tuple.departureDate, lang);
    parts.push(date ? fillTemplate(t('travel.live.phrase.onDate'), { date }) : notSet);
  }
  if (has('arrivalTime') && has('arrivalDate')) {
    parts.push(
      fillTemplate(t('travel.live.phrase.landingOnAt'), {
        date: shortDate(tuple.arrivalDate, lang) || notSet,
        time: clockTime(tuple.arrivalTime) || notSet,
      })
    );
  } else if (has('arrivalTime')) {
    parts.push(
      fillTemplate(t('travel.live.phrase.landingAt'), {
        time: clockTime(tuple.arrivalTime) || notSet,
      })
    );
  } else if (has('arrivalDate')) {
    parts.push(
      fillTemplate(t('travel.live.phrase.landingOn'), {
        date: shortDate(tuple.arrivalDate, lang) || notSet,
      })
    );
  }
  return parts.join(' ');
}

/**
 * The Conflict notice: "Your plan says 5pm from Terminal 2 on 13 Dec. Singapore Airlines says
 * 6:30pm from Terminal 3." Each side names the fields that disagree; when a departure time or
 * terminal is in dispute, the family's side also names the departure day (unless the day is
 * itself in dispute), so the reader knows which flight. `airline` is a display name (`airlineName`).
 */
export function conflictSentence(
  t: TranslateFn,
  input: { mine: ScheduleTuple; provider: ScheduleTuple; airline: string },
  lang?: LanguageCode
): string {
  const d = diffTuple(input.mine, input.provider);
  const fields = d.changed.length > 0 ? d.changed : d.filled;
  // The day is context for a DEPARTURE dispute only ("5pm from Terminal 2 on 9 Nov"); on an
  // arrival dispute it would read as the landing day, which it is not.
  const departureInDispute = fields.includes('departureTime') || fields.includes('terminal');
  const mineFields =
    departureInDispute && !fields.includes('departureDate') && input.mine.departureDate
      ? [...fields, 'departureDate' as const]
      : fields;
  return fillTemplate(t('travel.live.conflictSentence'), {
    mine: schedulePhrase(t, input.mine, mineFields, lang),
    airline: input.airline,
    theirs: schedulePhrase(t, input.provider, fields, lang),
  });
}

/**
 * The briefing row's message for a timed departure today: "Everyone flies at 5pm today",
 * "Jill flies at 5pm today", "Jill and Sam fly at 5pm today"; "leave(s)" for a train,
 * ferry or cruise. `names` is the caller's joined list (null = the whole family travels),
 * `count` how many people it names (picks the verb's number).
 */
export function departureRowMessage(
  t: TranslateFn,
  input: { names: string | null; count: number; time: string; isFlight: boolean }
): string {
  if (input.names === null) {
    return fillTemplate(
      t(input.isFlight ? 'flightChecks.row.everyoneFlies' : 'flightChecks.row.everyoneLeaves'),
      { time: clockTime(input.time) }
    );
  }
  const one = input.count === 1;
  const key = input.isFlight
    ? one
      ? 'flightChecks.row.flies.one'
      : 'flightChecks.row.flies.other'
    : one
      ? 'flightChecks.row.leaves.one'
      : 'flightChecks.row.leaves.other';
  return fillTemplate(t(key), { names: input.names, time: clockTime(input.time) });
}

/** "just now", "12 min ago", "3 h ago", "2 d ago": the age of a check, by the caller's clock. */
export function agoText(t: TranslateFn, atMs: number, nowMs: number): string {
  const age = Math.max(0, nowMs - atMs);
  if (age < MINUTE_MS) return t('flightChecks.ago.justNow');
  if (age < HOUR_MS) {
    return fillTemplate(t('flightChecks.ago.minutes'), { n: Math.floor(age / MINUTE_MS) });
  }
  if (age < DAY_MS) {
    return fillTemplate(t('flightChecks.ago.hours'), { n: Math.floor(age / HOUR_MS) });
  }
  return fillTemplate(t('flightChecks.ago.days'), { n: Math.floor(age / DAY_MS) });
}

/** "Checked 12 min ago" (the verified chip and the briefing caption). */
export function checkedAgo(t: TranslateFn, checkedAtMs: number, nowMs: number): string {
  return fillTemplate(t('flightChecks.checked'), { ago: agoText(t, checkedAtMs, nowMs) });
}

/**
 * Does this verification carry a chip at all? Not for a flight that is over
 * (`unavailable`/`past`): "Couldn't check" on last week's flight reads as a fault, and there
 * is nothing left to check. The card, the rail and the chip itself all ask this.
 */
export function hasFlightChip(v: FlightVerification): boolean {
  return !(v.state === 'unavailable' && v.reason === 'past');
}

/**
 * The chip's label for a verification, or null when it carries no chip (`hasFlightChip`).
 * Display-only provider statuses (`CanceledUncertain`, `Diverted`) override `verified`, never
 * a written state.
 */
export function chipLabel(
  t: TranslateFn,
  v: FlightVerification,
  nowMs: number,
  lang?: LanguageCode
): string | null {
  if (!hasFlightChip(v)) return null;
  switch (v.state) {
    case 'not-live':
      return t('flightChecks.chip.notLive');
    case 'cancelled':
      return t('flightChecks.chip.cancelled');
    case 'conflict':
      return t('flightChecks.chip.conflict');
    case 'changed':
      return t('flightChecks.chip.changed');
    case 'verified':
      if (v.live?.status === 'CanceledUncertain') return t('flightChecks.chip.mayBeCancelled');
      if (v.live?.status === 'Diverted') return t('flightChecks.chip.diverted');
      return v.checkedAt !== undefined
        ? checkedAgo(t, v.checkedAt, nowMs)
        : t('flightChecks.chip.unavailable');
    case 'unavailable':
      switch (v.reason) {
        case 'before_window':
          return v.opensAt
            ? fillTemplate(t('flightChecks.chip.checksFrom'), {
                date: shortDate(localYmd(Date.parse(v.opensAt)), lang),
              })
            : t('flightChecks.chip.unavailable');
        case 'no_match':
          return t('flightChecks.chip.noMatch');
        case 'unentitled':
        case 'disabled':
        case 'not_configured':
          return t('flightChecks.chip.notLive');
        case undefined:
          return t('flightChecks.chip.checking');
        default:
          return t('flightChecks.chip.unavailable');
      }
  }
}
