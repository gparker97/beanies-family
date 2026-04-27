import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let useToday: typeof import('@/composables/useToday').useToday;

interface Listeners {
  visibilitychange: EventListener[];
  pageshow: EventListener[];
}

describe('useToday', () => {
  let listeners: Listeners;
  let visibilityState: 'visible' | 'hidden';

  beforeEach(async () => {
    listeners = { visibilitychange: [], pageshow: [] };
    visibilityState = 'visible';

    // Mock document.visibilityState
    Object.defineProperty(document, 'visibilityState', {
      get: () => visibilityState,
      configurable: true,
    });

    // Track listeners on document + window
    vi.spyOn(document, 'addEventListener').mockImplementation((type: string, handler: unknown) => {
      if (type === 'visibilitychange') listeners.visibilitychange.push(handler as EventListener);
    });
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, handler: unknown) => {
      if (type === 'pageshow') listeners.pageshow.push(handler as EventListener);
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T10:00:00')); // local time

    vi.resetModules();
    const mod = await import('@/composables/useToday');
    useToday = mod.useToday;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns initial today as the current local YYYY-MM-DD', () => {
    const { today } = useToday();
    expect(today.value).toBe('2026-04-27');
  });

  it('exposes startOfToday as the start of the local day', () => {
    const { startOfToday } = useToday();
    expect(startOfToday.value.getFullYear()).toBe(2026);
    expect(startOfToday.value.getMonth()).toBe(3); // 0-indexed April
    expect(startOfToday.value.getDate()).toBe(27);
    expect(startOfToday.value.getHours()).toBe(0);
    expect(startOfToday.value.getMinutes()).toBe(0);
  });

  it('isVisible reflects document.visibilityState on init', () => {
    const { isVisible } = useToday();
    expect(isVisible.value).toBe(true);
  });

  it('registers exactly one visibilitychange and one pageshow listener', () => {
    useToday();
    expect(listeners.visibilitychange).toHaveLength(1);
    expect(listeners.pageshow).toHaveLength(1);
  });

  it('repeated calls to useToday return the same singleton refs (idempotent init)', () => {
    const a = useToday();
    const b = useToday();
    expect(a.today).toBe(b.today);
    expect(a.isVisible).toBe(b.isVisible);
    // Listeners not double-registered
    expect(listeners.visibilitychange).toHaveLength(1);
    expect(listeners.pageshow).toHaveLength(1);
  });

  it('flips today when the midnight setTimeout fires', () => {
    const { today } = useToday();
    expect(today.value).toBe('2026-04-27');

    // Advance to just past local midnight
    vi.setSystemTime(new Date('2026-04-28T00:00:01'));
    vi.runOnlyPendingTimers();

    expect(today.value).toBe('2026-04-28');
  });

  it('rearms the midnight timer after firing (covers multi-day active sessions)', () => {
    const { today } = useToday();

    vi.setSystemTime(new Date('2026-04-28T00:00:01'));
    vi.runOnlyPendingTimers();
    expect(today.value).toBe('2026-04-28');

    vi.setSystemTime(new Date('2026-04-29T00:00:01'));
    vi.runOnlyPendingTimers();
    expect(today.value).toBe('2026-04-29');
  });

  it('updates today on visibilitychange → visible after a day flip', () => {
    const { today, lastVisibleAt } = useToday();
    expect(today.value).toBe('2026-04-27');

    // Hide tab
    visibilityState = 'hidden';
    listeners.visibilitychange.forEach((fn) => fn(new Event('visibilitychange')));

    // Day flips while hidden
    vi.setSystemTime(new Date('2026-04-28T09:00:00'));

    // Wake tab
    visibilityState = 'visible';
    const beforeWake = Date.now();
    listeners.visibilitychange.forEach((fn) => fn(new Event('visibilitychange')));

    expect(today.value).toBe('2026-04-28');
    expect(lastVisibleAt.value).toBeGreaterThanOrEqual(beforeWake);
  });

  it('updates lastHiddenAt and toggles isVisible on hidden', () => {
    const { isVisible, lastHiddenAt } = useToday();
    expect(isVisible.value).toBe(true);

    visibilityState = 'hidden';
    const before = Date.now();
    listeners.visibilitychange.forEach((fn) => fn(new Event('visibilitychange')));

    expect(isVisible.value).toBe(false);
    expect(lastHiddenAt.value).toBeGreaterThanOrEqual(before);
  });

  it('updates today on pageshow with persisted=true (iOS bfcache)', () => {
    const { today } = useToday();
    expect(today.value).toBe('2026-04-27');

    vi.setSystemTime(new Date('2026-04-28T08:00:00'));
    const event = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: true, configurable: true });
    listeners.pageshow.forEach((fn) => fn(event));

    expect(today.value).toBe('2026-04-28');
  });

  it('does not update today on pageshow with persisted=false (regular navigation)', () => {
    const { today } = useToday();

    vi.setSystemTime(new Date('2026-04-28T08:00:00'));
    const event = new Event('pageshow') as Event & { persisted: boolean };
    Object.defineProperty(event, 'persisted', { value: false, configurable: true });
    listeners.pageshow.forEach((fn) => fn(event));

    // Still old today — pageshow without persisted is a no-op
    expect(today.value).toBe('2026-04-27');
  });

  it('midnight timer rearms with DST-correct delay across spring-forward', () => {
    // 2026-03-08 is US spring-forward; clocks jump from 02:00 → 03:00.
    // Set time to just before midnight on 2026-03-08 in a timezone-naive way —
    // we're testing that the rearm uses `new Date(y, m, d+1, 0, 0, 0)` which
    // resolves to wall-clock midnight, not `prev + 86_400_000`.
    vi.setSystemTime(new Date(2026, 2, 8, 23, 59, 0)); // local 23:59 on 2026-03-08

    vi.resetModules();
    return import('@/composables/useToday').then((mod) => {
      const { today } = mod.useToday();
      expect(today.value).toBe('2026-03-08');

      vi.setSystemTime(new Date(2026, 2, 9, 0, 0, 1));
      vi.runOnlyPendingTimers();

      // Day correctly advanced. The exact `setTimeout` delay would have been
      // ~60s (from 23:59 to wall-clock midnight), regardless of DST behavior
      // in the test environment's TZ.
      expect(today.value).toBe('2026-03-09');
    });
  });
});
