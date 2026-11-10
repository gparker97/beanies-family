/**
 * This device's live flight checks (#143), in localStorage. The weather cache pattern
 * (`services/weather/weatherCache.ts`): this module only moves bytes and reports failures;
 * `flightStatusStore` owns every decision about what a check means.
 *
 * DEVICE STATE, NOT FAMILY DATA. A check is a third-party answer about public flight data
 * (gates, estimates, status) that changes by the minute. Only the scheduled-time/terminal
 * changes and cancellations a check reveals are written to the pod, by the store, through
 * `vacationStore.updateSegment`; everything held here stays on the device.
 *
 * ONE KEY (`STORAGE_KEYS.FLIGHT_STATUS`) holding the checks and failure backoffs keyed by
 * segment id, plus the `familyId` they belong to. Another family's record is a miss, so a
 * shared device never shows one family's flights to another; sign-out is a single removal.
 * Entries are pruned when their segment is deleted and when the flight is over (arrival + 2 h,
 * or `Arrived`), and nothing is ever kept past 7 days (the provider's cache limit).
 *
 * Phase 2 (#143, ADR-046) adds the flight alerts this device registered (`alerts`) and the
 * ONE push token they were registered under (`pushToken`). Both are optional on the `v: 1`
 * record and read tolerant (`{}` / `null`): bumping `v` would make `isRecord` reject, and so
 * delete, every existing record. A registration is pruned only once the server's own item
 * has expired (`ALERT_EXPIRES_AFTER_MS`): a deleted segment or a closed window is the
 * reconcile's job, which must still hold the registration to unsubscribe it.
 */
import type {
  AlertRegistration,
  FlightCheck,
  FlightCheckFailure,
  FlightLeg,
} from '@/types/flightStatus';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import {
  readStoredJson,
  removeStoredJson,
  writeStoredJson,
  type StoredJsonWrite,
} from '@/utils/storedJson';
import { logEvent } from '@/services/telemetry';
import { isFlightLeg, isObject } from '@/utils/flightStatus/guards';
import { parseUtcMs } from '@/utils/flightStatus/schedule';

const LABEL = 'flight-status';
const SURFACE = 'travel-verify';

const HOUR_MS = 3_600_000;
/** The check window closes this long after scheduled arrival (`window.ts`). */
const AFTER_ARRIVAL_MS = 2 * HOUR_MS;
/** AeroDataBox's terms: provider data is cached for at most 7 days. */
export const MAX_CHECK_AGE_MS = 7 * 24 * HOUR_MS;
/** The server's one TTL rule for a device item (`expiresAtFor` in the Lambda's
 *  `alertsStore.mjs`): the registered date's UTC midnight plus 72 h. */
export const ALERT_EXPIRES_AFTER_MS = 72 * HOUR_MS;

export interface FlightStatusCacheRecord {
  v: 1;
  familyId: string;
  checks: Record<string, FlightCheck>;
  failures: Record<string, FlightCheckFailure>;
  /** Change/cancel notice id → epoch ms this device FIRST saw it. Lets the OS notice fire once
   *  per revision per device (a fireAt that moves on every write re-arms a delivered one).
   *  A stamp EARLIER than first sight means a push told this device first (the push was the
   *  notice, `pushCovered`): its fireAt is already behind now, so no local OS notice fires.
   *  A record written before this field existed reads as `{}`. */
  noticed: Record<string, number>;
  /** Change/cancel notice id → epoch ms this device dismissed it ("Got it"). The same ids as
   *  `noticed`, so a new airline revision is undismissed by construction. A record written
   *  before this field existed reads as `{}`. */
  dismissed: Record<string, number>;
  /** Segment id → the flight alert this device registered for it (Phase 2). A record written
   *  before this field existed reads as `{}`. */
  alerts: Record<string, AlertRegistration>;
  /** The push token every entry of `alerts` was registered under; null before the first. */
  pushToken: string | null;
}

/** An empty record for a family (a miss, a fresh device). */
export function emptyFlightStatusCache(familyId: string): FlightStatusCacheRecord {
  return {
    v: 1,
    familyId,
    checks: {},
    failures: {},
    noticed: {},
    dismissed: {},
    alerts: {},
    pushToken: null,
  };
}

/**
 * The cached record for this family, or null (missing, another family's). Valid JSON of the
 * wrong shape is corrupt exactly like unparseable JSON: REMOVED here, so the warning fires once
 * rather than on every open.
 */
export function readFlightStatusCache(familyId: string): FlightStatusCacheRecord | null {
  const read = readStoredJson(STORAGE_KEYS.FLIGHT_STATUS, LABEL);
  if (read.kind === 'missing') return null;
  if (read.kind === 'corrupt' || !isRecord(read.value)) {
    console.warn(`[${LABEL}] cached flight checks have an unexpected shape; removing them`);
    logEvent({
      level: 'warn',
      surface: SURFACE,
      message: 'flight cache corrupt',
      context: { action: 'cache_corrupt' },
    });
    removeCache();
    return null;
  }
  return read.value.familyId === familyId
    ? {
        ...read.value,
        noticed: read.value.noticed ?? {},
        dismissed: read.value.dismissed ?? {},
        alerts: read.value.alerts ?? {},
        pushToken: read.value.pushToken ?? null,
      }
    : null;
}

/** Store the record. A refused write is returned, never thrown: the store reports it. */
export function writeFlightStatusCache(record: FlightStatusCacheRecord): StoredJsonWrite {
  return writeStoredJson(STORAGE_KEYS.FLIGHT_STATUS, record, LABEL);
}

