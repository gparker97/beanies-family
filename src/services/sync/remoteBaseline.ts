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
 * Requirement 11 (2026-11-15) adds a CONTENT id: Drive's `md5Checksum`, stored
 * as `md5:<hex>`. Drive keeps advancing `version` after an upload while the
 * bytes stay the same, so a `version` compare reloaded a device's own save and
 * reported races that never happened. Equal content ids are the ONLY new trust
 * (every upload re-encrypts with a fresh IV, so new bytes always get a new id);
 * every other case, including a missing id on either side, compares `version`
 * exactly as before. All of that logic is in `compareMarkers`; no other file
 * reads `contentId` or compares two revisions.
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
  /** Drive's content id at `revision` (`md5:<hex>`), or null => compare `version`. */
  contentId: string | null;
  /** Envelope fingerprint recorded at the last commit (requirement 15 computes it). */
  envelopeFp: string | null;
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

/**
 * A decoded baseline payload. `headsFp: null` => unknown => never skip.
 *
 * ⚠️ `revision` IS NULLABLE, and that is what makes the row writable for a
 * provider that has none. A local file and the Capacitor filesystem expose no
 * revision, so `commitRemoteBaseline` returned before ever persisting a row —
 * and after any reload those families opened with `heads: null`, which the
 * lineage guard reads as `dirty`, which makes the REBASE structurally
 * unavailable. A peer on a local-file family could therefore never have its
 * offline work replayed onto a compacted pod; it could only ever be blocked.
 *
 * `RemoteBaseline.revision` was already nullable and `shouldSkipOpenRead`
 * already gates on `revision === null`, so a revision-less row can never cause
 * a read to be skipped — it carries the heads only.
 */
export interface DecodedBaseline {
  revision: string | null;
  headsFp: string | null;
  /** Row field `c`. Null on a legacy row => the guard compares `version`. */
  contentId: string | null;
  /** Row field `e`. Null on a legacy row. */
  envelopeFp: string | null;
}

/** What one baseline row holds. A {@link RemoteBaseline} is passed as is. */
export type BaselinePayload = DecodedBaseline;

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

/**
 * Encode the baseline row payload (#65). The ONE place that knows the format:
 * `{ r: revision, h: heads fingerprint, c: content id, e: envelope fingerprint }`.
 * Older builds read `r` and `h` and ignore the rest.
 *
 * `revision` may be `null` for a provider that has none (local file, Capacitor):
 * the row then carries the heads alone, which is exactly what the rebase needs
 * and strictly less than what the open-skip needs.
 */
export function encodeBaselinePayload(p: BaselinePayload): string {
  return JSON.stringify({ r: p.revision, h: p.headsFp, c: p.contentId, e: p.envelopeFp });
}

/** A stored envelope fingerprint, or null for anything that is not a string. */
function envelopeFpOf(e: unknown): string | null {
  return typeof e === 'string' ? e : null;
}

/**
 * The heads fingerprint a stored row carries, or null.
 *
 * ⚠️ ONE READER FOR BOTH ARMS, because they disagreed. The revision-less arm
 * required a NON-EMPTY string; the revision arm accepted any string. So
 * `encodeBaselinePayload(null, '')` did not round-trip — and `''` is not a
 * hypothetical: `decodeHeadsFingerprint('')` deliberately answers `[]`, because
 * "a document with no heads" is a real, empty answer rather than a missing one.
 * Two arms reading the same field two ways is the drift; one helper is the fix.
 */
