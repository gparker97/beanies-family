/**
 * The ONE way a human-chosen secret (a member password or the family recovery passphrase)
 * wraps the family key into the envelope (ADR-041, #81).
 *
 * A fresh random salt, the `secret` KDF profile at the count the write gate allows
 * (`secretWriteIterations()`: the legacy count until the fleet floor reaches
 * `KDF_READ_BOTH_SINCE`, then `KDF_PROFILES.secret`), AES-KW. The count is RECORDED on the
 * result whatever the gate state, so every reader derives with what the wrap was made with
 * and the next cost change is non-breaking.
 *
 * Policy lives here, not in `familyKeyService` (which stays policy-free); neither
 * `familyKeyService` nor `kdfWriteGate` imports this module, so the graph stays acyclic.
 */
import type { WrappedMemberKey } from '@/types/syncFileV4';
import { bufferToBase64 } from '@/utils/encoding';
import { SALT_LENGTH, deriveMemberKey, wrapFamilyKey } from './familyKeyService';
import { secretWriteIterations } from './kdfWriteGate';

export async function wrapFamilyKeyWithSecret(
  familyKey: CryptoKey,
  secret: string
): Promise<WrappedMemberKey> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iterations = secretWriteIterations();
  const wrappingKey = await deriveMemberKey(secret, salt, { profile: 'secret', iterations });
  const wrapped = await wrapFamilyKey(familyKey, wrappingKey);
  return { salt: bufferToBase64(salt), wrapped, iterations };
}
