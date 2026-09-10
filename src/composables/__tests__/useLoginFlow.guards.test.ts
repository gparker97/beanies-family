/**
 * `useLoginFlow` — the guards nothing on screen reveals.
 *
 * Two groups: the envelope-staging guards, and the authorization gate on the recovery
 * PIN reset. Both are invisible from the UI they protect, which is why they are pinned
 * here rather than through a component.
 *
 * ── The envelope-staging guards ──
 *
 * These four properties are the ones Pass 3 and Pass 4 of the credential plan added, and
 * the only part of that plan's Testing Plan (item 4) that shipped with no coverage. All
 * of them are invisible from the offer list they protect:
 *
 *   1. the in-flight stage is DEDUPED, so the picker's prefetch and `prove-loading`
 *      share one fetch rather than racing two;
 *   2. a FAILED stage is never memoized, or one transient Drive blip would strip a
 *      legacy family's password offer for the whole session — un-fixable by the
 *      reconnect panel that exists for exactly that;
 *   3. the stage is FAMILY-TAGGED on both halves: `stageInFlight` guards which promise
 *      is awaited, and `currentCapabilities` guards which envelope is READ, because
 *      `loadFromFile()` mutates `pendingEncryptedFile` globally and an A-fetch settling
 *      after a switch to B would otherwise decide B's offers;
 *   4. the await is BOUNDED, so a hung Drive round-trip cannot pin the prove screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import type { StageOutcome } from '@/services/auth/stagePendingFile';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

// ── Controllable dependencies ────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  stageCalls: 0,
  stageImpl: null as null | (() => Promise<StageOutcome>),
  /** What `resolveProveMethods` was handed — the observation point for capabilities. */
  lastEnvelopeArg: null as unknown,
  resolveCalls: 0,
  pendingEncryptedFile: null as { envelope: BeanpodFileV4 } | null,
  envelope: null as BeanpodFileV4 | null,
  members: [] as unknown[],
  activeFamilyId: null as string | null,
  resetCalls: 0,
}));

vi.mock('@/services/auth/stagePendingFile', () => ({
  stagePendingFile: vi.fn(async () => {
    h.stageCalls += 1;
    return h.stageImpl ? await h.stageImpl() : ({ ok: true } as StageOutcome);
  }),
}));

vi.mock('@/services/auth/proveMethods', async (orig) => {
  const actual = await orig<typeof import('@/services/auth/proveMethods')>();
  return {
    ...actual,
    resolveProveMethods: vi.fn(async (args: { envelope: unknown }) => {
      h.resolveCalls += 1;
      h.lastEnvelopeArg = args.envelope;
      return [{ kind: 'recovery' }];
    }),
  };
});

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get pendingEncryptedFile() {
      return h.pendingEncryptedFile;
    },
    get envelope() {
      return h.envelope;
    },
    isConfigured: true,
    needsPermission: false,
    hasPendingEncryptedFile: false,
    resetState: vi.fn(),
    initialize: vi.fn(async () => {}),
    loadFromFile: vi.fn(async () => ({ success: false, needsPassword: true })),
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return h.members;
    },
    sortedHumans: [],
    resetState: vi.fn(),
    loadMembers: vi.fn(async () => {}),
  }),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    get activeFamilyId() {
      return h.activeFamilyId;
    },
    switchFamily: vi.fn(async (id: string) => {
      h.activeFamilyId = id;
    }),
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    resetMemberPinViaRecovery: vi.fn(async () => {
      h.resetCalls += 1;
      return { success: true };
    }),
  }),
}));
vi.mock('@/stores/settingsStore', () => ({
  // Returning no cached key skips the trusted-device fast path, so every test below
  // exercises the COLD route the staging guards exist for.
  useSettingsStore: () => ({ getCachedFamilyKey: vi.fn(async () => null) }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useBiometricSignIn', () => ({
  useBiometricSignIn: () => ({ signIn: vi.fn() }),
}));
vi.mock('@/composables/useGoogleReconnect', () => ({
  useGoogleReconnect: () => ({ reconnect: vi.fn(), reconnectError: { value: null } }),
  reconnectSucceeded: vi.fn(),
}));
vi.mock('@/composables/useMemberInfo', () => ({ getMemberAvatarUrl: () => undefined }));
vi.mock('@/services/auth/passkeyService', () => ({ resolveDeviceKeys: vi.fn(async () => []) }));
vi.mock('@/services/auth/deviceUnlock', async (orig) => ({
  ...(await orig<typeof import('@/services/auth/deviceUnlock')>()),
  unlockWithPin: vi.fn(),
}));
vi.mock('@/services/telemetry/loginFlowEvents', async (orig) => ({
  ...(await orig<typeof import('@/services/telemetry/loginFlowEvents')>()),
  emitEnvelopeCapabilitiesUnknown: vi.fn(),
  emitOpenFetchRecovery: vi.fn(),
  emitProveOutcome: vi.fn(),
  emitRosterFallbackUsed: vi.fn(),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/payloadFailureSurface', () => ({
  reportPayloadFailure: vi.fn(),
  surfacePayloadFatal: vi.fn(),
}));

/** A roster so `buildPeople` resolves from cache and START carries a person. */
const PERSON = { id: 'm1', name: 'Alex', color: '#F15D22', hasCredential: true };
vi.mock('@/services/indexeddb/repositories/rosterCacheRepository', () => ({
  getRosterCache: vi.fn(async () => ({ members: [PERSON] })),
}));

import { useLoginFlow } from '@/composables/useLoginFlow';

function envelopeFor(familyId: string): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId,
    familyName: 'Beans',
    keyId: 'k',
    wrappedKeys: { m1: { salt: 's', wrapped: 'w' } },
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'x',
  } as BeanpodFileV4;
}

