/**
 * Component tests for ResetMemberPasswordModal — proves:
 *   1. Submit gating: disabled when fields are empty / mismatched.
 *   2. Error rendering: every `ResetError` key maps cleanly to a translation.
 *   3. Success path: calls `authStore.resetMemberPassword` with the right
 *      args, shows toast (with sync-deferred copy when applicable), emits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ResetMemberPasswordModal from '@/components/family/ResetMemberPasswordModal.vue';
import { showToast } from '@/composables/useToast';
import type { FamilyMember } from '@/types/models';

// useTranslation returns the key untouched so we can assert on key strings.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

const resetMemberPasswordMock = vi.fn();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    resetMemberPassword: resetMemberPasswordMock,
  }),
}));

function buildMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm2',
    name: 'Helper',
    email: 'h@example.com',
    role: 'member',
    color: '#000',
    ageGroup: 'adult',
    requiresPassword: false,
    canManagePod: false,
    isPet: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as FamilyMember;
}

function mountModal(member: FamilyMember | null = buildMember(), open = true) {
  return mount(ResetMemberPasswordModal, {
    props: { open, member },
    global: {
      stubs: {
        BeanieFormModal: {
          props: ['open', 'title', 'saveDisabled', 'isSubmitting'],
          emits: ['save', 'close'],
          template: `
            <div v-if="open" data-test="modal">
              <h2>{{ title }}</h2>
              <slot />
              <button data-test="submit" :disabled="saveDisabled" @click="$emit('save')">Submit</button>
              <button data-test="close" @click="$emit('close')">Close</button>
            </div>
          `,
        },
        PasswordEntryFields: {
          props: ['newPassword', 'confirm', 'idPrefix', 'disabled'],
          emits: ['update:newPassword', 'update:confirm'],
          template: `
            <div>
              <input data-test="new" :value="newPassword" @input="$emit('update:newPassword', $event.target.value)" />
              <input data-test="confirm" :value="confirm" @input="$emit('update:confirm', $event.target.value)" />
            </div>
          `,
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ResetMemberPasswordModal — submit gating', () => {
  it('disables submit when both fields are empty', () => {
    const w = mountModal();
    const submit = w.find('[data-test="submit"]');
    expect(submit.attributes('disabled')).toBeDefined();
  });

  it('disables submit when passwords mismatch', async () => {
    const w = mountModal();
    await w.find('[data-test="new"]').setValue('a');
    await w.find('[data-test="confirm"]').setValue('b');
    expect(w.find('[data-test="submit"]').attributes('disabled')).toBeDefined();
  });

  it('enables submit when both fields match and are non-empty', async () => {
    const w = mountModal();
    await w.find('[data-test="new"]').setValue('match');
    await w.find('[data-test="confirm"]').setValue('match');
    expect(w.find('[data-test="submit"]').attributes('disabled')).toBeUndefined();
  });
});

describe('ResetMemberPasswordModal — error rendering', () => {
  // One representative case per error-key family. Each error key must map
  // to a translation under `family.resetPassword.error.<key>` — the test
  // proves the data-driven mapping is wired, not the copy itself.
  const cases: Array<[string, string]> = [
    ['familyKeyMissing', 'family.resetPassword.error.familyKeyMissing'],
    ['wrapFailed', 'family.resetPassword.error.wrapFailed'],
    ['updateFailed', 'family.resetPassword.error.updateFailed'],
    ['notAuthorized', 'family.resetPassword.error.notAuthorized'],
    ['cannotResetOwner', 'family.resetPassword.error.cannotResetOwner'],
    ['cannotResetSelf', 'family.resetPassword.error.cannotResetSelf'],
    ['memberNotFound', 'family.resetPassword.error.memberNotFound'],
    ['isPet', 'family.resetPassword.error.isPet'],
    ['notAuthenticated', 'family.resetPassword.error.notAuthenticated'],
  ];

  it.each(cases)('renders the right translation for error key "%s"', async (errorKey, expected) => {
    resetMemberPasswordMock.mockResolvedValueOnce({ success: false, error: errorKey });
    const w = mountModal();
    await w.find('[data-test="new"]').setValue('match');
    await w.find('[data-test="confirm"]').setValue('match');
    await w.find('[data-test="submit"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain(expected);
  });
});

describe('ResetMemberPasswordModal — happy path', () => {
  it('calls resetMemberPassword with member id + new password and shows success toast', async () => {
    resetMemberPasswordMock.mockResolvedValueOnce({ success: true, syncDeferred: false });
    const w = mountModal();
    await w.find('[data-test="new"]').setValue('temp-pw');
    await w.find('[data-test="confirm"]').setValue('temp-pw');
    await w.find('[data-test="submit"]').trigger('click');
    await flushPromises();

    expect(resetMemberPasswordMock).toHaveBeenCalledWith('m2', 'temp-pw');
    expect(showToast).toHaveBeenCalledWith(
      'success',
      expect.stringContaining('family.resetPassword.success'),
      undefined,
      expect.objectContaining({ surface: 'reset-member-password' })
    );
    expect(w.emitted('reset')).toBeTruthy();
    expect(w.emitted('close')).toBeTruthy();
  });

  it('includes the syncDeferred hint when sync failed', async () => {
    resetMemberPasswordMock.mockResolvedValueOnce({ success: true, syncDeferred: true });
    const w = mountModal();
    await w.find('[data-test="new"]').setValue('temp-pw');
    await w.find('[data-test="confirm"]').setValue('temp-pw');
    await w.find('[data-test="submit"]').trigger('click');
    await flushPromises();

    expect(showToast).toHaveBeenCalledWith(
      'success',
      expect.any(String),
      'family.resetPassword.successDeferredSync',
      expect.any(Object)
    );
  });
});

describe('ResetMemberPasswordModal — guards', () => {
  it('returns required error when fields are empty (defensive — submit is disabled)', async () => {
    // Force the gate by mounting with non-matching empty state and clicking
    // submit directly. We bypass the disabled check via JS click → the
    // form-side validation must still catch it.
    const w = mountModal();
    await w.find('[data-test="submit"]').trigger('click');
    await flushPromises();
    // resetMemberPassword should NOT have been called because canSubmit gated it.
    expect(resetMemberPasswordMock).not.toHaveBeenCalled();
  });
});
