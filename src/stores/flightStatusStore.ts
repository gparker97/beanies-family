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
 * "Put it back", "Update with airline data") goes through `writeSegment`, which requires the page's
 * own edit permission (`usePermissions().canEditActivities`). A member who may not edit trips
 * still fetches and sees the airline's word (`changed` with `applied: false`), and their
 * device never writes it.
 *
 * GATE. `isEnabled` (the device switch AND the plan) is the single predicate: no request
 * leaves an unentitled or switched-off device, and its cards fall back to the synced fields.
 *
 * SIGN-OUT HALTS FIRST, THEN DELETES (`haltForSignOut`, the weather precedent).
 *
 * PHASE 2: PUSH (ADR-046). On native, each run ends with `reconcileAlerts`: the pure
 * `desiredAlerts` / `diffAlerts` (`utils/flightStatus/alerts.ts`) say which flights this
 * device should be registered for with the Lambda and which calls move it there; the store
 * acquires a push token when it needs one (`services/native/pushRegistration`, never a
 * prompt), makes the calls and records the outcome through `recordRegistration`, the ONE
 * writer of `alerts`. The registration's `rev` is also the suppression evidence:
 * `noticeFirstSeen` pre-dates the stamp of a notice a push already delivered
 * (`pushCovered`), so the local OS notice never fires twice; a registration the server has
 * not confirmed (`pending`) is re-asked each run and never counts. Sign-out unsubscribes first.
 */
import { defineStore } from 'pinia';
import { computed, effectScope, ref, watch } from 'vue';
import type {
  AlertRegistration,
  FlightCheck,
  FlightCheckFailure,
  FlightStatusErrorCode,
  FlightVerification,
} from '@/types/flightStatus';
import type { FamilyVacation, UUID, VacationTravelSegment } from '@/types/models';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import {
  FlightStatusApiError,
  fetchFlightLegs,
  isFlightStatusConfigured,
  subscribeAlert,
  unsubscribeAlert,
} from '@/services/flightStatus/flightStatusApi';
import {
  ensurePushToken,
  onTokenChanged,
  pushPlatform,
  pushToken as osPushToken,
  reportPushTokenFailure,
} from '@/services/native/pushRegistration';
import { devFetchBudgetActive, takeDevFetchTokens } from '@/services/flightStatus/devFetchBudget';
import {
  clearFlightStatusCache,
  emptyFlightStatusCache,
  entryQuestion,
  pruneFlightStatusCache,
  readFlightStatusCache,
  writeFlightStatusCache,
  type FlightStatusCacheRecord,
} from '@/services/flightStatus/flightStatusCache';
import { logEvent } from '@/services/telemetry';
import { createChangeGate, type ChangeGate } from '@/services/telemetry/emitPolicy';
import { nextBackoffMs } from '@/utils/backoff';
import { captureBefore } from '@/utils/captureBefore';
import { createTrailingSingleFlight } from '@/utils/trailingSingleFlight';
import {
  CHANGE_NOTICE_DELAY_MS,
  liveNoticeId,
  travelCancelId,
  travelChangeId,
} from '@/utils/notifications/travel';
import { entityDeepLink, type DeepLink } from '@/utils/entityDeepLink';
import { raceTimeout } from '@/utils/timing';
import {
  desiredAlerts,
  diffAlerts,
  pushCovered,
  sameFlightDay,
  type AlertKey,
  type AlertSpec,
} from '@/utils/flightStatus/alerts';
import { isFlightType } from '@/utils/travelCodes';
import { noticeRevision } from '@/utils/flightStatus/occurrenceNotice';
import { normaliseFlightNumber } from '@/utils/flightStatus/flightNumber';
import { operatedAs, pickLeg } from '@/utils/flightStatus/match';
import {
  diffTuple,
  revisionOf,
  tupleFromLeg,
  tupleFromSegment,
} from '@/utils/flightStatus/schedule';
import {
  cancelRevisionOf,
  carriesNotice,
  deriveVerification,
  planChange,
  revertPlan,
  shouldApply,
  takeProviderPatch,
  unresolvedEntry,
  usableCheck as usableCheckFor,
  type SegmentPatch,
} from '@/utils/flightStatus/verify';
import {
  FLIGHT_POLL_MS,
  flightTiming,
  pickFlightRefresh,
  type FlightRefreshDecision,
  type FlightSkipReason,
} from '@/utils/flightStatus/window';
import { useOnline } from '@/composables/useOnline';
import { usePermissions } from '@/composables/usePermissions';
import { usePollWhileVisible } from '@/composables/usePollWhileVisible';
import { useToday } from '@/composables/useToday';
import { useEntitlementStore } from './entitlementStore';
import { useFamilyContextStore } from './familyContextStore';
import { useFamilyStore } from './familyStore';
import { useSettingsStore } from './settingsStore';
import { useTranslationStore } from './translationStore';
import { useVacationStore, type SegmentWriteResult } from './vacationStore';

