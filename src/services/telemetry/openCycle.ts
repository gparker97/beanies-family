/**
 * Per-open redundancy counters — "how much work did opening the app actually do?"
 *
 * 30-day prod CloudWatch showed a single open reconstructing the family's CRDT
 * document more than once (a full local `cacheLoad` AND a full Drive
 * `remoteLoad`), re-projecting every store 3-4x, and writing the file back even
 * when nothing had changed. Timings alone can't police that: `perfTiming`'s
 * TELEMETRY_FLOOR_MS drops anything under 250ms, so the moment the redundancy is
 * fixed the evidence of the fix disappears. These are COUNTS, not durations, so
 * a regression is visible as a rate whether it is fast or slow.
 *
 * Window discipline (this is the whole design):
 *   - `beginOpen(path)` is called from ONE place — `App.vue`'s `loadFamilyData`,
 *     once the open path is known. It owns the window.
 *   - `bump()` is a NO-OP when no window is open. That is deliberate: the header
 *     Refresh button and the deferred config-heal both reach the same sync code
 *     as an open, and a 03:00 poll-tick merge would otherwise be counted as
 *     tomorrow's open. No caller-side conditionals are needed anywhere.
 *   - `endOpen()` emits exactly once and closes the window, and ONLY for the caller
 *     holding that window's token. A second call, a call with no window open, or a
 *     call from a non-owner (Refresh, config-heal) does nothing.
 *   - A `beginOpen` while a window is already open emits the stale one as
 *     `open-abandoned` rather than silently discarding its counts.
 *
 * Constraints (enforced at review): imports only `logEvent`; imports no store and
 * no util (`perfTiming` imports THIS, so the reverse would be a cycle); no async;
 * no import-time side effects; never throws.
 *
 * Context keys are all pre-existing allowlist members (`action`, `error_code`,
 * `detail`; `provider_type` is supplied by `enrichAndRedact`, never by us) — see `src/utils/diagnosticContext.ts`. The counts
 * also ride in `message`, which bypasses the allowlist by design, so they survive
 * to CloudWatch even if a key is ever renamed. NO new context key ships here, so
 * no `ALLOWED_CONTEXT_KEYS` / Lambda-mirror / store-declaration change is needed.
 *
 * REMOVAL CRITERION: the durable regression guard is the pass-count unit test in
 * `applyAndProject.test.ts` / the syncStore suites. These counters are the FIELD
 * guard, for what escapes the unit tests. If after two quarters no counter has
 * ever caught something the unit tests did not, delete this module.
 */

import { logEvent } from './logEvent';

/**
 * Which open path ran — matches `loadFamilyData`'s own breadcrumb labels.
 * `unknown` is the label between opening the window and reaching a branch.
 */
export type OpenPath = 'unknown' | 'path1a' | 'path1b' | 'path2' | 'path3';

/** Opaque handle proving which window a caller opened. */
export type OpenToken = number;

/** How the open finished. */
export type OpenOutcome =
  /** The open finished normally (whatever work it did). */
  | 'open-complete'
  /** The open threw or ended on an error branch — offline, auth, corrupt file. */
  | 'open-failed'
  /** PR 2: the read guard proved the file had not changed and skipped the download. */
  | 'open-skip'
  /** PR 2: the read guard could not prove it and fell open to a full read. */
  | 'open-fail-open'
  /** A new open started while this window was still in flight. */
  | 'open-abandoned';

/** The things we count. One bump per real occurrence. */
export type OpenCounter =
  /** A full CRDT reconstruction (`automerge.cacheLoad` / `automerge.remoteLoad`). */
  | 'reconstruction'
  /** A whole-file read from the storage provider. */
  | 'driveRead'
  /** A whole-file write to the storage provider. */
  | 'driveWrite'
  /** A full ~21-store re-projection (`reloadAllStores`). */
  | 'storeReload';

interface OpenWindow {
  path: OpenPath;
  reconstruction: number;
  driveRead: number;
  driveWrite: number;
  storeReload: number;
  snapshot: 'hit' | 'miss' | 'none';
}

