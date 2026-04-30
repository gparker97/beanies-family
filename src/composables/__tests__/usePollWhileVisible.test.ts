import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { usePollWhileVisible } from '../usePollWhileVisible';

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

// Stub useToday so we control isVisible directly without juggling
// document.visibilityState across tests.
import { ref } from 'vue';
const isVisibleRef = ref(true);
vi.mock('../useToday', () => ({
  useToday: () => ({
    isVisible: isVisibleRef,
    today: ref('2026-04-30'),
    startOfToday: ref(new Date()),
    lastVisibleAt: ref(0),
    lastHiddenAt: ref(0),
  }),
}));

async function setVisible(value: boolean): Promise<void> {
  isVisibleRef.value = value;
  await nextTick();
}

describe('usePollWhileVisible', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    isVisibleRef.value = true;
    vi.useFakeTimers();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('fires callback every intervalMs while visible', async () => {
    const cb = vi.fn();
    const scope = effectScope();
    scope.run(() => usePollWhileVisible(cb, 1000));

    await nextTick();
    expect(cb).not.toHaveBeenCalled(); // no immediate fire by default

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(3);

    scope.stop();
  });

  it('stops polling when visibility goes hidden', async () => {
    const cb = vi.fn();
    const scope = effectScope();
    scope.run(() => usePollWhileVisible(cb, 1000));

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    await setVisible(false);
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1); // no further calls while hidden

    scope.stop();
  });

  it('resumes polling on hidden→visible (without fireImmediately)', async () => {
    const cb = vi.fn();
    const scope = effectScope();
    scope.run(() => usePollWhileVisible(cb, 1000));

    await setVisible(false);
    vi.advanceTimersByTime(5000);
    expect(cb).not.toHaveBeenCalled();

    await setVisible(true);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1); // resumed; no extra immediate fire

    scope.stop();
  });

  it('fires immediately on become-visible when option is set (initial mount + transition)', async () => {
    // Per spec: `fireImmediatelyOnVisible` fires once each time visibility
    // becomes visible — including the initial mount if the tab is visible
    // when the composable is registered. Callers wanting transition-only
    // semantics should omit the option and rely on the first interval tick.
    const cb = vi.fn();
    const scope = effectScope();
    scope.run(() => usePollWhileVisible(cb, 10_000, { fireImmediatelyOnVisible: true }));

    await nextTick();
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1); // initial mount

    await setVisible(false);
    await setVisible(true);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(2); // hidden→visible transition

    scope.stop();
  });

  it('does NOT fire on initial mount when option is OFF (default)', async () => {
    // Default: only the interval ticks fire the callback. No initial fire.
    const cb = vi.fn();
    const scope = effectScope();
    scope.run(() => usePollWhileVisible(cb, 10_000));

    await nextTick();
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();

    scope.stop();
  });

  it('stops via explicit handle.stop()', async () => {
    const cb = vi.fn();
    const scope = effectScope();
    let handle!: { stop: () => void };
    scope.run(() => {
      handle = usePollWhileVisible(cb, 1000);
    });

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    handle.stop();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1); // no more calls

    scope.stop();
  });

  it('auto-stops on scope dispose', async () => {
    const cb = vi.fn();
    const scope = effectScope();
    scope.run(() => usePollWhileVisible(cb, 1000));

    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);

    scope.stop();
    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(1); // stopped via scope dispose
  });

  it('stop() is idempotent', async () => {
    const cb = vi.fn();
    const scope = effectScope();
    let handle!: { stop: () => void };
    scope.run(() => {
      handle = usePollWhileVisible(cb, 1000);
    });

    handle.stop();
    expect(() => handle.stop()).not.toThrow();
    expect(() => handle.stop()).not.toThrow();

    scope.stop();
  });

  it('throwing callback does not kill the loop (errors caught + reported)', async () => {
    const { reportError } = await import('@/utils/errorReporter');
    const cb = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockResolvedValue(undefined);
    const scope = effectScope();
    scope.run(() => usePollWhileVisible(cb, 1000, { surface: 'test-surface' }));

    vi.advanceTimersByTime(1000);
    await Promise.resolve(); // let safeRun's catch chain resolve
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'test-surface',
        message: 'poll callback threw',
        severity: 'warning',
      })
    );

    // Loop continues despite the throw
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);

    scope.stop();
  });
});
