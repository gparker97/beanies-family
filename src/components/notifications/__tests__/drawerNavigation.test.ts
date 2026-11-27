import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (e: unknown) => logEvent(e) }));

import { pushFromDrawer } from '@/components/notifications/drawerNavigation';

/** A router double whose current route can be moved by the test. */
function fakeRouter(push: ReturnType<typeof vi.fn>, fullPath = '/nook') {
  const currentRoute = { value: { fullPath } };
  return { router: { push, currentRoute } as unknown as Router, currentRoute };
}

/** Run to completion: the pop wait, then the retry pause. */
async function settle(done: Promise<void>): Promise<void> {
  await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(400);
  await done;
}

describe('pushFromDrawer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logEvent.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('waits for the drawer\u2019s history pop before pushing', async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const done = pushFromDrawer(fakeRouter(push).router, '/travel', 'open');
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledTimes(1);
    await done;
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('pushes anyway when no pop arrives (a drawer with no marker)', async () => {
    const push = vi.fn().mockResolvedValue(undefined);
    const done = pushFromDrawer(fakeRouter(push).router, '/travel', 'open');
    await vi.advanceTimersByTimeAsync(250);
    await done;
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('retries once after a cancelled push and logs it', async () => {
    const push = vi
      .fn()
      .mockResolvedValueOnce(new Error('Navigation cancelled'))
      .mockResolvedValueOnce(undefined);
    await settle(pushFromDrawer(fakeRouter(push).router, { path: '/travel' }, 'open'));
    expect(push).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'notifications',
        context: expect.objectContaining({ action: 'open_nav_cancelled' }),
      })
    );
  });

  it('does not retry when the user has moved on during the pause', async () => {
    const push = vi.fn().mockResolvedValueOnce(new Error('Navigation cancelled'));
    const { router, currentRoute } = fakeRouter(push);
    const done = pushFromDrawer(router, '/travel', 'open');
    await vi.advanceTimersByTimeAsync(250);
    currentRoute.value = { fullPath: '/planner' };
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('logs a failure under its own action when the retry fails, including a push that throws', async () => {
    const push = vi
      .fn()
      .mockResolvedValueOnce(new Error('Navigation cancelled'))
      .mockImplementationOnce(() => {
        throw new Error('cannot resolve');
      });
    await settle(pushFromDrawer(fakeRouter(push).router, '/travel', 'tip'));
    expect(push).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: 'error',
        context: expect.objectContaining({ action: 'tip_nav_failed' }),
      })
    );
  });

  it('treats "already there" as done: no retry, no log (a real router)', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/travel', component: { template: '<div />' } }],
    });
    vi.useRealTimers();
    await router.push('/travel');
    const pushSpy = vi.spyOn(router, 'push');
    await pushFromDrawer(router, '/travel', 'open');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
