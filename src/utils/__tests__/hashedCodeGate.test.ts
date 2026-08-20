import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { matchesHashedCode, isCryptoAvailable } from '@/utils/hashedCodeGate';

// Any well-formed hex digest. Only used by the crypto-throws test below, where
// `digest` is mocked and never reaches a real comparison — so its value is
// irrelevant by construction. Every other test derives its hashes with `hashOf`
// rather than hard-coding one.
const ARBITRARY_HASH = 'a'.repeat(64);

const mocks = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: mocks.reportError }));

/** Real digest of `input`, so tests never hand-copy a hash. */
async function hashOf(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('matchesHashedCode', () => {
  beforeEach(() => {
    mocks.reportError.mockClear();
  });

  it('matches the configured code', async () => {
    expect(await matchesHashedCode('let-me-in', await hashOf('let-me-in'))).toBe(true);
  });

  it('rejects a wrong code', async () => {
    expect(await matchesHashedCode('nope', await hashOf('let-me-in'))).toBe(false);
  });

  it('normalizes case and surrounding whitespace', async () => {
    const hashes = await hashOf('let-me-in');
    expect(await matchesHashedCode('  LET-ME-IN  ', hashes)).toBe(true);
  });

  it('matches any entry in a multi-hash list, ignoring spacing', async () => {
    const hashes = `${await hashOf('first')} , ${await hashOf('second')}`;
    expect(await matchesHashedCode('second', hashes)).toBe(true);
    expect(await matchesHashedCode('third', hashes)).toBe(false);
  });

  it('rejects empty input', async () => {
    expect(await matchesHashedCode('', await hashOf('x'))).toBe(false);
    expect(await matchesHashedCode('   ', await hashOf('x'))).toBe(false);
  });

  it('rejects when no hashes are configured', async () => {
    expect(await matchesHashedCode('anything', '')).toBe(false);
    expect(await matchesHashedCode('anything', '  ,  ')).toBe(false);
  });

  it('is not fooled by an uppercase configured hash', async () => {
    const hashes = (await hashOf('let-me-in')).toUpperCase();
    expect(await matchesHashedCode('let-me-in', hashes)).toBe(true);
  });

  // The important one: a non-secure origin has no crypto.subtle, and that must
  // NOT be indistinguishable from "wrong code" in the logs.
  it('reports and fails closed when crypto.subtle.digest throws', async () => {
    const spy = vi
      .spyOn(crypto.subtle, 'digest')
      .mockRejectedValue(new Error('SubtleCrypto unavailable'));
    try {
      expect(await matchesHashedCode('let-me-in', ARBITRARY_HASH)).toBe(false);
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
      expect(mocks.reportError.mock.calls[0]![0]).toMatchObject({
        surface: 'hashed-code-gate',
        severity: 'error',
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('isCryptoAvailable', () => {
  it('is true in a normal (secure-context) environment', () => {
    expect(isCryptoAvailable()).toBe(true);
  });

  it('is false when subtle is missing', () => {
    const spy = vi.spyOn(crypto, 'subtle', 'get').mockReturnValue(undefined as never);
    try {
      expect(isCryptoAvailable()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
