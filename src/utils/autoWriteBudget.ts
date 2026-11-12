/**
 * A daily cap on how much an UNATTENDED writer may write to the family doc (2026-11-12).
 *
 * Why it exists: in November 2026 two builds of the app fought over helpful-hint to-dos. The
 * newer build created a hint type the older one did not know, the older one pruned it as stale,
 * and the newer one recreated it about every 15 seconds for three days: ~7,500 doc changes that
 * no person made. Deleting data never shrinks an Automerge file, so a writer that nothing bounds
 * can grow a family's file without limit. This is the bound.
 *
 * ── The contract ────────────────────────────────────────────────────────────────────────
 *
 *  - ONE `takeAutoWrite` call is ONE family-doc write (one commit and one Drive save), NOT one
 *    record. A writer that batches takes one per batch.
 *  - Call it immediately before the write. On `false`, stop: every later write in the same run
 *    would be refused too.
 *  - Deferred work is not lost as long as the writer is a diff against current state: it is
 *    simply applied on a later run, once the window frees.
 *  - A writer with two opposing directions (create and remove) passes a `lane` for each, so
 *    each has its own budget and one direction of a fight cannot starve the other.
 *  - Only automatic writers adopt this. A write a person asked for (a button, a settings
 *    switch) is never budgeted.
 *
 * ── Scope: a damage bound, not an exact quota ───────────────────────────────────────────
 *
 * The budget is per writer and per page load on a device, persisted across reloads through
 * `attemptBudget`. It is NOT per family: a device used by two families shares it. It is NOT
 * shared live between two open tabs (or a PWA plus a tab): each hydrates its count once and
 * then writes its own count back, so N concurrent tabs can spend up to N times the cap. Where
 * localStorage is blocked the count lives in memory and resets on reload. All accepted: the
 * point is that a fight is held to tens of writes a day instead of thousands an hour.
 *
 * ── Refusals report themselves ──────────────────────────────────────────────────────────
 *
 * A refusal logs a `console.warn` and an `error`-severity `auto-write-capped` event, latched
 * to once per HALF window per writer and lane (so at most twice a day while a cap stays hit,
 * and never silent on a later day), so no caller can forget to and a capped writer cannot flood
 * the firehose either. No toast: no user action failed.
 */
import { consumeAttempt, type BudgetPolicy } from '@/utils/attemptBudget';
import { reportError } from '@/utils/errorReporter';

/** Automatic writes allowed per writer over a rolling day. Ordinary need is a handful. */
export const AUTO_WRITE_POLICY: BudgetPolicy = { max: 40, windowMs: 86_400_000 };

/**
 * Take one automatic family-doc write for `writer` (a kebab-case surface name, which is also
 * the surface the refusal is reported on). Returns `false`, and reports (latched, see the header), when
 * the writer has spent its cap.
 */
export function takeAutoWrite(writer: string, lane?: string): boolean {
  const key = lane ? `${writer}:${lane}` : writer;
  const verdict = consumeAttempt(`auto-write:${key}`, AUTO_WRITE_POLICY);
  if (verdict.ok) return true;

  // Half the budget window, not the whole of it: the latch starts at the first REFUSAL,
  // which is always later than the budget window's start, so a full-length latch would
  // still be held when the next day's slots are respent and that refusal would be silent.
  const latch = consumeAttempt(`auto-write-report:${key}`, {
    max: 1,
    windowMs: AUTO_WRITE_POLICY.windowMs / 2,
  });
  if (latch.ok) {
    const resetsInMin = Math.max(0, Math.ceil((verdict.resetsAt - Date.now()) / 60_000));
    console.warn(
      `[autoWriteBudget] ${key} hit its automatic write cap; writes deferred until ` +
        `${new Date(verdict.resetsAt).toISOString()}. Two devices or builds are probably ` +
        'undoing each other. Check the write-raced events for this family.'
    );
    reportError({
      surface: writer,
      severity: 'error',
      message: 'automatic write cap reached; writes deferred',
      context: {
        action: 'auto-write-capped',
        detail: `writer=${key};resets_in_min=${resetsInMin}`,
      },
    });
  }
  return false;
}
