/**
 * `wrapFamilyKeyWithSecret` (ADR-041): writes at the count the gate allows, RECORDS that
 * count, and the result unwraps at the recorded count (and only with the right secret).
 * The gate is mocked: its own five floor states are covered in `kdfWriteGate.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ gateOpen: false }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('../kdfWriteGate', async () => {
  const { KDF_PROFILES, LEGACY_ITERATIONS } = await import('../kdfParams');
  return {
    secretWriteIterations: () => (h.gateOpen ? KDF_PROFILES.secret : LEGACY_ITERATIONS),
  };
});

import { wrapFamilyKeyWithSecret } from '../secretWrap';
import {
  SALT_LENGTH,
  deriveMemberKey,
  exportFamilyKey,
  generateFamilyKey,
  isWrongKeyUnwrap,
  unwrapFamilyKey,
} from '../familyKeyService';
import { recordedIterations } from '../kdfParams';
import { base64ToBuffer } from '@/utils/encoding';

async function unwrapAtRecorded(
  pkg: { salt: string; wrapped: string; iterations?: number },
  secret: string
): Promise<CryptoKey> {
  const key = await deriveMemberKey(secret, new Uint8Array(base64ToBuffer(pkg.salt)), {
    profile: 'secret',
    iterations: recordedIterations(pkg),
  });
  return unwrapFamilyKey(pkg.wrapped, key);
}

beforeEach(() => {
  h.gateOpen = false;
});

describe('wrapFamilyKeyWithSecret', () => {
  it('writes and records 100,000 iterations while the gate is closed', async () => {
    const fk = await generateFamilyKey();
    const pkg = await wrapFamilyKeyWithSecret(fk, 'correct horse');
    expect(pkg.iterations).toBe(100_000);
    expect(new Uint8Array(base64ToBuffer(pkg.salt))).toHaveLength(SALT_LENGTH);
    const back = await unwrapAtRecorded(pkg, 'correct horse');
    expect(await exportFamilyKey(back)).toEqual(await exportFamilyKey(fk));
  });

  it('writes and records 600,000 iterations once the gate is open', async () => {
    h.gateOpen = true;
    const fk = await generateFamilyKey();
    const pkg = await wrapFamilyKeyWithSecret(fk, 'correct horse');
    expect(pkg.iterations).toBe(600_000);
    const back = await unwrapAtRecorded(pkg, 'correct horse');
    expect(await exportFamilyKey(back)).toEqual(await exportFamilyKey(fk));
  });

  it('a wrong secret is refused as a wrong-key unwrap', async () => {
    const fk = await generateFamilyKey();
    const pkg = await wrapFamilyKeyWithSecret(fk, 'correct horse');
    const err = await unwrapAtRecorded(pkg, 'wrong horse').catch((e: unknown) => e);
    expect(isWrongKeyUnwrap(err)).toBe(true);
  });

  it('uses a fresh salt on every call', async () => {
    const fk = await generateFamilyKey();
    const a = await wrapFamilyKeyWithSecret(fk, 'same secret');
    const b = await wrapFamilyKeyWithSecret(fk, 'same secret');
    expect(a.salt).not.toBe(b.salt);
  });
});
