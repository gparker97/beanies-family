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
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import {
  nativeEnable,
  nativeUnlock,
  nativeCanEnroll,
  nativeCanOffer,
  nativeHasRegistered,
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
});

describe('nativeEnable', () => {
  it('happy path: wraps the key, persists ONE native-keystore record, no passkeySecret', async () => {
    const result = await nativeEnable(params());
    expect(result.success).toBe(true);
    expect(result.passkeySecret).toBeUndefined();
    expect(plugin.setKey).toHaveBeenCalledWith({ account: 'family-1', keyB64: expect.any(String) });
    expect(store).toHaveLength(1);
    expect(store[0]!.mechanism).toBe('native-keystore');
    expect(store[0]!.memberId).toBe('member-1');
  });

  it('replaces a prior native record for the family (one-record invariant, last-writer-wins)', async () => {
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
    expect(nativeRecords).toHaveLength(1);
    expect(nativeRecords[0]!.memberId).toBe('member-2');
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
  function seedRecord() {
    store.push({
      credentialId: 'native:family-1:member-1',
      memberId: 'member-1',
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
    const result = await nativeUnlock('family-1');
    expect(result.success).toBe(true);
    expect(result.memberId).toBe('member-1');
    expect(result.familyKey).toBeTruthy();
  });

  it('no record → clean failure, no prompt', async () => {
    const result = await nativeUnlock('family-1');
    expect(result.success).toBe(false);
    expect(plugin.getKey).not.toHaveBeenCalled();
  });

  it('OS key wiped (hasKey=false) → clears stale record + re-enroll, NO getKey prompt', async () => {
    seedRecord();
    plugin.hasKey.mockResolvedValue({ present: false });
    const result = await nativeUnlock('family-1');
    expect(result.success).toBe(false);
    expect(plugin.getKey).not.toHaveBeenCalled();
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
  });

  it('user cancel → cancelled, no error toast, record kept', async () => {
    seedRecord();
    plugin.getKey.mockImplementation(rejectWith('userCancel'));
    const result = await nativeUnlock('family-1');
    expect(result.cancelled).toBe(true);
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
  });

  it('invalidated → clears record + deleteKey + reportError(warning)', async () => {
    seedRecord();
    plugin.getKey.mockImplementation(rejectWith('invalidated'));
    const result = await nativeUnlock('family-1');
    expect(result.success).toBe(false);
    expect(plugin.deleteKey).toHaveBeenCalledWith({ account: 'family-1' });
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(0);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'native-biometric', severity: 'warning' })
    );
  });

  it('lockout → friendly error, record NOT cleared (transient)', async () => {
    seedRecord();
    plugin.getKey.mockImplementation(rejectWith('lockout'));
    const result = await nativeUnlock('family-1');
    expect(result.success).toBe(false);
    expect(store.filter((r) => r.mechanism === 'native-keystore')).toHaveLength(1);
  });
});

describe('gating + hasRegistered', () => {
  it('nativeCanEnroll ignores suppression; nativeCanOffer respects it', async () => {
    localStorage.setItem(SUPPRESS_KEY, String(Date.now() + 60_000));
    expect(await nativeCanEnroll()).toBe(true);
    expect(await nativeCanOffer()).toBe(false);
  });

  it('nativeCanEnroll false when the plugin reports no biometric available', async () => {
    plugin.isAvailable.mockResolvedValue({ available: false, biometryType: 'none' });
    expect(await nativeCanEnroll()).toBe(false);
  });

  it('nativeHasRegistered counts only native records and cleans up stale WebAuthn ones', async () => {
    store.push({
      credentialId: 'stale-webauthn',
      memberId: 'member-1',
      familyId: 'family-1',
      publicKey: 'pk',
      prfSupported: true,
      label: 'old passkey',
      createdAt: '2026-01-01',
    });
    expect(await nativeHasRegistered('family-1')).toBe(false);
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
    expect(await nativeHasRegistered('family-1')).toBe(true);
  });
});
