/**
 * Stars and rewards for chores (#148): the pure rules, table-tested.
 *
 * Every star number a surface shows comes from here, and the one unattended writer (the week
 * close in `starStore`) has no rule of its own: every decision is `planWeekClose`. No store, no
 * logger, no clock. It imports the chore rules and never repeats them: dates through
 * `shiftChoreDay` / `choreDayOfWeek` / `choreWeekStart`, a week through `choreWeekRecord`, done and
 * due through `choreWeekTallies`, raw marks through `marksOn`, the retention cutoff through
 * `markCutoffYmd`.
 *
 * Plan: `~/projects/beanies-ops/docs/plans/2026-11-16-stars-and-rewards-for-chores.md`, Approach 2.
 * Sections below: settings, earning and the week, the strip and the arc, gifts, awards, closing.
 *
 * Decisions after the spike (2026-11-16, newer than the plan): (1) a frozen week whose raw mark
 * count is now HIGHER than its record re-settles at any age while the week is still closable
 * (only a bonus difference is limited to the 7-day window), so an early record from a fast clock
 * is always put right; (2) a child-week with nothing due, no done mark and no gift gets no
 * record and is never counted `missed`.
 */
import { isAdultMember } from '@/composables/useMemberInfo';
import {
  AWARD_PRICE_MAX_STARS,
  AWARD_PRICE_MAX_WEEKS,
  CHORE_STARS_MAX,
  CHORE_STARS_MIN,
  STAR_BAR_MAX,
  STAR_BAR_MIN,
  STAR_BAR_STEP,
  STAR_GIFT_MAX,
  STAR_NOTE_MAX,
} from '@/constants/choreStars';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type {
  Chore,
  ChoreAward,
  ChoreMark,
  ChoreRewards,
  ChoreStarGift,
  ChoreWeek,
  FamilyMember,
  Settings,
} from '@/types/models';
import { fillTemplate } from '@/utils/fillTemplate';
import {
  choreDayOfWeek,
  choreWeekRecord,
  choreWeekStart,
  choreWeekTallies,
  indexMarks,
  markCutoffYmd,
  marksOn,
  shiftChoreDay,
  type ChoreDayRecord,
  type ChoreMarkIndex,
  type ChoreWeekRecord,
} from '@/utils/chores';

/** Hotfix kill switch: flip to `false` and ship to stop every device freezing chore weeks. */
export const CHORE_WEEK_CLOSE_ENABLED = true;

/** The most steps a path strip draws; above that each step is several stars. */
export const MAX_PATH_STEPS = 20;

/** A "price this in full weeks" nudge shows when one child needs this many times as long. */
const UNEVEN_RATIO = 1.5;

/** Float slack for full-week shares (a sum of `total / full`). */
const EPS = 1e-9;

/**
 * How many days after a week ends a late BONUS may still re-settle its frozen record: the whole
 * of the following week. After that a bonus difference is counted `late` and not written. A
 * higher mark count is not limited by this window (see `planWeekClose`).
 */
const RESETTLE_DAYS = 7;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v: unknown): v is string =>
  typeof v === 'string' && YMD.test(v) && choreDayOfWeek(v) >= 0;
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// ─── Settings ────────────────────────────────────────────────────────────────

/** The family's rewards settings with every default filled. What every reader gets. */
export interface Rewards {
  on: boolean;
  startedOn?: string;
  weeklyOn: boolean;
  title?: string;
  emoji?: string;
  barPct: number;
}

function clampBar(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return STAR_BAR_MAX;
  const stepped = Math.round(v / STAR_BAR_STEP) * STAR_BAR_STEP;
  return Math.min(STAR_BAR_MAX, Math.max(STAR_BAR_MIN, stepped));
}

/** Is `v` a bar a grown-up may store: 50 to 100 in steps of 5? */
export function isValidBar(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && clampBar(v) === v;
}

/**
 * THE only reader of `Settings.choreRewards`. Absent, `on: false`, settings not loaded, or a
 * malformed value all read as OFF; `barPct` is clamped to 50..100 in steps of 5, so a missing,
 * merged or out-of-range value never reaches the arithmetic.
 */
export function rewardsOf(settings: Pick<Settings, 'choreRewards'> | null | undefined): Rewards {
  const stored: unknown = settings?.choreRewards;
  const r = (stored !== null && typeof stored === 'object' ? stored : {}) as Partial<
    Record<keyof ChoreRewards, unknown>
  >;
  return {
    on: r.on === true,
    startedOn: isYmd(r.startedOn) ? r.startedOn : undefined,
    weeklyOn: r.weeklyOn === true,
    title: typeof r.title === 'string' ? r.title : undefined,
    emoji: typeof r.emoji === 'string' ? r.emoji : undefined,
    barPct: clampBar(r.barPct),
  };
}

/** What a grown-up may change in `Settings.choreRewards` (`startedOn` is stamped, never sent). */
export type ChoreRewardsPatch = Partial<Omit<ChoreRewards, 'startedOn'>>;

/**
 * THE rewards write's next object: `current` (the PROJECTION's stored object, so another
 * grown-up's keys are never written back stale or dropped) with only the patched keys changed;
 * a text trimmed to nothing is removed. `startedOn` is stamped with `todayYmd` on EVERY turn-on
 * from off (absent or `on: false`), so the weeks while it was off are never frozen or counted
 * (`planWeekClose` starts at the week holding `startedOn`); records frozen before a pause stay,
 * and the week the feature was turned off in is frozen AT the turn-off (`starStore.setRewards`
 * runs `planWeekClose` with `includeOpen` first), so a pause never loses that week's stars.
 * Validation is the caller's (the store refuses an invalid patch before it gets here).
 */
