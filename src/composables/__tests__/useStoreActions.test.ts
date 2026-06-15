import { ref } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wrapAsync } from '@/composables/useStoreActions';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({
    t: (key: string) => {
      if (key === 'error.unexpectedFailure') return 'Something went wrong';
      if (key === 'error.unexpectedFailureHelp')
        return 'Please refresh and try again. Support has been notified.';
      if (key === 'error.unexpectedError') return 'An unexpected error occurred';
      return key;
    },
  }),
}));

describe('wrapAsync — error handling & notifications', () => {
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  beforeEach(() => {
    vi.clearAllMocks();
    isLoading.value = false;
    error.value = null;
  });

  it('should show error toast when async function throws', async () => {
    await wrapAsync(isLoading, error, async () => {
      throw new Error('Database connection failed');
    });

    expect(showToast).toHaveBeenCalledWith('error', 'Database connection failed', undefined, {
      error: expect.any(Error),
    });
    expect(error.value).toBe('Database connection failed');
  });

  it('should show generic message for non-Error throws', async () => {
    await wrapAsync(isLoading, error, async () => {
      throw 'string error';
    });

    expect(showToast).toHaveBeenCalledWith(
      'error',
      'An unexpected error occurred',
      undefined,
      // Non-Error throws have no Error instance — `error` field is the raw string.
      { error: 'string error' }
    );
    expect(error.value).toBe('An unexpected error occurred');
  });

  it('should return undefined on error instead of rethrowing', async () => {
    const result = await wrapAsync(isLoading, error, async () => {
      throw new Error('fail');
    });

    expect(result).toBeUndefined();
  });

  it('should set isLoading to false after error', async () => {
    isLoading.value = true;

    await wrapAsync(isLoading, error, async () => {
      throw new Error('fail');
    });

    expect(isLoading.value).toBe(false);
  });

  it('should NOT show error toast when errorToast: false', async () => {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        throw new Error('suppressed');
      },
      { errorToast: false }
    );

    expect(showToast).not.toHaveBeenCalled();
    expect(error.value).toBe('suppressed');
  });

  it('should show success toast on success when configured', async () => {
    await wrapAsync(isLoading, error, async () => 'ok', { successToast: 'Saved successfully' });

    expect(showToast).toHaveBeenCalledWith('success', 'Saved successfully');
    expect(error.value).toBeNull();
  });

  it('should NOT show success toast by default', async () => {
    await wrapAsync(isLoading, error, async () => 'ok');

    expect(showToast).not.toHaveBeenCalled();
  });

  it('should return the result on success', async () => {
    const result = await wrapAsync(isLoading, error, async () => 42);

    expect(result).toBe(42);
  });

  it('should manage isLoading through the full lifecycle', async () => {
    expect(isLoading.value).toBe(false);

    let resolvePromise: () => void;
    const pending = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const promise = wrapAsync(isLoading, error, async () => {
      await pending;
      return 'done';
    });

    // isLoading should be true while the async fn is running
    expect(isLoading.value).toBe(true);

    resolvePromise!();
    await promise;

    expect(isLoading.value).toBe(false);
  });

  it('should clear previous error before running', async () => {
    error.value = 'old error';

    await wrapAsync(isLoading, error, async () => 'success');

    expect(error.value).toBeNull();
  });

  it('should pass the original Error to showToast so the stack reaches the reporter', async () => {
    const original = new Error('Save failed');
    await wrapAsync(isLoading, error, async () => {
      throw original;
    });

    // The 4th arg is the toast options bag — `error` must be the same
    // Error object the caller threw, not a copy or undefined. Without
    // this, every store-action throw arrived in #beanies-errors with no
    // stack frames and surface `app`, leaving each firing un-diagnosable.
    expect(showToast).toHaveBeenCalledWith('error', 'Save failed', undefined, {
      error: original,
    });
  });
});

