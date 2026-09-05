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
 *
 * #65 adds the local->remote half of the same guarantee: the row also carries a
 * fingerprint of the heads DRIVE HOLDS, so an open can tell that our doc has
 * changes Drive never received (a force-kill between the cache persist and the
 * debounced save) and decline to skip. The invariant's mirror image:
 *
 *   Record heads H as the baseline only if H is provably the content of the
 *   file on Drive — never merely our doc's heads at the time.
 *
 * DEPENDENCY CONSTRAINT: keep this module free of RUNTIME imports. It is
 * type-imported by worker code (`worker/cache.ts`, `worker/docClient.ts`), and
 * those imports are erased precisely because nothing here is a value they need.
 * Adding a runtime import risks pulling main-thread modules into the worker
 * bundle. This is also why `headsFingerprint` takes `readonly string[]` instead
 * of importing `Heads` from `worker/protocol`.
 *
 * PRIVACY (the row is deliberately PLAINTEXT where every other cache payload is
 * ciphertext): the existing justification is that an opaque counter plus a local
 * clock reading carries no family data. The #65 fingerprint does not change
 * that. Automerge change hashes are SHA-256 digests of change bytes — no content
 * is recoverable from them. The row now additionally reveals "the doc has
 * moved", which the revision counter already implied.
 */

/**
 * How long a committed baseline may be trusted before the guard forces a
 * refresh read anyway. 1 hour (greg's directive): a daily user never sits stale
 * across many opens, and a total silent failure of the design self-heals within
 * the hour rather than persisting across a day. Insurance, not compensation —
 * it can only ever cause an EXTRA read, never skip one.
 */
export const BASELINE_MAX_TRUST_MS = 60 * 60 * 1000; // 1 hour

// `RemoteMarker` and `WriteAck` are part of the StorageProvider contract, so they
// are defined THERE (the abstraction) and re-exported here for the guard's use —
// keeping the dependency arrow provider→feature, not the inversion (#61 review).
import type { RemoteMarker, WriteAck } from './storageProvider';
export type { RemoteMarker, WriteAck };

/**
 * The durable baseline: the revision our cached doc provably contains, plus the
 * ISO wall-clock at which we committed it. `checkedAt` is the cache row's
 * existing `updatedAt` string, reused as the trust clock (plan Assumption 2) —
 * so there is no invented field. `modifiedTime` is an in-memory-only fallback
 * basis for providers without a revision; only `revision` + `headsFp` are
 * persisted (in the row payload), with `checkedAt` riding the row's `updatedAt`.
 *
 * `headsFp` (#65) is the fingerprint of the heads of the content DRIVE HOLDS at
 * `revision` — NEVER of our own doc. See {@link headsFingerprint}.
 */
export interface RemoteBaseline {
  revision: string | null;
  modifiedTime: string | null;
  checkedAt: string | null; // ISO; the row's updatedAt. NaN/future => expired.
  headsFp: string | null; // null => unknown => never skip (#65).
}

/**
 * The persisted baseline row as read back from the worker cache. The worker
 * treats `payload` as an OPAQUE string and never parses it — this module owns
 * the format (see {@link encodeBaselinePayload}/{@link decodeBaselinePayload}),
 * which is what keeps every branch of the codec pure and table-testable. Read
 * alongside the cached doc in the one `initAndLoadCache` round-trip so the two
 * can never be read out of step.
 */
export interface RemoteBaselineRow {
  payload: string;
  checkedAt: string;
}

/** A decoded baseline payload. `headsFp: null` => unknown => never skip. */
export interface DecodedBaseline {
  revision: string;
  headsFp: string | null;
}

/**
 * Canonical fingerprint of a set of Automerge heads (#65). We only ever ask
 * "same or not", so a joined string beats an array plus a comparator: no
 * ordering question at the call site, plain `===`, and a compact row payload.
 *
 * Exactly as order-sensitive as the worker-private `headsEqual`
 * (`applyAndProject.ts`), which already compares by index on the documented
 * "deterministic sorted change-hash arrays" — so this adds NO new assumption.
 * Takes `readonly string[]` rather than importing the worker's `Heads` so this
 * module keeps its single type-only import (see the header note).
 */