export function applyRewardsPatch(
  current: ChoreRewards | null | undefined,
  patch: ChoreRewardsPatch,
  todayYmd: string
): ChoreRewards {
  const base: ChoreRewards =
    current !== null && typeof current === 'object' ? { ...current } : { on: false };
  const next = base as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    next[k] = typeof v === 'string' ? v.trim() || undefined : v;
  }
  if (patch.on === true && !rewardsOf({ choreRewards: current ?? undefined }).on) {
    base.startedOn = todayYmd;
  }
  return base;
}

// ─── Earning ─────────────────────────────────────────────────────────────────

/** What one tick of `chore` earns: `stars ?? 1`, rounded and clamped 1..5; not a number = 1. */
export function starsOf(chore: Pick<Chore, 'stars'>): number {
  const v: unknown = chore.stars ?? 1;
  if (typeof v !== 'number' || !Number.isFinite(v)) return CHORE_STARS_MIN;
  return Math.min(CHORE_STARS_MAX, Math.max(CHORE_STARS_MIN, Math.round(v)));
}

/** Does this member earn stars? A kid: not a pet and not a grown-up (`isAdultMember`). */
export function isStarEarner(member: Pick<FamilyMember, 'isPet' | 'role' | 'ageGroup'>): boolean {
  return !member.isPet && !isAdultMember(member);
}

/** THE frozen week id. Deterministic, so two devices closing the same week write one record. */
export function choreWeekId(memberId: string, weekStart: string): string {
  return `${memberId}:${weekStart}`;
}

/** The seven days of the week that starts on `weekStart`. */
function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftChoreDay(weekStart, i));
}

/** Has the week starting `weekStart` ended on THIS clock (its seventh day is before today)? */
export function isWeekClosed(weekStart: string, todayYmd: string): boolean {
  return isYmd(weekStart) && isYmd(todayYmd) && shiftChoreDay(weekStart, 6) < todayYmd;
}

/**
 * The frozen records a reader may trust: only those whose week has closed on this device's
 * clock. A record written early by a device whose clock is ahead is ignored (the live week is
 * shown and counted instead) until its week ends here, so a week is never counted twice.
 */
export function closedRecords<T extends Pick<ChoreWeek, 'weekStart'>>(
  weeks: readonly T[],
  todayYmd: string
): T[] {
  return weeks.filter((w) => isWeekClosed(w.weekStart, todayYmd));
}

/**
 * The days of the week starting `weekStart` that sit inside ANOTHER frozen week of the same
 * child: the one place the each-day-counts-once rule lives. Empty unless the family changed its
 * week start. A covered day counts nothing and is not due.
 */
export function coveredDays(weekStart: string, frozenWeekStarts: Iterable<string>): Set<string> {
  const days = weekDays(weekStart);
  const out = new Set<string>();
  for (const start of frozenWeekStarts) {
    if (start === weekStart || !isYmd(start)) continue;
    const last = shiftChoreDay(start, 6);
    for (const d of days) if (d >= start && d <= last) out.add(d);
  }
  return out;
}

/** One child's week in stars: the ONE shape every star reader takes, live or frozen. */
export interface WeekStars {
  weekStart: string;
  /** Stars from chores. */
  stars: number;
  /** Net of the week's gifts (may be negative). */
  bonus: number;
  /** `stars + bonus`, never below 0. */
  total: number;
  /** All seven counted days' due stars: what a full week is worth. */
  full: number;
  /** Stars the weekly reward needs; 0 when there is none or nothing is due. */
  bar: number;
  /** Seven numbers: chore stars per day from `weekStart`. */
  days: number[];
  /** Chores done of due, through today. */
  done: number;
  due: number;
  /** Stars of today's chores not yet ticked (0 for a closed week). */
  openToday: number;
  /**
   * Stars due on the counted days AFTER today (0 for a closed week): with `openToday`, all the
   * week can still earn, so the strip can say nothing when the bar is out of reach.
   */
  ahead: number;
  /** The day the weekly reward was reached, while the week is still at or above the bar. */
  hitOn?: string;
}

/** The stars needed for a bar of `barPct` percent of a `full` week (rounded up). */
export function barStars(full: number, barPct: number): number {
  if (!(full > 0)) return 0;
  return Math.ceil((full * barPct) / 100);
}

/**
 * The first day at the end of which the running total reaches `need`. `steps` are each day's
 * added stars, in day order. Shared by the weekly reward's `hitOn` and an award's achieved day,
 * so the two cannot disagree.
 */
function reachedOn(
  steps: readonly (readonly [string, number])[],
  need: number
): string | undefined {
  let running = 0;
  for (const [ymd, add] of steps) {
    running += add;
    if (running >= need) return ymd;
  }
  return undefined;
}

function dayStars(day: ChoreDayRecord, which: 'done' | 'open' | 'all'): number {
  let n = 0;
  for (const block of day.blocks) {
    for (const item of block.chores) {
      if (which === 'all' || (which === 'done') === item.done) n += starsOf(item.chore);
    }
  }
  return n;
}

const EMPTY_DAY = (ymd: string): ChoreDayRecord => ({ ymd, blocks: [], done: 0, total: 0 });

/**
 * A week in stars, LIVE: from its `choreWeekRecord` (the chores as they are now and the marks),
 * the child's own `gifts`, the rewards settings, and the `covered` days (`coveredDays`; required,
 * never defaulted). `done` and `due` run through `todayYmd`; `full` is all seven counted days.
 */
