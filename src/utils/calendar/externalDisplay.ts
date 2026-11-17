/**
 * How a view-only external event reads on a planner surface (plan 2026-11-17, C1). Pure:
 * no stores, no Vue. Every chip, block, row and the details modal take their wording
 * and their per-day window from here, so no two surfaces can name, time or clamp the
 * same event differently.
 *
 * i18n stays out of the data: the translator is passed in, as `birthdayLabel` does.
 */
import type { ExternalEvent } from '@/types/externalEvents';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';
import {
  addDaysYmd,
  formatDateFull,
  formatDateTime,
  formatTime12,
  parseLocalDate,
  toTimeInputValue,
} from '@/utils/date';

type Translate = (key: UIStringKey) => string;

/**
 * The event's title, or "Busy". A busy-only event has no title by construction (it was
 * stripped at the store boundary); a details event Google returns without a summary
 * also reads "Busy" rather than an empty chip.
 */
export function externalEventTitle(
  event: Pick<ExternalEvent, 'title' | 'busyOnly'>,
  t: Translate
): string {
  const title = event.busyOnly ? '' : (event.title?.trim() ?? '');
  return title || t('calendarView.event.busy');
}

/** The part of a timed event drawn on one local day, as the planner grids read it. */
export interface ExternalDayWindow {
  /** `HH:mm`, local. `00:00` on a day the event started before. */
  startTime: string;
  /** `HH:mm`, local; `24:00` when the event runs past midnight (the grid clamps there). */
  endTime: string;
  /** The event began on an earlier day: this is its continuation. */
  isTail: boolean;
}

/**
 * Clamp a timed event to the local day `ymd`, the way `timedCards` clamps an overnight
 * activity: the start day draws to midnight and each following day draws its own part
 * from 00:00. Device-local time throughout (Assumption 5).
 */
export function externalWindowOn(
  event: Pick<ExternalEvent, 'startMs' | 'endMs'>,
  ymd: string
): ExternalDayWindow {
  const dayStart = parseLocalDate(ymd).getTime();
  const dayEnd = parseLocalDate(addDaysYmd(ymd, 1)).getTime();
  const start = Math.max(event.startMs, dayStart);
  const end = Math.min(Math.max(event.endMs, start), dayEnd);
  return {
    startTime: toTimeInputValue(new Date(start)),
    endTime: end >= dayEnd ? '24:00' : toTimeInputValue(new Date(end)),
    isTail: event.startMs < dayStart,
  };
}

/** "3pm" or "3pm-5pm" for a day's drawn window (`HH:mm`; an end of `24:00` is midnight). */
export function externalWindowLabel(startTime: string, endTime: string): string {
  const start = formatTime12(startTime);
  if (endTime === startTime) return start;
  return `${start}-${formatTime12(endTime === '24:00' ? '00:00' : endTime)}`;
}

/** "3pm" or "3pm-5pm" for a timed event on `ymd` (a tail reads "12am-..."). */
export function externalTimeLabel(
  event: Pick<ExternalEvent, 'startMs' | 'endMs'>,
  ymd: string
): string {
  const w = externalWindowOn(event, ymd);
  return externalWindowLabel(w.startTime, w.endTime);
}

/**
 * The details modal's "When": one all-day date, an all-day range, a timed span on one
 * day, or a timed span across days. The app's own date and time formatters.
 */
export function externalWhenLabel(
  event: Pick<ExternalEvent, 'allDay' | 'startMs' | 'endMs' | 'startYmd' | 'endYmd'>,
  t: Translate
): string {
  if (event.allDay) {
    if (event.startYmd === event.endYmd) {
      return fillTemplate(t('calendarView.event.allDayOn'), {
        date: formatDateFull(event.startYmd),
      });
    }
    return fillTemplate(t('calendarView.event.range'), {
      from: formatDateFull(event.startYmd),
      to: formatDateFull(event.endYmd),
    });
  }
  const startTime = toTimeInputValue(new Date(event.startMs));
  if (event.endMs <= event.startMs) return formatDateTime(event.startYmd, startTime);
  const endTime = toTimeInputValue(new Date(event.endMs));
  if (event.startYmd === event.endYmd) {
    return fillTemplate(t('calendarView.event.timedOn'), {
      date: formatDateFull(event.startYmd),
      from: formatTime12(startTime),
      to: formatTime12(endTime),
    });
  }
  return fillTemplate(t('calendarView.event.range'), {
    from: formatDateTime(event.startYmd, startTime),
    to: formatDateTime(event.endYmd, endTime),
  });
}

/**
 * The accessible name every view-only item carries: "{title}, view only, {calendar}",
 * with the time when the surface shows one ("{title}, {time}, view only, {calendar}").
 */
export function externalSpokenLabel(
  event: Pick<ExternalEvent, 'title' | 'busyOnly' | 'calendarName'>,
  t: Translate,
  time?: string
): string {
  const title = externalEventTitle(event, t);
  return time
    ? fillTemplate(t('calendarView.event.spokenTimed'), {
        title,
        time,
        calendar: event.calendarName,
      })
    : fillTemplate(t('calendarView.event.spoken'), { title, calendar: event.calendarName });
}
