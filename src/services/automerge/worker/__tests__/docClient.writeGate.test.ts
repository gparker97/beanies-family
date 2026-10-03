/**
 * The read-only write gate in `docClient.mutate` (#95 Phase 3).
 *
 * What is pinned:
 *   - what always passes: `opts.system`, the named `setSettings` op, writes made only of the two
 *     system collections (batches walked recursively), and any write with no gate installed;
 *   - a refused write never reaches the worker, shows the info toast (not with `quiet`), logs
 *     `blocked {kind}` and rejects with `ReadOnlyError`, the class `wrapAsync` recognises;
 *   - one gated op anywhere in a batch refuses the whole batch;
 *   - dry-run (`wouldBlock`) logs `would_block` once per kind per session and lets the write
 *     through;
 *   - `fireAndForgetMutate` hands the refusal to `reportError` (which drops a `ReadOnlyError`;
 *     see `errorReporter.test.ts`) with no unhandled rejection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({
  applyDelta: vi.fn(),
  resetProjection: vi.fn(),
  markAuthoritative: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/visibilityTracker', () => ({
  wasHiddenSince: vi.fn(() => false),
  getHiddenDurationMs: vi.fn(() => null),
}));

import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  setWorkerFactory,
  setWriteGate,
  __resetDocClientForTesting,
  mutate,
  fireAndForgetMutate,
  ReadOnlyError,
  type DocWorkerLike,
} from '../docClient';
import { ReadOnlyError as LeafReadOnlyError } from '../writeGate';
import type { MutationOp } from '../protocol';

/** A worker that answers every mutate with success and records what reached it. */
class FakeWorker implements DocWorkerLike {
  private _on: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: RpcRequest[] = [];
  get onmessage() {
    return this._on;
  }
  set onmessage(fn) {
    this._on = fn;
    if (fn) queueMicrotask(() => this._on?.({ data: { signal: 'ready' } }));
  }
  postMessage(m: unknown) {
    const req = m as RpcRequest;
    this.posted.push(req);
    if (req.method === 'mutate') {
      queueMicrotask(() =>
        this._on?.({ data: { cid: req.cid, ok: true, result: { ok: 1 }, changed: true } })
      );
    }
  }
  terminate() {}
}

const tick = () => new Promise((r) => setTimeout(r, 0));

let fw: FakeWorker;
const mutatesPosted = () => fw.posted.filter((r) => r.method === 'mutate').length;

const gate = { block: false, wouldBlock: false };
const READ_ONLY = { block: true, wouldBlock: false };
const DRY_RUN = { block: false, wouldBlock: true };

function useGate(v: { block: boolean; wouldBlock: boolean }): void {
  Object.assign(gate, v);
  setWriteGate(() => ({ ...gate }));
}

const todo: MutationOp = { op: 'set', collection: 'todos', id: 't1', entity: { id: 't1' } };
const notificationRead: MutationOp = {
  op: 'patch',
  collection: 'notificationReads',
  id: 'm1',
  patch: { n1: '2026-09-30' },
  onMissing: 'create',
};
const overlapAck: MutationOp = {
  op: 'set',
  collection: 'overlapAcknowledgments',
  id: 'o1',
  entity: { id: 'o1' },
};
const setSettings: MutationOp = { op: 'named', name: 'setSettings', args: { theme: 'dark' } };

const gateEvents = (action: string) =>
  vi
    .mocked(logEvent)
    .mock.calls.filter(
      ([e]) =>
        e.surface === 'read-only-gate' && (e.context as { action?: string })?.action === action
    );

