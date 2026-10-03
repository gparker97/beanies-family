/**
 * docClient's data-layer audit items (2026-10-03): C1's block log, C5's `cache-replay` event,
 * C12's worker-recovery observability, and the projection's authoritative flag.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lineageBlockError } from '@/services/sync/podLineage';
import { serializeError, type RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({
  applyDelta: vi.fn(),
  applyChunk: vi.fn(),
  bumpDocVersion: vi.fn(),
  resetProjection: vi.fn(),
  markAuthoritative: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/visibilityTracker', () => ({
  wasHiddenSince: vi.fn(() => false),
  getHiddenDurationMs: vi.fn(() => null),
}));

import { applyDelta, applyChunk, markAuthoritative } from '../../projection';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  setWorkerFactory,
  setRehydrator,
  setInlineExecutor,
  setLocalChangeHandler,
  __resetDocClientForTesting,
  __isProjectionDirtyForTesting,
  initDoc,
  initAndLoadCache,
  loadProjectionSnapshot,
  mergeRemoteEnvelope,
  mutate,
  getHeads,
  receiveSignal,
  type DocWorkerLike,
} from '../docClient';

type Responder = (req: RpcRequest) => Record<string, unknown> | null;

class FakeWorker implements DocWorkerLike {
  private _on: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: RpcRequest[] = [];
  responder: Responder;
  constructor(responder: Responder) {
    this.responder = responder;
  }
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

function useWorkers(responders: Responder[]): FakeWorker[] {
  const created: FakeWorker[] = [];
  let i = 0;
  setWorkerFactory(() => {
    const fw = new FakeWorker(responders[Math.min(i++, responders.length - 1)]!);
    created.push(fw);
    return fw;
  });
  return created;
}

const ok = (req: RpcRequest, result: unknown, extra: Record<string, unknown> = {}) => ({
  cid: req.cid,
  ok: true,
  result,
  ...extra,
});
const ENVELOPE = { encryptedPayload: 'x' } as never;
const eventsWith = (action: string) =>
  vi
    .mocked(logEvent)
    .mock.calls.map(([e]) => e)
    .filter((e) => (e.context as { action?: string } | undefined)?.action === action);

beforeEach(() => {
  __resetDocClientForTesting();
  vi.clearAllMocks();
});

describe('the authoritative flag (F6 hand-off)', () => {
  it('initDoc marks the projection authoritative; a snapshot fast-paint never does', async () => {
    useWorkers([
      (req) =>
        req.method === 'loadProjectionSnapshot'
          ? ok(req, { hit: true })
          : req.method === 'initDoc'
            ? ok(req, { loaded: true })
            : null,
    ]);
    await loadProjectionSnapshot('fam');
    expect(markAuthoritative).not.toHaveBeenCalled();
    await initDoc();
    expect(markAuthoritative).toHaveBeenCalledTimes(1);
  });
});

describe('C5c: the cache-replay event', () => {
  const replayWith = (replay: Record<string, unknown>) =>
    useWorkers([
      (req) =>
        req.method === 'initAndLoadCache'
          ? ok(req, { loaded: true, remoteBaseline: null, replay })
          : null,
    ]);

  it('a clean replay is an info event with the counts (the success-path denominator)', async () => {
    replayWith({ recovered: false, droppedIncrements: 0, missingDeps: 0, incrementCount: 4 });
    await initAndLoadCache('fam');
    const [e] = eventsWith('cache-replay');
    expect(e).toMatchObject({ level: 'info', surface: 'cache-replay' });
    expect(e!.context).toMatchObject({ count: 4, family_id: 'fam' });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a dropped increment or a missing dep is CRITICAL', async () => {
    replayWith({ recovered: true, droppedIncrements: 1, missingDeps: 0, incrementCount: 3 });
    await initAndLoadCache('fam');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'cache-replay',
        severity: 'critical',
        context: expect.objectContaining({ error_code: 'dropped-increments' }),
      })
    );
  });
});

describe('C1: a compaction refused over a moved remote is its own event', () => {
  it('logs remote-moved-after-compaction and rethrows the block untouched', async () => {
    const err = lineageBlockError('ours-newer', { remoteMovedAfterCompaction: true });
    useWorkers([
      (req) =>
        req.method === 'mergeRemoteEnvelope'
          ? { cid: req.cid, ok: false, error: serializeError(err) }
          : null,
    ]);
    await expect(
      mergeRemoteEnvelope(ENVELOPE, 'fam', { kind: 'baseline', heads: ['h'] })
    ).rejects.toMatchObject({ verdict: 'ours-newer', remoteMovedAfterCompaction: true });
    expect(eventsWith('remote-moved-after-compaction')).toHaveLength(1);
  });
});

describe('C12: worker recovery is observable', () => {
  it('an IDLE worker death is logged (it used to be console-only)', async () => {
    const workers = useWorkers([
      (req) => (req.method === 'getHeads' ? ok(req, { heads: [] }) : null),
    ]);
    await getHeads();
    const fw = workers[0];
    fw!.onerror?.(new Error('idle boom'));
    const [e] = eventsWith('worker-death');
    expect(e!.context).toMatchObject({ recovery_method: 'onerror', lost_siblings: false });
  });

  it('a late mutate reply from the live worker still lands (delta applied, save scheduled)', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      setLocalChangeHandler(onChange);
      // The mutate never answers in time; the liveness ping does, so the worker is kept.
      const workers = useWorkers([(req) => (req.method === 'ping' ? ok(req, { ok: true }) : null)]);
      const outcome = mutate({ op: 'delete', collection: 'todos', id: 'x' }, { timeoutMs: 20 })
        .then(() => 'resolved')
        .catch(() => 'rejected');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(20);
      await vi.advanceTimersByTimeAsync(10);
      expect(await outcome).toBe('rejected');
      const fw = workers[0];
      const req = fw!.posted.find((m) => m.method === 'mutate')!;
      const delta = { kind: 'remove', collection: 'todos', id: 'x' };
      fw!.emit({ cid: req.cid, ok: true, result: true, delta, changed: true, heads: ['h2'] });
      expect(applyDelta).toHaveBeenCalledWith(delta);
      expect(onChange).toHaveBeenCalled();
      expect(eventsWith('late-mutate-landed')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a projection chunk that fails to apply latches dirty and asks for a full re-push', async () => {
    const workers = useWorkers([
      (req) =>
        req.method === 'pushProjection'
          ? ok(req, { pushed: true })
          : req.method === 'getHeads'
            ? ok(req, { heads: [] })
            : null,
    ]);
    await getHeads(); // spawn
    const fw = workers[0];
    vi.mocked(applyChunk).mockImplementationOnce(() => {
      throw new Error('bad chunk');
    });
    receiveSignal({ signal: 'projection', delta: { kind: 'settings', settings: {} }, final: true });
    expect(__isProjectionDirtyForTesting()).toBe(true);
    await vi.waitFor(() => expect(__isProjectionDirtyForTesting()).toBe(false));
    expect(fw!.posted.some((m) => m.method === 'pushProjection')).toBe(true);
  });

  it('a respawn whose rehydrate LOST an acknowledged write reports heads-regressed and re-pushes', async () => {
    const first: Responder = (req) => {
      if (req.method === 'initAndLoadCache') return ok(req, { loaded: true, remoteBaseline: null });
      if (req.method === 'mutate')
        return ok(req, true, {
          delta: { kind: 'remove', collection: 'todos', id: 'x' },
          changed: true,
          heads: ['acked'],
        });
      if (req.method === 'getHeads') return ok(req, { heads: ['acked'] });
      return null;
    };
    const second: Responder = (req) => {
      if (req.method === 'initAndLoadCache') return ok(req, { loaded: true, remoteBaseline: null });
      if (req.method === 'hasHeads') return ok(req, { has: false, loaded: true });
      if (req.method === 'pushProjection') return ok(req, { pushed: true });
      if (req.method === 'getHeads') return ok(req, { heads: ['older'] });
      return null;
    };
    const workers = useWorkers([first, second]);
    setRehydrator(async (familyId) => {
      await initAndLoadCache(familyId);
    });
    await initAndLoadCache('fam');
    await mutate({ op: 'delete', collection: 'todos', id: 'x' });
    workers[0]!.onerror?.(new Error('reaped'));
    await getHeads(); // respawn → rehydrate → heads check
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'doc-worker-recovery',
        severity: 'error',
        context: expect.objectContaining({ action: 'heads-regressed', count: 1 }),
      })
    );
    await vi.waitFor(() =>
      expect(workers[1]!.posted.some((m) => m.method === 'pushProjection')).toBe(true)
    );
    setRehydrator(null);
  });

  it('the inline fallback is logged at warn with its reason', async () => {
    setWorkerFactory(() => {
      throw new Error('no workers here');
    });
    setInlineExecutor(async () => ({ result: { heads: [] } }));
    await getHeads();
    const [e] = eventsWith('inline-fallback');
    expect(e).toMatchObject({ level: 'warn', surface: 'doc-worker-recovery' });
    expect(e!.context).toMatchObject({ recovery_method: 'spawn-failed' });
  });
});
