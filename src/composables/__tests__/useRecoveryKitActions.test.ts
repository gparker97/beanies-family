/**
 * useRecoveryKitActions (tracker #99): authorization → confirm → step-up → store → toast.
 *   - a non-manager is refused before the confirm, the gate, or the store;
 *   - cancelling the confirm never shows the PIN gate; a failed gate never reaches the store;
 *   - one outcome → toast mapping serves both Invalidate and Replace.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const h = vi.hoisted(() => ({
  canManagePod: { value: true },
  confirm: vi.fn(async () => true),
  alert: vi.fn(async () => true),
  requireReauth: vi.fn(async () => true),
  invalidateRecoveryKit: vi.fn(),
  showToast: vi.fn(),
  emitKitInvalidateOutcome: vi.fn(),
}));

vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canManagePod: h.canManagePod }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: h.confirm, alert: h.alert }));
vi.mock('@/composables/useReauth', () => ({ requireReauth: h.requireReauth }));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ invalidateRecoveryKit: h.invalidateRecoveryKit }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitKitInvalidateOutcome: h.emitKitInvalidateOutcome,
}));

import {
  approveReplace,
  invalidateKit,
  toastKitInvalidateOutcome,
} from '@/composables/useRecoveryKitActions';

const kit = { kitId: 'abcd1234', status: 'live' as const, createdAt: '2026-09-01T00:00:00Z' };

beforeEach(() => {
  vi.clearAllMocks();
  h.canManagePod.value = true;
  h.confirm.mockResolvedValue(true);
  h.requireReauth.mockResolvedValue(true);
  h.invalidateRecoveryKit.mockResolvedValue({ invalidated: true, save: 'saved', liveRemaining: 1 });
  void ref;
});

describe('invalidateKit', () => {
  it('refuses a non-manager before confirm, gate or store, and records it', async () => {
    h.canManagePod.value = false;
    expect(await invalidateKit(kit)).toBe(false);
    expect(h.alert).toHaveBeenCalledWith({
      title: 'confirm.notAllowedTitle',
      message: 'settings.adminOnly',
    });
    expect(h.emitKitInvalidateOutcome).toHaveBeenCalledWith({
      outcome: 'refused',
      kind: 'invalidate',
      errorCode: 'not_authorized',
    });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.requireReauth).not.toHaveBeenCalled();
    expect(h.invalidateRecoveryKit).not.toHaveBeenCalled();
  });

  it('cancelling the confirm never shows the PIN gate', async () => {
    h.confirm.mockResolvedValueOnce(false);
    expect(await invalidateKit(kit)).toBe(false);
    expect(h.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'danger',
        detailTone: 'caution',
        detail: 'recovery.kitInvalidateLimit',
      })
    );
    expect(h.requireReauth).not.toHaveBeenCalled();
    expect(h.invalidateRecoveryKit).not.toHaveBeenCalled();
  });

  it('a failed step-up never reaches the store', async () => {
    h.requireReauth.mockResolvedValueOnce(false);
    expect(await invalidateKit(kit)).toBe(false);
    expect(h.invalidateRecoveryKit).not.toHaveBeenCalled();
  });

  it('happy path: store called with kind invalidate, success toast', async () => {
    expect(await invalidateKit(kit)).toBe(true);
    expect(h.invalidateRecoveryKit).toHaveBeenCalledWith('abcd1234', { kind: 'invalidate' });
    expect(h.showToast).toHaveBeenCalledWith('success', 'recovery.kitInvalidated');
  });
});

describe('approveReplace', () => {
  it('gates, confirms with the info variant, then steps up; never touches the store', async () => {
    expect(await approveReplace(kit)).toBe(true);
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'info' }));
    expect(h.requireReauth).toHaveBeenCalled();
    expect(h.invalidateRecoveryKit).not.toHaveBeenCalled();
  });

  it('refuses a non-manager with kind replace', async () => {
    h.canManagePod.value = false;
    expect(await approveReplace(kit)).toBe(false);
    expect(h.emitKitInvalidateOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'replace', errorCode: 'not_authorized' })
    );
  });
});

describe('toastKitInvalidateOutcome', () => {
  it('maps every outcome to the right toast', () => {
    toastKitInvalidateOutcome({ invalidated: true, save: 'saved', liveRemaining: 2 });
    expect(h.showToast).toHaveBeenLastCalledWith('success', 'recovery.kitInvalidated');

    toastKitInvalidateOutcome({ invalidated: true, save: 'timeout', liveRemaining: 2 });
    expect(h.showToast).toHaveBeenLastCalledWith('info', 'recovery.kitInvalidateNotSynced');

    toastKitInvalidateOutcome({ invalidated: false, refusal: 'last_kit' });
    expect(h.showToast).toHaveBeenLastCalledWith('error', 'recovery.kitLastKit');

    toastKitInvalidateOutcome({ invalidated: false, refusal: 'no_envelope' });
    expect(h.showToast).toHaveBeenLastCalledWith('error', 'recovery.podNotOpen');

    toastKitInvalidateOutcome({ invalidated: false, refusal: 'error' });
    expect(h.showToast).toHaveBeenLastCalledWith(
      'error',
      'recovery.kitInvalidateFailed',
      undefined,
      { surface: 'recovery-kits', silent: true }
    );
  });
});