const SURFACE = 'travel-verify';
/** Provider calls per run at most; the rest wait for the next trigger (fairness by soonest). */
export const MAX_FETCHES_PER_RUN = 4;
/** The segment watch's debounce: a typing family member is one request, not ten. */
export const SEGMENT_CHANGE_DEBOUNCE_MS = 2_000;
/** How long a run waits for the OS to issue a push token, and sign-out for its unsubscribes. */
export const PUSH_WAIT_MS = 5_000;

/** What started a run. Rides the `kind` context key. `push-token`: the OS rotated the token. */
export type FlightRefreshKind =
  'open' | 'foreground' | 'online' | 'tick' | 'segment-changed' | 'push-token';

/** Why a run fetches a flight (`pickFlightRefresh`); `'entry'` is the stamped one. */
type FetchReason = Extract<FlightRefreshDecision, { action: 'fetch' }>['reason'];

/** "Update with airline data": what the write did, and the way back when it saved. */
export interface TakeAirlineResult {
  result: SegmentWriteResult;
  /** Present only when a `saved` take wrote exactly what the person was shown (the Conflict's
   *  provider values): writes the values it replaced back. A take that recorded a newer airline
   *  revision has none; that change is announced like any airline change ("Put it back"). */
  undo?: () => Promise<SegmentWriteResult>;
}

/** An answer whose write is still owed (see `run`); `outOfWindow` ones back off. */
interface OwedWrite {
  c: Candidate;
  check: FlightCheck;
  outOfWindow: boolean;
}

