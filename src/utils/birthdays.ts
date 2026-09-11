/**
 * Family birthdays as calendar occurrences — DERIVED, never stored.
 *
 * A birthday is a fact about a person, not an event somebody scheduled, so it
 * follows the shape `holidayStore` and `vacationStore` already use: occurrences
 * computed for a date window and rendered read-only. Nothing is written to the
 * `.beanpod`, which buys three things that a stored yearly activity per member
 * could not:
 *
 *  - it is always right. Correct a mistyped date of birth and every year on the
 *    calendar corrects with it, past and future, with no migration;
 *  - it cannot duplicate. There is no row to create twice, so the "added a
 *    member on two devices" case has nothing to reconcile;
 *  - existing families get it with no backfill.
 *
 * The cost is that these are not editable and are never pushed to Google
 * (greg, 2026-09-11: most people already have birthdays in Google via Contacts,
 * and pushing ours would give a lot of families two of everything on the day).
 * A birthday PARTY is a different thing — a real activity, with a time and a
 * place — and is still created by hand.
 *
 * Pure. No stores, no `Date.now()`: the caller passes the window.
 */
import type { DateOfBirth, FamilyMember, UUID } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { toDateInputValue } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { getOrdinalSuffix } from '@/utils/format';

/** One person's birthday landing on one date inside the requested window. */
export interface BirthdayOccurrence {
  /** `YYYY-MM-DD` within the window. */
  date: string;
  memberId: UUID;
  name: string;
  /**
   * The age reached on this date. ABSENT when the birth YEAR is unknown —
   * `DateOfBirth.year` is optional and plenty of families only record the day
   * and month, so the label has to work without it rather than print "NaN".
   */
  age?: number;
  isPet: boolean;
}

/**
 * The next annual occurrence (`YYYY-MM-DD`) of `month`/`day` on or after
 * `todayYmd`.
 *
 * THE one implementation. There were two — `helpfulHints`' `nextAnnualDate` and
 * a private `getNextBirthday` inside `MilestonesCard` — and this module would
 * have made a third of the same six lines.
 *
 * Uses the local-`Date` constructor for overflow correctness: 29 February in a
 * non-leap year rolls to 1 March, which is the convention the rest of the app
 * already follows.
 */
export function nextAnnualDate(todayYmd: string, month: number, day: number): string {
  const thisYear = Number(todayYmd.slice(0, 4));
  const at = (year: number) => toDateInputValue(new Date(year, month - 1, day));
  const candidate = at(thisYear);
  return candidate >= todayYmd ? candidate : at(thisYear + 1);
}

/** That member's birthday in a given calendar year, as `YYYY-MM-DD`. */
function birthdayInYear(dob: DateOfBirth, year: number): string {
  return toDateInputValue(new Date(year, dob.month - 1, dob.day));
}

/**
 * Every family birthday falling inside `[startYmd, endYmd]`, inclusive.
 *
 * Spans more than one calendar year deliberately: the month grid runs six weeks
 * and the month stream renders five months, so a December window routinely
 * reaches into January and a birthday on the far side of the boundary must
 * still appear.
 *
 * Pets are included. The Nook's milestones card already shows them, so leaving
 * them off the calendar would have made the same app disagree with itself about
 * whether the dog has a birthday (greg, 2026-09-11).
 */
export function birthdaysInRange(
  members: FamilyMember[],
  startYmd: string,
  endYmd: string
): BirthdayOccurrence[] {
  if (!startYmd || !endYmd || endYmd < startYmd) return [];

  const firstYear = Number(startYmd.slice(0, 4));
  const lastYear = Number(endYmd.slice(0, 4));
  if (!Number.isFinite(firstYear) || !Number.isFinite(lastYear)) return [];

  const out: BirthdayOccurrence[] = [];
  for (const member of members) {
    const dob = member.dateOfBirth;
    // Not every member has one, and it is optional by design — a family should
    // never be blocked from adding someone because they cannot remember a date.
    if (!dob) continue;
    if (!Number.isInteger(dob.month) || !Number.isInteger(dob.day)) continue;
    if (dob.month < 1 || dob.month > 12 || dob.day < 1 || dob.day > 31) continue;

    for (let year = firstYear; year <= lastYear; year++) {
      const date = birthdayInYear(dob, year);
      if (date < startYmd || date > endYmd) continue;
      out.push({
        date,
        memberId: member.id,
        name: member.name,
        // A birth year in the future, or one that would make somebody negative
        // years old, is bad data rather than a label worth printing.
        ...(dob.year && year - dob.year >= 0 ? { age: year - dob.year } : {}),
        isPet: member.isPet === true,
      });
    }
  }

  // Stable order so two members sharing a date do not swap places between
  // renders. Date first, then name, then id as the final tie-break.
  out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.name.localeCompare(b.name) ||
      a.memberId.localeCompare(b.memberId)
  );
  return out;
}

/** Group occurrences by date, the shape every calendar cell wants. */
export function birthdaysByDate(
  occurrences: BirthdayOccurrence[]
): Map<string, BirthdayOccurrence[]> {
  const map = new Map<string, BirthdayOccurrence[]>();
  for (const o of occurrences) {
    const list = map.get(o.date);
    if (list) list.push(o);
    else map.set(o.date, [o]);
  }
  return map;
}

/**
 * "Joey's 7th birthday", or "Joey's birthday" when the birth YEAR is unknown.
 *
 * THE one implementation, shared by the planner's chip and the beanie wall's
 * all-day band. Takes `t` rather than reaching for the store, the same way
 * `describeRule` does, so it stays pure and testable — and so the two surfaces
 * cannot drift into wording the family sees differently in the kitchen and on
 * their phone.
 */
export function birthdayLabel(
  birthday: Pick<BirthdayOccurrence, 'name' | 'age'>,
  t: (key: UIStringKey) => string
): string {
  return birthday.age === undefined
    ? fillTemplate(t('planner.birthday.noAge'), { name: birthday.name })
    : fillTemplate(t('planner.birthday.withAge'), {
        name: birthday.name,
        age: getOrdinalSuffix(birthday.age),
      });
}

/**
 * Should this birthday show under the current person filter?
 *
 * ⚠️ PETS ALWAYS PASS, and that is the whole reason this is a named function
 * rather than an inline `isMemberSelected(b.memberId)` at three call sites.
 * `memberFilterStore` is scoped to HUMANS by design — pets are excluded from the
 * filter universe, so `isMemberSelected(aPetId)` is `false` the moment a filter
 * is active. Filtering naively would therefore have hidden every pet birthday
 * whenever anyone narrowed the planner to one person, silently reversing the
 * decision that pets get birthdays at all (greg, 2026-09-11).
 *
 * `isMemberVisible` is null when no filter is active, which is also the honest
 * default for a surface that has no person filter.
 */
export function birthdayPassesFilter(
  birthday: Pick<BirthdayOccurrence, 'memberId' | 'isPet'>,
  isMemberVisible: ((memberId: string) => boolean) | null
): boolean {
  if (!isMemberVisible) return true;
  if (birthday.isPet) return true;
  return isMemberVisible(birthday.memberId);
}
