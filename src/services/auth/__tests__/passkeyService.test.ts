/**
 * passkeyService tests — Phase 4 of the 2026-08-28 login rethink.
 *
 * The web WebAuthn+PRF path is RETIRED: on web the service refuses register/auth
 * cleanly (no WebAuthn ceremony) and feature detection answers false. Native
 * delegates everything to the Keystore path (`nativeBiometric.ts`, ADR-029).
 * What remains on web is registry management of leftover registrations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PasskeyRegistration } from '@/types/models';

// --- Mock passkeyRepository ---
vi.mock('@/services/indexeddb/repositories/passkeyRepository', () => ({
  getPasskeysByFamily: vi.fn(async (): Promise<PasskeyRegistration[]> => []),
  savePasskeyRegistration: vi.fn(async () => {}),
  updatePasskey: vi.fn(async () => {}),
  getPasskeysByMember: vi.fn(async (): Promise<PasskeyRegistration[]> => []),
  getAllPasskeys: vi.fn(async (): Promise<PasskeyRegistration[]> => []),
  removePasskeyRegistration: vi.fn(async () => {}),
  getPasskeyByCredentialId: vi.fn(async (): Promise<PasskeyRegistration | null> => null),
}));

// --- Mock capabilities (native seam) + telemetry + i18n ---
const { isNativeMock } = vi.hoisted(() => ({
  isNativeMock: vi.fn(() => false),
}));
vi.mock('@/services/sync/capabilities', () => ({
  isNative: isNativeMock,
  getPlatform: vi.fn(() => 'web'),
}));
// Native Keystore path is a separate module (ADR-029) — mock it so these tests
// never pull in the Capacitor plugin, and so we can assert the isNative() delegation.
const { nativeMocks } = vi.hoisted(() => ({
  nativeMocks: {
    nativeEnable: vi.fn(async () => ({ success: true, prfSupported: false })),
    nativeUnlock: vi.fn(async () => ({ success: true, memberId: 'member-1' })),
    nativeCanEnroll: vi.fn(async () => true),
    nativeCanOffer: vi.fn(async () => true),
    nativeResolveDeviceKeys: vi.fn(async (): Promise<unknown[]> => []),
    nativeReclaimFamilyKeystore: vi.fn(async () => {}),
    nativeDisable: vi.fn(async () => {}),
  },
}));
vi.mock('../nativeBiometric', () => nativeMocks);
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
// Translation store: return the KEY so `tr()` uses its English fallback (the
// fallback is what a user sees when no translation is loaded — what we assert on).
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

// Imports must come after vi.mock calls
import {
  bufferToBase64url,
  base64urlToBuffer,
  bufferToBase64,
  base64ToBuffer,
  guessAuthenticatorLabel,
  authenticateWithPasskey,
  registerPasskeyForMember,
  getRpId,
  resolveDeviceKeys,
  canOfferBiometric,
  canEnrollBiometric,
  removePasskey,
  MEMBER_MISMATCH,
} from '../passkeyService';
import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';

// --- Helpers ---

function makeRegistration(overrides: Partial<PasskeyRegistration> = {}): PasskeyRegistration {
  return {
    credentialId: 'dGVzdC1jcmVkZW50aWFs', // base64url of "test-credential"
    memberId: 'member-1',
    familyId: 'family-1',
    publicKey: 'pubkey-base64',
    transports: ['internal'],
    prfSupported: false,
    label: 'Windows Hello',
    createdAt: '2026-01-01',
    ...overrides,
  };
}

/** Stub navigator with spied credentials.create/get so we can assert WebAuthn NEVER runs. */
function stubNavigatorCredentials(): {
  createMock: ReturnType<typeof vi.fn>;
  getMock: ReturnType<typeof vi.fn>;
} {
  const createMock = vi.fn();
  const getMock = vi.fn();
  vi.stubGlobal('navigator', {
    ...navigator,
    credentials: { create: createMock, get: getMock },
    userAgent: navigator.userAgent,
  });
  return { createMock, getMock };
}

const registerParams = {
  memberId: 'member-1',
  memberName: 'Test User',
  memberEmail: 'test@example.com',
  familyId: 'family-1',
  familyKey: {} as CryptoKey,
};

// --- Tests ---

describe('getRpId — WebAuthn Relying Party ID (survives only for Signal API cleanup)', () => {
  it('returns the current origin hostname', () => {
    expect(getRpId()).toBe(window.location.hostname);
  });
});

