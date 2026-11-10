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
 *
 * `entryChecked` (the one-off check when a flight is entered) is stamped when the fetch is
 * ISSUED and pruned with its segment, and by age only when its answer was UNRESOLVED (a change
 * this device could not write, or "Couldn't find this flight"): such a stamp is released when
 * the check ages out at 7 days, so the flight is asked once more. A resolved answer's stamp
 * outlives the 7-day check or the flight would be re-asked. `noticed` / `dismissed` live as long as their notice does (kept
 * while the id is the current notice of a flight that is not over, and for at least 7 days),
 * since an applied far-out change stays `changed` until departure.
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
import { airportCode } from '@/utils/travelCodes';

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
  /** Segment id → the question (`entryQuestion`) this device already asked the provider while
   *  the flight was outside its check window. Written when the fetch is ISSUED, not on its
   *  outcome: the backoff ladder caps at 60 min, so it bounds how often a retry happens, not
   *  how many; a persistent failure (`date_out_of_range`) would otherwise be re-asked hourly
   *  for weeks. A record written before this field existed reads as `{}`. */
  entryChecked: Record<string, string>;
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
    entryChecked: {},
    alerts: {},
    pushToken: null,
  };
}

/** The question an entry check asks, the one string the `entryChecked` stamp holds: the
 *  fields `pickLeg` treats as a different question. Airports go through `airportCode`, as
 *  `pickLeg` reads them, so "SFO" and "San Francisco (SFO)" are one question while "sfo" is
 *  another. (`candidateSignature` stays raw: a cosmetic edit still triggers a run, which then
 *  skips as `out_of_window`.) */
export function entryQuestion(
  flight: string,
  date: string,
  departureAirport?: string,
  arrivalAirport?: string
): string {
  return `${flight}|${date}|${airportCode(departureAirport)}|${airportCode(arrivalAirport)}`;
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
        entryChecked: read.value.entryChecked ?? {},
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
 * checks for flights that are over, and checks older than 7 days. A failure record and an
 * `entryChecked` stamp go with their segment (a backoff must survive a deleted check; a
 * stamp must outlive its check), except a stamp released below. `noticed` / `dismissed` are kept while their id is the
 * current notice of a flight that is not over (`liveNoticeIds`), however old, and in any case
 * for 7 days from their stamp: a just-finished flight's OS notice is still built for 24 h
 * after its change (`useScheduledReminders`), and a forgotten first-seen stamp would fire it
 * a second time. A flight alert goes only once
 * its server item has expired (see the header). Pure; returns the SAME object when nothing
 * was dropped, so the store can skip a pointless write.
 *
 * `unresolvedIds` are segments whose answer left something unresolved (`unresolvedEntry`). When
 * such a segment's check is dropped BY AGE alone (segment live, flight not over), its
 * `entryChecked` stamp is released too, so the next run asks once more.
 */
export function pruneFlightStatusCache(
  cache: FlightStatusCacheRecord,
  liveSegmentIds: ReadonlySet<string>,
  liveNoticeIds: ReadonlySet<string>,
  nowMs: number,
  unresolvedIds: ReadonlySet<string> = new Set()
): FlightStatusCacheRecord {
  let dropped = false;
  const checks: Record<string, FlightCheck> = {};
  const released = new Set<string>();
  for (const [id, check] of Object.entries(cache.checks)) {
    const aged = nowMs - check.checkedAt > MAX_CHECK_AGE_MS;
    const live = liveSegmentIds.has(id);
    const over = isOver(check, nowMs);
    if (live && !over && !aged) checks[id] = check;
    else {
      dropped = true;
      if (live && !over && unresolvedIds.has(id)) released.add(id);
    }
  }
  const failures: Record<string, FlightCheckFailure> = {};
  for (const [id, failure] of Object.entries(cache.failures)) {
    if (liveSegmentIds.has(id)) failures[id] = failure;
    else dropped = true;
  }
  const entryChecked: Record<string, string> = {};
  for (const [id, question] of Object.entries(cache.entryChecked)) {
    if (liveSegmentIds.has(id) && !released.has(id)) entryChecked[id] = question;
    else dropped = true;
  }
  const keepNotice = (id: string, stamp: number) =>
    liveNoticeIds.has(id) || nowMs - stamp <= MAX_CHECK_AGE_MS;
  const noticed: Record<string, number> = {};
  for (const [id, firstSeen] of Object.entries(cache.noticed)) {
    if (keepNotice(id, firstSeen)) noticed[id] = firstSeen;
    else dropped = true;
  }
  const dismissed: Record<string, number> = {};
  for (const [id, at] of Object.entries(cache.dismissed)) {
    if (keepNotice(id, at)) dismissed[id] = at;
    else dropped = true;
  }
  const alerts: Record<string, AlertRegistration> = {};
  for (const [id, alert] of Object.entries(cache.alerts)) {
    if (!alertExpired(alert, nowMs)) alerts[id] = alert;
    else dropped = true;
  }
  return dropped ? { ...cache, checks, failures, entryChecked, noticed, dismissed, alerts } : cache;
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
/** A tolerant optional map: absent (a record older than the field) reads true; otherwise
 *  every value must pass `pred`. */
const isMapOf =
  (pred: (x: unknown) => boolean) =>
  (v: unknown): boolean =>
    v === undefined || (isObject(v) && Object.values(v).every(pred));
const isString = (v: unknown): v is string => typeof v === 'string';

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
    // Tolerant optional maps: `noticed` / `dismissed` id → epoch ms, `entryChecked` segment
    // id → question, `alerts` segment id → registration.
    isMapOf(isFiniteNumber)(v.noticed) &&
    isMapOf(isFiniteNumber)(v.dismissed) &&
    isMapOf(isString)(v.entryChecked) &&
    isMapOf(isAlert)(v.alerts) &&
    (v.pushToken === undefined || v.pushToken === null || typeof v.pushToken === 'string') &&
    Object.entries(v.checks).every(([id, c]) => isCheck(id, c)) &&
    Object.values(v.failures).every(isFailure)
  );
}
