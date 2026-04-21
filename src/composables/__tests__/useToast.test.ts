import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast, dismissToast, invokeToastAction, useToast } from '../useToast';

describe('useToast — action-button extension', () => {
  const { toasts } = useToast();

  beforeEach(() => {
    // Clear any toasts left from prior tests (module-level state)
    while (toasts.value.length) dismissToast(toasts.value[0]!.id);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores actionLabel + actionFn on the toast when provided', () => {
    const fn = vi.fn();
    showToast('success', 'Saved', 'All good', {
      actionLabel: 'Undo',
      actionFn: fn,
    });

    const toast = toasts.value.at(-1);
    expect(toast?.actionLabel).toBe('Undo');
    expect(toast?.actionFn).toBe(fn);
  });

  it('invokeToastAction dismisses the toast AND calls the handler', async () => {
    const fn = vi.fn();
    showToast('success', 'Saved', undefined, { actionLabel: 'Undo', actionFn: fn });
    const id = toasts.value.at(-1)!.id;

    await invokeToastAction(id);

    expect(fn).toHaveBeenCalledOnce();
    expect(toasts.value.find((t) => t.id === id)).toBeUndefined();
  });

  it('invokeToastAction on a toast without actionFn just dismisses (no throw)', async () => {
    showToast('success', 'Saved');
    const id = toasts.value.at(-1)!.id;

    await expect(invokeToastAction(id)).resolves.toBeUndefined();
    expect(toasts.value.find((t) => t.id === id)).toBeUndefined();
  });

  it('surfaces an error toast + console.error when actionFn throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn().mockRejectedValueOnce(new Error('boom'));
    showToast('success', 'Saved', undefined, { actionLabel: 'Undo', actionFn: failing });
    const id = toasts.value.at(-1)!.id;

    await invokeToastAction(id);

    expect(failing).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalled();
    // A new error toast has been added
    expect(toasts.value.some((t) => t.type === 'error')).toBe(true);
    consoleError.mockRestore();
  });

  it('respects durationMs for auto-dismiss timing', () => {
    showToast('success', 'Saved', undefined, { durationMs: 6000 });
    const id = toasts.value.at(-1)!.id;

    vi.advanceTimersByTime(5000);
    expect(toasts.value.some((t) => t.id === id)).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(toasts.value.some((t) => t.id === id)).toBe(false);
  });

  it('falls back to the default 5s auto-dismiss when durationMs is not provided', () => {
    showToast('success', 'Saved');
    const id = toasts.value.at(-1)!.id;

    vi.advanceTimersByTime(4999);
    expect(toasts.value.some((t) => t.id === id)).toBe(true);

    vi.advanceTimersByTime(2);
    expect(toasts.value.some((t) => t.id === id)).toBe(false);
  });

  it('error toasts stay sticky regardless of durationMs', () => {
    showToast('error', 'Nope', undefined, { durationMs: 100 });
    const id = toasts.value.at(-1)!.id;

    vi.advanceTimersByTime(10_000);
    expect(toasts.value.some((t) => t.id === id)).toBe(true);
  });
});
