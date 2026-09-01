/**
 * A per-device high-water mark for the cycle-retention sweep.
 *
 * The sweep deletes a family's history irreversibly, and its only authority for "how old
 * is this" is the device clock — which can be wrong, can jump, and can move timezone.
 * This is the guard that means a wrong clock can only ever *delay* a deletion, never
 * accelerate one.
 *
 * Per DEVICE, not per member: it is a property of this machine's clock, not of a person.
 * That is why it does not reuse `perMemberStore` (which keys on the current member) — but
 * it follows the same no-silent-failure contract: warn on a bad read, report a failed
 * write, never throw.
 *
 * `runDailyMaintenance` fires on every app start and after every remote merge, so this
 * also serves a second purpose: it makes the sweep run at most once per device per day.
 */
import { reportError } from '@/utils/errorReporter';
import { MAX_TRUSTED_CLOCK_JUMP_DAYS } from '@/utils/listCycles';

const KEY = 'beanies_cycle_sweep_day';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type ClockVerdict =
  /** Go ahead. */
  | 'sweep'
  /** No usable stored day — a device's first ever sweep deletes nothing. */
  | 'skip-first-run'
  /** Today IS the stored day — already swept. The normal repeat; never logged. */
  | 'skip-same-day'
  /** Today is before the stored day: the clock went backwards. Logged, cursor untouched. */
  | 'skip-regressed'
  /** A forward jump too large to trust: a long absence, or a badly wrong clock. */
  | 'skip-jumped'
  /**
   * The STORED day is implausibly far in the future, so the cursor itself is corrupt —
   * written from a clock that was badly wrong (see `skip-jumped`) before it was corrected.
   * Without this the sweep would read `skip-regressed` on every run until the real
   * calendar caught up with the bad reading, silently and with no telemetry: on a family's
   * only device, retention would simply never happen again. The caller resets the cursor
   * to today and skips this one run.
   */
  | 'skip-corrupt';

function daysBetween(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T00:00:00`).getTime();
  const to = new Date(`${toYmd}T00:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/**
 * The whole policy, as a pure function — so every branch is testable without touching
 * localStorage or faking a clock.
 *
 * Same-day and backwards are SEPARATE verdicts even though both skip. Same-day is the
 * normal path (maintenance runs on every app open and after every remote merge) and must
 * stay silent or it buries every anomaly; a genuinely backwards clock is rare and worth
 * seeing. Collapsing them, as an earlier draft did, silenced the only warning that a
 * device's retention had stopped running.
 */
export function clockVerdict(todayYmd: string, storedYmd: string | null): ClockVerdict {
  if (!storedYmd || !YMD.test(storedYmd) || !YMD.test(todayYmd)) return 'skip-first-run';
  const delta = daysBetween(storedYmd, todayYmd);
  if (delta === 0) return 'skip-same-day';
  // Symmetric with the forward bound: a stored day further ahead than a trusted jump could
  // have produced cannot have come from a correct clock, so the cursor is unusable.
  if (delta < -MAX_TRUSTED_CLOCK_JUMP_DAYS) return 'skip-corrupt';
  if (delta < 0) return 'skip-regressed';
  if (delta > MAX_TRUSTED_CLOCK_JUMP_DAYS) return 'skip-jumped';
  return 'sweep';
}

/** Last day this device swept, or `null` when unknown. Never throws. */
export function readSweepDay(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch (e) {
    console.warn('[cycleSweepClock] could not read the sweep high-water mark', e);
    return null;
  }
}

/**
 * Record that this device has reached `todayYmd`.
 *
 * @returns `false` when the write failed. The caller must then SKIP the sweep: a cursor
 *   that cannot advance would otherwise re-evaluate the same clock jump forever.
 */
export function recordSweepDay(todayYmd: string): boolean {
  try {
    localStorage.setItem(KEY, todayYmd);
    return true;
  } catch (e) {
    reportError({
      surface: 'listStore.sweepExpiredCycles',
      message:
        'could not persist the cycle-sweep high-water day — the sweep is skipped so a stuck cursor cannot re-evaluate the same clock jump on every load',
      error: e,
      severity: 'warning',
      context: { recur_surface: 'list', recur_outcome: 'write-failed' },
    });
    return false;
  }
}
