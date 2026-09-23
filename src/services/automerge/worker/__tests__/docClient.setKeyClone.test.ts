/**
 * The family key crosses into the worker as RAW BYTES, not as a `CryptoKey`.
 *
 * ⚠️ THE PRODUCTION FAILURE THIS EXISTS TO STOP, and it is not hypothetical. A `CryptoKey` is
 * structured-cloneable per spec, but iOS WKWebView throws `DataCloneError` ("The object can not
 * be cloned.") when one is posted to a worker. CloudWatch has it on two families across two
 * builds. `postMessage` throws SYNCHRONOUSLY there, so `setKey` never lands, every later crypto
 * op trips the worker's `if (!familyKey)` guard, and the realm degrades to running Automerge
 * inline ON THE MAIN THREAD — the shape of a boot that stalls.
 *
 * `FakeWorker` below models that engine: its `postMessage` refuses a `CryptoKey` exactly as
 * WebKit does, so case (1) genuinely fails against the pre-fix code rather than merely asserting
 * the new shape.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RpcRequest } from '../protocol';

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('../../projection', () => ({ applyDelta: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/visibilityTracker', () => ({
  wasHiddenSince: vi.fn(() => false),
  getHiddenDurationMs: vi.fn(() => null),
}));

import { setWorkerFactory, setFamilyKey, __resetDocClientForTesting } from '../docClient';
import { generateFamilyKey, exportFamilyKey } from '@/services/crypto/familyKeyService';

/** A worker whose `postMessage` refuses a `CryptoKey`, the way iOS WKWebView does. */
class WebKitLikeWorker {
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
    const args = (req.args ?? {}) as Record<string, unknown>;
    for (const v of Object.values(args)) {
      // The exact WebKit behaviour: a synchronous throw, before anything is delivered.
      if (typeof CryptoKey !== 'undefined' && v instanceof CryptoKey) {
        throw new DOMException('The object can not be cloned.', 'DataCloneError');
      }
    }
    this.posted.push(req);
    queueMicrotask(() => this._on?.({ data: { cid: req.cid, ok: true, result: undefined } }));
  }
  terminate() {}
}

describe('docClient — the family key crosses to the worker as raw bytes', () => {
  beforeEach(() => {
    __resetDocClientForTesting();
  });

  it('(1) posts setKey WITHOUT a CryptoKey, so a WebKit-like worker accepts it', async () => {
    const fw = new WebKitLikeWorker();
    setWorkerFactory(() => fw);
    const key = await generateFamilyKey();

    // Pre-fix this REJECTS with DataCloneError from the synchronous postMessage.
    await setFamilyKey(key, 'fam-1');

    const setKeyPost = fw.posted.find((p) => p.method === 'setKey');
    expect(setKeyPost, 'setKey must actually reach the worker').toBeTruthy();
    const args = (setKeyPost!.args ?? {}) as Record<string, unknown>;
    expect(args.key, 'a CryptoKey must never be on the wire').toBeUndefined();
    expect(args.raw).toBeInstanceOf(Uint8Array);
  });

  it('(2) the bytes on the wire are the real key material, byte for byte', async () => {
    // A key that arrives corrupted is worse than one that never arrives: it would decrypt
    // nothing and look like a damaged pod.
    const fw = new WebKitLikeWorker();
    setWorkerFactory(() => fw);
    const key = await generateFamilyKey();
    const expected = await exportFamilyKey(key);

    await setFamilyKey(key, 'fam-1');

    const args = (fw.posted.find((p) => p.method === 'setKey')!.args ?? {}) as Record<
      string,
      unknown
    >;
    expect(Array.from(args.raw as Uint8Array)).toEqual(Array.from(expected));
  });

  it('(3) a NON-EXPORTABLE key still posts the CryptoKey rather than failing outright', async () => {
    // Nothing produces one today, but the fallback is what keeps this change from being a
    // regression on any engine where the clone works fine.
    const posted: RpcRequest[] = [];
    class PermissiveWorker extends WebKitLikeWorker {
      override postMessage(m: unknown) {
        const req = m as RpcRequest;
        posted.push(req);
        queueMicrotask(() =>
          this.onmessage?.({ data: { cid: req.cid, ok: true, result: undefined } })
        );
      }
    }
    const fw = new PermissiveWorker();
    setWorkerFactory(() => fw);

    const raw = crypto.getRandomValues(new Uint8Array(32));
    const nonExtractable = await crypto.subtle.importKey(
      'raw',
      raw.buffer as ArrayBuffer,
      { name: 'AES-GCM', length: 256 },
      false, // not extractable
      ['encrypt', 'decrypt']
    );

    await setFamilyKey(nonExtractable, 'fam-1');

    const args = (posted.find((p) => p.method === 'setKey')!.args ?? {}) as Record<string, unknown>;
    expect(args.raw).toBeUndefined();
    expect(args.key).toBe(nonExtractable);
  });
});
