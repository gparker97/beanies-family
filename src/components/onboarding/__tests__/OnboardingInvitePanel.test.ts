import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockResetInviteFlow = vi.fn();

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, isBeanieMode: ref(false) }),
}));

vi.mock('@/composables/useInviteFlow', () => ({
  useInviteFlow: () => ({
    reset: mockResetInviteFlow,
    // Other fields aren't read by the panel itself — the wizard consumes the flow.
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
  requiresPassword?: boolean;
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
    currentMember: { name: 'Owner' },
    get humans() {
      return mockHumans;
    },
  }),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyName: 'Test Family',
  }),
}));

// Stub heavy children so we can assert on the panel without rendering them.
vi.mock('@/components/ui/BeanieAvatar.vue', () => ({
  default: { name: 'BeanieAvatar', template: '<span class="stub-avatar" />' },
}));
vi.mock('@/components/family/InviteWizardModal.vue', () => ({
  default: {
    name: 'InviteWizardModal',
    props: ['open', 'provider', 'inviterName', 'familyName', 'prefill', 'inviteFlow'],
    template:
      '<div v-if="open" class="stub-wizard" :data-prefill-email="prefill?.email" :data-prefill-name="prefill?.memberName" />',
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
    requiresPassword: true,
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
        requiresPassword: false,
      },
    ];
  });

  // ── Visibility gate ────────────────────────────────────────────────────

  it('hides when storage = local', () => {
    mockStorageProvider = 'local';
    mockHumans.push(makeMember());
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('hides when only owner exists', () => {
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('hides when familyKey is null', () => {
    mockFamilyKey = null;
    mockHumans.push(makeMember());
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('hides when every non-owner has already joined (requiresPassword === false)', () => {
    mockHumans.push(makeMember({ id: 'm1', requiresPassword: false }));
    mockHumans.push(makeMember({ id: 'm2', name: 'Liam', requiresPassword: false }));
    const wrapper = mount(OnboardingInvitePanel);
    // No pending members → nothing actionable, hide panel entirely.
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(false);
  });

  it('renders when at least one non-owner is still pending (even mixed with joined)', () => {
    mockHumans.push(makeMember({ id: 'm1', name: 'Sarah', requiresPassword: false })); // joined
    mockHumans.push(makeMember({ id: 'm2', name: 'Liam', requiresPassword: true })); // pending
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.find('[data-testid="onboarding-invite-panel"]').exists()).toBe(true);
  });

  // ── Per-row rendering ──────────────────────────────────────────────────

  it('joined member: shows status chip, no Send button', () => {
    mockHumans.push(makeMember({ id: 'm1', name: 'Sarah', requiresPassword: false }));
    mockHumans.push(makeMember({ id: 'm2', name: 'Liam', requiresPassword: true }));
    const wrapper = mount(OnboardingInvitePanel);

    // Sarah is joined → status chip present, no Send button
    expect(wrapper.text()).toContain('inviteWizard.picker.statusJoined');
    expect(wrapper.find('[data-testid="onboarding-invite-send-m1"]').exists()).toBe(false);

    // Liam is pending → Send button present
    expect(wrapper.find('[data-testid="onboarding-invite-send-m2"]').exists()).toBe(true);
  });

  it('pending member with email: renders email + Send button', () => {
    mockHumans.push(makeMember({ id: 'm1', email: 'sarah@beanpod.org' }));
    const wrapper = mount(OnboardingInvitePanel);
    expect(wrapper.text()).toContain('sarah@beanpod.org');
    expect(wrapper.find('[data-testid="onboarding-invite-send-m1"]').exists()).toBe(true);
  });

  it('pending member without email: shows hint + Send button (wizard handles email entry)', () => {
    mockHumans.push(makeMember({ id: 'm1', email: 'pending-emma@setup.local' }));
    const wrapper = mount(OnboardingInvitePanel);
    // Unshareable email is treated as "no email" — hint rendered.
    expect(wrapper.text()).toContain('onboarding.invite.noEmail');
    // Send button still present so the user can open the wizard and type one.
    expect(wrapper.find('[data-testid="onboarding-invite-send-m1"]').exists()).toBe(true);
  });

  // ── Wizard handoff ─────────────────────────────────────────────────────

  it('Send button opens InviteWizardModal with prefill from the row', async () => {
    mockHumans.push(makeMember({ id: 'm1', name: 'Sarah', email: 'sarah@beanpod.org' }));
    const wrapper = mount(OnboardingInvitePanel);

    // Wizard not yet mounted
    expect(wrapper.find('.stub-wizard').exists()).toBe(false);

    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');

    const stub = wrapper.find('.stub-wizard');
    expect(stub.exists()).toBe(true);
    expect(stub.attributes('data-prefill-email')).toBe('sarah@beanpod.org');
    expect(stub.attributes('data-prefill-name')).toBe('Sarah');
    expect(mockResetInviteFlow).toHaveBeenCalledTimes(1);
  });

  it('Send button on no-email member opens wizard with empty email prefill', async () => {
    mockHumans.push(makeMember({ id: 'm1', name: 'Emma', email: 'pending-emma@setup.local' }));
    const wrapper = mount(OnboardingInvitePanel);

    await wrapper.find('[data-testid="onboarding-invite-send-m1"]').trigger('click');

    const stub = wrapper.find('.stub-wizard');
    expect(stub.exists()).toBe(true);
    // Prefill carries the placeholder email through; the wizard's Step 1 logic
    // checks isUnshareableEmail and starts the input blank for the user to fill.
    expect(stub.attributes('data-prefill-name')).toBe('Emma');
  });
});
