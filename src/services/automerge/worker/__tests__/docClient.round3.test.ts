/**
 * docClient's round-3 fixes (#117 Phase 2 audit): the acknowledged-write anchor follows the
 * installed document, the projection re-push is honest and capped, the cache-replay event pages
 * only on a first sighting, and `setKey` carries the key's family.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import type { RpcRequest } from '../protocol';

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

import { applyChunk } from '../../projection';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  setWorkerFactory,
  setRehydrator,
  __resetDocClientForTesting,
  __isProjectionDirtyForTesting,
  initAndLoadCache,
  mergeRemoteEnvelope,
  mutate,
  compactDoc,
  getHeads,
  receiveSignal,
  setFamilyKey,
  documentHoldsCacheOf,
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

const MUTATE_REPLY = {
  delta: { kind: 'remove', collection: 'todos', id: 'x' },
  changed: true,
  heads: ['acked'],
};

/** Two workers; the second answers `hasHeads` and records what it was asked. */
function respawnHarness(firstExtra: Responder) {
  const first: Responder = (req) => {
    if (req.method === 'initAndLoadCache') return ok(req, { loaded: true, remoteBaseline: null });
    if (req.method === 'mutate') return ok(req, true, MUTATE_REPLY);
    if (req.method === 'getHeads') return ok(req, { heads: [] });
    return firstExtra(req);
  };
  const second: Responder = (req) => {
    if (req.method === 'initAndLoadCache') return ok(req, { loaded: true, remoteBaseline: null });
    if (req.method === 'hasHeads') return ok(req, { has: true, loaded: true });
    if (req.method === 'getHeads') return ok(req, { heads: [] });
    return null;
  };
  const workers = useWorkers([first, second]);
  setRehydrator(async (familyId) => {
    await initAndLoadCache(familyId);
  });
  return workers;
}

const hasHeadsAsked = (fw: FakeWorker | undefined) =>
  fw?.posted
    .filter((m) => m.method === 'hasHeads')
    .map((m) => (m.args as { heads: string[] }).heads);

describe('round 3, item 8: the acknowledged-write anchor follows the installed document', () => {
  it('after compactDoc the respawn checks the COMPACTED heads, not the pre-compaction ack', async () => {
    const workers = respawnHarness((req) =>
      req.method === 'compactDoc'
        ? ok(req, {
            beforeBytes: 2,
            afterBytes: 1,
            changesBefore: 2,
            changesAfter: 1,
            actorsBefore: 1,
            heads: ['compacted'],
          })
        : null
    );
    await initAndLoadCache('fam');
    await mutate({ op: 'delete', collection: 'todos', id: 'x' });
    const stats = await compactDoc();
    expect(stats).not.toHaveProperty('heads'); // the caller's contract is unchanged
    workers[0]!.onerror?.(new Error('reaped'));
    await getHeads();
    expect(hasHeadsAsked(workers[1])).toEqual([['compacted']]);
    setRehydrator(null);
  });

  it('an ADOPT clears the anchor (no false heads-regressed), a plain MERGE keeps it', async () => {
    let action = 'adopted';
    const workers = respawnHarness((req) =>
      req.method === 'mergeRemoteEnvelope'
        ? ok(req, { action, heads: ['new'], dirty: false, changed: true, remoteHeads: ['new'] })
        : null
    );
    await initAndLoadCache('fam');
    await mutate({ op: 'delete', collection: 'todos', id: 'x' });
    await mergeRemoteEnvelope(ENVELOPE, 'fam', { kind: 'baseline', heads: ['h'] });
    workers[0]!.onerror?.(new Error('reaped'));
    await getHeads();
    expect(hasHeadsAsked(workers[1])).toEqual([]);
    setRehydrator(null);

    __resetDocClientForTesting();
    action = 'merged';
    const again = respawnHarness((req) =>
      req.method === 'mergeRemoteEnvelope'
        ? ok(req, { action, heads: ['m'], dirty: false, changed: true, remoteHeads: ['m'] })
        : null
    );
    await initAndLoadCache('fam');
    await mutate({ op: 'delete', collection: 'todos', id: 'x' });
    await mergeRemoteEnvelope(ENVELOPE, 'fam', { kind: 'baseline', heads: ['h'] });
    again[0]!.onerror?.(new Error('reaped'));
    await getHeads();
    expect(hasHeadsAsked(again[1])).toEqual([['acked']]);
    setRehydrator(null);
  });
});

