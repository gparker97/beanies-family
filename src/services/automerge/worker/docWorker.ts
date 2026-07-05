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
import type { MutationOp } from './protocol';
import type { WorkerSink } from './applyAndProject';
import {
  configure,
  setKey,
  initDoc,
  initAndLoadCache,
  mutate,
  mergeRemoteEnvelope,
  exportEncryptedPayload,
  getHeads,
  getChangesSince,
  applyChanges,
  persistEnvelope,
  readEnvelope,
  flush,
  reset,
  clearCache,
} from './applyAndProject';

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

/** Dispatch one RPC into the shared orchestrator. Returns the `{result, delta}`
 * envelope the message loop posts back (delta only for `mutate`). */
async function handle(req: RpcRequest): Promise<{ result?: unknown; delta?: unknown }> {
  const a = (req.args ?? {}) as Record<string, unknown>;
  switch (req.method) {
    case 'setKey':
      setKey(a.key as CryptoKey);
      return {};
    case 'initDoc':
      return { result: initDoc() };
    case 'initAndLoadCache':
      return { result: await initAndLoadCache(a.familyId as string) };
    case 'mutate': {
      const { result, delta } = mutate(req.args as MutationOp);
      return { result, delta };
    }
    case 'mergeRemoteEnvelope':
      return {
        result: await mergeRemoteEnvelope(
          a.envelope as Parameters<typeof mergeRemoteEnvelope>[0],
          (a.familyId as string | null) ?? null
        ),
      };
    case 'exportEncryptedPayload':
      return { result: await exportEncryptedPayload() };
    case 'getHeads':
      return { result: getHeads() };
    case 'getChangesSince':
      return { result: getChangesSince(a.heads as string[]) };
    case 'applyChanges':
      return { result: applyChanges(a.changes as Uint8Array[]) };
    case 'persistEnvelope':
      await persistEnvelope(a.envelope as Parameters<typeof persistEnvelope>[0]);
      return {};
    case 'readEnvelope':
      return { result: await readEnvelope() };
    case 'flush':
      await flush();
      return {};
    case 'reset':
      reset();
      return {};
    case 'clearCache':
      await clearCache(a.familyId as string);
      return {};
    default:
      throw new Error(`docWorker: unknown method '${req.method}'`);
  }
}

// Serialized async FIFO: each request fully completes before the next begins.
let tail: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent) => {
  const req = e.data as RpcRequest;
  if (typeof req?.cid !== 'number') return;
  tail = tail.then(async () => {
    try {
      const { result, delta } = await handle(req);
      post({ cid: req.cid, ok: true, result, delta } as RpcResponse);
    } catch (err) {
      post({ cid: req.cid, ok: false, error: serializeError(err) });
    }
  });
};

// Handshake — deferred past the WASM top-level-await above, so the client only
// starts sending work once the worker (and Automerge) is genuinely ready.
post({ signal: 'ready' });
