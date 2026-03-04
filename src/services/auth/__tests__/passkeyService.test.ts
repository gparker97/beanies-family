import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  removeAllPasskeysByMember: vi.fn(async () => {}),
}));

// --- Mock passkeyCrypto ---
vi.mock('../passkeyCrypto', () => ({
  isPRFSupported: vi.fn(() => false),
  getPRFOutput: vi.fn(() => null),
  buildPRFExtension: vi.fn(() => ({ prf: { eval: { first: new Uint8Array(32) } } })),
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

// Imports must come after vi.mock calls
import {
  bufferToBase64url,
  base64urlToBuffer,
  bufferToBase64,
  base64ToBuffer,
  guessAuthenticatorLabel,
  authenticateWithPasskey,
  registerPasskeyForMember,
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
    expect(passkeyRepo.savePasskeyRegistration).toHaveBeenCalledTimes(1);

    const saved = vi.mocked(passkeyRepo.savePasskeyRegistration).mock.calls[0]![0];
    expect(saved.memberId).toBe('member-1');
    expect(saved.familyId).toBe('family-1');
    expect(saved.transports).toEqual(['internal']);
    expect(saved.label).toBe('My Device');
    expect(saved.credentialId).toBeTruthy();
    // V4: no cachedPassword field on registration
    expect('cachedPassword' in saved).toBe(false);
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

    await authenticateWithPasskey({ familyId: 'family-1' });

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

    const result = await authenticateWithPasskey({ familyId: 'family-1' });
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

    const result = await authenticateWithPasskey({ familyId: 'family-1' });
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

    const result = await authenticateWithPasskey({ familyId: 'family-1' });
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

    const result = await authenticateWithPasskey({ familyId: 'family-1' });
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

    const result = await authenticateWithPasskey({ familyId: 'family-1' });
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

    const result = await authenticateWithPasskey({ familyId: 'family-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('WRONG_FAMILY_CREDENTIAL');
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
