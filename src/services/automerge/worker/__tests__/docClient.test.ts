import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reactive, isReactive } from 'vue';
import { CorruptPayloadError } from '@/types/sync';
import { serializeError, type RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({ applyDelta: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { showToast } from '@/composables/useToast';
import { record } from '@/utils/perfTiming';
import { applyDelta } from '../../projection';
import { reportError } from '@/utils/errorReporter';
import {
  setWorkerFactory,
  __resetDocClientForTesting,
  getHeads,
  mutate,
  fireAndForgetMutate,
  mergeRemoteEnvelope,
  setLocalChangeHandler,
  checkWorkerLiveness,
  initAndLoadCache,
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

/** Factory that hands out a FRESH worker per spawn (recovery re-spawns), so a
 * test can make the first worker die and the second heal. `created` records every
 * worker the client actually spawned. The last responder is reused if the client
 * spawns more than provided. */
function useWorkers(responders: Responder[]): { created: FakeWorker[] } {
  const created: FakeWorker[] = [];
  let i = 0;
  setWorkerFactory(() => {
    const fw = new FakeWorker();
    fw.responder = responders[Math.min(i, responders.length - 1)]!;
    i += 1;
    created.push(fw);
    return fw;
  });
  return { created };
}

const okHeads: Responder = (req) =>
  req.method === 'getHeads' ? { cid: req.cid, ok: true, result: { heads: ['h'] } } : null;
const never: Responder = () => null;

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

  it('fires the local-change handler only when the mutate changed the doc (F10)', async () => {
    const onChange = vi.fn();
    setLocalChangeHandler(onChange);
    // Worker echoes `changed` based on the op id.
    useWorker((req) => {
      if (req.method !== 'mutate') return null;
      const op = req.args as { id: string };
      return { cid: req.cid, ok: true, result: {}, changed: op.id === 'real' };
    });

    // A no-op (changed:false) schedules NO Drive save.
    await mutate({ op: 'set', collection: 'todos', id: 'noop', entity: { id: 'noop' } });
    expect(onChange).not.toHaveBeenCalled();

    // A real change schedules the save.
    await mutate({ op: 'set', collection: 'todos', id: 'real', entity: { id: 'real' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('fireAndForgetMutate catches a rejected mutate and reports it — no unhandled rejection (F8)', async () => {
    useWorker((req) =>
      req.method === 'mutate'
        ? { cid: req.cid, ok: false, error: serializeError(new Error('mutate boom')) }
        : null
    );
    // Un-awaited by design — the .catch inside must prevent an unhandled rejection.
    fireAndForgetMutate({ op: 'delete', collection: 'todos', id: 'z' });
    await tick();
    await tick();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'doc-mutate-fire-forget' })
    );
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

describe('docClient — postRaw envelope-payload narrowing', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
  });

  it('passes the large encryptedPayload straight through and strips reactive envelope fields', async () => {
    const bigPayload = 'x'.repeat(100_000);
    const reactiveWrapped = reactive({ k1: { wrapped: 'v' } }); // a Vue proxy that would break structuredClone
    const stringifySpy = vi.spyOn(JSON, 'stringify');

    const fw = useWorker((req) =>
      req.method === 'mergeRemoteEnvelope'
        ? { cid: req.cid, ok: true, result: { heads: [], dirty: false } }
        : null
    );
    await mergeRemoteEnvelope(
      { encryptedPayload: bigPayload, wrappedKeys: reactiveWrapped, familyId: 'f' } as never,
      'f'
    );

    const posted = fw.posted.find((p) => p.method === 'mergeRemoteEnvelope')!;
    const env = (posted.args as { envelope: { encryptedPayload: string; wrappedKeys: unknown } })
      .envelope;
    // Payload survives intact (same value, not re-serialized)…
    expect(env.encryptedPayload).toBe(bigPayload);
    // …reactive field is stripped to a clone-safe plain object…
    expect(env.wrappedKeys).toEqual({ k1: { wrapped: 'v' } });
    expect(isReactive(env.wrappedKeys)).toBe(false);
    // …and JSON.stringify was NEVER handed the big payload.
    const sawPayload = stringifySpy.mock.calls.some(
      ([arg]) => arg != null && typeof arg === 'object' && 'encryptedPayload' in (arg as object)
    );
    expect(sawPayload).toBe(false);
    stringifySpy.mockRestore();
  });
});

describe('docClient — Set-driven two-tier RPC timeout', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
  });

  it('a HEAVY_METHOD (mergeRemoteEnvelope) survives past the 45s mutation budget; a mutate times out at 45s', async () => {
    vi.useFakeTimers();
    try {
      useWorker(() => null); // never responds → both hang until their timeout fires
      const mergeOutcome = mergeRemoteEnvelope(
        { encryptedPayload: '', familyId: 'f' } as never,
        'f'
      ).then(
        () => 'resolved',
        (e: Error) => e.message
      );
      const mutateOutcome = mutate({
        op: 'set',
        collection: 'todos',
        id: 't',
        entity: { id: 't' },
      }).then(
        () => 'resolved',
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // flush the ready handshake
      await vi.advanceTimersByTimeAsync(46_000); // past 45s: mutation budget fires, 120s heavy ceiling does not

      // The light mutate times out at 45s. Because a HEAVY op (merge) is still in
      // flight — legitimately progressing toward its own 120s ceiling — the mutate
      // timeout does NOT tear the worker down; it just rejects this one call.
      await expect(mutateOutcome).resolves.toContain("'mutate' timed out");
      expect(await Promise.race([mergeOutcome, Promise.resolve('pending')])).toBe('pending');

      // The merge hits its 120s heavy ceiling → NOW it's worker-death (a heavy op that
      // itself timed out). It recovers + auto-retries once (merge is idempotent/retryable),
      // so it stays pending on the fresh worker rather than rejecting immediately.
      await vi.advanceTimersByTimeAsync(80_000); // past 120s: attempt-1 heavy timeout → recover + retry
      expect(await Promise.race([mergeOutcome, Promise.resolve('pending')])).toBe('pending');

      // The retried merge also hits 120s → terminal failure surfaces (no third attempt).
      await vi.advanceTimersByTimeAsync(125_000);
      await expect(mergeOutcome).resolves.toContain("'mergeRemoteEnvelope' timed out");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('docClient — worker-death recovery on RPC timeout', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
  });

  it('a timed-out RETRYABLE method recovers the worker and heals on a fresh respawn (no toast, no siblings)', async () => {
    vi.useFakeTimers();
    try {
      const { created } = useWorkers([never, okHeads]); // #1 wedges, #2 answers
      const outcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake #1
      await vi.advanceTimersByTimeAsync(45_000); // attempt-1 timeout → recover → retry → spawn #2 → heal

      expect(await outcome).toEqual({ heads: ['h'] });
      expect(created).toHaveLength(2); // proves a fresh worker was spawned
      expect(showToast).not.toHaveBeenCalled(); // silent auto-heal, no siblings
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'doc-worker-recovery',
          context: expect.objectContaining({ method: 'getHeads', attempt: 1, lostSiblings: false }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('a timed-out NON-retryable method (mutate) recovers but does NOT retry — surfaces one toast', async () => {
    vi.useFakeTimers();
    try {
      const { created } = useWorkers([never]);
      const outcome = mutate({ op: 'delete', collection: 'todos', id: 'x' }).then(
        () => 'resolved',
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(45_000); // mutation-budget timeout → recover, no retry

      expect(await outcome).toContain("'mutate' timed out");
      expect(created).toHaveLength(1); // NO re-issue — a mutate must never auto-retry
      expect(showToast).toHaveBeenCalledTimes(1); // terminal failure surfaced
    } finally {
      vi.useRealTimers();
    }
  });

  it('a retryable timeout that drains a concurrent mutate fires exactly ONE consolidating toast', async () => {
    vi.useFakeTimers();
    try {
      const { created } = useWorkers([never, okHeads]); // #1 wedges (both calls), #2 answers getHeads
      const headsOutcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      const mutateOutcome = mutate({ op: 'delete', collection: 'todos', id: 'z' }).then(
        () => 'resolved',
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake #1 — both calls now in flight
      await vi.advanceTimersByTimeAsync(45_000); // both 45s timers fire; getHeads (posted first) drives recovery

      // getHeads heals on #2; the drained mutate cannot be re-issued (rejects).
      expect(await headsOutcome).toEqual({ heads: ['h'] });
      expect(await mutateOutcome).not.toBe('resolved');
      expect(created).toHaveLength(2);
      // The healing getHeads is silent, but its drained mutate sibling would vanish —
      // so EXACTLY ONE consolidating toast fires for the lost concurrent work.
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(vi.mocked(showToast).mock.calls[0]![3]).toMatchObject({ surface: 'doc-worker' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a retryable method whose respawn ALSO times out surfaces once and does not loop', async () => {
    vi.useFakeTimers();
    try {
      const { created } = useWorkers([never, never]); // both wedge
      const outcome = getHeads().then(
        () => 'resolved',
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake #1
      await vi.advanceTimersByTimeAsync(45_000); // attempt-1 timeout → retry → spawn #2
      await vi.advanceTimersByTimeAsync(45_000); // attempt-2 timeout → surface, no third spawn

      expect(await outcome).toContain("'getHeads' timed out");
      expect(created).toHaveLength(2); // bounded: exactly two attempts
      expect(showToast).toHaveBeenCalledTimes(1); // single terminal toast (getHeads is non-quiet)
    } finally {
      vi.useRealTimers();
    }
  });

  it('checkWorkerLiveness recovers a wedged worker on resume without a toast', async () => {
    vi.useFakeTimers();
    try {
      // #1 answers the session-establishing load but then wedges on ping; #2 answers ping.
      const loadThenWedge: Responder = (req) =>
        req.method === 'initAndLoadCache'
          ? { cid: req.cid, ok: true, result: { loaded: true } }
          : null;
      const okPing: Responder = (req) =>
        req.method === 'ping' ? { cid: req.cid, ok: true, result: { ok: true } } : null;
      const { created } = useWorkers([loadThenWedge, okPing]);

      const load = initAndLoadCache('fam-1'); // sets currentFamilyId + spawns #1
      await vi.advanceTimersByTimeAsync(0);
      await load;

      const probe = checkWorkerLiveness();
      await vi.advanceTimersByTimeAsync(5_000); // ping ceiling → recover → retry pings #2

      await probe;
      expect(created).toHaveLength(2); // #1 torn down, #2 spawned
      expect(showToast).not.toHaveBeenCalled(); // ping is quiet + no siblings
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'doc-worker-recovery' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('checkWorkerLiveness is a NO-OP when signed out (no currentFamilyId) even with a live worker', async () => {
    const fw = useWorker(okHeads);
    await getHeads(); // spawns a live worker, but leaves currentFamilyId null
    expect(fw.posted.some((m) => m.method === 'getHeads')).toBe(true);

    await checkWorkerLiveness();
    await tick();
    expect(fw.posted.some((m) => m.method === 'ping')).toBe(false); // never probed
  });

  it('checkWorkerLiveness is a NO-OP when no worker was ever spawned', async () => {
    const { created } = useWorkers([okHeads]);
    await checkWorkerLiveness();
    await tick();
    expect(created).toHaveLength(0); // never spawns a worker just to ping
  });
});
