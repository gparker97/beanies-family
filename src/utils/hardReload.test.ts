import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
// The recovery step lazy-imports telemetry; replace it so tests can assert on
// the events and never pull the real firehose (and its store graph) in.
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

import { logEvent } from '@/services/telemetry';
import {
  hardReload,
  HARD_RELOAD_CLEANUP_DEADLINE_MS,
  isChunkLoadError,
  readChunkAttempts,
  writeChunkAttempts,
  resetChunkAttempts,
  tryRecoverChunkLoad,
  startChunkRecovery,
  isChunkRecoveryInProgress,
  __resetChunkRecoveryStateForTests,
  CHUNK_RELOAD_FLAG,
  CHUNK_RELOAD_MAX_ATTEMPTS,
} from './hardReload';

describe('isChunkLoadError', () => {
  it('matches Chrome/Edge dynamic import failure', () => {
    expect(
      isChunkLoadError(
        new Error(
          'Failed to fetch dynamically imported module: https://app.beanies.family/assets/FamilyNookPage-DZK3iJ0T.js'
        )
      )
    ).toBe(true);
  });

  it('matches Firefox dynamic import failure', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
  });

  it('matches Safari module script failure', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it("matches Vue Router's stale-chunk fallback shape", () => {
    // Caught 2026-05-04 from a stale tab three deploys behind HEAD. Vue
    // Router throws this when the lazy import() resolves but the result
    // isn't a valid module with a default export — typically because
    // CloudFront served the SPA's 404 HTML for a rotated chunk filename.
    expect(isChunkLoadError(new Error('Couldn\'t resolve component "default" at "/pod"'))).toBe(
      true
    );
    expect(isChunkLoadError(new Error('Couldn\'t resolve component "default" at "/nook"'))).toBe(
      true
    );
  });

  it('matches destructure-of-null TypeError when a dynamic import resolves to null', () => {
    // Caught 2026-05-10 from greg's iPhone PWA mid-update. SW served a
    // response for the rotated chunk URL that Vite parsed as a null module
    // (instead of a fetch failure), so the standard chunk-load error
    // shapes never appeared and `vite:preloadError` didn't fire. Every
    // `const { foo } = await import(...)` then threw this V8/Firefox/modern-
    // WebKit shape, which previously slipped through to App.vue's init
    // catch as a generic TypeError → scary error overlay flashing
    // mid-update. Now recognized as the chunk-load symptom it actually is.
    expect(
      isChunkLoadError(
        new TypeError(
          "Cannot destructure property 'registerGoogleAccountAssertion' of '(intermediate value)' as it is null."
        )
      )
    ).toBe(true);
    expect(
      isChunkLoadError(
        new TypeError("Cannot destructure property 'completeRedirectAuth' of 'mod' as it is null")
      )
    ).toBe(true);
    expect(
      isChunkLoadError(
        new TypeError("Cannot destructure property 'foo' of 'bar' as it is undefined.")
      )
    ).toBe(true);
  });

  it('matches iOS Safari destructure-of-null phrasing', () => {
    // Caught 2026-05-13 from greg's iPhone 14 Safari (browser, not PWA)
    // after the Google Drive OAuth redirect-back. Safari uses a different
    // preposition for the same symptom ("from null or undefined value"
    // vs V8's "as it is null"), so the previous regex missed it and the
    // user got stuck in a "beans spilled" reload loop with no way out
    // except killing the browser. The broader regex matches both.
    expect(
      isChunkLoadError(
        new TypeError(
          "Cannot destructure property 'registerGoogleAccountAssertion' from null or undefined value"
        )
      )
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot destructure property 'foo' from null"))).toBe(
      true
    );
    expect(
      isChunkLoadError(new TypeError("Cannot destructure property 'bar' from undefined"))
    ).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isChunkLoadError(new Error('TypeError: Cannot read property of undefined'))).toBe(false);
    expect(isChunkLoadError(new Error('NetworkError: Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(new Error('Incorrect password'))).toBe(false);
    // Real null-deref bugs that aren't destructure-shaped should still
    // surface — we only catch the destructure-of-null shape because it's
    // the dependable symptom of an import-resolved-to-null.
    expect(isChunkLoadError(new TypeError("Cannot read properties of null (reading 'foo')"))).toBe(
      false
    );
    expect(isChunkLoadError(new TypeError("null is not an object (evaluating 'x.y')"))).toBe(false);
  });

  it('handles non-Error inputs gracefully', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
  });
});

describe('chunk-reload counter (throw-safe accessors)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetChunkAttempts();
  });

  it('round-trips through sessionStorage when storage works', () => {
    resetChunkAttempts();
    expect(readChunkAttempts()).toBe(0);
    writeChunkAttempts(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBe('1');
    expect(readChunkAttempts()).toBe(1);
    writeChunkAttempts(2);
    expect(readChunkAttempts()).toBe(2);
  });

  it('resetChunkAttempts clears both stores', () => {
    writeChunkAttempts(3);
    resetChunkAttempts();
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBeNull();
    expect(readChunkAttempts()).toBe(0);
  });

  it('falls back to the in-memory mirror when sessionStorage throws', () => {
    resetChunkAttempts();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A storage area whose every access throws — the iOS blocked-storage case.
    const throwingStorage = {
      getItem: () => {
        throw new DOMException('SecurityError');
      },
      setItem: () => {
        throw new DOMException('SecurityError');
      },
      removeItem: () => {
        throw new DOMException('SecurityError');
      },
    } as unknown as Storage;
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(throwingStorage);
    expect(readChunkAttempts()).toBe(0); // nothing written yet → memory 0
    writeChunkAttempts(1);
    expect(readChunkAttempts()).toBe(1); // read falls back to memory
    writeChunkAttempts(2);
    expect(readChunkAttempts()).toBe(2);
    expect(warn).toHaveBeenCalled();
  });

  it('readChunkAttempts returns max(persisted, memory)', () => {
    resetChunkAttempts();
    writeChunkAttempts(2); // memory=2, storage='2'
    // Simulate a stale-but-lower persisted value; memory should win.
    window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
    expect(readChunkAttempts()).toBe(2);
  });
});

