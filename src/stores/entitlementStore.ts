/**
 * What this family may do right now: beta, trial, active or read-only (#95).
 *
 * THE SERVER DECIDES; THIS STORE ONLY REMEMBERS
 * The registry GET computes the entitlement (`infrastructure/lambda/registry/entitlement.mjs`,
 * the only place the trial and lapse rules live). This store never computes a trial clock. It
 * applies exactly two rules to the cached answer, both of which only ever take access AWAY:
 *   1. an OPEN-ENDED answer (`active` or `beta`: neither carries a server end date) older than
 *      `OFFLINE_GRACE_DAYS` is treated as `read_only` (`stale`) until the next successful
 *      refresh, so a lapsed family cannot stay paid, and a family cannot sit out launch in beta,
 *      by staying offline. `trial` is never cut short by it (it has its own end date), and
 *      `read_only` needs nothing;
 *   2. a `trial` answer whose `trialEndsAt` has passed is `read_only`, connected or not.
 *
 * THE DEVICE CLOCK IS NOT TRUSTED FOR SERVER DATES
 * Each answer records `clockOffsetMs = serverTime - fetchedAt`. Rule 2 and `trialDaysLeft`
 * compare against a SERVER date (`trialEndsAt`), so they read the server-corrected clock
 * `Date.now() + clockOffsetMs`: a device clock set a day fast cannot end a trial a day early.
 * Rule 1 is an AGE, and needs no correction: it is plain `now - fetchedAt`, both on the device
 * clock, so a clock that is consistently fast or slow ages the answer at the true rate.
 *
 * HOW THE ANSWER ARRIVES
 * The observer installed on `registryService` sees every successful registry GET (the four
 * `syncStore` call sites and this store's own `refresh()`), so `syncStore` needs no edit and
 * any GET it makes also refreshes the plan. `syncStore.checkCanonicalPod` makes one per family
 * per session on EVERY provider (local-file included) once a provider is set and the device is
 * online, then latches.
 *
 * This store starts its own lookups in exactly ONE place, `ask(reason)`, and for four reasons:
 *   - `activation`: a family became active and this device has NO usable cache for it;
 *   - `poll`: the hourly tick while the tab is visible (no immediate fire: at boot that would
 *     double `checkCanonicalPod`'s GET for every family with a cache);
 *   - `online`: the device came back online, so a stale read-only family recovers at once, as
 *     its copy promises;
 *   - `force` (and `manual`): the public `refresh()`, forced by Phase 5 right after a claim.
 * The gate reads the active family and connectivity at call time, shares an in-flight ask,
 * keeps a 5-minute floor between asks for every reason but `force`, and logs each ask it
 * actually starts.
 *
 * ALWAYS INSTANTIATED (App.vue), NEVER FLAG-GATED
 * The flag gates surfaces and action, not observation: `wouldBeReadOnly` must be computed in
 * prod before the flag ships, or the dry-run soak has nothing to measure.
 *
 * `isReadOnly` is the ONLY value that acts. It needs all three: the flag, the server's
 * `enforced`, and an effective state of `read_only`.
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { TRIAL_DAYS } from '@beanies/brand/pricing';
import type { Entitlement, EntitlementState, RegistryEntry } from '@/types/models';
import { addRegistryEntryObserver, lookupFamilyResult } from '@/services/registry/registryService';
import { readEntitlementCache, writeEntitlementCache } from '@/services/billing/entitlementCache';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import { setWriteGate } from '@/services/automerge/worker/writeGate';
import { getSettings as projectionGetSettings } from '@/services/automerge/projection';
import { logEvent } from '@/services/telemetry';
import { isPricingAvailable } from '@/services/billing/pricingGate';
import { useOnline } from '@/composables/useOnline';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { OFFLINE_GRACE_DAYS } from '@/constants/entitlement';
import { useFamilyContextStore } from './familyContextStore';

const SURFACE = 'entitlement';
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long an open-ended cached answer is honoured without the registry. Plan requirement 5. */
export const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * DAY_MS;
/** The floor between two registry asks started here, for every reason except `force`. */
export const REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;
/** 60 min, not 15: a 14-day rule and a 90-day clock do not care about minutes, and the
 *  registry GET route has no throttle of its own. */
