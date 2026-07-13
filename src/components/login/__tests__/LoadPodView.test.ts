/**
 * LoadPodView integration tests.
 *
 * Focused on the structural changes from the May 2026 onboarding-loop fix:
 *   - Empty-state panel (NoPodEmptyState) REPLACES the storage cards when
 *     a Drive lookup returns zero .beanpod files — it does not append.
 *   - `request-create` event propagates from NoPodEmptyState's create CTA
 *     out through LoadPodView so LoginPage can route to CreatePodView.
 *   - `lastDriveCheckEmpty` flips true after an empty Drive lookup and
 *     drives the dimmed treatment + "checked, nothing found" badge on
 *     the Drive storage card when the user navigates back.
 *
 * The store/service mocks are intentionally minimal — only what the empty-
 * state branch needs. Other flows (autoLoad, decrypt modal, biometric) are
 * exercised through their own test files where appropriate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const { listFilesMock, loadFromNewFileMock, establishHomeMock, pickMock, capState } = vi.hoisted(
  () => ({
    listFilesMock: vi.fn(
      async () => [] as Array<{ fileId: string; name: string; modifiedTime: string }>
    ),
    loadFromNewFileMock: vi.fn(async () => ({ success: false, needsPassword: false })),
    establishHomeMock: vi.fn(async () => {}),
    pickMock: vi.fn(async () => ({ kind: 'cancelled' as const })),
    // Mutable capability state the tests flip per-case.
    capState: { native: false, fsa: false, localFiles: false },
  })
);

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    isGoogleDriveAvailable: true,
    pendingEncryptedFile: null,
    hasPendingEncryptedFile: false,
    fileName: null,
    error: null,
    providerAccountEmail: null,
    listGoogleDriveFiles: listFilesMock,
    // Desktop/jsdom: no redirect surface, so the gate is a no-op (returns false)
    // and the flow proceeds straight to listGoogleDriveFiles.
    beginDriveAuthRedirect: vi.fn(async () => false),
    loadFromGoogleDrive: vi.fn(),
    loadFromFile: vi.fn(),
    loadFromNewFile: loadFromNewFileMock,
    loadFromDroppedFile: vi.fn(),
    decryptPendingFile: vi.fn(),
    decryptPendingFileWithKey: vi.fn(),
    establishDurableHomeAfterLoad: establishHomeMock,
    requestPermission: vi.fn(),
    addPasskeySecret: vi.fn(),
    syncNow: vi.fn(),
    envelope: null,
    familyKey: null,
  }),
}));

vi.mock('@/services/sync/capabilities', () => ({
  supportsFileSystemAccess: () => capState.fsa,
  canUseLocalFiles: () => capState.localFiles,
  isNative: () => capState.native,
}));

vi.mock('@/composables/usePickBeanpodFile', () => ({
  usePickBeanpodFile: () => ({ pick: pickMock }),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    getCachedFamilyKey: vi.fn(() => null),
    clearCachedFamilyKey: vi.fn(),
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    currentUser: null,
    signIn: vi.fn(),
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: [],
  }),
}));

vi.mock('@/services/google/googleAuth', () => ({
  whenRedirectAuthSettled: vi.fn(async () => {}),
  getGoogleAccountEmail: () => 'gpsp2001@gmail.com',
  shouldUseRedirectAuth: () => false,
  isTokenValid: () => true,
}));

vi.mock('@/services/auth/passkeyService', () => ({
  isPlatformAuthenticatorAvailable: vi.fn(async () => false),
  hasRegisteredPasskeys: vi.fn(async () => false),
  registerPasskeyForMember: vi.fn(),
}));

vi.mock('@/config/features', () => ({
  features: { drive: true, oauthProxy: true },
}));

// Stub heavy children that aren't relevant to these structural assertions.
vi.mock('@/components/google/GoogleDriveFilePicker.vue', () => ({
  default: { template: '<div data-testid="drive-picker-stub" />' },
}));

vi.mock('@/components/ui/BeanieSpinner.vue', () => ({
  default: { template: '<div />' },
}));

vi.mock('@/components/ui/BaseButton.vue', () => ({
  default: { template: '<button><slot /></button>' },
}));

vi.mock('@/components/ui/BaseInput.vue', () => ({
  default: { template: '<input />' },
}));

import LoadPodView from '../LoadPodView.vue';

describe('LoadPodView — onboarding loop fix', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listFilesMock.mockReset();
    loadFromNewFileMock.mockReset();
    loadFromNewFileMock.mockResolvedValue({ success: false, needsPassword: false });
    establishHomeMock.mockReset();
    pickMock.mockReset();
    pickMock.mockResolvedValue({ kind: 'cancelled' });
    capState.native = false;
    capState.fsa = false;
    capState.localFiles = false;
  });

  describe('empty-state replaces storage cards', () => {
    it('renders the storage cards by default (no empty state)', () => {
      const wrapper = mount(LoadPodView);
      expect(wrapper.find('[data-testid="drive-storage-card"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="open-saved-file-aside"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="no-pod-create-cta"]').exists()).toBe(false);
    });

    it('renders NoPodEmptyState and HIDES storage cards after empty Drive lookup', async () => {
      listFilesMock.mockResolvedValueOnce([]);
      const wrapper = mount(LoadPodView);

      await wrapper.find('[data-testid="drive-storage-card"]').trigger('click');
      await flushPromises();

      // Empty state visible
      expect(wrapper.find('[data-testid="no-pod-create-cta"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="no-pod-switch-account-cta"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="no-pod-load-local-cta"]').exists()).toBe(true);

      // Storage cards GONE — this is the critical structural change. Before
      // the fix, the empty state was appended below the still-prominent
      // Drive card and users re-clicked it in a loop.
      expect(wrapper.find('[data-testid="drive-storage-card"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="open-saved-file-aside"]').exists()).toBe(false);
    });

    it('propagates account email from getGoogleAccountEmail into the empty state', async () => {
      listFilesMock.mockResolvedValueOnce([]);
      const wrapper = mount(LoadPodView);
      await wrapper.find('[data-testid="drive-storage-card"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('gpsp2001@gmail.com');
    });
  });

  describe('request-create propagation', () => {
    it("emits 'request-create' when the empty-state Create CTA is clicked", async () => {
      listFilesMock.mockResolvedValueOnce([]);
      const wrapper = mount(LoadPodView);

      await wrapper.find('[data-testid="drive-storage-card"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="no-pod-create-cta"]').trigger('click');

      expect(wrapper.emitted('request-create')).toHaveLength(1);
    });
  });

  describe('dim-card backstop', () => {
    it('shows "Checked — nothing found" badge on the Drive card if user navigates back after empty', async () => {
      listFilesMock.mockResolvedValueOnce([]);
      const wrapper = mount(LoadPodView);
      await wrapper.find('[data-testid="drive-storage-card"]').trigger('click');
      await flushPromises();

      // Empty state is showing. Simulate user clicking "Load local" which
      // closes the empty state and reveals the storage cards again.
      await wrapper.find('[data-testid="no-pod-load-local-cta"]').trigger('click');
      await flushPromises();

      // Storage cards back, Drive card now carries the "checked" badge
      // (still clickable — preserves the deliberate-retry path) instead of
      // the recommended badge.
      expect(wrapper.find('[data-testid="drive-storage-card"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="drive-checked-badge"]').exists()).toBe(true);
    });

    it('clears the dim state when a Drive lookup later returns files', async () => {
      listFilesMock.mockResolvedValueOnce([]);
      const wrapper = mount(LoadPodView);
      await wrapper.find('[data-testid="drive-storage-card"]').trigger('click');
      await flushPromises();

      // Now Drive returns files — simulate via the retry path in the empty
      // state, which calls handleDriveRetry.
      listFilesMock.mockResolvedValueOnce([
        { fileId: 'f1', name: 'family.beanpod', modifiedTime: '2026-05-18' },
      ]);
      await wrapper.find('[data-testid="no-pod-retry-hint"]').trigger('click');
      await flushPromises();

      // Empty state should close (picker would normally show; mocked above
      // as a stub).
      expect(wrapper.find('[data-testid="no-pod-create-cta"]').exists()).toBe(false);
      // Drive card back at full strength — no "checked" badge.
      expect(wrapper.find('[data-testid="drive-checked-badge"]').exists()).toBe(false);
    });
  });

  // #47 — "Load a saved family file" aside: honest gating + per-platform dispatch.
  describe('open-saved-file aside (#47)', () => {
    const aside = '[data-testid="open-saved-file-aside"]';

    it('shows the aside when the Google Picker is available even without local files', () => {
      // capState all false → canUseLocalFiles() false, but Drive is available.
      const wrapper = mount(LoadPodView);
      expect(wrapper.find(aside).exists()).toBe(true);
    });

    it('routes native clicks to the OS file picker (loadFromNewFile)', async () => {
      capState.native = true;
      const wrapper = mount(LoadPodView);

      await wrapper.find(aside).trigger('click');
      await flushPromises();

      expect(loadFromNewFileMock).toHaveBeenCalledTimes(1);
      expect(pickMock).not.toHaveBeenCalled();
    });

    it('reveals the FSA browse zone on Chromium without loading directly', async () => {
      capState.fsa = true; // supportsFileSystemAccess() → true, not native
      const wrapper = mount(LoadPodView);

      await wrapper.find(aside).trigger('click');
      await flushPromises();

      // Chromium reveals the writable drag/browse zone; it does NOT open a
      // picker or the Google Picker on the aside click itself.
      expect(loadFromNewFileMock).not.toHaveBeenCalled();
      expect(pickMock).not.toHaveBeenCalled();
    });

    it('opens the Google Picker on web without File System Access', async () => {
      // Not native, no FSA → the Firefox/Safari branch.
      const wrapper = mount(LoadPodView);

      await wrapper.find(aside).trigger('click');
      await flushPromises();

      expect(pickMock).toHaveBeenCalledTimes(1);
      expect(loadFromNewFileMock).not.toHaveBeenCalled();
    });
  });
});
