import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Capture the registered onTokenAcquired callback so tests can drive it.
type AcquiredCb = (email: string | null, token: string, interactive: boolean) => void;
let registeredCallback: AcquiredCb | null = null;

const mockClearGoogleSessionState = vi.fn(async () => {});
const mockRequestAccessToken = vi.fn(async (_opts?: unknown) => 'new-token');

vi.mock('@/services/google/googleAuth', () => ({
  onTokenAcquired: (cb: AcquiredCb) => {
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

// As of 2026-08-14 a nominal mismatch no longer toasts — it records a silent
// diagnostic via logEvent and defers to the access-based heal in syncStore.
const mockLogEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}));

/** Assert the benign-mismatch diagnostic fired (and NO user-facing toast, since
 *  there is no toast dependency in the module anymore). */
function expectBenignMismatchLogged() {
  expect(mockLogEvent).toHaveBeenCalledWith(
    expect.objectContaining({ surface: 'account-mismatch-benign' })
  );
}

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

  function fireToken(email: string | null, interactive = true) {
    if (!registeredCallback) throw new Error('subscriber not registered');
    return registeredCallback(email, 'tok-' + (email ?? 'null'), interactive);
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

  it('logs a benign-mismatch diagnostic and shows NO toast on mismatch — never auto-forces consent (#62/2026-08-14)', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    await fireToken('b@example.com');

    // The whole point of #62: no silent mint on a mismatched acquisition.
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
    // Member record NOT overwritten on mismatch (the heal owns that, on proven access).
    expect(mockUpdateMember).not.toHaveBeenCalled();
    // A silent diagnostic fires; the mismatch is deferred to the access-based heal.
    expectBenignMismatchLogged();
  });

  it('logs a benign event on EACH mismatch (no re-consent, no toast) — rate-limiting lives in logEvent', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    await fireToken('b@example.com');
    await fireToken('b@example.com');

    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
    // Both mismatched acquisitions record a benign event (the warn-once toast
    // latch was removed; client-side rate-limiting in logEvent prevents spam).
    const benign = mockLogEvent.mock.calls.filter(
      ([arg]) => (arg as { surface?: string })?.surface === 'account-mismatch-benign'
    );
    expect(benign).toHaveLength(2);
  });

  it('a matching acquisition logs no benign event; a later mismatch does (#62/2026-08-14)', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    await fireToken('a@example.com'); // match → no benign event
    expect(mockLogEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'account-mismatch-benign' })
    );

    await fireToken('c@example.com'); // mismatch → benign event
    expectBenignMismatchLogged();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  it('armAccountSwitch + next acquisition writes the new email to the member record', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    assertionModule.armAccountSwitch();
    await fireToken('c@example.com'); // user picked a different account at the chooser

    // Record updated with the new email — a deliberate switch, not a mismatch.
    expect(mockUpdateMember).toHaveBeenCalledWith('member-A', {
      googleAccountEmail: 'c@example.com',
    });
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
    // No benign-mismatch diagnostic — the switch branch consumed the acquisition.
    expect(mockLogEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'account-mismatch-benign' })
    );
  });

  it('armAccountSwitch is one-shot — subsequent acquisitions assert normally', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    assertionModule.armAccountSwitch();
    await fireToken('c@example.com'); // consumes the flag, writes c

    // Manually update the member record to reflect what updateMember did.
    familyMembers[0]!.googleAccountEmail = 'c@example.com';

    // Next acquisition with a different email should be treated as a
    // mismatch (assertion path), NOT as another switch → benign diagnostic,
    // never an auto re-consent.
    await fireToken('d@example.com');
    expectBenignMismatchLogged();
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
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

  it('disarmAccountSwitch clears the flag — next acquisition asserts normally', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    assertionModule.armAccountSwitch();
    assertionModule.disarmAccountSwitch();

    // A different email now — should be treated as a mismatch (assert,
    // not a switch) because the flag was disarmed before consumption →
    // benign diagnostic, never an auto re-consent.
    await fireToken('b@example.com');

    expect(mockUpdateMember).not.toHaveBeenCalled();
    expectBenignMismatchLogged();
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  it('background silent refresh does NOT consume the pending account-switch flag', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    // User clicks "switch account" → flag armed
    assertionModule.armAccountSwitch();

    // While the chooser is up, the file-polling timer ticks and a
    // background silent refresh fires for the *currently bound* account.
    await fireToken('a@example.com', /* interactive */ false);

    // Silent refresh must NOT consume the flag — it isn't an interactive
    // "user picked an account" signal.
    expect(mockUpdateMember).not.toHaveBeenCalled();

    // Now the user actually picks a new account at the chooser.
    await fireToken('c@example.com', /* interactive */ true);

    // Flag is still armed → consumed by the interactive acquisition,
    // member email is rewritten to the new one.
    expect(mockUpdateMember).toHaveBeenCalledWith('member-A', {
      googleAccountEmail: 'c@example.com',
    });
    // No mismatch correction triggered.
    expect(mockClearGoogleSessionState).not.toHaveBeenCalled();
    expect(mockRequestAccessToken).not.toHaveBeenCalled();
  });

  it('armAccountSwitch persists across full-page redirects via sessionStorage', async () => {
    familyMembers.push({ id: 'member-A', googleAccountEmail: 'a@example.com' });
    assertionModule.registerGoogleAccountAssertion();

    assertionModule.armAccountSwitch();
    expect(sessionStorage.getItem('beanies_pending_account_switch')).toBe('1');

    // Simulate the page navigating away and back: re-import the module
    // to reset in-memory state (mirrors the new JS heap on page load).
    vi.resetModules();
    assertionModule = await import('../googleAccountAssertion');
    assertionModule._resetGoogleAccountAssertionForTests();
    // _resetForTests clears sessionStorage too — re-set it to simulate
    // the surviving redirect-flow flag.
    sessionStorage.setItem('beanies_pending_account_switch', '1');
    assertionModule.registerGoogleAccountAssertion();

    // First acquisition after redirect-completion is interactive.
    await fireToken('c@example.com', true);

    // Member email rewritten — flag was honored from sessionStorage.
    expect(mockUpdateMember).toHaveBeenCalledWith('member-A', {
      googleAccountEmail: 'c@example.com',
    });
    // sessionStorage flag consumed.
    expect(sessionStorage.getItem('beanies_pending_account_switch')).toBeNull();
  });

  it('disarmAccountSwitch clears the sessionStorage mirror', () => {
    assertionModule.armAccountSwitch();
    expect(sessionStorage.getItem('beanies_pending_account_switch')).toBe('1');
    assertionModule.disarmAccountSwitch();
    expect(sessionStorage.getItem('beanies_pending_account_switch')).toBeNull();
  });
});
