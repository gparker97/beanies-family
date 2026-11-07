/**
 * Live flight checks (#143, ADR-045): the orchestrator between the family's travel segments,
 * the device cache and the anonymous `flight-status` Lambda. Components read
 * `verificationFor(segmentId)` (one view model, the six states) and call `revert` /
 * `takeAirline`; only this store calls the service; the ONLY pod write is
 * `vacationStore.updateSegment`, with a patch decided by `utils/flightStatus/verify.ts`.
 *
 * TRIGGERS, installed once by `setup()` (called from `App.vue` beside the weather store), all
 * feed ONE entry point, `request(kind)`, through a trailing single-flight:
 *   - `open`: setup itself;
 *   - `online`: back online;
 *   - `foreground`: `useToday().lastVisibleAt` (a tab shown again);
 *   - `tick`: every 15 minutes while visible (the per-flight `minIntervalMs` decides whether
 *     anything is fetched; the tick also moves the clock the chips read);
 *   - `segment-changed`: a debounced watch on the candidates' ids, dates, airlines, numbers
 *     and airports, and on the gate. An apply moves `departureDate`, which fires it; freshness
 *     is by TIME over the USABLE check (`usableCheck`), and an apply writes the leg's own day,
 *     so the store's own write never refetches, while a hand edit to another day does.
 *
 * Each run evaluates `pickFlightRefresh` per candidate (flight types with a date in an
 * upcoming trip), soonest departure first, and fetches at most `MAX_FETCHES_PER_RUN`; the rest
 * wait for the next trigger. A fetched answer is matched (`pickLeg`), cached, and written into
 * the segment when `shouldApply` says so. Nothing pages Slack from here: a failed apply is a
 * warning because the live value is still shown and the next run retries.
 *
 * WRITES ARE PERMISSIONED. Every pod write from here (apply, cancellation, reinstatement,
 * "Put it back", "Use the airline's") goes through `writeSegment`, which requires the page's
 * own edit permission (`usePermissions().canEditActivities`). A member who may not edit trips
 * still fetches and sees the airline's word (`changed` with `applied: false`), and their
 * device never writes it.
 *
 * GATE. `isEnabled` (the device switch AND the plan) is the single predicate: no request
 * leaves an unentitled or switched-off device, and its cards fall back to the synced fields.
 *
 * SIGN-OUT HALTS FIRST, THEN DELETES (`haltForSignOut`, the weather precedent).
 */
import { defineStore } from 'pinia';
import { computed, effectScope, ref, watch } from 'vue';
import type {
  FlightCheck,
  FlightCheckFailure,
  FlightStatusErrorCode,
  FlightVerification,
} from '@/types/flightStatus';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import {
  FlightStatusApiError,
  fetchFlightLegs,
  isFlightStatusConfigured,
} from '@/services/flightStatus/flightStatusApi';
import { devFetchBudgetActive, takeDevFetchTokens } from '@/services/flightStatus/devFetchBudget';
import {
  clearFlightStatusCache,
  emptyFlightStatusCache,
  pruneFlightStatusCache,
  readFlightStatusCache,
  writeFlightStatusCache,
} from '@/services/flightStatus/flightStatusCache';
import { logEvent } from '@/services/telemetry';
import { createChangeGate, type ChangeGate } from '@/services/telemetry/emitPolicy';
import { nextBackoffMs } from '@/utils/backoff';
import { createTrailingSingleFlight } from '@/utils/trailingSingleFlight';
import { liveNoticeId } from '@/utils/notifications/travel';
import { isFlightType } from '@/utils/travelCodes';
import { normaliseFlightNumber } from '@/utils/flightStatus/flightNumber';
import { operatedAs, pickLeg } from '@/utils/flightStatus/match';
import {
  diffTuple,
  revisionOf,
  tupleFromLeg,
  tupleFromSegment,
} from '@/utils/flightStatus/schedule';
import {
  deriveVerification,
  planChange,
  revertPlan,
  shouldApply,
  takeProviderPatch,
  usableCheck as usableCheckFor,
  type SegmentPatch,
} from '@/utils/flightStatus/verify';
import {
  FLIGHT_POLL_MS,
  flightTiming,
  pickFlightRefresh,
  type FlightSkipReason,
} from '@/utils/flightStatus/window';
import { useOnline } from '@/composables/useOnline';
import { usePermissions } from '@/composables/usePermissions';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { useToday } from '@/composables/useToday';
import { useEntitlementStore } from './entitlementStore';
import { useFamilyContextStore } from './familyContextStore';
import { useSettingsStore } from './settingsStore';
import { useTranslationStore } from './translationStore';
import { useVacationStore, type SegmentWriteResult } from './vacationStore';

