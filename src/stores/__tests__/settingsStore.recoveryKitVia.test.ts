/**
 * settingsStore.markRecoveryKitConfirmed(via) — how the recovery kit was confirmed
 * (2026-09-23). The sign-out kit guard keys on `recoveryKitConfirmedVia`, so:
 *   - `saved` and `acknowledged` are both recorded with the timestamp;
 *   - a `saved` stamp is NEVER downgraded by a later tick-only confirm (kits accumulate,
 *     so the earlier saved kit still opens the pod);
 *   - a failed stamp reports (with `kind: via`) and never throws.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSaveSettings, mockReportError } = vi.hoisted(() => ({
  mockSaveSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'app_settings',
    ...patch,
  })),
  mockReportError: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
  useToast: () => ({ toasts: [], dismissToast: vi.fn() }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ id: 'global_settings', theme: 'light', language: 'en' }),
  getGlobalSettings: vi.fn(async () => ({ id: 'global_settings', theme: 'light', language: 'en' })),
  saveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'global_settings',
    ...patch,
  })),
}));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', language: 'en', theme: 'light' })),
  saveSettings: mockSaveSettings,
}));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: () => true }));
vi.mock('@/utils/errorReporter', () => ({ reportError: mockReportError }));

import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore.markRecoveryKitConfirmed(via)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('records the timestamp and `saved`', async () => {
    const store = useSettingsStore();
    await store.markRecoveryKitConfirmed('saved');
    const patch = mockSaveSettings.mock.calls[0]![0];
    expect(patch.recoveryKitConfirmedVia).toBe('saved');
    expect(typeof patch.recoveryKitConfirmedAt).toBe('string');
  });

  it('records `acknowledged` for a tick-only confirm on a family with no prior stamp', async () => {
    const store = useSettingsStore();
    await store.markRecoveryKitConfirmed('acknowledged');
    expect(mockSaveSettings.mock.calls[0]![0].recoveryKitConfirmedVia).toBe('acknowledged');
  });

  it('never downgrades `saved` to `acknowledged` (kits accumulate)', async () => {
    const store = useSettingsStore();
    await store.markRecoveryKitConfirmed('saved');
    await store.markRecoveryKitConfirmed('acknowledged');
    expect(mockSaveSettings.mock.calls[1]![0].recoveryKitConfirmedVia).toBe('saved');
    expect(store.settings.recoveryKitConfirmedVia).toBe('saved');
  });

  it('a failed stamp reports with `kind: via` and does not throw', async () => {
    mockSaveSettings.mockRejectedValueOnce(new Error('doc write failed'));
    const store = useSettingsStore();
    await expect(store.markRecoveryKitConfirmed('saved')).resolves.toBeUndefined();
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { action: 'kit_confirm_stamp_failed', kind: 'saved' },
      })
    );
  });
});
