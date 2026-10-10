import { describe, it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}
import {
  generateRecoveryKit,
  redeemRecoveryKit,
  normalizeKitCode,
} from '@/services/auth/recoveryKit';
import {
  generateFamilyKey,
  exportFamilyKey,
  wrapFamilyKey,
  SALT_LENGTH,
} from '@/services/crypto/familyKeyService';
import { KDF_PROFILES, LEGACY_ITERATIONS, derivePbkdf2Key } from '@/services/crypto/kdfParams';
import { logEvent } from '@/services/telemetry/logEvent';
import { bufferToBase64 } from '@/utils/encoding';
import {
  generatePassphrase,
  checkPassphrase,
  isLegacyGeneratedShape,
  drawIndices,
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

  // C10: only an AES-KW wrong-key unwrap means "not this entry". A damaged entry used to be
  // swallowed into the same catch and reported as a mistyped code, forever, with no trace.
  it('a damaged entry is reported as an error, not as a wrong code', async () => {
    const fk = await generateFamilyKey();
    const kit = await generateRecoveryKit(fk);
    const damaged = { ...kit.pkg, salt: '%%% not base64 %%%' };
    expect(await redeemRecoveryKit({ recoveryKeys: { [kit.kitId]: damaged } }, kit.code)).toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('a damaged entry does not block a good kit beside it', async () => {
    const fk = await generateFamilyKey();
    const good = await generateRecoveryKit(fk);
    const bad = await generateRecoveryKit(fk);
    const envelope = {
      recoveryKeys: { [bad.kitId]: { ...bad.pkg, wrapped: '%%%' }, [good.kitId]: good.pkg },
    };
    expect(await redeemRecoveryKit(envelope, good.code)).toMatchObject({
      ok: true,
      kitId: good.kitId,
    });
  });

  // ADR-041: the kit records the count it was made with; readers honour it.
  it('a new kit records its iterations', async () => {
    const kit = await generateRecoveryKit(await generateFamilyKey());
    expect(kit.pkg.iterations).toBe(KDF_PROFILES.highEntropy);
  });

  it('a legacy kit with no recorded iterations still redeems', async () => {
    const fk = await generateFamilyKey();
    const kit = await generateRecoveryKit(fk);
    // Re-wrap the same code exactly as a pre-ADR-041 build did (100k, no `iterations`).
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const code = kit.code.replace(/-/g, '');
    const wrapKey = await derivePbkdf2Key(new TextEncoder().encode(code), salt, {
      profile: 'highEntropy',
      iterations: LEGACY_ITERATIONS,
    });
    const legacy = {
      salt: bufferToBase64(salt),
      wrapped: await wrapFamilyKey(fk, wrapKey),
      createdAt: kit.pkg.createdAt,
    };
    const result = await redeemRecoveryKit({ recoveryKeys: { [kit.kitId]: legacy } }, kit.code);
    expect(result).toMatchObject({ ok: true, kitId: kit.kitId });
  });

  it('a corrupt recorded count is an unusable entry, never a wrong code', async () => {
    vi.mocked(logEvent).mockClear();
    const fk = await generateFamilyKey();
    const kit = await generateRecoveryKit(fk);
    const corrupt = { ...kit.pkg, iterations: 1e12 };
    expect(await redeemRecoveryKit({ recoveryKeys: { [kit.kitId]: corrupt } }, kit.code)).toEqual({
      ok: false,
      reason: 'error',
    });
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          action: 'kit_entry_unusable',
          error_code: 'KdfParamsError',
        }),
      })
    );
  });

  it('normalizeKitCode maps Crockford aliases', () => {
    expect(normalizeKitCode('ab-Ol i1')).toBe('AB0111');
  });
});

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

