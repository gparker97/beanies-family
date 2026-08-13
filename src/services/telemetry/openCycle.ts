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
 *   - `endOpen()` emits exactly once and closes the window; a second call, or a
 *     call with no window open, does nothing.
 *   - A `beginOpen` while a window is already open emits the stale one as
 *     `open-abandoned` rather than silently discarding its counts.
 *
 * Constraints (enforced at review): imports only `logEvent`; imports no store and
 * no util (`perfTiming` imports THIS, so the reverse would be a cycle); no async;
 * no import-time side effects; never throws.
 *
 * Context keys are all pre-existing allowlist members (`action`, `error_code`,
 * `provider_type`, `detail`) — see `src/utils/diagnosticContext.ts`. The counts
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

/** How the open finished. */
export type OpenOutcome = 'open-complete' | 'open-skip' | 'open-fail-open' | 'open-abandoned';

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
export function beginOpen(path: OpenPath = 'unknown'): void {
  if (current) endOpen('open-abandoned');
  current = fresh(path);
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

/** True when an open is in flight — for callers that must not double-emit. */
export function isOpenWindowActive(): boolean {
  return current !== null;
}

/**
 * Emit the record and close the window. Idempotent: a second call, or a call with
 * no window open, does nothing. `failOpenReason` is the classified reason the
 * open-path read guard declined to skip (see `remoteChanged`).
 */
export function endOpen(
  outcome: OpenOutcome,
  extra?: { failOpenReason?: string; providerType?: string; detailSuffix?: string }
): void {
  const w = current;
  if (!w) return;
  current = null;

  const detail = extra?.detailSuffix ? `${summarize(w)} ${extra.detailSuffix}` : summarize(w);

  logEvent({
    level: outcome === 'open-fail-open' || outcome === 'open-abandoned' ? 'warn' : 'info',
    surface: 'open-cycle',
    // Counts live in `message` too — it bypasses the context allowlist, so they
    // reach CloudWatch even if a context key is ever renamed.
    message: `${outcome}: ${detail}`,
    context: {
      action: outcome,
      detail,
      ...(extra?.failOpenReason ? { error_code: extra.failOpenReason } : {}),
      ...(extra?.providerType ? { provider_type: extra.providerType } : {}),
    },
  });
}

/** Test-only: drop any in-flight window without emitting. */
export function __resetOpenCycleForTesting(): void {
  current = null;
}