function headsFpOf(h: unknown): string | null {
  return typeof h === 'string' ? h : null;
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
    if (payload.startsWith(REVISION_PREFIX)) {
      return { revision: payload, headsFp: null, contentId: null, envelopeFp: null };
    }
    console.error(
      `[remoteBaseline] baseline row payload is neither valid JSON nor a '${REVISION_PREFIX}' revision ` +
        `— treating as no baseline (an extra read, no data at risk). ` +
        `To clear it manually: delete the 'remote-baseline' row from the beanies-automerge-* IndexedDB, or clear the cache.`
    );
    return null;
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const { r, h, c, e } = parsed as { r?: unknown; h?: unknown; c?: unknown; e?: unknown };
    // Legacy `{ r, h }` rows decode both new fields as null.
    const extra = { contentId: contentIdOf(c), envelopeFp: envelopeFpOf(e) };
    // ⚠️ THE REVISION-LESS ARM COMES FIRST, and the order is load-bearing. A row
    // written by a provider with no revision has `r: null` and a real `h`;
    // falling through to the arm below would treat it as an unrecognised shape,
    // return "no baseline", AND `console.error` on every single open. Writing
    // the row would then be worse than not writing it.
    if (r == null && 'h' in (parsed as object)) {
      // ⚠️ A NULL `h` IS A REAL, MEANINGFUL ROW, not a malformed one: it records
      // "we committed a baseline and could NOT prove what the remote held".
      // Decoding it as `headsFp: null` makes the guard read `dirty`, which is
      // the fail-safe direction. Rejecting it (by requiring a non-empty string)
      // would drop it to "no baseline at all" AND `console.error` on every
      // single open, which is how a correct write turns into log noise plus a
      // silently more permissive verdict.
      // No revision => no content trust either: the writer never pairs a content
      // id with a revision-less row, so one here is not a shape we vouch for.
      return {
        revision: null,
        headsFp: headsFpOf(h),
        contentId: null,
        envelopeFp: extra.envelopeFp,
      };
    }
    if (typeof r === 'string' && r !== '') {
      return { revision: r, headsFp: headsFpOf(h), ...extra };
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
export type ChangeBasis = 'content' | 'revision' | 'mtime' | 'none';

export interface ChangeResult {
  status: ChangeStatus;
  basis: ChangeBasis;
  revision: string | null;
  modifiedTime: string | null;
  /** The probe's content id. Read only through {@link markerOf}. */
  contentId: string | null;
  /**
   * Set when the content is equal and `version` drifted: the probe's revision,
   * for `remoteChanged()` (the ONLY applier) to assign to the in-memory
   * baseline, so a later write-advance check measures from where Drive really
   * is. Never persisted on its own and never touches `checkedAt` or `headsFp`.
   */
  adoptRevision: string | null;
  /** `version` advance with equal content (0 = none), or null when not measured. */
  drift: number | null;
  /** Set whenever the basis is degraded (mtime/none) or the result is a
   *  first-sight read; always logged by the caller. */
  reason?: string;
}

/** The two bases a skip may rest on: content equality, or `version` equality. */
export function isTrustedBasis(basis: ChangeBasis): boolean {
  return basis === 'content' || basis === 'revision';
}

/** An `unknown` result: the probe could not answer (or had nothing to say). */
export function unknownChange(reason: string): ChangeResult {
  return {
    status: 'unknown',
    basis: 'none',
    revision: null,
    modifiedTime: null,
    contentId: null,
    adoptRevision: null,
    drift: null,
    reason,
  };
}

/** The marker a change result was computed from, to learn after a merge. */
export function markerOf(change: ChangeResult): RemoteMarker {
  return {
    revision: change.revision,
    modifiedTime: change.modifiedTime,
    contentId: change.contentId,
  };
}

/**
 * The `detail` of the change-gated `change-probe` event: status, basis
 * (`content` or `version`, the field the comparison rested on) and drift.
 */
export function describeChange(change: ChangeResult): string {
  const basis = change.basis === 'revision' ? 'version' : change.basis;
  return `status=${change.status};basis=${basis};drift=${change.drift ?? 'none'}`;
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

/** Namespace prefix on every stored content id. See {@link toStoredContentId}. */
const CONTENT_PREFIX = 'md5:';

/**
 * Stamp a raw Drive `md5Checksum` into the stored, namespaced form, in the style
 * of {@link toStoredRevision}: a future id kind can never be compared as if it
 * were this one. Anything but a non-empty string is null (=> `version` basis).
 * `unknown` because it reads a JSON field straight off a Drive response.
 */
export function toStoredContentId(md5: unknown): string | null {
  if (typeof md5 !== 'string' || md5 === '') return null;
  return CONTENT_PREFIX + md5;
}

/**
 * A usable stored content id, or null. A wrong namespace, a non-string or an
 * empty digest is "no content id", which falls back to `version`. Never a guess.
 */
function contentIdOf(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith(CONTENT_PREFIX) && v.length > CONTENT_PREFIX.length
    ? v
    : null;
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
  const probeContent = contentIdOf(probe.contentId);
  const baseContent = contentIdOf(baseline?.contentId);
  const fields = {
    revision: probeRevision,
    modifiedTime: probe.modifiedTime,
    contentId: probeContent,
    adoptRevision: null,
    drift: null,
  };

  // Content ids on BOTH sides (requirement 11) => the content basis. Equal means
  // unchanged whatever `version` says; different means read. With an id missing
  // on either side, nothing below this block knows content ids exist.
  if (baseline && probeContent !== null && baseContent !== null) {
    if (probeContent !== baseContent) return { ...fields, status: 'changed', basis: 'content' };
    const drifted = probeRevision !== null && probeRevision !== baseline.revision;
    return {
      ...fields,
      status: 'unchanged',
      basis: 'content',
      adoptRevision: drifted ? probeRevision : null,
      drift: drifted ? revisionAdvance(baseline.revision, probeRevision) : 0,
    };
  }

  // Revision present on the probe => the authoritative, clock-skew-free basis.
  if (probeRevision !== null) {
    if (baseline == null || baseline.revision == null) {
      // First sight of a revision: no baseline to compare against => read.
      return { ...fields, status: 'changed', basis: 'revision', reason: 'no-baseline' };
    }
    const unchanged = baseline.revision === probeRevision;
    return { ...fields, status: unchanged ? 'unchanged' : 'changed', basis: 'revision' };
  }

  // No revision anywhere: fall back to mtime-vs-mtime (today's exact semantics,
  // incl. "no baseline + evidence => changed").
  if (probe.modifiedTime !== null) {
    const unchanged =
      baseline != null &&
      baseline.modifiedTime != null &&
      baseline.modifiedTime === probe.modifiedTime;
    return {
      ...fields,
      status: unchanged ? 'unchanged' : 'changed',
      basis: 'mtime',
      reason: 'mtime-basis',
    };
  }

  // No evidence at all (e.g. memoryProvider returning null mtime).
  return unknownChange('no-evidence');
}

/**
 * The in-memory baseline a freshly learned marker makes (#61 C10). A marker
 * knows the revision and content, never the heads or the envelope behind them:
 * both start null (unknown => never skip) until a terminus fills them in.
 */
export function baselineFromMarker(marker: RemoteMarker, checkedAtIso: string): RemoteBaseline {
  return {
    revision: marker.revision,
    modifiedTime: marker.modifiedTime,
    checkedAt: checkedAtIso,
    headsFp: null,
    contentId: contentIdOf(marker.contentId),
    envelopeFp: null,
  };
}

/** The in-memory baseline a persisted row seeds, or null (=> read). PURE. */
export function baselineFromRow(row: RemoteBaselineRow | null): RemoteBaseline | null {
  if (!row) return null;
  const decoded = decodeBaselinePayload(row.payload);
  return decoded ? { ...decoded, modifiedTime: null, checkedAt: row.checkedAt } : null;
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

/**
 * What the open-path read guard has learned so far (requirement 13). The two
 * I/O answers are filled in by the caller when {@link decideOpenRead} asks:
 * `headsBlock` is the unpushed-changes check (`null` = nothing blocks, a string
 * = its decline reason), `change` the metadata probe. Absent = not asked yet.
 */
export interface OpenReadInputs {
  baseline: RemoteBaseline | null;
  nowMs: number;
  headsBlock?: string | null;
  change?: ChangeResult;
}

/**
 * The guard's next step. `read.probed` is the probe that decided it (never an
 * `unknown` one), for the load to reuse instead of probing again (requirement 14).
 */
export type OpenReadStep =
  | { kind: 'check-heads' }
  | { kind: 'probe' }
  | { kind: 'read'; reason: string; probed: ChangeResult | null }
  | { kind: 'skip'; reason: string };

const readFor = (reason: string, probed: ChangeResult | null = null): OpenReadStep => ({
  kind: 'read',
  reason,
  probed,
});

/**
 * May an open skip its Drive read? PURE: the one ladder, one rung per call.
 *
 * Cheapest first: local facts, then the heads check (one worker round-trip),
 * then the metadata probe. A baseline WITH a content id goes straight to the
 * heads check and the probe: equal content and equal heads skip at any age. A
 * baseline WITHOUT one keeps today's rules exactly (a revision, the one-hour
 * trust window). Heads that differ from the baseline's, or an unknown heads
 * fingerprint, always read: `hasUnpushedChanges` cannot tell ahead from
 * behind, and a skip plus a save could then upload an older document without
 * the lineage guard ever running.
 */
export function decideOpenRead(i: OpenReadInputs): OpenReadStep {
  const b = i.baseline;
  if (b === null) return readFor('no-baseline');
  const hasContent = contentIdOf(b.contentId) !== null;
  const inWindow = withinTrustWindow(b.checkedAt, i.nowMs);
  if (!hasContent && b.revision === null) return readFor('no-baseline');
  if (!hasContent && !inWindow) return readFor('trust-expired');
  if (i.headsBlock === undefined) return { kind: 'check-heads' };
  if (i.headsBlock !== null) return readFor(i.headsBlock);
  if (i.change === undefined) return { kind: 'probe' };
  const c = i.change;
  if (c.status === 'unknown') return readFor(c.reason ?? 'unknown');
  if (!isTrustedBasis(c.basis)) return readFor('no-revision', c);
  if (c.status !== 'unchanged') return readFor(c.reason ?? 'changed', c);
  if (c.basis === 'content') return { kind: 'skip', reason: 'content-unchanged' };
  // Unchanged on `version` only (no content id on the probe): the window still applies.
  if (!inWindow) return readFor('trust-expired', c);
  return { kind: 'skip', reason: 'unchanged-revision-in-window' };
}

/**
 * How far a stored revision moved from `from` to `to`, or `null` when either side is not a
 * comparable `ver:` revision. PURE.
 *
 * The write-race check (audit C4) asks "did anything land between the probe this save read
 * against and the write it just made?". Our own write moves the counter by one; more than
 * that means another writer (or a metadata change) landed inside the window. Ordering is
 * done in BigInt because Drive's `version` is an int64 that JSON delivers as a string —
 * the reason `compareMarkers` refuses to order revisions at all. `null` is the honest
 * answer for anything else, and callers treat it as "no evidence", never as a race.
 */
export function revisionAdvance(
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  // `unknown`, not `string | null`: this reads a provider's write ack, and a partial or
  // older ack must degrade to "no evidence" — never throw AFTER a write that landed.
  const parse = (r: unknown): bigint | null => {
    if (typeof r !== 'string' || !r.startsWith(REVISION_PREFIX)) return null;
    const digits = r.slice(REVISION_PREFIX.length);
    return /^\d+$/.test(digits) ? BigInt(digits) : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return null;
  return Number(b - a);
}

/**
 * What a landed write's acknowledgement says about the window since our probe
 * (requirement 12). PURE.
 *  - `no-ack`: the ack carried no revision (a malformed 2xx); the caller re-probes.
 *  - `clean`: `version` moved by at most one (or cannot be measured), as today.
 *  - `own-bytes`: it moved by more than one, but the ack names the bytes Drive
 *    stored for our write. Commit it like a clean write; the caller still
 *    schedules the race re-merge, whose probe answers `unchanged` on content
 *    while Drive holds our upload and `changed` only when a peer wrote after us.
 *  - `raced`: it moved by more than one and the ack has no content id: today's
 *    race handling, unchanged.
 * `marker` is what to learn. A peer that wrote between our read and our upload
 * was overwritten in both designs; it re-pushes, because its baseline's
 * content id no longer matches the file.
 */
export type WriteAdvance =
  | { kind: 'no-ack' }
  | { kind: 'clean'; advance: number | null; marker: RemoteMarker }
  | { kind: 'own-bytes'; advance: number; marker: RemoteMarker }
  | { kind: 'raced'; advance: number };

export function classifyWriteAdvance(
  probeRevision: string | null,
  ack: WriteAck | null
): WriteAdvance {
  const revision = ack?.revision ?? null;
  if (revision === null) return { kind: 'no-ack' };
  const advance = revisionAdvance(probeRevision, revision);
  const contentId = contentIdOf(ack?.contentId);
  const marker: RemoteMarker = { revision, modifiedTime: null, contentId };
  if (advance === null || advance <= 1) return { kind: 'clean', advance, marker };
  return contentId !== null ? { kind: 'own-bytes', advance, marker } : { kind: 'raced', advance };
}

/**
 * What an open's read sampled BEFORE its download (requirement 17). It is held
 * apart from the baseline until the caller confirms the merge, because until
 * then it describes content the document does not yet contain: a save firing
 * mid-download that compared against it would answer `unchanged`, skip its own
 * read, and upload without the worker's lineage guard ever running (the
 * 2026-11-12 incident).
 *
 * `marker: null` means the probe failed (or has not answered yet).
 * `commitSeq` is the baseline-commit counter at the moment of sampling.
 * `settled` is set once the read was confirmed or rolled back, or a reset
 * discarded it; a settled read can never act on the baseline again.
 *
 * Each read is its OWN handle. Two reads can overlap (the Drive poll and a
 * background or Refresh read guard on different flags), so a confirm or a
 * rollback names the read it settles and can never consume another's.
 */
export interface PendingRead {
  marker: RemoteMarker | null;
  commitSeq: number;
  settled?: boolean;
}

/**
 * Where `load()` hands its caller the read it registered, so the caller can
 * confirm or roll back THAT read. `read` stays null when `load()` returned
 * before registering one (no provider, no permission).
 */
export interface ReadTicket {
  read: PendingRead | null;
}

/**
 * Whether a confirm or rollback by `read` may act (PURE).
 *  - `settled`: already confirmed, rolled back or discarded by a reset. A
 *    no-op for both (a throw after the confirm must not roll it back).
 *  - `superseded`: a newer read is outstanding. Its confirm or rollback will
 *    decide the baseline, so this read's confirm commits nothing (the baseline
 *    stays older than what we hold: the next probe reads again). Its rollback
 *    still nulls the baseline (the safe direction) but leaves the newer read
 *    outstanding.
 *  - `own`: the newest outstanding read; it acts as before.
 */
export type ReadStanding = 'own' | 'superseded' | 'settled';

export function readStanding(read: PendingRead | null, newest: PendingRead | null): ReadStanding {
  if (read === null || read.settled) return 'settled';
  return read === newest ? 'own' : 'superseded';
}

/**
 * What confirming a merged read does to the baseline. Only `learn` and
 * `no-marker` commit anything.
 *  - `learn`: adopt the sampled marker, then commit.
 *  - `no-marker`: the probe failed; commit with NO revision (the read still
 *    proved the heads), which is what `load()`'s up-front null used to do.
 *  - `superseded`: a baseline commit landed after the sample (an overlapping
 *    save's own read or write). Its acknowledgement is newer than our marker,
 *    so commit NOTHING, neither marker nor heads.
 *  - `no-read`: nothing is pending (a reset, a provider change or a disconnect
 *    cleared it mid-read). Commit nothing; the baseline belongs to whatever
 *    replaced the read.
 */
export type MergeConfirm =
  | { kind: 'learn'; marker: RemoteMarker }
  | { kind: 'no-marker' }
  | { kind: 'superseded' }
  | { kind: 'no-read' };

/** Decide what confirming a merged read may commit (requirement 17). PURE. */
export function decideMergeConfirm(
  pending: PendingRead | null,
  commitSeqNow: number
): MergeConfirm {
  if (pending === null) return { kind: 'no-read' };
  if (commitSeqNow !== pending.commitSeq) return { kind: 'superseded' };
  return pending.marker === null
    ? { kind: 'no-marker' }
    : { kind: 'learn', marker: pending.marker };
}
