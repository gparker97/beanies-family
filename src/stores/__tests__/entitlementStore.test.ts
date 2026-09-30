/**
 * entitlementStore (#95): the client never computes the trial, but it does apply two offline
 * rules to a cached answer, and it alone decides whether the answer ACTS. Those are the three
 * things pinned here:
 *   - the 14-day rule on a cached `active` answer, either side of the boundary;
 *   - a cached `trial` ending on its date with no connection at all;
 *   - `isReadOnly` needs the flag AND the server's `enforced`; `wouldBeReadOnly` is the rest.
 * Plus the plumbing that makes the soak trustworthy: the observer applies only the active
 * family's answer, a bad cache is logged and ignored, a paid family without its plan token is
 * shouted about once, and every lookup goes through the one `ask()` gate (activation only
 * without a cache, the real hourly poller with no boot fire, back-online, force coalescing).
 *
 * The real `entitlementCache` runs against happy-dom's localStorage, so the corrupt path is the
 * real one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { reactive, ref, nextTick } from 'vue';
import type { Entitlement, RegistryEntry } from '@/types/models';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const FAMILY = 'fam-1';

const h = vi.hoisted(() => ({
  logEvent: vi.fn(),
  lookupFamilyResult: vi.fn(),
  observer: null as ((e: unknown) => void) | null,
  /** What the store handed the REAL poller: its callback and options. */
  poll: null as { callback: () => unknown; options: Record<string, unknown> | undefined } | null,
  flagOn: true,
  docLoaded: true,
  settings: null as { planToken?: string } | null,
}));

vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/services/registry/registryService', () => ({
  lookupFamilyResult: h.lookupFamilyResult,
  setRegistryEntryObserver: (fn: (e: unknown) => void) => {
    h.observer = fn;
  },
}));
vi.mock('@/config/flags', () => ({ isFlagEnabled: () => h.flagOn }));
const online = ref(true);
vi.mock('@/composables/useOnline', () => ({ useOnline: () => ({ isOnline: online }) }));
// The REAL poller runs (so a boot fire would show up as a lookup); the wrapper only records
// what the store passed it.
vi.mock('@/composables/usePollWhileVisible', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/usePollWhileVisible')>();
  return {
    usePollWhileVisible: (
      callback: () => Promise<void> | void,
      intervalMs: number,
      options?: Record<string, unknown>
    ) => {
      h.poll = { callback, options };
      return actual.usePollWhileVisible(callback, intervalMs, options);
    },
  };
});
vi.mock('@/services/automerge/docService', () => ({
  docVersion: ref(0),
  isDocLoaded: () => h.docLoaded,
}));
vi.mock('@/services/automerge/projection', () => ({ getSettings: () => h.settings }));
const familyContext = reactive({ activeFamilyId: FAMILY as string | null });
vi.mock('@/stores/familyContextStore', () => ({ useFamilyContextStore: () => familyContext }));

import { useEntitlementStore } from '../entitlementStore';

function ent(over: Partial<Entitlement> = {}): Entitlement {
  return {
    state: 'trial',
    reason: 'in_trial',
    plan: null,
    cohort: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    enforced: true,
    serverTime: new Date().toISOString(),
    ...over,
  };
}

function seedCache(e: Entitlement, fetchedAt: number, familyId = FAMILY, clockOffsetMs = 0): void {
  localStorage.setItem(
    `beanies:entitlement:${familyId}`,
    JSON.stringify({ entitlement: e, fetchedAt, clockOffsetMs })
  );
}

function entry(e: Entitlement | null | undefined, familyId = FAMILY): RegistryEntry {
  return {
    familyId,
    provider: 'google_drive',
    updatedAt: '2026-09-30',
    ...(e === undefined ? {} : { entitlement: e }),
  } as RegistryEntry;
}

/**
 * A fresh Pinia, disposing the previous one's stores first. Without this a store from an
 * earlier test keeps watching the shared `familyContext` and answers the next test's
 * `activeFamilyId` reset with a refresh of its own.
 */
