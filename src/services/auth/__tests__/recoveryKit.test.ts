import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
import {
  generateRecoveryKit,
  redeemRecoveryKit,
  normalizeKitCode,
} from '@/services/auth/recoveryKit';
import { generateFamilyKey, exportFamilyKey } from '@/services/crypto/familyKeyService';
import {
  generatePassphrase,
  checkPassphrase,
  PASSPHRASE_WORD_COUNT,
} from '@/utils/passphraseStrength';

describe('recoveryKit', () => {
  it('generate → redeem round-trips the family key', async () => {
    const fk = await generateFamilyKey();
    const kit = await generateRecoveryKit(fk);
    const groups = kit.code.split('-');
    expect(groups).toHaveLength(8);
    for (const g of groups) expect(g).toMatch(/^[0-9A-Z]{4}$/);
    expect(kit.kitId).toMatch(/^[0-9a-f]{8}$/);

    const result = await redeemRecoveryKit({ recoveryKeys: { [kit.kitId]: kit.pkg } }, kit.code);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(await exportFamilyKey(result.familyKey)).toEqual(await exportFamilyKey(fk));
      expect(result.kitId).toBe(kit.kitId);
    }
  });

  it('redeems a sloppily transcribed code (lowercase, spaces, O/I/L aliases)', async () => {
    const fk = await generateFamilyKey();
    const kit = await generateRecoveryKit(fk);
    const sloppy = kit.code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    const result = await redeemRecoveryKit({ recoveryKeys: { [kit.kitId]: kit.pkg } }, sloppy);
    expect(result.ok).toBe(true);
  });

  it('multiple kits coexist; each code opens only via its own entry', async () => {
    const fk = await generateFamilyKey();
    const a = await generateRecoveryKit(fk);
    const b = await generateRecoveryKit(fk);
    const envelope = { recoveryKeys: { [a.kitId]: a.pkg, [b.kitId]: b.pkg } };
    const ra = await redeemRecoveryKit(envelope, a.code);
    const rb = await redeemRecoveryKit(envelope, b.code);
    expect(ra).toMatchObject({ ok: true, kitId: a.kitId });
    expect(rb).toMatchObject({ ok: true, kitId: b.kitId });
  });

  it('wrong code and no kits fail typed', async () => {
    const fk = await generateFamilyKey();
    const kit = await generateRecoveryKit(fk);
    expect(await redeemRecoveryKit({ recoveryKeys: {} }, kit.code)).toEqual({
      ok: false,
      reason: 'no-kits',
    });
    expect(
      await redeemRecoveryKit(
        { recoveryKeys: { [kit.kitId]: kit.pkg } },
        'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'
      )
    ).toEqual({ ok: false, reason: 'wrong-code' });
  });

  it('normalizeKitCode maps Crockford aliases', () => {
    expect(normalizeKitCode('ab-Ol i1')).toBe('AB0111');
  });
});

describe('passphraseStrength', () => {
  it('generates 4 hyphenated words that pass the check', () => {
    const p = generatePassphrase();
    expect(p.split('-')).toHaveLength(PASSPHRASE_WORD_COUNT);
    expect(checkPassphrase(p)).toEqual({ ok: true });
  });

  it('rejects short, few-token, and name-matching phrases', () => {
    expect(checkPassphrase('short-one')).toMatchObject({ ok: false });
    expect(checkPassphrase('justonelongsinglewordhere')).toEqual({
      ok: false,
      reason: 'too-few-words',
    });
    expect(checkPassphrase('the beans family', { familyName: 'The Beans Family' })).toEqual({
      ok: false,
      reason: 'matches-name',
    });
  });
});
