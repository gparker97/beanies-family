import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PasskeyRegistration } from '@/types/models';

// --- Mock passkeyRepository ---
const mockRegistrations: PasskeyRegistration[] = [];

vi.mock('@/services/indexeddb/repositories/passkeyRepository', () => ({
  getPasskeysByFamily: vi.fn(async () => [...mockRegistrations]),
  savePasskeyRegistration: vi.fn(async () => {}),
  updatePasskey: vi.fn(async () => {}),
  getPasskeysByMember: vi.fn(async () => []),
  getAllPasskeys: vi.fn(async () => []),
  removePasskeyRegistration: vi.fn(async () => {}),
  getPasskeyByCredentialId: vi.fn(async () => null),
}));

// --- Mock passkeyCrypto ---
// getPRFOutput returns a buffer by default so the enable→assert→wrap happy path
// succeeds; individual tests override it to null to exercise the no-PRF paths.
const { getPRFOutputMock } = vi.hoisted(() => ({
  getPRFOutputMock: vi.fn(() => new ArrayBuffer(32) as ArrayBuffer | null),
}));
vi.mock('../passkeyCrypto', () => ({
  getPRFOutput: getPRFOutputMock,
  buildPRFEnableExtension: vi.fn(() => ({ prf: {} })),
  buildPRFEvalExtension: vi.fn(() => ({ prf: { eval: { first: new Uint8Array(32) } } })),
  deriveWrappingKey: vi.fn(async () => ({}) as CryptoKey),
  generateHKDFSalt: vi.fn(() => new Uint8Array(32)),
  wrapDEK: vi.fn(async () => 'wrapped-base64'),
  unwrapDEK: vi.fn(async () => ({}) as CryptoKey),
}));

// --- Mock familyKeyService ---
const mockImportedFamilyKey = {} as CryptoKey;

vi.mock('@/services/crypto/familyKeyService', () => ({
  importFamilyKey: vi.fn(async () => mockImportedFamilyKey),
}));

// --- Mock globalSettingsRepository ---
let mockGlobalSettings: Record<string, unknown> = {};

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getGlobalSettings: vi.fn(async () => mockGlobalSettings),
}));

// --- Mock capabilities (native seam) + errorReporter + telemetry + i18n ---
const { isNativeMock, getPlatformMock } = vi.hoisted(() => ({
  isNativeMock: vi.fn(() => false),
  getPlatformMock: vi.fn(() => 'web' as 'web' | 'ios' | 'android'),
}));
vi.mock('@/services/sync/capabilities', () => ({
  isNative: isNativeMock,
  getPlatform: getPlatformMock,
}));
// Native Keystore path is a separate module (ADR-029) — mock it so the web tests
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
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
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

/** Build a fake PublicKeyCredential assertion object */
function makeFakeAssertion(opts: {
  rawId: ArrayBuffer;
  userHandle?: ArrayBuffer | null;
  extensionResults?: Record<string, unknown>;
}): PublicKeyCredential {
  return {
    rawId: opts.rawId,
    id: '',
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: new ArrayBuffer(0),
      authenticatorData: new ArrayBuffer(0),
      signature: new ArrayBuffer(0),
      userHandle: opts.userHandle ?? null,
    } as AuthenticatorAssertionResponse,
    getClientExtensionResults: () =>
      (opts.extensionResults ?? {}) as AuthenticationExtensionsClientOutputs,
  } as unknown as PublicKeyCredential;
}

// --- Tests ---