/** Forget this device's checks (sign-out, every tier). Never throws. */
export function clearFlightStatusCache(): void {
  removeCache();
}

/** The flight is over: its cached arrival sector landed more than 2 h ago, or it `Arrived`. */
function isOver(check: FlightCheck, nowMs: number): boolean {
  const leg = check.leg;
  if (!leg) return false;
  if (leg.status === 'Arrived') return true;
  const arrival: FlightLeg | null = check.arrivalLeg === undefined ? leg : check.arrivalLeg;
  const landsAt =
    parseUtcMs(arrival?.arrival.scheduledUtc) ?? parseUtcMs(leg.departure.scheduledUtc);
  return landsAt !== null && nowMs > landsAt + AFTER_ARRIVAL_MS;
}

/** The registration's server item has expired: nothing is left to unsubscribe. */
function alertExpired(alert: AlertRegistration, nowMs: number): boolean {
  const day = Date.parse(`${alert.date}T00:00:00Z`);
  return Number.isNaN(day) || nowMs > day + ALERT_EXPIRES_AFTER_MS;
}

/**
 * A copy of `cache` without entries for segments that no longer exist (`liveSegmentIds`),
 * checks for flights that are over, and checks older than 7 days. A failure record goes with
 * its segment only (its backoff must survive a deleted check). A flight alert goes only once
 * its server item has expired (see the header). Pure; returns the SAME object when nothing
 * was dropped, so the store can skip a pointless write.
 */
export function pruneFlightStatusCache(
  cache: FlightStatusCacheRecord,
  liveSegmentIds: ReadonlySet<string>,
  nowMs: number
): FlightStatusCacheRecord {
  let dropped = false;
  const checks: Record<string, FlightCheck> = {};
  for (const [id, check] of Object.entries(cache.checks)) {
    const keep =
      liveSegmentIds.has(id) &&
      !isOver(check, nowMs) &&
      nowMs - check.checkedAt <= MAX_CHECK_AGE_MS;
    if (keep) checks[id] = check;
    else dropped = true;
  }
  const failures: Record<string, FlightCheckFailure> = {};
  for (const [id, failure] of Object.entries(cache.failures)) {
    if (liveSegmentIds.has(id)) failures[id] = failure;
    else dropped = true;
  }
  const noticed: Record<string, number> = {};
  for (const [id, firstSeen] of Object.entries(cache.noticed)) {
    if (nowMs - firstSeen <= MAX_CHECK_AGE_MS) noticed[id] = firstSeen;
    else dropped = true;
  }
  const dismissed: Record<string, number> = {};
  for (const [id, at] of Object.entries(cache.dismissed)) {
    if (nowMs - at <= MAX_CHECK_AGE_MS) dismissed[id] = at;
    else dropped = true;
  }
  const alerts: Record<string, AlertRegistration> = {};
  for (const [id, alert] of Object.entries(cache.alerts)) {
    if (!alertExpired(alert, nowMs)) alerts[id] = alert;
    else dropped = true;
  }
  return dropped ? { ...cache, checks, failures, noticed, dismissed, alerts } : cache;
}

/** Remove the record; a refused removal is logged (the next write overwrites it anyway). */
function removeCache(): void {
  const removed = removeStoredJson(STORAGE_KEYS.FLIGHT_STATUS, LABEL);
  if (removed.ok) return;
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'flight cache clear failed',
    context: { action: 'cache', error_code: 'cache_clear_failed' },
    error: removed.error,
  });
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** `noticed` / `dismissed`: absent (an older record) or id → epoch ms. */
const isStampMap = (v: unknown): boolean =>
  v === undefined || (isObject(v) && Object.values(v).every(isFiniteNumber));

function isCheck(id: string, v: unknown): v is FlightCheck {
  return (
    isObject(v) &&
    v.v === 1 &&
    v.segmentId === id &&
    typeof v.flight === 'string' &&
    typeof v.date === 'string' &&
    isFiniteNumber(v.checkedAt) &&
    (v.leg === null || isFlightLeg(v.leg)) &&
    (v.arrivalLeg === undefined || v.arrivalLeg === null || isFlightLeg(v.arrivalLeg)) &&
    (v.match === 'deterministic' || v.match === 'none')
  );
}

const isOptionalString = (v: unknown): boolean => v === undefined || typeof v === 'string';

function isAlert(v: unknown): v is AlertRegistration {
  return (
    isObject(v) &&
    typeof v.flight === 'string' &&
    typeof v.date === 'string' &&
    typeof v.dep === 'string' &&
    isOptionalString(v.arr) &&
    typeof v.rev === 'string' &&
    typeof v.confirmed === 'boolean'
  );
}

/** `alerts`: absent (an older record) or segment id → registration. */
const isAlertMap = (v: unknown): boolean =>
  v === undefined || (isObject(v) && Object.values(v).every(isAlert));

function isFailure(v: unknown): v is FlightCheckFailure {
  return (
    isObject(v) && typeof v.code === 'string' && isFiniteNumber(v.count) && isFiniteNumber(v.until)
  );
}

function isRecord(v: unknown): v is FlightStatusCacheRecord {
  return (
    isObject(v) &&
    v.v === 1 &&
    typeof v.familyId === 'string' &&
    isObject(v.checks) &&
    isObject(v.failures) &&
    isStampMap(v.noticed) &&
    isStampMap(v.dismissed) &&
    isAlertMap(v.alerts) &&
    (v.pushToken === undefined || v.pushToken === null || typeof v.pushToken === 'string') &&
    Object.entries(v.checks).every(([id, c]) => isCheck(id, c)) &&
    Object.values(v.failures).every(isFailure)
  );
}
