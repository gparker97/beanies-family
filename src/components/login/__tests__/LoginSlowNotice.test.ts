import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import LoginSlowNotice, { LOGIN_SLOW_AFTER_MS } from '../LoginSlowNotice.vue';

describe('LoginSlowNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logEvent.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows nothing while the spinner is young', async () => {
    const w = mount(LoginSlowNotice, { props: { where: 'loading' } });
    await vi.advanceTimersByTimeAsync(LOGIN_SLOW_AFTER_MS - 1);
    expect(w.find('[data-testid="login-slow-notice"]').exists()).toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('shows the caption and logs once when the spinner outlives the limit', async () => {
    const w = mount(LoginSlowNotice, { props: { where: 'flow' } });
    await vi.advanceTimersByTimeAsync(LOGIN_SLOW_AFTER_MS);
    expect(w.find('[data-testid="login-slow-notice"]').text()).toBe('auth.loadingSlow');
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'login-flow',
        context: { action: 'slow_spinner', detail: 'where=flow' },
      })
    );
  });

  it('a spinner that clears in time never shows or logs', async () => {
    const w = mount(LoginSlowNotice, { props: { where: 'init' } });
    await vi.advanceTimersByTimeAsync(LOGIN_SLOW_AFTER_MS - 100);
    w.unmount();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