export function openWeek(
  week: ChoreWeekRecord,
  gifts: readonly Pick<ChoreStarGift, 'date' | 'stars'>[],
  rewards: Pick<Rewards, 'weeklyOn' | 'barPct'>,
  covered: ReadonlySet<string>,
  todayYmd: string
): WeekStars {
  const counted = week.days.map((d) => (covered.has(d.ymd) ? EMPTY_DAY(d.ymd) : d));
  const tally = choreWeekTallies([{ days: counted, total: 0 }], todayYmd).beans[0]!;
  const days = counted.map((d) => dayStars(d, 'done'));
  const gifted = counted.map((d) =>
    covered.has(d.ymd)
      ? 0
      : gifts.reduce((n, g) => (g.date === d.ymd ? n + Math.round(finite(g.stars)) : n), 0)
  );
  const full = counted.reduce((n, d) => n + dayStars(d, 'all'), 0);
  const stars = days.reduce((n, s) => n + s, 0);
  const bonus = gifted.reduce((n, s) => n + s, 0);
  const total = Math.max(0, stars + bonus);
  const bar = rewards.weeklyOn ? barStars(full, rewards.barPct) : 0;
  const today = counted.find((d) => d.ymd === todayYmd);
  const hitOn =
    bar > 0 && total >= bar
      ? reachedOn(
          counted.map((d, i) => [d.ymd, days[i]! + gifted[i]!] as const),
          bar
        )
      : undefined;
  return {
    weekStart: counted[0]?.ymd ?? '',
    stars,
    bonus,
    total,
    full,
    bar,
    days,
    done: tally.done,
    due: tally.due,
    openToday: today ? dayStars(today, 'open') : 0,
    ahead: counted.reduce((n, d) => (d.ymd > todayYmd ? n + dayStars(d, 'all') : n), 0),
    hitOn,
  };
}

/** A frozen week as the same `WeekStars` every reader takes (`openToday` 0). */
export function closedWeek(record: ChoreWeek): WeekStars {
  const stars = finite(record.stars);
  const bonus = finite(record.bonus);
  return {
    weekStart: record.weekStart,
    stars,
    bonus,
    total: Math.max(0, stars + bonus),
    full: finite(record.full),
    bar: finite(record.bar),
    days: Array.from({ length: 7 }, (_, i) => finite(record.days?.[i])),
    done: finite(record.done),
    due: finite(record.due),
    openToday: 0,
    ahead: 0,
    hitOn: isYmd(record.hitOn) ? record.hitOn : undefined,
  };
}

/** The weekly reward is reached: there is a bar and the week's total is at or above it. */
export function weeklyAchieved(week: Pick<WeekStars, 'bar' | 'total'>): boolean {
  return week.bar > 0 && week.total >= week.bar;
}

/** Normalised family week start: 0..6, anything else reads as Monday. */
function weekStartDayOf(v: number): number {
  return Number.isInteger(v) && v >= 0 && v <= 6 ? v : 1;
}

/**
 * The week starts a grown-up's week stepper offers, newest first: this week, then up to `max`
 * weeks back. A CLOSED frozen week is its record's seven days (so the weeks before a week-start
 * change stay reachable as they were); anything else follows the current week start. A record
 * for a week not yet ended on this clock is ignored. Never more than `max` back: with mark
 * retention at 35 days, four is the most a live past week can be redrawn for.
 */
export function lookbackWeeks(
  todayYmd: string,
  weekStartDay: number,
  frozenWeekStarts: Iterable<string>,
  max: number = 4
): string[] {
  const wsd = weekStartDayOf(weekStartDay);
  const current = isYmd(todayYmd) ? choreWeekStart(todayYmd, wsd) : null;
  if (current === null) return [];
  const frozen = [...new Set(frozenWeekStarts)].filter((s) => isWeekClosed(s, todayYmd)).sort();
  const out = [current];
  let cursor = current;
  for (let i = 0; i < max; i++) {
    const dayBefore = shiftChoreDay(cursor, -1);
    const record = frozen.find((s) => s <= dayBefore && dayBefore <= shiftChoreDay(s, 6));
    cursor = record ?? choreWeekStart(dayBefore, wsd)!;
    out.push(cursor);
  }
  return out;
}

// ─── The strip and the arc ───────────────────────────────────────────────────

/** What a parent's path strip draws (`StarPathStrip`). Indexes are 0-based steps. */
export interface StarPath {
  /** Stars per step: 1 up to `MAX_PATH_STEPS` stars, more above (the "each step is N" caption). */
  stepSize: number;
  steps: number;
  /** Steps lit: a step lights only when all its stars are earned. The avatar sits on the last. */
  earned: number;
  /** The next steps after `earned` that today's open chores reach (lit softly). */
  next: number;
  /** Steps from this index on are past a full week (drawn thin). `steps` when there are none. */
  thinFrom: number;
  /** The step after which the bar's notch is drawn, or `null` with no weekly reward. */
  barAt: number | null;
  /** The step where a "This Week" award's marker sits, or `null`. */
  awardAt: number | null;
  /** Stars still needed for the bar (0 when reached or there is no bar). */
  toBar: number;
  reached: boolean;
  /** The bar can still be reached this week. False: the strip says nothing about it. */
  reachable: boolean;
}

/**
 * The parent's strip for one child's week (requirement 11): at most `MAX_PATH_STEPS` steps over
 * the longest of a full week, a "This Week" award's price (its marker) and the week's total
 * (bonus stars past a full week are thin steps), a notch at the bar, today's open chores as the
 * next steps, and the exact stars still needed.
 */
