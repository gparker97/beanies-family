import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PasskeyRegistration } from '@/types/models';

// --- Mock the custom Capacitor plugin boundary ---
const { plugin } = vi.hoisted(() => ({
  plugin: {
    isAvailable: vi.fn(async () => ({ available: true, biometryType: 'fingerprint' })),
    setKey: vi.fn(async () => ({ keyBacking: 'strongbox' })),
    getKey: vi.fn(async () => ({ keyB64: 'AAAA', keyBacking: 'strongbox' })),
    hasKey: vi.fn(async () => ({ present: true })),
    deleteKey: vi.fn(async () => {}),
    deleteAllKeys: vi.fn(async () => ({ deleted: true })),
    // Required, not cosmetic: adoption now runs from a seam every existing case reaches,
    // and a missing method on a plain-object double is a TypeError — which
    // `isPluginMissing()` deliberately does NOT match — so every case would otherwise
    // emit an `enumerate_failed` reportError and break the cases asserting none.
    listAccounts: vi.fn(async () => ({ accounts: [] as string[] })),
  },
}));
vi.mock('../biometricKeystorePlugin', () => ({ BiometricKeystore: plugin }));

// --- Mock the registry repo (in-memory) ---
let store: PasskeyRegistration[] = [];
vi.mock('@/services/indexeddb/repositories/passkeyRepository', () => ({
  getPasskeysByFamily: vi.fn(async (familyId: string) =>
    store.filter((r) => r.familyId === familyId)
  ),
  savePasskeyRegistration: vi.fn(async (r: PasskeyRegistration) => {
    store = store.filter((x) => x.credentialId !== r.credentialId);
    store.push(r);
  }),
  removePasskeyRegistration: vi.fn(async (credentialId: string) => {
    store = store.filter((x) => x.credentialId !== credentialId);
  }),
  // Adoption reads the whole device registry and backfills names through updatePasskey.
  getAllPasskeys: vi.fn(async () => store),
  updatePasskey: vi.fn(async (credentialId: string, updates: Partial<PasskeyRegistration>) => {
    const i = store.findIndex((x) => x.credentialId === credentialId);
    if (i >= 0) store[i] = { ...store[i]!, ...updates, credentialId };
  }),
}));

// --- Mock family key export/import ---
vi.mock('@/services/crypto/familyKeyService', () => ({
  exportFamilyKey: vi.fn(async () => new Uint8Array(32)),
  importFamilyKey: vi.fn(async () => ({}) as CryptoKey),
}));

// --- Mock capabilities / telemetry / i18n ---
vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => true,
  getPlatform: () => 'android' as const,
}));
const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
// Hoisted (not a bare vi.fn) so the purge/adoption summary events can be asserted: the
// counts in them ARE the observability deliverable, so an untestable emit is not enough.
const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

/**
 * The context of the emitted event whose `action` matches — preferring the purge summary
 * when several share the action (see `eventsFor`).
 */
function eventContext(action: string): Record<string, unknown> | undefined {
  const matching = logEventMock.mock.calls
    .map((c) => c[0] as { message: string; context?: Record<string, unknown> })
    .filter((e) => (e.context as { action?: string } | undefined)?.action === action);
  const summary = matching.find((e) => e.message === 'purge_result');
  return (summary ?? matching[0])?.context;
}

/**
 * Every purge SUMMARY emitted with this `action`. Keyed on the message as well, because
 * `deleteBlob`'s own failure event deliberately carries the caller's `action` too.
 */
function eventsFor(action: string) {
  return logEventMock.mock.calls
    .map((c) => c[0] as { level: string; message: string; context?: { action?: string } })
    .filter((e) => e.message === 'purge_result' && e.context?.action === action);
}
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import {
  nativeEnable,
  nativeUnlock,
  nativeCanEnroll,
  nativeCanOffer,
  nativeResolveDeviceKeys,
  nativeReclaimFamilyKeystore,
  nativeReclaimAllKeystores,
  nativeDisable,
  nativeReconcileRoster,
  takeAdoptedTargets,
  __resetKeystoreSessionForTests,
} from '../nativeBiometric';
import * as repo from '@/services/indexeddb/repositories/passkeyRepository';

const SUPPRESS_KEY = 'beanies.biometricOfferSuppressedUntil';

function params(overrides: Record<string, unknown> = {}) {
  return {
    memberId: 'member-1',
    memberName: 'A',
    memberEmail: 'a@b.c',
    familyId: 'family-1',
    familyKey: {} as CryptoKey,
    ...overrides,
  };
}