describe('round 3, item 10: the projection re-push is honest and capped', () => {
  const failChunk = () =>
    receiveSignal({ signal: 'projection', delta: { kind: 'settings', settings: {} }, final: true });

  it('a chunk that fails DURING the re-push leaves the projection dirty', async () => {
    const workers: FakeWorker[] = useWorkers([
      (req) => {
        if (req.method === 'getHeads') return ok(req, { heads: [] });
        if (req.method === 'pushProjection') {
          // The re-push streams a chunk that fails to apply, then answers.
          vi.mocked(applyChunk).mockImplementationOnce(() => {
            throw new Error('still bad');
          });
          queueMicrotask(() =>
            workers[0]?.emit({
              signal: 'projection',
              delta: { kind: 'settings', settings: {} },
              final: true,
            })
          );
          return null;
        }
        return null;
      },
    ]);
    await getHeads();
    const fw = workers[0];
    vi.mocked(applyChunk).mockImplementationOnce(() => {
      throw new Error('bad chunk');
    });
    failChunk();
    const req = await vi.waitFor(() => {
      const r = fw!.posted.find((m) => m.method === 'pushProjection');
      if (!r) throw new Error('no re-push yet');
      return r;
    });
    await new Promise((r) => setTimeout(r, 0)); // the failing chunk lands first
    fw!.emit(ok(req, { pushed: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(__isProjectionDirtyForTesting()).toBe(true);
    const repush = eventsWith('projection-repush').at(-1);
    expect(repush?.context).toMatchObject({ error_code: 'apply-failed' });
  });

  /** A re-push whose own stream fails a chunk (the deterministic case), then answers. */
  const uncleanRepush =
    (workers: () => FakeWorker | undefined): Responder =>
    (req) => {
      if (req.method === 'getHeads') return ok(req, { heads: [] });
      if (req.method === 'pushProjection') {
        vi.mocked(applyChunk).mockImplementationOnce(() => {
          throw new Error('still bad');
        });
        queueMicrotask(() => {
          workers()?.emit({
            signal: 'projection',
            delta: { kind: 'settings', settings: {} },
            final: true,
          });
          queueMicrotask(() => workers()?.emit(ok(req, { pushed: true })));
        });
        return null;
      }
      return null;
    };
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const cappedReports = () =>
    vi
      .mocked(reportError)
      .mock.calls.filter(
        ([e]) => (e.context as { action?: string }).action === 'projection-repush-capped'
      );

  it('a deterministic apply failure re-pushes at most 3 times, then reports once', async () => {
    const workers: FakeWorker[] = useWorkers([uncleanRepush(() => workers[0])]);
    await getHeads();
    for (let i = 0; i < 6; i++) {
      vi.mocked(applyChunk).mockImplementationOnce(() => {
        throw new Error('always bad');
      });
      failChunk();
      await settle();
    }
    expect(workers[0]!.posted.filter((m) => m.method === 'pushProjection')).toHaveLength(3);
    expect(cappedReports()).toHaveLength(1);
  });

  it('a re-push that lands CLEAN resets the run: a later transient failure re-pushes again', async () => {
    const workers = useWorkers([
      (req) =>
        req.method === 'pushProjection'
          ? ok(req, { pushed: true })
          : req.method === 'getHeads'
            ? ok(req, { heads: [] })
            : null,
    ]);
    await getHeads();
    for (let i = 0; i < 6; i++) {
      vi.mocked(applyChunk).mockImplementationOnce(() => {
        throw new Error('transient');
      });
      failChunk();
      await settle();
    }
    expect(workers[0]!.posted.filter((m) => m.method === 'pushProjection')).toHaveLength(6);
    expect(cappedReports()).toHaveLength(0);
  });

  it('heads-regressed is exempt from the cap: a respawn that lost a write still re-pushes', async () => {
    const first: Responder = (req) => {
      if (req.method === 'initAndLoadCache') return ok(req, { loaded: true, remoteBaseline: null });
      if (req.method === 'mutate') return ok(req, true, MUTATE_REPLY);
      return uncleanRepush(() => workers[0])(req);
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
    for (let i = 0; i < 4; i++) {
      vi.mocked(applyChunk).mockImplementationOnce(() => {
        throw new Error('always bad');
      });
      failChunk();
      await settle();
    }
    expect(cappedReports()).toHaveLength(1); // the apply-failure run is capped
    workers[0]!.onerror?.(new Error('reaped'));
    await getHeads(); // respawn -> rehydrate -> heads-regressed
    await vi.waitFor(() =>
      expect(workers[1]!.posted.some((m) => m.method === 'pushProjection')).toBe(true)
    );
    setRehydrator(null);
  });
});

describe('round 3, item 6: the cache-replay event pages only on a first sighting', () => {
  const replayWith = (replay: Record<string, unknown>) =>
    useWorkers([
      (req) =>
        req.method === 'initAndLoadCache'
          ? ok(req, { loaded: true, remoteBaseline: null, replay })
          : null,
    ]);
  const critical = () =>
    vi.mocked(reportError).mock.calls.filter(([e]) => e.severity === 'critical');

  it('a row already reported is a warn, never a page', async () => {
    replayWith({
      recovered: true,
      droppedIncrements: 0,
      missingDeps: 1,
      incrementCount: 3,
      newlyReported: 0,
    });
    await initAndLoadCache('fam');
    expect(critical()).toHaveLength(0);
    expect(eventsWith('cache-replay').at(-1)).toMatchObject({ level: 'warn' });
  });

  it('a first sighting pages', async () => {
    replayWith({
      recovered: true,
      droppedIncrements: 1,
      missingDeps: 0,
      incrementCount: 3,
      newlyReported: 1,
      quarantined: 1,
    });
    await initAndLoadCache('fam');
    expect(critical()).toHaveLength(1);
  });

  it('a replaced base never pages', async () => {
    replayWith({
      recovered: true,
      droppedIncrements: 0,
      missingDeps: 0,
      incrementCount: 0,
      corruptBaseReplaced: true,
    });
    await initAndLoadCache('fam');
    expect(critical()).toHaveLength(0);
  });

  it('a stale-lineage cache logs cache-lineage-stale; a given-up fence logs its decision', async () => {
    replayWith({
      recovered: false,
      droppedIncrements: 0,
      missingDeps: 0,
      incrementCount: 2,
      lineageStale: true,
    });
    await initAndLoadCache('fam');
    expect(eventsWith('cache-lineage-stale')).toHaveLength(1);

    __resetDocClientForTesting();
    replayWith({
      recovered: true,
      droppedIncrements: 0,
      missingDeps: 1,
      incrementCount: 2,
      newlyReported: 0,
      fenceGaveUp: true,
    });
    await initAndLoadCache('fam');
    expect(eventsWith('fence-gave-up')).toHaveLength(1);
    expect(critical()).toHaveLength(0);
  });

  it('cache-lineage-stale says which way it went; bookkeeping failures and the quarantine total are logged', async () => {
    replayWith({
      recovered: false,
      droppedIncrements: 0,
      missingDeps: 0,
      incrementCount: 2,
      lineageStale: true,
      lineageDirection: 'cache-newer',
      quarantinedTotal: 2,
      bookkeepingFailed: ['lineage-baseline-clear:InvalidStateError'],
    });
    await initAndLoadCache('fam');
    const stale = eventsWith('cache-lineage-stale');
    expect(stale).toHaveLength(1);
    expect(String(stale[0]!.context!.detail)).toMatch(/^cache-newer;.*quarantined_total=2/);
    expect(eventsWith('cache-bookkeeping-failed')[0]).toMatchObject({
      level: 'warn',
      context: {
        count: 1,
        detail: 'lineage-baseline-clear:InvalidStateError',
        family_id: 'fam',
      },
    });
  });
});

describe("round 3, item 1: setKey carries the key's family", () => {
  it('posts familyId with the key', async () => {
    const workers = useWorkers([
      (req) =>
        req.method === 'setKey' || req.method === 'setActor' || req.method === 'setCounterWrites'
          ? ok(req, null)
          : null,
    ]);
    await setFamilyKey(await generateFamilyKey(), 'fam-b');
    const post = workers[0]!.posted.find((m) => m.method === 'setKey');
    expect(post?.args).toMatchObject({ familyId: 'fam-b' });
  });
});

describe('round 3: documentHoldsCacheOf (the unpushed-at-signout marker gate)', () => {
  const load = (replay: Record<string, unknown>) =>
    useWorkers([
      (req) =>
        req.method === 'initAndLoadCache'
          ? ok(req, { loaded: true, remoteBaseline: null, replay })
          : null,
    ]);

  it('true only after a CLEAN replay of that family, false after a damaged one', async () => {
    load({ recovered: false, droppedIncrements: 0, missingDeps: 0, incrementCount: 1 });
    await initAndLoadCache('fam');
    expect(documentHoldsCacheOf('fam')).toBe(true);
    expect(documentHoldsCacheOf('other')).toBe(false);

    __resetDocClientForTesting();
    load({
      recovered: true,
      droppedIncrements: 1,
      missingDeps: 0,
      incrementCount: 1,
      newlyReported: 1,
    });
    await initAndLoadCache('fam');
    expect(documentHoldsCacheOf('fam')).toBe(false);
  });
});
