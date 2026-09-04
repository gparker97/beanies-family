/**
 * `loadAndVerify` must tell "these bytes are bad" apart from "this device ran
 * out of memory".
 *
 * The distinction is not cosmetic. `initAndLoadCache` DELETES the local cache
 * on a corruption error so a clean re-seed can happen; doing that for an
 * out-of-memory failure destroys the one copy that might have loaded and cannot
 * possibly help, because the retry re-downloads and fails identically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CorruptPayloadError, PayloadTooLargeError, PayloadLoadError } from '@/types/sync';

// An ESM module namespace is not configurable, so `vi.spyOn(Automerge, 'load')`
// cannot work. Mock the module and drive `load` through a hook the tests set.
const loadHook = vi.hoisted(() => ({ impl: null as null | (() => unknown) }));
vi.mock('@automerge/automerge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@automerge/automerge')>();
  return {
    ...actual,
    load: (...args: unknown[]) =>
      loadHook.impl ? loadHook.impl() : (actual.load as (...a: unknown[]) => unknown)(...args),
  };
});

const { loadAndVerify } = await import('../docOps');

const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

beforeEach(() => {
  loadHook.impl = null;
});

/** Make the next `Automerge.load` throw. */
const loadThrows = (message: string) => {
  loadHook.impl = () => {
    throw new Error(message);
  };
};
/** Make `Automerge.load` return a doc whose first field read throws. */
const loadReturnsUnreadable = (message: string) => {
  loadHook.impl = () =>
    new Proxy({} as never, {
      get() {
        throw new Error(message);
      },
    });
};

describe('loadAndVerify — the load step', () => {
  it('throws PayloadTooLargeError, carrying the DECRYPTED byte length, on an OOM', () => {
    loadThrows('error inflating document chunk ops: out of memory');

    let thrown: unknown;
    try {
      loadAndVerify(BYTES, 'fam-1');
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(PayloadTooLargeError);
    // Emphatically NOT corruption — this is what the cache-clear branch keys on.
    expect(thrown).not.toBeInstanceOf(CorruptPayloadError);
    const err = thrown as PayloadTooLargeError;
    expect(err.step).toBe('load');
    expect(err.familyId).toBe('fam-1');
    // The decrypted size predicts the WASM cost; the base64 length does not.
    expect(err.payloadBytes).toBe(BYTES.byteLength);
    expect(err.message).toContain('out of memory');
  });

  it('still throws CorruptPayloadError for genuinely bad bytes', () => {
    loadThrows('invalid chunk type');

    const thrown = (() => {
      try {
        loadAndVerify(BYTES, 'fam-1');
      } catch (e) {
        return e;
      }
    })();

    expect(thrown).toBeInstanceOf(CorruptPayloadError);
    expect(thrown).not.toBeInstanceOf(PayloadTooLargeError);
    expect((thrown as CorruptPayloadError).step).toBe('load');
  });

  it('defaults an UNRECOGNISED error to corruption — today behaviour, unchanged', () => {
    // The conservative default. A false "too large" would skip the cache clear
    // that real corruption needs, so anything we do not positively recognise as
    // an allocation failure must keep taking the existing path.
    loadHook.impl = () => {
      throw new RangeError('Invalid array length');
    };

    expect(() => loadAndVerify(BYTES, null)).toThrow(CorruptPayloadError);
  });
});

describe('loadAndVerify — the materialize step', () => {
  it('classifies an OOM on first materialize as PayloadTooLargeError', () => {
    loadReturnsUnreadable('out of memory');

    const thrown = (() => {
      try {
        loadAndVerify(BYTES, 'fam-2');
      } catch (e) {
        return e;
      }
    })();

    expect(thrown).toBeInstanceOf(PayloadTooLargeError);
    expect((thrown as PayloadTooLargeError).step).toBe('materialize');
    expect((thrown as PayloadTooLargeError).payloadBytes).toBe(BYTES.byteLength);
  });

  it('keeps the distinct materialize wording for corruption', () => {
    loadReturnsUnreadable('Out of bounds table access');

    const thrown = (() => {
      try {
        loadAndVerify(BYTES, 'fam-2');
      } catch (e) {
        return e;
      }
    })();

    expect(thrown).toBeInstanceOf(CorruptPayloadError);
    expect((thrown as Error).message).toContain('Automerge materialize failed');
  });
});

describe('the shared base class', () => {
  it('both classes are PayloadLoadError, which is what surface() keys its no-toast check on', () => {
    expect(new CorruptPayloadError('a', 'load', null)).toBeInstanceOf(PayloadLoadError);
    expect(new PayloadTooLargeError('b', 'load', null)).toBeInstanceOf(PayloadLoadError);
  });

  it('names are literal strings, so a minified build still round-trips them', () => {
    // The worker error registry keys on `err.name`; a name derived from
    // `Ctor.name` would be mangled by terser and silently degrade to
    // DocWorkerError on the main thread.
    expect(new CorruptPayloadError('a', 'load', null).name).toBe('CorruptPayloadError');
    expect(new PayloadTooLargeError('b', 'load', null).name).toBe('PayloadTooLargeError');
  });
});
