import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, isReactive } from 'vue';
import { CorruptPayloadError, PayloadTooLargeError } from '@/types/sync';
import { PodLineageError, lineageBlockError } from '@/services/sync/podLineage';
import { serializeError, type RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({ applyDelta: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
// Stub the visibility tracker (not the DOM): default = never hidden, so the
// suspension-aware deadline behaves exactly like a plain timeout unless a test
// overrides the implementation (see the suspension-aware describe below).
vi.mock('@/utils/visibilityTracker', () => ({
  wasHiddenSince: vi.fn(() => false),
  getHiddenDurationMs: vi.fn(() => null),
}));

import { showToast } from '@/composables/useToast';
import { wasHiddenSince } from '@/utils/visibilityTracker';
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
  logMergeTerminus,
  setLocalChangeHandler,
  checkWorkerLiveness,
  initAndLoadCache,
  setInlineExecutor,
  forceInlineMode,
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

  it('reconstructs a generic BACKGROUND-op error, rejects, and reports firehose-only (no toast)', async () => {
    useWorker((req) => ({
      cid: req.cid,
      ok: false,
      error: { name: 'Error', message: 'db exploded' },
    }));
    await expect(getHeads()).rejects.toThrow('db exploded');
    expect(showToast).not.toHaveBeenCalled(); // background op → never toasts
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'doc-worker', severity: 'error' })
    );
  });

  it('a USER-ACTION op error toasts WITHOUT paging (no critical flag)', async () => {
    useWorker((req) => ({
      cid: req.cid,
      ok: false,
      error: { name: 'Error', message: 'write failed' },
    }));
    await expect(mutate({ op: 'delete', collection: 'todos', id: 'x' })).rejects.toThrow(
      'write failed'
    );
    expect(showToast).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(showToast).mock.calls[0]![3] as Record<string, unknown>;
    expect(opts.surface).toBe('doc-worker');
    expect(opts.critical).toBeUndefined(); // never pages — useToast auto-reports non-paging
    expect(reportError).not.toHaveBeenCalled(); // no double-report beside the toast
  });

  it('rejects a CorruptPayloadError as its class WITHOUT a toast (recovery classifies it)', async () => {
    useWorker((req) => ({
      cid: req.cid,
      ok: false,
      error: serializeError(new CorruptPayloadError('bad payload', 'materialize', 'fam-1')),
    }));
    await expect(
      // A realistic envelope: `postRaw` now rejects a payload-less one outright,
      // because that shape means a long-lived/stripped envelope leaked to the worker.
      mergeRemoteEnvelope({ encryptedPayload: 'ZmFrZQ==' } as never, 'fam-1', {
        kind: 'baseline',
        heads: null,
      })
    ).rejects.toBeInstanceOf(CorruptPayloadError);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('logs a rebase terminus with what it carried, at warn when it dropped a write', () => {
    // ⚠️ ONE LOGGER, BOTH TERMINI. They were two copies of the same question and
    // they drifted: the poll terminus carried `replayed`/`conflicts` and warned
    // on a dropped write, while the OPEN terminus — the path an offline peer
    // actually takes when it comes back and gets rebased — logged a bare `info`
    // with neither field. The case the soak exists to measure was the case
    // reporting nothing.
    logMergeTerminus('open terminus', { action: 'rebased', replayed: 7, conflicts: 2 }, 'fam-1');

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'pod-lineage',
        message: 'open terminus rebased',
        context: expect.objectContaining({
          action: 'rebased',
          family_id: 'fam-1',
          detail: 'replayed=7,conflicts=2',
        }),
      })
    );
  });

  it('stays at info for a clean rebase, and omits the detail for every other action', () => {
    logMergeTerminus('poll terminus', { action: 'rebased', replayed: 3, conflicts: 0 }, 'fam-1');
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: 'info',
        // ⚠️ ON THE SUCCESS PATH TOO, or the RATE is unmeasurable and only
        // failures are visible.
        context: expect.objectContaining({ detail: 'replayed=3,conflicts=0' }),
      })
    );

    logMergeTerminus('poll terminus', { action: 'merged' }, 'fam-1');
    const last = vi.mocked(logEvent).mock.calls.at(-1)![0];
    // The field's presence is itself the answer to "did a rebase happen".
    expect(last.context).not.toHaveProperty('detail');
    expect(last.level).toBe('info');
  });

  it('reports a rebase that could not run — on the BLOCKED half', async () => {
    // ⚠️ THE SOAK'S DECIDING SIGNAL. This was a `sink.perf(..., 1)` sample and
    // `perfTiming.record` only escalates to telemetry at/above 250ms, so it
    // reached the console and nothing else. Without it, "the rebase machinery
    // is broken" and "the guard correctly refused" are the same row in
    // CloudWatch and there is no evidence on which to enable compaction.
    useWorker((req) => ({
      cid: req.cid,
      ok: false,
      error: serializeError(lineageBlockError('adopt-remote', { rebaseUnavailable: true })),
    }));

    await expect(
      mergeRemoteEnvelope({ encryptedPayload: 'ZmFrZQ==' } as never, 'fam-1', {
        kind: 'baseline',
        heads: ['h1'],
      })
    ).rejects.toBeInstanceOf(PodLineageError);

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'pod-rebase',
        context: expect.objectContaining({
          action: 'rebase-unavailable',
          error_code: 'blocked',
          family_id: 'fam-1',
        }),
      })
    );
  });

  it('reports a rebase that could not run — on the ADOPTED half', async () => {
    // The `user-file` fallback resolves rather than throwing, so reporting only
    // the rejected side would leave a whole class dark.
    useWorker((req) => ({
      cid: req.cid,
      ok: true,
      result: {
        action: 'adopted',
        heads: [],
        remoteHeads: [],
        dirty: false,
        changed: true,
        rebaseUnavailable: true,
      },
    }));

    await mergeRemoteEnvelope({ encryptedPayload: 'ZmFrZQ==' } as never, 'fam-1', {
      kind: 'user-file',
      heads: ['h1'],
    });

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'pod-rebase',
        context: expect.objectContaining({ error_code: 'adopted' }),
      })
    );
  });

  it('says nothing when the rebase was never asked for', async () => {
    // Anti-vacuity: an unconditional emit would make both tests above pass and
    // poison the metric with every ordinary merge.
    useWorker((req) => ({
      cid: req.cid,
      ok: true,
      result: {
        action: 'merged',
        heads: [],
        remoteHeads: [],
        dirty: false,
        changed: true,
      },
    }));

    await mergeRemoteEnvelope({ encryptedPayload: 'ZmFrZQ==' } as never, 'fam-1', {
      kind: 'baseline',
      heads: ['h1'],
    });

    expect(logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ surface: 'pod-rebase' }));
  });

  it('reports an OOM exactly ONCE, with no toast, in WORKER mode', async () => {
    useWorker((req) => ({
      cid: req.cid,
      ok: false,
      error: serializeError(new PayloadTooLargeError('oom', 'load', 'fam-1', 3_145_728)),
    }));

    await expect(
      mergeRemoteEnvelope({ encryptedPayload: 'ZmFrZQ==' } as never, 'fam-1', {
        kind: 'baseline',
        heads: null,
      })
    ).rejects.toBeInstanceOf(PayloadTooLargeError);

    // Expected degradation: the fatal overlay is the user surface, not a toast.
    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);

    const call = vi.mocked(reportError).mock.calls[0][0];
    expect(call.surface).toBe('pod-load-memory');
    // NOT critical: no data is lost and the file is intact, so paging per
    // occurrence would be noise.
    expect(call.severity).toBe('error');
    expect(call.context).toMatchObject({
      action: 'pod-load-oom',
      error_code: 'load',
      perf_doc_bytes: 3_145_728,
    });
    // The message must be CONSTANT per step. `errorReporter` buckets its dedup
    // on (surface, normalizeMessage), and normalizeMessage only collapses runs
    // of 6+ digits — so a per-pod byte figure here would give every pod its own
    // bucket and defeat the throttle entirely.
    expect(call.message).not.toMatch(/\d/);
  });

  it('reports an OOM exactly ONCE, with no toast, in INLINE mode', async () => {
    // Inline is the fallback when the worker cannot spawn — disproportionately
    // the low-end devices this change is about. Before routing the inline branch
    // through surface(), this population was invisible to the metric.
    setInlineExecutor(async () => {
      throw new PayloadTooLargeError('oom', 'materialize', 'fam-2', 999);
    });
    forceInlineMode();

    await expect(getHeads()).rejects.toBeInstanceOf(PayloadTooLargeError);

    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0][0].context).toMatchObject({
      action: 'pod-load-oom',
      error_code: 'materialize',
      perf_doc_bytes: 999,
    });
  });

  it('does not report a NON-payload inline error through the OOM path', async () => {
    // Routing inline through surface() must not change behaviour for anything
    // else: it stays quiet (no toast, as today) and emits no pod-load event.
    setInlineExecutor(async () => {
      throw new Error('something else went wrong');
    });
    forceInlineMode();

    await expect(getHeads()).rejects.toThrow('something else went wrong');

    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('rejects a stripped envelope at the RPC boundary instead of destroying the cache', async () => {
    // A long-lived envelope carries no payload. Letting one through would decrypt
    // to zero bytes, surface as CorruptPayloadError, and CLEAR THE USER'S CACHE.
    useWorker(() => null);
    await expect(
      mergeRemoteEnvelope({ encryptedPayload: '', familyId: 'f' } as never, 'f', {
        kind: 'baseline',
        heads: null,
      })
    ).rejects.toThrow(/no encryptedPayload/);
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
      'f',
      { kind: 'baseline', heads: null }
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

  it('a HEAVY_METHOD (mergeRemoteEnvelope) survives past 45s; a light mutate behind it EXTENDS instead of timing out', async () => {
    vi.useFakeTimers();
    try {
      useWorker(() => null); // never responds → both hang until their deadlines fire
      const mergeOutcome = mergeRemoteEnvelope(
        // Non-empty: an empty payload is now rejected at the RPC boundary before
        // any timeout logic runs, which is a different test.
        { encryptedPayload: 'ZmFrZQ==', familyId: 'f' } as never,
        'f',
        { kind: 'baseline', heads: null }
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
      await vi.advanceTimersByTimeAsync(46_000); // past 45s: mutate's budget fires…

      // …but the light mutate is queued behind the progressing heavy merge in the
      // worker's serial FIFO — its deadline EXTENDS instead of rejecting.
      expect(await Promise.race([mutateOutcome, Promise.resolve('pending')])).toBe('pending');
      expect(await Promise.race([mergeOutcome, Promise.resolve('pending')])).toBe('pending');

      // The merge hits its 120s heavy ceiling → worker-death corroboration (5s probe,
      // unanswered) → teardown drains the mutate (quiet WorkerCrashError) → ONE
      // consolidating NON-paging toast for the drained user-action op. The merge
      // itself (retryable) heals by re-issuing on a fresh respawn — still pending.
      await vi.advanceTimersByTimeAsync(80_000); // t≈126s: 120s ceiling + 5s probe + drain
      expect(await mutateOutcome).toContain('rpc-timeout:mergeRemoteEnvelope');
      expect(showToast).toHaveBeenCalledTimes(1); // drained mutate → toast…
      const toastOpts = vi.mocked(showToast).mock.calls[0]![3] as Record<string, unknown>;
      expect(toastOpts.critical).toBeUndefined(); // …non-paging
      expect(await Promise.race([mergeOutcome, Promise.resolve('pending')])).toBe('pending');

      // The retried merge also hits 120s (+5s probe) → terminal, firehose-only
      // (background op — no second toast).
      await vi.advanceTimersByTimeAsync(130_000);
      await expect(mergeOutcome).resolves.toContain("'mergeRemoteEnvelope' timed out");
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'doc-worker', severity: 'error' })
      );
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

  it('A7: a light-op timeout behind an in-flight mutate EXTENDS its deadline; both complete, worker intact', async () => {
    vi.useFakeTimers();
    try {
      const fw = useWorker(never); // auto-answers nothing; we emit both replies by hand
      const headsOutcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      // A generous explicit budget keeps the mutate in flight past getHeads' 45s budget.
      const mutateOutcome = mutate(
        { op: 'delete', collection: 'todos', id: 'z' },
        { timeoutMs: 100_000 }
      ).then(
        (r) => r,
        (e: Error) => e.message
      );

      await vi.advanceTimersByTimeAsync(0); // handshake — both in flight
      await vi.advanceTimersByTimeAsync(46_000); // getHeads' 45s budget fires…

      // …but the mutate in flight is real work → getHeads EXTENDS its deadline
      // instead of rejecting. No probe, no recovery, no rejection, worker intact.
      expect(await Promise.race([headsOutcome, Promise.resolve('pending')])).toBe('pending');
      expect(fw.posted.some((m) => m.method === 'ping')).toBe(false);
      expect(reportError).not.toHaveBeenCalled();
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'doc-worker-recovery',
          message: expect.stringContaining('deadline extended (busy-behind-heavy)'),
        })
      );

      // Both complete normally once the worker answers — as if nothing happened.
      const mutateReq = fw.posted.find((m) => m.method === 'mutate')!;
      fw.emit({ cid: mutateReq.cid, ok: true, result: { id: 'z' } });
      expect(await mutateOutcome).toEqual({ id: 'z' });
      const headsReq = fw.posted.find((m) => m.method === 'getHeads')!;
      fw.emit({ cid: headsReq.cid, ok: true, result: { heads: ['h'] } });
      expect(await headsOutcome).toEqual({ heads: ['h'] });
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('backstop: a light op that EXHAUSTS its extensions behind a live mutate rejects firehose-only without probing', async () => {
    vi.useFakeTimers();
    try {
      const fw = useWorker(never);
      const headsOutcome = getHeads().then(
        () => 'resolved',
        (e: Error) => e.message
      );
      // Quiet long-budget mutate keeps the in-flight guard active the whole time.
      void mutate(
        { op: 'delete', collection: 'todos', id: 'q' },
        { timeoutMs: 400_000, quiet: true }
      ).catch(() => {});

      await vi.advanceTimersByTimeAsync(0); // handshake
      // 45s budget + 3 visible-page extensions → final rejection at the 4th fire (t=180s).
      await vi.advanceTimersByTimeAsync(181_000);

      expect(await headsOutcome).toContain("'getHeads' timed out");
      expect(fw.posted.some((m) => m.method === 'ping')).toBe(false); // backstop short-circuits the probe
      expect(showToast).not.toHaveBeenCalled(); // background op → firehose only
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'doc-worker', severity: 'error' })
      );
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
      expect(showToast).not.toHaveBeenCalled(); // background op → never toasts
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'doc-worker', severity: 'error' }) // single terminal firehose event
      );
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

  it('a false-positive timeout (worker answers the probe) transparently RETRIES on the live worker', async () => {
    vi.useFakeTimers();
    try {
      // The worker misses the FIRST getHeads but answers the corroboration ping →
      // alive-but-busy. The transparent re-issue (attempt 2) then succeeds.
      let headsCalls = 0;
      const wedgeOnceLivePing: Responder = (req) => {
        if (req.method === 'ping') return { cid: req.cid, ok: true, result: { ok: true } };
        if (req.method === 'getHeads') {
          headsCalls += 1;
          return headsCalls >= 2 ? { cid: req.cid, ok: true, result: { heads: ['h'] } } : null;
        }
        return null;
      };
      const { created } = useWorkers([wedgeOnceLivePing]);

      const outcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(45_000); // timeout → probe answers → transparent re-issue heals

      expect(await outcome).toEqual({ heads: ['h'] }); // the caller never saw a failure
      expect(created).toHaveLength(1); // the worker was NOT re-spawned
      expect(showToast).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled(); // no recovery, no firehose failure
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

  it('a false-positive whose retry ALSO times out rejects firehose-only, worker never torn down', async () => {
    vi.useFakeTimers();
    try {
      // The worker never answers getHeads but always answers the ping → alive both times.
      const wedgeHeadsLivePing: Responder = (req) =>
        req.method === 'ping' ? { cid: req.cid, ok: true, result: { ok: true } } : null;
      const { created } = useWorkers([wedgeHeadsLivePing]);

      const outcome = getHeads().then(
        () => 'resolved',
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(45_000); // attempt-1 timeout → probe answers → re-issue
      await vi.advanceTimersByTimeAsync(45_000); // attempt-2 timeout → probe answers → no third attempt

      expect(await outcome).toContain("'getHeads' timed out"); // bounded: rejects after one retry
      expect(created).toHaveLength(1); // worker alive throughout — never re-spawned
      expect(showToast).not.toHaveBeenCalled(); // background op → firehose only
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'doc-worker', severity: 'error' })
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

describe('docClient — suspension-aware deadlines', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
    vi.mocked(wasHiddenSince).mockImplementation(() => false);
  });

  afterEach(() => {
    vi.mocked(wasHiddenSince).mockImplementation(() => false);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('re-arms when the wait spanned a hidden period instead of declaring the worker dead', async () => {
    vi.useFakeTimers();
    try {
      let hiddenSince = true; // the page was hidden at some point during the first window
      vi.mocked(wasHiddenSince).mockImplementation(() => hiddenSince);
      const fw = useWorker(never);
      const outcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(46_000); // fire #1 → was-hidden → re-arm

      // No probe, no rejection — suspended time doesn't count as worker death.
      expect(fw.posted.some((m) => m.method === 'ping')).toBe(false);
      expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'doc-worker-recovery',
          message: expect.stringContaining('deadline extended (was-hidden)'),
        })
      );

      // The worker answers during the extended window → completes as if nothing happened.
      hiddenSince = false;
      const req = fw.posted.find((m) => m.method === 'getHeads')!;
      fw.emit({ cid: req.cid, ok: true, result: { heads: ['h'] } });
      expect(await outcome).toEqual({ heads: ['h'] });
      expect(showToast).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hidden-at-fire re-arms do NOT consume the extension cap (overnight-hidden tab)', async () => {
    vi.useFakeTimers();
    try {
      let hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      const fw = useWorker(never);
      const outcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      // 6 consecutive fires while hidden — far past MAX_DEADLINE_EXTENSIONS (3), all exempt.
      await vi.advanceTimersByTimeAsync(45_000 * 6);
      expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');
      expect(fw.posted.some((m) => m.method === 'ping')).toBe(false);

      // Resume → the worker answers → clean completion.
      hidden = false;
      const req = fw.posted.find((m) => m.method === 'getHeads')!;
      fw.emit({ cid: req.cid, ok: true, result: { heads: ['h'] } });
      expect(await outcome).toEqual({ heads: ['h'] });
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounded: visible-page extensions are capped, then the normal timeout ladder runs', async () => {
    vi.useFakeTimers();
    try {
      // Permanently "was hidden during every window" on a visible page → each re-arm
      // consumes the cap; after MAX_DEADLINE_EXTENSIONS (3) the timeout is declared.
      vi.mocked(wasHiddenSince).mockImplementation(() => true);
      const { created } = useWorkers([never, never]);
      const outcome = getHeads().then(
        () => 'resolved',
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      // Attempt 1: 45s budget + 3 capped extensions = 180s, then the probe (which
      // itself extends up to its own cap) confirms death → recover → attempt 2
      // repeats the same bounded sequence → terminal. Advance generously past both.
      await vi.advanceTimersByTimeAsync(400_000);
      await vi.advanceTimersByTimeAsync(400_000);

      expect(await outcome).toContain('timed out');
      expect(created).toHaveLength(2); // bounded — recovered once, terminated on attempt 2
      expect(showToast).not.toHaveBeenCalled(); // background op stays quiet throughout
    } finally {
      vi.useRealTimers();
    }
  });

  it('absolute ceiling: a permanently-hidden page rejects at ABSOLUTE_DEADLINE_CEILING_MS, firehose-only', async () => {
    vi.useFakeTimers();
    try {
      const hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      const fw = useWorker(never);
      const outcome = getHeads().then(
        () => 'resolved',
        (e: Error) => e.message
      );
      // A long-budget quiet mutate keeps the in-flight backstop active, so the
      // ceiling rejection short-circuits the probe (no ping while hidden).
      void mutate(
        { op: 'delete', collection: 'todos', id: 'q' },
        { timeoutMs: 900_000, quiet: true }
      ).catch(() => {});
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(660_000); // hidden fires every 45s; ceiling hit at ≥600s

      expect(await outcome).toContain('exceeded absolute deadline'); // never pends forever
      expect(fw.posted.some((m) => m.method === 'ping')).toBe(false); // backstop skipped the probe
      expect(showToast).not.toHaveBeenCalled();
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'doc-worker', severity: 'error' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('extension telemetry is capped: one event per reason + one settle summary', async () => {
    vi.useFakeTimers();
    try {
      let hidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      const fw = useWorker(never);
      const outcome = getHeads().then(
        (r) => r,
        (e: Error) => e.message
      );
      await vi.advanceTimersByTimeAsync(0); // handshake
      await vi.advanceTimersByTimeAsync(45_000 * 5); // 5 hidden extensions
      hidden = false;
      const req = fw.posted.find((m) => m.method === 'getHeads')!;
      fw.emit({ cid: req.cid, ok: true, result: { heads: ['h'] } });
      expect(await outcome).toEqual({ heads: ['h'] });

      const extensionEvents = vi
        .mocked(logEvent)
        .mock.calls.filter(([e]) => String(e.message).includes('deadline extended'));
      const summaryEvents = vi
        .mocked(logEvent)
        .mock.calls.filter(([e]) => String(e.message).includes('deadline extensions settled'));
      expect(extensionEvents).toHaveLength(1); // first 'hidden' occurrence only
      expect(summaryEvents).toHaveLength(1); // one settle summary
      expect(summaryEvents[0]![0]).toMatchObject({
        context: expect.objectContaining({ recovery_attempt: 5 }),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('docClient — worker crash notification policy', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
  });

  it('crash with only BACKGROUND ops in flight → single firehose event, no toast, no page', async () => {
    const fw = useWorker(never);
    const outcome = getHeads().then(
      () => 'resolved',
      (e: Error) => e.message
    );
    await tick(); // handshake + post
    fw.onerror?.(new Error('boom'));
    expect(await outcome).toContain('boom'); // drained with a definite rejection
    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'doc-worker', severity: 'error' })
    );
  });

  it('crash with a USER-ACTION op (mutate) awaiting → ONE non-paging toast', async () => {
    const fw = useWorker(never);
    const outcome = mutate({ op: 'delete', collection: 'todos', id: 'x' }).then(
      () => 'resolved',
      (e: Error) => e.message
    );
    await tick();
    fw.onerror?.(new Error('boom'));
    expect(await outcome).toContain('boom');
    expect(showToast).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(showToast).mock.calls[0]![3] as Record<string, unknown>;
    expect(opts.critical).toBeUndefined(); // never pages
  });

  it('crash with NOTHING in flight → console-only (guard retained: no toast, no report)', async () => {
    const fw = useWorker(okHeads);
    await getHeads(); // completes — nothing left in flight
    vi.clearAllMocks();
    fw.onerror?.(new Error('idle boom'));
    expect(showToast).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});