interface Candidate {
  vacationId: string;
  segment: VacationTravelSegment;
  /** The trip's travellers (who receives the change notice, `isChangeRecipient`). */
  tripAssigneeIds: UUID[];
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
  /** Segment id → the question (`entryQuestion`) already asked out of window (see the cache). */
  const entryChecked = ref<Record<string, string>>({});
  /** Segment id → the flight alert the server holds for this device (`recordRegistration`). */
  const alerts = ref<Record<string, AlertRegistration>>({});
  /** The push token every entry of `alerts` was registered under. */
  const registeredToken = ref<string | null>(null);
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
  /** Session-only backoff for an out-of-window owed write that keeps failing (the `skipGates`
   *  precedent): never persisted, cleared in `hydrate`. Written only by `retryOwed`. */
  const owedRetry = new Map<string, { count: number; until: number }>();
  /** Notice keys a take folded this session and its Undo may reopen. Any person action on a
   *  key ("Got it", the chip) removes it: from then on the fold is theirs. Cleared in `hydrate`. */
  const takeFolds = new Set<string>();
  /** The alert token the server refused this session: not offered again until the registry
   *  sends a different one. */
  let rejectedAlertToken: string | null = null;

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
        .map((segment) => ({ vacationId: v.id, segment, tripAssigneeIds: v.assigneeIds ?? [] }))
    )
  );

  /** Every travel segment the family has, by id (verifications are total over these). */
  const segmentsById = computed(() => {
    const map = new Map<string, Candidate>();
    for (const v of vacationStore.vacations) {
      for (const segment of v.travelSegments ?? []) {
        map.set(segment.id, { vacationId: v.id, segment, tripAssigneeIds: v.assigneeIds ?? [] });
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
      minIntervalMs: timing.minIntervalMs,
    });
    // The device-side fold of the notice block rides on the verification, so the card has one
    // input. Keyed on the notice (`noticeKey`): a new airline revision is a new, undismissed one.
    if (carriesNotice(v)) {
      const id = noticeKey(seg.id, seg, v);
      if (id !== null && dismissed.value[id] !== undefined) return { ...v, dismissed: true };
    }
    return v;
  }

  /**
   * The key "Got it" folds a segment's notice under on this device: its bell/OS id
   * (`liveNoticeId`, from the synced fields), except for an airline change or cancellation
   * NOT in the plan (`applied: false`: this member may not edit trips, or the write failed),
   * which has no synced id, or only an older revision's. That one is keyed on the provider's
   * revision: the id `liveNoticeId` gives a change once it is written, and a new airline
   * revision is a new key. A cancellation is keyed on its revision alone on BOTH paths (never
   * the bell/OS id's `@liveCancelledAt`), so one dismissed before its write lands stays
   * dismissed once it is written. `liveNoticeId` itself stays the bell/OS id.
   */
  function noticeKey(
    segmentId: string,
    seg: VacationTravelSegment,
    v: FlightVerification
  ): string | null {
    if (v.applied === false && v.provider) {
      if (v.state === 'changed') return travelChangeId(segmentId, revisionOf(v.provider));
      if (v.state === 'cancelled') return travelCancelId(segmentId, cancelRevisionOf(v.provider));
    }
    if (noticeRevision(seg)?.kind === 'cancelled') {
      return travelCancelId(segmentId, seg.liveRevision!);
    }
    return liveNoticeId(segmentId, seg);
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
  /** The device record as the store holds it now: the ONE place a record field is listed. */
  function snapshot(familyId: string): FlightStatusCacheRecord {
    return {
      ...emptyFlightStatusCache(familyId),
      checks: checks.value,
      failures: failures.value,
      noticed: noticed.value,
      dismissed: dismissed.value,
      entryChecked: entryChecked.value,
      alerts: alerts.value,
      pushToken: registeredToken.value,
    };
  }

  /** Load a record into state (null = empty: a miss, a sign-out). */
  function restore(record: FlightStatusCacheRecord | null): void {
    const r = record ?? emptyFlightStatusCache('');
    checks.value = { ...r.checks };
    failures.value = { ...r.failures };
    noticed.value = { ...r.noticed };
    dismissed.value = { ...r.dismissed };
    entryChecked.value = { ...r.entryChecked };
    alerts.value = { ...r.alerts };
    registeredToken.value = r.pushToken;
  }

  function hydrate(familyId: string | null): void {
    loadedFamilyId = familyId;
    owedRetry.clear();
    takeFolds.clear();
    restore(familyId ? readFlightStatusCache(familyId) : null);
  }

  let cacheWriteWarned = false;
  function persist(): void {
    if (!loadedFamilyId || halted.value) return;
    const written = writeFlightStatusCache(snapshot(loadedFamilyId));
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
   *  loaded: before that, every segment looks deleted. A notice is live only while the
   *  segment's CURRENT verification carries one (`carriesNotice`; a finished flight is
   *  `unavailable`, so never), under both of its ids: the bell/OS one (`noticed`) and the
   *  dismiss key (`dismissed`), which differ for a cancellation. Only a flight with synced
   *  live fields or a check of its own can carry a notice, so nothing else is verified. */
  function prune(now: number): void {
    if (!loadedFamilyId || !docReady.value) return;
    const before = snapshot(loadedFamilyId);
    const liveNoticeIds = new Set<string>();
    /** Segments whose answer left something unresolved: their entry stamp is released when
     *  the answer ages out (`pruneFlightStatusCache`), so the flight is asked once more. */
    const unresolved = new Set<string>();
    // Only a resolved member's "may not edit" is a reason to keep the stamp: before the
    // member resolves, `mayEdit()` reads false on an editor's device too, and a kept stamp
    // there would never be asked again.
    const canWrite = useFamilyStore().currentMember ? mayEdit() : true;
    for (const [id, { segment: seg }] of segmentsById.value) {
      if (!isFlightType(seg.type)) continue;
      const hasLive = !!(seg.liveRevision || seg.liveAppliedAt || seg.liveCancelledAt);
      const check = checks.value[id];
      if (!hasLive && !check) continue;
      if (check && unresolvedEntry(seg, check, canWrite)) unresolved.add(id);
      const v = verificationFor(id);
      if (!v || !carriesNotice(v)) continue;
      for (const key of [liveNoticeId(id, seg), noticeKey(id, seg, v)]) {
        if (key !== null) liveNoticeIds.add(key);
      }
    }
    const after = pruneFlightStatusCache(
      before,
      new Set(segmentsById.value.keys()),
      liveNoticeIds,
      now,
      unresolved
    );
    if (after === before) return;
    restore(after);
    persist();
    const released = [...unresolved].filter(
      (id) => before.entryChecked[id] !== undefined && after.entryChecked[id] === undefined
    ).length;
    if (released > 0) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'flight entry stamp released',
        context: { action: 'entry_released', count: released },
      });
    }
  }

  /**
   * When THIS device first saw a change/cancel notice (epoch ms); stamped and persisted on the
   * first call for an id. The OS notice fires at this + `CHANGE_NOTICE_DELAY_MS`, so a revision
   * fires once per device (including one that syncs it days later) and a reschedule never
   * moves it.
   *
   * Phase 2: when a push already told this device (`pushCovered`: a registration for the
   * segment's flight, CONFIRMED by the server, whose `rev` is not the segment's current `liveRevision`), the stamp is
   * PRE-DATED, so the reminder builder finds its fireAt behind now and drops it, on this
   * rebuild and every later one. Twice the delay, not once: the builder captured its `now`
   * a few milliseconds before calling here, and a stamp only one delay back would put fireAt
   * just ahead of it.
   */
  function noticeFirstSeen(id: string, segmentId: string): number {
    const known = noticed.value[id];
    if (known !== undefined) return known;
    const seg = current(segmentId)?.segment;
    const covered = !!seg && pushCovered(alerts.value[segmentId], seg, seg.liveRevision);
    const now = Date.now();
    const stamp = covered ? now - 2 * CHANGE_NOTICE_DELAY_MS : now;
    noticed.value = { ...noticed.value, [id]: stamp };
    persist();
    if (covered) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'notice suppressed',
        context: { action: 'notice_suppressed', detail: 'push_registered' },
      });
    }
    return stamp;
  }

  /**
   * The ONE writer of `alerts[segmentId]` (`next` null = forget it). Before it replaces a
   * registration with one of another `rev`, or forgets it, it stamps the segment's current
   * notice (a no-op when already stamped), so the evidence a push was the notice is read
   * before it is gone and no caller has to remember that rule.
   */
  function recordRegistration(segmentId: string, next: AlertRegistration | null): void {
    const prev = alerts.value[segmentId];
    const seg = current(segmentId)?.segment;
    const noticeId = seg ? liveNoticeId(segmentId, seg) : null;
    if (prev && prev.rev !== next?.rev && noticeId) noticeFirstSeen(noticeId, segmentId);
    const { [segmentId]: _old, ...rest } = alerts.value;
    alerts.value = next ? { ...rest, [segmentId]: next } : rest;
    persist();
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

  /** Write the check's change when it is due; null = nothing was due. */
  async function applyIfDue(c: Candidate, check: FlightCheck): Promise<SegmentWriteResult | null> {
    const leg = check.leg;
    if (!leg || !shouldApply(c.segment, leg, check.arrivalLeg)) return null;
    const patch = planChange(c.segment, leg, check.arrivalLeg, Date.now(), copy());
    const cancelled = patch.status === 'pending' && patch.liveCancelledAt !== undefined;
    return write(c, patch, {
      state: cancelled ? 'cancelled' : patch.liveAppliedAt ? 'changed' : 'verified',
      fields: cancelled ? 'status' : fieldsOf(c.segment, check),
      quiet: !cancelled && patch.liveAppliedAt === undefined,
    });
  }

  /** An owed write, retried from the cache. The ONLY writer of `owedRetry`, and only for an
   *  out-of-window entry (an in-window retry is bounded by the poll cadence): a failure backs
   *  the next retry off the plain ladder, a save (or nothing due) clears it. */
  async function retryOwed(o: OwedWrite, now: number): Promise<void> {
    const result = await applyIfDue(o.c, o.check);
    if (!o.outOfWindow) return;
    const id = o.c.segment.id;
    if (result === null || result === 'saved') {
      owedRetry.delete(id);
      return;
    }
    const count = (owedRetry.get(id)?.count ?? 0) + 1;
    owedRetry.set(id, { count, until: now + nextBackoffMs(count) });
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

  /** Mark every out-of-window flight about to be fetched as asked for its current question.
   *  Called AFTER the cap slices, so a cut flight stays unstamped; stamped on issue, not on
   *  outcome (see the cache record). A segment re-stamped for a NEW question loses its old
   *  answer in the same write: that answer was to the old question (`usableCheck` ignores
   *  airports), so a failed re-ask after an airport fix must not keep "Couldn't find this
   *  flight" up for the corrected booking. One persist for the batch. */
  function stampEntryChecks(
    batch: ReadonlyArray<{ c: Candidate; reason: FetchReason; question: string }>,
    kind: FlightRefreshKind
  ): void {
    const entries = batch.filter((d) => d.reason === 'entry');
    if (entries.length === 0) return;
    const next = { ...entryChecked.value };
    const answers = { ...checks.value };
    for (const d of entries) {
      const id = d.c.segment.id;
      if (next[id] !== undefined && next[id] !== d.question) delete answers[id];
      next[id] = d.question;
    }
    entryChecked.value = next;
    if (Object.keys(answers).length !== Object.keys(checks.value).length) checks.value = answers;
    persist();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'flight entry check',
      context: { action: 'entry_check', kind, count: entries.length },
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
    const due: Array<{
      c: Candidate;
      query: string;
      date: string;
      departureMs: number;
      reason: FetchReason;
      question: string;
    }> = [];
    /** Answers not due a fetch (fresh, or a far-out flight already asked) whose write is still
     *  owed (refused or failed earlier): retried from the cache, with no provider call. */
    const owed: OwedWrite[] = [];
    let globalReason: FlightSkipReason | null = null;

    for (const c of candidateSegments.value) {
      const seg = c.segment;
      const number = normaliseFlightNumber(seg.airline, seg.flightNumber);
      const check = usableCheck(seg);
      const timing = flightTiming(seg, check, homeZone.value, now);
      const date = seg.departureDate?.slice(0, 10) ?? '';
      const question = number
        ? entryQuestion(number.query, date, seg.departureAirport, seg.arrivalAirport)
        : '';
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
        entryDone: entryChecked.value[seg.id] === question,
      });
      if (decision.action === 'skip') {
        histogram.set(decision.reason, (histogram.get(decision.reason) ?? 0) + 1);
        if (
          (decision.reason === 'fresh' || decision.reason === 'out_of_window') &&
          check?.leg &&
          !inFlight.value.has(seg.id) &&
          shouldApply(seg, check.leg, check.arrivalLeg) &&
          mayEdit()
        ) {
          owed.push({ c, check, outOfWindow: decision.reason === 'out_of_window' });
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
        date,
        departureMs: timing.departureMs ?? Number.MAX_SAFE_INTEGER,
        reason: decision.reason,
        question,
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

    stampEntryChecks(batch, kind);

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

    // An out-of-window owed write that failed recently waits out its backoff; in-window ones
    // never do. A deferred write is counted only on the retry event (its `notif_skipped`),
    // never in the run histogram. A run that only defers logs it at debug (count 0), so the
    // backoff stays visible without an info event per tick.
    const ready = owed.filter(
      (o) => !o.outOfWindow || (owedRetry.get(o.c.segment.id)?.until ?? 0) <= now
    );
    if (owed.length > 0) {
      logEvent({
        level: ready.length > 0 ? 'info' : 'debug',
        surface: SURFACE,
        message: 'flight change write retried',
        context: {
          action: 'apply_retry',
          count: ready.length,
          notif_skipped: owed.length - ready.length,
        },
      });
    }
    await Promise.all([
      ...ready.map((o) => retryOwed(o, now)),
      ...batch.map((d) => checkOne(d.c, d.query, d.date, kind)),
    ]);
    await reconcileAlerts(familyId);
  }

  // ── Flight alerts (Phase 2) ────────────────────────────────────────────────
  /** This install's push token, acquiring one (bounded) when the OS has issued none yet. */
  async function currentPushToken(): Promise<string | null> {
    if (osPushToken.value) return osPushToken.value;
    // `issued`, not `token`: the security lint reads a `token ===` compare as a secret check.
    const issued = await raceTimeout(ensurePushToken(), PUSH_WAIT_MS);
    if (issued === undefined) reportPushTokenFailure('timeout');
    return issued ?? null;
  }

  /** A new push token replaces every registration: forget them (through the one writer, so
   *  the evidence is stamped) and record the token the next ones are made under. */
  function adoptPushToken(token: string): void {
    for (const segmentId of Object.keys(alerts.value)) recordRegistration(segmentId, null);
    registeredToken.value = token;
    persist();
  }

  /** A failed alert call: classified and logged, the devHint on the console. Never shown to
   *  the person (the Phase 1 path still shows every change on open). */
  function onAlertFailure(
    action: 'alert_subscribe_failed' | 'alert_unsubscribe_failed',
    error: unknown,
    os: string,
    alertToken?: string
  ): void {
    const typed = error instanceof FlightStatusApiError ? error : null;
    if (typed?.code === 'aborted') return;
    if (typed?.lambdaCode === 'alert_token_rejected' && alertToken) rejectedAlertToken = alertToken;
    const code = typed?.lambdaCode ?? typed?.code ?? 'unexpected';
    console.warn(
      `[flight-status] ${action.replace(/_/g, ' ')} (${code}): ${typed?.devHint ?? 'unexpected error, see the report'}`
    );
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message:
        action === 'alert_subscribe_failed' ? 'alert subscribe failed' : 'alert unsubscribe failed',
      context: { action, error_code: code, http_status: typed?.httpStatus ?? 0, os },
      error,
    });
  }

  async function subscribeOne(
    spec: AlertSpec,
    token: string,
    alertToken: string,
    os: 'ios' | 'android',
    familyId: string
  ): Promise<void> {
    const { segmentId, ...registration } = spec;
    try {
      const answer = await subscribeAlert({
        ...registration,
        platform: os,
        lang: translationStore.currentLanguage,
        token,
        alert: alertToken,
      });
      // Contract drift is logged even when the answer is no longer this record's.
      const unreadable = answer.provider === 'unknown';
      if (unreadable) {
        console.warn(
          '[flight-status] alert subscribe answered "unknown": the response did not match the ' +
            'contract. Compare subscribeAlert in flightStatusApi.ts with the 200 answers in ' +
            'infrastructure/lambda/flight-status/alerts.mjs.'
        );
      }
      logEvent({
        level: unreadable ? 'warn' : 'info',
        surface: SURFACE,
        message: 'alert subscribed',
        context: { action: 'alert_subscribed', os, detail: answer.provider },
      });
      // Signed out, or the token moved on, while the call was in flight: not this record's.
      if (halted.value || familyId !== loadedFamilyId || registeredToken.value !== token) return;
      recordRegistration(segmentId, { ...registration, confirmed: answer.provider === 'ready' });
    } catch (e) {
      onAlertFailure('alert_subscribe_failed', e, os, alertToken);
    }
  }

  async function unsubscribeOne(key: AlertKey, os: string, familyId: string): Promise<void> {
    try {
      await unsubscribeAlert({ flight: key.flight, date: key.date, token: key.token });
      const held = alerts.value[key.segmentId];
      // Forget it only if the record still holds THIS registration (a subscribe for the
      // segment's new flight or token may have landed first).
      if (
        familyId === loadedFamilyId &&
        registeredToken.value === key.token &&
        held?.flight === key.flight &&
        held.date === key.date
      ) {
        recordRegistration(key.segmentId, null);
      }
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'alert unsubscribed',
        context: { action: 'alert_unsubscribed', os },
      });
    } catch (e) {
      onAlertFailure('alert_unsubscribe_failed', e, os);
    }
  }

  /**
   * The end of every run, native only and online: move this device's registrations to the
   * desired set. The decisions are `desiredAlerts` / `diffAlerts`; this acquires a push token
   * when one is needed (null: registers nothing this run), makes the calls (capped) and logs.
   */
  async function reconcileAlerts(familyId: string): Promise<void> {
    const os = pushPlatform();
    if (!os || halted.value || !isOnline.value) return;
    const offered = useEntitlementStore().flightAlertToken;
    const alertToken = offered !== rejectedAlertToken ? offered : null;
    const desired = desiredAlerts(candidateSegments.value, checks.value, {
      nowMs: Date.now(),
      alertsEnabled: alertsEnabled.value,
      currentMember: useFamilyStore().currentMember ?? null,
      alertToken,
      homeZone: homeZone.value,
    });
    const token = desired.size > 0 ? await currentPushToken() : osPushToken.value;
    if (halted.value || familyId !== loadedFamilyId) return;
    const plan = diffAlerts(
      desired,
      { alerts: alerts.value, pushToken: registeredToken.value },
      token
    );
    if (plan.retoken && token) adoptPushToken(token);
    if (plan.subscribe.length + plan.unsubscribe.length === 0) return;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'alert reconcile',
      context: {
        action: 'alert_reconcile',
        count: desired.size,
        notif_skipped: plan.unchanged,
        detail: `sub=${plan.subscribe.length},reconfirm=${plan.reconfirm},unsub=${plan.unsubscribe.length},over_cap=${plan.overCap}`,
      },
    });
    await Promise.allSettled([
      ...plan.unsubscribe.map((k) => unsubscribeOne(k, os, familyId)),
      // A subscribe exists only with a token and a desired set, which needs an alert token.
      ...plan.subscribe.map((spec) => subscribeOne(spec, token!, alertToken!, os, familyId)),
    ]);
  }

  /** Sign-out: tell the server to stop pushing this device's flights, bounded; never throws. */
  async function unsubscribeAllForSignOut(): Promise<void> {
    const token = registeredToken.value;
    const keys = Object.values(alerts.value);
    if (!token || keys.length === 0) return;
    const results = await raceTimeout(
      Promise.allSettled(
        keys.map((a) => unsubscribeAlert({ flight: a.flight, date: a.date, token }))
      ),
      PUSH_WAIT_MS
    );
    const ok = results?.filter((r) => r.status === 'fulfilled').length ?? 0;
    const failed = results ? keys.length - ok : 0;
    logEvent({
      level: failed > 0 || !results ? 'warn' : 'info',
      surface: SURFACE,
      message: 'alert unsubscribe on sign-out',
      context: {
        action: 'alert_unsubscribe_signout',
        count: keys.length,
        detail: `ok=${ok},failed=${failed},timed_out=${results === undefined}`,
      },
    });
  }

  /** Where a tap on a flight push lands: the trip holding that flight (same number, within a
   *  day of the pushed date, `sameFlightDay`), or null when none does any more. */
  function deepLinkFor(flight: string, date: string): DeepLink | null {
    for (const c of segmentsById.value.values()) {
      if (sameFlightDay({ flight, date }, c.segment))
        return entityDeepLink('vacation', c.vacationId);
    }
    return null;
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
  /** Write a patch that returns segment values (Put it back, Undo of a take) and log the
   *  outcome: `reverted` / `apply_failed` (with `detail: 'revert'`) for Put it back,
   *  `undo_take` / `undo_failed` for an Undo. A refused write (no permission) answers
   *  `'failed'`. */
  async function writeBack(
    c: Candidate,
    patch: SegmentPatch,
    detail: 'revert' | 'undo_take'
  ): Promise<SegmentWriteResult> {
    const written = await writeSegment(c, patch, 'revert');
    if (written === 'refused') return 'failed';
    const result = written;
    logEvent({
      level: result === 'saved' ? 'info' : 'warn',
      surface: SURFACE,
      message: result === 'saved' ? 'flight change reverted' : 'flight change apply failed',
      context:
        detail === 'revert'
          ? result === 'saved'
            ? { action: 'reverted', detail }
            : { action: 'apply_failed', save_status: result, detail }
          : result === 'saved'
            ? { action: 'undo_take' }
            : { action: 'undo_failed', save_status: result },
    });
    return result;
  }

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
    return writeBack(c, patch, 'revert');
  }

  /** The Undo of a take: the values it replaced go back, and the fold the take added (if any)
   *  is removed, since Conflict and Changed share one notice key and the restored Conflict
   *  must come back visible. A fold the person made themselves is not ours to remove: one made
   *  before the take was never added, and touching the notice during the toast (`setDismissed`)
   *  takes the key out of `takeFolds`. */
  function undoTake(
    c: Candidate,
    prior: SegmentPatch,
    addedKey: string | null
  ): () => Promise<SegmentWriteResult> {
    return async () => {
      const result = await writeBack(c, prior, 'undo_take');
      if (result === 'saved' && addedKey && takeFolds.has(addedKey)) {
        takeFolds.delete(addedKey);
        markDismissed(c.segment.id, addedKey, false, 'undo_take');
      }
      return result;
    };
  }

  /** The keys a take's Undo writes back: every key the provider patch wrote (schedule fields,
   *  `status`, `arrivesNextDay`), and `sortDate` whenever the date moved (`updateSegment` moves
   *  it with `departureDate` unless the patch names one, so naming it restores a custom order,
   *  or clears one the move added). */
  function undoKeys(patch: SegmentPatch): (keyof VacationTravelSegment)[] {
    const keys = Object.keys(patch) as (keyof VacationTravelSegment)[];
    return patch.departureDate !== undefined ? [...keys, 'sortDate'] : keys;
  }

  /** "Update with airline data" (Conflict): write the cached leg, skipping `shouldApply` (whose
   *  revision rule is exactly what keeps a manual edit). `missing` without a USABLE cached
   *  leg: none at all, or one for another flight number or day (a stale answer is never
   *  written over the family's edit), logged so the refusal is visible.
   *
   *  Two paths. The provider patch (the person decided exactly what the Conflict showed) is
   *  final in one step: the notice block it would raise is folded for the person, and `undo`
   *  writes the values captured BEFORE the write back (not `liveWas`, which predates the
   *  airline's change). When a newer airline revision landed between render and tap, the take
   *  records it through `planChange` like any airline change: no fold and no `undo`, so the
   *  Changed notice ("Put it back") and the OS/bell notice announce what the person never saw. */
  async function takeAirline(segmentId: string): Promise<TakeAirlineResult> {
    const c = current(segmentId);
    if (!c) return { result: 'missing' };
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
      return { result: 'missing' };
    }
    // An airline answer not yet recorded (a newer revision) is a real change: record it once,
    // with its notes line. Otherwise the change is already recorded and only the values return.
    const newerRevision = shouldApply(c.segment, check.leg, check.arrivalLeg);
    const patch = newerRevision
      ? planChange(c.segment, check.leg, check.arrivalLeg, Date.now(), copy())
      : takeProviderPatch(c.segment, check.leg, check.arrivalLeg);
    const prior = newerRevision ? null : captureBefore(c.segment, undoKeys(patch));
    const written = await writeSegment(c, patch, 'take_airline');
    if (written === 'refused') return { result: 'failed' };
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
    if (result !== 'saved' || !prior) return { result };
    const key = currentNoticeKey(segmentId);
    const addedKey = key && markDismissed(segmentId, key, true, 'take_airline') ? key : null;
    if (addedKey) takeFolds.add(addedKey);
    return { result, undo: undoTake(c, prior, addedKey) };
  }

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

  /** The key this segment's CURRENT notice folds under, or null when it carries none. */
  function currentNoticeKey(segmentId: string): string | null {
    const c = current(segmentId);
    const v = verificationFor(segmentId);
    return c && v && carriesNotice(v) ? noticeKey(segmentId, c.segment, v) : null;
  }

  /** Fold (`on`) or reopen one notice key on this device. False, writing and logging nothing,
   *  when the entry is already in the requested state; `detail` names a non-tap cause. */
  function markDismissed(segmentId: string, key: string, on: boolean, detail?: string): boolean {
    if ((dismissed.value[key] !== undefined) === on) return false;
    if (on) {
      dismissed.value = { ...dismissed.value, [key]: Date.now() };
    } else {
      const { [key]: _gone, ...rest } = dismissed.value;
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
        ...(detail ? { detail } : {}),
      },
    });
    return true;
  }

  function setDismissed(segmentId: string, on: boolean): boolean {
    const key = currentNoticeKey(segmentId);
    if (key === null) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'flight notice dismiss skipped',
        context: { action: on ? 'dismiss_skipped' : 'reopen_skipped', detail: 'no_notice' },
      });
      return false;
    }
    // The person acted on this notice: a fold a take made is theirs now, not Undo's.
    takeFolds.delete(key);
    markDismissed(segmentId, key, on);
    return true;
  }

  /**
   * Sign-out, BEFORE the session ends: stop asking, abort the requests in flight, wait for the
   * run to settle, unsubscribe this device's flight alerts (bounded, `PUSH_WAIT_MS`), drop the
   * checks and only then delete the device cache, so no answer can write the departing
   * family's flights back and no push follows the person out. Never throws.
   */
  async function haltForSignOut(): Promise<void> {
    halted.value = true;
    for (const c of controllers) c.abort();
    controllers.clear();
    const pending = flight.pending();
    if (pending) await pending.catch(() => undefined);
    await unsubscribeAllForSignOut();
    rejectedAlertToken = null;
    restore(null);
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
      // A rotated push token: re-subscribe every desired flight under it (a no-op on web).
      onTokenChanged(() => void request('push-token'));
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
    alerts,
    deepLinkFor,
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
