/**
 * pushRegistration (#143 Phase 2): web is inert and never loads the plugin; the token needs
 * permission already granted (never a prompt); `register()` runs once per process; a token
 * rotation (not the first token) reaches `onTokenChanged`; a failure is reported once; a tap
 * hands the push `data` over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  platform: 'ios' as 'ios' | 'android' | 'web',
  granted: true,
  ensureNotificationPermission: vi.fn(),
  reportError: vi.fn(),
  logEvent: vi.fn(),
  listeners: new Map<string, (arg: unknown) => void>(),
  register: vi.fn(),
  pluginLoaded: vi.fn(),
}));

vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => h.native,
  getPlatform: () => h.platform,
}));
vi.mock('@/composables/useNotificationPermission', () => ({
  ensureNotificationPermission: h.ensureNotificationPermission,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@capacitor/push-notifications', () => {
  h.pluginLoaded();
  return {
    PushNotifications: {
      addListener: async (event: string, cb: (arg: unknown) => void) => {
        h.listeners.set(event, cb);
        return { remove: async () => {} };
      },
      register: h.register,
    },
  };
});

import {
  __resetPushRegistrationForTesting,
  ensurePushToken,
  onPushTap,
  onTokenChanged,
  pushPlatform,
  pushToken,
  reportPushTokenFailure,
} from '../pushRegistration';

const fire = (event: string, arg: unknown) => h.listeners.get(event)!(arg);
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  __resetPushRegistrationForTesting();
  h.native = true;
  h.platform = 'ios';
  h.listeners.clear();
  h.ensureNotificationPermission.mockReset();
  h.ensureNotificationPermission.mockImplementation(async () => h.granted);
  h.granted = true;
  h.reportError.mockReset();
  h.logEvent.mockReset();
  h.register.mockReset();
  // The OS answers the registration asynchronously, as the plugin does.
  h.register.mockImplementation(async () => {
    setTimeout(() => fire('registration', { value: 'tok-1' }), 0);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('pushRegistration', () => {
  it('web: no platform, no token, never touches the plugin or the permission', async () => {
    h.native = false;
    expect(pushPlatform()).toBeNull();
    expect(await ensurePushToken()).toBeNull();
    onPushTap(() => {});
    await settle();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.ensureNotificationPermission).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
  });

  it('a granted device registers once and keeps the token; checking never prompts', async () => {
    expect(pushPlatform()).toBe('ios');
    expect(await ensurePushToken()).toBe('tok-1');
    expect(h.ensureNotificationPermission).toHaveBeenCalledWith(false);
    expect(pushToken.value).toBe('tok-1');
    expect(await ensurePushToken()).toBe('tok-1');
    expect(h.register).toHaveBeenCalledTimes(1);
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'push_token', os: 'ios' } })
    );
  });

  it('without permission: null, no register, reported once as no_permission', async () => {
    h.granted = false;
    expect(await ensurePushToken()).toBeNull();
    expect(await ensurePushToken()).toBeNull();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]![0]).toMatchObject({
      severity: 'warning',
      context: { action: 'push_token_failed', os: 'ios', detail: 'no_permission' },
    });
  });

  it('an OS refusal resolves null and is reported once as registration_error', async () => {
    h.register.mockImplementation(async () => {
      setTimeout(() => fire('registrationError', { error: 'no aps-environment' }), 0);
    });
    expect(await ensurePushToken()).toBeNull();
    reportPushTokenFailure('timeout'); // a later failure in the same process stays quiet
    expect(h.reportError).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]![0].context.detail).toBe('registration_error');
  });

  it('a rotated token reaches onTokenChanged; the first token does not', async () => {
    const changed = vi.fn();
    onTokenChanged(changed);
    await ensurePushToken();
    expect(changed).not.toHaveBeenCalled();
    fire('registration', { value: 'tok-2' });
    expect(changed).toHaveBeenCalledWith('tok-2');
    expect(pushToken.value).toBe('tok-2');
  });

  it('a tap hands over the push data', async () => {
    const tapped = vi.fn();
    onPushTap(tapped);
    await settle();
    fire('pushNotificationActionPerformed', {
      notification: { data: { kind: 'travel-change', flight: 'SQ318', date: '2026-12-13' } },
    });
    expect(tapped).toHaveBeenCalledWith({
      kind: 'travel-change',
      flight: 'SQ318',
      date: '2026-12-13',
    });
  });
});
