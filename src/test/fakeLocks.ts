/**
 * A `navigator.locks` stand-in shared by every test that needs one on the same origin (two
 * simulated tabs share ONE instance, as two real tabs share the origin's lock manager).
 *
 * Exclusive locks only. A name is taken synchronously at `request()` time (a real lock manager
 * records the request in order, so a later `ifAvailable` request sees it), held while the
 * callback's promise is pending, and:
 *   - `ifAvailable: true` on a held name calls back with null at once;
 *   - otherwise the request waits for the holder to let go, then is granted.
 *
 * `deferGrant: true` answers a request one microtask later instead (a real grant is
 * asynchronous), for a test that acts between a request and its grant.
 */
import { vi } from 'vitest';

export function fakeLocks(opts: { deferGrant?: boolean } = {}) {
  const heldNames = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  const requests: string[] = [];

  function release(name: string): void {
    const next = waiters.get(name)?.shift();
    if (next) next();
    else heldNames.delete(name);
  }

  const request = vi.fn(
    async (
      name: string,
      optsOrCb: LockOptions | ((lock: Lock | null) => unknown),
      maybeCb?: (lock: Lock | null) => unknown
    ) => {
      const lockOpts: LockOptions = typeof optsOrCb === 'function' ? {} : optsOrCb;
      const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb)!;
      requests.push(name);
      if (opts.deferGrant) await Promise.resolve();
      if (heldNames.has(name)) {
        if (lockOpts.ifAvailable) return cb(null);
        await new Promise<void>((resolve) => {
          const queue = waiters.get(name) ?? [];
          queue.push(resolve);
          waiters.set(name, queue);
        });
      } else {
        heldNames.add(name);
      }
      try {
        return await cb({ name, mode: 'exclusive' } as Lock);
      } finally {
        release(name);
      }
    }
  );
  return { request, heldNames, requests };
}

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

export function installLocks(value: unknown): void {
  Object.defineProperty(navigator, 'locks', { value, configurable: true, writable: true });
}

export function restoreLocks(): void {
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else delete (navigator as { locks?: unknown }).locks;
}