/** A rejected plugin promise carrying a Capacitor-style typed `.code`. */
function rejectWith(code: string) {
  return async () => {
    throw Object.assign(new Error(code), { code });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store = [];
  localStorage.clear();
  plugin.isAvailable.mockResolvedValue({ available: true, biometryType: 'fingerprint' });
  plugin.setKey.mockResolvedValue({ keyBacking: 'strongbox' });
  plugin.getKey.mockResolvedValue({ keyB64: 'AAAA', keyBacking: 'strongbox' });
  plugin.hasKey.mockResolvedValue({ present: true });
  // deleteKey needs resetting too: `vi.clearAllMocks()` clears CALLS, not implementations,
  // so a case that makes the delete reject would otherwise leak into every case after it.
  plugin.deleteKey.mockResolvedValue(undefined);
  plugin.deleteAllKeys.mockResolvedValue({ deleted: true });
  plugin.listAccounts.mockResolvedValue({ accounts: [] });
  // The adoption single-flight, its shared time budget and the adopted-target set are
  // module-level, so without this one case's pass leaks into every case after it.
  __resetKeystoreSessionForTests();
});

describe('nativeEnable', () => {
  it('happy path: wraps the key, persists ONE native-keystore record, no passkeySecret', async () => {
    const result = await nativeEnable(params());
    expect(result.success).toBe(true);
    expect(result.passkeySecret).toBeUndefined();
    // Per MEMBER, not per family — this address is what lets two beans share a device.
    expect(plugin.setKey).toHaveBeenCalledWith({
      account: 'family-1:member-1',
      keyB64: expect.any(String),
    });
    expect(store).toHaveLength(1);
    expect(store[0]!.mechanism).toBe('native-keystore');
    expect(store[0]!.memberId).toBe('member-1');
  });

  it("KEEPS another member's record — enrolling does not evict a sibling (#76 reverses the old one-per-family invariant)", async () => {
    // This assertion is deliberately the inverse of what it was. Enable used to purge the
    // family's other native record, which is exactly why a second bean on a shared iPad
    // could never keep an enrolment. The credentialId is deterministic, so a re-enrol by
    // the SAME member still overwrites in place — see the next test.
    store.push({
      credentialId: 'native:family-1:member-1',
      memberId: 'member-1',
      familyId: 'family-1',
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: 'old',
      createdAt: '2026-01-01',
    });
    await nativeEnable(params({ memberId: 'member-2' }));
    const nativeRecords = store.filter((r) => r.mechanism === 'native-keystore');
    expect(nativeRecords.map((r) => r.memberId).sort()).toEqual(['member-1', 'member-2']);
  });

  it('re-enrolling the SAME member overwrites in place (deterministic credentialId)', async () => {
    await nativeEnable(params());
    await nativeEnable(params());
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
  });

  it('user cancel → cancelled, NO record, NO reportError, NO suppression', async () => {
    plugin.setKey.mockImplementation(rejectWith('userCancel'));
    const result = await nativeEnable(params());
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(store).toHaveLength(0);
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(SUPPRESS_KEY)).toBeNull();
  });

  it('hard error → suppression armed, reportError(warning), friendly error, NO record', async () => {
    plugin.setKey.mockImplementation(rejectWith('unknown'));
    const result = await nativeEnable(params());
    expect(result.success).toBe(false);
    expect(result.cancelled).toBeFalsy();
    expect(store).toHaveLength(0);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'native-biometric', severity: 'warning' })
    );
    expect(localStorage.getItem(SUPPRESS_KEY)).not.toBeNull();
  });

  it('a plugin-bridge throw with no code maps to a hard error (never a silent success)', async () => {
    plugin.setKey.mockImplementation(async () => {
      throw new Error('bridge blew up'); // no .code
    });
    const result = await nativeEnable(params());
    expect(result.success).toBe(false);
    expect(reportErrorMock).toHaveBeenCalled();
  });
});

