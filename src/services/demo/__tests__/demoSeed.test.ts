/**
 * REVIEW-DEMO seed tests.
 *
 * The single most important assertion in this file is the FIRST one: seeding
 * while a session already exists must write nothing. `authStore.signUp` returns
 * `{ success: true }` without doing anything when a user is signed in, so a naive
 * "did signUp succeed?" check would sail past it and write ~60 synthetic records
 * into a REAL family's Automerge document. Everything else here is ordinary
 * plumbing by comparison.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  // stores
  currentUser: { value: null as { memberId: string; familyId?: string } | null },
  signUp: vi.fn(),
  signOutAndClearData: vi.fn(),
  createNewFile: vi.fn(),
  reloadAllStores: vi.fn(),
  setOnboardingCompleted: vi.fn(),
  onboardingCompleted: { value: true },
  // services
  setProvider: vi.fn(),
  createMemoryProvider: vi.fn(),
  seedDocument: vi.fn(),
  // gate
  isReviewDemoAvailable: vi.fn(),
  markDemoSession: vi.fn(),
  // telemetry
  logEvent: vi.fn(),
  reportError: vi.fn(),
  perfRecord: vi.fn(),
  // real remote seams — must never be touched
  slackNotify: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    get currentUser() {
      return h.currentUser.value;
    },
    signUp: h.signUp,
    signOutAndClearData: h.signOutAndClearData,
  }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ createNewFile: h.createNewFile, reloadAllStores: h.reloadAllStores }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    setOnboardingCompleted: h.setOnboardingCompleted,
    get onboardingCompleted() {
      return h.onboardingCompleted.value;
    },
    error: null,
  }),
}));
vi.mock('@/services/sync/syncService', () => ({ setProvider: h.setProvider }));
vi.mock('@/services/sync/providers/memoryProvider', () => ({
  createMemoryProvider: h.createMemoryProvider,
}));
vi.mock('@/services/automerge/seedDocument', () => ({ seedDocument: h.seedDocument }));
vi.mock('@/utils/reviewDemo', () => ({
  isReviewDemoAvailable: h.isReviewDemoAvailable,
  markDemoSession: h.markDemoSession,
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/utils/perfTiming', () => ({ record: h.perfRecord }));
vi.mock('@/utils/slackNotify', () => ({ slackNotify: h.slackNotify }));

// Not mocked — the real suppression wrapper runs, so the "no Plausible events"
// assertion tests the shipped implementation rather than a stub.
import { seedDemoFamily } from '@/services/demo/demoSeed';

const OWNER = 'owner-member-id';
const FAMILY = 'family-id';

/** Put every collaborator on its happy path. */
function happyPath(): void {
  h.currentUser.value = null;
  h.isReviewDemoAvailable.mockReturnValue(true);
  h.createMemoryProvider.mockReturnValue({ type: 'local' });
  h.signUp.mockImplementation(async () => {
    h.currentUser.value = { memberId: OWNER, familyId: FAMILY };
    return { success: true };
  });
  h.createNewFile.mockResolvedValue({ ok: true });
  h.seedDocument.mockResolvedValue(47);
  h.setOnboardingCompleted.mockResolvedValue(undefined);
  h.onboardingCompleted.value = true;
  h.reloadAllStores.mockResolvedValue(undefined);
  h.signOutAndClearData.mockResolvedValue(undefined);
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  delete window.plausible;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.plausible;
});

describe('seedDemoFamily — the pre-existing-session guard', () => {
  it('refuses outright, writes nothing, and clears nothing when a session exists', async () => {
    h.currentUser.value = { memberId: 'a-real-persons-member-id', familyId: 'a-real-family' };

    const result = await seedDemoFamily();

    expect(result).toEqual({ ok: false, code: 'session-exists' });
    // Nothing created…
    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.createNewFile).not.toHaveBeenCalled();
    expect(h.seedDocument).not.toHaveBeenCalled();
    expect(h.setProvider).not.toHaveBeenCalled();
    // …and, crucially, nothing DESTROYED. Their data is not ours to clear.
    expect(h.signOutAndClearData).not.toHaveBeenCalled();
  });
});

