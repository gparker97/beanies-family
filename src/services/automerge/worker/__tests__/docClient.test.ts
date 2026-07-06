import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CorruptPayloadError } from '@/types/sync';
import { serializeError, type RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({ applyDelta: vi.fn() }));

import { showToast } from '@/composables/useToast';
import { record } from '@/utils/perfTiming';
import { applyDelta } from '../../projection';
import {
  setWorkerFactory,
  __resetDocClientForTesting,
  getHeads,
  mutate,
  mergeRemoteEnvelope,
  type DocWorkerLike,
} from '../docClient';

type Responder = (req: RpcRequest) => Record<string, unknown> | null;

class FakeWorker implements DocWorkerLike {
  private _on: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: RpcRequest[] = [];
  responder: Responder = () => null;
  get onmessage() {
    return this._on;
  }
  set onmessage(fn) {
    this._on = fn;
    if (fn) queueMicrotask(() => this.emit({ signal: 'ready' }));
  }
  postMessage(m: unknown) {
    const req = m as RpcRequest;
    this.posted.push(req);
    const r = this.responder(req);
    if (r) queueMicrotask(() => this.emit(r));
  }
  terminate() {}
  emit(data: unknown) {
    this._on?.({ data });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function useWorker(responder: Responder): FakeWorker {
  const fw = new FakeWorker();
  fw.responder = responder;
  setWorkerFactory(() => fw);
  return fw;
}

describe('docClient', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
  });

  it('handshakes then resolves a request with its result', async () => {
    useWorker((req) =>
      req.method === 'getHeads' ? { cid: req.cid, ok: true, result: { heads: ['h1'] } } : null
    );
    await expect(getHeads()).resolves.toEqual({ heads: ['h1'] });
  });

  it('applies the projection delta and returns the result', async () => {
    const delta = { kind: 'upsert', collection: 'transactions', id: 't1', entity: { id: 't1' } };
    useWorker((req) =>
      req.method === 'mutate'
        ? { cid: req.cid, ok: true, result: { entity: { id: 't1' } }, delta }
        : null
    );
    const r = await mutate({
      op: 'set',
      collection: 'transactions',
      id: 't1',
      entity: { id: 't1' },
    });
    expect(applyDelta).toHaveBeenCalledWith(delta);
    expect(r).toEqual({ entity: { id: 't1' } });
  });

  it('times out, rejects, and discards the late reply by cid', async () => {
    const fw = useWorker(() => null); // never responds
    await expect(
      mutate({ op: 'delete', collection: 'todos', id: 'x' }, { timeoutMs: 20 })
    ).rejects.toThrow(/timed out/);
    // A late reply to the timed-out cid must be ignored (pending already deleted).
    const req = fw.posted.find((m) => m.method === 'mutate')!;
    fw.emit({
      cid: req.cid,
      ok: true,
      result: {},
      delta: { kind: 'remove', collection: 'todos', id: 'x' },
    });
    await tick();
    expect(applyDelta).not.toHaveBeenCalled();
  });

  it('reconstructs a generic error, rejects, and surfaces a toast', async () => {
    useWorker((req) => ({
      cid: req.cid,
      ok: false,
      error: { name: 'Error', message: 'db exploded' },
    }));
    await expect(getHeads()).rejects.toThrow('db exploded');
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showToast).mock.calls[0]![3]).toMatchObject({
      surface: 'doc-worker',
      critical: true,
    });
  });

  it('rejects a CorruptPayloadError as its class WITHOUT a toast (recovery classifies it)', async () => {
    useWorker((req) => ({
      cid: req.cid,
      ok: false,
      error: serializeError(new CorruptPayloadError('bad payload', 'materialize', 'fam-1')),
    }));
    await expect(mergeRemoteEnvelope({} as never, 'fam-1')).rejects.toBeInstanceOf(
      CorruptPayloadError
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it('suppresses the toast when the caller opts out with quiet', async () => {
    useWorker((req) => ({ cid: req.cid, ok: false, error: { name: 'Error', message: 'x' } }));
    await expect(
      mutate({ op: 'delete', collection: 'todos', id: 'y' }, { quiet: true })
    ).rejects.toThrow('x');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('replays a worker perf signal through perfTiming.record', async () => {
    const fw = useWorker((req) =>
      req.method === 'getHeads' ? { cid: req.cid, ok: true, result: {} } : null
    );
    await getHeads();
    fw.emit({
      signal: 'perf',
      label: 'automerge.load',
      durationMs: 1234,
      ctx: { perf_doc_bytes: 2000 },
    });
    expect(record).toHaveBeenCalledWith('automerge.load', 1234, { perf_doc_bytes: 2000 });
  });

  it('rejects all in-flight requests when the worker errors', async () => {
    const fw = useWorker(() => null);
    const p = mutate(
      { op: 'delete', collection: 'todos', id: 'z' },
      { quiet: true, timeoutMs: 5000 }
    );
    await tick(); // let spawn + handshake + post settle
    expect(fw.posted.some((m) => m.method === 'mutate')).toBe(true);
    fw.onerror?.(new Error('worker died'));
    await expect(p).rejects.toThrow(/worker died/);
  });

  it('a worker crash with N in-flight non-quiet calls fires exactly ONE toast (F5 dedup)', async () => {
    const fw = useWorker(() => null); // never responds → the calls stay pending
    const ps = [
      mutate({ op: 'delete', collection: 'todos', id: 'a' }, { timeoutMs: 5000 }),
      mutate({ op: 'delete', collection: 'todos', id: 'b' }, { timeoutMs: 5000 }),
      mutate({ op: 'delete', collection: 'todos', id: 'c' }, { timeoutMs: 5000 }),
    ];
    await tick();
    expect(fw.posted.filter((m) => m.method === 'mutate')).toHaveLength(3);

    fw.onerror?.(new Error('worker died'));

    // Every in-flight call still rejects (a definite failure)…
    const settled = await Promise.allSettled(ps);
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    // …but the crash surfaces exactly ONCE, not once per drained call.
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
