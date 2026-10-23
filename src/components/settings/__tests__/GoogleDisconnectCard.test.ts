/**
 * GoogleDisconnectCard (2026-10-23): SAVE FIRST, THEN REVOKE. Revoking first left the
 * sign-out's own final save running against a dead grant, so a pending change became
 * permanently unsaveable. The order pinned here: danger confirm → measure (with a bounded
 * save) → the C6 confirm → explicit_revoke_used → revoke → sign out → /login. Keep cancels
 * with no side effects.
 */
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const clean = {
    unsavedFamilies: 0,
    photoUploads: 0,
    remoteBlocked: false,
    unknown: false,
    saveFailure: null as string | null,
  };
  return {
    calls,
    clean,
    report: { ...clean } as typeof clean,
    dangerConfirm: vi.fn(async () => true),
    measureUnsavedWork: vi.fn(async (_opts: unknown) => {
      calls.push('measure');
      return h.report;
    }),
    confirmDiscard: vi.fn(async (_r: unknown, _site: string) => {
      calls.push('confirm-discard');
      return true;
    }),
    emitExplicitRevokeUsed: vi.fn((..._a: unknown[]) => {
      calls.push('emit');
    }),
    disconnect: vi.fn(async () => {
      calls.push('revoke');
    }),
    signOut: vi.fn(async () => {
      calls.push('sign-out');
    }),
    replace: vi.fn(),
    reportError: vi.fn(),
    showToast: vi.fn(),
  };
});

vi.mock('vue-router', () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: h.dangerConfirm }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ measureUnsavedWork: h.measureUnsavedWork, signOut: h.signOut }),
}));
vi.mock('@/composables/useDiscardUnsavedWork', () => ({
  confirmDiscardUnsavedWork: h.confirmDiscard,
}));
// The pure predicate only; the real module pulls in the sync service.
vi.mock('@/services/auth/unsavedWork', () => ({
  hasUnsavedWork: (r: typeof h.clean) =>
    r.unsavedFamilies > 0 || r.photoUploads > 0 || r.remoteBlocked || r.unknown,
}));
vi.mock('@/services/google/googleAuth', () => ({ disconnectGoogleEverywhere: h.disconnect }));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitExplicitRevokeUsed: h.emitExplicitRevokeUsed,
}));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));

import GoogleDisconnectCard from '../GoogleDisconnectCard.vue';

const stubs = {
  BaseCard: { template: '<div><slot /></div>' },
  BaseButton: { template: '<button><slot /></button>' },
};

async function clickDisconnect() {
  const wrapper = mount(GoogleDisconnectCard, { global: { stubs } });
  await wrapper.find('button').trigger('click');
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.length = 0;
  h.report = { ...h.clean };
  h.dangerConfirm.mockResolvedValue(true);
  h.confirmDiscard.mockImplementation(async () => {
    h.calls.push('confirm-discard');
    return true;
  });
});

describe('GoogleDisconnectCard: save first, then revoke', () => {
  it('a clean device: measure (with save) → confirm → emit clean → revoke → sign out', async () => {
    await clickDisconnect();

    expect(h.measureUnsavedWork).toHaveBeenCalledWith({ save: true, scope: 'active' });
    expect(h.confirmDiscard).toHaveBeenCalledWith(h.report, 'disconnect-google');
    expect(h.calls).toEqual(['measure', 'confirm-discard', 'emit', 'revoke', 'sign-out']);
    expect(h.emitExplicitRevokeUsed).toHaveBeenCalledWith('clean', undefined);
    expect(h.replace).toHaveBeenCalledWith('/login');
  });

  it('Keep cancels the disconnect: no revoke, no sign-out, no revoke event', async () => {
    h.report = { ...h.clean, unsavedFamilies: 1, saveFailure: 'auth' };
    h.confirmDiscard.mockImplementation(async () => {
      h.calls.push('confirm-discard');
      return false;
    });

    const wrapper = await clickDisconnect();

    expect(h.calls).toEqual(['measure', 'confirm-discard']);
    expect(h.disconnect).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.emitExplicitRevokeUsed).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
    // The button is usable again.
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
  });

  it('an explicit Discard revokes, and the event says so with the save-failure cause', async () => {
    h.report = { ...h.clean, unsavedFamilies: 1, saveFailure: 'transient' };

    await clickDisconnect();

    expect(h.calls).toEqual(['measure', 'confirm-discard', 'emit', 'revoke', 'sign-out']);
    expect(h.emitExplicitRevokeUsed).toHaveBeenCalledWith('discarded', 'transient');
  });

  it('declining the danger confirm measures nothing and revokes nothing', async () => {
    h.dangerConfirm.mockResolvedValueOnce(false);

    await clickDisconnect();

    expect(h.calls).toEqual([]);
  });

  it('a revoke failure is reported and toasted, as before', async () => {
    h.disconnect.mockRejectedValueOnce(new Error('revoke 500'));

    await clickDisconnect();

    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'login-flow',
        context: { action: 'explicit_revoke_failed' },
      })
    );
    expect(h.showToast).toHaveBeenCalledWith('error', 'googleDrive.reconnectFailed');
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
