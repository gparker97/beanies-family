import { formatDate, formatTime12, toTimeInputValue } from '@/utils/date';

/**
 * The LOCAL time and date a magic-beans allowance resets (#95).
 *
 * The server's usage day and month are UTC (the usage table's sort key), so `resetsAt` is the next
 * UTC midnight or UTC month start. Families think in their own clock, so every surface shows that
 * instant in local time ("more at 8am" in Singapore), which is the decision recorded in the plan.
 * One helper so the quota prompt and the plan card can never render it differently.
 *
 * Null for an unparseable instant, so a caller falls back to copy without a time rather than
 * rendering "NaN".
 */
export function allowanceResetParts(resetsAt: string): { time: string; date: string } | null {
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return null;
  return { time: formatTime12(toTimeInputValue(at)), date: formatDate(resetsAt) };
}
