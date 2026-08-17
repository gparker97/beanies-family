/**
 * Pure decision logic for the open-path Drive-read guard (tracker #61, PR 2).
 *
 * NO I/O, NO module state, NO imports from `syncService`. Every function here is
 * table-testable with zero mocks — that is the entire reason it exists (plan
 * C15). `syncService` is a thin I/O shell over this module: it owns the probe
 * call, the fallback, the commit termini and the telemetry; every branch of the
 * comparison and the clock handling lives here.
 *
 * The single invariant the whole design serves:
 *
 *   Commit revision R as the baseline only if our doc provably contains the
 *   file's content at R.
 *
 * Every uncertainty (no baseline, no revision, a failed probe, an expired or
 * unparseable trust window) degrades to "baseline not advanced" => an extra
 * read, never a missed one. There is no code path here that can turn a genuine
 * change into `unchanged`.
 */

/**
 * How long a committed baseline may be trusted before the guard forces a
 * refresh read anyway. 1 hour (greg's directive): a daily user never sits stale
 * across many opens, and a total silent failure of the design self-heals within
 * the hour rather than persisting across a day. Insurance, not compensation —
 * it can only ever cause an EXTRA read, never skip one.
 */
export const BASELINE_MAX_TRUST_MS = 60 * 60 * 1000; // 1 hour

/** A cheap metadata probe: a monotonic revision counter (null when the backend
 *  has none) plus mtime, from ONE round-trip. */
export interface RemoteMarker {
  revision: string | null;
  modifiedTime: string | null;
}

/**
 * The durable baseline: the revision our cached doc provably contains, plus the
 * ISO wall-clock at which we committed it. `checkedAt` is the cache row's
 * existing `updatedAt` string, reused as the trust clock (plan Assumption 2) —
 * so there is no invented field. `modifiedTime` is an in-memory-only fallback
 * basis for providers without a revision; only `revision` + `checkedAt` are
 * persisted.
 */
export interface RemoteBaseline {
  revision: string | null;
  modifiedTime: string | null;
  checkedAt: string | null; // ISO; the row's updatedAt. NaN/future => expired.
}

/** The ack our own write returns: the revision the file is at after our write. */
export interface WriteAck {
  revision: string | null;
}

export type ChangeStatus = 'changed' | 'unchanged' | 'unknown';
export type ChangeBasis = 'revision' | 'mtime' | 'none';

export interface ChangeResult {
  status: ChangeStatus;
  basis: ChangeBasis;
  revision: string | null;
  modifiedTime: string | null;
  /** Set whenever the basis is degraded (mtime/none) or the result is a
   *  first-sight read; always logged by the caller. */
  reason?: string;
}

/** Namespace prefix on every stored revision. See {@link toStoredRevision}. */
const REVISION_PREFIX = 'ver:';

/**
 * Stamp a raw Drive `version` string into the stored, namespaced form. The
 * prefix is a one-line forward-compatibility guard: a future build that
 * switches to a different revision field (e.g. `headRevisionId`) can never
 * compare two namespaces as if they were one. Null/empty passes through as
 * null (no revision => the guard always reads).
 */
export function toStoredRevision(version: string | null | undefined): string | null {
  if (version === null || version === undefined || version === '') return null;
  return REVISION_PREFIX + version;
}

/**
 * Decide whether the remote file has changed relative to our baseline. PURE.
 *
 * Comparison is equality-only (`!==`): Drive returns int64 fields as JSON
 * strings, so `<`/`>` on them is a silent-wrong-answer trap and buys nothing —
 * we only ever ask "same or not" (plan C12). The failure direction is always
 * "read": no baseline, no revision and no evidence all degrade to
 * `changed`/`unknown`, never a false `unchanged`.
 */
export function compareMarkers(baseline: RemoteBaseline | null, probe: RemoteMarker): ChangeResult {
  const probeRevision = probe.revision;

  // Revision present on the probe => the authoritative, clock-skew-free basis.
  if (probeRevision !== null) {
    if (baseline == null || baseline.revision == null) {
      // First sight of a revision: no baseline to compare against => read.
      return {
        status: 'changed',
        basis: 'revision',
        revision: probeRevision,
        modifiedTime: probe.modifiedTime,
        reason: 'no-baseline',
      };
    }
    const unchanged = baseline.revision === probeRevision;
    return {
      status: unchanged ? 'unchanged' : 'changed',
      basis: 'revision',
      revision: probeRevision,
      modifiedTime: probe.modifiedTime,
    };
  }

  // No revision anywhere: fall back to mtime-vs-mtime (today's exact semantics,
  // incl. "no baseline + evidence => changed").
  if (probe.modifiedTime !== null) {
    const unchanged =
      baseline != null &&
      baseline.modifiedTime != null &&
      baseline.modifiedTime === probe.modifiedTime;
    return {
      status: unchanged ? 'unchanged' : 'changed',
      basis: 'mtime',
      revision: null,
      modifiedTime: probe.modifiedTime,
      reason: 'mtime-basis',
    };
  }

  // No evidence at all (e.g. memoryProvider returning null mtime).
  return {
    status: 'unknown',
    basis: 'none',
    revision: null,
    modifiedTime: null,
    reason: 'no-evidence',
  };
}

/**
 * Is a baseline committed at `checkedAtIso` still within the trust window as of
 * `nowMs`? PURE. An unparseable (NaN) or future timestamp is treated as
 * EXPIRED (=> read) — trust is never granted on a bad clock. This is a self-heal
 * bound, never a correctness comparison (plan C6's objection does not apply): it
 * can only ever trigger work, never skip it.
 */
export function withinTrustWindow(checkedAtIso: string | null, nowMs: number): boolean {
  if (checkedAtIso === null) return false;
  const checkedAtMs = Date.parse(checkedAtIso);
  if (Number.isNaN(checkedAtMs)) return false;
  if (checkedAtMs > nowMs) return false; // future clock => expired
  return nowMs - checkedAtMs < BASELINE_MAX_TRUST_MS;
}