export function pathSteps(
  week: WeekStars,
  thisWeekAward?: Pick<ChoreAward, 'unit' | 'price'> | null
): StarPath {
  const awardStars = thisWeekAward ? awardPriceStars(thisWeekAward, week.full) : 0;
  const len = Math.max(week.full, awardStars, week.total);
  const reached = weeklyAchieved(week);
  const toBar = week.bar > 0 ? Math.max(0, week.bar - week.total) : 0;
  const reachable =
    week.bar > 0 && (reached || week.total + week.openToday + week.ahead >= week.bar);
  if (!(len > 0)) {
    return {
      stepSize: 1,
      steps: 0,
      earned: 0,
      next: 0,
      thinFrom: 0,
      barAt: null,
      awardAt: null,
      toBar,
      reached,
      reachable,
    };
  }
  const stepSize = Math.max(1, Math.ceil(len / MAX_PATH_STEPS));
  const steps = Math.ceil(len / stepSize);
  const earned = Math.min(steps, Math.floor(week.total / stepSize));
  const touched = Math.min(steps, Math.ceil((week.total + week.openToday) / stepSize));
  const at = (n: number) => (n > 0 ? Math.min(steps - 1, Math.ceil(n / stepSize) - 1) : null);
  return {
    stepSize,
    steps,
    earned,
    next: Math.max(0, touched - earned),
    thinFrom: Math.min(steps, Math.ceil(week.full / stepSize)),
    barAt: at(week.bar),
    awardAt: at(awardStars),
    toBar,
    reached,
    reachable,
  };
}

/** The arc and count on a child's lane header and day head (requirement 9). */
export interface StarArc {
  /** 0..100. */
  percent: number;
  count: number;
  /**
   * What `count` is, so the count is spoken right (`StarCount`'s `kind`): the week's stars
   * (`week`, toward the weekly reward) or the stars saved toward the nearest saved-up award
   * (`saved`).
   */
  kind: 'week' | 'saved';
  /** The weekly reward's emoji, once achieved. */
  badgeEmoji?: string;
}

/** The fallback badge when the weekly reward has no emoji of its own. */
const DEFAULT_BADGE = '⭐';

/**
 * The arc: with a weekly reward, toward the bar (count = the week's total; the badge when
 * achieved). With none but a saved-up award still to reach, toward that award (count = the real
 * stars saved for it). With neither, `null`: the header draws as it does without stars. A "This
 * Week" award never changes the arc or the badge.
 */
export function arcFor(
  week: WeekStars | null,
  rewards: Pick<Rewards, 'weeklyOn' | 'emoji'>,
  nearestSaved?: Pick<AwardProgress, 'fraction' | 'stars'> | null
): StarArc | null {
  if (week && rewards.weeklyOn && week.bar > 0) {
    const arc: StarArc = {
      percent: Math.min(100, Math.max(0, Math.floor((week.total / week.bar) * 100))),
      count: week.total,
      kind: 'week',
    };
    if (weeklyAchieved(week)) arc.badgeEmoji = rewards.emoji || DEFAULT_BADGE;
    return arc;
  }
  if (nearestSaved) {
    return {
      percent: Math.min(100, Math.max(0, Math.floor(nearestSaved.fraction * 100))),
      count: nearestSaved.stars,
      kind: 'saved',
    };
  }
  return null;
}

// ─── A week's breakdown (the Star Report's Stars by Week) ─────────────────────

/** One day of a week's breakdown, in the week's own order (from its first day). */
export interface BreakdownDay {
  ymd: string;
  /** Stars from chores that day (the week's own `days`, so they add up to its `stars`). */
  stars: number;
  /** Chores done of due that day, or `null` when not known (outside mark retention, or later). */
  chores: { done: number; due: number } | null;
}

/** What made up one child's week: the days, the bonus, and the total, adding up exactly. */
export interface WeekBreakdown {
  days: BreakdownDay[];
  /** Stars from chores: the sum of `days[].stars`. */
  stars: number;
  /** The net bonus (given minus taken away). */
  bonus: number;
  /**
   * The week's bonus entries, oldest first, when the entries still there add up to `bonus`;
   * `null` when only the frozen net is known (draw one net line).
   */
  entries: ChoreStarGift[] | null;
  /** `stars + bonus`, never below 0: exactly the week's `total` (what its bar shows). */
  total: number;
  /** `stars + bonus` was below 0, so the total shows 0 (one plain line says why). */
  floored: boolean;
}

/**
 * THE breakdown of one child's week, for the summary a week's bar opens. The star numbers are the
 * week's own (`WeekStars`, so the frozen record for a closed week and the live week for the open
 * one): the days' stars add up to `stars`, `stars + bonus` floored at 0 is `total`, so the summary
 * always adds up to the bar. `gifts` are the child's gifts (any weeks); the ones on the week's days
 * are listed only when they sum to the week's `bonus` (a gift the record never took in is not
 * shown as if it counted). `record` is the week's chore record (`choreStore.weekFor`, from the
 * marks), read for done-of-due per day only while the week is inside mark retention and only for
 * days up to today; otherwise a day shows its stars alone.
 */