describe('nativeUnlock', () => {
  // NB: takes 'legacy' rather than `undefined`, because passing `undefined` explicitly
  // triggers the default parameter — which silently made the legacy cases test the
  // per-member path instead.
  function seedRecord(scheme: 'per-member' | 'legacy' = 'per-member', memberId = 'member-1') {
    store.push({
      ...(scheme === 'per-member' ? { keystoreScheme: 'per-member' as const } : {}),
      memberId,
      credentialId: `native:family-1:${memberId}`,
      familyId: 'family-1',
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: 'this device',
      createdAt: '2026-01-01',
    });
  }

  it('happy path → familyKey + enrolling member', async () => {
    seedRecord();
    const result = await nativeUnlock('family-1', 'member-1');
    expect(result.success).toBe(true);
    expect(result.memberId).toBe('member-1');
    expect(result.familyKey).toBeTruthy();
  });

  it('member has no key on this device → MEMBER_MISMATCH, NO prompt, nothing cleared', async () => {
    // The regression guard for the shared-device case: asking for a bean who simply has
    // not enrolled here must not prompt, and must NOT be reported as an invalidated key —
    // telling a healthy user their biometrics changed is the wrong message entirely.
    seedRecord();
    const result = await nativeUnlock('family-1', 'member-2');
    expect(result.success).toBe(false);
    expect(result.error).toBe('MEMBER_MISMATCH');
    expect(plugin.getKey).not.toHaveBeenCalled();
    expect(plugin.deleteKey).not.toHaveBeenCalled();
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
  });

  it('OS key wiped (hasKey=false) → clears stale record + re-enroll, NO getKey prompt', async () => {
    seedRecord();
    plugin.hasKey.mockResolvedValue({ present: false });
    const result = await nativeUnlock('family-1', 'member-1');
    expect(result.success).toBe(false);
    expect(plugin.getKey).not.toHaveBeenCalled();
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
  });

  it('user cancel → cancelled, no error toast, record kept', async () => {
    seedRecord();
    plugin.getKey.mockImplementation(rejectWith('userCancel'));
    const result = await nativeUnlock('family-1', 'member-1');
    expect(result.cancelled).toBe(true);
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
  });

  it('invalidated → clears record + deleteKey + reportError(warning)', async () => {
    seedRecord();
    plugin.getKey.mockImplementation(rejectWith('invalidated'));
    const result = await nativeUnlock('family-1', 'member-1');
    expect(result.success).toBe(false);
    // A genuine OS invalidation is device-wide, so the family's keys go — per-member
    // addresses and the legacy one.
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-1' });
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1' });
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'native-biometric', severity: 'warning' })
    );
  });

  describe('pre-#76 enrolments keep working at the legacy address', () => {
    it('reads the legacy blob and does NOT migrate it', async () => {
      seedRecord('legacy'); // no keystoreScheme => legacy address
      const result = await nativeUnlock('family-1', 'member-1');

      expect(result.success).toBe(true);
      expect(plugin.getKey).toHaveBeenCalledWith({ account: 'family-1' });
      // Deliberately NOT re-homed. On Android `setKey` generates an auth-bound key and
      // fires a SECOND BiometricPrompt straight after the unlock the user just satisfied
      // — and if they dismiss it, the old blob is never cleaned up, so the double prompt
      // returns on every launch. Reading the legacy address forever is the cheaper truth.
      expect(plugin.setKey).not.toHaveBeenCalled();
      expect(plugin.deleteKey).not.toHaveBeenCalled();
    });

    it('a legacy member and a per-member sibling coexist on one device', async () => {
      // The regression that ended the migration design: whichever bean opened the app
      // first used to destroy the other's enrolment.
      seedRecord('legacy', 'member-1'); // enrolled before #76
      seedRecord('per-member', 'member-2'); // enrolled after

      expect((await nativeUnlock('family-1', 'member-1')).success).toBe(true);
      expect(plugin.getKey).toHaveBeenCalledWith({ account: 'family-1' });

      expect((await nativeUnlock('family-1', 'member-2')).success).toBe(true);
      expect(plugin.getKey).toHaveBeenCalledWith({ account: 'family-1:member-2' });

      // Both records survive; neither unlock disturbed the other.
      expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(2);
    });

    it('removing a legacy enrolment deletes the LEGACY blob, not an address it never used', async () => {
      seedRecord('legacy');
      await nativeDisable('family-1', 'member-1');
      expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1' });
      expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
    });

    it('key genuinely absent → absent_self_heal, no prompt', async () => {
      seedRecord();
      plugin.hasKey.mockResolvedValue({ present: false });
      const result = await nativeUnlock('family-1', 'member-1');
      expect(result.success).toBe(false);
      expect(plugin.getKey).not.toHaveBeenCalled();
      expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
    });

    it('a THROWN presence check does not delete the enrolment', async () => {
      // Android returns a transient failure here; treating that as absence would wipe a
      // perfectly good key, which is worse than the doomed prompt the probe avoids.
      seedRecord();
      plugin.hasKey.mockRejectedValue(new Error('keystore busy'));
      const result = await nativeUnlock('family-1', 'member-1');
      expect(result.success).toBe(true);
      expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
    });

    it('notEnrolled does NOT wipe the family (it can be a transient hardware state)', async () => {
      seedRecord('per-member', 'member-1');
      seedRecord('per-member', 'member-2');
      plugin.getKey.mockImplementation(rejectWith('notEnrolled'));

      await nativeUnlock('family-1', 'member-1');

      // Android maps ERROR_HW_UNAVAILABLE onto notEnrolled — a busy sensor must not
      // un-enrol the whole family.
      expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(2);
    });
  });

  it('lockout → friendly error, record NOT cleared (transient)', async () => {
    seedRecord();
    plugin.getKey.mockImplementation(rejectWith('lockout'));
    const result = await nativeUnlock('family-1', 'member-1');
    expect(result.success).toBe(false);
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
  });
});

