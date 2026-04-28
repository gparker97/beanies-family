import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, type Ref } from 'vue';
import type { InviteFlowError } from '@/composables/useInviteFlow';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockShowToast = vi.fn();
const mockShareDriveAccess = vi.fn();
const mockRegenerateLinkForEmail = vi.fn();
const mockClearError = vi.fn();
const mockInviteFlowError: Ref<InviteFlowError | null> = ref(null);
const mockInviteLink = ref('');

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, isBeanieMode: ref(false) }),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock('@/composables/useInviteFlow', () => ({
  useInviteFlow: () => ({
    inviteLink: mockInviteLink,
    inviteQrUrl: ref(''),
    error: mockInviteFlowError,
    isGenerating: ref(false),
    lastSharedEmail: ref(null),
    shareDriveAccess: mockShareDriveAccess,
    regenerateLinkForEmail: mockRegenerateLinkForEmail,
    clearError: mockClearError,
    reset: vi.fn(),
  }),
}));

// Mutable per-test state — reset in beforeEach.
let mockStorageProvider: 'google_drive' | 'local' | null = 'google_drive';
let mockFamilyKey: object | null = {} as object;
let mockHumans: Array<{
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  color: string;
  avatar: string;
}> = [];
const ownerId = 'owner-1';

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get storageProviderType() {
      return mockStorageProvider;
    },
    get familyKey() {
      return mockFamilyKey;
    },
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    owner: { id: ownerId },
    get humans() {
      return mockHumans;
    },
  }),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyName: ref('Test Family'),
  }),
}));

// Stub heavy children — we don't render them to focus on the panel.
vi.mock('@/components/ui/BeanieAvatar.vue', () => ({
  default: { name: 'BeanieAvatar', template: '<span class="stub-avatar" />' },
}));
vi.mock('@/components/family/ShareInviteModal.vue', () => ({
  default: {
    name: 'ShareInviteModal',
    props: ['open', 'link', 'familyName', 'memberName'],
    template:
      '<div v-if="open" class="stub-share-modal" :data-link="link" :data-member="memberName" />',
  },
}));

// ── Tests ───────────────────────────────────────────────────────────────────

import OnboardingInvitePanel from '../OnboardingInvitePanel.vue';

function makeMember(overrides: Partial<(typeof mockHumans)[0]> = {}) {
  return {
    id: 'm1',
    name: 'Sarah',
    email: 'sarah@beanpod.org',
    role: 'member' as const,
    color: '#3b82f6',
    avatar: 'classic',
    ...overrides,
  };
}

