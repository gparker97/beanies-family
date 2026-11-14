/**
 * Settle with `promise` if it settles by `deadline` (a `performance.now()` time), else with
 * `'late'`. The promise keeps running either way, so a slow load still lands for next time; a
 * rejection after the deadline stays the caller's to observe (this never leaves it unhandled).
 */
export function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | 'late'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), Math.max(0, deadline - performance.now()));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
