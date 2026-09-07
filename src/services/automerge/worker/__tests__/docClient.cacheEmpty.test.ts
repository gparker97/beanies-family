/**
 * Main corroborates the worker's refusal — it never asserts absence itself.
 *
 * ⚠️ WHY THIS FILE EXISTS. The worker refuses a merge it was not told to install
 * wholesale when it holds no document. That refusal is right and it stays. But a
 * worker whose respawn rehydrate resolved EMPTY meets it on every `baseline`
 * call — three of them — so the device latches for the rest of the session where
 * it used to self-heal. Main is the only layer that remembers being TOLD the
 * cache was empty, and it survives the respawn that lost the worker's own memory
 * of it.
 *
 * The dangerous shortcut, pinned here as a negative: computing the basis from
 * main's belief BEFORE the call. That sends the wholesale-install instruction on
 * a belief alone, and a stale value while the worker genuinely holds this
 * family's document destroys it with no guard, no rebase and no banner.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LocalDocUnreadableError } from '@/types/sync';
import { serializeError, type RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({ applyDelta: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/visibilityTracker', () => ({
  wasHiddenSince: vi.fn(() => false),
  getHiddenDurationMs: vi.fn(() => null),
}));

import {
  setWorkerFactory,
  setRehydrator,
  setInlineExecutor,
  forceInlineMode,
  __resetDocClientForTesting,
  initAndLoadCache,
  initDoc,
  mergeRemoteEnvelope,
  type DocWorkerLike,
} from '../docClient';
import type { LineageBasis } from '../protocol';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

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

const FAMILY = 'fam-empty';
const OTHER = 'fam-other';
const ENVELOPE = { encryptedPayload: 'ciphertext' } as unknown as BeanpodFileV4;

const MERGED = {
  action: 'merged',
  heads: ['h'],
  dirty: false,
  changed: true,
  remoteHeads: ['h'],
};

/** The refusal exactly as `applyAndProject` raises it, over the wire. */
function refusal(cid: number) {
  return { cid, error: serializeError(new LocalDocUnreadableError('worker-holds-no-document')) };
}

let fw: FakeWorker;
/** Every `mergeRemoteEnvelope` basis the worker was actually asked for. */
let bases: LineageBasis[];

function armWorker(mergeResponder: (basis: LineageBasis, cid: number) => Record<string, unknown>) {
  fw = new FakeWorker();
  bases = [];
  fw.responder = (req) => {
    const cid = req.cid;
    if (req.method === 'initAndLoadCache') {
      const loaded = (req.args as { familyId: string }).familyId === OTHER;
      return { cid, ok: true, result: { loaded, remoteBaseline: null } };
    }
    if (req.method === 'initDoc') return { cid, ok: true, result: { loaded: true } };
    if (req.method === 'mergeRemoteEnvelope') {
      const basis = (req.args as { basis: LineageBasis }).basis;
      bases.push(basis);
      return mergeResponder(basis, cid);
    }
    return { cid, ok: true, result: {} };
  };
  setWorkerFactory(() => fw);
}

/** Refuse a `baseline` merge the way the worker does; honour an explicit install. */
const refuseBaseline = (basis: LineageBasis, cid: number) =>
  basis.kind === 'no-local-document' ? { cid, ok: true, result: MERGED } : refusal(cid);

beforeEach(() => {
  __resetDocClientForTesting();
  setRehydrator(null);
  setInlineExecutor(null);
  vi.clearAllMocks();
});

describe('the corroborated re-issue', () => {
  it('re-states the instruction ONCE when main was told this cache was empty', async () => {
    armWorker(refuseBaseline);
    await initAndLoadCache(FAMILY); // resolves { loaded: false }

    const res = await mergeRemoteEnvelope(ENVELOPE, FAMILY, { kind: 'baseline', heads: [] });

    expect(res.action).toBe('merged');
    expect(bases.map((b) => b.kind)).toEqual(['baseline', 'no-local-document']);
  });

  it('RETHROWS untouched when main was never told the cache was empty', async () => {
    // The device that HAS a document and lost the ability to read it. Refusing
    // is correct here — this is the case the refusal was written for.
    armWorker(refuseBaseline);
    await initAndLoadCache(OTHER); // resolves { loaded: true }

    await expect(
      mergeRemoteEnvelope(ENVELOPE, OTHER, { kind: 'baseline', heads: [] })
    ).rejects.toBeInstanceOf(LocalDocUnreadableError);
    expect(bases.map((b) => b.kind)).toEqual(['baseline']);
  });

  it('is BOUNDED — a second refusal from the re-issue rethrows rather than looping', async () => {
    armWorker((_b, cid) => refusal(cid)); // refuses both instructions
    await initAndLoadCache(FAMILY);

    await expect(
      mergeRemoteEnvelope(ENVELOPE, FAMILY, { kind: 'baseline', heads: [] })
    ).rejects.toBeInstanceOf(LocalDocUnreadableError);
    // Exactly two dispatches: the original and its one substitution.
    expect(bases).toHaveLength(2);
  });

  it('does not fire for a family other than the one proven empty', async () => {
    armWorker(refuseBaseline);
    await initAndLoadCache(FAMILY);
    // A switch away clears it — `setCurrentFamily` is the one writer.
    await initAndLoadCache(OTHER);

    await expect(
      mergeRemoteEnvelope(ENVELOPE, OTHER, { kind: 'baseline', heads: [] })
    ).rejects.toBeInstanceOf(LocalDocUnreadableError);
  });
});