describe('seedDemoFamily — happy path', () => {
  it('seeds and reports success', async () => {
    const result = await seedDemoFamily();
    expect(result).toEqual({ ok: true });
    expect(h.markDemoSession).toHaveBeenCalledTimes(1);
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('passes the runtime owner id into the fixture', async () => {
    await seedDemoFamily();
    const seededDoc = h.seedDocument.mock.calls[0]![0] as Record<
      string,
      Array<{ id: string; memberId?: string }>
    >;
    // The owner must NOT be re-emitted as a member: signUp already wrote that
    // row with its passwordHash, and overwriting it would lock the demo session
    // out of its own pod.
    expect(seededDoc.familyMembers!.some((m) => m.id === OWNER)).toBe(false);
    // …but the owner must own things, or the pod looks like a stranger's.
    expect(seededDoc.accounts!.some((a) => a.memberId === OWNER)).toBe(true);
  });

  // Without this the reviewer lands on the first-run setup wizard instead of the
  // demo family — the defect the browser walkthrough caught.
  it('clears the first-run wizard so the reviewer sees the family, not onboarding', async () => {
    await seedDemoFamily();
    expect(h.setOnboardingCompleted).toHaveBeenCalledWith(true);
  });

  it('refreshes the stores after writing the fixture', async () => {
    await seedDemoFamily();
    expect(h.reloadAllStores).toHaveBeenCalledTimes(1);
    expect(h.seedDocument.mock.invocationCallOrder[0]!).toBeLessThan(
      h.reloadAllStores.mock.invocationCallOrder[0]!
    );
  });

  it('suppresses every remote side effect of the create', async () => {
    await seedDemoFamily();
    const opts = h.createNewFile.mock.calls[0]![6];
    expect(opts).toEqual({ suppressRemoteSideEffects: true });
    expect(h.slackNotify).not.toHaveBeenCalled();
  });

  it('makes no network request at all', async () => {
    await seedDemoFamily();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('emits no Plausible events, and leaves window.plausible as it found it', async () => {
    const original = vi.fn() as unknown as PlausibleQueue;
    window.plausible = original;
    // signUp fires analytics in production; simulate that to prove suppression.
    h.signUp.mockImplementation(async () => {
      window.plausible?.('signup');
      window.plausible?.('login');
      h.currentUser.value = { memberId: OWNER, familyId: FAMILY };
      return { success: true };
    });

    await seedDemoFamily();

    expect(original).not.toHaveBeenCalled();
    expect(window.plausible).toBe(original);
  });

  it('records the success outcome and a timing sample', async () => {
    await seedDemoFamily();
    const actions = h.logEvent.mock.calls.map((c) => c[0].context?.action);
    expect(actions).toContain('seed-start');
    expect(actions).toContain('seed-complete');
    expect(h.perfRecord).toHaveBeenCalledWith('review-demo-seed', expect.any(Number), {
      perf_entity_count: 47,
    });
  });
});

describe('seedDemoFamily — failure paths', () => {
  it('refuses when the gate is closed, without tearing anything down', async () => {
    h.isReviewDemoAvailable.mockReturnValue(false);
    const result = await seedDemoFamily();
    expect(result).toEqual({ ok: false, code: 'not-available' });
    expect(h.signOutAndClearData).not.toHaveBeenCalled();
  });

  it('reports a provider-install failure without tearing anything down', async () => {
    h.createMemoryProvider.mockImplementation(() => {
      throw new Error('guard says no');
    });
    const result = await seedDemoFamily();
    expect(result).toEqual({ ok: false, code: 'provider-install' });
    // Nothing was created yet, so there is nothing to clear.
    expect(h.signOutAndClearData).not.toHaveBeenCalled();
  });

  it('tears down exactly once when signUp fails', async () => {
    h.signUp.mockResolvedValue({ success: false, error: 'storage blocked' });
    const result = await seedDemoFamily();
    expect(result).toEqual({ ok: false, code: 'signup' });
    expect(h.signOutAndClearData).toHaveBeenCalledTimes(1);
  });

  it("passes createNewFile's own failure reason straight through", async () => {
    h.createNewFile.mockResolvedValue({
      ok: false,
      reason: 'verify',
      error: new Error('bad bytes'),
    });
    const result = await seedDemoFamily();
    expect(result).toEqual({ ok: false, code: 'verify' });
    expect(h.signOutAndClearData).toHaveBeenCalledTimes(1);
    expect(h.reportError.mock.calls[0]![0].context).toMatchObject({ error_code: 'verify' });
  });

  // settingsStore swallows its own write errors into `error.value` rather than
  // throwing, so the seed must verify the outcome instead of trusting the call.
  it('fails loudly if the first-run wizard could not be cleared', async () => {
    h.onboardingCompleted.value = false;
    const result = await seedDemoFamily();
    expect(result).toEqual({ ok: false, code: 'fixture-write' });
    expect(h.signOutAndClearData).toHaveBeenCalledTimes(1);
  });

  it('tears down when the fixture write fails', async () => {
    h.seedDocument.mockRejectedValue(new Error('worker gone'));
    const result = await seedDemoFamily();
    expect(result).toEqual({ ok: false, code: 'fixture-write' });
    expect(h.signOutAndClearData).toHaveBeenCalledTimes(1);
  });

  it('reports a failed teardown without masking the original failure', async () => {
    h.seedDocument.mockRejectedValue(new Error('worker gone'));
    h.signOutAndClearData.mockRejectedValue(new Error('teardown blew up'));

    const result = await seedDemoFamily();

    // The caller still sees the ORIGINAL cause.
    expect(result).toEqual({ ok: false, code: 'fixture-write' });
    const codes = h.reportError.mock.calls.map((c) => c[0].context?.error_code);
    expect(codes).toContain('fixture-write');
    expect(codes).toContain('teardown');
  });

  it('pages Slack (severity critical) on a seed failure — a blocked reviewer is critical', async () => {
    h.seedDocument.mockRejectedValue(new Error('worker gone'));
    await seedDemoFamily();
    expect(h.reportError.mock.calls[0]![0]).toMatchObject({
      surface: 'review-demo',
      severity: 'critical',
    });
  });

  it('restores window.plausible even when the seed fails mid-flight', async () => {
    const original = vi.fn() as unknown as PlausibleQueue;
    window.plausible = original;
    h.seedDocument.mockRejectedValue(new Error('worker gone'));

    await seedDemoFamily();

    expect(window.plausible).toBe(original);
  });
});