function makeFlow() {
  setActivePinia(createPinia());
  return useLoginFlow({ onSignedIn: vi.fn(), onExit: vi.fn() });
}

/** Drive START → PICK_PERSON and let the prove-loading effect settle. */
async function pickInto(flow: ReturnType<typeof useLoginFlow>, familyId: string) {
  await flow.startForFamily(familyId, 'Beans');
  flow.onPickPerson(PERSON as never);
  for (let i = 0; i < 12; i++) await nextTick();
  await Promise.resolve();
}

describe('useLoginFlow — envelope staging', () => {
  beforeEach(() => {
    h.stageCalls = 0;
    h.stageImpl = null;
    h.lastEnvelopeArg = null;
    h.resolveCalls = 0;
    h.pendingEncryptedFile = null;
    h.envelope = null;
    h.members = [];
    h.activeFamilyId = null;
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('dedupes the picker prefetch and the prove-loading await into ONE fetch', async () => {
    const flow = makeFlow();
    await pickInto(flow, 'A');
    // START prefetched it; prove-loading found the tag matching and awaited the SAME
    // promise rather than starting a second Drive round-trip.
    expect(h.stageCalls).toBe(1);
  });

  it('never memoizes a FAILED stage — the next prove-loading re-attempts', async () => {
    // The whole point: one transient Drive failure must not strip a legacy family's
    // password offer for the rest of the session.
    h.stageImpl = async () => ({ ok: false, reason: 'error' }) as StageOutcome;
    const flow = makeFlow();
    await pickInto(flow, 'A');
    const afterFirst = h.stageCalls;
    expect(afterFirst).toBe(1);
    // A failed stage lands on the recovery surface, so RECOVERY_RETRY is the real
    // re-entry — the tap the user makes after reconnecting Drive. `beginStage`'s own
    // comment names it as the reason a failure must never be memoized.
    expect(flow.state.value.kind).toBe('open-recovery');
    flow.onRecoveryRetry();
    for (let i = 0; i < 12; i++) await nextTick();
    // A second real fetch: the failure was NOT cached as "this family has no envelope".
    expect(h.stageCalls).toBe(2);
  });

  it("does NOT read family A's staged envelope as family B's capabilities", async () => {
    // `loadFromFile()` mutates `pendingEncryptedFile` globally, so an A-fetch settling
    // after a switch to B leaves A's envelope sitting in the store. Reading it as B's
    // is the cross-household leak the family check exists to stop.
    h.pendingEncryptedFile = { envelope: envelopeFor('A') };
    const flow = makeFlow();
    await pickInto(flow, 'B');

    expect(h.resolveCalls).toBeGreaterThan(0);
    expect(h.lastEnvelopeArg).toMatchObject({ known: false });
    // ...and specifically NOT A's password capability, which would resurrect the
    // impossible offer this whole change removed.
    expect(h.lastEnvelopeArg).not.toMatchObject({ known: true });
  });

  it("DOES read the staged envelope when it is this family's own", async () => {
    // The guard must not be so blunt that it withholds a legitimate offer.
    h.pendingEncryptedFile = { envelope: envelopeFor('A') };
    const flow = makeFlow();
    await pickInto(flow, 'A');
    expect(h.lastEnvelopeArg).toMatchObject({
      known: true,
      capabilities: { password: true, passphrase: false, kit: false },
    });
  });

  it('bounds the prove-loading await, so a hung stage cannot pin the screen', async () => {
    vi.useFakeTimers();
    // A stage that never settles — a Drive round-trip that hangs rather than fails.
    h.stageImpl = () => new Promise<StageOutcome>(() => {});
    const flow = makeFlow();
    const started = flow.startForFamily('A', 'Beans');
    await vi.advanceTimersByTimeAsync(0);
    await started;
    flow.onPickPerson(PERSON as never);

    // Before the backstop elapses the screen is still waiting.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.resolveCalls).toBe(0);

    // After it, the offer resolves anyway — a timeout is not evidence of failure, so it
    // withdraws the envelope-dependent offers and nothing else.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(h.resolveCalls).toBeGreaterThan(0);
    expect(h.lastEnvelopeArg).toMatchObject({ known: false });
  });
});

describe('useLoginFlow — only a recovery KIT may reset a PIN', () => {
  beforeEach(() => {
    h.stageCalls = 0;
    h.stageImpl = null;
    h.lastEnvelopeArg = null;
    h.resolveCalls = 0;
    h.pendingEncryptedFile = null;
    h.envelope = null;
    h.members = [];
    h.activeFamilyId = null;
    h.resetCalls = 0;
    vi.clearAllMocks();
  });

  /**
   * ⚠️ An AUTHORIZATION gate, not a convenience check, so hiding the affordance in
   * `ProveView` is only half of it. A PIN reset hands over a member's IDENTITY —
   * decryption alone does not, since whoever holds the passphrase can already read
   * everything — so a secret that can reset any PIN is a full member-impersonation
   * credential. Of the two family-level secrets the passphrase is the loosely-held one.
   */
  async function attemptReset(openedBy: 'kit' | 'passphrase' | null) {
    const flow = makeFlow();
    await pickInto(flow, 'A');
    flow.recoveryOpenedBy.value = openedBy;
    await flow.onResetPin('123456');
    return flow;
  }

  it('a KIT session may reset', async () => {
    await attemptReset('kit');
    expect(h.resetCalls).toBe(1);
  });

  it('a PASSPHRASE session may NOT reset, even if the call is made directly', async () => {
    await attemptReset('passphrase');
    expect(h.resetCalls).toBe(0);
  });

  it('a member-credential session may NOT reset', async () => {
    await attemptReset(null);
    expect(h.resetCalls).toBe(0);
  });
});