describe('docClient write gate (#95)', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
    vi.clearAllMocks();
    fw = new FakeWorker();
    setWorkerFactory(() => fw);
  });

  it('passes every write when no gate is installed', async () => {
    await expect(mutate(todo)).resolves.toEqual({ ok: 1 });
    expect(mutatesPosted()).toBe(1);
  });

  it('passes a writable family untouched, with no event', async () => {
    useGate({ block: false, wouldBlock: false });
    await mutate(todo);
    expect(mutatesPosted()).toBe(1);
    expect(logEvent).not.toHaveBeenCalled();
  });

  describe('while read-only', () => {
    beforeEach(() => useGate(READ_ONLY));

    it('refuses a family-data write before it reaches the worker: toast, event, ReadOnlyError', async () => {
      const outcome = mutate(todo);
      await expect(outcome).rejects.toBeInstanceOf(ReadOnlyError);
      // The class docClient re-exports IS the leaf class wrapAsync imports.
      await expect(outcome).rejects.toBeInstanceOf(LeafReadOnlyError);
      await expect(outcome).rejects.toMatchObject({ kind: 'todos' });
      expect(mutatesPosted()).toBe(0);
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(vi.mocked(showToast).mock.calls[0]![0]).toBe('info');
      expect(gateEvents('blocked')).toHaveLength(1);
      expect(gateEvents('blocked')[0]![0]).toMatchObject({
        level: 'info',
        context: { action: 'blocked', kind: 'todos' },
      });
      // An expected refusal, never an error report.
      expect(reportError).not.toHaveBeenCalled();
    });

    it('refuses without a toast when the caller is quiet, still logging it', async () => {
      await expect(mutate(todo, { quiet: true })).rejects.toBeInstanceOf(ReadOnlyError);
      expect(showToast).not.toHaveBeenCalled();
      expect(gateEvents('blocked')).toHaveLength(1);
    });

    it('passes a system write (a sign-in stamp, the roster heal)', async () => {
      const stamp: MutationOp = {
        op: 'patch',
        collection: 'familyMembers',
        id: 'm1',
        patch: { lastLoginAt: '2026-09-30' },
      };
      await expect(mutate(stamp, { system: true })).resolves.toEqual({ ok: 1 });
      expect(mutatesPosted()).toBe(1);
      expect(showToast).not.toHaveBeenCalled();
    });

    it('passes the named setSettings and patchSettings ops (theme, language, sync bookkeeping)', async () => {
      await mutate(setSettings);
      await mutate({ op: 'named', name: 'patchSettings', args: { patch: { theme: 'dark' } } });
      expect(mutatesPosted()).toBe(2);
    });

    it('refuses any other named op, naming it as the kind', async () => {
      const photo: MutationOp = { op: 'named', name: 'attachPhoto', args: {} };
      await expect(mutate(photo)).rejects.toMatchObject({ kind: 'attachPhoto' });
    });

    it('passes notification reads and overlap acknowledgments', async () => {
      await mutate(notificationRead);
      await mutate(overlapAck);
      expect(mutatesPosted()).toBe(2);
    });

    it('passes a batch made only of system writes, nested batches included', async () => {
      await mutate({
        op: 'batch',
        ops: [notificationRead, { op: 'batch', ops: [overlapAck, setSettings] }],
      });
      expect(mutatesPosted()).toBe(1);
    });

    it('refuses the WHOLE batch when one nested op is family data', async () => {
      const outcome = mutate({
        op: 'batch',
        ops: [notificationRead, { op: 'batch', ops: [overlapAck, todo] }],
      });
      await expect(outcome).rejects.toMatchObject({ kind: 'todos' });
      expect(mutatesPosted()).toBe(0);
    });

    it('fireAndForgetMutate hands the refusal to reportError (which drops it); no unhandled rejection', async () => {
      fireAndForgetMutate(todo);
      await tick();
      await tick();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(vi.mocked(reportError).mock.calls[0]![0].error).toBeInstanceOf(ReadOnlyError);
      expect(gateEvents('blocked')).toHaveLength(1);
      expect(mutatesPosted()).toBe(0);
    });
  });

  describe('dry-run (wouldBlock)', () => {
    beforeEach(() => useGate(DRY_RUN));

    it('lets the write through and logs would_block once per kind per session', async () => {
      await mutate(todo);
      await mutate(todo);
      await mutate({ op: 'delete', collection: 'accounts', id: 'a1' });
      await mutate({ op: 'delete', collection: 'accounts', id: 'a2' });
      expect(mutatesPosted()).toBe(4);
      expect(showToast).not.toHaveBeenCalled();
      const events = gateEvents('would_block').map(([e]) => (e.context as { kind: string }).kind);
      expect(events).toEqual(['todos', 'accounts']);
      expect(gateEvents('blocked')).toHaveLength(0);
    });

    it('does not log system writes as would_block', async () => {
      await mutate(notificationRead);
      await mutate(setSettings);
      await mutate(todo, { system: true });
      expect(gateEvents('would_block')).toHaveLength(0);
    });
  });
});