describe('what main records about the cache', () => {
  it('is the LAST answer, not a history — an install-then-empty device still heals', async () => {
    // ⚠️ THE REGRESSION A MONOTONE FLAG WOULD REINTRODUCE. A value meaning "was
    // a document ever installed here" reads true from the earlier session and
    // the substitution never fires — vacuous on the exact device it exists for.
    armWorker(refuseBaseline);
    await initAndLoadCache(OTHER); // an earlier session loaded fine
    await initDoc(); // and a document was installed
    await initAndLoadCache(FAMILY); // ...and today's rehydrate resolves EMPTY

    const res = await mergeRemoteEnvelope(ENVELOPE, FAMILY, { kind: 'baseline', heads: [] });
    expect(res.action).toBe('merged');
  });

  it('is cleared by an install, so a later refusal is taken at face value', async () => {
    armWorker((basis, cid) =>
      basis.kind === 'no-local-document' ? { cid, ok: true, result: MERGED } : refusal(cid)
    );
    await initAndLoadCache(FAMILY);
    // First merge installs a document (and clears the record)...
    await mergeRemoteEnvelope(ENVELOPE, FAMILY, { kind: 'baseline', heads: [] });
    const afterFirst = bases.length;

    // ...so the next refusal must NOT be substituted.
    await expect(
      mergeRemoteEnvelope(ENVELOPE, FAMILY, { kind: 'baseline', heads: [] })
    ).rejects.toBeInstanceOf(LocalDocUnreadableError);
    expect(bases).toHaveLength(afterFirst + 1);
  });
});

describe('the inline realm', () => {
  /**
   * ⚠️ WHAT THIS PROVES, AND WHAT IT DOES NOT. The correction lives in
   * `docClient.mergeRemoteEnvelope`'s catch, ABOVE `request()`, so it is
   * realm-agnostic by construction — this drives the inline DISPATCH path and
   * proves the substitution and its bound survive it. It does NOT execute the
   * real `applyAndProject.mergeRemoteEnvelope` refusal (the executor here raises
   * the same error the worker would); that half is covered by the worker-mode
   * cases above and by `applyAndProject`'s own suite. Saying so is the point:
   * "the fix only works in worker mode" is exactly the gap a green suite hides,
   * and a comment that overclaimed would hide it just as well.
   */
  it('substitutes and bounds identically with the worker forced off', async () => {
    const calls: LineageBasis[] = [];
    setInlineExecutor(async (method, args) => {
      if (method === 'initAndLoadCache') {
        return { result: { loaded: false, remoteBaseline: null } };
      }
      if (method === 'mergeRemoteEnvelope') {
        const basis = (args as { basis: LineageBasis }).basis;
        calls.push(basis);
        if (basis.kind === 'no-local-document') return { result: MERGED };
        throw new LocalDocUnreadableError('worker-holds-no-document');
      }
      return {};
    });
    forceInlineMode();

    await initAndLoadCache(FAMILY);
    const res = await mergeRemoteEnvelope(ENVELOPE, FAMILY, { kind: 'baseline', heads: [] });

    expect(res.action).toBe('merged');
    expect(calls.map((b) => b.kind)).toEqual(['baseline', 'no-local-document']);
  });

  it('is read in exactly ONE place, so a second reader has to argue for itself', () => {
    // ⚠️ THE INVARIANT THE WHOLE DESIGN RESTS ON. `cacheProvenEmptyFor` is main's
    // record of what it was TOLD, not a mirror of the worker's `currentDoc` — and
    // the moment a second site reads it as though it were one, main starts
    // asserting absence instead of corroborating it, which is how a resident
    // document gets destroyed with no guard and no banner.
    const src = fs.readFileSync(path.resolve(__dirname, '../docClient.ts'), 'utf8');
    const reads = src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('cacheProvenEmptyFor'))
      // Comments, the declaration, and the writes are not reads.
      .filter((l) => !l.startsWith('*') && !l.startsWith('//') && !l.startsWith('/*'))
      .filter((l) => !l.startsWith('let cacheProvenEmptyFor'))
      .filter((l) => !/cacheProvenEmptyFor\s*=[^=]/.test(l));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('=== familyId');
  });
});