export function weekBreakdown(
  week: WeekStars,
  gifts: readonly ChoreStarGift[],
  record: Pick<ChoreWeekRecord, 'days'> | null,
  todayYmd: string
): WeekBreakdown {
  const ymds = weekDays(week.weekStart);
  const cutoff = markCutoffYmd(todayYmd);
  const countsKnown = !!record && cutoff !== null && week.weekStart >= cutoff;
  const days = ymds.map((ymd, i) => {
    const day = countsKnown ? record!.days.find((d) => d.ymd === ymd) : undefined;
    return {
      ymd,
      stars: finite(week.days[i]),
      chores: day && ymd <= todayYmd ? { done: day.done, due: day.total } : null,
    };
  });
  const stars = days.reduce((n, d) => n + d.stars, 0);
  const bonus = finite(week.bonus);
  const inWeek = gifts
    .filter((g) => ymds.includes(g.date))
    .sort(
      (a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    );
  const listed = inWeek.reduce((n, g) => n + Math.round(finite(g.stars)), 0);
  const sum = stars + bonus;
  return {
    days,
    stars,
    bonus,
    entries: inWeek.length && listed === bonus ? inWeek : null,
    total: Math.max(0, sum),
    floored: sum < 0,
  };
}

// ─── Gifts (bonus and take-back) ─────────────────────────────────────────────

/** A grown-up's bonus or take-back, as the gift modal sends it. */
export interface GiftInput {
  kind: 'bonus' | 'take';
  /** How many stars (always positive; a take-back is stored negative). */
  count: number;
  note?: string;
}

/** Why a gift is refused (`choreStars.error.*`). */
export type GiftRefusal = 'off' | 'invalid' | 'note-required' | 'over-week';

/** Every refusal the star store answers (`choreStars.error.*`). */
export type StarRefusal = GiftRefusal | 'not-adult' | 'not-earner' | 'not-found' | 'week-closed';

/**
 * THE one validation of a bonus or take-back (the modal's inline errors and the store's
 * refusal both read it). `week` is the child's open week. A take-back is always open to a
 * grown-up (greg, 2026-11-16: no family setting) but needs a reason and never moves back more
 * than the child has this week (a week never shows below zero).
 */
export function giftRefusal(
  input: GiftInput,
  week: Pick<WeekStars, 'total'> | null,
  rewards: Pick<Rewards, 'on'>
): GiftRefusal | null {
  if (!rewards.on) return 'off';
  const { count } = input;
  if (!Number.isInteger(count) || count < 1 || count > STAR_GIFT_MAX) return 'invalid';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > STAR_NOTE_MAX) return 'invalid';
  if (input.kind === 'take') {
    if (!note) return 'note-required';
    // Checked against THIS device's view of the week only. Two grown-ups taking back at once
    // can together move back more than the child had, leaving a net bonus below zero that the
    // week's `total` (floored at 0) hides. Accepted residual (greg, 2026-11-16): not fixed.
    if (!week || count > week.total) return 'over-week';
  } else if (input.kind !== 'bonus') {
    return 'invalid';
  }
  return null;
}

// ─── Awards ──────────────────────────────────────────────────────────────────

/** An award as the award form sends it (the store stamps the rest). */
export type AwardDraft = Pick<ChoreAward, 'title' | 'emoji' | 'kind' | 'unit' | 'price'> & {
  repeats?: boolean;
  /** The chosen kids; absent = every kid who earns stars. */
  memberIds?: string[];
};