describe('passphraseStrength', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/utils/passphraseScorer');
    vi.resetModules();
    reportErrorMock.mockClear();
  });

  it('generates 6 hyphenated words that pass the check', async () => {
    const p = await generatePassphrase();
    expect(p.split('-')).toHaveLength(PASSPHRASE_WORD_COUNT);
    expect(PASSPHRASE_WORD_COUNT).toBe(6);
    expect(await checkPassphrase(p)).toEqual({ ok: true, score: 4 });
  });

  it('never suggests a repeated or hyphenated word, even when the dice repeat', async () => {
    // Force every draw to the same value: the generator must redraw rather than repeat.
    // Index 0 first, then 1, 2, ... so six distinct words do eventually come out.
    let next = 0;
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((arr: Uint16Array) => {
      arr.fill(Math.floor(next++ / 3));
      return arr;
    }) as typeof crypto.getRandomValues);
    try {
      const words = (await generatePassphrase()).split('-');
      expect(words).toHaveLength(PASSPHRASE_WORD_COUNT);
      expect(new Set(words).size).toBe(PASSPHRASE_WORD_COUNT);
    } finally {
      spy.mockRestore();
    }
    const { EFF_WORDLIST } = await import('@/constants/effWordlist');
    const hyphenated = EFF_WORDLIST.words.filter((w) => w.includes('-'));
    expect(hyphenated.length).toBeGreaterThan(0); // the case this guards still exists
    for (let n = 0; n < 200; n++) {
      const words = (await generatePassphrase()).split('-');
      expect(words).toHaveLength(PASSPHRASE_WORD_COUNT);
      expect(new Set(words).size).toBe(PASSPHRASE_WORD_COUNT);
    }
  });

  it('rejects short phrases before scoring anything', async () => {
    expect(await checkPassphrase('short-one')).toMatchObject({ ok: false, reason: 'too-short' });
  });

  it('rejects the old 4-word suggestions however they are spaced or ordered', async () => {
    for (const p of [
      'apple-anchor-autumn-bacon',
      'apple anchor autumn bacon',
      'bacon badge apple bear',
      'bear bacon apple badge',
    ]) {
      expect(await checkPassphrase(p)).toMatchObject({ ok: false, reason: 'too-guessable' });
    }
  });

  it('rejects an easy sentence that used to pass', async () => {
    expect(await checkPassphrase('i love my kids 1')).toMatchObject({
      ok: false,
      reason: 'too-guessable',
    });
  });

  it('rejects a family or member name, ignoring case and separators', async () => {
    expect(await checkPassphrase('the beans family', ['The Beans Family'])).toMatchObject({
      ok: false,
      reason: 'matches-name',
    });
  });

  it('fails closed when the scorer chunk cannot load', async () => {
    vi.resetModules();
    vi.doMock('@/utils/passphraseScorer', () => {
      throw new Error('chunk failed');
    });
    const fresh = await import('@/utils/passphraseStrength');
    const verdict = await fresh.checkPassphrase('purple monkey dishwasher sunrise');
    expect(verdict).toMatchObject({ ok: false, reason: 'scorer-unavailable' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'passphrase-strength', severity: 'error' })
    );
  });

  it('accepts a suggested (EFF) phrase WITHOUT the scorer, so a chunk failure is never a dead end', async () => {
    vi.resetModules();
    vi.doMock('@/utils/passphraseScorer', () => {
      throw new Error('chunk failed');
    });
    const fresh = await import('@/utils/passphraseStrength');
    const suggested = await fresh.generatePassphrase();
    expect(await fresh.checkPassphrase(suggested)).toEqual({ ok: true, score: 4 });
    // Spaces instead of hyphens still count; a repeated word does not.
    expect(await fresh.checkPassphrase(suggested.replace(/-/g, ' '))).toEqual({
      ok: true,
      score: 4,
    });
    const [w] = suggested.split('-');
    expect(await fresh.checkPassphrase(Array(6).fill(w).join('-'))).toMatchObject({ ok: false });
    // A family or member name on the EFF list disqualifies the fallback: it is not entropy.
    const [first] = suggested.split('-');
    expect(await fresh.checkPassphrase(suggested, [first!])).toMatchObject({
      ok: false,
      reason: 'scorer-unavailable',
    });
  });

  it('maps zxcvbn warning keys to the translated hints (keyPattern, userInputs)', async () => {
    for (const [warning, hintKey] of [
      ['keyPattern', 'recovery.strengthHint.sequences'],
      ['straightRow', 'recovery.strengthHint.sequences'],
      ['userInputs', 'recovery.strengthHint.commonWord'],
      ['wordByItself', 'recovery.strengthHint.commonWord'],
      ['extendedRepeat', 'recovery.strengthHint.repeats'],
      ['recentYears', 'recovery.strengthHint.dates'],
    ] as const) {
      vi.resetModules();
      vi.doMock('@/utils/passphraseScorer', () => ({
        MIN_GUESSES_LOG10: 12,
        scorePassphrase: () => ({ score: 1, guessesLog10: 4, warning }),
      }));
      const fresh = await import('@/utils/passphraseStrength');
      expect(await fresh.checkPassphrase('not an eff phrase at all 1')).toMatchObject({
        ok: false,
        reason: 'too-guessable',
        hintKey,
      });
    }
  });

  it('detects the legacy generated shape only', () => {
    expect(isLegacyGeneratedShape('apple-anchor-autumn-bacon')).toBe(true);
    expect(isLegacyGeneratedShape('apple anchor autumn bacon')).toBe(false);
    expect(isLegacyGeneratedShape('apple-anchor-autumn')).toBe(false);
    expect(isLegacyGeneratedShape('apple-anchor-autumn-zzzzz')).toBe(false);
  });

  it('samples without modulo bias: out-of-range 13-bit draws are rejected, not folded', () => {
    // 7776 words: draws 7776..8191 are the biased tail. Feed two tail values, then good ones.
    const feed = [7776, 8191, 5, 7775, 0, 1, 2, 3];
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((buf: Uint16Array) => {
      buf.forEach((_, i) => (buf[i] = feed[i % feed.length]));
      return buf;
    }) as typeof crypto.getRandomValues);
    const out = drawIndices(4, 7776);
    expect(out).toEqual([5, 7775, 0, 1]);
    expect(out.every((i) => i >= 0 && i < 7776)).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('keeps drawing when a whole batch is rejected', () => {
    let calls = 0;
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((buf: Uint16Array) => {
      calls++;
      buf.fill(calls === 1 ? 8000 : 9);
      return buf;
    }) as typeof crypto.getRandomValues);
    expect(drawIndices(3, 7776)).toEqual([9, 9, 9]);
    expect(calls).toBe(2);
  });
});

