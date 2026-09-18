import { describe, it, expect } from 'vitest';
import {
  createApprovalRequest,
  readApprovalRequest,
  wrapForApproval,
  unwrapApproval,
} from '@/services/crypto/deviceApproval';
import { generateFamilyKey, exportFamilyKey } from '@/services/crypto/familyKeyService';

/**
 * The whole security argument for showing this QR on a laptop in a cafe rests on two
 * claims: the code carries no secret, and only the device that generated it can open what
 * comes back. Both are asserted here by execution rather than by comment.
 */
describe('device approval', () => {
  it('round-trips the family key to the device that asked for it', async () => {
    const familyKey = await generateFamilyKey();
    const request = await createApprovalRequest();

    // The approver only ever sees what the QR carries.
    const scanned = await readApprovalRequest(request.publicKeyB64);
    const wrap = await wrapForApproval(familyKey, scanned);

    const recovered = await unwrapApproval(request, wrap);
    expect(recovered).not.toBeNull();
    expect(new Uint8Array(await exportFamilyKey(recovered!))).toEqual(
      new Uint8Array(await exportFamilyKey(familyKey))
    );
  });

  it('both sides show the SAME fingerprint — the thing a human compares', async () => {
    const request = await createApprovalRequest();
    const scanned = await readApprovalRequest(request.publicKeyB64);
    expect(scanned.fingerprint).toBe(request.fingerprint);
    expect(scanned.fingerprint).toMatch(/^[0-9A-F]{6}$/);
  });

  it('refuses an approval written for a DIFFERENT request', async () => {
    const familyKey = await generateFamilyKey();
    const mine = await createApprovalRequest();
    const someoneElse = await createApprovalRequest();

    // The envelope is a shared dict, so a device polling it genuinely does encounter
    // entries addressed to other people. That must be a skip, not a crypto error.
    const wrap = await wrapForApproval(
      familyKey,
      await readApprovalRequest(someoneElse.publicKeyB64)
    );
    expect(await unwrapApproval(mine, wrap)).toBeNull();
  });

  it('the private key is NOT extractable — it cannot leave the device that made it', async () => {
    const request = await createApprovalRequest();
    expect(request.keyPair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', request.keyPair.privateKey)).rejects.toThrow();
  });

  it('the QR payload is a PUBLIC key — importable by anyone, and that is fine', async () => {
    const request = await createApprovalRequest();
    // If this ever throws, the payload has stopped being a bare public key and the
    // "photographing it gains nothing" claim needs re-deriving.
    await expect(readApprovalRequest(request.publicKeyB64)).resolves.toBeTruthy();
  });

  it('two approvals for the same request do not share a wrapping key', async () => {
    const familyKey = await generateFamilyKey();
    const request = await createApprovalRequest();
    const scanned = await readApprovalRequest(request.publicKeyB64);

    const a = await wrapForApproval(familyKey, scanned);
    const b = await wrapForApproval(familyKey, scanned);

    // A fresh ephemeral pair per approval, so neither is derivable from the other.
    expect(a.approverPublicKey).not.toBe(b.approverPublicKey);
    expect(a.salt).not.toBe(b.salt);
    expect(a.wrapped).not.toBe(b.wrapped);
    // Both still open, because each carries its own half.
    expect(await unwrapApproval(request, a)).not.toBeNull();
    expect(await unwrapApproval(request, b)).not.toBeNull();
  });

  it('rejects a payload that is not a beanies approval code', async () => {
    await expect(readApprovalRequest('not-a-key')).rejects.toThrow();
  });
});
