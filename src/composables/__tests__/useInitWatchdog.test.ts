import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/visibilityTracker', () => ({
  ensureVisibilityTracking: vi.fn(),
  wasHiddenSince: vi.fn(() => false),
  getHiddenDurationMs: vi.fn(() => null),
}));

import { useInitWatchdog, type InitWatchdogOptions } from '../useInitWatchdog';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { wasHiddenSince } from '@/utils/visibilityTracker';

const FIRST = 35_000;
const FOLLOW_UP = 60_000;

function arm(overrides: Partial<InitWatchdogOptions> = {}) {
  const crumbs = ['route: Nook', 'auth: needsAuth=false, user=someone@example.com'];
  const onFire = vi.fn();
  const onLateSettle = vi.fn();
  const watchdog = useInitWatchdog({
    firstMs: FIRST,
    followUpMs: FOLLOW_UP,
    breadcrumbs: () => crumbs,
    routePath: () => '/nook',
    isStandingDown: () => false,
    onFire,
    onLateSettle,
    ...overrides,
  });
  return { watchdog, onFire, onLateSettle, crumbs };
}

const reportMock = vi.mocked(reportError);
const logMock = vi.mocked(logEvent);
const hiddenMock = vi.mocked(wasHiddenSince);

describe('useInitWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reportMock.mockClear();
    logMock.mockClear();
    hiddenMock.mockReset();
    hiddenMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires pre-shell at error severity with the stall context, and paints the overlay', () => {
    const { onFire } = arm();
    vi.advanceTimersByTime(FIRST);

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenCalledTimes(1);
    const report = reportMock.mock.calls[0]![0];
    expect(report.severity).toBe('error');
    expect(report.surface).toBe('app.onboardingStallTimeout');
    expect(report.context).toEqual({
      stage: 'auth: needsAuth=false, <email>',
      breadcrumbs: 'route: Nook | auth: needsAuth=false, <email>',
      visibility_state: 'visible',
      page_hidden_for_ms: null,
      perf_duration_ms: FIRST,
      route_path: '/nook',
    });
  });

  it('cleared at shell-visible: a 40s data load gives no overlay and no report', () => {
    const { watchdog, onFire } = arm();
    vi.advanceTimersByTime(5_000);
    watchdog.clear(); // shell visible
    vi.advanceTimersByTime(40_000 + FOLLOW_UP);
    watchdog.settle(); // data load landed
    watchdog.clear(); // finally

    expect(onFire).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('completion after a firing clears the overlay and logs the late-completion warn', () => {
    const { watchdog, onLateSettle } = arm();
    vi.advanceTimersByTime(FIRST);
    vi.advanceTimersByTime(10_000);
    watchdog.clear(); // shell visible, 45s in
    watchdog.settle();

    expect(onLateSettle).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith({
      level: 'warn',
      surface: 'app.onboardingStallTimeout',
      message: 'completed after watchdog',
      context: { perf_duration_ms: FIRST + 10_000 },
    });
  });

  it('an early return after a firing (finally settles, then clears) clears the overlay once', () => {
    const { watchdog, onLateSettle } = arm();
    vi.advanceTimersByTime(FIRST);
    // App.vue's finally on an early return (`/welcome`, resume-setup): no settle() ran
    // after loadFamilyData, so the finally's settle() is the one that clears the overlay.
    watchdog.settle();
    watchdog.clear();
    vi.advanceTimersByTime(FOLLOW_UP);

    expect(onLateSettle).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0]![0]).toMatchObject({ message: 'completed after watchdog' });
    expect(reportMock).toHaveBeenCalledTimes(1); // the first firing only, no page
  });

  it('settle() is idempotent: the finally after the data-load settle does not re-clear', () => {
    const { watchdog, onLateSettle } = arm();
    vi.advanceTimersByTime(FIRST);
    watchdog.settle(); // after loadFamilyData
    watchdog.settle(); // the finally
    watchdog.clear();

    expect(onLateSettle).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledTimes(1);
  });

  it('clear() never settles: a thrown init keeps its overlay and logs no completion', () => {
    const { watchdog, onLateSettle } = arm();
    vi.advanceTimersByTime(FIRST);
    watchdog.clear(); // the finally after a throw skips settle()

    expect(onLateSettle).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('a settle() with no prior firing logs nothing and leaves the overlay alone', () => {
    const { watchdog, onLateSettle } = arm();
    vi.advanceTimersByTime(5_000);
    watchdog.settle();
    watchdog.clear();
    vi.advanceTimersByTime(FIRST + FOLLOW_UP);

    expect(onLateSettle).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('settle before the first firing cancels it (no overlay, no report)', () => {
    const { watchdog, onFire, onLateSettle } = arm();
    vi.advanceTimersByTime(5_000);
    watchdog.settle(); // no clear() first: settle alone must stop the pending arm
    vi.advanceTimersByTime(FIRST + FOLLOW_UP);

    expect(onFire).not.toHaveBeenCalled();
    expect(onLateSettle).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('pages critical 60s after the first firing when still unsettled and visible', () => {
    arm();
    vi.advanceTimersByTime(FIRST);
    vi.advanceTimersByTime(FOLLOW_UP);

    expect(reportMock).toHaveBeenCalledTimes(2);
    const page = reportMock.mock.calls[1]![0];
    expect(page.severity).toBe('critical');
    expect(page.surface).toBe('app.onboardingStallTimeout');
    expect(page.context).toMatchObject({
      perf_duration_ms: FIRST + FOLLOW_UP,
      route_path: '/nook',
    });
  });

  const rearmsLogged = (action: string) =>
    logMock.mock.calls.filter(
      ([e]) => (e.context as { action?: string } | undefined)?.action === action
    );

  it('a background-tab first firing re-arms with no overlay and no report', () => {
    const t0 = Date.now();
    const { onFire } = arm();
    hiddenMock.mockReturnValue(true);
    vi.advanceTimersByTime(FIRST);

    expect(onFire).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
    expect(rearmsLogged('rearmed-hidden')).toHaveLength(1);
    expect(logMock.mock.calls[0]![0]).toMatchObject({
      level: 'info',
      surface: 'app.onboardingStallTimeout',
      context: { action: 'rearmed-hidden', perf_duration_ms: FIRST },
    });
    // The re-arm opened a fresh window: asked about it, not the mount time.
    hiddenMock.mockReturnValue(false);
    vi.advanceTimersByTime(FIRST);
    expect(hiddenMock).toHaveBeenLastCalledWith(t0 + FIRST);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(reportMock.mock.calls[0]![0]).toMatchObject({
      severity: 'error',
      context: { perf_duration_ms: 2 * FIRST },
    });
  });

  it('a one-second hide at t=5s does not mute the critical', () => {
    let hiddenAt: number | null = null;
    hiddenMock.mockImplementation((since) => hiddenAt !== null && hiddenAt >= since);
    arm();
    vi.advanceTimersByTime(5_000);
    hiddenAt = Date.now(); // hidden at 5s, visible again at 6s
    vi.advanceTimersByTime(1_000);

    // The first window saw the hide, so it re-arms; every later window is visible.
    vi.advanceTimersByTime(FIRST - 6_000);
    expect(reportMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST + FOLLOW_UP);

    expect(reportMock.mock.calls.map(([r]) => r.severity)).toEqual(['error', 'critical']);
    expect(reportMock.mock.calls[1]![0].context).toMatchObject({
      perf_duration_ms: 2 * FIRST + FOLLOW_UP,
    });
  });

  it('a follow-up window that saw a hide re-arms, then pages after a visible one', () => {
    const t0 = Date.now();
    arm();
    vi.advanceTimersByTime(FIRST);
    hiddenMock.mockReturnValue(true);
    vi.advanceTimersByTime(FOLLOW_UP);

    expect(reportMock).toHaveBeenCalledTimes(1); // the first firing only
    expect(rearmsLogged('rearmed-hidden-follow-up')).toHaveLength(1);
    // The follow-up's window opened at the first firing, not at mount.
    expect(hiddenMock).toHaveBeenLastCalledWith(t0 + FIRST);

    hiddenMock.mockReturnValue(false);
    vi.advanceTimersByTime(FOLLOW_UP);
    expect(reportMock).toHaveBeenCalledTimes(2);
    expect(reportMock.mock.calls[1]![0]).toMatchObject({
      severity: 'critical',
      context: { perf_duration_ms: FIRST + 2 * FOLLOW_UP },
    });
  });

  it('caps hidden re-arms at 3 per arm, then acts as if visible', () => {
    const { onFire } = arm();
    hiddenMock.mockReturnValue(true); // a tab that keeps flickering hidden

    vi.advanceTimersByTime(3 * FIRST);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(rearmsLogged('rearmed-hidden')).toHaveLength(3);

    vi.advanceTimersByTime(3 * FOLLOW_UP);
    expect(reportMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FOLLOW_UP);
    expect(rearmsLogged('rearmed-hidden-follow-up')).toHaveLength(3);
    expect(reportMock.mock.calls.map(([r]) => r.severity)).toEqual(['error', 'critical']);
  });

  it('settle() during a hidden re-arm stops it (no overlay, no report)', () => {
    const { watchdog, onFire } = arm();
    hiddenMock.mockReturnValue(true);
    vi.advanceTimersByTime(FIRST);
    watchdog.settle();
    hiddenMock.mockReturnValue(false);
    vi.advanceTimersByTime(FIRST + FOLLOW_UP);

    expect(onFire).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('no critical once init settled, even if the follow-up handle was not cleared', () => {
    const { watchdog } = arm();
    vi.advanceTimersByTime(FIRST);
    watchdog.settle();
    vi.advanceTimersByTime(FOLLOW_UP);

    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it('the finally clear stops the pending follow-up (one handle)', () => {
    const { watchdog } = arm();
    vi.advanceTimersByTime(FIRST);
    watchdog.clear();
    vi.advanceTimersByTime(FOLLOW_UP);

    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it('stands down while a chunk-recovery reload is in flight', () => {
    const { onFire } = arm({ isStandingDown: () => true });
    vi.advanceTimersByTime(FIRST + FOLLOW_UP);

    expect(onFire).not.toHaveBeenCalled();
    expect(reportMock).not.toHaveBeenCalled();
  });
});