export function headsFingerprint(heads: readonly string[]): string {
  // ⚠️ THIS MUST REMAIN A LOSSLESS ENCODING. `decodeHeadsFingerprint` below is
  // its inverse, and the lineage guard depends on recovering the heads from a
  // stored baseline row. Hashing this — which looks like an obvious tidy-up for
  // a value only ever compared for equality — would silently disable the rebase
  // fleet-wide with no failing test. The round-trip is pinned by a property
  // test for exactly that reason.
  return heads.join(' ');
}

/**
 * The inverse of `headsFingerprint`. `null` means "unusable — do not guess".
 *
 * Change hashes are 64-char lowercase hex and contain no spaces, so the join is
 * reversible by construction. Anything else in the string means the row was
 * written by a format this build does not understand, and the honest answer is
 * "I cannot tell you what Drive held" rather than a plausible-looking guess:
 * the guard reads `null` as `dirty`, which never adopts over unsynced work.
 */
export function decodeHeadsFingerprint(fp: string | null): string[] | null {
  if (fp === null) return null;
  if (fp === '') return []; // a document with no heads is a real, empty answer
  const parts = fp.split(' ');
  if (!parts.every((h) => /^[0-9a-f]{64}$/.test(h))) {
    console.error(
      '[remoteBaseline] baseline fingerprint is not a head list — ignoring it. ' +
        'If `headsFingerprint` was changed to hash or truncate, this is why: it must stay lossless.'
    );
    return null;
  }
  return parts;
}

/**
 * Does our doc hold changes Drive has never seen (#65)? PURE.
 *
 * An ABSENT baseline fingerprint counts as unpushed: we cannot prove the doc is
 * on Drive, so we must not skip. Same failure direction as the rest of this
 * module — uncertainty costs an extra read, never a missed one.
 */
export function hasUnpushedChanges(baselineFp: string | null, currentFp: string): boolean {
  return baselineFp === null || baselineFp !== currentFp;
}

/** Encode the baseline row payload (#65). The ONE place that knows the format. */
export function encodeBaselinePayload(revision: string, headsFp: string | null): string {
  return JSON.stringify({ r: revision, h: headsFp });
}

/**
 * Decode the baseline row payload (#65). PURE, and NEVER throws.
 *
 * Three cases, all degrading toward a read:
 *  - JSON object with a string `r` — the current format.
 *  - Not JSON at all, but a non-empty string — a LEGACY pre-#65 row, whose
 *    payload was the bare namespaced revision. Usable revision, unknown heads:
 *    the guard declines once, then the next terminus rewrites it in the new
 *    format. No migration needed.
 *  - Anything else (valid JSON of the wrong shape, empty) — `null`, i.e. no
 *    baseline at all, which the guard already handles by reading.
 */
export function decodeBaselinePayload(payload: string): DecodedBaseline | null {
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // A LEGACY pre-#65 row's payload WAS the namespaced revision string — and a
    // namespaced revision is never valid JSON. Recognise it by the prefix rather
    // than by "JSON.parse threw": a truncated new-format row (e.g. a partially
    // written `{"r":"ver:9","h":"ab`) also throws, and treating that as a revision
    // would turn corruption into a silently-wrong baseline with no diagnostic.
    if (payload.startsWith(REVISION_PREFIX)) return { revision: payload, headsFp: null };
    console.error(
      `[remoteBaseline] baseline row payload is neither valid JSON nor a '${REVISION_PREFIX}' revision ` +
        `— treating as no baseline (an extra read, no data at risk). ` +
        `To clear it manually: delete the 'remote-baseline' row from the beanies-automerge-* IndexedDB, or clear the cache.`
    );
    return null;
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const { r, h } = parsed as { r?: unknown; h?: unknown };
    if (typeof r === 'string' && r !== '') {
      return { revision: r, headsFp: typeof h === 'string' ? h : null };
    }
  }
  // Parsed, but not a shape we recognise. Do not guess — no baseline => read.
  console.error(
    `[remoteBaseline] unrecognised baseline row payload; treating as no baseline (an extra read, no data at risk). ` +
      `To clear it manually: delete the 'remote-baseline' row from the beanies-automerge-* IndexedDB, or clear the cache. ` +
      `The next open re-reads Drive and re-seeds the row.`
  );
  return null;
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
