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

describe('actor pinning is OFF, and the reason is executable', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../worker/docClient.ts'), 'utf8');

  it('setFamilyKey posts NO actor while the invariant cannot be met', () => {
    // A pinned actor needs the local document never to regress below what it
    // published. Cache-first loading + a debounced persist + a prefix-keeping
    // recovery make it regress routinely, and the next edit then reuses a seq
    // Drive already holds — `duplicate seq`, which refuses the merge AND the
    // save. Seen in the field on the first real two-session test.
    expect(src).toContain('const ACTOR_PINNING_ENABLED = false;');
    const start = src.indexOf('export async function setFamilyKey');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).toContain('ACTOR_PINNING_ENABLED');
  });

  it('and the machinery survives, so re-enabling is one line', () => {
    // The lease, the derivation and their tests are all intact — deleting them
    // would mean rebuilding this from scratch once the invariant holds.
    const body = src.slice(src.indexOf('export async function setFamilyKey'));
    expect(body).toContain('acquireActorLease(familyId)');
    expect(body).toContain('deviceActorId(familyId)');
  });
});

describe('the collision a pinned actor causes, pinned as a fact', () => {
  it('one device that fell behind its own published history cannot merge it back', async () => {
    // THE mechanism, end to end. Not two tabs, not two people: ONE device whose
    // cached document lagged what it had already pushed.
    const Automerge = await import('@automerge/automerge');
    const ACTOR = 'd316ecd2309724e0267661c418f39f0a';
    type Doc = { items: Record<string, string> };
    let doc = Automerge.from<Doc>({ items: {} }, { actor: ACTOR });
    for (const k of ['a', 'b', 'c']) {
      doc = Automerge.change(doc, (d) => {
        d.items[k] = k;
      });
    }
    const drive = Automerge.save(doc); // all three reached Drive
    // The cache, however, kept only a prefix.
    const changes = Automerge.getAllChanges(doc);
    let cached = Automerge.init<Doc>({ actor: ACTOR });
    [cached] = Automerge.applyChanges(cached, changes.slice(0, 2));
    // Cache-first open, then the user edits BEFORE the background merge lands.
    cached = Automerge.change(cached, (d) => {
      d.items.userEdit = 'made right after opening';
    });
    expect(() => Automerge.merge(cached, Automerge.load<Doc>(drive))).toThrow(/duplicate seq/i);
  });
});
