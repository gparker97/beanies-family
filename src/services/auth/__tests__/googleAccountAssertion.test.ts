import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Capture the registered onTokenAcquired callback so tests can drive it.
let registeredCallback: ((email: string | null, token: string) => void) | null = null;

const mockClearGoogleSessionState = vi.fn(async () => {});
const mockRequestAccessToken = vi.fn(async (_opts?: unknown) => 'new-token');

vi.mock('@/services/google/googleAuth', () => ({
  onTokenAcquired: (cb: (email: string | null, token: string) => void) => {
    registeredCallback = cb;
    return () => {
      registeredCallback = null;
    };
  },
  clearGoogleSessionState: () => mockClearGoogleSessionState(),
  requestAccessToken: (opts: unknown) => mockRequestAccessToken(opts),
}));

const mockUpdateMember = vi.fn(
  async (_id: string, _input: { googleAccountEmail?: string }) => ({})
);
const familyMembers: Array<{ id: string; googleAccountEmail?: string }> = [];

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: familyMembers,
    updateMember: (id: string, input: { googleAccountEmail?: string }) =>
      mockUpdateMember(id, input),
  }),
}));

let currentMemberId: string | null = 'member-A';
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    currentUser: { memberId: currentMemberId },
  }),
}));

const mockShowToast = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({
    // Return a string that contains the {email} placeholder so the
    // production .replace('{email}', ...) call has something to swap.
    // Mirrors how the real translation entry looks.
    t: (key: string) => (key === 'auth.accountMismatchBody' ? `${key}: {email}` : key),
  }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('googleAccountAssertion', () => {
  let assertionModule: typeof import('../googleAccountAssertion');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    registeredCallback = null;
    familyMembers.length = 0;
    currentMemberId = 'member-A';
    assertionModule = await import('../googleAccountAssertion');
    assertionModule._resetGoogleAccountAssertionForTests();
  });

  afterEach(() => {
    assertionModule._resetGoogleAccountAssertionForTests();
  });

  function fireToken(email: string | null) {
    if (!registeredCallback) throw new Error('subscriber not registered');
    return registeredCallback(email, 'tok-' + (email ?? 'null'));
  }

  it('registers an onTokenAcquired subscriber', () => {
    expect(registeredCallback).toBeNull();
    assertionModule.registerGoogleAccountAssertion();
    expect(registeredCallback).not.toBeNull();
  });

  it('register is idempotent — calling twice does not double-subscribe', () => {
    assertionModule.registerGoogleAccountAssertion();
    const first = registeredCallback;
    assertionModule.registerGoogleAccountAssertion();
    expect(registeredCallback).toBe(first);
  });

  it('backfills googleAccountEmail when the field is unset (verified by own consent)', async () => {
    familyMembers.push({ id: 'member-A' });
    assertionModule.registerGoogleAccountAssertion();

    await fireToken('a@example.com');

    expect(mockUpdateMember).toHaveBeenCalledWith('member-A', {
      googleAccountEmail: 'a@example.com',
    });
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  it('no-ops when the email matches the existing googleAccountEmail', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    await fireToken('a@example.com');

    expect(mockUpdateMember).not.toHaveBeenCalled();
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  it('forces a fresh consent with login_hint on mismatch (silent self-correction)', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    await fireToken('b@example.com');

    expect(mockClearGoogleSessionState).toHaveBeenCalled();
    expect(mockRequestAccessToken).toHaveBeenCalledWith({
      forceConsent: true,
      loginHint: 'a@example.com',
    });
    // Member record should NOT be overwritten on mismatch.
    expect(mockUpdateMember).not.toHaveBeenCalled();
    // Toast should not fire on the first mismatch — we re-consent silently.
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('stops the loop and shows a toast if the next acquisition still mismatches', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    // First mismatch → re-consent fires
    await fireToken('b@example.com');
    expect(mockClearGoogleSessionState).toHaveBeenCalledTimes(1);
    expect(mockRequestAccessToken).toHaveBeenCalledTimes(1);

    // Second acquisition still wrong (user picked B again at the chooser)
    await fireToken('b@example.com');
    // Re-entry guard prevents another forced consent.
    expect(mockClearGoogleSessionState).toHaveBeenCalledTimes(1);
    expect(mockRequestAccessToken).toHaveBeenCalledTimes(1);
    // Toast surfaces the mismatch with the expected email.
    expect(mockShowToast).toHaveBeenCalledWith(
      'warning',
      'auth.accountMismatchTitle',
      expect.stringContaining('a@example.com')
    );
  });

  it('clears the re-entry guard when an acquisition matches, allowing future corrections', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    // Mismatch → re-consent
    await fireToken('b@example.com');
    expect(mockRequestAccessToken).toHaveBeenCalledTimes(1);

    // Match → clears guard
    await fireToken('a@example.com');

    // Future mismatch should trigger re-consent again.
    await fireToken('c@example.com');
    expect(mockRequestAccessToken).toHaveBeenCalledTimes(2);
  });

  it('armAccountSwitch + next acquisition writes the new email to the member record', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    assertionModule.armAccountSwitch();
    await fireToken('c@example.com'); // user picked a different account at the chooser

    // Record updated with the new email — no assertion mismatch toast.
    expect(mockUpdateMember).toHaveBeenCalledWith('member-A', {
      googleAccountEmail: 'c@example.com',
    });
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('armAccountSwitch is one-shot — subsequent acquisitions assert normally', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    assertionModule.armAccountSwitch();
    await fireToken('c@example.com'); // consumes the flag, writes c

    // Manually update the member record to reflect what updateMember did.
    familyMembers[0]!.googleAccountEmail = 'c@example.com';

    // Next acquisition with a different email should be treated as a
    // mismatch (assertion path), NOT as another switch.
    await fireToken('d@example.com');
    expect(mockClearGoogleSessionState).toHaveBeenCalled();
    expect(mockRequestAccessToken).toHaveBeenCalled();
  });

  it('fails open when userinfo email is null (skips assertion, no errors)', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    await fireToken(null);

    expect(mockUpdateMember).not.toHaveBeenCalled();
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  it('does nothing when no member is currently authenticated', async () => {
    currentMemberId = null;
    assertionModule.registerGoogleAccountAssertion();

    await fireToken('a@example.com');

    expect(mockUpdateMember).not.toHaveBeenCalled();
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
  });
});
