/**
 * No long-lived or cached envelope may retain `encryptedPayload`.
 *
 * There are THREE holders, and stripping only some of them would be the worst
 * of both worlds — a partial saving plus two envelopes that disagree about
 * whether the field is real:
 *
 *   1. `syncStore.envelope`            (via `replaceEnvelope`)
 *   2. `syncService.currentEnvelope`   (via `setEnvelope`, which `setFamilyKey`
 *                                       now routes through)
 *   3. the IndexedDB envelope cache    (via `worker/cache.persistEnvelope`)
 *
 * Sink 3 is the one that is easy to get wrong: `createNewFile` reaches it
 * through `docClient.persistEnvelope` DIRECTLY, bypassing `syncService`, so a
 * strip applied at the syncService callers alone would leave a payload-bearing
 * row in IndexedDB.
 *
 * The invariant is enforced at both boundaries a stripped envelope could escape
 * through — the file parser and the worker RPC — and those guards are asserted
 * here too, because without them a stripped envelope decrypts to zero bytes,
 * surfaces as "corruption", and CLEARS THE USER'S CACHE.
 */
import { describe, it, expect } from 'vitest';
import { withoutPayload } from '../envelopeMerge';
import { parseBeanpodV4 } from '../fileSync';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

const envelope = (): BeanpodFileV4 =>
  ({
    version: '4.0',
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: { m1: { salt: 's', wrapped: 'w' } },
    passkeyWrappedKeys: { p1: { credentialId: 'c', wrapped: 'w' } },
    inviteKeys: { i1: { wrapped: 'w' } },
    encryptedPayload: 'ZGVhZGJlZWY=',
    writerVersion: '0.16',
  }) as unknown as BeanpodFileV4;

describe('withoutPayload', () => {
  it('blanks the payload and preserves everything else', () => {
    const original = envelope();
    const stripped = withoutPayload(original);

    expect(stripped.encryptedPayload).toBe('');
    expect(stripped).toEqual({ ...original, encryptedPayload: '' });
  });

  it('preserves every local-only key dict verbatim', () => {
    // These are the whole reason a long-lived envelope exists — losing them
    // would lock a member out after a peer key-add.
    const stripped = withoutPayload(envelope());
    expect(stripped.wrappedKeys).toEqual({ m1: { salt: 's', wrapped: 'w' } });
    expect(stripped.passkeyWrappedKeys).toEqual({ p1: { credentialId: 'c', wrapped: 'w' } });
    expect(stripped.inviteKeys).toEqual({ i1: { wrapped: 'w' } });
  });

  it('does NOT mutate its input, matching mergeKeyDict', () => {
    const original = envelope();
    withoutPayload(original);
    expect(original.encryptedPayload).toBe('ZGVhZGJlZWY=');
  });

  it('is idempotent', () => {
    expect(withoutPayload(withoutPayload(envelope())).encryptedPayload).toBe('');
  });
});

describe('the file boundary rejects a stripped envelope', () => {
  it('parseBeanpodV4 throws on an EMPTY payload, not just a missing one', () => {
    // Without this, serialising a stripped envelope produces a file that parses
    // fine and yields a zero-byte decrypt much later — surfacing as corruption,
    // which clears the cache.
    const json = JSON.stringify(withoutPayload(envelope()));
    expect(() => parseBeanpodV4(json)).toThrow(/encryptedPayload/);
  });

  it('still accepts a real payload', () => {
    const parsed = parseBeanpodV4(JSON.stringify(envelope()));
    expect(parsed.encryptedPayload).toBe('ZGVhZGJlZWY=');
  });

  it('still rejects a missing payload', () => {
    const { encryptedPayload: _drop, ...rest } = envelope();
    expect(() => parseBeanpodV4(JSON.stringify(rest))).toThrow(/encryptedPayload/);
  });
});
