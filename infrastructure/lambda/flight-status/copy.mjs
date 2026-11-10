/**
 * The closed-app push copy (#143 Phase 2, requirement 19): title "beanies.family", a body in `en`
 * or `zh` keyed by the device's `lang`, and never a name.
 *
 * A closed app cannot reach its string tables, so the server holds this two-language table. Each
 * template is a VERBATIM copy of the client string it mirrors (`src/services/translation/
 * uiStrings.ts` `en`, `zh.ts`), keyed by the client key, so the client drift test
 * (`src/utils/flightStatus/__tests__/pushCopyParity.test.ts`) can compare template to template and
 * sentence to sentence (`copy.ts` `changeSentence(..., updated = false)` / `cancelSentence`).
 *
 * The two `flightChecks.cancel.*` templates keep the client's FIRST sentence only: the client's
 * second sentence ("This flight is now pending.") describes the plan after the device has written
 * the cancellation, which a push sent before that write cannot say. The drift test compares the
 * client template's first sentence.
 *
 * Dates read "13 Dec" and times "8:30am" in both languages, exactly as the client renders them
 * (`formatDateShort` and `formatTime12` are not localised), so a push and the card it leads to
 * say the same thing. Beanie mode is cosmetic and registers `en`.
 */

import { normaliseTerminal } from './schedule.mjs';

export const PUSH_TITLE = 'beanies.family';

export const PUSH_TEMPLATES = Object.freeze({
  en: Object.freeze({
    'flightChecks.terminal': 'Terminal {terminal}',
    'flightChecks.change.leaves': '{flight} now leaves at {time}.',
    'flightChecks.change.leavesTerminal': '{flight} now leaves at {time} from {terminal}.',
    'flightChecks.change.leavesOn': '{flight} now leaves on {date} at {time}.',
    'flightChecks.change.leavesOnTerminal':
      '{flight} now leaves on {date} at {time} from {terminal}.',
    'flightChecks.change.leavesFrom': '{flight} now leaves from {terminal}.',
    'flightChecks.change.lands': '{flight} now lands at {time}.',
    'flightChecks.change.landsOn': '{flight} now lands on {date} at {time}.',
    'flightChecks.cancel.airline': '{airline} cancelled {flight} on {date}.',
    'flightChecks.cancel.noAirline': '{flight} on {date} was cancelled.',
  }),
  zh: Object.freeze({
    'flightChecks.terminal': '{terminal} 号航站楼',
    'flightChecks.change.leaves': '{flight} 现改为 {time} 起飞。',
    'flightChecks.change.leavesTerminal': '{flight} 现改为 {time} 从{terminal}起飞。',
    'flightChecks.change.leavesOn': '{flight} 现改为 {date} {time} 起飞。',
    'flightChecks.change.leavesOnTerminal': '{flight} 现改为 {date} {time} 从{terminal}起飞。',
    'flightChecks.change.leavesFrom': '{flight} 现改为从{terminal}起飞。',
    'flightChecks.change.lands': '{flight} 现改为 {time} 降落。',
    'flightChecks.change.landsOn': '{flight} 现改为 {date} {time} 降落。',
    'flightChecks.cancel.airline': '{airline}已取消 {date} 的 {flight} 航班。',
    'flightChecks.cancel.noAirline': '{date} 的 {flight} 航班已取消。',
  }),
});

const MONTHS_SHORT = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);

/** `{name}` tokens → values; an unknown token stays as written (the client `fillTemplate`). */
function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

/** "13 Dec" (the client `shortDate` → `formatDateShort`); a malformed value is returned as written. */
export function shortDate(ymd) {
  const v = typeof ymd === 'string' ? ymd.trim() : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1] ?? ''}`.trim();
}

/** "6:30pm" / "5pm" (the client `clockTime` → `formatTime12`); a non-time is returned trimmed. */
export function clockTime(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,2}:\d{2}/.test(v)) return v;
  const [h, m] = v.split(':').map(Number);
  const hour = h % 12 || 12;
  const ampm = h < 12 ? 'am' : 'pm';
  return m ? `${hour}:${String(m).padStart(2, '0')}${ampm}` : `${hour}${ampm}`;
}

/** "Terminal 3" from any spelling; '' for none (the client `terminalLabel`). */
function terminalLabel(table, raw) {
  const id = normaliseTerminal(raw);
  return id ? fill(table['flightChecks.terminal'], { terminal: id }) : '';
}

/** The airline's display name without a trailing "(SQ)" code; '' when unknown. */
function airlineDisplay(name) {
  return typeof name === 'string' ? name.replace(/\s*\([A-Z0-9]{2,3}\)\s*$/, '').trim() : '';
}

/**
 * The push body for one device.
 *
 * @param {string} lang   'en' | 'zh'; anything else reads `en`.
 * @param {{ flight: string, date?: string, cancelled: boolean, airline?: string,
 *   now: object, was: object }} change   From `schedule.mjs` `planPushes`: `now` is the
 *   provider's tuple, `was` holds every field that moved (`''` for one the device did not know).
 * @returns {string}
 */
export function pushBody(lang, change) {
  const table = PUSH_TEMPLATES[lang] ?? PUSH_TEMPLATES.en;
  const { flight, now = {}, was = {} } = change;

  if (change.cancelled) {
    const airline = airlineDisplay(change.airline);
    const vars = { airline, flight, date: shortDate(change.date ?? now.departureDate) };
    return fill(
      table[airline ? 'flightChecks.cancel.airline' : 'flightChecks.cancel.noAirline'],
      vars
    );
  }

  // The client `changeSentence` branch order, restated.
  const departureMoved =
    was.departureDate !== undefined ||
    was.departureTime !== undefined ||
    was.terminal !== undefined;
  const terminal = terminalLabel(table, now.terminal);
  if (!departureMoved && (was.arrivalDate !== undefined || was.arrivalTime !== undefined)) {
    return was.arrivalDate !== undefined
      ? fill(table['flightChecks.change.landsOn'], {
          flight,
          date: shortDate(now.arrivalDate),
          time: clockTime(now.arrivalTime),
        })
      : fill(table['flightChecks.change.lands'], { flight, time: clockTime(now.arrivalTime) });
  }
  if (was.departureDate === undefined && was.departureTime === undefined && terminal) {
    return fill(table['flightChecks.change.leavesFrom'], { flight, terminal });
  }
  const dated = was.departureDate !== undefined;
  const key = dated
    ? terminal
      ? 'flightChecks.change.leavesOnTerminal'
      : 'flightChecks.change.leavesOn'
    : terminal
      ? 'flightChecks.change.leavesTerminal'
      : 'flightChecks.change.leaves';
  return fill(table[key], {
    flight,
    time: clockTime(now.departureTime),
    date: shortDate(now.departureDate),
    terminal,
  });
}