describe('getRpId — WebAuthn Relying Party ID (web/PWA only, ADR-029 2026-07-14)', () => {
  it('returns the current origin hostname (native no longer uses WebAuthn)', () => {
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
    const createMock = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: { create: createMock, get: vi.fn() },
      userAgent: navigator.userAgent,
    });
    const params = {
      memberId: 'member-1',
      memberName: 'A',
      memberEmail: 'a@b.c',
      familyId: 'family-1',
      familyKey: {} as CryptoKey,
    };
    const result = await registerPasskeyForMember(params);
    expect(nativeMocks.nativeEnable).toHaveBeenCalledWith(params);
    expect(createMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('authenticateWithPasskey delegates to nativeUnlock (WebAuthn get never runs)', async () => {
    const getMock = vi.fn();
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: { create: vi.fn(), get: getMock },
      userAgent: navigator.userAgent,
    });
    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(nativeMocks.nativeUnlock).toHaveBeenCalledWith('family-1', 'member-1');
    expect(getMock).not.toHaveBeenCalled();
    expect(result.memberId).toBe('member-1');
  });

  it('canEnrollBiometric / canOfferBiometric / resolveDeviceKeys delegate to the native helpers', async () => {
    await canEnrollBiometric();
    await canOfferBiometric();
    await resolveDeviceKeys('family-1');
    expect(nativeMocks.nativeCanEnroll).toHaveBeenCalled();
    expect(nativeMocks.nativeCanOffer).toHaveBeenCalled();
    expect(nativeMocks.nativeResolveDeviceKeys).toHaveBeenCalledWith('family-1');
  });

  it('de-duplicates by member so one person never appears twice in the chooser', async () => {
    // A synced iCloud/Google passkey adds a SECOND record for the same member the first
    // time it is used on this browser, which would otherwise render two identical buttons
    // under "who's signing in?".
    isNativeMock.mockReturnValue(false);
    vi.mocked(passkeyRepo.getPasskeysByFamily).mockResolvedValueOnce([
      makeRegistration({ credentialId: 'a', memberId: 'member-1' }),
      makeRegistration({ credentialId: 'b', memberId: 'member-1', label: 'iPhone (synced)' }),
      makeRegistration({ credentialId: 'c', memberId: 'member-2' }),
    ]);

    const keys = await resolveDeviceKeys('family-1');

    expect(keys.map((k) => k.memberId)).toEqual(['member-1', 'member-2']);
    isNativeMock.mockReturnValue(true);
  });

  it('a broken registry degrades to "no keys" on web, as it already did on native', async () => {
    // It used to THROW out of three views' onMounted, leaving a spinner up forever.
    isNativeMock.mockReturnValue(false);
    vi.mocked(passkeyRepo.getPasskeysByFamily).mockRejectedValueOnce(new Error('db blocked'));

    expect(await resolveDeviceKeys('family-1')).toEqual([]);
    isNativeMock.mockReturnValue(true);
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

  it('removePasskey passes (familyId, memberId) to nativeDisable — not a credentialId', async () => {
    vi.mocked(passkeyRepo.getPasskeyByCredentialId).mockResolvedValueOnce(
      makeRegistration({
        credentialId: 'native:family-1:member-1',
        mechanism: 'native-keystore',
      })
    );
    await removePasskey('native:family-1:member-1');
    expect(nativeMocks.nativeDisable).toHaveBeenCalledWith('family-1', 'member-1');
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

describe('registerPasskeyForMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistrations.length = 0;
    getPRFOutputMock.mockReturnValue(new ArrayBuffer(32)); // default: PRF available

    // Mock navigator.credentials.create
    const fakeCredential = {
      rawId: new TextEncoder().encode('new-cred-id').buffer,
      response: {
        getPublicKey: () => new ArrayBuffer(65),
        getTransports: () => ['internal'],
      } as unknown as AuthenticatorAttestationResponse,
      getClientExtensionResults: () => ({}),
    };
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        create: vi.fn(async () => fakeCredential),
        get: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });
  });

  it('stores correct fields including credentialId, memberId, familyId, transports, label', async () => {
    const mockFamilyKey = {} as CryptoKey;
    const result = await registerPasskeyForMember({
      memberId: 'member-1',
      memberName: 'Test User',
      memberEmail: 'test@example.com',
      familyId: 'family-1',
      familyKey: mockFamilyKey,
      label: 'My Device',
    });

    expect(result.success).toBe(true);
    // Enable→assert→wrap: a working PRF wrap is returned and prfSupported is true
    // (sourced from wrap success, not a create-response results check).
    expect(result.prfSupported).toBe(true);
    expect(result.passkeySecret).toBeTruthy();
    expect(result.passkeySecret?.wrappedFamilyKey).toBe('wrapped-base64');
    // Persisted only AFTER the wrap succeeds.
    expect(passkeyRepo.savePasskeyRegistration).toHaveBeenCalledTimes(1);

    const saved = vi.mocked(passkeyRepo.savePasskeyRegistration).mock.calls[0]![0];
    expect(saved.memberId).toBe('member-1');
    expect(saved.familyId).toBe('family-1');
    expect(saved.transports).toEqual(['internal']);
    expect(saved.label).toBe('My Device');
    expect(saved.credentialId).toBeTruthy();
    expect(saved.prfSupported).toBe(true);
    // V4: no cachedPassword field on registration
    expect('cachedPassword' in saved).toBe(false);
  });

  it('cleanly declines (no persist, not cancelled) when PRF cannot be established', async () => {
    // No PRF output on either create or the immediate assertion → clean decline.
    getPRFOutputMock.mockReturnValue(null);
    const getMock = vi.fn(async () => null); // immediate assertion yields nothing
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        create: vi.fn(async () => ({
          rawId: new TextEncoder().encode('new-cred-id').buffer,
          response: {
            getPublicKey: () => new ArrayBuffer(65),
            getTransports: () => ['internal'],
          } as unknown as AuthenticatorAttestationResponse,
          getClientExtensionResults: () => ({}),
        })),
        get: getMock,
      },
      userAgent: navigator.userAgent,
    });

    const result = await registerPasskeyForMember({
      memberId: 'member-1',
      memberName: 'Test User',
      memberEmail: 'test@example.com',
      familyId: 'family-1',
      familyKey: {} as CryptoKey,
    });

    expect(result.success).toBe(false);
    expect(result.cancelled).toBeFalsy(); // a capability decline, not a cancellation
    expect(result.passkeySecret).toBeUndefined();
    // Never persisted an unusable passkey, and never returned success silently.
    expect(passkeyRepo.savePasskeyRegistration).not.toHaveBeenCalled();
    // Friendly copy, not a raw string.
    expect(result.error).toContain('password');

    getPRFOutputMock.mockReturnValue(new ArrayBuffer(32));
  });

  it('treats cancelling the second (PRF-eval) prompt as cancellation, not failure', async () => {
    // Create succeeds with no create-time PRF output → immediate assertion runs and
    // the user dismisses it (NotAllowedError). Must be cancelled:true, no persist,
    // no suppression — exactly like the create-cancel path.
    getPRFOutputMock.mockReturnValue(null);
    localStorage.clear();
    const cancelError = Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
    Object.setPrototypeOf(cancelError, DOMException.prototype);
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        create: vi.fn(async () => ({
          rawId: new TextEncoder().encode('new-cred-id').buffer,
          response: {
            getPublicKey: () => new ArrayBuffer(65),
            getTransports: () => ['internal'],
          } as unknown as AuthenticatorAttestationResponse,
          getClientExtensionResults: () => ({}),
        })),
        get: vi.fn(async () => {
          throw cancelError;
        }),
      },
      userAgent: navigator.userAgent,
    });

    const result = await registerPasskeyForMember({
      memberId: 'member-1',
      memberName: 'Test User',
      memberEmail: 'test@example.com',
      familyId: 'family-1',
      familyKey: {} as CryptoKey,
    });

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(passkeyRepo.savePasskeyRegistration).not.toHaveBeenCalled();
    // Cancellation must NOT arm the proactive-offer suppression.
    expect(localStorage.getItem('beanies.biometricOfferSuppressedUntil')).toBeNull();

    getPRFOutputMock.mockReturnValue(new ArrayBuffer(32));
  });

  it('Chromium two-prompt path: no PRF at create, immediate assertion yields PRF → wrap + persist', async () => {
    // Web Chromium enables PRF at create but does not evaluate there; the immediate
    // restricted assertion returns the PRF output, then wrap + persist run.
    getPRFOutputMock.mockReturnValueOnce(null); // create ext → no output
    getPRFOutputMock.mockReturnValue(new ArrayBuffer(32)); // assertion ext → output
    const getMock = vi.fn(async () =>
      makeFakeAssertion({ rawId: new TextEncoder().encode('new-cred-id').buffer })
    );
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        create: vi.fn(async () => ({
          rawId: new TextEncoder().encode('new-cred-id').buffer,
          response: {
            getPublicKey: () => new ArrayBuffer(65),
            getTransports: () => ['internal'],
          } as unknown as AuthenticatorAttestationResponse,
          getClientExtensionResults: () => ({ prf: { enabled: true } }),
        })),
        get: getMock,
      },
      userAgent: navigator.userAgent,
    });

    const result = await registerPasskeyForMember({
      memberId: 'member-1',
      memberName: 'Test User',
      memberEmail: 'test@example.com',
      familyId: 'family-1',
      familyKey: {} as CryptoKey,
    });

    // The immediate assertion (evaluatePRFForCredential) actually ran and was
    // restricted to the just-created credential.
    expect(getMock).toHaveBeenCalledTimes(1);
    const getArgs = getMock.mock.calls[0] as unknown as [
      { publicKey: PublicKeyCredentialRequestOptions },
    ];
    expect(getArgs[0].publicKey.allowCredentials).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.prfSupported).toBe(true);
    expect(result.passkeySecret).toBeTruthy();
    expect(passkeyRepo.savePasskeyRegistration).toHaveBeenCalledTimes(1);

    getPRFOutputMock.mockReturnValue(new ArrayBuffer(32));
  });

  it('flags result.cancelled when the user dismisses the platform-authenticator prompt', async () => {
    // NotAllowedError is what `navigator.credentials.create` throws when
    // the user dismisses the iOS/Android passkey sheet (or the prompt
    // times out). It's a user gesture, not an error — the result must
    // carry `cancelled: true` so callers can exit silently instead of
    // surfacing an error toast that auto-reports to Slack.
    const cancelError = Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
    Object.setPrototypeOf(cancelError, DOMException.prototype);
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        create: vi.fn(async () => {
          throw cancelError;
        }),
        get: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await registerPasskeyForMember({
      memberId: 'member-1',
      memberName: 'Test User',
      memberEmail: 'test@example.com',
      familyId: 'family-1',
      familyKey: {} as CryptoKey,
    });

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.error).toBe('Registration was cancelled');
    expect(passkeyRepo.savePasskeyRegistration).not.toHaveBeenCalled();
  });
});

