/**
 * The App-level calendar redirect resume routes by intent (view-only calendars plan
 * 2026-11-17, A2): a `view` / `view:<accountId>` return goes to the view store, and
 * the sync store never redeems it (it would check the wrong grant's scope).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, reactive } from 'vue';

interface FakeRoute {
  path: string;
  query: Record<string, string>;
}

const h = vi.hoisted(() => ({
  route: null as unknown as FakeRoute,
  replace: vi.fn(async () => {}),
  syncResume: vi.fn(async () => null as unknown),
  viewResume: vi.fn(async () => null as unknown),
  showToast: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => h.route,
  useRouter: () => ({ replace: h.replace }),
}));
vi.mock('@/stores/calendarSyncStore', () => ({
  useCalendarSyncStore: () => ({ resumeRedirectConnect: h.syncResume }),
}));
vi.mock('@/stores/calendarViewStore', () => ({
  useCalendarViewStore: () => ({ resumeViewRedirect: h.viewResume }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/composables/waitForDocLoaded', () => ({ waitForDocLoaded: async () => true }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useCalendarRedirectResume } from '../useCalendarRedirectResume';

// The route the composable watches; reactive so its watcher sees the query.
h.route = reactive<FakeRoute>({ path: '/settings', query: {} });

function route(): FakeRoute {
  return h.route;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await nextTick();
}

beforeEach(() => {
  h.syncResume.mockReset();
  h.syncResume.mockResolvedValue(null);
  h.viewResume.mockReset();
  h.viewResume.mockResolvedValue(null);
  h.showToast.mockClear();
});

describe('useCalendarRedirectResume', () => {
  it('routes a fresh view consent to the view store, never the sync store', async () => {
    route().query = { open: 'calendar-sync', calResume: 'view' };
    const scope = effectScope();
    scope.run(() => useCalendarRedirectResume());
    await settle();
    expect(h.viewResume).toHaveBeenCalledWith('view');
    expect(h.syncResume).not.toHaveBeenCalled();
    expect(h.replace).toHaveBeenCalled();
    scope.stop();
  });

  it('toasts a view reconnect that completed', async () => {
    h.viewResume.mockResolvedValue({ status: 'reconnected' });
    route().query = { calResume: 'view:acct-1' };
    const scope = effectScope();
    scope.run(() => useCalendarRedirectResume());
    await settle();
    expect(h.viewResume).toHaveBeenCalledWith('view:acct-1');
    expect(h.showToast).toHaveBeenCalledWith(
      'success',
      'calendarView.toast.reconnected.title',
      'calendarView.toast.reconnected.message'
    );
    scope.stop();
  });

  it('a sync intent still goes to the sync store', async () => {
    route().query = { calResume: 'connect' };
    const scope = effectScope();
    scope.run(() => useCalendarRedirectResume());
    await settle();
    expect(h.syncResume).toHaveBeenCalledWith('connect');
    expect(h.viewResume).not.toHaveBeenCalled();
    scope.stop();
  });

  // Review F5: an account mismatch's `message` is the stored account's EMAIL. A
  // non-silent error toast forwards its text to `reportError`, so the email would
  // reach telemetry. The email may be shown, but only in a silent toast.
  const STORED_EMAIL = 'grandma@example.com';

  it.each([
    ['view', 'view:acct-1', h.viewResume],
    ['sync', 'conn-1', h.syncResume],
  ] as const)(
    'a %s reconnect as the wrong account shows the template silently, never a raw message',
    async (_kind, intent, resume) => {
      resume.mockResolvedValueOnce({
        status: 'failed',
        code: 'account_mismatch',
        message: STORED_EMAIL,
      });
      route().query = { calResume: intent };
      const scope = effectScope();
      scope.run(() => useCalendarRedirectResume());
      await settle();
      expect(h.showToast).toHaveBeenCalledTimes(1);
      const [type, title, message, opts] = h.showToast.mock.calls[0]!;
      expect(type).toBe('error');
      expect(title).toBe('calendarSync.toast.accountMismatch.title');
      // The key comes back as-is from the mocked `t`; the email is filled in only
      // where the template asks for it, and the toast is silent.
      expect(message).toBe('calendarSync.toast.accountMismatch.message');
      expect(opts).toMatchObject({ silent: true });
      scope.stop();
    }
  );

  it('a sync redirect failure shows translated copy, never the English message from calendarAuth', async () => {
    h.syncResume.mockResolvedValueOnce({
      status: 'failed',
      code: 'exchange_failed',
      message: 'Calendar redirect code exchange failed: boom',
    });
    route().query = { calResume: 'conn-1' };
    const scope = effectScope();
    scope.run(() => useCalendarRedirectResume());
    await settle();
    const [, , message] = h.showToast.mock.calls[0]!;
    expect(message).toBe('calendar.error.connectRetry');
    scope.stop();
  });
});
