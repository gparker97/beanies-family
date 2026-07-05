/**
 * ADR-032 — the Automerge Web Worker entry point.
 *
 * STATUS: Task #2 skeleton. It establishes the handshake + the serialized
 * async-FIFO message loop (postMessage ordering only serializes the *sync*
 * prefix of each handler, so async merge/persist handlers MUST run one-at-a-time
 * via an explicit promise chain — else a mutation could interleave inside an
 * in-flight merge). Task #3 wires the real handlers (`docOps`/`applyAndProject`);
 * for now every method rejects with a clear "not implemented" so nothing fails
 * silently.
 */
import { serializeError, type RpcRequest, type RpcResponse, type WorkerSignal } from './protocol';

function post(msg: RpcResponse | WorkerSignal): void {
  (self as unknown as Worker).postMessage(msg);
}

/** Task #3 replaces this with the real dispatch into the shared op handlers. */
async function handle(req: RpcRequest): Promise<{ result?: unknown; delta?: unknown }> {
  switch (req.method) {
    case 'setKey':
      // Accept the key silently (stored in Task #3). No response expected.
      return {};
    default:
      throw new Error(`docWorker: method '${req.method}' not implemented (Task #3)`);
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
      // setKey is fire-and-forget (no cid tracking on the client for it); still
      // ack so the FIFO stays observable.
      post({ cid: req.cid, ok: true, result, delta } as RpcResponse);
    } catch (err) {
      post({ cid: req.cid, ok: false, error: serializeError(err) });
    }
  });
};

// Handshake — the WASM top-level-await (added in Task #3) will defer this, so the
// client waits for `ready` before sending work.
post({ signal: 'ready' });
