/**
 * Unit tests for the #45 family-scoped feedback settings:
 *   - settingsStore.feedbackOptOut (getter) + setFeedbackOptOut (action)
 *   - settingsStore.recordFeedbackPrompted (background cadence-clock stamp)
 *
 * Contract:
 *   - getter defaults to `false` when absent
 *   - setFeedbackOptOut persists via the repo and re-throws on failure (toggle reverts)
 *   - recordFeedbackPrompted stamps a date via the repo; on failure it reports a warning
 *     WITHOUT throwing (never breaks the notifications daemon / modal flow); no-op when
 *     the doc isn't loaded.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSetOptOut, mockSetPromptedAt, mockReportError, mockIsDocLoaded } = vi.hoisted(() => ({
  mockSetOptOut: vi.fn(async (optOut: boolean) => ({ id: 'app_settings', feedbackOptOut: optOut })),
  mockSetPromptedAt: vi.fn(async (date: string) => ({
    id: 'app_settings',
    feedbackLastPromptedAt: date,
  })),
  mockReportError: vi.fn(),
  mockIsDocLoaded: vi.fn(() => true),
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
  saveSettings: vi.fn(async (patch: Record<string, unknown>) => ({ id: 'app_settings', ...patch })),
  setFeedbackOptOut: mockSetOptOut,
  setFeedbackPromptedAt: mockSetPromptedAt,
}));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: mockIsDocLoaded }));
vi.mock('@/utils/errorReporter', () => ({ reportError: mockReportError }));

import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore feedback settings (#45)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsDocLoaded.mockReturnValue(true);
    mockSetOptOut.mockImplementation(async (optOut: boolean) => ({
      id: 'app_settings',
      feedbackOptOut: optOut,
    }));
    mockSetPromptedAt.mockImplementation(async (date: string) => ({
      id: 'app_settings',
      feedbackLastPromptedAt: date,
    }));
  });

  it('feedbackOptOut defaults to false', () => {
    expect(useSettingsStore().feedbackOptOut).toBe(false);
  });

  it('setFeedbackOptOut persists and reflects in the getter', async () => {
    const store = useSettingsStore();
    await store.setFeedbackOptOut(true);
    expect(mockSetOptOut).toHaveBeenCalledWith(true);
    expect(store.feedbackOptOut).toBe(true);
  });

  it('setFeedbackOptOut re-throws on failure so the toggle can revert', async () => {
    const failure = new Error('write failed');
    mockSetOptOut.mockRejectedValueOnce(failure);
    const store = useSettingsStore();
    await expect(store.setFeedbackOptOut(true)).rejects.toBe(failure);
    expect(store.feedbackOptOut).toBe(false);
  });

  it('recordFeedbackPrompted stamps the cadence clock via the repo', async () => {
    const store = useSettingsStore();
    await store.recordFeedbackPrompted();
    expect(mockSetPromptedAt).toHaveBeenCalledTimes(1);
    expect(typeof mockSetPromptedAt.mock.calls[0][0]).toBe('string');
  });

  it('recordFeedbackPrompted no-ops when the doc is not loaded', async () => {
    mockIsDocLoaded.mockReturnValue(false);
    await useSettingsStore().recordFeedbackPrompted();
    expect(mockSetPromptedAt).not.toHaveBeenCalled();
  });

  it('recordFeedbackPrompted reports a warning WITHOUT throwing on failure', async () => {
    mockSetPromptedAt.mockRejectedValueOnce(new Error('boom'));
    const store = useSettingsStore();
    await expect(store.recordFeedbackPrompted()).resolves.toBeUndefined();
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls[0][0]).toMatchObject({
      surface: 'feedback-record',
      severity: 'warning',
    });
  });
});
