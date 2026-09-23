/**
 * The shared sign-out renderers (2026-09-23): SignOutHost switches on `useSignOut`'s phase,
 * SignOutConfirm carries the trust tick and its live hint, SignOutKitGuard gets a fresh
 * kit flow per mount, and the trust question sits on the 'top' layer (above the wizard)
 * while the kit prompts stay 'base'.
 */
import { mount, config } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reactive, nextTick } from 'vue';

const h = vi.hoisted(() => ({
  auth: null as unknown as { isAuthenticated: boolean; createRecoveryKit: unknown },
  settings: { isTrustedDevice: true },
  createRecoveryKit: vi.fn(),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/stores/authStore', () => ({
  // The reactive object itself, so SignOutHost's `isAuthenticated` watcher can see changes.
  useAuthStore: () => h.auth,
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    ...h.settings,
    markRecoveryKitConfirmed: vi.fn(async () => {}),
  }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ syncNowBounded: vi.fn(async () => true) }),
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => false }));
vi.mock('@/utils/qrCode', () => ({ renderQr: vi.fn(async () => ({ dataUrl: 'data:,' })) }));
vi.mock('@/composables/useSheetExport', () => ({
  useSheetExport: () => ({ exportElementToPng: vi.fn(), pngBlobToPdf: vi.fn() }),
  prewarmSheetExport: vi.fn(),
  ExportError: class extends Error {},
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyName: 'Fam' }),
}));

const signOutState = vi.hoisted(() => ({
  phase: { value: 'idle' as string },
  abandonSignOut: vi.fn(),
  resolveKitGuard: vi.fn(),
  signOut: vi.fn(),
  cancelSignOut: vi.fn(),
}));
vi.mock('@/composables/useSignOut', async () => {
  const { ref } = await import('vue');
  const phase = ref('idle');
  signOutState.phase = phase;
  return {
    useSignOut: () => ({
      phase,
      signOut: signOutState.signOut,
      cancelSignOut: signOutState.cancelSignOut,
    }),
    useSignOutHost: () => ({
      phase,
      abandonSignOut: signOutState.abandonSignOut,
      resolveKitGuard: signOutState.resolveKitGuard,
    }),
  };
});

import SignOutHost from '../SignOutHost.vue';
import SignOutConfirm from '../SignOutConfirm.vue';
import SignOutKitGuard from '../SignOutKitGuard.vue';
import TrustDeviceModal from '@/components/common/TrustDeviceModal.vue';

config.global.stubs = { ...config.global.stubs, Teleport: true, BaseModal: false };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth = reactive({ isAuthenticated: true, createRecoveryKit: h.createRecoveryKit });
  h.settings.isTrustedDevice = true;
  signOutState.phase.value = 'idle';
  h.createRecoveryKit.mockResolvedValue({ success: false, error: 'pod not open' });
});

describe('SignOutHost', () => {
  it('renders exactly one child per phase, and the overlay only while signing out', async () => {
    const wrapper = mount(SignOutHost);
    expect(wrapper.find('[data-testid="signout-confirm"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="signout-progress"]').exists()).toBe(false);

    signOutState.phase.value = 'confirm';
    await nextTick();
    expect(wrapper.find('[data-testid="signout-confirm"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="kit-guard-primary"]').exists()).toBe(false);

    signOutState.phase.value = 'guard';
    await nextTick();
    expect(wrapper.find('[data-testid="signout-confirm"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="kit-guard-primary"]').exists()).toBe(true);

    signOutState.phase.value = 'signing-out';
    await nextTick();
    expect(wrapper.find('[data-testid="kit-guard-primary"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="signout-progress"]').exists()).toBe(true);
  });

  it('abandons an open confirm or guard when the session ends underneath it', async () => {
    mount(SignOutHost);
    h.auth.isAuthenticated = false;
    await nextTick();
    expect(signOutState.abandonSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('SignOutConfirm', () => {
  it('the tick starts from the device trust, and the hint follows it live', async () => {
    const wrapper = mount(SignOutConfirm);
    const tickBox = wrapper.find('[data-testid="signout-trust-tick"]');
    expect((tickBox.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-testid="signout-trust-hint"]').text()).toBe(
      'auth.signOutConfirmHint'
    );
    await tickBox.setValue(false);
    expect(wrapper.find('[data-testid="signout-trust-hint"]').text()).toBe(
      'auth.signOutConfirmHintUntrusted'
    );
  });

  it('starts unticked on an untrusted device, and passes the tick to signOut', async () => {
    h.settings.isTrustedDevice = false;
    const wrapper = mount(SignOutConfirm);
    expect(
      (wrapper.find('[data-testid="signout-trust-tick"]').element as HTMLInputElement).checked
    ).toBe(false);
    await wrapper.find('[data-testid="signout-confirm"]').trigger('click');
    expect(signOutState.signOut).toHaveBeenCalledWith('sign-out', { trust: false });
    await wrapper.find('[data-testid="signout-clear-data"]').trigger('click');
    expect(signOutState.signOut).toHaveBeenCalledWith('clear', { trust: false });
  });
});

describe('SignOutKitGuard', () => {
  it('a remount starts with a fresh flow (no stale error)', async () => {
    const first = mount(SignOutKitGuard);
    await first.find('[data-testid="kit-guard-primary"]').trigger('click');
    await nextTick();
    await nextTick();
    expect(first.text()).toContain('pod not open');
    first.unmount();
    const second = mount(SignOutKitGuard);
    expect(second.text()).not.toContain('pod not open');
  });

  it('"Sign out anyway" resolves the guard as sign_out_anyway', async () => {
    const wrapper = mount(SignOutKitGuard);
    await wrapper.find('[data-testid="kit-guard-sign-out-anyway"]').trigger('click');
    expect(signOutState.resolveKitGuard).toHaveBeenCalledWith('sign_out_anyway');
  });
});

describe('prompt layers', () => {
  it('the trust question renders on the top layer (above the onboarding wizard)', () => {
    const wrapper = mount(TrustDeviceModal, { props: { open: true } });
    expect(wrapper.html()).toContain('z-[250]');
  });

  it('the kit guard stays on the base layer (its unclosable kit display is base too)', () => {
    const wrapper = mount(SignOutKitGuard);
    expect(wrapper.html()).not.toContain('z-[250]');
  });
});

describe('App.vue trust answers', () => {
  // Source-level pin: both answers latch the sign-in so no other auth nag follows the
  // trust question in the same sign-in, and both go through the shared trust action.
  const app = readFileSync(resolve(__dirname, '../../../App.vue'), 'utf8');
  const body = (name: string) => {
    const start = app.indexOf(`async function ${name}()`);
    return app.slice(start, app.indexOf('\n}\n', start));
  };
  it.each(['handleTrustDevice', 'handleDeclineTrust'])(
    '%s latches and uses setDeviceTrust',
    (fn) => {
      const code = body(fn);
      expect(code).toContain('authPromptDeclinedThisSignIn.value = true');
      expect(code).toContain('authStore.setDeviceTrust(');
    }
  );
});
