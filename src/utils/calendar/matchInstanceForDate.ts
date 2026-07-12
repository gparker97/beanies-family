// Pure leaf util (#32 exceptions) — no I/O, no timezone math.
//
// Pick the single Google recurring-event instance that falls on `occurrenceYmd`
// from a list returned by `events.instances`. Matching is a pure STRING date-slice
// comparison — deliberately NOT converted to absolute ms (which would reintroduce
// the DST sensitivity the exception design avoids). We prefer `originalStartTime`
// (anchored to the master's generated slot — it never moves, even after the
// instance is rescheduled) and fall back to `start` (equal to the original at
// discovery time, before we ever modify the instance).

/** Minimal shape needed to date-match an instance (structural — any richer
 *  instance type satisfies it, so this util imports no client types). */
export interface InstanceTimes {
  originalStartTime?: { date?: string; dateTime?: string };
  start?: { date?: string; dateTime?: string };
}

/** The `YYYY-MM-DD` wall date of an instance time (all-day `date`, or the date
 *  slice of a timed offset-bearing `dateTime` — no tz conversion). */
function instanceYmd(t: { date?: string; dateTime?: string } | undefined): string | undefined {
  if (!t) return undefined;
  if (t.date) return t.date.slice(0, 10);
  if (t.dateTime) return t.dateTime.slice(0, 10);
  return undefined;
}

/** The instance whose original occurrence date equals `occurrenceYmd`, or null. */
export function matchInstanceForDate<T extends InstanceTimes>(
  instances: T[],
  occurrenceYmd: string
): T | null {
  const target = occurrenceYmd.slice(0, 10);
  for (const inst of instances) {
    const ymd = instanceYmd(inst.originalStartTime) ?? instanceYmd(inst.start);
    if (ymd === target) return inst;
  }
  return null;
}