describe('gating + device keys', () => {
  it('nativeCanEnroll ignores suppression; nativeCanOffer respects it', async () => {
    localStorage.setItem(SUPPRESS_KEY, String(Date.now() + 60_000));
    expect(await nativeCanEnroll()).toBe(true);
    expect(await nativeCanOffer()).toBe(false);
  });

  it('nativeCanEnroll false when the plugin reports no biometric available', async () => {
    plugin.isAvailable.mockResolvedValue({ available: false, biometryType: 'none' });
    expect(await nativeCanEnroll()).toBe(false);
  });

  it('nativeResolveDeviceKeys returns only native records and cleans up stale WebAuthn ones', async () => {
    store.push({
      credentialId: 'stale-webauthn',
      memberId: 'member-1',
      familyId: 'family-1',
      publicKey: 'pk',
      prfSupported: true,
      label: 'old passkey',
      createdAt: '2026-01-01',
    });
    expect(await nativeResolveDeviceKeys('family-1')).toHaveLength(0);
    // stale record was removed
    expect(vi.mocked(repo.removePasskeyRegistration)).toHaveBeenCalledWith('stale-webauthn');

    store.push({
      credentialId: 'native:family-1:member-1',
      memberId: 'member-1',
      familyId: 'family-1',
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: 'this device',
      createdAt: '2026-01-02',
    });
    const keys = await nativeResolveDeviceKeys('family-1');
    expect(keys).toHaveLength(1);
    expect(keys[0]!.memberId).toBe('member-1');
  });

  it('two members can each hold a key on the same device', async () => {
    // The invariant #76 deliberately reverses: before this, enable purged the family's
    // other native record, so a shared iPad could only ever sign in one bean.
    for (const memberId of ['member-1', 'member-2']) {
      store.push({
        credentialId: `native:family-1:${memberId}`,
        memberId,
        familyId: 'family-1',
        publicKey: '',
        prfSupported: false,
        mechanism: 'native-keystore',
        label: 'this device',
        createdAt: '2026-01-02',
      });
    }
    const keys = await nativeResolveDeviceKeys('family-1');
    expect(keys.map((k) => k.memberId).sort()).toEqual(['member-1', 'member-2']);
  });

  it('nativeReclaimFamilyKeystore deletes every per-member blob AND the legacy one', async () => {
    for (const memberId of ['member-1', 'member-2']) {
      store.push({
        keystoreScheme: 'per-member',
        credentialId: `native:family-1:${memberId}`,
        memberId,
        familyId: 'family-1',
        publicKey: '',
        prfSupported: false,
        mechanism: 'native-keystore',
        label: 'this device',
        createdAt: '2026-01-02',
      });
    }
    await nativeReclaimFamilyKeystore('family-1');
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-1' });
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-2' });
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1' });
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
  });

  it('a LEGACY-scheme record: reclaim removes the legacy blob AND that record', async () => {
    // The target set is keyed by ACCOUNT, and a legacy-scheme record's account IS the
    // bare familyId — the same key the always-added legacy target uses. Adding the bare
    // legacy target unconditionally would overwrite the record-derived entry, drop its
    // credentialId, and leave a registry record pointing at a blob that is now gone.
    store.push({
      credentialId: 'native:family-1:member-1', // no keystoreScheme => legacy address
      memberId: 'member-1',
      familyId: 'family-1',
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: 'this device',
      createdAt: '2026-01-02',
    });
    await nativeReclaimFamilyKeystore('family-1');
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1' });
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
    // One target, not two: the record and the legacy sweep address are the same blob.
    expect(eventContext('reclaim')?.detail).toBe('targets=1,failed=0');
  });
});

describe('no delete reports success it did not achieve (#82)', () => {
  function seedPerMember(memberId = 'member-1') {
    store.push({
      keystoreScheme: 'per-member',
      credentialId: `native:family-1:${memberId}`,
      memberId,
      familyId: 'family-1',
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: 'this device',
      createdAt: '2026-01-02',
    });
  }

  it('a REJECTING deleteKey during disable is reported, never swallowed', async () => {
    // This is the defect in miniature: the two bare `catch {}` blocks around deleteKey
    // meant key material that would not delete left no trace anywhere.
    seedPerMember();
    plugin.deleteKey.mockImplementation(rejectWith('unknown'));

    await nativeDisable('family-1', 'member-1');

    expect(eventContext('disable')).toMatchObject({
      action: 'disable',
      count: 0,
      detail: 'targets=1,failed=1',
    });
    expect(eventsFor('disable')[0]!.level).toBe('warn');
    const failure = logEventMock.mock.calls.find(
      (c) => (c[0] as { message: string }).message === 'blob_delete_failed'
    );
    expect(failure).toBeDefined();
  });

  it('a successful purge emits ONE info summary with the provably-gone count', async () => {
    seedPerMember();
    await nativeDisable('family-1', 'member-1');
    const events = eventsFor('disable');
    expect(events).toHaveLength(1);
    expect(events[0]!.level).toBe('info');
    expect(eventContext('disable')).toMatchObject({ count: 1, detail: 'targets=1,failed=0' });
  });

  it('a REJECTING hasKey does not delete the record — it falls through to the unlock', async () => {
    // Both plugins now reject hasKey on a missing account rather than reporting absence.
    // That must stay a logged non-event: absence is what drives the self-heal, and a
    // reject treated as absence is how a live enrolment gets deleted.
    seedPerMember();
    plugin.hasKey.mockImplementation(rejectWith('unknown'));

    const result = await nativeUnlock('family-1', 'member-1');

    expect(result.success).toBe(true);
    expect(plugin.getKey).toHaveBeenCalledWith({ account: 'family-1:member-1' });
    expect(plugin.deleteKey).not.toHaveBeenCalled();
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
    expect(eventContext('haskey_failed')).toBeDefined();
  });

  it('a registry record that will not delete still reports clear_record_failed', async () => {
    seedPerMember();
    vi.mocked(repo.removePasskeyRegistration).mockRejectedValueOnce(new Error('idb gone'));

    await nativeDisable('family-1', 'member-1');

    const failure = logEventMock.mock.calls.find(
      (c) => (c[0] as { message: string }).message === 'clear_record_failed'
    );
    expect(failure).toBeDefined();
    // The blob delete still happened — one target's record failure must not skip it.
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-1' });
  });
});

