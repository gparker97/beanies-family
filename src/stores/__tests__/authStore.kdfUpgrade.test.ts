/**
 * The lazy KDF upgrade and the family passphrase orchestration in `authStore` (ADR-041, #81):
 *   - `signIn` re-wraps a legacy-cost member wrap ONLY with the gate open, once, through the
 *     best-effort `kdf-upgrade` rotation, and a failing upgrade never fails sign-in;
 *   - `afterPassphraseUnlock` arms the nudge for a legacy-shaped phrase and re-wraps the
 *     passphrase only when needed, never throwing;
 *   - `checkFamilyPassphrase` supplies the family's names as `userInputs` and logs one
 *     `verdict` row per reason transition;
 *   - `setRecoveryPassphrase` maps every refusal reason to its copy, and writes through the
 *     one wrap helper.
 *
 * The gate is mocked with the real decision shape (`gate open && recorded < secret`); its
 * floor states are covered in `kdfWriteGate.test.ts`.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hashPassword } from '@/services/auth/passwordService';
import type { BeanpodFileV4, WrappedMemberKey } from '@/types/syncFileV4';

const h = vi.hoisted(() => ({
  gateOpen: false,
  members: [] as Array<Record<string, unknown>>,
  familyName: 'The Lovelaces' as string | null,
  familyKey: {} as CryptoKey | null,
  envelope: null as BeanpodFileV4 | null,
  wrapForMember: vi.fn(async (_id: string, _pw: string) => {}),
  setMemberWrappedKey: vi.fn(async () => {}),
  setRecoveryPassphraseWrap: vi.fn(),
  syncNow: vi.fn(async () => true),
  updateMember: vi.fn(async (id: string) => ({ id })),
  unwrapWrappedKey: vi.fn(async (): Promise<CryptoKey | null> => null),
  wrapFamilyKeyWithSecret: vi.fn(async () => ({
    salt: 'c2FsdA==',
    wrapped: 'd3JhcHBlZA==',
    iterations: 600_000,
  })),
  checkPassphrase: vi.fn(),
  isLegacyGeneratedShape: vi.fn((_p: string) => false),
  armLegacyPassphraseSignal: vi.fn(),
  logEvent: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/services/crypto/kdfWriteGate', () => ({
  isKdfUpgradeGateOpen: () => h.gateOpen,
  needsSecretRewrap: (r: { iterations?: number } | undefined) =>
    !!r && h.gateOpen && (r.iterations ?? 100_000) < 600_000,
}));
vi.mock('@/services/crypto/secretWrap', () => ({
  wrapFamilyKeyWithSecret: h.wrapFamilyKeyWithSecret,
}));
vi.mock('@/utils/passphraseStrength', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/passphraseStrength')>()),
  checkPassphrase: h.checkPassphrase,
  isLegacyGeneratedShape: h.isLegacyGeneratedShape,
}));
vi.mock('@/services/auth/legacyPassphraseSignal', () => ({
  armLegacyPassphraseSignal: h.armLegacyPassphraseSignal,
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return h.members;
    },
    updateMember: h.updateMember,
    updateMemberCredentials: h.updateMember,
    setCurrentMember: vi.fn(),
    resetState: vi.fn(),
    createMember: vi.fn(),
    loadMembers: vi.fn(),
  }),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: 'fam-1',
    allFamilies: [],
    get activeFamilyName() {
      return h.familyName;
    },
  }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get familyKey() {
      return h.familyKey;
    },
    get envelope() {
      return h.envelope;
    },
    authoritativeEnvelope: () => h.envelope,
    wrapFamilyKeyForMember: h.wrapForMember,
    setMemberWrappedKey: h.setMemberWrappedKey,
    setRecoveryPassphraseWrap: h.setRecoveryPassphraseWrap,
    syncNow: h.syncNow,
    DURABLE_ROTATION_SAVE_TIMEOUT_MS: 50,
    canDurablySaveNow: () => true,
    syncNowDurable: async () => ((await h.syncNow()) ? 'saved' : 'failed'),
    syncNowBounded: async () => h.syncNow(),
    resetState: vi.fn(),
  }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  unwrapWrappedKey: h.unwrapWrappedKey,
  parseBeanpodV4: vi.fn(),
  reEncryptEnvelope: vi.fn(),
  tryUnwrapFamilyKey: vi.fn(),
  createBeanpodV4: vi.fn(),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(),
  isGoogleAuthAvailable: vi.fn(() => false),
  getGoogleAccountEmail: vi.fn(() => null),
  signOutFromGoogle: vi.fn(),
  setUserMeta: vi.fn(),
  clearUserMeta: vi.fn(),
}));
vi.mock('@/services/registry/registryService', () => ({
  getRegistryDatabase: vi.fn(),
  isRegistryConfigured: vi.fn(() => false),
}));
vi.mock('@/services/auth/passkeyService', () => ({
  reconcileDeviceKeysWithRoster: vi.fn(async () => {}),
  authenticateWithPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  hasRegisteredPasskeys: vi.fn(async () => false),
  listRegisteredPasskeys: vi.fn(async () => []),
}));
vi.mock('@/services/sync/passwordCache', () => ({
  isPasswordCacheValid: vi.fn(() => false),
  getCachedPassword: vi.fn(),
  cachePassword: vi.fn(),
  clearPasswordCache: vi.fn(),
}));

import { useAuthStore } from '../authStore';

function envelope(over: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
    ...over,
  };
}

async function member(id: string, password: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Ada',
    email: 'ada.l@example.com',
    gender: 'other',
    ageGroup: 'adult',
    role: 'member',
    color: '#000',
    requiresPassword: false,
    passwordHash: await hashPassword(password),
    canManagePod: false,
    isPet: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function rows(message: string) {
  return h.logEvent.mock.calls
    .map((c) => c[0] as { level: string; surface: string; message: string; context?: unknown })
    .filter((e) => e.message === message);
}
const upgradeRows = () => rows('wrap_upgrade');

const MEMBER_ID = 'member-00000001';
const LEGACY: WrappedMemberKey = { wrapped: 'w', salt: 's' };
const CURRENT: WrappedMemberKey = { wrapped: 'w', salt: 's', iterations: 600_000 };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  h.gateOpen = false;
  h.members = [];
  h.familyName = 'The Lovelaces';
  h.familyKey = {} as CryptoKey;
  h.envelope = envelope();
  h.syncNow.mockResolvedValue(true);
  h.updateMember.mockImplementation(async (id: string) => ({ id }));
  h.unwrapWrappedKey.mockResolvedValue({} as CryptoKey);
  h.isLegacyGeneratedShape.mockReturnValue(false);
  h.checkPassphrase.mockResolvedValue({ ok: true, score: 4 });
});

describe('signIn: lazy member wrap upgrade', () => {
  async function signInWith(entry: WrappedMemberKey) {
    h.members = [await member(MEMBER_ID, 'real-pw')];
    h.envelope = envelope({ wrappedKeys: { [MEMBER_ID]: entry } });
    return useAuthStore().signIn(MEMBER_ID, 'real-pw');
  }

  it('re-wraps a legacy wrap once, best-effort, when the gate is open', async () => {
    h.gateOpen = true;
    const result = await signInWith(LEGACY);
    expect(result.success).toBe(true);
    expect(h.wrapForMember).toHaveBeenCalledTimes(1);
    expect(h.wrapForMember).toHaveBeenCalledWith(MEMBER_ID, 'real-pw');
    expect(upgradeRows()).toEqual([
      expect.objectContaining({
        level: 'info',
        surface: 'kdf-upgrade',
        context: { action: 'upgraded', kind: 'member', member_id_tail: '00000001' },
      }),
    ]);
    // The best-effort rotation logs under the kdf-upgrade surface.
    expect(rows('kdf-upgrade rotation save (best-effort)')).toHaveLength(1);
  });

  it('skips with the gate closed (skipped-gate-closed)', async () => {
    const result = await signInWith(LEGACY);
    expect(result.success).toBe(true);
    expect(h.wrapForMember).not.toHaveBeenCalled();
    expect(upgradeRows()).toEqual([
      expect.objectContaining({
        context: { action: 'skipped-gate-closed', kind: 'member', member_id_tail: '00000001' },
      }),
    ]);
  });

  it('skips a wrap already at the current cost (skipped-current)', async () => {
    h.gateOpen = true;
    await signInWith(CURRENT);
    expect(h.wrapForMember).not.toHaveBeenCalled();
    expect(upgradeRows()).toEqual([
      expect.objectContaining({
        context: { action: 'skipped-current', kind: 'member', member_id_tail: '00000001' },
      }),
    ]);
  });

  it('a rotation that fails never fails sign-in and logs failed with the code', async () => {
    h.gateOpen = true;
    h.wrapForMember.mockRejectedValueOnce(new Error('crypto gone'));
    const result = await signInWith(LEGACY);
    expect(result.success).toBe(true);
    expect(upgradeRows()).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: {
          action: 'failed',
          kind: 'member',
          member_id_tail: '00000001',
          error_code: 'wrapFailed',
        },
      }),
    ]);
    // The rotation reported its own failure under the upgrade surface.
    expect(h.reportError).toHaveBeenCalledWith(expect.objectContaining({ surface: 'kdf-upgrade' }));
  });

  it('a rotation that THROWS never fails sign-in, logs failed and reports a warning', async () => {
    h.gateOpen = true;
    h.members = [await member(MEMBER_ID, 'real-pw')];
    h.envelope = envelope({ wrappedKeys: { [MEMBER_ID]: LEGACY } });
    // The family key vanishes between the unwrap check and the rotation's own read.
    let reads = 0;
    Object.defineProperty(h, 'familyKey', {
      configurable: true,
      get: () => {
        reads += 1;
        if (reads > 1) throw new TypeError('envelope cleared mid-flight');
        return {} as CryptoKey;
      },
    });
    try {
      const result = await useAuthStore().signIn(MEMBER_ID, 'real-pw');
      expect(result.success).toBe(true);
    } finally {
      Object.defineProperty(h, 'familyKey', {
        configurable: true,
        writable: true,
        value: {} as CryptoKey,
      });
    }
    expect(upgradeRows()).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ action: 'failed', error_code: 'TypeError' }),
      }),
    ]);
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'kdf-upgrade', severity: 'warning' })
    );
  });

  it('a stale wrap is healed (signin-heal), not counted as an upgrade', async () => {
    h.gateOpen = true;
    h.unwrapWrappedKey.mockResolvedValueOnce(null);
    await signInWith(LEGACY);
    expect(h.wrapForMember).toHaveBeenCalledTimes(1);
    expect(upgradeRows()).toHaveLength(0);
  });
});

describe('afterPassphraseUnlock', () => {
  it('arms the nudge for a legacy-shaped phrase', async () => {
    h.isLegacyGeneratedShape.mockReturnValue(true);
    h.envelope = envelope({ recoveryPassphrase: { ...CURRENT } });
    await useAuthStore().afterPassphraseUnlock('apple-river-stone-cloud');
    expect(h.isLegacyGeneratedShape).toHaveBeenCalledWith('apple-river-stone-cloud');
    expect(h.armLegacyPassphraseSignal).toHaveBeenCalledTimes(1);
  });

  it('does not arm for any other phrase', async () => {
    h.envelope = envelope({ recoveryPassphrase: { ...CURRENT } });
    await useAuthStore().afterPassphraseUnlock('a phrase of my own choosing');
    expect(h.armLegacyPassphraseSignal).not.toHaveBeenCalled();
  });

  it('re-wraps a legacy passphrase wrap with the gate open, through the one wrap path', async () => {
    h.gateOpen = true;
    h.envelope = envelope({ recoveryPassphrase: { ...LEGACY, createdAt: '2026-01-01T00:00:00Z' } });
    await useAuthStore().afterPassphraseUnlock('the typed phrase');
    expect(h.wrapFamilyKeyWithSecret).toHaveBeenCalledWith(h.familyKey, 'the typed phrase');
    expect(h.setRecoveryPassphraseWrap).toHaveBeenCalledWith(
      expect.objectContaining({ salt: 'c2FsdA==', wrapped: 'd3JhcHBlZA==', iterations: 600_000 })
    );
    expect(h.syncNow).toHaveBeenCalledTimes(1);
    expect(upgradeRows()).toEqual([
      expect.objectContaining({ context: { action: 'upgraded', kind: 'passphrase' } }),
    ]);
  });

  it('logs upgrade-deferred when the bounded save did not land (offline), never upgraded', async () => {
    h.gateOpen = true;
    h.envelope = envelope({ recoveryPassphrase: { ...LEGACY, createdAt: '2026-01-01T00:00:00Z' } });
    h.syncNow.mockResolvedValueOnce(false);
    await useAuthStore().afterPassphraseUnlock('the typed phrase');
    expect(h.setRecoveryPassphraseWrap).toHaveBeenCalledTimes(1);
    expect(upgradeRows()).toEqual([
      expect.objectContaining({ context: { action: 'upgrade-deferred', kind: 'passphrase' } }),
    ]);
  });

  it('skips (skipped-changed) when a peer changed the passphrase during the derivation', async () => {
    h.gateOpen = true;
    h.envelope = envelope({ recoveryPassphrase: { ...LEGACY, createdAt: '2026-01-01T00:00:00Z' } });
    // The 600k derivation takes a while; a poll merge lands a NEW passphrase meanwhile.
    h.wrapFamilyKeyWithSecret.mockImplementationOnce(async () => {
      h.envelope = envelope({
        recoveryPassphrase: {
          wrapped: 'PEER-NEW',
          salt: 'p',
          iterations: 600_000,
          createdAt: '2026-10-07T00:00:00Z',
        },
      });
      return { salt: 'c2FsdA==', wrapped: 'd3JhcHBlZA==', iterations: 600_000 };
    });
    await useAuthStore().afterPassphraseUnlock('the typed phrase');
    expect(h.setRecoveryPassphraseWrap).not.toHaveBeenCalled();
    expect(h.syncNow).not.toHaveBeenCalled();
    expect(upgradeRows()).toEqual([
      expect.objectContaining({ context: { action: 'skipped-changed', kind: 'passphrase' } }),
    ]);
  });

  it.each([
    ['gate closed', false, LEGACY, 'skipped-gate-closed'],
    ['already current', true, CURRENT, 'skipped-current'],
  ])('does not re-wrap when %s', async (_l, gate, entry, action) => {
    h.gateOpen = gate;
    h.envelope = envelope({ recoveryPassphrase: { ...entry } });
    await useAuthStore().afterPassphraseUnlock('the typed phrase');
    expect(h.wrapFamilyKeyWithSecret).not.toHaveBeenCalled();
    expect(h.setRecoveryPassphraseWrap).not.toHaveBeenCalled();
    expect(upgradeRows()).toEqual([
      expect.objectContaining({ context: { action, kind: 'passphrase' } }),
    ]);
  });

  it('never throws: a failing re-wrap logs failed and reports a warning', async () => {
    h.gateOpen = true;
    h.envelope = envelope({ recoveryPassphrase: { ...LEGACY } });
    h.wrapFamilyKeyWithSecret.mockRejectedValueOnce(new RangeError('derive refused'));
    await expect(useAuthStore().afterPassphraseUnlock('the typed phrase')).resolves.toBe(undefined);
    expect(upgradeRows()).toEqual([
      expect.objectContaining({
        level: 'warn',
        context: { action: 'failed', kind: 'passphrase', error_code: 'RangeError' },
      }),
    ]);
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'kdf-upgrade', severity: 'warning' })
    );
  });

  it('never throws when the legacy check itself fails, and still upgrades', async () => {
    h.gateOpen = true;
    h.isLegacyGeneratedShape.mockImplementation(() => {
      throw new Error('boom');
    });
    h.envelope = envelope({ recoveryPassphrase: { ...LEGACY } });
    await useAuthStore().afterPassphraseUnlock('the typed phrase');
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'passphrase-nudge', severity: 'warning' })
    );
    expect(h.setRecoveryPassphraseWrap).toHaveBeenCalledTimes(1);
  });
});

describe('checkFamilyPassphrase', () => {
  it('passes the family name, member names, aliases and email local parts, deduped', async () => {
    h.members = [
      await member('m1', 'pw', { name: 'Ada', aliases: ['Addie', ''], email: 'ada.l@example.com' }),
      await member('m2', 'pw', {
        name: 'Byron',
        email: '',
        googleAccountEmail: 'ada.l@gmail.com',
      }),
    ];
    await useAuthStore().checkFamilyPassphrase('  some phrase  ');
    expect(h.checkPassphrase).toHaveBeenCalledWith('some phrase', [
      'The Lovelaces',
      'Ada',
      'Addie',
      'ada.l',
      'Byron',
    ]);
  });

  it('logs one verdict row per reason transition, never per call', async () => {
    const store = useAuthStore();
    // The latch is module-level: settle it on a known reason before observing.
    await store.checkFamilyPassphrase('settle the latch on ok');
    h.logEvent.mockClear();
    h.checkPassphrase.mockResolvedValue({ ok: false, reason: 'too-short', score: 0 });
    await store.checkFamilyPassphrase('a');
    await store.checkFamilyPassphrase('ab');
    h.checkPassphrase.mockResolvedValue({ ok: false, reason: 'too-guessable', score: 2 });
    await store.checkFamilyPassphrase('i love my kids 1');
    await store.checkFamilyPassphrase('i love my kids 12');
    h.checkPassphrase.mockResolvedValue({ ok: true, score: 4 });
    await store.checkFamilyPassphrase('long strong phrase here');
    expect(rows('verdict').map((r) => r.context)).toEqual([
      { detail: 'too-short', count: 0 },
      { detail: 'too-guessable', count: 2 },
      { detail: 'ok', count: 4 },
    ]);
    expect(rows('verdict').every((r) => r.surface === 'passphrase-strength')).toBe(true);
  });
});

describe('setRecoveryPassphrase', () => {
  it.each([
    ['too-short', 'recovery.passphraseTooWeak'],
    ['matches-name', 'recovery.passphraseMatchesName'],
    ['too-guessable', 'recovery.passphraseTooGuessable'],
    ['scorer-unavailable', 'recovery.passphraseCheckUnavailable'],
  ])('refuses %s with its copy and writes nothing', async (reason, key) => {
    h.checkPassphrase.mockResolvedValue({ ok: false, reason, score: 0 });
    const r = await useAuthStore().setRecoveryPassphrase('whatever it is');
    expect(r).toEqual({ success: false, error: key });
    expect(h.wrapFamilyKeyWithSecret).not.toHaveBeenCalled();
    expect(h.setRecoveryPassphraseWrap).not.toHaveBeenCalled();
  });

  it('wraps the TRIMMED phrase through the one helper, stamps createdAt and saves', async () => {
    const r = await useAuthStore().setRecoveryPassphrase('  six good words go right here  ');
    expect(r).toEqual({ success: true });
    expect(h.wrapFamilyKeyWithSecret).toHaveBeenCalledWith(
      h.familyKey,
      'six good words go right here'
    );
    const written = h.setRecoveryPassphraseWrap.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toMatchObject({
      salt: 'c2FsdA==',
      wrapped: 'd3JhcHBlZA==',
      iterations: 600_000,
    });
    expect(typeof written.createdAt).toBe('string');
    expect(h.syncNow).toHaveBeenCalledTimes(1);
    expect(rows('recovery_passphrase_set')).toHaveLength(1);
  });

  it('a save resets the verdict latch so the next editing episode logs afresh', async () => {
    const store = useAuthStore();
    await store.checkFamilyPassphrase('long strong phrase here');
    await store.setRecoveryPassphrase('long strong phrase here');
    await store.checkFamilyPassphrase('long strong phrase here');
    expect(rows('verdict')).toHaveLength(2);
  });
});
