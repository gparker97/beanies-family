/**
 * usePassphraseNudge (ADR-041, #81): a legacy-shaped passphrase unlock arms a module flag;
 * the next member to sign in gets `pending` persisted and ONE toast, and the flag is spent.
 * Runs the real per-member localStorage spine against a reactive member id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick, reactive, type EffectScope } from 'vue';

const h = vi.hoisted(() => ({
  showToast: vi.fn(),
  logEvent: vi.fn(),
  reportError: vi.fn(),
  push: vi.fn(async () => {}),
}));

// Reactive so the store's member watch and the trigger fire as in the app.
const family = reactive({ currentMemberId: null as string | null });

vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => family }));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/router', () => ({ default: { push: h.push } }));

import {
  __resetPassphraseNudgeForTesting,
  armLegacyPassphraseSignal,
  usePassphraseNudge,
} from '@/composables/usePassphraseNudge';
import { SECURITY_OPEN } from '@/constants/settingsDeepLinks';

const KEY = (id: string) => `bean-passphrase-nudge-${id}`;

let scope: EffectScope;
function mountNudge() {
  return scope.run(() => usePassphraseNudge())!;
}
const nudgeRows = () =>
  h.logEvent.mock.calls
    .map((c) => c[0] as { surface: string; message: string; context: { action: string } })
    .filter((e) => e.surface === 'passphrase-nudge')
    .map((e) => e.context.action);

async function signIn(id: string | null) {
  family.currentMemberId = id;
  await nextTick();
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  __resetPassphraseNudgeForTesting();
  scope = effectScope(true);
  // Every case starts signed out, so the singleton holds no member's state.
  mountNudge();
  await signIn(null);
});
afterEach(() => scope.stop());

describe('usePassphraseNudge', () => {
  it('armed → a member signs in → pending, one toast, and the arm is spent', async () => {
    const nudge = mountNudge();
    armLegacyPassphraseSignal();
    await signIn('m1');

    expect(nudge.isPending.value).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY('m1'))!)).toEqual({
      schemaVersion: 1,
      status: 'pending',
    });
    expect(h.showToast).toHaveBeenCalledTimes(1);
    expect(h.showToast).toHaveBeenCalledWith(
      'info',
      'recovery.passphraseLegacyNudge',
      undefined,
      expect.objectContaining({ actionLabel: 'recovery.passphraseLegacyNudgeAction' })
    );
    expect(nudgeRows()).toEqual(['armed', 'shown']);

    // A second member on the same process is not nudged for the first member's unlock.
    await signIn('m2');
    expect(h.showToast).toHaveBeenCalledTimes(1);
    expect(nudge.isPending.value).toBe(false);
  });

  it('the toast action opens Settings on the Security drawer', async () => {
    mountNudge();
    armLegacyPassphraseSignal();
    await signIn('m1');
    const { actionFn } = h.showToast.mock.calls[0][3] as { actionFn: () => void };
    actionFn();
    await vi.waitFor(() =>
      expect(h.push).toHaveBeenCalledWith({ path: '/settings', query: { open: SECURITY_OPEN } })
    );
  });

  it('a failed navigation is reported, not swallowed', async () => {
    h.push.mockRejectedValueOnce(new Error('aborted'));
    mountNudge();
    armLegacyPassphraseSignal();
    await signIn('m1');
    (h.showToast.mock.calls[0][3] as { actionFn: () => void }).actionFn();
    await vi.waitFor(() =>
      expect(h.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'passphrase-nudge', severity: 'warning' })
      )
    );
  });

  it('not armed → a sign-in does nothing', async () => {
    const nudge = mountNudge();
    await signIn('m1');
    expect(h.showToast).not.toHaveBeenCalled();
    expect(nudge.isPending.value).toBe(false);
    expect(localStorage.getItem(KEY('m1'))).toBeNull();
  });

  it('a dismissed member stays dismissed: no toast, no pending', async () => {
    localStorage.setItem(KEY('m1'), JSON.stringify({ schemaVersion: 1, status: 'dismissed' }));
    const nudge = mountNudge();
    armLegacyPassphraseSignal();
    await signIn('m1');
    expect(h.showToast).not.toHaveBeenCalled();
    expect(nudge.isPending.value).toBe(false);
  });

  it('dismiss persists dismissed and hides the hint', async () => {
    const nudge = mountNudge();
    armLegacyPassphraseSignal();
    await signIn('m1');
    nudge.dismiss();
    expect(nudge.isPending.value).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY('m1'))!).status).toBe('dismissed');
    expect(nudgeRows()).toContain('dismissed');
  });

  it('resolve clears a pending nudge, and is a no-op otherwise', async () => {
    const nudge = mountNudge();
    nudge.resolve();
    expect(nudgeRows()).not.toContain('resolved');

    armLegacyPassphraseSignal();
    await signIn('m1');
    nudge.resolve();
    expect(nudge.isPending.value).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY('m1'))!).status).toBe('none');
    expect(nudgeRows()).toEqual(['armed', 'shown', 'resolved']);
  });

  it('a pending nudge survives a reload for that member', async () => {
    localStorage.setItem(KEY('m1'), JSON.stringify({ schemaVersion: 1, status: 'pending' }));
    const nudge = mountNudge();
    await signIn('m1');
    expect(nudge.isPending.value).toBe(true);
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('sign-out clears an unspent arm', async () => {
    mountNudge();
    await signIn('m1');
    armLegacyPassphraseSignal();
    await signIn(null);
    await signIn('m2');
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('two mounts (App + Settings) still show one toast', async () => {
    mountNudge();
    mountNudge();
    armLegacyPassphraseSignal();
    await signIn('m1');
    expect(h.showToast).toHaveBeenCalledTimes(1);
  });
});