describe('nativeReclaimAllKeystores — the explicit clear-all sweep', () => {
  function seed(familyId: string, memberId: string) {
    store.push({
      keystoreScheme: 'per-member',
      credentialId: `native:${familyId}:${memberId}`,
      memberId,
      familyId,
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: 'this device',
      createdAt: '2026-01-02',
    });
  }

  it('one service-wide delete, with no enumeration and no per-family loop', async () => {
    seed('family-1', 'member-1');
    seed('family-2', 'member-2');

    await nativeReclaimAllKeystores(['family-1', 'family-2']);

    expect(plugin.deleteAllKeys).toHaveBeenCalledTimes(1);
    // The whole point: the sweep needs no account, so it cannot miss a gated item.
    expect(plugin.deleteKey).not.toHaveBeenCalled();
    expect(eventContext('sweep')).toMatchObject({ action: 'sweep', detail: 'deleted=true' });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('an empty device still resolves cleanly — nothing there is not a failure', async () => {
    plugin.deleteAllKeys.mockResolvedValue({ deleted: false });
    await nativeReclaimAllKeystores([]);
    expect(eventContext('sweep')).toMatchObject({ detail: 'deleted=false' });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('a REJECTING deleteAllKeys reports sweep_failed and falls back to per-family reclaim', async () => {
    // Simulates the #74 class: a Swift @objc func that exists but was never added to
    // pluginMethods. Without the fallback the caller deletes the registry records, the
    // user is told their data is cleared, and every blob survives with nothing left
    // that knows its address — strictly worse than the loop this replaced.
    seed('family-1', 'member-1');
    seed('family-2', 'member-2');
    plugin.deleteAllKeys.mockImplementation(async () => {
      throw new Error('not implemented on ios');
    });

    await nativeReclaimAllKeystores(['family-1', 'family-2']);

    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'native-biometric',
        severity: 'warning',
        context: expect.objectContaining({ action: 'sweep_failed' }),
      })
    );
    // Every blob the registry knows about is still deleted, via long-shipped deleteKey.
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-1' });
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-2:member-2' });
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1' });
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-2' });
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
  });

  it('never reports a clean device having deleted nothing', async () => {
    seed('family-1', 'member-1');
    plugin.deleteAllKeys.mockImplementation(async () => {
      throw new Error('not implemented on ios');
    });
    plugin.deleteKey.mockImplementation(rejectWith('unknown'));

    await nativeReclaimAllKeystores(['family-1']);

    // Both layers speak: the sweep failed, AND the fallback's purge says what survived.
    expect(eventContext('sweep_failed') ?? reportErrorMock.mock.calls[0]?.[0]).toBeDefined();
    expect(eventContext('reclaim')).toMatchObject({ count: 0 });
    expect(eventsFor('reclaim')[0]!.level).toBe('warn');
  });

  it('does not throw when the sweep AND the fallback both fail', async () => {
    // It is a sign-out step: a throw here becomes a caught step failure with no
    // statement of what survived, which is the outcome this whole change removes.
    plugin.deleteAllKeys.mockImplementation(async () => {
      throw new Error('boom');
    });
    plugin.deleteKey.mockImplementation(rejectWith('unknown'));
    await expect(nativeReclaimAllKeystores(['family-1'])).resolves.toBeUndefined();
  });
});

describe('keystore enumeration + adoption (#82)', () => {
  function seeded(
    familyId: string,
    memberId: string,
    scheme: 'per-member' | 'legacy' = 'per-member'
  ) {
    return {
      ...(scheme === 'per-member' ? { keystoreScheme: 'per-member' as const } : {}),
      credentialId: `native:${familyId}:${memberId}`,
      memberId,
      familyId,
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore' as const,
      label: 'this device',
      createdAt: '2026-01-02',
    };
  }

  describe('the account parser', () => {
    it('adopts a per-member account, never a legacy or malformed one', async () => {
      plugin.listAccounts.mockResolvedValue({
        accounts: [
          'family-1:member-1', // per-member, unknown => adopted
          'family-1', // legacy: encodes no member, so no record is constructible
          'family-1:member-2:extra', // malformed: a second colon is not our scheme
          'family-1:', // malformed: empty member
          '', // malformed: not a family id
        ],
      });

      const keys = await nativeResolveDeviceKeys('family-1');

      expect(keys.map((k) => k.memberId)).toEqual(['member-1']);
      expect(eventContext('adopt')).toMatchObject({
        count: 5,
        detail: 'adopted=1,registered=0,legacy=1,malformed=3',
      });
    });

    it('a malformed account is still RECLAIMABLE under the family before its first colon', async () => {
      // The conservative reading: it is the only claim the string supports, and it keeps
      // family-scoped reclaim able to remove material we cannot otherwise attribute.
      plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:member-2:extra'] });
      await nativeReclaimFamilyKeystore('family-1');
      expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-2:extra' });
    });
  });

  describe('the adoption pass', () => {
    it('writes a record for an orphaned blob, so biometric unlock survives a reinstall', async () => {
      // The reinstall case: the keychain item is still there, the registry is empty.
      plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:member-1'] });

      const keys = await nativeResolveDeviceKeys('family-1');

      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({
        memberId: 'member-1',
        familyId: 'family-1',
        mechanism: 'native-keystore',
        keystoreScheme: 'per-member',
      });
      // No memberName — nothing on the device knows it. The label carries the id tail so
      // two adopted cards stay distinguishable on the picker.
      expect(keys[0]!.memberName).toBeUndefined();
      expect(keys[0]!.label).toContain('member-1'.slice(-8));
      // Adoption NEVER deletes.
      expect(plugin.deleteKey).not.toHaveBeenCalled();
    });

    it('does not re-adopt a blob that already has a record', async () => {
      store.push(seeded('family-1', 'member-1'));
      plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:member-1'] });

      await nativeResolveDeviceKeys('family-1');

      expect(store).toHaveLength(1);
      expect(eventContext('adopt')).toMatchObject({
        detail: 'adopted=0,registered=1,legacy=0,malformed=0',
      });
    });

    it('a member with an existing LEGACY-scheme record is not adopted at the new address', async () => {
      // nativeCredentialId does not encode the scheme, so the legacy record suppresses
      // adoption. Correct and harmless: the union still reaches the per-member blob.
      store.push(seeded('family-1', 'member-1', 'legacy'));
      plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:member-1'] });

      await nativeResolveDeviceKeys('family-1');
      expect(store).toHaveLength(1);
      expect(store[0]!.keystoreScheme).toBeUndefined();

      await nativeReclaimFamilyKeystore('family-1');
      expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-1' });
    });

    it('enumerated=0 with registered>0 is emitted as ONE self-proving contradiction', async () => {
      // Records exist, therefore blobs must exist, therefore the query is excluding
      // them — the 0.13R2 failure visible in a single log line rather than a fleet count.
      store.push(seeded('family-1', 'member-1'));
      plugin.listAccounts.mockResolvedValue({ accounts: [] });

      await nativeResolveDeviceKeys('family-1');

      expect(eventContext('adopt')).toMatchObject({
        count: 0,
        detail: 'adopted=0,registered=1,legacy=0,malformed=0',
      });
    });

    it('a REJECTING enumeration reports enumerate_failed and adopts nothing', async () => {
      plugin.listAccounts.mockImplementation(rejectWith('unknown'));

      const keys = await nativeResolveDeviceKeys('family-1');

      expect(keys).toEqual([]);
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warning',
          context: expect.objectContaining({ action: 'enumerate_failed' }),
        })
      );
    });

    it('a MISSING method takes enumerate_unsupported, not the #74 plugin-missing signal', async () => {
      plugin.listAccounts.mockImplementation(async () => {
        throw new Error('not implemented on android');
      });

      await nativeResolveDeviceKeys('family-1');

      expect(eventContext('enumerate_unsupported')).toBeDefined();
      expect(eventContext('plugin-missing')).toBeUndefined();
      expect(reportErrorMock).not.toHaveBeenCalled();
    });

    it('a failing getAllPasskeys aborts adoption without changing the existing degrade', async () => {
      plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:member-1'] });
      vi.mocked(repo.getAllPasskeys).mockRejectedValueOnce(new Error('idb gone'));

      const keys = await nativeResolveDeviceKeys('family-1');

      expect(keys).toEqual([]);
      expect(store).toHaveLength(0);
      expect(eventContext('adopt_registry_read_failed')).toBeDefined();
    });

    it('one failing write is counted and does not abandon the rest of the device', async () => {
      plugin.listAccounts.mockResolvedValue({
        accounts: ['family-1:member-1', 'family-1:member-2'],
      });
      vi.mocked(repo.savePasskeyRegistration).mockRejectedValueOnce(new Error('quota'));

      await nativeResolveDeviceKeys('family-1');

      expect(store).toHaveLength(1);
      expect(eventContext('adopt_write_failed')).toBeDefined();
      expect(eventContext('adopt')).toMatchObject({
        detail: 'adopted=1,registered=0,legacy=0,malformed=0',
      });
    });

    it('adopts for EVERY family in one pass, not just the one being resolved', async () => {
      plugin.listAccounts.mockResolvedValue({
        accounts: ['family-1:member-1', 'family-2:member-2'],
      });

      await nativeResolveDeviceKeys('family-1');

      // Family 2's blob is now visible to family 2's own reclaim path too, which is the
      // point: it was previously reachable by nothing at all.
      expect(store.map((r) => r.familyId).sort()).toEqual(['family-1', 'family-2']);
    });
  });

  describe('the session budget is shared, not per caller', () => {
    it('AT MOST one adoption enumeration across many resolves and an unlock', async () => {
      store.push(seeded('family-1', 'member-1'));
      plugin.listAccounts.mockResolvedValue({ accounts: [] });

      await nativeResolveDeviceKeys('family-1');
      await nativeResolveDeviceKeys('family-2');
      await nativeResolveDeviceKeys('family-3');
      await nativeUnlock('family-1', 'member-1');

      // Only the adoption pass is memoized; this asserts the memoization, not reclaim's.
      expect(plugin.listAccounts).toHaveBeenCalledTimes(1);
    });

    it('nativeDisable triggers NO enumeration at all', async () => {
      store.push(seeded('family-1', 'member-1'));
      await nativeDisable('family-1', 'member-1');
      expect(plugin.listAccounts).not.toHaveBeenCalled();
    });

    it('nativeReclaimFamilyKeystore enumerates once PER CALL, by design', async () => {
      // A session-old list could miss a blob written since, and reclaim is rare and
      // user-initiated. This is intended behaviour, not a violation of the budget.
      await nativeReclaimFamilyKeystore('family-1');
      await nativeReclaimFamilyKeystore('family-2');
      expect(plugin.listAccounts).toHaveBeenCalledTimes(2);
    });

    it('a NEVER-RESOLVING enumeration costs ONE budget across three families', async () => {
      vi.useFakeTimers();
      try {
        plugin.listAccounts.mockImplementation(() => new Promise(() => {}));

        const done = (async () => {
          await nativeResolveDeviceKeys('family-1');
          await nativeResolveDeviceKeys('family-2');
          await nativeResolveDeviceKeys('family-3');
          return 'settled';
        })();

        // One budget, not three: a per-caller timer would need 3 × 1500ms here, which is
        // 4.5s before the family picker's first paint on a three-family device.
        await vi.advanceTimersByTimeAsync(1500);
        await expect(done).resolves.toBe('settled');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a hung enumeration still lets nativeUnlock return', async () => {
      vi.useFakeTimers();
      try {
        store.push(seeded('family-1', 'member-1'));
        plugin.listAccounts.mockImplementation(() => new Promise(() => {}));

        const unlock = nativeUnlock('family-1', 'member-1');
        await vi.advanceTimersByTimeAsync(1500);

        await expect(unlock).resolves.toMatchObject({ success: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('never rejects, even with a throwing plugin AND a throwing repo', async () => {
      plugin.listAccounts.mockImplementation(async () => {
        throw new Error('boom');
      });
      vi.mocked(repo.getPasskeysByFamily).mockRejectedValueOnce(new Error('idb gone'));
      await expect(nativeResolveDeviceKeys('family-1')).resolves.toEqual([]);
    });
  });

  describe('the union reclaim', () => {
    it('deletes a blob that has NO registry record', async () => {
      plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:ghost'] });
      await nativeReclaimFamilyKeystore('family-1');
      expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:ghost' });
    });

    it('still removes a registry record whose blob is already gone', async () => {
      // The converse hole a purely keychain-driven reclaim would open: dead records
      // render as dead buttons on the chooser.
      store.push(seeded('family-1', 'member-1'));
      plugin.listAccounts.mockResolvedValue({ accounts: [] });
      await nativeReclaimFamilyKeystore('family-1');
      expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
    });

    it("NEVER touches another family's account", async () => {
      plugin.listAccounts.mockResolvedValue({
        accounts: ['family-1:member-1', 'family-2:member-2'],
      });
      await nativeReclaimFamilyKeystore('family-1');
      expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:member-1' });
      expect(plugin.deleteKey).not.toHaveBeenCalledWith({ account: 'family-2:member-2' });
    });

    it('a record and its enumerated blob are ONE target, keeping the credentialId', async () => {
      store.push(seeded('family-1', 'member-1'));
      plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:member-1'] });

      await nativeReclaimFamilyKeystore('family-1');

      // Two targets: the member's account (deduped) and the legacy sweep address.
      expect(eventContext('reclaim')).toMatchObject({ detail: 'targets=2,failed=0' });
      expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
    });

    it('an EMPTY or failed enumeration never causes a deletion of its own', async () => {
      plugin.listAccounts.mockImplementation(rejectWith('unknown'));
      await nativeReclaimFamilyKeystore('family-1');
      // Only the legacy sweep address, which is unconditional and always has been.
      expect(plugin.deleteKey).toHaveBeenCalledTimes(1);
      expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1' });
    });
  });

  describe('adopted targets drain PER FAMILY', () => {
    it("taking family A's targets leaves family B's untouched", async () => {
      // The cross-family defect this type exists to prevent: adoption spans every family,
      // so a wholesale drain tested against A's roster would delete B's live enrolments.
      plugin.listAccounts.mockResolvedValue({
        accounts: ['family-1:member-1', 'family-2:member-2'],
      });
      await nativeResolveDeviceKeys('family-1');

      const a = takeAdoptedTargets('family-1');
      expect(a.map((t) => t.memberId)).toEqual(['member-1']);
      // Drained: an empty second take means "nothing adopted" AND "already reconciled",
      // which is why no separate done-flag is needed.
      expect(takeAdoptedTargets('family-1')).toEqual([]);
      // B is still waiting for whenever (if ever) it becomes the active family.
      expect(takeAdoptedTargets('family-2').map((t) => t.memberId)).toEqual(['member-2']);
    });
  });
});

describe('roster reconcile — requirement 4, and the cross-family defect it must not have', () => {
  /** Adopt blobs for the given accounts, as a post-reinstall session would. */
  async function adopt(accounts: string[]) {
    plugin.listAccounts.mockResolvedValue({ accounts });
    await nativeResolveDeviceKeys(accounts[0]!.split(':')[0]!);
    plugin.deleteKey.mockClear();
  }

  it('a member removed while the app was uninstalled loses their blob', async () => {
    await adopt(['family-1:member-1', 'family-1:ghost']);

    await nativeReconcileRoster('family-1', [{ id: 'member-1', name: 'Ada' }]);

    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1:ghost' });
    expect(plugin.deleteKey).not.toHaveBeenCalledWith({ account: 'family-1:member-1' });
    expect(store.map((r) => r.memberId)).toEqual(['member-1']);
  });

  it("family A's roster deletes NOTHING belonging to family B", async () => {
    // THE defect this design exists to prevent. Adoption is all-families, so a wholesale
    // drain judged against A's roster would delete B's live enrolment — at info, as a
    // successful reconcile — and the member would lose biometric unlock on a family that
    // was never involved.
    await adopt(['family-1:member-1', 'family-2:grandparent']);

    await nativeReconcileRoster('family-1', [{ id: 'member-1', name: 'Ada' }]);

    expect(plugin.deleteKey).not.toHaveBeenCalled();
    expect(store.map((r) => r.familyId).sort()).toEqual(['family-1', 'family-2']);
    // And B's own reconcile, when B becomes active, still works on B's own targets.
    await nativeReconcileRoster('family-2', [{ id: 'someone-else', name: 'Bo' }]);
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-2:grandparent' });
  });

  it('backfills the real member name over the adopted id-tail label', async () => {
    await adopt(['family-1:member-1']);
    expect(store[0]!.memberName).toBeUndefined();

    await nativeReconcileRoster('family-1', [{ id: 'member-1', name: 'Ada' }]);

    expect(store[0]!.memberName).toBe('Ada');
  });

  it('a member PRESENT in the roster survives repeated roster mutations', async () => {
    await adopt(['family-1:member-1']);
    const roster = [{ id: 'member-1', name: 'Ada' }];

    await nativeReconcileRoster('family-1', roster);
    await nativeReconcileRoster('family-1', roster);
    await nativeReconcileRoster('family-1', roster);

    expect(plugin.deleteKey).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
  });

  it('is a one-shot per family: the drain IS the already-reconciled flag', async () => {
    await adopt(['family-1:member-1']);
    // First pass keeps the member (they are on the roster).
    await nativeReconcileRoster('family-1', [{ id: 'member-1', name: 'Ada' }]);
    // A later pass with an EMPTY-ish roster cannot delete them: the targets are drained,
    // so there is nothing this path is permitted to touch.
    await nativeReconcileRoster('family-1', [{ id: 'someone-else', name: 'Bo' }]);
    expect(plugin.deleteKey).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
  });

  it('a record registered BEFORE this session is never deletable by this path', async () => {
    // Only adopted targets are in scope. A legitimately-enrolled member who happens not
    // to be on a partially-loaded roster must not lose their key here.
    store.push({
      keystoreScheme: 'per-member',
      credentialId: 'native:family-1:long-standing',
      memberId: 'long-standing',
      familyId: 'family-1',
      publicKey: '',
      prfSupported: false,
      mechanism: 'native-keystore',
      label: 'this device',
      createdAt: '2026-01-02',
    });
    plugin.listAccounts.mockResolvedValue({ accounts: ['family-1:long-standing'] });
    await nativeResolveDeviceKeys('family-1');

    await nativeReconcileRoster('family-1', [{ id: 'someone-else', name: 'Bo' }]);

    expect(plugin.deleteKey).not.toHaveBeenCalled();
    expect(store).toHaveLength(1);
  });

  it('an enumeration failure means no adopted set, so the pass does nothing', async () => {
    plugin.listAccounts.mockImplementation(rejectWith('unknown'));
    await nativeResolveDeviceKeys('family-1');

    await nativeReconcileRoster('family-1', [{ id: 'member-1', name: 'Ada' }]);

    expect(plugin.deleteKey).not.toHaveBeenCalled();
  });

  it('a failing name backfill is reported and does not abort the pass', async () => {
    await adopt(['family-1:member-1', 'family-1:member-2']);
    vi.mocked(repo.updatePasskey).mockRejectedValueOnce(new Error('idb gone'));

    await nativeReconcileRoster('family-1', [
      { id: 'member-1', name: 'Ada' },
      { id: 'member-2', name: 'Bo' },
    ]);

    expect(eventContext('roster_backfill_failed')).toBeDefined();
    // The second member still got their name.
    expect(store.find((r) => r.memberId === 'member-2')!.memberName).toBe('Bo');
  });
});