let pinia: ReturnType<typeof createPinia> | null = null;
function disposeStores(): void {
  if (!pinia) return;
  for (const store of (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.values()) {
    store.$dispose();
  }
}
function freshPinia(): void {
  disposeStores();
  pinia = createPinia();
  setActivePinia(pinia);
}

/** The logEvent calls whose context.action is `action`. */
function logged(action: string) {
  return h.logEvent.mock.calls
    .map((c) => c[0])
    .filter((e) => (e.context as { action?: string } | undefined)?.action === action);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  freshPinia();
  localStorage.clear();
  h.logEvent.mockReset();
  h.lookupFamilyResult.mockReset();
  h.lookupFamilyResult.mockResolvedValue({ status: 'absent' });
  h.observer = null;
  h.flagOn = true;
  h.docLoaded = true;
  h.settings = null;
  online.value = true;
  familyContext.activeFamilyId = FAMILY;
});

afterEach(() => {
  // Stops the real poller's interval along with the store's watchers.
  disposeStores();
  vi.useRealTimers();
});

describe('the 14-day offline rule on an open-ended answer', () => {
  it('honours a cached active answer at 13 days 23 hours', () => {
    seedCache(
      ent({ state: 'active', reason: 'subscribed', plan: 'basic' }),
      Date.now() - (14 * DAY - HOUR)
    );
    const s = useEntitlementStore();
    expect(s.state).toBe('active');
    expect(s.isStale).toBe(false);
    expect(s.isReadOnly).toBe(false);
  });

  it('treats it as read-only (stale) at 14 days 1 hour', () => {
    seedCache(
      ent({ state: 'active', reason: 'subscribed', plan: 'basic' }),
      Date.now() - (14 * DAY + HOUR)
    );
    const s = useEntitlementStore();
    expect(s.state).toBe('read_only');
    expect(s.isStale).toBe(true);
    expect(s.isReadOnly).toBe(true);
    expect(logged('applied')[0]!.context).toMatchObject({
      kind: 'cache',
      entitlement_state: 'read_only',
      dry_run: false,
      detail: 'stale',
    });
  });

  it('crosses the boundary while offline, on the next refresh tick, without asking the registry', async () => {
    online.value = false;
    seedCache(
      ent({ state: 'active', reason: 'subscribed', plan: 'full' }),
      Date.now() - (14 * DAY - HOUR)
    );
    const s = useEntitlementStore();
    expect(s.state).toBe('active');

    vi.setSystemTime(Date.now() + 2 * HOUR);
    await s.refresh();

    expect(s.state).toBe('read_only');
    expect(s.isStale).toBe(true);
    expect(h.lookupFamilyResult).not.toHaveBeenCalled();
  });

  it('a fresh server answer clears the stale state', () => {
    seedCache(ent({ state: 'active', reason: 'subscribed', plan: 'full' }), Date.now() - 20 * DAY);
    const s = useEntitlementStore();
    expect(s.isStale).toBe(true);

    h.observer!(entry(ent({ state: 'active', reason: 'subscribed', plan: 'full' })));

    expect(s.state).toBe('active');
    expect(s.isStale).toBe(false);
  });
});

describe('beta is open-ended too; a trial is never cut short by the grace rule', () => {
  it('a cached beta answer older than 14 days is read-only (stale)', () => {
    seedCache(ent({ state: 'beta', reason: 'no_launch', enforced: false }), Date.now() - 15 * DAY);
    const s = useEntitlementStore();
    expect(s.state).toBe('read_only');
    expect(s.isStale).toBe(true);
    expect(s.wouldBeReadOnly).toBe(true);
  });

  it('a cached beta answer inside the window stays beta', () => {
    seedCache(ent({ state: 'beta', reason: 'no_launch' }), Date.now() - 13 * DAY);
    expect(useEntitlementStore().state).toBe('beta');
  });

  it('a trial fetched 20 days ago still runs to its own end date', () => {
    const end = new Date(Date.now() + 30 * DAY).toISOString();
    seedCache(ent({ state: 'trial', trialEndsAt: end }), Date.now() - 20 * DAY);
    const s = useEntitlementStore();
    expect(s.state).toBe('trial');
    expect(s.isStale).toBe(false);
  });
});