describe('authenticateWithPasskey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistrations.length = 0;
    mockGlobalSettings = {};

    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });
  });

  it('omits allowCredentials (discoverable mode)', async () => {
    mockRegistrations.push(makeRegistration());

    const getMock = vi.fn(async () =>
      makeFakeAssertion({
        rawId: base64urlToBuffer('dGVzdC1jcmVkZW50aWFs'),
      })
    );
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: { get: getMock, create: vi.fn() },
      userAgent: navigator.userAgent,
    });

    await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });

    expect(getMock).toHaveBeenCalledTimes(1);
    const callArgs = getMock.mock.calls[0] as unknown as [
      { publicKey: PublicKeyCredentialRequestOptions },
    ];
    expect(callArgs[0].publicKey.allowCredentials).toBeUndefined();
  });

  it('matches credential to correct registration by ID and returns success without familyKey when no PRF/cache', async () => {
    mockRegistrations.push(makeRegistration());

    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () =>
          makeFakeAssertion({
            rawId: base64urlToBuffer('dGVzdC1jcmVkZW50aWFs'),
          })
        ),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(result.success).toBe(true);
    expect(result.memberId).toBe('member-1');
    // No PRF, no cache → no familyKey, but credentialId returned for password fallback
    expect(result.familyKey).toBeUndefined();
    expect(result.credentialId).toBeTruthy();
  });

  it('returns familyKey from cache when PRF not supported', async () => {
    mockRegistrations.push(makeRegistration({ prfSupported: false }));
    // Set up cached family key in global settings
    mockGlobalSettings = {
      cachedFamilyKeys: { 'family-1': 'dGVzdC1rZXk=' },
    };

    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () =>
          makeFakeAssertion({
            rawId: base64urlToBuffer('dGVzdC1jcmVkZW50aWFs'),
          })
        ),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(result.success).toBe(true);
    expect(result.familyKey).toBe(mockImportedFamilyKey);
  });

  it('auto-registers synced credential when cached family key exists for family', async () => {
    mockRegistrations.push(
      makeRegistration({ credentialId: 'other-cred-id', memberId: 'member-1' })
    );
    mockGlobalSettings = {
      cachedFamilyKeys: { 'family-1': 'dGVzdC1rZXk=' },
    };

    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () =>
          makeFakeAssertion({
            rawId: new TextEncoder().encode('synced-cred').buffer,
            userHandle: new TextEncoder().encode('member-1').buffer,
          })
        ),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(result.success).toBe(true);
    expect(result.memberId).toBe('member-1');
    expect(result.familyKey).toBe(mockImportedFamilyKey);

    // Verify the synced credential was saved to the local registry
    expect(passkeyRepo.savePasskeyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: bufferToBase64url(
          new TextEncoder().encode('synced-cred').buffer as ArrayBuffer
        ),
        memberId: 'member-1',
        familyId: 'family-1',
      })
    );
  });

  it('returns success without familyKey for cross-device credential when no cache', async () => {
    mockRegistrations.push(
      makeRegistration({ credentialId: 'other-cred-id', memberId: 'member-1' })
    );

    // Assertion has unknown credential ID but userHandle = "member-1"
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () =>
          makeFakeAssertion({
            rawId: new TextEncoder().encode('unknown-cred').buffer,
            userHandle: new TextEncoder().encode('member-1').buffer,
          })
        ),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    // V4: returns success with memberId but no familyKey — caller prompts for password
    expect(result.success).toBe(true);
    expect(result.memberId).toBe('member-1');
    expect(result.familyKey).toBeUndefined();
    expect(result.credentialId).toBeTruthy();
  });

  it('returns WRONG_FAMILY_CREDENTIAL when neither credential ID nor userHandle matches', async () => {
    mockRegistrations.push(makeRegistration());

    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () =>
          makeFakeAssertion({
            rawId: new TextEncoder().encode('unknown-cred').buffer,
            userHandle: new TextEncoder().encode('unknown-member').buffer,
          })
        ),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('WRONG_FAMILY_CREDENTIAL');
  });

  it('returns WRONG_FAMILY_CREDENTIAL when userHandle is empty', async () => {
    mockRegistrations.push(makeRegistration());

    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () =>
          makeFakeAssertion({
            rawId: new TextEncoder().encode('unknown-cred').buffer,
            userHandle: null,
          })
        ),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('WRONG_FAMILY_CREDENTIAL');
  });

  it('flags result.cancelled when the user dismisses the platform-authenticator prompt', async () => {
    mockRegistrations.push(makeRegistration());
    const cancelError = Object.assign(new Error('cancelled'), { name: 'NotAllowedError' });
    Object.setPrototypeOf(cancelError, DOMException.prototype);
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () => {
          throw cancelError;
        }),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.error).toBe('Authentication was cancelled');
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

