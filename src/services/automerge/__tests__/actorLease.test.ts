/**
 * One writer per pinned actor.
 *
 * The direction of every failure is the point: a lease that cannot be taken
 * must degrade to "no actor" (Automerge mints a random one, the pre-Phase-A
 * behaviour), never to two realms sharing one actor and never to a throw.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const { logEvent } = await import('@/services/telemetry/logEvent');
const { acquireActorLease, releaseActorLease, __resetActorLeaseForTesting } =
  await import('@/services/automerge/actorLease');

/** A LockManager stand-in: `ifAvailable` semantics, holds while the callback's promise is pending. */
function fakeLocks() {
  const heldNames = new Set<string>();
  const requests: string[] = [];
  const request = vi.fn(
    async (
      name: string,
      _opts: LockOptions,
      cb: (lock: Lock | null) => Promise<unknown> | unknown
    ) => {
      requests.push(name);
      if (heldNames.has(name)) return cb(null);
      heldNames.add(name);
      try {
        return await cb({ name, mode: 'exclusive' } as Lock);
      } finally {
        heldNames.delete(name);
      }
    }
  );
  return { request, heldNames, requests };
}

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
function installLocks(value: unknown) {
  Object.defineProperty(navigator, 'locks', { value, configurable: true, writable: true });
}

let locks: ReturnType<typeof fakeLocks>;
const outcomes = () =>
  vi.mocked(logEvent).mock.calls.map((c) => (c[0].context as { action: string }).action);

beforeEach(() => {
  __resetActorLeaseForTesting();
  vi.mocked(logEvent).mockClear();
  locks = fakeLocks();
  installLocks(locks);
});
afterEach(() => {
  __resetActorLeaseForTesting();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else delete (navigator as { locks?: unknown }).locks;
});

/** Let the fake's callback chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('acquireActorLease', () => {
  it('leases the first realm and HOLDS the lock until released', async () => {
    await expect(acquireActorLease('fam-1')).resolves.toBe(true);
    await settle();
    expect(locks.heldNames.has('beanies-doc-actor:fam-1')).toBe(true);
    expect(outcomes()).toEqual(['leased']);

    releaseActorLease();
    await settle();
    expect(locks.heldNames.has('beanies-doc-actor:fam-1')).toBe(false);
  });

  it('answers false when another realm already holds it, without waiting', async () => {
    // The other tab: the fake already holds the name.
    locks.heldNames.add('beanies-doc-actor:fam-1');
    await expect(acquireActorLease('fam-1')).resolves.toBe(false);
    expect(outcomes()).toEqual(['contended']);
  });

  it('is idempotent for the same family — six call sites, ONE request', async () => {
    // A second `locks.request` while we hold it ourselves would answer null
    // and silently drop the actor; the memo is what prevents that.
    const [a, b] = await Promise.all([acquireActorLease('fam-1'), acquireActorLease('fam-1')]);
    await settle();
    expect([a, b]).toEqual([true, true]);
    await expect(acquireActorLease('fam-1')).resolves.toBe(true);
    expect(locks.requests).toEqual(['beanies-doc-actor:fam-1']);
  });

  it('a family switch releases the old lease before taking the new', async () => {
    await acquireActorLease('fam-1');
    await settle();
    await expect(acquireActorLease('fam-2')).resolves.toBe(true);
    await settle();
    expect(locks.heldNames.has('beanies-doc-actor:fam-1')).toBe(false);
    expect(locks.heldNames.has('beanies-doc-actor:fam-2')).toBe(true);
  });

  it('answers false — and says so — when Web Locks is absent', async () => {
    installLocks(undefined);
    await expect(acquireActorLease('fam-1')).resolves.toBe(false);
    expect(outcomes()).toEqual(['unavailable']);
  });

  it('never throws: a rejecting LockManager degrades to false', async () => {
    installLocks({ request: vi.fn(async () => Promise.reject(new Error('SecurityError'))) });
    await expect(acquireActorLease('fam-1')).resolves.toBe(false);
    expect(outcomes()).toEqual(['unavailable']);
  });

  it('a release that overtakes an in-flight request lets the lock straight go', async () => {
    // Make the grant arrive AFTER a reset, as a family switch mid-open would.
    let grant!: (lock: Lock | null) => void;
    let held = false;
    installLocks({
      request: vi.fn(
        (_name: string, _o: LockOptions, cb: (l: Lock | null) => Promise<unknown> | unknown) =>
          new Promise((resolve) => {
            grant = async (l) => {
              held = true;
              await cb(l);
              held = false;
              resolve(undefined);
            };
          })
      ),
    });
    const p = acquireActorLease('fam-1');
    releaseActorLease();
    grant({ name: 'x', mode: 'exclusive' } as Lock);
    await expect(p).resolves.toBe(false);
    await settle();
    expect(held).toBe(false);
  });
});

describe('the lease is wired where the actor is minted and dropped', () => {
  // Source-level, like `lineageWiring.test.ts`: `docClient` has no realm to
  // drive here, and a forgotten call site is exactly the silent failure this
  // guards against.
  const src = fs.readFileSync(path.resolve(__dirname, '../worker/docClient.ts'), 'utf8');
  const body = (fn: string) => {
    const start = src.indexOf(fn);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('\n}\n', start));
  };

  it('setFamilyKey pins the actor ONLY behind the lease', () => {
    const b = body('export async function setFamilyKey');
    expect(b).toMatch(
      /\(await acquireActorLease\(familyId\)\)\s*\?\s*await deviceActorId\(familyId\)\s*:\s*null/
    );
  });

  it('reset() and the test reset both release it', () => {
    expect(body('export async function reset')).toContain('releaseActorLease()');
    expect(body('export function __resetDocClientForTesting')).toContain('releaseActorLease()');
  });
});
