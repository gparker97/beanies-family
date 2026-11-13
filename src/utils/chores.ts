/**
 * The choreboard's rules (#146), pure and table-tested.
 *
 * No store, no logger, no `Date` parsing of a bare `YYYY-MM-DD`: every date here is a string
 * compared as a string, and the one weekday / day-shift computation goes through `Date.UTC`
 * on the parsed parts, so a chore's day never depends on the device's time zone offset.
 *
 * "Done today" is NEVER stored on a chore. It is derived from `ChoreMark`s keyed by date, so
 * nothing is written at midnight and no device has to be open for a new day to start.
 *
 * ONE READ MODEL: `beanChoreDay` is what the page, the wall, the briefing and the widget all
 * consume, so they cannot drift. `indexMarks` is the ONLY reader of the raw marks array.
 */
import type {
  Chore,
  ChoreBlock,
  ChoreBlockStarts,
  ChoreMark,
  ChoreMarkKind,
  Settings,
} from '@/types/models';

/** The four blocks, in the order every surface lists them. */
export const CHORE_BLOCKS: readonly ChoreBlock[] = ['morning', 'afternoon', 'evening', 'anytime'];

/** The defaults, applied by `blockStarts` and never stored. */
export const DEFAULT_CHORE_BLOCK_STARTS: Readonly<ChoreBlockStarts> = Object.freeze({
  morning: '06:00',
  afternoon: '12:00',
  evening: '17:00',
});

/**
 * How long a mark is kept. Nothing in this feature reads past the current week; #148 (stars
 * and rewards) raises this when it has a reader.
 */
export const CHORE_MARK_KEEP_DAYS = 35;

/**
 * Ceiling on one retention sweep, so a long absence cannot produce one unbounded batch; the
 * remainder goes on the next run. A family of three kids with ten chores writes about 40 marks
 * a day, so this clears well over a week of backlog per run.
 */
export const MAX_MARK_SWEEP_DELETES = 500;

/** Hotfix kill switch: flip to `false` and ship to stop every device deleting chore marks. */
export const CHORE_MARK_SWEEP_ENABLED = true;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Is `v` one of the four blocks? */
export function isChoreBlock(v: unknown): v is ChoreBlock {
  return typeof v === 'string' && (CHORE_BLOCKS as readonly string[]).includes(v);
}

/**
 * A chore's block as every reader sees it. An unknown value (a future build's block, a bad
 * merge) reads as `anytime`, so the chore stays visible and tickable rather than vanishing.
 */
export function choreBlockOf(chore: Pick<Chore, 'block'>): ChoreBlock {
  return isChoreBlock(chore.block) ? chore.block : 'anytime';
}

/** Are these three valid `HH:mm` hours in strict order (morning < afternoon < evening)? */
export function isValidBlockStarts(v: unknown): v is ChoreBlockStarts {
  if (v === null || typeof v !== 'object') return false;
  const { morning, afternoon, evening } = v as Record<string, unknown>;
  if (typeof morning !== 'string' || typeof afternoon !== 'string' || typeof evening !== 'string')
    return false;
  if (!HHMM.test(morning) || !HHMM.test(afternoon) || !HHMM.test(evening)) return false;
  return morning < afternoon && afternoon < evening;
}

/**
 * The family's block start hours. A malformed or unordered stored value falls back to the
 * defaults AS A WHOLE (never key by key, which could produce an unordered mix), so
 * `currentBlock` is total.
 */
export function blockStarts(
  settings: Pick<Settings, 'choreBlockStarts'> | null | undefined
): ChoreBlockStarts {
  const stored = settings?.choreBlockStarts;
  if (isValidBlockStarts(stored)) {
    return { morning: stored.morning, afternoon: stored.afternoon, evening: stored.evening };
  }
  return { ...DEFAULT_CHORE_BLOCK_STARTS };
}

/**
 * The timed block happening at `hhmm`. Before Morning's start it is still Morning (there is no
 * night block), and Evening runs to midnight. Never `anytime`.
 */
export function currentBlock(hhmm: string, starts: ChoreBlockStarts): ChoreBlock {
  if (hhmm < starts.afternoon) return 'morning';
  if (hhmm < starts.evening) return 'afternoon';
  return 'evening';
}

/**
 * Has `block`'s window passed at `hhmm`? The only source of "missed". Evening never ends (no
 * cut-off before midnight) and Anytime has no window.
 */
export function blockEnded(block: ChoreBlock, hhmm: string, starts: ChoreBlockStarts): boolean {
  if (block === 'morning') return hhmm >= starts.afternoon;
  if (block === 'afternoon') return hhmm >= starts.evening;
  return false;
}