/** A special reward's stored kids, as a clean list (anything malformed reads as none). */
function storedKids(award: Pick<ChoreAward, 'memberIds'>): string[] {
  const ids: unknown = award.memberIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * THE rule: is this special reward for this child? Absent or empty `memberIds` = every kid who
 * earns stars; otherwise only the kids listed. Every reader goes through it (the store's
 * standings, so the arc, the strip and the Star Report; the drawer's pricing). An id of a member
 * who has left or is no longer a kid simply never matches anyone: ignored, never an error.
 */
export function awardIsFor(award: Pick<ChoreAward, 'memberIds'>, memberId: string): boolean {
  const ids = storedKids(award);
  return ids.length === 0 || ids.includes(memberId);
}

/**
 * The kids a special reward is for, in `earners` order, or `null` when it is for every kid
 * (absent or empty `memberIds`). A list whose kids have all left is `[]`: for nobody now.
 */
export function awardKids(
  award: Pick<ChoreAward, 'memberIds'>,
  earners: readonly string[]
): string[] | null {
  if (storedKids(award).length === 0) return null;
  return earners.filter((id) => awardIsFor(award, id));
}

/**
 * The kids a grown-up chose, as stored: `undefined` for every kid (nothing sent, or every
 * current earner chosen, so a child who joins later is included), the chosen earners in
 * `earners` order otherwise, or `null` (refused) when kids were sent but none of them earns
 * stars.
 */
export function cleanAwardKids(
  memberIds: unknown,
  earners: readonly string[]
): string[] | undefined | null {
  if (memberIds === undefined) return undefined;
  if (!Array.isArray(memberIds)) return null;
  const chosen = new Set(memberIds.filter((id): id is string => typeof id === 'string'));
  const kept = earners.filter((id) => chosen.has(id));
  if (!kept.length) return null;
  return kept.length === earners.length ? undefined : kept;
}

/** One child's progress toward one award. */
export interface AwardProgress {
  /** 0..1. */
  fraction: number;
  /** In the award's own unit (full weeks or stars). */
  have: number;
  need: number;
  /** The day it was reached, while it shows as Achieved (see the rules below). */
  achievedOn?: string;
  /** How many times it has been reached (a repeating award; 0 or 1 otherwise). */
  cycles: number;
  /** The real stars counted in the current count (the plain sum of `total`, for both units). */
  stars: number;
}

/** A week's share of an award: its stars, or how much of a full week (0 with nothing due). */
function awardShare(award: Pick<ChoreAward, 'unit'>, week: WeekStars): number {
  if (award.unit === 'stars') return week.total;
  return week.full > 0 ? week.total / week.full : 0;
}

/** A week's day steps in the award's unit, the week's net bonus counted from its first day. */
function awardDaySteps(award: Pick<ChoreAward, 'unit'>, week: WeekStars): [string, number][] {
  const per = award.unit === 'stars' ? 1 : week.full;
  return week.days.map((n, i) => [
    shiftChoreDay(week.weekStart, i),
    per > 0 ? (n + (i === 0 ? week.bonus : 0)) / per : 0,
  ]);
}

/** The price's unit bound. */
const priceMax = (unit: ChoreAward['unit']) =>
  unit === 'stars' ? AWARD_PRICE_MAX_STARS : AWARD_PRICE_MAX_WEEKS;

/** Is `price` a price a grown-up may store: above 0, a whole number of stars or one decimal of weeks? */
export function isValidPrice(price: unknown, unit: ChoreAward['unit']): price is number {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
  if (price > priceMax(unit)) return false;
  return unit === 'stars'
    ? Number.isInteger(price)
    : Math.abs(Math.round(price * 10) - price * 10) < EPS;
}

/**
 * One child's progress toward `award` over their `weeks` (any order; closed records and the open
 * week; a week with no record is simply absent and adds nothing). The rules, as a parent is told:
 *  - a stars award counts stars (`total`); a full-weeks award adds up how much of a full week
 *    each week was (`total / full`, 0 with nothing due, above 1 with bonus stars);
 *  - "This Week" (`kind: 'week'`) counts only the newest week given; "Saved Up" counts every week
 *    from `award.weekStart` on;
 *  - one time: the first week the running count reaches the price is the achieved week, and later
 *    weeks are not looked at; repeats: the count starts again from zero the week after each
 *    achieved week;
 *  - the achieved day is the first day of that week on which the running count reaches the price,
 *    the week's bonus counted from its first day (exact for chores; to the week for a bonus).
 * The report's "as of a week" figure is the same call with the later weeks left out.
 */
export function awardProgress(
  award: Pick<ChoreAward, 'kind' | 'unit' | 'price' | 'repeats' | 'weekStart'>,
  weeks: readonly WeekStars[]
): AwardProgress {
  const need = finite(award.price) > 0 ? finite(award.price) : 0;
  const counted = weeks
    .filter((w) => isYmd(w.weekStart) && w.weekStart >= award.weekStart)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  const list = award.kind === 'week' ? counted.slice(-1) : counted;
  const repeats = award.kind === 'saved' && award.repeats === true;
  let have = 0;
  let stars = 0;
  let cycles = 0;
  let achievedOn: string | undefined;
  let restart = false;
  for (const week of list) {
    if (need <= 0) break;
    if (restart) {
      have = 0;
      stars = 0;
      achievedOn = undefined;
      restart = false;
    }
    const share = awardShare(award, week);
    if (have + share >= need - EPS) {
      achievedOn =
        reachedOn(awardDaySteps(award, week), need - have - EPS) ??
        shiftChoreDay(week.weekStart, 6);
      have += share;
      stars += week.total;
      cycles++;
      if (!repeats) break;
      restart = true;
      continue;
    }
    have += share;
    stars += week.total;
  }
  const result: AwardProgress = {
    fraction: need > 0 ? Math.min(1, Math.max(0, have / need)) : 0,
    have,
    need,
    cycles,
    stars,
  };
  if (achievedOn) result.achievedOn = achievedOn;
  return result;
}

/** The price in stars for one child today: a full-weeks price times their full week (rounded up). */
export function awardPriceStars(award: Pick<ChoreAward, 'unit' | 'price'>, full: number): number {
  const price = finite(award.price);
  if (award.unit === 'stars') return Math.max(0, Math.round(price));
  return full > 0 ? Math.ceil(price * full - EPS) : 0;
}

/**
 * THE one place an award's progress line is worded ("64 of 160 stars"). A full-weeks award reads
 * in stars too, converted with the child's CURRENT full week (greg, 2026-11-16), so its numbers
 * can shift when the child's chores change. The count never shows above the price.
 */
export function awardProgressLabel(
  award: Pick<ChoreAward, 'unit' | 'price'>,
  progress: Pick<AwardProgress, 'have' | 'need'>,
  currentFull: number,
  t: (key: UIStringKey) => string
): string {
  const stars = award.unit === 'stars';
  const need = stars ? Math.round(progress.need) : awardPriceStars(award, currentFull);
  const raw = stars ? progress.have : progress.have * Math.max(0, currentFull);
  const have = Math.min(need, Math.max(0, Math.floor(raw + EPS)));
  const key: UIStringKey =
    need === 1 ? 'choreStars.award.progress.one' : 'choreStars.award.progress.other';
  return fillTemplate(t(key), { have, need });
}

/** The saved-up award a child is nearest to (highest `fraction`, not achieved), or `null`. */
export function nearestSavedAward<A extends Pick<ChoreAward, 'id' | 'kind'>>(
  awards: readonly A[],
  progressByAward: ReadonlyMap<string, Pick<AwardProgress, 'fraction' | 'achievedOn'>>
): A | null {
  let best: A | null = null;
  let bestFraction = -1;
  for (const award of awards) {
    if (award.kind !== 'saved') continue;
    const p = progressByAward.get(award.id);
    if (!p || p.achievedOn) continue;
    if (p.fraction > bestFraction) {
      best = award;
      bestFraction = p.fraction;
    }
  }
  return best;
}

/** The "price this in full weeks" nudge for a stars-priced award, from each child's full week. */
export interface FairPrice {
  /** One child would need at least `UNEVEN_RATIO` times as long as another. */
  uneven: boolean;
  /** The child who would need longest (smallest full week), and the quickest. */
  slowest?: string;
  fastest?: string;
  /** How many times as long the slowest needs (one decimal; 1 when even or unknown). */
  ratio: number;
  /** The same price in full weeks at the family's average full week (one decimal), or `null`. */
  suggestedWeeks: number | null;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * Is a stars price fair across the children (`fulls`: member id -> their full week in stars)?
 * A full-weeks award follows each child's own week, so it is always even. Children with nothing
 * due are left out.
 */
export function fairPrice(
  award: Pick<ChoreAward, 'unit' | 'price'>,
  fulls: Readonly<Record<string, number>>
): FairPrice {
  const price = finite(award.price);
  if (award.unit === 'weeks') {
    return { uneven: false, ratio: 1, suggestedWeeks: price > 0 ? price : null };
  }
  const known = Object.entries(fulls).filter(([, f]) => f > 0);
  if (!known.length || !(price > 0)) return { uneven: false, ratio: 1, suggestedWeeks: null };
  let slowest = known[0]!;
  let fastest = known[0]!;
  for (const entry of known) {
    if (entry[1] < slowest[1]) slowest = entry;
    if (entry[1] > fastest[1]) fastest = entry;
  }
  const mean = known.reduce((n, [, f]) => n + f, 0) / known.length;
  const ratio = oneDecimal(fastest[1] / slowest[1]);
  const fair: FairPrice = {
    uneven: ratio >= UNEVEN_RATIO,
    ratio,
    suggestedWeeks: Math.max(0.1, oneDecimal(price / mean)),
  };
  if (known.length > 1) {
    fair.slowest = slowest[0];
    fair.fastest = fastest[0];
  }
  return fair;
}

/**
 * About how many real weeks a price of `priceWeeks` full weeks takes a child who reaches the bar
 * each week (`barPct` percent of a full week), rounded up. 0 for no price.
 */
export function weeksEstimate(priceWeeks: number, barPct: number): number {
  if (!(finite(priceWeeks) > 0)) return 0;
  return Math.ceil((priceWeeks * 100) / clampBar(barPct) - EPS);
}

/** Why a typed price is refused (the award form's inline error). */
export type PriceRefusal = 'empty' | 'invalid' | 'too-big';

/**
 * A typed price: full weeks take one decimal ("1.5"), stars a whole number; both above 0.
 * Answers the number, or why it is refused.
 */
export function parsePrice(text: string, unit: ChoreAward['unit']): number | PriceRefusal {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 'empty';
  const shape = unit === 'stars' ? /^\d+$/ : /^\d+(\.\d)?$/;
  if (!shape.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  if (!(value > 0)) return 'invalid';
  if (value > priceMax(unit)) return 'too-big';
  return value;
}

// ─── Closing ─────────────────────────────────────────────────────────────────

/** A frozen week as the close writes it; the repository stamps `createdAt` / `updatedAt`. */
export type ChoreWeekDraft = Omit<ChoreWeek, 'createdAt' | 'updatedAt'>;

/** Everything `planWeekClose` reads. The store passes its arrays, then the projection's. */
export interface WeekCloseInput {
  todayYmd: string;
  /** 0 = Sunday, 1 = Monday; anything else reads as Monday. */
  weekStartDay: number;
  rewards: Pick<Rewards, 'on' | 'startedOn' | 'weeklyOn' | 'barPct'>;
  /** Member ids that earn stars (`isStarEarner`, living). */
  earners: readonly string[];
  /** Living (non-pet) member ids: a chore's assignees are resolved against them. */
  living: ReadonlySet<string>;
  chores: readonly Chore[];
  marks: readonly ChoreMark[];
  gifts: readonly ChoreStarGift[];
  weeks: readonly ChoreWeek[];
  /**
   * Also record each earner's OPEN week as it stands now: the turn-off (`starStore.setRewards`
   * on to off), so the week a pause starts in is never lost. Off by default (the close).
   */
  includeOpen?: boolean;
}

/** What to write, and the counts the store logs. */
export interface WeekClosePlan {
  write: ChoreWeekDraft[];
  /** Records built for a closed week that had none. */
  created: number;
  /** Records rebuilt within the re-settle window (a late tick or bonus). */
  resettled: number;
  /** Records that differ after the window; left as they are. */
  late: number;
  /** Records whose week now has FEWER raw marks; never written, the frozen week keeps them. */
  fewer: number;
  /** Weeks that left mark retention in the last 7 days with no record. */
  missed: number;
}

const nothing = (): WeekClosePlan => ({
  write: [],
  created: 0,
  resettled: 0,
  late: 0,
  fewer: 0,
  missed: 0,
});

/**
 * The child's RAW `done` marks on the week's counted days: every mark, whether or not its chore
 * still exists or is still theirs, so a chore deleted or reassigned never changes it.
 */
function rawMarks(index: ChoreMarkIndex, memberId: string, days: readonly string[]): number {
  return days.reduce((n, d) => n + marksOn(index, memberId, d).done.size, 0);
}

function draftOf(memberId: string, week: WeekStars, marks: number): ChoreWeekDraft {
  const draft: ChoreWeekDraft = {
    id: choreWeekId(memberId, week.weekStart),
    memberId,
    weekStart: week.weekStart,
    done: week.done,
    due: week.due,
    stars: week.stars,
    bonus: week.bonus,
    full: week.full,
    bar: week.bar,
    days: [...week.days],
    marks,
  };
  if (week.hitOn) draft.hitOn = week.hitOn;
  return draft;
}

/**
 * Which frozen weeks to write, and why (plan Approach 2, Closing). For each earner, each CLOSED
 * week (on this clock) whose first day is on or after `markCutoffYmd(todayYmd)` (so all its marks
 * are still kept) and whose LAST day is on or after `rewards.startedOn` (so the week the feature
 * was turned on is frozen whole; it was shown live from its first day). `startedOn` is the LAST
 * turn-on (`applyRewardsPatch`), so the weeks of a pause get no record, and the records frozen
 * before the pause are left as they are (never in `closable` again, still read and counted):
 *  - no record: build it (`created`); a week with no day left after `coveredDays` is skipped;
 *  - a record, the fresh raw mark count LOWER: never written, whatever the bonus says (`fewer`).
 *    A wrong clock or an early sweep must never shrink a frozen week; an offline untick that
 *    syncs after the close is given up instead;
 *  - a record whose fresh raw mark count is HIGHER: built again (`resettled`) at any age, while
 *    the week is still closable;
 *  - a record whose `bonus` (only) differs, within `RESETTLE_DAYS` of the week's end: built
 *    again (`resettled`); after that, counted (`late`) and left;
 *  - no record, and the week has nothing due, no done mark and no gift: not written.
 * Only `marks` and `bonus` are compared, so a chore edit or delete alone never rewrites a week,
 * and two devices holding the same marks always agree. A record is trusted only once its week
 * has closed here (`closedRecords`): one written early by a fast clock is replaced by the next
 * close that sees more marks.
 *
 * Also counted: a week that left retention in the last 7 days with no record (`missed`), unless
 * that week had nothing in it.
 *
 * `includeOpen` (the turn-off): the open week is planned too, by the same rules against its own
 * early record if it has one, and only when something was earned in it. Its record is written
 * before the week ends; readers ignore it until the week closes here (`closedRecords`), and the
 * close after a turn-on in the same week re-settles it when it sees more marks, so nothing is
 * counted twice. An untick after such a re-turn-on leaves the higher count (the `fewer` rule).
 */
export function planWeekClose(input: WeekCloseInput): WeekClosePlan {
  const { todayYmd, rewards } = input;
  if (!rewards.on || !isYmd(todayYmd)) return nothing();
  const cutoff = markCutoffYmd(todayYmd);
  const wsd = weekStartDayOf(input.weekStartDay);
  const thisWeek = choreWeekStart(todayYmd, wsd);
  if (cutoff === null || thisWeek === null) return nothing();
  const startedOn = isYmd(rewards.startedOn) ? rewards.startedOn : null;
  const startedBy = (weekStart: string) =>
    startedOn === null || shiftChoreDay(weekStart, 6) >= startedOn;

  // The closed weeks still inside retention, newest first, and the one that just left it.
  const closable: string[] = [];
  let ws = shiftChoreDay(thisWeek, -7);
  while (ws >= cutoff) {
    if (startedBy(ws)) closable.push(ws);
    ws = shiftChoreDay(ws, -7);
  }
  const justLeft = startedBy(ws) ? ws : null;
  // The turn-off's open week first (it is always on or after `startedOn`).
  if (input.includeOpen) closable.unshift(thisWeek);

  const index = indexMarks(input.marks);
  const frozen = closedRecords(input.weeks, todayYmd);
  const plan = nothing();

  for (const memberId of input.earners) {
    if (!input.living.has(memberId)) continue;
    const mine = frozen.filter((w) => w.memberId === memberId);
    const byStart = new Map(mine.map((w) => [w.weekStart, w]));
    const starts = mine.map((w) => w.weekStart);
    const gifts = input.gifts.filter((g) => g.memberId === memberId);
    // The open week's own early record (an earlier turn-off this week): readers ignore it while
    // the week is open, but the same rules below decide whether it is written again.
    const early = input.includeOpen
      ? input.weeks.find((w) => w.memberId === memberId && w.weekStart === thisWeek)
      : undefined;

    for (const weekStart of closable) {
      const isOpen = weekStart === thisWeek;
      const covered = coveredDays(weekStart, starts);
      if (covered.size >= 7) continue;
      const record = choreWeekRecord(input.chores, index, memberId, weekStart, wsd, input.living);
      const fresh = openWeek(record, gifts, rewards, covered, todayYmd);
      const counted = weekDays(weekStart).filter((d) => !covered.has(d));
      const marks = rawMarks(index, memberId, counted);
      const existing = isOpen ? early : byStart.get(weekStart);
      if (!existing) {
        // Nothing due, no done mark and no gift: nothing to keep (readers add nothing for a
        // missing week), so no record is written. The open week at a turn-off is recorded only
        // when something was earned in it (a done mark or a gift).
        if (isEmptyWeek(fresh, marks, gifts, covered, weekStart)) continue;
        if (isOpen && marks === 0 && !gifts.some((g) => counted.includes(g.date))) continue;
        plan.write.push(draftOf(memberId, fresh, marks));
        plan.created++;
        continue;
      }
      const storedMarks = finite(existing.marks);
      if (marks < storedMarks) {
        plan.fewer++;
        continue;
      }
      if (marks === storedMarks && fresh.bonus === finite(existing.bonus)) continue;
      // MORE raw marks than the record re-settles at any age inside retention: a record written
      // early by a fast clock is put right even when no right-clock device closes within a
      // week, and a frozen week's marks only ever grow, so this converges. Any other difference
      // (the bonus) re-settles only within the window.
      if (marks > storedMarks || todayYmd <= shiftChoreDay(weekStart, 6 + RESETTLE_DAYS)) {
        plan.write.push(draftOf(memberId, fresh, marks));
        plan.resettled++;
      } else {
        plan.late++;
      }
    }

    if (justLeft !== null && !byStart.has(justLeft)) {
      const covered = coveredDays(justLeft, starts);
      if (covered.size < 7) {
        const record = choreWeekRecord(input.chores, index, memberId, justLeft, wsd, input.living);
        const fresh = openWeek(record, gifts, rewards, covered, todayYmd);
        const marks = rawMarks(
          index,
          memberId,
          weekDays(justLeft).filter((d) => !covered.has(d))
        );
        // A week with nothing in it was not missed: there was nothing to record.
        if (!isEmptyWeek(fresh, marks, gifts, covered, justLeft)) plan.missed++;
      }
    }
  }
  return plan;
}

/**
 * A child-week with nothing due, no done mark and no gift on its counted days. It is never
 * written (and never counted `missed`): every reader already reads a missing week as adding
 * nothing.
 */
function isEmptyWeek(
  week: WeekStars,
  marks: number,
  gifts: readonly Pick<ChoreStarGift, 'date'>[],
  covered: ReadonlySet<string>,
  weekStart: string
): boolean {
  if (week.full > 0 || marks > 0) return false;
  const days = new Set(weekDays(weekStart).filter((d) => !covered.has(d)));
  return !gifts.some((g) => days.has(g.date));
}
