import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reactive, isReactive } from 'vue';
import { CorruptPayloadError } from '@/types/sync';
import { serializeError, type RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({ applyDelta: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { showToast } from '@/composables/useToast';
import { record } from '@/utils/perfTiming';
import { applyDelta } from '../../projection';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  setWorkerFactory,
  setRehydrator,
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
    vi.useFakeTimers();
    try {
      const fw = useWorker(() => null); // never responds (mutate + probe ping)
      const outcome = mutate(
        { op: 'delete', collection: 'todos', id: 'x' },
        { timeoutMs: 20 }
      ).then(
        () => 'resolved',
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(20); // mutate timeout → corroboration probe ping
      await vi.advanceTimersByTimeAsync(5_000); // probe ceiling → death confirmed → reject
      expect(await outcome).toMatch(/timed out/);
      // A late reply to the timed-out cid must be ignored (pending already deleted).
      const req = fw.posted.find((m) => m.method === 'mutate')!;
      fw.emit({
        cid: req.cid,
        ok: true,
        result: {},
        delta: { kind: 'remove', collection: 'todos', id: 'x' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(applyDelta).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
      const { created } = useWorkers([never, okHeads]); // #1 wedges (getHeads + ping), #2 answers
      const outcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake #1
      await vi.advanceTimersByTimeAsync(45_000); // attempt-1 timeout → corroboration probe ping posted
      await vi.advanceTimersByTimeAsync(5_000); // probe ping ceiling → death confirmed → recover → retry → spawn #2 → heal

      expect(await outcome).toEqual({ heads: ['h'] });
      expect(created).toHaveLength(2); // proves a fresh worker was spawned
      expect(showToast).not.toHaveBeenCalled(); // silent auto-heal, no siblings
      // A9: the recovery report carries the REAL triggering method (not 'ping') in the
      // renamed, now-allowlisted keys.
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'doc-worker-recovery',
          context: expect.objectContaining({
            recovery_method: 'getHeads',
            recovery_attempt: 1,
            lost_siblings: false,
          }),
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
      await vi.advanceTimersByTimeAsync(45_000); // mutation-budget timeout → corroboration probe ping
      await vi.advanceTimersByTimeAsync(5_000); // probe ceiling → death confirmed → recover, no retry

      expect(await outcome).toContain("'mutate' timed out");
      expect(created).toHaveLength(1); // NO re-issue — a mutate must never auto-retry
      expect(showToast).toHaveBeenCalledTimes(1); // terminal failure surfaced
    } finally {
      vi.useRealTimers();
    }
  });

  it('A7: a sibling light-op timeout does NOT tear down the worker while a mutate is in flight', async () => {
    vi.useFakeTimers();
    try {
      const fw = useWorker(never); // auto-answers nothing; we emit the mutate reply by hand
      const headsOutcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      // A generous explicit budget keeps the mutate in flight past getHeads' 45s timeout.
      const mutateOutcome = mutate(
        { op: 'delete', collection: 'todos', id: 'z' },
        { timeoutMs: 100_000 }
      ).then(
        (r) => r,
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake — both in flight
      await vi.advanceTimersByTimeAsync(45_000); // getHeads hits 45s; mutate (100s budget) still in flight

      // The mutate in flight is real work → the worker is NOT declared dead. getHeads
      // rejects itself only; no corroboration ping, no recovery, worker intact.
      expect(await headsOutcome).toContain("'getHeads' timed out");
      expect(reportError).not.toHaveBeenCalled(); // worker never torn down → no recovery telemetry
      expect(fw.posted.some((m) => m.method === 'ping')).toBe(false); // mutate-spare short-circuits before any probe

      // The mutate was never dropped — it's still live and now completes normally.
      const mutateReq = fw.posted.find((m) => m.method === 'mutate')!;
      fw.emit({ cid: mutateReq.cid, ok: true, result: { id: 'z' } });
      expect(await mutateOutcome).toEqual({ id: 'z' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a retryable method whose respawn ALSO times out surfaces once and does not loop', async () => {
    vi.useFakeTimers();
    try {
      const { created } = useWorkers([never, never]); // both wedge (getHeads + ping)
      const outcome = getHeads().then(
        () => 'resolved',
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake #1
      await vi.advanceTimersByTimeAsync(50_000); // attempt-1 45s timeout + 5s probe → recover → retry → spawn #2
      await vi.advanceTimersByTimeAsync(50_000); // attempt-2 45s timeout + 5s probe → surface, no third spawn

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

describe('docClient — A1 recovery-rehydrate re-entrancy', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
  });

  it('recovery whose rehydrator issues its own RPC completes instead of deadlocking', async () => {
    vi.useFakeTimers();
    try {
      // #1 answers the session load then wedges (getHeads + ping); #2 answers everything.
      const loadWedge: Responder = (req) =>
        req.method === 'initAndLoadCache'
          ? { cid: req.cid, ok: true, result: { loaded: true } }
          : null;
      const answersAll: Responder = (req) => {
        if (req.method === 'getHeads') return { cid: req.cid, ok: true, result: { heads: ['h'] } };
        if (req.method === 'ping') return { cid: req.cid, ok: true, result: { ok: true } };
        if (req.method === 'initAndLoadCache')
          return { cid: req.cid, ok: true, result: { loaded: true } };
        return null;
      };
      useWorkers([loadWedge, answersAll]);

      // A REALISTIC rehydrator that routes back through the client (production's does
      // initAndLoadCache → request → ensureReady). Without the A1 flag this RPC awaits
      // the very readyPromise spawn() is still resolving → circular deadlock.
      setRehydrator(async () => {
        await getHeads();
      });

      const load = initAndLoadCache('fam-a1'); // sets currentFamilyId → recovery will rehydrate
      await vi.advanceTimersByTimeAsync(0);
      await load;

      const outcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(50_000); // 45s timeout + 5s probe → recover → respawn #2 → rehydrate → retry

      // If the bypass were missing this would still be pending (deadlocked) here.
      expect(await outcome).toEqual({ heads: ['h'] });
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'doc-worker-recovery',
          context: expect.objectContaining({ recovery_method: 'getHeads' }),
        })
      );
    } finally {
      setRehydrator(null);
      vi.useRealTimers();
    }
  });

  it('reset invariant: a throwing rehydrator does not leak the bypass flag (a later death still recovers)', async () => {
    vi.useFakeTimers();
    try {
      // #1 wedges getHeads + ping; #2+ answer getHeads/load but wedge ping + mutate.
      const loadWedge: Responder = (req) =>
        req.method === 'initAndLoadCache'
          ? { cid: req.cid, ok: true, result: { loaded: true } }
          : null;
      const readsNoPing: Responder = (req) => {
        if (req.method === 'getHeads') return { cid: req.cid, ok: true, result: { heads: ['h'] } };
        if (req.method === 'initAndLoadCache')
          return { cid: req.cid, ok: true, result: { loaded: true } };
        return null; // ping + mutate wedge
      };
      useWorkers([loadWedge, readsNoPing]);

      // Rehydrator THROWS — spawn()'s finally must still clear `rehydrating`; if it
      // leaked `true`, the next timeout would hit the A1 reject-self branch and SKIP
      // recovery/telemetry entirely.
      setRehydrator(async () => {
        throw new Error('rehydrate boom');
      });

      const load = initAndLoadCache('fam-a1-reset');
      await vi.advanceTimersByTimeAsync(0);
      await load;

      // Death #1 (getHeads on #1) → recover → respawn #2 (throwing rehydrate, caught) → retry heals on #2.
      const g = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(50_000);
      expect(await g).toEqual({ heads: ['h'] });

      // Death #2 (mutate on #2, non-retryable) → corroboration probe (unanswered) → recover.
      const m = mutate({ op: 'delete', collection: 'todos', id: 'x' }).then(
        () => 'resolved',
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(50_000);
      expect(await m).toContain("'mutate' timed out");

      // TWO recoveries reported ⇒ the flag was reset after the throw (else death #2's
      // timeout would have reject-self'd without recovering).
      expect(reportError).toHaveBeenCalledTimes(2);
    } finally {
      setRehydrator(null);
      vi.useRealTimers();
    }
  });
});

describe('docClient — A7 liveness corroboration', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
  });

  it('a false-positive timeout (worker answers the probe) rejects the call but does NOT tear down', async () => {
    vi.useFakeTimers();
    try {
      // The worker never answers getHeads but DOES answer the corroboration ping → alive.
      const wedgeHeadsLivePing: Responder = (req) =>
        req.method === 'ping' ? { cid: req.cid, ok: true, result: { ok: true } } : null;
      const { created } = useWorkers([wedgeHeadsLivePing]);

      const outcome = getHeads().then(
        () => 'resolved',
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(45_000); // getHeads times out → probe ping sent
      await vi.advanceTimersByTimeAsync(0); // probe answers immediately → false positive

      expect(await outcome).toContain("'getHeads' timed out"); // this call rejects…
      expect(created).toHaveLength(1); // …but the worker is NOT re-spawned
      expect(reportError).not.toHaveBeenCalled(); // no recovery — worker is alive
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'doc-worker-recovery',
          context: expect.objectContaining({ recovery_method: 'liveness-false-positive' }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('a timed-out corroboration probe does NOT recurse into another ping', async () => {
    vi.useFakeTimers();
    try {
      // A non-retryable mutate isolates ONE death detection (no attempt-2 → no 2nd probe).
      const fw = useWorker(never); // wedges mutate AND ping → genuine death
      const outcome = mutate({ op: 'delete', collection: 'todos', id: 'x' }).then(
        () => 'resolved',
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(45_000); // mutate times out → ONE probe ping
      await vi.advanceTimersByTimeAsync(5_000); // probe ceiling → death; mutate non-retryable → reject

      expect(await outcome).toContain("'mutate' timed out");
      // Exactly ONE ping was ever posted — the probe never corroborated itself with a
      // second ping (the `opts.probe` throw-through prevents the recursion).
      expect(fw.posted.filter((m) => m.method === 'ping')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