/** `YYYY-MM-DD` → its parts, or `null` when it is not that shape. */
function ymdParts(ymd: string): [number, number, number] | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Weekday of a `YYYY-MM-DD` (0 = Sunday), or -1 when it is not one. Time-zone free. */
export function choreDayOfWeek(ymd: string): number {
  const p = ymdParts(ymd);
  if (!p) return -1;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

/** `ymd` shifted by `days`, as a `YYYY-MM-DD`. Time-zone free (UTC calendar arithmetic). */
export function shiftChoreDay(ymd: string, days: number): string {
  const p = ymdParts(ymd);
  if (!p) return ymd;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  const mm = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getUTCDate()}`.padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Monday to Friday (0 = Sunday): the School Days shortcut and the school-morning set. */
export const SCHOOL_DAYS: readonly number[] = [1, 2, 3, 4, 5];
/** Saturday and Sunday: the Weekends shortcut. */
export const WEEKEND_DAYS: readonly number[] = [0, 6];

/** How a chore's weekdays read: every day, one of the two shortcuts, or some other days. */
export type ChoreDaysKind = 'every' | 'school' | 'weekends' | 'some';

/**
 * The ONE weekday classification, shared by the chore form's day shortcuts and the Add Chores
 * sheet's quiet days tag. Empty, absent or all seven days is every day; order never matters.
 */
export function choreDaysKind(days: readonly number[] | undefined): ChoreDaysKind {
  const d = [...new Set(days ?? [])];
  if (d.length === 0 || d.length === 7) return 'every';
  const same = (want: readonly number[]) =>
    d.length === want.length && d.every((x) => want.includes(x));
  if (same(SCHOOL_DAYS)) return 'school';
  if (same(WEEKEND_DAYS)) return 'weekends';
  return 'some';
}

/**
 * The ONE duplicate rule for chores: the same title (trimmed, any case) in the same block. Two
 * chores with equal keys are "the same chore" to the Add Chores list, `addChores` and
 * `copyChores` alike.
 */
export function choreDupKey(title: string, block: ChoreBlock): string {
  return `${block}|${title.trim().toLocaleLowerCase()}`;
}

/** Does `chore` happen on `ymd`? Absent or empty `days` = every day. */
export function choreOccursOn(chore: Pick<Chore, 'days'>, ymd: string): boolean {
  if (!chore.days?.length) return true;
  return chore.days.includes(choreDayOfWeek(ymd));
}

/** `living` resolved: the chore's assignees who are still family members. */
export function livingAssignees(
  chore: Pick<Chore, 'assigneeIds'>,
  living: ReadonlySet<string>
): string[] {
  return (chore.assigneeIds ?? []).filter((id) => living.has(id));
}

/** Chores with no living assignee: the grown-ups' "No one's" group, to re-assign or delete. */
export function orphanChores(chores: readonly Chore[], living: ReadonlySet<string>): Chore[] {
  return sortChores(chores.filter((c) => livingAssignees(c, living).length === 0));
}

/** The one chore order: `sortOrder`, then creation, then id (stable across devices). */
export function sortChores(chores: readonly Chore[]): Chore[] {
  return [...chores].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
      a.id.localeCompare(b.id)
  );
}

/**
 * A bean's chores due on `ymd`, grouped by block, each group in chore order. `living` resolves
 * assignees against the members still in the family: a removed member has no chores.
 */
export function choresFor(
  chores: readonly Chore[],
  memberId: string,
  ymd: string,
  living?: ReadonlySet<string>
): Map<ChoreBlock, Chore[]> {
  const out = new Map<ChoreBlock, Chore[]>();
  if (living && !living.has(memberId)) return out;
  const mine = sortChores(
    chores.filter((c) => (c.assigneeIds ?? []).includes(memberId) && choreOccursOn(c, ymd))
  );
  for (const chore of mine) {
    const block = choreBlockOf(chore);
    const group = out.get(block);
    if (group) group.push(chore);
    else out.set(block, [chore]);
  }
  return out;
}

/** THE mark id. Deterministic, so the same fact written on two devices is one record. */
export function choreMarkId(
  kind: ChoreMarkKind,
  memberId: string,
  ymd: string,
  ref: string
): string {
  return `${kind}:${memberId}:${ymd}:${ref}`;
}

/** One bean's marks on one day. */
export interface ChoreDayMarks {
  /** Chore ids with a `done` mark. May include chores since deleted. */
  done: ReadonlySet<string>;
  /** Blocks whose celebration has played. */
  celebrated: ReadonlySet<string>;
}

/** member id → date → that day's marks. Build it with `indexMarks`. */
export type ChoreMarkIndex = ReadonlyMap<string, ReadonlyMap<string, ChoreDayMarks>>;

const NO_MARKS: ChoreDayMarks = { done: new Set(), celebrated: new Set() };

/**
 * One pass over the raw marks into a lookup by member and date. The ONLY reader of the raw
 * array. A mark of an unknown kind (a future build's) is ignored.
 */
export function indexMarks(marks: readonly ChoreMark[]): ChoreMarkIndex {
  const index = new Map<string, Map<string, { done: Set<string>; celebrated: Set<string> }>>();
  for (const m of marks) {
    if (m.kind !== 'done' && m.kind !== 'celebrated') continue;
    let byDate = index.get(m.memberId);
    if (!byDate) {
      byDate = new Map();
      index.set(m.memberId, byDate);
    }
    let day = byDate.get(m.date);
    if (!day) {
      day = { done: new Set(), celebrated: new Set() };
      byDate.set(m.date, day);
    }
    day[m.kind].add(m.ref);
  }
  return index;
}

/** A bean's marks on `ymd`, empty when there are none. */
export function marksOn(index: ChoreMarkIndex, memberId: string, ymd: string): ChoreDayMarks {
  return index.get(memberId)?.get(ymd) ?? NO_MARKS;
}

/** "Now", as every chore surface reads it: the device-local day and minute. */
export interface ChoreClock {
  ymd: string;
  hhmm: string;
}

/**
 * Do two clocks give the same chore state? `beanChoreDay` reads the minute only through
 * `currentBlock` (`isNow`; `ended` is "the current block is later than this one"), so two
 * clocks on the same day in the same current block produce an identical day. The store keys its
 * one memoized clock on this, so readers re-run at a block boundary, never every minute.
 */
export function sameChoreMoment(a: ChoreClock, b: ChoreClock, starts: ChoreBlockStarts): boolean {
  return a.ymd === b.ymd && currentBlock(a.hhmm, starts) === currentBlock(b.hhmm, starts);
}

/** Why a chore action was refused: the `detail` of the store's `edit-refused` event. */
export type ChoreRefusal =
  'not-adult' | 'not-yours' | 'not-assigned' | 'not-today' | 'not-found' | 'bad-hours' | 'invalid';

/**
 * A tick the chore store REFUSED (a guard failed before any write). The store has already
 * toasted it and logged `edit-refused`; nothing broke, so a caller must not report it again.
 */
export interface ChoreTickRefused {
  action: 'refused';
  detail: ChoreRefusal;
}

/** Is this tick answer a refusal the store has already told the family about? */
export function isChoreRefusal(value: unknown): value is ChoreTickRefused {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { action?: unknown }).action === 'refused'
  );
}

/** One chore in a bean's day. */
export interface ChoreDayItem {
  chore: Chore;
  done: boolean;
}

/** One block of a bean's day. */
export interface ChoreDayBlock {
  block: ChoreBlock;
  /** The bean's chores due today in this block, in chore order. */
  chores: ChoreDayItem[];
  /** Chores in this block with a `done` mark (never a count of marks). */
  done: number;
  total: number;
  /** Every chore done. False for a block with no chores. */
  allDone: boolean;
  /** The block's once-only celebration has played today. */
  celebrated: boolean;
  /** The timed block happening now. Never true for Anytime. */
  isNow: boolean;
  /** The block's window has passed. The only source of "missed". */
  ended: boolean;
}

/** A bean's chore day: the ONE shape every surface reads. */
export interface BeanChoreDay {
  /** All four blocks, in `CHORE_BLOCKS` order, empty ones included. */
  blocks: ChoreDayBlock[];
  /** Chores still to do today, across every block. */
  left: number;
}

/**
 * A bean's chore day at `clock`. The mid-day rules (plan §8) live here and nowhere else:
 *  - `done` counts CURRENT chores that have a mark, never marks, so a chore re-assigned, moved,
 *    re-dayed or deleted cannot make done exceed total or hold a block open;
 *  - `allDone` is false when a block has no chores;
 *  - a block that becomes complete without a tick (a delete, a move) is simply `allDone`; the
 *    store writes no `celebrated` mark for it (`completesBlock` is the tick path's question);
 *  - a chore added to an already celebrated block re-opens it (`allDone` false, `celebrated`
 *    still true, so finishing it again is banner only);
 *  - changing the hours changes only `isNow` and `ended`.
 */
export function beanChoreDay(
  chores: readonly Chore[],
  index: ChoreMarkIndex,
  memberId: string,
  clock: ChoreClock,
  starts: ChoreBlockStarts,
  living?: ReadonlySet<string>
): BeanChoreDay {
  const grouped = choresFor(chores, memberId, clock.ymd, living);
  const marks = marksOn(index, memberId, clock.ymd);
  const now = currentBlock(clock.hhmm, starts);
  let left = 0;
  const blocks = CHORE_BLOCKS.map((block): ChoreDayBlock => {
    const items = (grouped.get(block) ?? []).map((chore) => ({
      chore,
      done: marks.done.has(chore.id),
    }));
    const done = items.filter((i) => i.done).length;
    const total = items.length;
    left += total - done;
    return {
      block,
      chores: items,
      done,
      total,
      allDone: total > 0 && done === total,
      celebrated: marks.celebrated.has(block),
      isNow: block !== 'anytime' && block === now,
      ended: blockEnded(block, clock.hhmm, starts),
    };
  });
  return { blocks, left };
}

/**
 * Where a block sits in the ONE display order every surface draws a bean's day in: the block
 * happening now (0), then Anytime, open all day (1), then the blocks still to come (2), then the
 * blocks whose window has passed (3). The page, the home card and the wall lane all read it.
 */
export function choreBlockRank(b: Pick<ChoreDayBlock, 'block' | 'isNow' | 'ended'>): number {
  if (b.isNow) return 0;
  if (b.block === 'anytime') return 1;
  return b.ended ? 3 : 2;
}

/** `blocks` in the display order (`choreBlockRank`); equal ranks keep `CHORE_BLOCKS` order. */
export function blocksInDisplayOrder<T extends Pick<ChoreDayBlock, 'block' | 'isNow' | 'ended'>>(
  blocks: readonly T[]
): T[] {
  return [...blocks].sort((a, b) => choreBlockRank(a) - choreBlockRank(b));
}

/**
 * Would ticking `choreId` (not yet done) finish its block in `day`? The tick path's question:
 * true only for the LAST undone chore of a block, so a block completed by a delete or a move
 * never reaches the celebration.
 */
export function completesBlock(day: BeanChoreDay, choreId: string): ChoreBlock | null {
  for (const b of day.blocks) {
    const item = b.chores.find((i) => i.chore.id === choreId);
    if (!item) continue;
    if (item.done) return null;
    return b.done + 1 === b.total ? b.block : null;
  }
  return null;
}

/** A bean's week: chores done per day (seven, from the week's first day) and the total. */
export interface ChoreWeekCounts {
  days: { ymd: string; count: number }[];
  total: number;
}

/**
 * Chores done per day for the week holding `weekOfYmd` (`weekStartDay`: 0 = Sunday, 1 =
 * Monday). Counts every `done` mark, including marks for chores since deleted: what was done
 * stays done.
 */
export function weekCounts(
  index: ChoreMarkIndex,
  memberId: string,
  weekOfYmd: string,
  weekStartDay: number = 1
): ChoreWeekCounts {
  const dow = choreDayOfWeek(weekOfYmd);
  if (dow < 0) return { days: [], total: 0 };
  const first = shiftChoreDay(weekOfYmd, -((dow - weekStartDay + 7) % 7));
  let total = 0;
  const days = Array.from({ length: 7 }, (_, i) => {
    const ymd = shiftChoreDay(first, i);
    const count = marksOn(index, memberId, ymd).done.size;
    total += count;
    return { ymd, count };
  });
  return { days, total };
}

/** A usable date strictly older than `cutoff` and not in the future. Anything else: KEEP. */
function isExpiredDate(value: string | undefined, cutoff: string, todayYmd: string): boolean {
  const ymd = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!YMD.test(ymd)) return false;
  if (ymd > todayYmd) return false; // a clock artefact, not expired data
  return ymd < cutoff;
}

/**
 * Which marks have expired, oldest first, capped at `max`. KEEP ON DOUBT: a mark expires only
 * when BOTH its `date` and its `createdAt` are usable and older than `keepDays` before today,
 * so a malformed, truncated or future date keeps the mark. The only inputs are the marks and
 * today: no chores, no members, no store, so a partially-loaded collection cannot widen it.
 */
export function expiredMarkIds(
  marks: readonly ChoreMark[],
  todayYmd: string,
  keepDays: number = CHORE_MARK_KEEP_DAYS,
  max: number = MAX_MARK_SWEEP_DELETES
): string[] {
  if (!YMD.test(todayYmd) || !(keepDays > 0)) return [];
  const cutoff = shiftChoreDay(todayYmd, -keepDays);
  return marks
    .filter(
      (m) => isExpiredDate(m.date, cutoff, todayYmd) && isExpiredDate(m.createdAt, cutoff, todayYmd)
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, max))
    .map((m) => m.id);
}