const SURFACE = 'travel-verify';
/** Provider calls per run at most; the rest wait for the next trigger (fairness by soonest). */
export const MAX_FETCHES_PER_RUN = 4;
/** The segment watch's debounce: a typing family member is one request, not ten. */
export const SEGMENT_CHANGE_DEBOUNCE_MS = 2_000;

/** What started a run. Rides the `kind` context key. */
export type FlightRefreshKind = 'open' | 'foreground' | 'online' | 'tick' | 'segment-changed';

interface Candidate {
  vacationId: string;
  segment: VacationTravelSegment;
}

export const useFlightStatusStore = defineStore('flightStatus', () => {
  const vacationStore = useVacationStore();
  const settingsStore = useSettingsStore();
  const familyContextStore = useFamilyContextStore();
  const translationStore = useTranslationStore();
  const { isOnline } = useOnline();
  const { lastVisibleAt } = useToday();

  // ── State ──────────────────────────────────────────────────────────────────
  /** This device's latest answer per segment id (hydrated from the cache). */
  const checks = ref<Record<string, FlightCheck>>({});
  /** The failure backoff per segment id. */
  const failures = ref<Record<string, FlightCheckFailure>>({});
  /** Change/cancel notice id → epoch ms this device first saw it (see `noticeFirstSeen`). */
  const noticed = ref<Record<string, number>>({});
  /** Notice id → epoch ms this device tapped "Got it" (see `dismissNotice`). */
  const dismissed = ref<Record<string, number>>({});
  /** Segment ids with a request in flight. */
  const inFlight = ref<Set<string>>(new Set());
  /** The clock the verifications read: bumped by every run, answer and tick. */
  const nowMs = ref(Date.now());
  /** Set by `haltForSignOut`; lifted at the next session boundary. */
  const halted = ref(false);

  /** The family the in-memory checks belong to. */
  let loadedFamilyId: string | null = null;
  /** Controllers of the requests in flight (not reactive), aborted on sign-out. */
  const controllers = new Set<AbortController>();

  // ── Derived ────────────────────────────────────────────────────────────────
  const docReady = computed(() => {
    void docVersion.value;
    return isDocLoaded();
  });

  /** The family home zone: what a stored wall clock means when no check is cached yet. */
  const homeZone = computed(() => {
    void settingsStore.settings;
    void lastVisibleAt.value;
    return settingsStore.resolveHomeTimeZoneNow().zone;
  });

  /**
   * Is live checking part of this family's plan? Everyone is, until the client would act on
   * the entitlement answer (`enforces` false = the dry-run soak). Then: trial, beta, or an
   * active magic beans (`full`) plan. A `null` state while enforced (first launch, no cached
   * answer) is not entitled until the answer lands; cards read "Not checked live".
   */
  const isEntitled = computed(() => {
    // Resolved lazily, on first read: instantiating the entitlement store installs the
    // registry observer and starts a lookup, which the sign-out step (`haltForSignOut`, which
    // never reads this) must not trigger. `App.vue` instantiates it first in the app anyway.
    const entitlementStore = useEntitlementStore();
    if (!entitlementStore.enforces) return true;
    const state = entitlementStore.state;
    return (
      state === 'trial' ||
      state === 'beta' ||
      (state === 'active' && entitlementStore.plan === 'full')
    );
  });
  /** The single predicate: no provider call is made when false. */
  const isEnabled = computed(() => settingsStore.liveFlightChecksEnabled && isEntitled.value);
  /** Change and cancellation notices (bell, OS) are shown. */
  const alertsEnabled = computed(() => settingsStore.liveFlightChangeAlerts && isEnabled.value);

  /** Flight segments with a departure date in a trip that is not over. */
  const candidateSegments = computed<Candidate[]>(() =>
    vacationStore.upcomingVacations.flatMap((v: FamilyVacation) =>
      (v.travelSegments ?? [])
        .filter((s) => isFlightType(s.type) && !!s.departureDate)
        .map((segment) => ({ vacationId: v.id, segment }))
    )
  );

  /** Every travel segment the family has, by id (verifications are total over these). */
  const segmentsById = computed(() => {
    const map = new Map<string, Candidate>();
    for (const v of vacationStore.vacations) {
      for (const segment of v.travelSegments ?? []) {
        map.set(segment.id, { vacationId: v.id, segment });
      }
    }
    return map;
  });

  /** This device's check for the segment, only while it still fits the segment's current
   *  flight number and day (`usableCheck` in verify.ts); else none, and the next run fetches. */
  function usableCheck(seg: VacationTravelSegment): FlightCheck | undefined {
    return usableCheckFor(seg, checks.value[seg.id]);
  }

  function verify(seg: VacationTravelSegment): FlightVerification {
    const check = usableCheck(seg);
    const timing = flightTiming(seg, check, homeZone.value, nowMs.value);
    const v = deriveVerification(seg, check, failures.value[seg.id], {
      nowMs: nowMs.value,
      inWindow: timing.inWindow,
      ...(timing.opensAt !== undefined ? { opensAt: new Date(timing.opensAt).toISOString() } : {}),
      past: timing.past,
      departed: timing.departed,
      enabled: settingsStore.liveFlightChecksEnabled,
      entitled: isEntitled.value,
      configured: isFlightStatusConfigured(),
      online: isOnline.value,
    });
    // The device-side fold of the notice block rides on the verification, so the card has one
    // input. Keyed on the notice id: a new airline revision is a new, undismissed notice.
    if (v.state === 'changed' || v.state === 'cancelled') {
      const id = liveNoticeId(seg.id, seg);
      if (id !== null && dismissed.value[id] !== undefined) return { ...v, dismissed: true };
    }
    return v;
  }

  /** One verification per travel segment, rebuilt from the checks, failures, clock and
   *  segments: no hand-rolled memo or invalidation. Only flights pay for timing (zone maths);
   *  every other segment is `not-live` outright, exactly as `deriveVerification` says. */
  const verifications = computed<Map<string, FlightVerification>>(() => {
    const map = new Map<string, FlightVerification>();
    for (const [id, c] of segmentsById.value) {
      map.set(id, isFlightType(c.segment.type) ? verify(c.segment) : { state: 'not-live' });
    }
    return map;
  });

  function verificationFor(segmentId: string): FlightVerification | undefined {
    return verifications.value.get(segmentId);
  }

  /** Epoch ms of this device's most recent successful check, or null. */
  const lastCheckedAt = computed<number | null>(() => {
    let latest: number | null = null;
    for (const c of Object.values(checks.value)) {
      if (latest === null || c.checkedAt > latest) latest = c.checkedAt;
    }
    return latest;
  });

  // ── Cache ──────────────────────────────────────────────────────────────────
  function hydrate(familyId: string | null): void {
    loadedFamilyId = familyId;
    const cached = familyId ? readFlightStatusCache(familyId) : null;
    checks.value = cached ? { ...cached.checks } : {};
    failures.value = cached ? { ...cached.failures } : {};
    noticed.value = cached ? { ...cached.noticed } : {};
    dismissed.value = cached ? { ...cached.dismissed } : {};
  }

  let cacheWriteWarned = false;
  function persist(): void {
    if (!loadedFamilyId || halted.value) return;
    const written = writeFlightStatusCache({
      ...emptyFlightStatusCache(loadedFamilyId),
      checks: checks.value,
      failures: failures.value,
      noticed: noticed.value,
      dismissed: dismissed.value,
    });
    if (written.ok || cacheWriteWarned) return;
    // The in-memory checks still show; only the next cold start refetches. Once per session.
    cacheWriteWarned = true;
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'flight cache write failed',
      context: { action: 'cache', error_code: 'cache_write_failed' },
      error: written.error,
    });
  }

  /** Drop entries for deleted segments and flights that are over. Only once the doc is
   *  loaded: before that, every segment looks deleted. */
  function prune(now: number): void {
    if (!loadedFamilyId || !docReady.value) return;
    const before = {
      ...emptyFlightStatusCache(loadedFamilyId),
      checks: checks.value,
      failures: failures.value,
      noticed: noticed.value,
      dismissed: dismissed.value,
    };
    const after = pruneFlightStatusCache(before, new Set(segmentsById.value.keys()), now);
    if (after === before) return;
    checks.value = after.checks;
    failures.value = after.failures;
    noticed.value = after.noticed;
    dismissed.value = after.dismissed;
    persist();
  }

  /**
   * When THIS device first saw a change/cancel notice (epoch ms); stamped and persisted on the
   * first call for an id. The OS notice fires at this + 5 s, so a revision fires once per device
   * (including one that syncs it days later) and a reschedule never moves it.
   */
  function noticeFirstSeen(id: string): number {
    const known = noticed.value[id];
    if (known !== undefined) return known;
    const now = Date.now();
    noticed.value = { ...noticed.value, [id]: now };
    persist();
    return now;
  }

  // ── Logging ────────────────────────────────────────────────────────────────
  const refusedGate = createChangeGate();
  let notConfiguredLogged = false;
  /** `segmentId|revision` pairs whose Conflict was already reported this session. */
  const conflictsLogged = new Set<string>();

  function logRefused(reason: FlightSkipReason | null): void {
    // Every run passes through the gate, so a transition back to allowed is visible too.
    const signature = reason === 'unentitled' || reason === 'disabled' ? reason : 'allowed';
    if (!refusedGate(signature) || signature === 'allowed') return;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'flight check refused',
      context: { action: 'refused', detail: signature },
    });
  }

  function logNotConfigured(): void {
    if (notConfiguredLogged) return;
    notConfiguredLogged = true;
    console.warn(
      '[flight-status] live flight checks are off in this build: set VITE_FLIGHT_STATUS_URL and VITE_FLIGHT_STATUS_API_KEY'
    );
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'flight check not configured',
      context: { action: 'check_failed', error_code: 'not_configured' },
    });
  }

  const devCapGate = createChangeGate();
  /** Dev only: the day's provider fetches are spent. Once per UTC day, on the console too,
   *  since the chip just says "Couldn't check" and a dev would otherwise hunt for a bug. */
  function logDevCap(used: number, cap: number, nowMs: number): void {
    if (!devCapGate(new Date(nowMs).toISOString().slice(0, 10))) return;
    console.warn(
      `[flight-status] dev build spent its ${used}/${cap} provider fetches for today; flights show "Couldn't check" until UTC midnight (DEV_DAILY_FETCH_CAP in devFetchBudget.ts)`
    );
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'flight check dev budget spent',
      context: { action: 'refused', detail: 'dev_cap', count: used },
    });
  }

  function logConflict(seg: VacationTravelSegment, v: FlightVerification): void {
    if (v.state !== 'conflict' || !v.provider) return;
    const key = `${seg.id}|${revisionOf(v.provider)}`;
    if (conflictsLogged.has(key)) return;
    conflictsLogged.add(key);
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'flight conflict shown',
      context: { action: 'conflict' },
    });
  }

  // ── Writes ─────────────────────────────────────────────────────────────────
  function copy() {
    return { t: translationStore.t, lang: translationStore.currentLanguage };
  }

  /** The changed field names for `flight_fields` ("departureTime,terminal"), never values. */
  function fieldsOf(seg: VacationTravelSegment, check: FlightCheck): string {
    if (!check.leg) return '';
    const d = diffTuple(tupleFromSegment(seg), tupleFromLeg(check.leg, check.arrivalLeg));
    return [...d.changed, ...d.filled].join(',');
  }

  /**
   * The permission every pod write from this store requires: the same one the travel page's
   * `requireEdit()` checks. Resolved once, lazily (the `useMagicReader` precedent):
   * `usePermissions()` registers an app-lifetime diagnostic watch per call, and resolving it
   * at store setup would instantiate the auth store from inside the sign-out path.
   */
  let permissions: ReturnType<typeof usePermissions> | null = null;
  function mayEdit(): boolean {
    permissions ??= usePermissions();
    return permissions.canEditActivities.value;
  }

  /** What a store write is: an automatic apply (by the state it writes) or a family action. */
  type WriteKind = 'changed' | 'cancelled' | 'verified' | 'revert' | 'take_airline';

  /** Per segment: the "not written, no permission" skip, once per segment (and heartbeat). */
  const skipGates = new Map<string, ChangeGate>();
  function logNoPermission(segmentId: string, what: WriteKind): void {
    let gate = skipGates.get(segmentId);
    if (!gate) {
      gate = createChangeGate();
      skipGates.set(segmentId, gate);
    }
    if (!gate(what)) return;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'flight change not written',
      context: {
        action: 'apply_skipped',
        detail: 'no_permission',
        // `flight_state` is a closed vocabulary of verification states; an action rides `kind`.
        ...(what === 'revert' || what === 'take_airline' ? { kind: what } : { flight_state: what }),
      },
    });
  }

  /**
   * The ONE pod write: `vacationStore.updateSegment`, only for a member who may edit trips.
   * Otherwise `'refused'` and nothing is written (the airline's word still shows, as
   * `changed` / `cancelled` with `applied: false`); callers then answer `'failed'`. `what`
   * names the write in the skip event.
   */
  async function writeSegment(
    c: Candidate,
    patch: SegmentPatch,
    what: WriteKind
  ): Promise<SegmentWriteResult | 'refused'> {
    if (!mayEdit()) {
      logNoPermission(c.segment.id, what);
      return 'refused';
    }
    return vacationStore.updateSegment(c.vacationId, c.segment.id, patch);
  }

  /** Write a patch; log the outcome. `missing`/`failed` keep the check: the next run retries. */
  async function write(
    c: Candidate,
    patch: SegmentPatch,
    outcome: { state: 'changed' | 'cancelled' | 'verified'; fields: string; quiet: boolean }
  ): Promise<SegmentWriteResult> {
    const written = await writeSegment(c, patch, outcome.state);
    if (written === 'refused') return 'failed';
    const result = written;
    if (result === 'saved') {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'flight change applied',
        context: {
          action: 'applied',
          flight_state: outcome.state,
          flight_fields: outcome.fields,
          ...(outcome.quiet ? { detail: 'quiet_fill' } : {}),
        },
      });
    } else {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'flight change apply failed',
        context: { action: 'apply_failed', save_status: result },
      });
    }
    return result;
  }

  async function applyIfDue(c: Candidate, check: FlightCheck): Promise<void> {
    const leg = check.leg;
    if (!leg || !shouldApply(c.segment, leg, check.arrivalLeg)) return;
    const patch = planChange(c.segment, leg, check.arrivalLeg, Date.now(), copy());
    const cancelled = patch.status === 'pending' && patch.liveCancelledAt !== undefined;
    await write(c, patch, {
      state: cancelled ? 'cancelled' : patch.liveAppliedAt ? 'changed' : 'verified',
      fields: cancelled ? 'status' : fieldsOf(c.segment, check),
      quiet: !cancelled && patch.liveAppliedAt === undefined,
    });
  }

  // ── Fetching ───────────────────────────────────────────────────────────────
  /** The candidate as the store holds it NOW (an answer can land after an edit or delete). */
  function current(segmentId: string): Candidate | undefined {
    return segmentsById.value.get(segmentId);
  }

  async function checkOne(c: Candidate, query: string, date: string, kind: FlightRefreshKind) {
    const familyId = loadedFamilyId;
    const id = c.segment.id;
    const controller = new AbortController();
    controllers.add(controller);
    inFlight.value.add(id);
    const started = Date.now();
    try {
      const answer = await fetchFlightLegs({ flight: query, date, signal: controller.signal });
      const durationMs = Date.now() - started;
      if (halted.value || familyId !== loadedFamilyId) return;
      const now = current(id);
      if (!now) return;
      const pick = pickLeg(answer.legs, now.segment);
      // TODO(#143 plan Requirement 10): an `ambiguous` pick is where the AI residue arm would
      // run; it is not built (Spike 0 has not shown an ambiguous booking), so it is `no_match`.
      const matched = pick && pick.how !== 'ambiguous' ? pick : null;
      const check: FlightCheck = {
        v: 1,
        segmentId: id,
        flight: query,
        date,
        checkedAt: Date.now(),
        leg: matched?.leg ?? null,
        ...(matched && matched.arrivalLeg !== undefined ? { arrivalLeg: matched.arrivalLeg } : {}),
        match: matched ? 'deterministic' : 'none',
        ...(matched ? {} : { miss: answer.legs.length === 0 ? 'no_coverage' : 'no_match' }),
        ...(matched && operatedAs(matched.leg, query)
          ? { operatedAs: operatedAs(matched.leg, query) }
          : {}),
      };
      checks.value = { ...checks.value, [id]: check };
      if (failures.value[id]) {
        const { [id]: _cleared, ...rest } = failures.value;
        failures.value = rest;
      }
      nowMs.value = Date.now();
      persist();
      await applyIfDue(now, check);
      const after = current(id);
      const v = after ? verify(after.segment) : undefined;
      if (after && v) logConflict(after.segment, v);
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'flight check done',
        context: {
          action: 'checked',
          kind,
          flight_match: check.match,
          flight_state: v?.state ?? 'unavailable',
          perf_duration_ms: durationMs,
          http_status: 200,
          ...(answer.cached ? { detail: 'cached' } : {}),
        },
      });
    } catch (e) {
      onFailure(id, e, familyId);
    } finally {
      controllers.delete(controller);
      inFlight.value.delete(id);
    }
  }

  function onFailure(id: string, error: unknown, familyId: string | null): void {
    const typed = error instanceof FlightStatusApiError ? error : null;
    // The caller moved on (sign-out): never stored or shown.
    if (typed?.code === 'aborted' || halted.value || familyId !== loadedFamilyId) return;
    if (typed?.code === 'not_configured') return logNotConfigured();
    const code: Exclude<FlightStatusErrorCode, 'not_configured'> =
      (typed?.code as Exclude<FlightStatusErrorCode, 'not_configured'> | undefined) ?? 'parse';
    const count = (failures.value[id]?.count ?? 0) + 1;
    const now = Date.now();
    failures.value = {
      ...failures.value,
      [id]: { code, count, until: now + nextBackoffMs(count, code) },
    };
    nowMs.value = now;
    persist();
    console.warn(
      `[flight-status] check failed (${code}): ${typed?.devHint ?? 'unexpected error, see the report'}`
    );
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'flight check failed',
      context: {
        action: 'check_failed',
        error_code: code,
        http_status: typed?.httpStatus ?? 0,
        consecutive_failures: count,
      },
      error,
    });
  }

  /** One pass over the candidates: decide each, fetch the due ones (soonest first, capped). */
  async function run(kind: FlightRefreshKind): Promise<void> {
    const now = Date.now();
    nowMs.value = now;
    const familyId = familyContextStore.activeFamilyId;
    if (familyId !== loadedFamilyId) hydrate(familyId);
    if (!familyId) return;
    prune(now);

    const configured = isFlightStatusConfigured();
    const histogram = new Map<string, number>();
    const due: Array<{ c: Candidate; query: string; date: string; departureMs: number }> = [];
    /** Fresh answers whose write is still owed (refused or failed earlier): retried from the
     *  cache, with no provider call. */
    const owed: Array<{ c: Candidate; check: FlightCheck }> = [];
    let globalReason: FlightSkipReason | null = null;

    for (const c of candidateSegments.value) {
      const seg = c.segment;
      const number = normaliseFlightNumber(seg.airline, seg.flightNumber);
      const check = usableCheck(seg);
      const timing = flightTiming(seg, check, homeZone.value, now);
      const decision = pickFlightRefresh({
        halted: halted.value,
        entitled: isEntitled.value,
        enabled: settingsStore.liveFlightChecksEnabled,
        configured,
        online: isOnline.value,
        hasFlightNumber: number !== null,
        past: timing.past,
        inWindow: timing.inWindow,
        nowMs: now,
        lastCheckedAt: check?.checkedAt ?? null,
        minIntervalMs: timing.minIntervalMs,
        backoffUntil: failures.value[seg.id]?.until ?? 0,
      });
      if (decision.action === 'skip') {
        histogram.set(decision.reason, (histogram.get(decision.reason) ?? 0) + 1);
        if (
          decision.reason === 'fresh' &&
          check?.leg &&
          !inFlight.value.has(seg.id) &&
          shouldApply(seg, check.leg, check.arrivalLeg) &&
          mayEdit()
        ) {
          owed.push({ c, check });
        }
        if (
          ['halted', 'unentitled', 'disabled', 'not_configured', 'offline'].includes(
            decision.reason
          )
        ) {
          globalReason ??= decision.reason;
        }
        continue;
      }
      if (inFlight.value.has(seg.id) || !number) continue;
      due.push({
        c,
        query: number.query,
        date: seg.departureDate!.slice(0, 10),
        departureMs: timing.departureMs ?? Number.MAX_SAFE_INTEGER,
      });
    }

    due.sort((a, b) => a.departureMs - b.departureMs);
    let batch = due.slice(0, MAX_FETCHES_PER_RUN);
    if (due.length > batch.length) histogram.set('over_cap', due.length - batch.length);
    // Dev builds spend the production provider's quota; cap them per device per day.
    if (devFetchBudgetActive() && batch.length > 0) {
      const grant = takeDevFetchTokens(batch.length, now);
      if (grant.granted < batch.length) {
        histogram.set('dev_cap', batch.length - grant.granted);
        logDevCap(grant.used, grant.cap, now);
        batch = batch.slice(0, grant.granted);
      }
    }

    logRefused(globalReason);
    if (globalReason === 'not_configured') logNotConfigured();
    const skipped = [...histogram.values()].reduce((a, b) => a + b, 0);
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'flight check run',
      context: {
        action: 'run',
        kind,
        count: candidateSegments.value.length,
        notif_skipped: skipped,
        detail: [...histogram].map(([r, n]) => `${r}=${n}`).join(',') || 'none',
      },
    });

    if (owed.length > 0) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'flight change write retried',
        context: { action: 'apply_retry', count: owed.length },
      });
    }
    await Promise.all([
      ...owed.map((o) => applyIfDue(o.c, o.check)),
      ...batch.map((d) => checkOne(d.c, d.query, d.date, kind)),
    ]);
  }

  // The latest trigger's kind wins: it is the one the trailing run answers.
  const flight = createTrailingSingleFlight<FlightRefreshKind, void>(
    run,
    (_q, incoming) => incoming
  );

  function request(kind: FlightRefreshKind): Promise<void> {
    nowMs.value = Date.now();
    return flight.call(kind).catch((e: unknown) => {
      // `run` catches its own failures; anything here is a bug in the store itself.
      logEvent({
        level: 'error',
        surface: SURFACE,
        message: 'flight check run threw',
        context: { action: 'run', kind },
        error: e,
      });
    });
  }

  /** The visible-tab tick: move the clock the chips read, then ask. */
  function tick(): Promise<void> {
    return request('tick');
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  /** "Put it back": restore the values from before the airline's change. The segment then
   *  disagrees with the airline while the revision matches, so it shows Conflict. */
  async function revert(segmentId: string): Promise<SegmentWriteResult> {
    const c = current(segmentId);
    if (!c) return 'missing';
    const patch = revertPlan(c.segment);
    if (Object.keys(patch).length === 0) {
      // Nothing recorded to put back (no `liveWas`): a no-op is never reported as reverted.
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'flight revert skipped',
        context: { action: 'revert_skipped', detail: 'no_was' },
      });
      return 'missing';
    }
    const written = await writeSegment(c, patch, 'revert');
    if (written === 'refused') return 'failed';
    const result = written;
    logEvent({
      level: result === 'saved' ? 'info' : 'warn',
      surface: SURFACE,
      message: result === 'saved' ? 'flight change reverted' : 'flight change apply failed',
      context:
        result === 'saved'
          ? { action: 'reverted' }
          : { action: 'apply_failed', save_status: result, detail: 'revert' },
    });
    return result;
  }

  /** "Use the airline's" (Conflict): write the cached leg, skipping `shouldApply` (whose
   *  revision rule is exactly what keeps a manual edit). `missing` without a USABLE cached
   *  leg: none at all, or one for another flight number or day (a stale answer is never
   *  written over the family's edit), logged so the refusal is visible. */
  async function takeAirline(segmentId: string): Promise<SegmentWriteResult> {
    const c = current(segmentId);
    if (!c) return 'missing';
    const check = usableCheck(c.segment);
    if (!check?.leg) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'flight airline refused',
        context: {
          action: 'take_airline',
          detail: !checks.value[segmentId] ? 'no_check' : check ? 'no_leg' : 'stale',
        },
      });
      return 'missing';
    }
    // An airline answer not yet recorded (a newer revision) is a real change: record it once,
    // with its notes line. Otherwise the change is already recorded and only the values return.
    const patch = shouldApply(c.segment, check.leg, check.arrivalLeg)
      ? planChange(c.segment, check.leg, check.arrivalLeg, Date.now(), copy())
      : takeProviderPatch(c.segment, check.leg, check.arrivalLeg);
    const written = await writeSegment(c, patch, 'take_airline');
    if (written === 'refused') return 'failed';
    const result = written;
    logEvent({
      level: result === 'saved' ? 'info' : 'warn',
      surface: SURFACE,
      message: result === 'saved' ? 'flight airline taken' : 'flight change apply failed',
      context:
        result === 'saved'
          ? { action: 'take_airline', flight_fields: fieldsOf(c.segment, check) }
          : { action: 'apply_failed', save_status: result, detail: 'take_airline' },
    });
    return result;
  }

  /**
   * Sign-out, BEFORE the session ends: stop asking, abort the requests in flight, wait for the
   * run to settle, drop the checks and only then delete the device cache, so no answer can
   * write the departing family's flights back. Never throws.
   */
  /**
   * "Got it": fold the change/cancel notice block away ON THIS DEVICE for the segment's
   * current revision. The chip and the struck-out values stay, and the chip reopens the block
   * (`showNotice`). Nothing is written to the pod: each family member reads the news once for
   * themselves. False when the segment carries no notice (nothing to dismiss).
   */
  function dismissNotice(segmentId: string): boolean {
    return setDismissed(segmentId, true);
  }

  /** The chip was tapped on a dismissed notice: show the block again. */
  function showNotice(segmentId: string): boolean {
    return setDismissed(segmentId, false);
  }

  function setDismissed(segmentId: string, on: boolean): boolean {
    const c = current(segmentId);
    const id = c ? liveNoticeId(segmentId, c.segment) : null;
    if (id === null) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'flight notice dismiss skipped',
        context: { action: on ? 'dismiss_skipped' : 'reopen_skipped', detail: 'no_notice' },
      });
      return false;
    }
    if (on) {
      dismissed.value = { ...dismissed.value, [id]: Date.now() };
    } else {
      const { [id]: _gone, ...rest } = dismissed.value;
      dismissed.value = rest;
    }
    persist();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: on ? 'flight notice dismissed' : 'flight notice reopened',
      context: {
        action: on ? 'dismissed' : 'reopened',
        flight_state: verificationFor(segmentId)?.state,
      },
    });
    return true;
  }

  async function haltForSignOut(): Promise<void> {
    halted.value = true;
    for (const c of controllers) c.abort();
    controllers.clear();
    const pending = flight.pending();
    if (pending) await pending.catch(() => undefined);
    checks.value = {};
    failures.value = {};
    noticed.value = {};
    dismissed.value = {};
    loadedFamilyId = null;
    clearFlightStatusCache();
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  /** Whether the session watch last saw a session (doc ready + an active family). */
  let lastSessionPresent = false;
  watch(
    [docReady, () => familyContextStore.activeFamilyId],
    ([ready, familyId]) => {
      // A session boundary lifts the sign-out latch: the session going away, or one starting.
      const present = ready && familyId !== null;
      if (!present || !lastSessionPresent) halted.value = false;
      lastSessionPresent = present;
      if (familyId !== loadedFamilyId && !halted.value) hydrate(familyId);
    },
    { immediate: true }
  );

  /** What makes a candidate a different question: the watch's signature, a string. */
  const candidateSignature = computed(() =>
    candidateSegments.value
      .map(({ segment: s }) =>
        [s.id, s.departureDate, s.airline, s.flightNumber, s.departureAirport, s.arrivalAirport]
          .map((v) => v ?? '')
          .join('|')
      )
      .join(';')
  );

  let scope: ReturnType<typeof effectScope> | null = null;
  /**
   * Install the triggers, once (later calls are no-ops). Run in the store's own detached
   * scope so the watches and the poll live as long as the store, not the caller.
   */
  function setup(): void {
    if (scope) return;
    scope = effectScope(true);
    scope.run(() => {
      watch(isOnline, (online) => {
        if (online) void request('online');
      });
      watch(lastVisibleAt, () => void request('foreground'));
      usePollWhileVisible(() => tick(), FLIGHT_POLL_MS, { surface: SURFACE });
      let timer: ReturnType<typeof setTimeout> | null = null;
      watch([candidateSignature, isEnabled], () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void request('segment-changed');
        }, SEGMENT_CHANGE_DEBOUNCE_MS);
      });
    });
    void request('open');
  }

  return {
    checks,
    failures,
    inFlight,
    nowMs,
    halted,
    isEntitled,
    isEnabled,
    alertsEnabled,
    candidateSegments,
    verifications,
    verificationFor,
    noticeFirstSeen,
    lastCheckedAt,
    request,
    run,
    revert,
    takeAirline,
    dismissNotice,
    showNotice,
    tick,
    haltForSignOut,
    setup,
  };
});