describe('canOfferBiometric — self-healing per-device suppression (#52)', () => {
  beforeEach(() => {
    localStorage.clear();
    isNativeMock.mockReturnValue(false);
    getPlatformMock.mockReturnValue('web');
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    });
  });
  afterEach(() => localStorage.clear());

  it('offers when platform supports PRF, an authenticator exists, and no suppression', async () => {
    expect(await canOfferBiometric()).toBe(true);
  });

  it('does not offer while a suppression window is active', async () => {
    localStorage.setItem('beanies.biometricOfferSuppressedUntil', String(Date.now() + 60_000));
    expect(await canOfferBiometric()).toBe(false);
  });

  it('re-offers (and clears the record) once the cool-off has elapsed', async () => {
    localStorage.setItem('beanies.biometricOfferSuppressedUntil', String(Date.now() - 1_000));
    expect(await canOfferBiometric()).toBe(true);
    expect(localStorage.getItem('beanies.biometricOfferSuppressedUntil')).toBeNull();
  });

  it('does not offer when no platform authenticator is available', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
    });
    expect(await canOfferBiometric()).toBe(false);
  });

  it('canEnrollBiometric ignores suppression — the Settings retry surface never self-locks', async () => {
    // Suppression that hides the PROACTIVE offer must NOT block the deliberate
    // enroll surface (Settings), which gates on canEnrollBiometric.
    localStorage.setItem('beanies.biometricOfferSuppressedUntil', String(Date.now() + 60_000));
    expect(await canOfferBiometric()).toBe(false); // proactive nag suppressed
    expect(await canEnrollBiometric()).toBe(true); // but the user can still enroll
  });
});

describe('formatCredentialManagerError — friendly copy, never the raw string (#52)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistrations.push(makeRegistration());
    getPlatformMock.mockReturnValue('android');
  });
  afterEach(() => {
    mockRegistrations.length = 0;
    getPlatformMock.mockReturnValue('web');
  });

  it('maps a "no create options available" assertion failure to friendly password-fallback copy', async () => {
    const rawMessage = 'NoCreateCredentialException: No create options available.';
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () => {
          throw new Error(rawMessage);
        }),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1', memberId: 'member-1' });
    expect(result.success).toBe(false);
    // Friendly copy (the tr() fallback), never the raw platform string.
    expect(result.error).not.toContain('NoCreateCredentialException');
    expect(result.error).toContain('password');
  });
});