describe('OnboardingInvitePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageProvider = 'google_drive';
    mockFamilyKey = {} as object;
    mockHumans = [
      {
        id: ownerId,
        name: 'Owner',
        email: 'owner@x.com',
        role: 'owner',
        color: '#000',
        avatar: 'classic',
      },
    ];
    mockInviteFlowError.value = null;
    mockInviteLink.value = '';
    mockShareDriveAccess.mockResolvedValue(true);
    mockRegenerateLinkForEmail.mockResolvedValue(true);
  });

  // ── Visibility gate (5 cases) ──────────────────────────────────────────

  it('hides when storage = local', () => {
    mockStorageProvider = 'local';
    mockHumans.push(makeMember());
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('hides when only owner exists', () => {
    // mockHumans already has just the owner
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('hides when all non-owner members have unshareable emails', () => {
    mockHumans.push(makeMember({ id: 'm2', email: 'pending-x@setup.local' }));
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('hides when familyKey is null', () => {
    mockFamilyKey = null;
    mockHumans.push(makeMember());
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('renders one row per shareable non-owner when all conditions are met', () => {
    mockHumans.push(makeMember({ id: 'm1', email: 'sarah@beanpod.org' }));
    mockHumans.push(makeMember({ id: 'm2', name: 'Liam', email: 'liam@beanpod.org' }));
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="onboarding-invite-send-m1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="onboarding-invite-send-m2"]').exists()).toBe(true);
  });

  // ── Per-row rendering (5 cases) ────────────────────────────────────────

  it('shows "no email — skip" hint for members without shareable email', () => {
    // Add a real member so the panel renders, plus a temp-email member
    mockHumans.push(makeMember({ id: 'm1', email: 'real@beanpod.org' }));
    mockHumans.push(makeMember({ id: 'm2', name: 'Emma', email: 'pending-emma@setup.local' }));
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.text()).toContain('onboarding.invite.noEmail');
    // Emma should not have a Send button
    expect(wrapper.find('[data-testid="onboarding-invite-send-m2"]').exists()).toBe(false);
  });

  it('shows Send button enabled in idle state', () => {
    mockHumans.push(makeMember());
    const wrapper = mount(OnboardingInvitePanel);
    const button = wrapper.find('[data-testid="onboarding-invite-send-m1"]');
    expect(button.exists()).toBe(true);
    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.text()).toBe('onboarding.invite.send');
  });

  it('disables Send button while another row is sending (single-flight)', async () => {
    mockHumans.push(makeMember({ id: 'm1', email: 'a@beanpod.org' }));
    mockHumans.push(makeMember({ id: 'm2', name: 'B', email: 'b@beanpod.org' }));
    // Make shareDriveAccess hang so the row stays in 'sending'
    let resolveShare!: (v: boolean) => void;
    mockShareDriveAccess.mockReturnValueOnce(new Promise((r) => (resolveShare = r)));

    const wrapper = mount(OnboardingInvitePanel);
    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');

    // Other row's button is disabled while m1 is in flight
    expect(
      wrapper.find('[data-testid="onboarding-invite-send-m2"]').attributes('disabled')
    ).toBeDefined();

    resolveShare(true); // unblock
  });

  it('shows ✓ Sent badge after successful send', async () => {
    mockHumans.push(makeMember());
    const wrapper = mount(OnboardingInvitePanel);

    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.text()).toContain('onboarding.invite.sent');
  });

  it('shows error message + recovery action button when send fails', async () => {
    mockShareDriveAccess.mockResolvedValueOnce(false);
    mockInviteFlowError.value = {
      code: 'invalid-google-email',
      message: 'That email is not a Google account',
      recovery: 'edit-email',
    };
    mockHumans.push(makeMember());

    const wrapper = mount(OnboardingInvitePanel);
    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.text()).toContain('That email is not a Google account');
    // 'edit-email' recovery surfaces the editEmail label
    expect(wrapper.text()).toContain('onboarding.invite.editEmail');
  });

  // ── Send-flow state transitions (5 cases) ──────────────────────────────

  it('successful send: idle → sent + opens ShareInviteModal with link + memberName', async () => {
    mockInviteLink.value = 'https://invite/abc';
    mockHumans.push(makeMember({ name: 'Sarah' }));

    const wrapper = mount(OnboardingInvitePanel);
    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockShareDriveAccess).toHaveBeenCalledWith('sarah@beanpod.org');
    expect(mockRegenerateLinkForEmail).toHaveBeenCalledWith('sarah@beanpod.org');
    const stubModal = wrapper.find('.stub-share-modal');
    expect(stubModal.exists()).toBe(true);
    expect(stubModal.attributes('data-link')).toBe('https://invite/abc');
    expect(stubModal.attributes('data-member')).toBe('Sarah');
  });

  it('drive-share failure: state → error, retry button rendered, showToast called with onboarding-invite-row surface', async () => {
    mockShareDriveAccess.mockResolvedValueOnce(false);
    mockInviteFlowError.value = {
      code: 'drive-share-failed',
      message: 'Drive permission denied',
      recovery: 'retry',
    };
    mockHumans.push(makeMember());

    const wrapper = mount(OnboardingInvitePanel);
    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.text()).toContain('onboarding.invite.retry');
    expect(mockShowToast).toHaveBeenCalledWith(
      'error',
      'onboarding.errors.inviteFailed',
      undefined,
      expect.objectContaining({ surface: 'onboarding-invite-row' })
    );
  });

  it('regenerate-link rejection: catch path fires, showToast invoked', async () => {
    mockRegenerateLinkForEmail.mockRejectedValueOnce(new Error('network'));
    mockHumans.push(makeMember());

    const wrapper = mount(OnboardingInvitePanel);
    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockShowToast).toHaveBeenCalledWith(
      'error',
      'onboarding.errors.inviteFailed',
      undefined,
      expect.objectContaining({ surface: 'onboarding-invite-row' })
    );
  });

  it('two simultaneous clicks: second is no-op while first is in flight', async () => {
    let resolveShare!: (v: boolean) => void;
    mockShareDriveAccess.mockReturnValueOnce(new Promise((r) => (resolveShare = r)));

    mockHumans.push(makeMember({ id: 'm1', email: 'a@beanpod.org' }));
    mockHumans.push(makeMember({ id: 'm2', name: 'B', email: 'b@beanpod.org' }));

    const wrapper = mount(OnboardingInvitePanel);
    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');
    // While m1 is in flight, click m2's send (UI also disables it but call should be a no-op)
    await wrapper.find('[data-testid="onboarding-invite-send-m2"]').trigger('click');

    // shareDriveAccess called only for m1, not m2
    expect(mockShareDriveAccess).toHaveBeenCalledTimes(1);
    expect(mockShareDriveAccess).toHaveBeenCalledWith('a@beanpod.org');

    resolveShare(true);
    await new Promise((r) => setTimeout(r, 0));
  });

  it('retry after error: clearError called, send re-attempts', async () => {
    mockShareDriveAccess.mockResolvedValueOnce(false);
    mockInviteFlowError.value = {
      code: 'drive-share-failed',
      message: 'first attempt failed',
      recovery: 'retry',
    };
    mockHumans.push(makeMember());

    const wrapper = mount(OnboardingInvitePanel);
    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    // First attempt: clearError called
    expect(mockClearError).toHaveBeenCalledTimes(1);

    // Now retry — second attempt succeeds
    mockShareDriveAccess.mockResolvedValueOnce(true);
    mockInviteFlowError.value = null;
    const retryButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('onboarding.invite.retry'));
    expect(retryButton).toBeTruthy();
    await retryButton!.trigger('click');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockClearError).toHaveBeenCalledTimes(2);
    expect(mockShareDriveAccess).toHaveBeenCalledTimes(2);
  });
});