describe('wrapAsync — no silent failures in store operations', () => {
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  beforeEach(() => {
    vi.clearAllMocks();
    error.value = null;
  });

  it('should surface IndexedDB errors as toast notifications', async () => {
    await wrapAsync(isLoading, error, async () => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('QuotaExceededError'),
      undefined,
      { error: expect.any(DOMException) }
    );
  });

  it('should surface network errors as toast notifications', async () => {
    await wrapAsync(isLoading, error, async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(showToast).toHaveBeenCalledWith('error', 'Failed to fetch', undefined, {
      error: expect.any(TypeError),
    });
  });

  it('should never swallow errors — error ref is always set', async () => {
    const errors = [
      new Error('DB locked'),
      new RangeError('Invalid array length'),
      new TypeError('Cannot read properties of undefined'),
    ];

    for (const err of errors) {
      error.value = null;
      await wrapAsync(isLoading, error, async () => {
        throw err;
      });

      expect(error.value).toBe(err.message);
      expect(showToast).toHaveBeenCalledWith('error', err.message, undefined, { error: err });
    }

    // Each error should have triggered a toast
    expect(showToast).toHaveBeenCalledTimes(errors.length);
  });
});

describe('wrapAsync — engine panic friendly-toast wrap', () => {
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  beforeEach(() => {
    vi.clearAllMocks();
    error.value = null;
  });

  it.each([
    'recursive use of an object detected which would lead to unsafe aliasing in rust',
    'unreachable executed',
    'memory access out of bounds',
    'RuntimeError: index out of bounds',
    'WASM module trapped',
  ])('substitutes a friendly message for engine panic: %s', async (rawMessage) => {
    const original = new Error(rawMessage);
    await wrapAsync(isLoading, error, async () => {
      throw original;
    });

    // User-facing toast renders the friendly substitution + silent so the
    // automatic reporter doesn't double-report on top of the direct
    // reportError call below.
    expect(showToast).toHaveBeenCalledWith(
      'error',
      'Something went wrong',
      'Please refresh and try again. Support has been notified.',
      { silent: true, error: original }
    );

    // The raw rust/wasm message ships to Slack with a dedicated surface
    // and the original Error attached so the stack lands in the alert.
    expect(reportError).toHaveBeenCalledWith({
      surface: 'wrapAsync:engine-panic',
      severity: 'critical',
      message: rawMessage,
      error: original,
    });

    // The raw message still populates `error.value` for any caller that
    // wants to render its own diagnostic UI — friendly substitution is
    // toast-only.
    expect(error.value).toBe(rawMessage);
  });

  it('does NOT trigger the engine-panic path for a regular app error', async () => {
    await wrapAsync(isLoading, error, async () => {
      throw new Error('Failed to update transaction');
    });

    // Regular path: raw message in toast, no direct reportError call —
    // showToast's auto-reporter handles surface 'app' as before, but now
    // with the Error attached so the stack lands in Slack.
    expect(showToast).toHaveBeenCalledWith('error', 'Failed to update transaction', undefined, {
      error: expect.any(Error),
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('threads `options.action` into the engine-panic Slack alert as context', async () => {
    const original = new Error('recursive use of an object detected');
    await wrapAsync(
      isLoading,
      error,
      async () => {
        throw original;
      },
      { action: 'todoStore:createTodo' }
    );

    expect(reportError).toHaveBeenCalledWith({
      surface: 'wrapAsync:engine-panic',
      severity: 'critical',
      message: 'recursive use of an object detected',
      error: original,
      context: { action: 'todoStore:createTodo' },
    });
  });

  it('omits context when no action label is provided (back-compat)', async () => {
    const original = new Error('recursive use of an object detected');
    await wrapAsync(isLoading, error, async () => {
      throw original;
    });

    expect(reportError).toHaveBeenCalledWith({
      surface: 'wrapAsync:engine-panic',
      severity: 'critical',
      message: 'recursive use of an object detected',
      error: original,
      context: undefined,
    });
  });
});
