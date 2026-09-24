/**
 * ADR-032 — the inline fallback bridge (main-thread).
 *
 * When the worker can't spawn (or the `docWorker` flag is off), `docClient` runs
 * the SAME `applyAndProject`/`docOps` on the main thread via this executor. The
 * off-thread benefit is lost but functionality is identical — one implementation,
 * two realms.
 *
 * It configures `applyAndProject` with the SAME `postingSink` the worker uses,
 * and hands each signal to `docClient.receiveSignal` (wired by `bootstrap.ts`),
 * so a signal is handled in exactly one place whichever realm raised it (#100).
 * Calls are serialized with a promise chain, the same async-FIFO discipline the
 * worker uses, so an async merge can't interleave with a following mutate.
 */
import { configure, dispatch, postingSink } from './applyAndProject';
import type { ProjectionDelta, WorkerSignal } from './protocol';

let signalHandler: ((sig: WorkerSignal) => void) | null = null;

/** Where inline signals go. Wired once to `docClient.receiveSignal`. */
export function setInlineSignalHandler(fn: ((sig: WorkerSignal) => void) | null): void {
  signalHandler = fn;
}

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  configure(
    postingSink((sig) => {
      if (signalHandler) signalHandler(sig);
      else console.warn('[inlineBridge] signal dropped, no handler wired', sig.signal);
    })
  );
  configured = true;
}

// Serialize inline calls (mirror the worker's async-FIFO).
let tail: Promise<unknown> = Promise.resolve();

/** The inline executor `docClient.setInlineExecutor` consumes. */
export function inlineExecutor(
  method: string,
  args: unknown
): Promise<{ result?: unknown; delta?: ProjectionDelta; changed?: boolean }> {
  ensureConfigured();
  const run = tail.then(() => dispatch(method, args));
  tail = run.catch(() => undefined); // keep the chain alive even if a call rejects
  return run as Promise<{ result?: unknown; delta?: ProjectionDelta; changed?: boolean }>;
}

/** Test-only: reset the one-time configure guard + the serialization chain. */
export function __resetInlineBridgeForTesting(): void {
  configured = false;
  tail = Promise.resolve();
  signalHandler = null;
}
