import { describe, it, expect } from 'vitest';
import { connectFailureToast } from '../connectFailureToast';

// A `t` that shows the template, so the filled-in email is visible to the assertion.
const t = (key: string): string =>
  key === 'calendarSync.toast.accountMismatch.message' ? 'connected to {account}' : key;
const EMAIL = 'grandma@example.com';

describe('connectFailureToast (review F5)', () => {
  it.each(['sync', 'view'] as const)(
    'a %s account mismatch shows the stored email in the template, always silent',
    (kind) => {
      const toast = connectFailureToast(kind, { code: 'account_mismatch', message: EMAIL }, t);
      expect(toast).toEqual({
        title: 'calendarSync.toast.accountMismatch.title',
        message: `connected to ${EMAIL}`,
        silent: true,
      });
    }
  );

  it.each(['sync', 'view'] as const)('%s: nothing to say for cancelled or unexpected', (kind) => {
    expect(connectFailureToast(kind, { code: 'cancelled', message: '' }, t)).toBeNull();
    expect(connectFailureToast(kind, { code: 'unexpected', message: '' }, t)).toBeNull();
  });

  it('never shows a raw message (hard-coded English from calendarAuth)', () => {
    for (const code of [
      'exchange_failed',
      'no_refresh_token',
      'not_configured',
      'popup_blocked',
      'missing_scope',
    ]) {
      for (const kind of ['sync', 'view'] as const) {
        const toast = connectFailureToast(kind, { code, message: 'RAW ENGLISH' }, t)!;
        expect(toast.message).not.toContain('RAW ENGLISH');
      }
    }
  });

  it('maps each kind to its own copy', () => {
    expect(connectFailureToast('view', { code: 'missing_scope', message: '' }, t)!.message).toBe(
      'calendarSync.connect.viewMissingScope'
    );
    expect(connectFailureToast('sync', { code: 'missing_scope', message: '' }, t)!.message).toBe(
      'calendarSync.connect.syncMissingScope'
    );
    expect(connectFailureToast('view', { code: 'exchange_failed', message: '' }, t)).toEqual({
      title: 'calendarView.toast.connectFailed.title',
      message: 'calendarView.toast.connectFailed.message',
      silent: true,
    });
    expect(connectFailureToast('sync', { code: 'exchange_failed', message: '' }, t)).toEqual({
      title: 'calendarSync.toast.connectFailed.title',
      message: 'calendar.error.connectRetry',
      silent: false,
    });
    expect(connectFailureToast('sync', { code: 'popup_blocked', message: '' }, t)).toMatchObject({
      message: 'calendar.error.popupBlocked',
      silent: true,
    });
  });
});