// ── Manage Kits (tracker #99): the pure list builder ──────────────────────────
import { summarizeRecoveryKits } from '@/services/auth/recoveryKit';

describe('summarizeRecoveryKits', () => {
  const pkg = (createdAt: string, createdBy?: string) => ({
    salt: 's',
    wrapped: 'w',
    createdAt,
    ...(createdBy ? { createdBy } : {}),
  });

  it('lists live kits newest first, then invalidated kits newest first', () => {
    const kits = summarizeRecoveryKits({
      recoveryKeys: { old: pkg('2026-01-01T00:00:00Z', 'm1'), new: pkg('2026-09-01T00:00:00Z') },
      revokedKeys: {
        'recoveryKeys:deadEarly': { revokedAt: '2026-03-01T00:00:00Z', revokedBy: 'm2' },
        'recoveryKeys:deadLate': { revokedAt: '2026-08-01T00:00:00Z' },
      },
    });
    expect(kits).toEqual([
      { kitId: 'new', status: 'live', createdAt: '2026-09-01T00:00:00Z' },
      { kitId: 'old', status: 'live', createdAt: '2026-01-01T00:00:00Z', createdBy: 'm1' },
      {
        kitId: 'deadLate',
        status: 'invalidated',
        revokedAt: '2026-08-01T00:00:00Z',
      },
      {
        kitId: 'deadEarly',
        status: 'invalidated',
        revokedAt: '2026-03-01T00:00:00Z',
        revokedBy: 'm2',
      },
    ]);
  });

  it('ignores tombstones that are not slot-wide recoveryKeys ones', () => {
    const kits = summarizeRecoveryKits({
      recoveryKeys: {},
      revokedKeys: {
        'member:m1': { revokedAt: '2026-03-01T00:00:00Z' },
        'wrappedKeys:m1': { revokedAt: '2026-03-01T00:00:00Z' },
        'recoveryKeys:k1:pinnedwrap': { revokedAt: '2026-03-01T00:00:00Z', wrapped: 'pinnedwrap' },
      },
    });
    expect(kits).toEqual([]);
  });

  it('is empty for an envelope with neither field', () => {
    expect(summarizeRecoveryKits({})).toEqual([]);
  });
});
