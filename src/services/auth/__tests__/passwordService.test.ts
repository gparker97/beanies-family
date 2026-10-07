import { describe, it, expect, vi } from 'vitest';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

import { hashPassword, verifyPassword } from '@/services/auth/passwordService';
import { KDF_PROFILES } from '@/services/crypto/kdfParams';
import { SALT_LENGTH } from '@/services/crypto/familyKeyService';

/**
 * Hashes produced by the pre-kdfParams implementation (its own PBKDF2 block, 100k,
 * hand-rolled base64), captured on 2026-10-07 before the rewrite. `passwordHash` /
 * `pinHash` live in every family's doc in exactly this format, so these must verify
 * forever: a format or count change would hard-refuse password sign-in on every
 * shipped client (ADR-041).
 */
// eslint-disable-next-line no-secrets/no-secrets -- a public test fixture, not a secret
const LEGACY_HASH_PHRASE = 'ame5R5h6Yg/KxcUc7mEdVQ==:JH8EI8TmtXMpGseo4agNdvK7gxj3cdtoQzpioRGPhKU=';
// eslint-disable-next-line no-secrets/no-secrets -- a public test fixture, not a secret
const LEGACY_HASH_PIN = 'Db4ZOxFIa7CLs+nTavk3vQ==:I3iOiMJKuztrKOVUVIElLJ97LUXhamK6RPMogGXRwwo=';

describe('passwordService', () => {
  it('verifies hashes written by the previous implementation, byte-identical format', async () => {
    expect(await verifyPassword('correct horse battery staple', LEGACY_HASH_PHRASE)).toBe(true);
    expect(await verifyPassword('123456', LEGACY_HASH_PIN)).toBe(true);
    expect(await verifyPassword('wrong', LEGACY_HASH_PHRASE)).toBe(false);
    expect(await verifyPassword('654321', LEGACY_HASH_PIN)).toBe(false);
  });

  it('round-trips and keeps the "base64(salt):base64(hash)" shape', async () => {
    const stored = await hashPassword('my-password');
    const [salt, hash] = stored.split(':');
    expect(atob(salt!)).toHaveLength(SALT_LENGTH);
    expect(atob(hash!)).toHaveLength(32);
    expect(await verifyPassword('my-password', stored)).toBe(true);
    expect(await verifyPassword('not-my-password', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('refuses a stored value with no separator', async () => {
    expect(await verifyPassword('x', 'no-colon-here')).toBe(false);
  });

  it('derives at the docHash profile (count unchanged)', async () => {
    logEvent.mockClear();
    await hashPassword('p');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'kdf_derive',
        context: expect.objectContaining({ kind: 'docHash', count: KDF_PROFILES.docHash }),
      })
    );
    expect(KDF_PROFILES.docHash).toBe(100_000);
  });
});
