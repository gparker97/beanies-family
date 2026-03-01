import { ref } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wrapAsync } from '@/composables/useStoreActions';
import { showToast } from '@/composables/useToast';

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
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

    expect(showToast).toHaveBeenCalledWith('error', 'Database connection failed');
    expect(error.value).toBe('Database connection failed');
  });

  it('should show generic message for non-Error throws', async () => {
    await wrapAsync(isLoading, error, async () => {
      throw 'string error';
    });

    expect(showToast).toHaveBeenCalledWith('error', 'An unexpected error occurred');
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
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('QuotaExceededError'));
  });

  it('should surface network errors as toast notifications', async () => {
    await wrapAsync(isLoading, error, async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(showToast).toHaveBeenCalledWith('error', 'Failed to fetch');
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
      expect(showToast).toHaveBeenCalledWith('error', err.message);
    }

    // Each error should have triggered a toast
    expect(showToast).toHaveBeenCalledTimes(errors.length);
  });
});
