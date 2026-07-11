import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the reporter before importing useToast — the toast wrapper imports
// reportError at module top.
vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

import { showToast, dismissToast, invokeToastAction, useToast } from '../useToast';
import { reportError } from '@/utils/errorReporter';

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
    showToast('error', 'Nope', undefined, { durationMs: 100, silent: true });
    const id = toasts.value.at(-1)!.id;

    vi.advanceTimersByTime(10_000);
    expect(toasts.value.some((t) => t.id === id)).toBe(true);
  });
});

describe('useToast — auto-report on error', () => {
  const { toasts } = useToast();
  const reportErrorMock = vi.mocked(reportError);

  beforeEach(() => {
    while (toasts.value.length) dismissToast(toasts.value[0]!.id);
    reportErrorMock.mockReset();
  });

  it('calls reportError for type=error with no silent flag', () => {
    showToast('error', 'Could not save', 'Try again');
    expect(reportErrorMock).toHaveBeenCalledOnce();
    const call = reportErrorMock.mock.calls[0]![0];
    expect(call.surface).toBe('app');
    expect(call.message).toBe('Could not save — Try again');
  });

  it('does NOT call reportError when silent: true', () => {
    showToast('error', 'Validation', 'Email required', { silent: true });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('does NOT call reportError for non-error types', () => {
    showToast('success', 'Saved');
    showToast('info', 'Heads up');
    showToast('warning', 'Be careful');
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('forwards surface + context + error to reportError', () => {
    const err = new Error('inner');
    showToast('error', 'Boom', undefined, {
      surface: 'create-activity',
      context: { route_path: '/pod/abc' },
      error: err,
    });
    const call = reportErrorMock.mock.calls[0]![0];
    expect(call.surface).toBe('create-activity');
    expect(call.context).toEqual({ route_path: '/pod/abc' });
    expect(call.error).toBe(err);
  });

  it('a plain error toast reports to telemetry but is NOT marked reported (no page → no "support notified" line)', () => {
    showToast('error', 'Boom');
    // Still reported to the firehose (telemetry path), but non-critical → no Slack page.
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0]![0].severity).toBeUndefined();
    expect(toasts.value.at(-1)?.reported).toBe(false);
  });

  it('a critical error toast pages (severity: critical) and is marked reported', () => {
    showToast('error', 'Boom', undefined, { critical: true });
    expect(reportErrorMock.mock.calls[0]![0].severity).toBe('critical');
    expect(toasts.value.at(-1)?.reported).toBe(true);
  });

  it('marks the toast `reported: false` when silent: true', () => {
    showToast('error', 'Boom', undefined, { silent: true });
    expect(toasts.value.at(-1)?.reported).toBe(false);
  });

  it('does NOT prevent the toast from rendering if reportError throws', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportErrorMock.mockImplementationOnce(() => {
      throw new Error('reporter exploded');
    });
    showToast('error', 'Boom');
    expect(toasts.value.at(-1)?.title).toBe('Boom');
    expect(toasts.value.at(-1)?.reported).toBe(false);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('reportError threw'),
      expect.any(Error)
    );
  });
});

describe('useToast — dedupe', () => {
  const { toasts } = useToast();
  const reportErrorMock = vi.mocked(reportError);

  beforeEach(() => {
    while (toasts.value.length) dismissToast(toasts.value[0]!.id);
    reportErrorMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('ignores an identical live toast (same type+title+message) — no stacking', () => {
    showToast('error', 'Reconnect needed', 'desktop only', { silent: true });
    showToast('error', 'Reconnect needed', 'desktop only', { silent: true });
    showToast('error', 'Reconnect needed', 'desktop only', { silent: true });
    expect(toasts.value.filter((t) => t.title === 'Reconnect needed')).toHaveLength(1);
  });

  it('does NOT dedupe interactive toasts — two identical Undo toasts both survive', () => {
    const undoA = vi.fn();
    const undoB = vi.fn();
    // Byte-identical title/message, distinct actions (e.g. two goal contributions).
    showToast('success', 'Contribution added', undefined, {
      actionLabel: 'Undo',
      actionFn: undoA,
    });
    showToast('success', 'Contribution added', undefined, {
      actionLabel: 'Undo',
      actionFn: undoB,
    });
    const live = toasts.value.filter((t) => t.title === 'Contribution added');
    expect(live).toHaveLength(2);
    expect(live.map((t) => t.actionFn)).toEqual([undoA, undoB]);
  });

  it('pushes a toast with a different message', () => {
    showToast('info', 'Heads up', 'one');
    showToast('info', 'Heads up', 'two');
    expect(toasts.value.filter((t) => t.title === 'Heads up')).toHaveLength(2);
  });

  it('a duplicated error toast reports only ONCE (no double-page)', () => {
    showToast('error', 'Boom', 'again');
    showToast('error', 'Boom', 'again');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(toasts.value.filter((t) => t.title === 'Boom')).toHaveLength(1);
  });
});
