/**
 * `open-paint`: ONE event per app open, when the stores first hold family data.
 *
 * It is the success-path signal for "how long until the family sees something", so the
 * rate of slow opens is `perf_duration_ms > 3000` over all of them. It is emitted with
 * `logEvent` directly (not `perfTiming`) so the 250 ms perf floor never drops a fast open.
 *
 * Keyed on the stores holding data, not on the loading skeleton lifting, so it also
 * covers the beanie wall route, which has no skeleton. A once-per-page-load latch makes
 * every later call (the cache load after a snapshot paint, a re-open) a no-op.
 *
 * `stage` is never passed in: it is read from the open window (`openCycle`'s path, set by
 * `loadFamilyData` as it reaches each branch), so a shared loader such as
 * `loadFromPersistenceCache` (paths 1a AND 2) cannot mislabel the open it serves.
 */
import { loadMaintenanceTaskCount } from '@/services/automerge/loadMaintenance';
import type { SnapshotLoadResult } from '@/services/automerge/worker/protocol';
import { logEvent } from '@/services/telemetry/logEvent';
import { currentOpenPath, type OpenPath } from '@/services/telemetry/openCycle';
import { reportError } from '@/utils/errorReporter';

/** What the first family data came from. `direct`: path 3's in-memory document (just created
 *  by sign-up, an E2E seed, or the memory provider), with no cache, snapshot or download. */
export type OpenPaintKind = 'snapshot' | 'cache' | 'drive' | 'direct';
/** Which open path painted: 1a = local cache (with or without a snapshot), 1b = Drive, 2 = the
 *  cache while file permission is pending, 3 = no file configured; `unknown` outside an open. */
export type OpenPaintStage = '1a' | '1b' | '2' | '3' | 'unknown';

const STAGE_OF: Record<OpenPath, OpenPaintStage> = {
  path1a: '1a',
  path1b: '1b',
  path2: '2',
  path3: '3',
  unknown: 'unknown',
};

/** The stage of the open in flight. */
export function openPaintStage(): OpenPaintStage {
  const path = currentOpenPath();
  return path ? STAGE_OF[path] : 'unknown';
}

export type OpenPaintContext = {
  perf_duration_ms: number;
  kind: OpenPaintKind;
  stage: OpenPaintStage;
  detail: string;
};

let emitted = false;

/** `hit`, `miss-<reason>`, or `n/a` when this open never asked for a snapshot (path 1b). */
export function snapshotDetail(snap: SnapshotLoadResult | null): string {
  if (!snap) return 'n/a';
  return snap.hit ? 'hit' : `miss-${snap.reason ?? 'error'}`;
}

/** Pure: the event's context. `ms` is milliseconds since `performance.timeOrigin`. */
export function buildOpenPaintContext(args: {
  ms: number;
  kind: OpenPaintKind;
  stage: OpenPaintStage;
  snapshot: SnapshotLoadResult | null;
  taskCount: number;
}): OpenPaintContext {
  return {
    perf_duration_ms: Math.max(0, Math.round(args.ms)),
    kind: args.kind,
    stage: args.stage,
    detail: `snap=${snapshotDetail(args.snapshot)};tasks=${args.taskCount}`,
  };
}

/** Emit the event the first time it is called this page load; never throws. */
export function noteOpenPaint(args: {
  kind: OpenPaintKind;
  snapshot: SnapshotLoadResult | null;
}): void {
  if (emitted) return;
  emitted = true;
  try {
    logEvent({
      level: 'info',
      surface: 'open-paint',
      message: 'stores hold family data',
      context: buildOpenPaintContext({
        // performance.now() is already measured from performance.timeOrigin.
        ms: performance.now(),
        ...args,
        stage: openPaintStage(),
        taskCount: loadMaintenanceTaskCount(),
      }),
    });
  } catch (e) {
    reportError({
      surface: 'open-paint',
      message: 'open-paint event failed',
      severity: 'warning',
      error: e,
    });
  }
}

/** Test seam: forget that this page load already emitted. */
export function resetOpenPaintForTests(): void {
  emitted = false;
}