describe('the device clock is not trusted', () => {
  it('a device clock one day FAST does not end a trial early', () => {
    // Real (server) time is one day behind this device. The trial ends 12 hours from real now,
    // which is 12 hours in THIS DEVICE'S past.
    const serverNow = Date.now() - DAY;
    const s = useEntitlementStore();
    h.observer!(
      entry(
        ent({
          state: 'trial',
          serverTime: new Date(serverNow).toISOString(),
          trialEndsAt: new Date(serverNow + 12 * HOUR).toISOString(),
        })
      )
    );
    expect(s.state).toBe('trial');
    expect(s.trialDaysLeft).toBe(1);

    // And the offset survives a relaunch from the cache.
    freshPinia();
    expect(useEntitlementStore().state).toBe('trial');
  });

  it('a device clock 20 days SLOW still ages an answer at the true rate', async () => {
    // Rule 1 is an age on the DEVICE clock alone (now - fetchedAt), so a consistent skew has no
    // effect on it. What this pins: the server's far-future `serverTime` is NOT what the age is
    // measured from. Measured from serverTime, this 15-day-old answer would look 5 days young.
    const s = useEntitlementStore();
    h.observer!(
      entry(
        ent({
          state: 'active',
          reason: 'subscribed',
          plan: 'basic',
          serverTime: new Date(Date.now() + 20 * DAY).toISOString(),
        })
      )
    );
    expect(s.state).toBe('active');

    online.value = false;
    vi.setSystemTime(Date.now() + 15 * DAY);
    await s.refresh();
    expect(s.state).toBe('read_only');
    expect(s.isStale).toBe(true);

    freshPinia();
    expect(useEntitlementStore().isStale).toBe(true);
  });
});

describe('a trial ends on its date, connected or not', () => {
  it('turns read-only offline once trialEndsAt passes', async () => {
    online.value = false;
    const end = new Date(Date.now() + HOUR).toISOString();
    seedCache(ent({ state: 'trial', trialEndsAt: end }), Date.now() - DAY);
    const s = useEntitlementStore();
    expect(s.state).toBe('trial');

    vi.setSystemTime(Date.now() + 2 * HOUR);
    await s.refresh();

    expect(s.state).toBe('read_only');
    // Not stale: the trial simply ended. The card says "your trial has ended".
    expect(s.isStale).toBe(false);
  });

  it('reports day N of 90 and the days left', () => {
    // 59.5 days left => 60 whole days left => day 31.
    const end = new Date(Date.now() + 59.5 * DAY).toISOString();
    seedCache(ent({ state: 'trial', trialEndsAt: end }), Date.now());
    const s = useEntitlementStore();
    expect(s.trialDaysLeft).toBe(60);
    expect(s.trialDay).toBe(31);
  });
});

describe('isReadOnly vs wouldBeReadOnly', () => {
  const cases = [
    { flag: true, enforced: true, readOnly: true, would: false },
    { flag: true, enforced: false, readOnly: false, would: true },
    { flag: false, enforced: true, readOnly: false, would: true },
    { flag: false, enforced: false, readOnly: false, would: true },
  ];
  for (const c of cases) {
    it(`flag ${c.flag ? 'on' : 'off'}, enforced ${c.enforced}: acts=${c.readOnly}`, () => {
      h.flagOn = c.flag;
      seedCache(
        ent({ state: 'read_only', reason: 'trial_ended', enforced: c.enforced }),
        Date.now()
      );
      const s = useEntitlementStore();
      expect(s.isReadOnly).toBe(c.readOnly);
      expect(s.wouldBeReadOnly).toBe(c.would);
      expect(logged('applied')[0]!.context).toMatchObject({ dry_run: !c.readOnly });
    });
  }

  it('neither is set for a writable family, whatever the switches say', () => {
    seedCache(
      ent({ state: 'trial', trialEndsAt: new Date(Date.now() + DAY).toISOString() }),
      Date.now()
    );
    const s = useEntitlementStore();
    expect(s.isReadOnly).toBe(false);
    expect(s.wouldBeReadOnly).toBe(false);
  });
});

