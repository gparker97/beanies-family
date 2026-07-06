/**
 * ADR-032 — the Automerge Web Worker entry point.
 *
 * A thin shell: it owns the message envelope (correlation-id ack + serialized
 * async FIFO) and wires the `WorkerSink` to `postMessage`, then delegates ALL
 * domain work to `applyAndProject` (shared with the inline fallback). The
 * async-FIFO matters: `postMessage`/`onmessage` ordering only serializes the
 * SYNC prefix of a handler, but the merge/persist handlers `await` crypto before
 * mutating the doc — so a naive `onmessage = async e => handle(e)` would let
 * message N+1 mutate the doc while N's merge is parked at its decrypt `await`.
 * The explicit `tail = tail.then(...)` chain makes each handler fully complete
 * before the next begins.
 *
 * The Automerge WASM import (via `applyAndProject` → `docOps`) uses top-level
 * await, so this module finishes evaluating — and posts `ready` — only once WASM
 * is initialized. The client waits for `ready` before sending work.
 */
import { serializeError, type RpcRequest, type RpcResponse, type WorkerSignal } from './protocol';
import { configure, dispatch, type WorkerSink } from './applyAndProject';

function post(msg: RpcResponse | WorkerSignal): void {
  (self as unknown as Worker).postMessage(msg);
}

// The worker's sink → main via `postMessage`. Projection chunks + heavy-op perf
// + cache-persist-failed all travel as unsolicited (cid-less) signals.
const workerSink: WorkerSink = {
  pushChunk(delta, final) {
    post({ signal: 'projection', delta, final });
  },
  perf(label, durationMs, ctx) {
    post({ signal: 'perf', label, durationMs, ctx });
  },
  cachePersistFailed(failed) {
    post({ signal: 'cache-persist-failed', failed });
  },
};
configure(workerSink);

// Serialized async FIFO: each request fully completes before the next begins.
let tail: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent) => {
  const req = e.data as RpcRequest;
  if (typeof req?.cid !== 'number') return;
  tail = tail.then(async () => {
    try {
      const { result, delta, changed } = await dispatch(req.method, req.args);
      post({ cid: req.cid, ok: true, result, delta, changed } as RpcResponse);
    } catch (err) {
      post({ cid: req.cid, ok: false, error: serializeError(err) });
    }
  });
};

// Handshake — deferred past the WASM top-level-await above, so the client only
// starts sending work once the worker (and Automerge) is genuinely ready.
post({ signal: 'ready' });
