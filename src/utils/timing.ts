/** Returns a promise that resolves after `ms` milliseconds. */
export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Race a promise against a timeout. Resolves/rejects with the original promise
 * if it settles first; otherwise rejects with `new Error(message)` after `ms`.
 *
 * Note: this does NOT cancel the underlying work — it just stops *waiting* on
 * it. Use it to keep UI state (spinners, "loading" flags) from wedging when an
 * external operation (popup OAuth, redirect-auth completion, …) might never
 * resolve. For fetches that need real cancellation, use an `AbortController`.
 *
 * The timer is always cleared once the race settles, so a fast-resolving
 * promise leaves no dangling timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Best-effort race: resolve with the promise's value if it settles within `ms`,
 * otherwise resolve with `undefined` and stop waiting (the underlying work keeps
 * running). Unlike `withTimeout`, a timeout is NOT an error — a genuine rejection
 * still propagates.
 *
 * Use for fire-and-proceed saves that must never wedge a spinner: e.g. a Drive
 * `syncNow(true)` after biometric unlock / passkey register / password sign-in,
 * where the data is already in the in-memory envelope + cache and rides the next
 * auto-sync. A slow/offline/token-rejected Drive save would otherwise hang the
 * "verifying" button indefinitely. Mirrors the sign-out `forceSaveWithTimeout`
 * guard. The timer is always cleared once the race settles.
 */
export function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