describe('the registry observer', () => {
  it('applies the active family’s answer, caches it and logs it', () => {
    const s = useEntitlementStore();
    expect(s.state).toBeNull();

    h.observer!(entry(ent({ state: 'beta', reason: 'no_launch', enforced: false })));

    expect(s.state).toBe('beta');
    expect(s.fetchedAt).toBe(Date.now());
    const cached = JSON.parse(localStorage.getItem(`beanies:entitlement:${FAMILY}`)!);
    expect(cached.entitlement.state).toBe('beta');
    expect(logged('applied').at(-1)!.context).toMatchObject({
      kind: 'server',
      entitlement_state: 'beta',
      plan: null,
      dry_run: true,
    });
  });

  it('ignores a lookup for some other family', () => {
    const s = useEntitlementStore();
    h.observer!(entry(ent({ state: 'read_only', reason: 'lapsed' }), 'someone-else'));
    expect(s.state).toBeNull();
  });

  it('keeps the cache when the registry could not compute an entitlement', () => {
    const at = Date.now() - DAY;
    seedCache(ent({ state: 'active', reason: 'subscribed', plan: 'basic' }), at);
    const s = useEntitlementStore();

    h.observer!(entry(null));

    expect(s.state).toBe('active');
    expect(s.fetchedAt).toBe(at);
    expect(logged('refresh_failed')[0]).toMatchObject({
      level: 'warn',
      context: { detail: 'entitlement_unavailable' },
    });
  });

  it('re-reads the cache when the active family changes', async () => {
    seedCache(ent({ state: 'read_only', reason: 'trial_ended' }), Date.now(), 'fam-2');
    const s = useEntitlementStore();
    expect(s.state).toBeNull();

    familyContext.activeFamilyId = 'fam-2';
    await nextTick();

    expect(s.state).toBe('read_only');
  });
});