describe('tryRecoverChunkLoad (shared chunk-reload budget)', () => {
  const chunkError = () => new Error('Failed to fetch dynamically imported module: /assets/x.js');

  beforeEach(() => {
    __resetChunkRecoveryStateForTests();
    vi.mocked(logEvent).mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetChunkRecoveryStateForTests();
  });

  it('spends one attempt and starts a hard reload for a chunk-load symptom', async () => {
    resetChunkAttempts();
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    expect(tryRecoverChunkLoad(chunkError())).toBe(true);
    expect(readChunkAttempts()).toBe(1);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it('declines once the budget is spent, without reloading', () => {
    writeChunkAttempts(CHUNK_RELOAD_MAX_ATTEMPTS);
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    expect(tryRecoverChunkLoad(chunkError())).toBe(false);
    expect(readChunkAttempts()).toBe(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(replace).not.toHaveBeenCalled();
  });

  it('declines a non-chunk error without touching the counter', () => {
    resetChunkAttempts();
    expect(tryRecoverChunkLoad(new Error('Cannot read properties of null'))).toBe(false);
    expect(readChunkAttempts()).toBe(0);
  });

  it('marks recovery in progress and logs the attempt', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    expect(isChunkRecoveryInProgress()).toBe(false);
    expect(tryRecoverChunkLoad(chunkError())).toBe(true);
    expect(isChunkRecoveryInProgress()).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`attempt 1/${CHUNK_RELOAD_MAX_ATTEMPTS}`),
      expect.any(Error)
    );
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it('does not spend a second attempt or start a second reload while one is in flight', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    expect(tryRecoverChunkLoad(chunkError())).toBe(true);
    expect(tryRecoverChunkLoad(chunkError())).toBe(true);
    expect(startChunkRecovery(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true);
    expect(readChunkAttempts()).toBe(1);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it('resetChunkAttempts is a no-op during recovery and works after it', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    expect(tryRecoverChunkLoad(chunkError())).toBe(true);
    // App.vue's boot health check landing while hardReload() is still awaiting
    // SW/cache cleanup must not refund the attempt.
    resetChunkAttempts();
    expect(readChunkAttempts()).toBe(1);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBe('1');
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    // Once the page is replaced (module state reset), reset works again.
    __resetChunkRecoveryStateForTests();
    writeChunkAttempts(2);
    resetChunkAttempts();
    expect(readChunkAttempts()).toBe(0);
  });

  it('budget exhaustion returns false and leaves the in-progress flag false', () => {
    writeChunkAttempts(CHUNK_RELOAD_MAX_ATTEMPTS);
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    expect(tryRecoverChunkLoad(chunkError())).toBe(false);
    expect(startChunkRecovery()).toBe(false);
    expect(isChunkRecoveryInProgress()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('startChunkRecovery recovers an unclassified preload failure', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    expect(startChunkRecovery(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true);
    expect(isChunkRecoveryInProgress()).toBe(true);
    expect(readChunkAttempts()).toBe(1);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it('emits a flushed chunk-recovery reload event naming the attempt', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    writeChunkAttempts(1);
    expect(tryRecoverChunkLoad(chunkError())).toBe(true);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(logEvent).toHaveBeenCalledWith({
      level: 'warn',
      surface: 'chunk-recovery',
      message: `hardReload attempt 2/${CHUNK_RELOAD_MAX_ATTEMPTS}`,
      context: { action: 'reload' },
      flush: true,
    });
  });

  it('emits the chunk-recovery exhausted event once per tab, not per failure', async () => {
    writeChunkAttempts(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(tryRecoverChunkLoad(chunkError())).toBe(false);
    expect(tryRecoverChunkLoad(chunkError())).toBe(false);
    expect(startChunkRecovery()).toBe(false);
    await vi.waitFor(() =>
      expect(logEvent).toHaveBeenCalledWith({
        level: 'error',
        surface: 'chunk-recovery',
        message: 'chunk recovery exhausted',
        context: { action: 'exhausted' },
      })
    );
    // Let any further (wrongly) scheduled emits settle before counting.
    await new Promise((r) => setTimeout(r, 0));
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('clears the in-progress flag and reports when the reload cannot start', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(window.location, 'replace').mockImplementation(() => {
      throw new DOMException('sandboxed', 'SecurityError');
    });
    expect(tryRecoverChunkLoad(chunkError())).toBe(true);
    expect(isChunkRecoveryInProgress()).toBe(true);

    await vi.waitFor(() => expect(isChunkRecoveryInProgress()).toBe(false));
    await vi.waitFor(() =>
      expect(logEvent).toHaveBeenCalledWith({
        level: 'error',
        surface: 'chunk-recovery',
        message: 'hard reload could not start',
        context: { action: 'failed', error_code: 'SecurityError' },
      })
    );
    expect(error).toHaveBeenCalled();
    // The attempt stays spent, and the counter can be reset again.
    expect(readChunkAttempts()).toBe(1);
    resetChunkAttempts();
    expect(readChunkAttempts()).toBe(0);
  });
});

describe('hardReload cleanup deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.navigator, 'serviceWorker');
  });

  it('replaces the page once the deadline passes even if a SW call never settles', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: () => new Promise(() => {}) },
    });

    void hardReload();
    await vi.advanceTimersByTimeAsync(HARD_RELOAD_CLEANUP_DEADLINE_MS - 1);
    expect(replace).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeded'));
  });
});