describe('native delegation — passkeyService routes to the Keystore path on native (#52)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativeMock.mockReturnValue(true);
  });
  afterEach(() => isNativeMock.mockReturnValue(false));

  it('registerPasskeyForMember delegates to nativeEnable (WebAuthn create never runs)', async () => {
    const { createMock } = stubNavigatorCredentials();
    const result = await registerPasskeyForMember(registerParams);
    expect(nativeMocks.nativeEnable).toHaveBeenCalledWith(registerParams);
    expect(createMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('authenticateWithPasskey delegates to nativeUnlock (WebAuthn get never runs)', async () => {
    const { getMock } = stubNavigatorCredentials();
    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(nativeMocks.nativeUnlock).toHaveBeenCalledWith('family-1', 'member-1');
    expect(getMock).not.toHaveBeenCalled();
    expect(result.memberId).toBe('member-1');
  });

  it('canEnrollBiometric / canOfferBiometric / resolveDeviceKeys delegate to the native helpers', async () => {
    expect(await canEnrollBiometric()).toBe(true);
    expect(await canOfferBiometric()).toBe(true);
    await resolveDeviceKeys('family-1');
    expect(nativeMocks.nativeCanEnroll).toHaveBeenCalled();
    expect(nativeMocks.nativeCanOffer).toHaveBeenCalled();
    expect(nativeMocks.nativeResolveDeviceKeys).toHaveBeenCalledWith('family-1');
  });

  it('returns MEMBER_MISMATCH when native reports the member has no key on this device', async () => {
    nativeMocks.nativeUnlock.mockResolvedValueOnce({
      success: false,
      error: MEMBER_MISMATCH,
    } as never);
    const result = await authenticateWithPasskey({
      familyId: 'family-1',
      memberId: 'member-2',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(MEMBER_MISMATCH);
  });
});

describe('web refusal — the WebAuthn ceremony is retired (Phase 4, 2026-08-28)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativeMock.mockReturnValue(false);
  });

  it('registerPasskeyForMember refuses cleanly with friendly copy and never touches navigator.credentials', async () => {
    const { createMock, getMock } = stubNavigatorCredentials();

    const result = await registerPasskeyForMember(registerParams);

    expect(result.success).toBe(false);
    expect(result.cancelled).toBeFalsy();
    expect(result.passkeySecret).toBeUndefined();
    // Friendly copy (the tr() English fallback), never a raw/technical string.
    expect(result.error).toBe("Biometric unlock isn't available on this device right now.");
    // NO WebAuthn ceremony of any kind, and nothing persisted.
    expect(createMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(passkeyRepo.savePasskeyRegistration).not.toHaveBeenCalled();
  });

  it('authenticateWithPasskey refuses cleanly and never touches navigator.credentials', async () => {
    const { createMock, getMock } = stubNavigatorCredentials();

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Biometric unlock isn't available on this device right now.");
    expect(result.familyKey).toBeUndefined();
    expect(createMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('canEnrollBiometric and canOfferBiometric answer false on web without consulting anything', async () => {
    // A platform authenticator being present must NOT change the answer — the web
    // path is retired, not feature-detected. Suppression machinery is not consulted.
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn(async () => true),
    });
    localStorage.clear(); // no suppression record either way

    expect(await canEnrollBiometric()).toBe(false);
    expect(await canOfferBiometric()).toBe(false);
    expect(nativeMocks.nativeCanEnroll).not.toHaveBeenCalled();
    expect(nativeMocks.nativeCanOffer).not.toHaveBeenCalled();
  });
});

describe('resolveDeviceKeys — web registry read (leftover registrations, Phase 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativeMock.mockReturnValue(false);
  });

  it('reads leftover registrations from the repo for the family', async () => {
    vi.mocked(passkeyRepo.getPasskeysByFamily).mockResolvedValueOnce([
      makeRegistration({ credentialId: 'a', memberId: 'member-1' }),
    ]);

    const keys = await resolveDeviceKeys('family-1');

    expect(passkeyRepo.getPasskeysByFamily).toHaveBeenCalledWith('family-1');
    expect(keys.map((k) => k.memberId)).toEqual(['member-1']);
    expect(nativeMocks.nativeResolveDeviceKeys).not.toHaveBeenCalled();
  });

  it('de-duplicates by member so one person never appears twice in the chooser', async () => {
    // The retired synced-credential path could have written a SECOND record for the
    // same member, which would otherwise render two identical buttons under
    // "who's signing in?".
    vi.mocked(passkeyRepo.getPasskeysByFamily).mockResolvedValueOnce([
      makeRegistration({ credentialId: 'a', memberId: 'member-1' }),
      makeRegistration({ credentialId: 'b', memberId: 'member-1', label: 'iPhone (synced)' }),
      makeRegistration({ credentialId: 'c', memberId: 'member-2' }),
    ]);

    const keys = await resolveDeviceKeys('family-1');

    expect(keys.map((k) => k.memberId)).toEqual(['member-1', 'member-2']);
    // First record per member wins.
    expect(keys.map((k) => k.credentialId)).toEqual(['a', 'c']);
  });

  it('a broken registry degrades to "no keys" instead of throwing', async () => {
    // It used to THROW out of three views' onMounted, leaving a spinner up forever.
    vi.mocked(passkeyRepo.getPasskeysByFamily).mockRejectedValueOnce(new Error('db blocked'));

    expect(await resolveDeviceKeys('family-1')).toEqual([]);
  });
});