/** A promise the test resolves by hand, to hold a lookup in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('refresh', () => {
  it('asks the registry when online and logs an unavailable answer as a warning', async () => {
    h.lookupFamilyResult.mockResolvedValue({ status: 'unavailable' });
    const s = useEntitlementStore();
    await s.refresh();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(1);
    expect(h.lookupFamilyResult).toHaveBeenCalledWith(FAMILY);
    expect(logged('refresh_failed')[0]).toMatchObject({
      level: 'warn',
      context: { detail: 'unavailable' },
    });
  });

  it('does nothing offline', async () => {
    online.value = false;
    const s = useEntitlementStore();
    await s.refresh();
    expect(h.lookupFamilyResult).not.toHaveBeenCalled();
  });

  it('asks at most once per 5 minutes, unless forced', async () => {
    seedCache(ent({ state: 'beta', reason: 'no_launch' }), Date.now() - DAY);
    const s = useEntitlementStore();
    await s.refresh();
    await s.refresh();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 4 * 60 * 1000);
    await s.refresh();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(1);
    await s.refresh({ force: true });
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await s.refresh();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(3);
  });

  it('counts an answer the observer applied from someone else’s GET', async () => {
    seedCache(ent({ state: 'beta', reason: 'no_launch' }), Date.now() - DAY);
    const s = useEntitlementStore();
    h.observer!(entry(ent({ state: 'beta', reason: 'no_launch' })));
    await s.refresh();
    expect(h.lookupFamilyResult).not.toHaveBeenCalled();
  });

  it('shares an in-flight request; force waits for it and then asks again', async () => {
    seedCache(ent({ state: 'beta', reason: 'no_launch' }), Date.now() - DAY);
    const first = deferred<{ status: string }>();
    h.lookupFamilyResult.mockReturnValueOnce(first.promise);
    const s = useEntitlementStore();

    const a = s.refresh();
    const b = s.refresh();
    const forced = s.refresh({ force: true });
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(1);

    first.resolve({ status: 'absent' });
    await Promise.all([a, b, forced]);
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(2);
  });
});

describe('the ask gate', () => {
  it('boot with a cached answer makes NO lookup, with the real poller installed', async () => {
    seedCache(ent({ state: 'active', reason: 'subscribed', plan: 'basic' }), Date.now() - DAY);
    useEntitlementStore();
    await nextTick();
    await Promise.resolve();
    expect(h.lookupFamilyResult).not.toHaveBeenCalled();
    // The poller is hourly with no immediate fire, which is what keeps boot at one GET.
    expect(h.poll?.options?.fireImmediatelyOnVisible).toBeUndefined();
  });

  it('the hourly tick goes through the gate as a poll', async () => {
    seedCache(ent({ state: 'beta', reason: 'no_launch' }), Date.now() - DAY);
    useEntitlementStore();
    await h.poll!.callback();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(1);
    expect(logged('poll')).toHaveLength(1);
  });

  it('a clock corrected backwards never suppresses an ask', async () => {
    // The answer was fetched "an hour from now": the device clock has since been set back.
    seedCache(ent({ state: 'beta', reason: 'no_launch' }), Date.now() + HOUR);
    const s = useEntitlementStore();
    await s.refresh();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(1);
  });

  it('coming back online asks at once, so a stale family recovers', async () => {
    online.value = false;
    seedCache(ent({ state: 'active', reason: 'subscribed', plan: 'full' }), Date.now() - 20 * DAY);
    const s = useEntitlementStore();
    expect(s.isStale).toBe(true);
    expect(h.lookupFamilyResult).not.toHaveBeenCalled();

    online.value = true;
    await nextTick();
    expect(h.lookupFamilyResult).toHaveBeenCalledWith(FAMILY);
    expect(logged('online')).toHaveLength(1);
  });

  it('two forces during an in-flight ask share ONE follow-up ask', async () => {
    seedCache(ent({ state: 'beta', reason: 'no_launch' }), Date.now() - DAY);
    const first = deferred<{ status: string }>();
    h.lookupFamilyResult.mockReturnValueOnce(first.promise);
    const s = useEntitlementStore();

    const a = s.refresh();
    const f1 = s.refresh({ force: true });
    const f2 = s.refresh({ force: true });
    // (Pinia wraps action results in new promises, so the sharing shows in the lookup count:
    // chained forces would make three.)

    first.resolve({ status: 'absent' });
    await Promise.all([a, f1, f2]);
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(2);
  });

  it('a family switch during an in-flight ask asks for the NEW family', async () => {
    const first = deferred<{ status: string }>();
    h.lookupFamilyResult.mockReturnValueOnce(first.promise);
    useEntitlementStore(); // no cache: the activation ask for fam-1 is now in flight
    expect(h.lookupFamilyResult).toHaveBeenCalledWith(FAMILY);

    familyContext.activeFamilyId = 'fam-2';
    await nextTick();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(2);
    expect(h.lookupFamilyResult).toHaveBeenLastCalledWith('fam-2');
    first.resolve({ status: 'absent' });
  });

  it('asks straight away for a family with no cache, and after a switch to one', async () => {
    useEntitlementStore();
    expect(h.lookupFamilyResult).toHaveBeenCalledTimes(1);

    familyContext.activeFamilyId = 'fam-2';
    await nextTick();
    expect(h.lookupFamilyResult).toHaveBeenLastCalledWith('fam-2');
  });
});

describe('a bad cache is logged and ignored', () => {
  it('unparseable JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(`beanies:entitlement:${FAMILY}`, '{not json');
    const s = useEntitlementStore();
    expect(s.state).toBeNull();
    expect(logged('cache_read_failed')[0]).toMatchObject({
      level: 'warn',
      context: { detail: 'corrupt' },
    });
    // Removed, so the next open reads `missing` and the warning does not repeat forever.
    expect(localStorage.getItem(`beanies:entitlement:${FAMILY}`)).toBeNull();
    // And it counts as no cache, so the registry is asked straight away.
    expect(h.lookupFamilyResult).toHaveBeenCalledWith(FAMILY);
    warn.mockRestore();
  });

  it('valid JSON of the wrong shape', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      `beanies:entitlement:${FAMILY}`,
      JSON.stringify({ entitlement: { state: 'active' } })
    );
    const s = useEntitlementStore();
    expect(s.state).toBeNull();
    expect(s.isReadOnly).toBe(false);
    expect(logged('cache_read_failed')[0]!.context).toMatchObject({ detail: 'corrupt' });
    expect(localStorage.getItem(`beanies:entitlement:${FAMILY}`)).toBeNull();
    warn.mockRestore();
  });

  it('a state or reason this build does not know is corrupt, and removed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of [
      { ...ent(), state: 'grace' },
      { ...ent(), reason: 'comped' },
    ]) {
      freshPinia();
      h.logEvent.mockReset();
      localStorage.setItem(
        `beanies:entitlement:${FAMILY}`,
        JSON.stringify({ entitlement: bad, fetchedAt: Date.now(), clockOffsetMs: 0 })
      );
      const s = useEntitlementStore();
      expect(s.state).toBeNull();
      expect(logged('cache_read_failed')[0]!.context).toMatchObject({ detail: 'corrupt' });
      expect(localStorage.getItem(`beanies:entitlement:${FAMILY}`)).toBeNull();
    }
    warn.mockRestore();
  });

  it('a record from before clockOffsetMs existed keeps its answer, with offset 0', () => {
    const end = new Date(Date.now() + 2 * DAY).toISOString();
    localStorage.setItem(
      `beanies:entitlement:${FAMILY}`,
      JSON.stringify({
        entitlement: ent({ state: 'trial', trialEndsAt: end }),
        fetchedAt: Date.now(),
      })
    );
    const s = useEntitlementStore();
    expect(s.state).toBe('trial');
    expect(s.trialDaysLeft).toBe(2);
    expect(logged('cache_read_failed')).toHaveLength(0);
  });

  it('a missing cache is the normal first open: counted at info, not raised', () => {
    useEntitlementStore();
    expect(logged('cache_read_failed')[0]).toMatchObject({
      level: 'info',
      context: { detail: 'missing' },
    });
  });
});

describe('plan_token_missing', () => {
  it('fires once per family per session for a paid family whose doc has no token', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.settings = {};
    const s = useEntitlementStore();

    h.observer!(entry(ent({ state: 'active', reason: 'subscribed', plan: 'full' })));
    await nextTick();
    h.observer!(entry(ent({ state: 'active', reason: 'subscribed', plan: 'full' })));
    await nextTick();

    expect(s.plan).toBe('full');
    expect(logged('plan_token_missing')).toHaveLength(1);
    expect(logged('plan_token_missing')[0]).toMatchObject({
      level: 'warn',
      context: { plan: 'full' },
    });
    expect(err.mock.calls[0]![0]).toContain(`--reissue-token ${FAMILY}`);
    err.mockRestore();
  });

  it('stays quiet when the token is there, and before the doc has loaded', async () => {
    h.settings = { planToken: 'tok' };
    useEntitlementStore();
    h.observer!(entry(ent({ state: 'active', reason: 'subscribed', plan: 'basic' })));
    await nextTick();
    expect(logged('plan_token_missing')).toHaveLength(0);

    freshPinia();
    h.settings = null;
    h.docLoaded = false;
    useEntitlementStore();
    h.observer!(entry(ent({ state: 'active', reason: 'subscribed', plan: 'basic' })));
    await nextTick();
    expect(logged('plan_token_missing')).toHaveLength(0);
  });
});
