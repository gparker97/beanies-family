import type { Ref } from 'vue';
import { showToast } from '@/composables/useToast';

interface WrapAsyncOptions {
  /** Show an error toast on failure (default: true) */
  errorToast?: boolean;
  /** Optional success toast message */
  successToast?: string;
}

/**
 * Wraps an async store action with loading/error state management.
 * Automatically shows error toasts on failure.
 */
export async function wrapAsync<T>(
  isLoading: Ref<boolean>,
  error: Ref<string | null>,
  fn: () => Promise<T>,
  options?: WrapAsyncOptions
): Promise<T | undefined> {
  const { errorToast = true, successToast } = options ?? {};

  isLoading.value = true;
  error.value = null;

  try {
    const result = await fn();
    if (successToast) {
      showToast('success', successToast);
    }
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'An unexpected error occurred';
    error.value = message;
    if (errorToast) {
      showToast('error', message);
    }
    return undefined;
  } finally {
    isLoading.value = false;
  }
}
