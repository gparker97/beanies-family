import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { createCalendarConnection } from '@/services/automerge/repositories/calendarRepository';
import { createActivity } from '@/services/automerge/repositories/activityRepository';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import { __setStoresAuthoritativeForTesting } from '@/services/automerge/loadMaintenance';
import { toISODateString } from '@/utils/date';
import type { CreateFamilyActivityInput } from '@/types/models';

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
    useCalendarSyncStore().stop();
    __setStoresAuthoritativeForTesting(false);
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

  // 2026-11-15: the AUTOMATIC reconcile writes connection rows back, so it never runs on a
  // projection snapshot; the open's first verify pass runs when the stores turn authoritative.
  // A person's "Sync now" is not gated.
  it('the poll reconciles nothing on a snapshot, and runs once the stores are authoritative', async () => {
    const inserts: string[] = [];
    setCalendarClientForTesting(
      makeCalendarClientStub({
        async insertEvent(_c, _cal, eventId) {
          inserts.push(eventId);
        },
        async eventExists() {
          return false;
        },
      })
    );
    await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'refresh-xyz',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });
    await createActivity({
      title: 'Soccer practice',
      date: toISODateString(new Date()).slice(0, 10),
      recurrence: 'none',
      category: 'sports',
      feeSchedule: 'none',
      reminderMinutes: 0,
      isActive: true,
      createdBy: 'm0',
    } as unknown as CreateFamilyActivityInput);

    const store = useCalendarSyncStore();
    __setStoresAuthoritativeForTesting(false);
    store.start();
    const [poll] = pollSpy.mock.calls[0]!;
    await poll(); // the immediate become-visible pass, on a snapshot
    expect(inserts).toEqual([]);

    __setStoresAuthoritativeForTesting(true);
    await vi.waitFor(() => expect(inserts).toHaveLength(1));
  });
});
