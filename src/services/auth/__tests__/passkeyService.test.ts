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
  generateHKDFSalt: vi.fn(() => new Uint8Array(32)),
  deriveWrappingKey: vi.fn(async () => ({}) as CryptoKey),
  wrapDEK: vi.fn(async () => 'wrapped-dek-base64'),
  unwrapDEK: vi.fn(async () => ({}) as CryptoKey),
  buildPRFExtension: vi.fn(() => ({ prf: { eval: { first: new Uint8Array(32) } } })),
}));

// --- Mock crypto/encryption ---
vi.mock('@/services/crypto/encryption', () => ({
  deriveExtractableKey: vi.fn(async () => ({}) as CryptoKey),
  extractSaltFromEncrypted: vi.fn(() => new Uint8Array(16)),
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
  invalidatePasskeysForPasswordChange,
} from '../passkeyService';
import * as passkeyRepo from '@/services/indexeddb/repositories/passkeyRepository';
import { getPRFOutput, unwrapDEK } from '../passkeyCrypto';

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
    cachedPassword: 'test-password',
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

  it('stores correct fields including credentialId, memberId, familyId, transports, label, cachedPassword', async () => {
    const result = await registerPasskeyForMember({
      memberId: 'member-1',
      memberName: 'Test User',
      memberEmail: 'test@example.com',
      familyId: 'family-1',
      encryptionPassword: 'secret-pw',
      encryptedFileBlob: 'base64-encrypted-data',
      label: 'My Device',
    });

    expect(result.success).toBe(true);
    expect(passkeyRepo.savePasskeyRegistration).toHaveBeenCalledTimes(1);

    const saved = vi.mocked(passkeyRepo.savePasskeyRegistration).mock.calls[0]![0];
    expect(saved.memberId).toBe('member-1');
    expect(saved.familyId).toBe('family-1');
    expect(saved.transports).toEqual(['internal']);
    expect(saved.label).toBe('My Device');
    expect(saved.cachedPassword).toBe('secret-pw');
    expect(saved.credentialId).toBeTruthy();
  });
});

describe('authenticateWithPasskey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistrations.length = 0;

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
    const opts = getMock.mock.calls[0]![0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(opts.publicKey.allowCredentials).toBeUndefined();
  });

  it('matches credential to correct registration by ID', async () => {
    mockRegistrations.push(makeRegistration({ cachedPassword: 'pw-123' }));

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
    expect(result.cachedPassword).toBe('pw-123');
  });

  it('returns CROSS_DEVICE_CREDENTIAL when userHandle matches a member but credential ID does not', async () => {
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
    expect(result.success).toBe(false);
    expect(result.error).toBe('CROSS_DEVICE_CREDENTIAL');
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

  it('PRF path: unwraps DEK successfully', async () => {
    const fakeDEK = { type: 'secret' } as unknown as CryptoKey;
    vi.mocked(getPRFOutput).mockReturnValueOnce(new ArrayBuffer(32));
    vi.mocked(unwrapDEK).mockResolvedValueOnce(fakeDEK);

    mockRegistrations.push(
      makeRegistration({
        prfSupported: true,
        wrappedDEK: 'wrapped-dek',
        wrappedDEKSalt: btoa('salt-bytes-here!'),
        cachedPassword: 'backup-pw',
      })
    );

    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: {
        get: vi.fn(async () =>
          makeFakeAssertion({
            rawId: base64urlToBuffer('dGVzdC1jcmVkZW50aWFs'),
            extensionResults: { prf: { results: { first: new ArrayBuffer(32) } } },
          })
        ),
        create: vi.fn(),
      },
      userAgent: navigator.userAgent,
    });

    const result = await authenticateWithPasskey({ familyId: 'family-1' });
    expect(result.success).toBe(true);
    expect(result.dek).toBe(fakeDEK);
    expect(result.cachedPassword).toBe('backup-pw');
  });

  it('cached password fallback when PRF not supported', async () => {
    mockRegistrations.push(
      makeRegistration({
        prfSupported: false,
        cachedPassword: 'my-cached-pw',
      })
    );

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
    expect(result.dek).toBeUndefined();
    expect(result.cachedPassword).toBe('my-cached-pw');
  });

  it('cached password fallback when PRF unwrap fails', async () => {
    vi.mocked(getPRFOutput).mockReturnValueOnce(new ArrayBuffer(32));
    vi.mocked(unwrapDEK).mockRejectedValueOnce(new Error('unwrap failed'));

    mockRegistrations.push(
      makeRegistration({
        prfSupported: true,
        wrappedDEK: 'wrapped-dek',
        wrappedDEKSalt: btoa('salt'),
        cachedPassword: 'fallback-pw',
      })
    );

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
    expect(result.cachedPassword).toBe('fallback-pw');
    expect(result.dek).toBeUndefined();
  });

  it('no decryption materials returns descriptive error', async () => {
    mockRegistrations.push(
      makeRegistration({
        prfSupported: false,
        cachedPassword: undefined,
      })
    );

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
    expect(result.success).toBe(false);
    expect(result.error).toContain('re-register');
  });
});

describe('invalidatePasskeysForPasswordChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistrations.length = 0;
  });

  it('clears PRF DEKs and updates cached passwords', async () => {
    mockRegistrations.push(
      makeRegistration({
        credentialId: 'prf-cred',
        prfSupported: true,
        wrappedDEK: 'wrapped',
        wrappedDEKSalt: 'salt',
        cachedPassword: 'old-pw',
      }),
      makeRegistration({
        credentialId: 'non-prf-cred',
        prfSupported: false,
        cachedPassword: 'old-pw',
      })
    );

    await invalidatePasskeysForPasswordChange('family-1', 'new-pw');

    const updateCalls = vi.mocked(passkeyRepo.updatePasskey).mock.calls;

    // PRF registration: DEK fields cleared
    const prfUpdate = updateCalls.find((c) => c[0] === 'prf-cred');
    expect(prfUpdate).toBeTruthy();
    expect(prfUpdate![1].wrappedDEK).toBeUndefined();
    expect(prfUpdate![1].wrappedDEKSalt).toBeUndefined();

    // Non-PRF registration: password updated
    const nonPrfUpdate = updateCalls.find((c) => c[0] === 'non-prf-cred');
    expect(nonPrfUpdate).toBeTruthy();
    expect(nonPrfUpdate![1].cachedPassword).toBe('new-pw');
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
