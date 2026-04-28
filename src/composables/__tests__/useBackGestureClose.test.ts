import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, ref } from 'vue';
import { useBackGestureClose } from '../useBackGestureClose';

function fireBack(state: unknown = null) {
  const original = window.history.state;
  Object.defineProperty(window.history, 'state', {
    configurable: true,
    get: () => state,
  });
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
  Object.defineProperty(window.history, 'state', {
    configurable: true,
    get: () => original,
  });
}

describe('useBackGestureClose', () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;
  let backSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let pushedStates: unknown[] = [];

  beforeEach(() => {
    pushedStates = [];
    pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation((state: unknown) => {
      pushedStates.push(state);
      Object.defineProperty(window.history, 'state', {
        configurable: true,
        get: () => state,
      });
    });
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {
      // simulate the browser firing popstate with the previous state
      const prev = pushedStates.length > 1 ? pushedStates[pushedStates.length - 2] : null;
      pushedStates.pop();
      Object.defineProperty(window.history, 'state', {
        configurable: true,
        get: () => prev,
      });
      window.dispatchEvent(new PopStateEvent('popstate', { state: prev }));
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    pushSpy.mockRestore();
    backSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('pushes a marker on isOpen=true', () => {
    const isOpen = ref(true);
    const scope = effectScope();
    scope.run(() => useBackGestureClose(isOpen, vi.fn()));

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const state = pushSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(state._beanieOverlayMarker).toEqual(expect.stringMatching(/^bg-/));

    scope.stop();
  });

  it('calls onClose when popstate carries a non-matching state (back gesture)', () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useBackGestureClose(isOpen, onClose));

    // Simulate user back-gesture: state no longer carries our marker
    fireBack(null);
    expect(onClose).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it('ignores popstate when state still carries our marker', () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useBackGestureClose(isOpen, onClose));

    const stateWithOurMarker = pushSpy.mock.calls[0][0];
    fireBack(stateWithOurMarker);
    expect(onClose).not.toHaveBeenCalled();

    scope.stop();
  });

  it('uses unique marker keys for concurrent instances', () => {
    const isOpenA = ref(true);
    const isOpenB = ref(true);
    const scopeA = effectScope();
    const scopeB = effectScope();
    scopeA.run(() => useBackGestureClose(isOpenA, vi.fn()));
    scopeB.run(() => useBackGestureClose(isOpenB, vi.fn()));

    const stateA = pushSpy.mock.calls[0][0] as Record<string, unknown>;
    const stateB = pushSpy.mock.calls[1][0] as Record<string, unknown>;
    expect(stateA._beanieOverlayMarker).not.toEqual(stateB._beanieOverlayMarker);

    scopeA.stop();
    scopeB.stop();
  });

  it('pops marker via history.back when isOpen flips to false', async () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useBackGestureClose(isOpen, onClose));

    isOpen.value = false;
    await Promise.resolve();
    expect(backSpy).toHaveBeenCalledTimes(1);
    // The popstate fired by our back() call should be swallowed by the
    // re-entry guard, not double-fire onClose.
    expect(onClose).not.toHaveBeenCalled();

    scope.stop();
  });

  it('pops marker on scope dispose (safety net)', () => {
    const isOpen = ref(true);
    const scope = effectScope();
    scope.run(() => useBackGestureClose(isOpen, vi.fn()));
    expect(backSpy).not.toHaveBeenCalled();

    scope.stop();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('logs and degrades when pushState throws', () => {
    pushSpy.mockImplementation(() => {
      throw new Error('denied');
    });

    const isOpen = ref(true);
    const scope = effectScope();
    scope.run(() => useBackGestureClose(isOpen, vi.fn()));

    expect(warnSpy).toHaveBeenCalledWith(
      '[useBackGestureClose] could not push history marker; back gesture unavailable:',
      expect.any(Error)
    );

    scope.stop();
  });
});
