/**
 * ADR-032 — the inline fallback bridge (main-thread).
 *
 * When the worker can't spawn (or the `docWorker` flag is off), `docClient` runs
 * the SAME `applyAndProject`/`docOps` on the main thread via this executor. The
 * off-thread benefit is lost but functionality is identical — one implementation,
 * two realms.
 *
 * It configures `applyAndProject` with a main-side sink (projection deltas apply
 * directly; perf goes to the real `perfTiming.record`; cache-persist failures go
 * to the durability-banner handler) and serializes calls with a promise chain —
 * the same async-FIFO discipline the worker uses, so an async merge can't
 * interleave with a following mutate.
 */
import { applyChunk, bumpDocVersion } from '../projection';
import { record as recordPerf } from '@/utils/perfTiming';
import { configure, dispatch, type WorkerSink } from './applyAndProject';
import type { ProjectionDelta } from './protocol';

let cachePersistFailedHandler: ((failed: boolean) => void) | null = null;

/** Task #5: observe worker/inline cache-persist failures (durability banner). */
export function setInlineCachePersistFailedHandler(fn: ((failed: boolean) => void) | null): void {
  cachePersistFailedHandler = fn;
}

const mainSink: WorkerSink = {
  pushChunk(delta: ProjectionDelta, final: boolean) {
    applyChunk(delta);
    if (final) bumpDocVersion();
  },
  perf(label, durationMs, ctx) {
    recordPerf(label, durationMs, ctx);
  },
  cachePersistFailed(failed) {
    cachePersistFailedHandler?.(failed);
  },
};

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  configure(mainSink);
  configured = true;
}

// Serialize inline calls (mirror the worker's async-FIFO).
let tail: Promise<unknown> = Promise.resolve();

/** The inline executor `docClient.setInlineExecutor` consumes. */
export function inlineExecutor(
  method: string,
  args: unknown
): Promise<{ result?: unknown; delta?: ProjectionDelta }> {
  ensureConfigured();
  const run = tail.then(() => dispatch(method, args));
  tail = run.catch(() => undefined); // keep the chain alive even if a call rejects
  return run as Promise<{ result?: unknown; delta?: ProjectionDelta }>;
}

/** Test-only: reset the one-time configure guard + the serialization chain. */
export function __resetInlineBridgeForTesting(): void {
  configured = false;
  tail = Promise.resolve();
  cachePersistFailedHandler = null;
}
