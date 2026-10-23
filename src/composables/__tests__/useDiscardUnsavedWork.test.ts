/**
 * The ONE "this delete would lose unsaved work" confirm (C6), and the cause it names
 * (2026-10-23): when the save run first did not land, the detail says why in one sentence,
 * and the decision event carries the cause as `error_code`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import source from '../useDiscardUnsavedWork.ts?raw';
import type { SaveProbeCause, UnsavedWorkReport } from '@/services/auth/unsavedWork';

const h = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  logEvent: vi.fn(),
}));

vi.mock('@/composables/useConfirm', () => ({ confirm: h.confirm }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));

import { confirmDiscardUnsavedWork } from '@/composables/useDiscardUnsavedWork';

const report = (over: Partial<UnsavedWorkReport> = {}): UnsavedWorkReport => ({
  unsavedFamilies: 0,
  photoUploads: 0,
  remoteBlocked: false,
  unknown: false,
  saveFailure: null,
  ...over,
});

const lastConfirm = () => (h.confirm.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];

beforeEach(() => {
  vi.clearAllMocks();
  h.confirm.mockResolvedValue(true);
});

describe('confirmDiscardUnsavedWork: the cause sentence', () => {
  it.each([
    ['auth', 'auth.unsavedCauseAuth'],
    ['transient', 'auth.unsavedCauseOffline'],
    ['timeout', 'auth.unsavedCauseTimeout'],
    ['error', 'auth.unsavedCauseError'],
    ['no-home', 'auth.unsavedCauseNoHome'],
  ] as Array<[SaveProbeCause, string]>)(
    'a %s save failure appends %s, after what goes',
    async (cause, key) => {
      await confirmDiscardUnsavedWork(
        report({ unsavedFamilies: 1, saveFailure: cause }),
        'delete-family'
      );
      expect(lastConfirm().detail).toBe(`auth.unsavedFamilies.one ${key}`);
    }
  );

  it('names no cause when the save landed or none ran', async () => {
    await confirmDiscardUnsavedWork(report({ unsavedFamilies: 1 }), 'clear-data');
    expect(lastConfirm().detail).toBe('auth.unsavedFamilies.one');
  });

  it('a failed save with nothing at risk still never asks (when the confirm shows is unchanged)', async () => {
    expect(await confirmDiscardUnsavedWork(report({ saveFailure: 'auth' }), 'clear-data')).toBe(
      true
    );
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('a blocked file is the cause: no second "the save failed" sentence beside it', async () => {
    // A remote-blocked save refuses in the merge phase and classifies `error`; the blocked
    // sentence already says why, so the cause line would say the same thing twice.
    await confirmDiscardUnsavedWork(
      report({ remoteBlocked: true, unknown: true, saveFailure: 'error' }),
      'clear-data'
    );
    expect(lastConfirm().detail).toBe('auth.unsavedBlocked auth.unsavedUnknown');
  });

  it('keeps the could-not-check sentence beside the cause when the file is readable', async () => {
    await confirmDiscardUnsavedWork(report({ unknown: true, saveFailure: 'error' }), 'clear-data');
    expect(lastConfirm().detail).toBe('auth.unsavedUnknown auth.unsavedCauseError');
  });
});

describe('confirmDiscardUnsavedWork: disconnect-google', () => {
  it('uses the disconnect copy', async () => {
    await confirmDiscardUnsavedWork(
      report({ unsavedFamilies: 1, saveFailure: 'auth' }),
      'disconnect-google'
    );
    expect(lastConfirm()).toMatchObject({
      title: 'auth.unsavedTitle',
      message: 'auth.unsavedDisconnectMessage',
      variant: 'danger',
    });
  });

  it.each([
    [true, 'unsaved_discard_confirmed'],
    [false, 'unsaved_discard_declined'],
  ])('the decision event (discard=%s) carries the cause as error_code', async (discard, action) => {
    h.confirm.mockResolvedValueOnce(discard);
    await confirmDiscardUnsavedWork(
      report({ unsavedFamilies: 1, saveFailure: 'transient' }),
      'disconnect-google'
    );
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'sign-out',
        context: expect.objectContaining({
          action,
          kind: 'disconnect-google',
          error_code: 'transient',
        }),
      })
    );
  });

  it('a decision with no cause logs no error_code', async () => {
    await confirmDiscardUnsavedWork(report({ photoUploads: 1 }), 'sign-out');
    const ctx = (
      h.logEvent.mock.calls.at(-1) as unknown as [{ context: Record<string, unknown> }]
    )[0].context;
    expect(ctx.error_code).toBeUndefined();
  });
});

describe('useDiscardUnsavedWork stays free of the stores (plan Requirement 3)', () => {
  it('imports no sync/auth store and never writes the reconnect banner', () => {
    // A second writer of `showGoogleReconnect` trips the store's `suppressed-reconnect` guard
    // and silently suppresses the critical page; the expiry chain raises the banner.
    expect(source).not.toMatch(/@\/stores\/(?!translationStore)/);
    expect(source).not.toMatch(/showGoogleReconnect(\.value)?\s*=(?!=)/);
  });
});