describe('removePasskey — native-vs-web routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes (familyId, memberId) to nativeDisable for a native-keystore record — not a credentialId', async () => {
    vi.mocked(passkeyRepo.getPasskeyByCredentialId).mockResolvedValueOnce(
      makeRegistration({
        credentialId: 'native:family-1:member-1',
        mechanism: 'native-keystore',
      })
    );
    await removePasskey('native:family-1:member-1');
    expect(nativeMocks.nativeDisable).toHaveBeenCalledWith('family-1', 'member-1');
    // Native records never go through the web registry removal.
    expect(passkeyRepo.removePasskeyRegistration).not.toHaveBeenCalled();
  });

  it('removes a web registration from the registry and signals the platform authenticator', async () => {
    vi.mocked(passkeyRepo.getPasskeyByCredentialId).mockResolvedValueOnce(makeRegistration());
    const signalMock = vi.fn(async () => {});
    vi.stubGlobal('PublicKeyCredential', { signalUnknownCredential: signalMock });

    await removePasskey('dGVzdC1jcmVkZW50aWFs');

    expect(passkeyRepo.removePasskeyRegistration).toHaveBeenCalledWith('dGVzdC1jcmVkZW50aWFs');
    expect(nativeMocks.nativeDisable).not.toHaveBeenCalled();
    expect(signalMock).toHaveBeenCalledWith({
      rpId: window.location.hostname,
      credentialId: 'dGVzdC1jcmVkZW50aWFs',
    });
  });

  it('still removes the registration when the Signal API is unavailable (best-effort)', async () => {
    vi.mocked(passkeyRepo.getPasskeyByCredentialId).mockResolvedValueOnce(makeRegistration());
    vi.stubGlobal('PublicKeyCredential', undefined);

    await removePasskey('dGVzdC1jcmVkZW50aWFs');

    expect(passkeyRepo.removePasskeyRegistration).toHaveBeenCalledWith('dGVzdC1jcmVkZW50aWFs');
  });
});

describe('Encoding utilities', () => {
  it('bufferToBase64url / base64urlToBuffer roundtrip preserves bytes', () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 63, 62, 43]);
    const encoded = bufferToBase64url(original.buffer as ArrayBuffer);
    const decoded = new Uint8Array(base64urlToBuffer(encoded));
    expect(decoded).toEqual(original);
  });

  it('bufferToBase64 / base64ToBuffer roundtrip preserves bytes', () => {
    const original = new Uint8Array([10, 20, 30, 40, 50]);
    const encoded = bufferToBase64(original.buffer as ArrayBuffer);
    const decoded = new Uint8Array(base64ToBuffer(encoded));
    expect(decoded).toEqual(original);
  });

  it('base64url encoding uses URL-safe characters', () => {
    // Bytes that produce +, /, and = in standard base64
    const bytes = new Uint8Array([251, 255, 254]);
    const encoded = bufferToBase64url(bytes.buffer as ArrayBuffer);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });
});

describe('guessAuthenticatorLabel', () => {
  function testLabel(ua: string): string {
    vi.stubGlobal('navigator', { ...navigator, userAgent: ua, credentials: {} });
    return guessAuthenticatorLabel();
  }

  it('Windows user agent → Windows Hello', () => {
    const label = testLabel(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0'
    );
    expect(label).toContain('Windows Hello');
    expect(label).toContain('Windows');
  });

  it('iOS user agent → Face ID', () => {
    const label = testLabel(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
    );
    expect(label).toContain('Face ID');
    expect(label).toContain('iOS');
  });

  it('Android user agent → Fingerprint', () => {
    const label = testLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0');
    expect(label).toContain('Fingerprint');
    expect(label).toContain('Android');
  });

  it('macOS user agent → Touch ID', () => {
    const label = testLabel(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/17.0'
    );
    expect(label).toContain('Touch ID');
    expect(label).toContain('macOS');
  });
});
