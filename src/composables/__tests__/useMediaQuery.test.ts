import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope } from 'vue';
import { useMediaQuery } from '@/composables/useMediaQuery';

interface FakeList {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

describe('useMediaQuery', () => {
  let list: FakeList;
  let fire: ((matches: boolean) => void) | null;
  const original = window.matchMedia;

  beforeEach(() => {
    fire = null;
    list = {
      matches: false,
      addEventListener: vi.fn((_type: string, handler: (e: MediaQueryListEvent) => void) => {
        fire = (matches: boolean) => handler({ matches } as MediaQueryListEvent);
      }),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => list) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = original;
  });

  it('reports the query result at the moment it is created', () => {
    list.matches = true;
    const scope = effectScope();
    const matches = scope.run(() => useMediaQuery('(min-width: 600px)'))!;

    expect(matches.value).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 600px)');
    scope.stop();
  });

  it('updates when the query starts or stops matching', () => {
    const scope = effectScope();
    const matches = scope.run(() => useMediaQuery('(orientation: portrait)'))!;
    expect(matches.value).toBe(false);

    fire!(true);
    expect(matches.value).toBe(true);

    fire!(false);
    expect(matches.value).toBe(false);
    scope.stop();
  });

  it('releases its listener when the owning scope goes away', () => {
    const scope = effectScope();
    scope.run(() => useMediaQuery('(min-width: 600px)'));
    expect(list.addEventListener).toHaveBeenCalledTimes(1);
    expect(list.removeEventListener).not.toHaveBeenCalled();

    scope.stop();

    // Same handler in and out — a removeEventListener with a different function
    // reference silently leaks, which is the defect this composable exists to
    // make impossible.
    expect(list.removeEventListener).toHaveBeenCalledTimes(1);
    expect(list.removeEventListener.mock.calls[0]![1]).toBe(
      list.addEventListener.mock.calls[0]![1]
    );
  });

  it('falls back to `initial` and registers nothing when matchMedia is absent', () => {
    // jsdom without the shim, an old WebView, or SSR.
    (window as { matchMedia?: unknown }).matchMedia = undefined;

    const scope = effectScope();
    const assumed = scope.run(() => useMediaQuery('(min-width: 600px)', true))!;
    const denied = scope.run(() => useMediaQuery('(orientation: portrait)'))!;

    expect(assumed.value).toBe(true);
    expect(denied.value).toBe(false);
    expect(list.addEventListener).not.toHaveBeenCalled();

    // Nothing was registered, so disposing must not throw trying to release it.
    expect(() => scope.stop()).not.toThrow();
  });
});
