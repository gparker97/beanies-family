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
  nativeDisable,
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