let current: OpenWindow | null = null;
/** Monotonic id of the current window. `endOpen` must present it to close. */
let currentToken = 0;

function fresh(path: OpenPath): OpenWindow {
  return {
    path,
    reconstruction: 0,
    driveRead: 0,
    driveWrite: 0,
    storeReload: 0,
    snapshot: 'none',
  };
}

/** Flat, greppable scalar — also the `detail` context value. */
function summarize(w: OpenWindow): string {
  return `path=${w.path} rec=${w.reconstruction} reads=${w.driveRead} writes=${w.driveWrite} reloads=${w.storeReload} snap=${w.snapshot}`;
}

/**
 * Open the counting window. Called ONLY from `App.vue`'s `loadFamilyData`, once
 * the path is known. An already-open window is emitted as `open-abandoned` so its
 * counts are never silently dropped.
 */
export function beginOpen(path: OpenPath = 'unknown'): OpenToken {
  if (current) endOpen('open-abandoned', currentToken);
  current = fresh(path);
  return ++currentToken;
}

/**
 * Relabel the in-flight window without disturbing its counters.
 *
 * `loadFamilyData` can legitimately traverse more than one path in a single open
 * — path1a (cache-first) falling through to path1b (blocking Drive fetch) is the
 * common case. That is ONE open that did BOTH pieces of work, so restarting the
 * window would under-count it and emit a spurious `open-abandoned`. `beginOpen`
 * therefore fires once per `loadFamilyData` call and the branches relabel; the
 * emitted `path` is the furthest branch reached. No-op when no window is open.
 */
export function setOpenPath(path: OpenPath): void {
  if (!current) return;
  current.path = path;
}

/** Increment a counter. No-op when no window is open — see the window discipline above. */
export function bump(kind: OpenCounter): void {
  if (!current) return;
  current[kind] += 1;
}

/** Record whether the projection snapshot painted. No-op when no window is open. */
export function noteSnapshot(hit: boolean): void {
  if (!current) return;
  current.snapshot = hit ? 'hit' : 'miss';
}

/**
 * Emit the record and close the window. Idempotent: a second call, or a call with
 * no window open, does nothing. `failOpenReason` is the classified reason the
 * open-path read guard declined to skip. That guard lands in PR 2; until then the
 * `open-skip` / `open-fail-open` outcomes have no production producer by design.
 */
export function endOpen(
  outcome: OpenOutcome,
  token: OpenToken | undefined,
  extra?: { failOpenReason?: string; detailSuffix?: string }
): void {
  const w = current;
  if (!w) return;
  // OWNERSHIP: only the caller holding this window's token may close it, and an
  // absent token can never close one. `backgroundSyncFromFile` is reachable
  // mid-open from the header Refresh button and the deferred config-heal; without
  // this, one of those closes and emits the real open's window early, every later
  // bump() silently no-ops, and the record ships `reads=0 writes=0` — biasing the
  // numbers toward "the redundancy fix worked" in exactly the cases where it did
  // not. Non-owners are ignored, not merely deduplicated.
  if (token === undefined || token !== currentToken) return;
  current = null;

  const detail = extra?.detailSuffix ? `${summarize(w)} ${extra.detailSuffix}` : summarize(w);

  logEvent({
    level:
      outcome === 'open-failed' || outcome === 'open-fail-open' || outcome === 'open-abandoned'
        ? 'warn'
        : 'info',
    surface: 'open-cycle',
    // Counts live in `message` too — it bypasses the context allowlist, so they
    // reach CloudWatch even if a context key is ever renamed.
    message: `${outcome}: ${detail}`,
    // NOTE: no `provider_type` here. `enrichAndRedact` sets it from the sync store
    // on EVERY event (`diagnosticContext.ts`), so a caller-supplied value is
    // silently overwritten — passing one would be dead plumbing that reads as
    // intent. The enriched value is the correct one; slice on that.
    context: {
      action: outcome,
      detail,
      ...(extra?.failOpenReason ? { error_code: extra.failOpenReason } : {}),
    },
  });
}

/** Test-only: drop any in-flight window without emitting. */
export function __resetOpenCycleForTesting(): void {
  current = null;
}