export const ENTITLEMENT_POLL_MS = 60 * 60 * 1000;

/** The live store's registry observer remover (module scope: survives store re-creation). */
let removeEntryObserver: (() => void) | null = null;

export const useEntitlementStore = defineStore('entitlement', () => {
  const familyContextStore = useFamilyContextStore();
  const { isOnline } = useOnline();

  // ── State ──────────────────────────────────────────────────────────────────
  const entitlement = ref<Entitlement | null>(null);
  /** Epoch ms when the registry last answered for the active family, on this device. */
  const fetchedAt = ref<number | null>(null);
  /** Server clock minus device clock at `fetchedAt`; see "THE DEVICE CLOCK IS NOT TRUSTED". */
  const clockOffsetMs = ref(0);
  /**
   * The clock the two offline rules read. A ref, not `Date.now()` inside a computed (which
   * would cache forever): bumped on every `ask()` (hourly, on activation, on coming back
   * online, on a refresh) and on every answer, which is far finer than a 14-day or 90-day
   * boundary needs, offline included (the gate bumps it before deciding not to ask).
   */
  const now = ref(Date.now());
  /** The device clock corrected to the server's, as of the last answer. Rule 2 and
   *  `trialDaysLeft` read this; rule 1 (an age) does not. */
  const serverNow = computed(() => now.value + clockOffsetMs.value);

  // ── Derived ────────────────────────────────────────────────────────────────
  const effective = computed<{ state: EntitlementState; stale: boolean } | null>(() => {
    const e = entitlement.value;
    if (!e) return null;
    // Rule 1: open-ended answers expire into "unverified". An age on the device clock alone.
    if ((e.state === 'active' || e.state === 'beta') && fetchedAt.value !== null) {
      if (now.value - fetchedAt.value > OFFLINE_GRACE_MS) {
        return { state: 'read_only', stale: true };
      }
    }
    // Rule 2: a trial ends on its server date, connected or not.
    if (e.state === 'trial' && e.trialEndsAt) {
      const endMs = Date.parse(e.trialEndsAt);
      if (Number.isFinite(endMs) && serverNow.value >= endMs) {
        return { state: 'read_only', stale: false };
      }
    }
    return { state: e.state, stale: false };
  });

  /** The state after the offline rules; `null` until this device has ever heard an answer. */
  const state = computed<EntitlementState | null>(() => effective.value?.state ?? null);
  /** True when `read_only` only because an open-ended answer is older than the grace window. */
  const isStale = computed(() => effective.value?.stale ?? false);
  const reason = computed(() => entitlement.value?.reason ?? null);
  const plan = computed(() => entitlement.value?.plan ?? null);
  const cohort = computed(() => entitlement.value?.cohort ?? null);
  const trialEndsAt = computed(() => entitlement.value?.trialEndsAt ?? null);
  const currentPeriodEnd = computed(() => entitlement.value?.currentPeriodEnd ?? null);
  const cancelAt = computed(() => entitlement.value?.cancelAt ?? null);
  const pastDue = computed(() => entitlement.value?.pastDue === true);
  const interval = computed(() => entitlement.value?.interval ?? null);

  /** Would the client act on a read-only answer? The flag is read at call time (it changes
   *  only on reload), the server's `enforced` per answer. */
  function acts(e: Entitlement | null): boolean {
    return isPricingAvailable() && e?.enforced === true;
  }

  /** The one value that blocks writes (Phase 3) and shows the band. */
  const isReadOnly = computed(() => acts(entitlement.value) && state.value === 'read_only');
  /** Read-only in every respect except that nothing acts on it: the dry-run soak signal. */
  const wouldBeReadOnly = computed(() => state.value === 'read_only' && !isReadOnly.value);

  /** Whole days left in the trial (0 on the last day's end), or null outside a dated trial. */
  const trialDaysLeft = computed<number | null>(() => {
    if (state.value !== 'trial' || !trialEndsAt.value) return null;
    const endMs = Date.parse(trialEndsAt.value);
    if (!Number.isFinite(endMs)) return null;
    return Math.max(0, Math.ceil((endMs - serverNow.value) / DAY_MS));
  });

  /** "Day N of 90" for the meter, clamped so an override date never reads day 0 or 91. */
  const trialDay = computed<number | null>(() => {
    if (trialDaysLeft.value === null) return null;
    return Math.min(TRIAL_DAYS, Math.max(1, TRIAL_DAYS - trialDaysLeft.value + 1));
  });

  // ── Logging ────────────────────────────────────────────────────────────────
  function logApplied(source: 'server' | 'cache'): void {
    const e = entitlement.value;
    if (!e) return;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'entitlement applied',
      context: {
        action: 'applied',
        kind: source,
        entitlement_state: state.value,
        plan: e.plan,
        dry_run: !acts(e),
        // `stale` is a boolean, not an allowlisted key: it rides the generic `detail`.
        ...(isStale.value ? { detail: 'stale' } : {}),
      },
    });
  }

  /**
   * A paid family whose doc has lost its plan token (#95 Important Notes: a concurrent
   * whole-object `setSettings` from another device can drop it). Portal and the `full` AI
   * allowance quietly behave as basic until greg re-issues, so make it loud, once per family
   * per session, with the fix in the console line.
   */
  const planTokenMissingLogged = new Set<string>();
  const docPlanToken = computed<string | null | undefined>(() => {
    void docVersion.value;
    // `undefined` = doc not loaded yet, so "absent" cannot be judged.
    if (!isDocLoaded()) return undefined;
    return projectionGetSettings()?.planToken ?? null;
  });

  watch(
    [() => entitlement.value?.plan ?? null, docPlanToken, () => familyContextStore.activeFamilyId],
    ([paidPlan, token, familyId]) => {
      if (!paidPlan || token !== null || !familyId) return;
      if (planTokenMissingLogged.has(familyId)) return;
      planTokenMissingLogged.add(familyId);
      console.error(
        `[entitlement] family ${familyId} has a paid plan but no plan token in its family data; ` +
          'the Customer Portal and the full AI allowance behave as basic until it is restored. ' +
          'Recovery is the one path that mints tokens: refund the current period in the Stripe Dashboard and ask the family to choose the plan again; the claim writes a fresh token. There is deliberately no token paste or reissue.'
      );
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'paid family has no plan token in its doc',
        context: { action: 'plan_token_missing', plan: paidPlan },
      });
    },
    { immediate: true }
  );

  // ── Apply ──────────────────────────────────────────────────────────────────
  function applyFromServer(familyId: string, e: Entitlement): void {
    const at = Date.now();
    const serverMs = Date.parse(e.serverTime);
    // An unparseable serverTime leaves the device clock as the only clock: offset 0.
    const offset = Number.isFinite(serverMs) ? serverMs - at : 0;
    entitlement.value = e;
    fetchedAt.value = at;
    clockOffsetMs.value = offset;
    now.value = at;
    const written = writeEntitlementCache(familyId, {
      entitlement: e,
      fetchedAt: at,
      clockOffsetMs: offset,
    });
    if (!written.ok) {
      // In-memory state is still right for this session; only the next offline launch loses it.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'entitlement cache write failed',
        context: { action: 'cache_write_failed' },
        error: written.error,
      });
    }
    logApplied('server');
  }

  /** The registry observer. Runs for every successful GET, whichever caller made it. */
  function onRegistryEntry(entry: RegistryEntry): void {
    const familyId = familyContextStore.activeFamilyId;
    // A lookup for some other family (a join, a recovery probe) says nothing about this one.
    if (!familyId || entry.familyId !== familyId) return;
    if (!entry.entitlement) {
      // `null`: the registry could not read the billing table (it logged
      // `entitlement_unavailable`). Absent: a registry Lambda older than #95. Either way keep
      // the cache, whose `fetchedAt` keeps ageing honestly toward the 14-day rule.
      logEvent({
        level: entry.entitlement === null ? 'warn' : 'info',
        surface: SURFACE,
        message: 'registry answered without an entitlement; keeping the cache',
        context: {
          action: 'refresh_failed',
          detail: entry.entitlement === null ? 'entitlement_unavailable' : 'entitlement_absent',
        },
      });
      return;
    }
    applyFromServer(familyId, entry.entitlement);
  }

  /** Load this device's cached answer for `familyId`, returning what the read found. */
  function loadCache(familyId: string | null): 'ok' | 'missing' | 'corrupt' | 'none' {
    entitlement.value = null;
    fetchedAt.value = null;
    clockOffsetMs.value = 0;
    lastAskedAt = null;
    now.value = Date.now();
    if (!familyId) return 'none';
    const cached = readEntitlementCache(familyId);
    if (cached.kind === 'ok') {
      entitlement.value = cached.value.entitlement;
      fetchedAt.value = cached.value.fetchedAt;
      clockOffsetMs.value = cached.value.clockOffsetMs;
      logApplied('cache');
      return 'ok';
    }
    if (cached.kind === 'corrupt') {
      // The cache module has already removed the record, so this fires once, not every open.
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'entitlement cache unreadable; removed and treated as no cache',
        context: { action: 'cache_read_failed', detail: 'corrupt' },
      });
      return 'corrupt';
    }
    // `missing` is the normal first open of a family on a device (or cleared storage), so it
    // is counted at info rather than raised: a warning here would drown the corrupt case.
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'no cached entitlement on this device',
      context: { action: 'cache_read_failed', detail: 'missing' },
    });
    return 'missing';
  }

  // ── The one place a lookup starts ──────────────────────────────────────────
  type AskReason = 'activation' | 'poll' | 'online' | 'manual' | 'force';

  /** When `ask()` last started a lookup, device clock; reset per family by `loadCache`. */
  let lastAskedAt: number | null = null;
  let inFlight: { familyId: string; promise: Promise<void> } | null = null;
  /** A forced ask waiting for `inFlight` to finish. Later forces share it rather than chain. */
  let queuedForce: { familyId: string; promise: Promise<void> } | null = null;

  /**
   * The gate. Every lookup this store makes starts here, and nowhere else.
   *
   *   (a) The active family and connectivity are read NOW, never captured by a caller, so a
   *       family switch or a dropped connection between scheduling and running is respected.
   *       Offline it only advances the clock: the cache stays, the grace window bounds it.
   *   (b) An ask already in flight for the same family is shared. A `force` must be answered
   *       by a lookup that STARTED after it was requested (Phase 5's claim), so it queues one
   *       follow-up behind the in-flight ask, and any further force shares that follow-up.
   *   (c) At most one ask per `REFRESH_MIN_INTERVAL_MS` for every reason but `force`, counting
   *       an answer the observer applied from someone else's GET. A clock corrected backwards
   *       (now before the last ask) reads as "long ago", so it can never suppress asks.
   *   (d) Each lookup it starts is logged once with its reason.
   */
  function ask(reason: AskReason): Promise<void> {
    now.value = Date.now();
    const familyId = familyContextStore.activeFamilyId;
    if (!familyId || !isOnline.value) return Promise.resolve();

    const pending = inFlight?.familyId === familyId ? inFlight.promise : null;
    if (reason === 'force') {
      if (!pending) return startLookup(familyId, reason);
      if (queuedForce?.familyId === familyId) return queuedForce.promise;
      const promise = pending.then(() => {
        queuedForce = null;
        // Re-enters the gate, so the family and connectivity are read again when it runs.
        return ask('force');
      });
      queuedForce = { familyId, promise };
      return promise;
    }
    if (pending) return pending;

    const last = Math.max(lastAskedAt ?? -Infinity, fetchedAt.value ?? -Infinity);
    if (last !== -Infinity) {
      const elapsed = now.value < last ? Infinity : now.value - last;
      if (elapsed < REFRESH_MIN_INTERVAL_MS) return Promise.resolve();
    }
    return startLookup(familyId, reason);
  }

  function startLookup(familyId: string, reason: AskReason): Promise<void> {
    lastAskedAt = now.value;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'entitlement ask',
      context: { action: reason },
    });
    const promise = lookup(familyId).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { familyId, promise };
    return promise;
  }

  /** One registry GET. The observer applies a `found` answer; this reports the rest. */
  async function lookup(familyId: string): Promise<void> {
    const result = await lookupFamilyResult(familyId);
    if (result.status === 'found') return;
    logEvent({
      // `absent` is a family with no registry row (a self-host, or a family never registered):
      // expected, so info. `unavailable` is the registry failing: a warning.
      level: result.status === 'unavailable' ? 'warn' : 'info',
      surface: SURFACE,
      message: 'entitlement refresh failed; keeping the cache',
      context: { action: 'refresh_failed', detail: result.status },
    });
  }

  /**
   * Public: ask the registry again. `{ force: true }` skips the 5-minute floor and is answered
   * by a lookup that started after the call (Phase 5, right after a claim).
   */
  function refresh(opts: { force?: boolean } = {}): Promise<void> {
    return ask(opts.force ? 'force' : 'manual');
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  // ONE observer per app: a re-created store (each Pinia in tests) replaces its predecessor's
  // rather than stacking another beside it (review round 1).
  removeEntryObserver?.();
  removeEntryObserver = addRegistryEntryObserver(onRegistryEntry);
  // Phase 3: `docClient.mutate` asks this before every family-data write. Read at call time, so
  // it always reflects the current flag, answer and clock; `wouldBlock` feeds the dry-run soak.
  setWriteGate(() => ({ block: isReadOnly.value, wouldBlock: wouldBeReadOnly.value }));

  watch(
    () => familyContextStore.activeFamilyId,
    (familyId) => {
      // Only a family this device knows nothing about is asked straight away. A cached answer
      // is enough until `checkCanonicalPod`'s own GET (every provider, once per session) or
      // the hourly poll; asking here too would double the boot GET for every family.
      const found = loadCache(familyId);
      if (found === 'missing' || found === 'corrupt') void ask('activation');
    },
    { immediate: true }
  );

  // Back online: a stale read-only family's copy promises it recovers when reconnected.
  watch(isOnline, (online) => {
    if (online) void ask('online');
  });

  // No `fireImmediatelyOnVisible`: see "HOW THE ANSWER ARRIVES".
  usePollWhileVisible(() => ask('poll'), ENTITLEMENT_POLL_MS, { surface: SURFACE });

  // A tab shown again after hours hidden re-evaluates the rules straight away, with no
  // request: a trial that ended while the tab was hidden shows on return, not at the next
  // hourly tick. The store lives for the app's lifetime, so the listener is never removed.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') now.value = Date.now();
    });
  }

  return {
    entitlement,
    fetchedAt,
    state,
    isStale,
    reason,
    plan,
    cohort,
    trialEndsAt,
    currentPeriodEnd,
    cancelAt,
    pastDue,
    interval,
    isReadOnly,
    wouldBeReadOnly,
    trialDaysLeft,
    trialDay,
    refresh,
  };
});
