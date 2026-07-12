import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';

// P3 — token keep-warm parity guarantee (regression pin).
//
// Calendar reaches Drive's "aggressive refresh, don't bother the user" bar
// WITHOUT a separate wake-listener/scheduler: the reconcile poll re-mints the
// per-connection token on EVERY become-visible (fireImmediatelyOnVisible) and
// every RECONCILE_POLL_MS while visible, and the token provider's per-connection
// single-flight coalesces concurrent mints (see googleCalendarClient.tokenProvider
// .test.ts). This test pins the wake-refresh half so a future edit can't silently
// drop it (which would regress P3 parity). See the plan's P3 evaluation.

const { pollSpy } = vi.hoisted(() => ({
  pollSpy: vi.fn<
    (
      cb: () => Promise<void> | void,
      intervalMs: number,
      options?: { fireImmediatelyOnVisible?: boolean; surface?: string }
    ) => { stop: () => void }
  >(() => ({ stop: () => {} })),
}));

vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: pollSpy,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

describe('calendarSyncStore — token keep-warm parity (P3)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
    pollSpy.mockClear();
  });
  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  it('registers the reconcile poll with fireImmediatelyOnVisible — refreshes the token on every wake', () => {
    const store = useCalendarSyncStore();
    store.start();

    expect(pollSpy).toHaveBeenCalledOnce();
    const [, intervalMs, options] = pollSpy.mock.calls[0];
    // ~5 min cadence keeps the token warm while visible (a Google access token
    // lives ~60 min, so a visible calendar re-mints ~12× before it could expire).
    expect(intervalMs).toBe(300_000);
    // The wake-refresh guarantee: every hidden→visible transition reconciles,
    // which mints a fresh per-connection access token on demand.
    expect(options).toMatchObject({ fireImmediatelyOnVisible: true });
  });
});
