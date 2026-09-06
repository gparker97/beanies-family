/**
 * Pure unit table for `remoteBaseline.ts` — the decision logic behind the
 * open-path Drive-read guard (tracker #61, PR 2). This is the primary safety
 * net and it mocks NOTHING: every branch of the comparator, the revision
 * prefixing and the trust-window clock handling is exercised as pure data-in /
 * data-out. If a future change makes any of these functions harder to test
 * without a mock, that change has broken the design (plan C15).
 */
import { describe, it, expect } from 'vitest';
import {
  BASELINE_MAX_TRUST_MS,
  compareMarkers,
  decodeBaselinePayload,
  encodeBaselinePayload,
  hasUnpushedChanges,
  headsFingerprint,
  decodeHeadsFingerprint,
  toStoredRevision,
  withinTrustWindow,
  type RemoteBaseline,
  type RemoteMarker,
} from '../remoteBaseline';

const baseline = (over: Partial<RemoteBaseline> = {}): RemoteBaseline => ({
  revision: 'ver:10',
  modifiedTime: '2026-08-13T00:00:00.000Z',
  checkedAt: '2026-08-13T00:00:00.000Z',
  headsFp: null,
  ...over,
});

const marker = (over: Partial<RemoteMarker> = {}): RemoteMarker => ({
  revision: 'ver:10',
  modifiedTime: '2026-08-13T00:00:00.000Z',
  ...over,
});

describe('toStoredRevision', () => {
  it('prefixes a raw version with ver:', () => {
    expect(toStoredRevision('12')).toBe('ver:12');
  });
  it('passes null / undefined / empty through as null (no revision => read)', () => {
    expect(toStoredRevision(null)).toBeNull();
    expect(toStoredRevision(undefined)).toBeNull();
    expect(toStoredRevision('')).toBeNull();
  });
});

describe('compareMarkers — revision basis (authoritative)', () => {
  it('same revision => unchanged / revision', () => {
    const r = compareMarkers(baseline({ revision: 'ver:10' }), marker({ revision: 'ver:10' }));
    expect(r).toMatchObject({ status: 'unchanged', basis: 'revision', revision: 'ver:10' });
  });

  it('different revision => changed / revision', () => {
    const r = compareMarkers(baseline({ revision: 'ver:10' }), marker({ revision: 'ver:11' }));
    expect(r).toMatchObject({ status: 'changed', basis: 'revision', revision: 'ver:11' });
  });

  it('probe has a revision but no baseline revision => changed (first sight)', () => {
    const r = compareMarkers(baseline({ revision: null }), marker({ revision: 'ver:5' }));
    expect(r).toMatchObject({ status: 'changed', basis: 'revision', reason: 'no-baseline' });
  });

  it('probe has a revision but baseline is null => changed (first sight)', () => {
    const r = compareMarkers(null, marker({ revision: 'ver:5' }));
    expect(r).toMatchObject({ status: 'changed', basis: 'revision', reason: 'no-baseline' });
  });

  it('compares revisions with equality only — a lexically-smaller newer counter still reads', () => {
    // '9' < '100' lexically; equality-only comparison must call them different.
    const r = compareMarkers(baseline({ revision: 'ver:9' }), marker({ revision: 'ver:100' }));
    expect(r.status).toBe('changed');
  });
});

describe('compareMarkers — mtime fallback (no revision)', () => {
  it('same mtime => unchanged / mtime', () => {
    const r = compareMarkers(
      baseline({ revision: null, modifiedTime: 'T1' }),
      marker({ revision: null, modifiedTime: 'T1' })
    );
    expect(r).toMatchObject({ status: 'unchanged', basis: 'mtime', revision: null });
  });

  it('different mtime => changed / mtime', () => {
    const r = compareMarkers(
      baseline({ revision: null, modifiedTime: 'T1' }),
      marker({ revision: null, modifiedTime: 'T2' })
    );
    expect(r).toMatchObject({ status: 'changed', basis: 'mtime' });
  });

  it('mtime present but no baseline => changed (today: evidence + no baseline)', () => {
    const r = compareMarkers(null, marker({ revision: null, modifiedTime: 'T1' }));
    expect(r).toMatchObject({ status: 'changed', basis: 'mtime' });
  });
});

describe('compareMarkers — no evidence', () => {
  it('null revision AND null mtime => unknown / none', () => {
    const r = compareMarkers(baseline(), marker({ revision: null, modifiedTime: null }));
    expect(r).toMatchObject({ status: 'unknown', basis: 'none' });
  });
});

describe('withinTrustWindow', () => {
  const now = Date.parse('2026-08-13T01:00:00.000Z');

  it('inside the window => true', () => {
    const checkedAt = new Date(now - (BASELINE_MAX_TRUST_MS - 1000)).toISOString();
    expect(withinTrustWindow(checkedAt, now)).toBe(true);
  });

  it('exactly at the bound => false (strict <)', () => {
    const checkedAt = new Date(now - BASELINE_MAX_TRUST_MS).toISOString();
    expect(withinTrustWindow(checkedAt, now)).toBe(false);
  });

  it('outside the window => false', () => {
    const checkedAt = new Date(now - (BASELINE_MAX_TRUST_MS + 1000)).toISOString();
    expect(withinTrustWindow(checkedAt, now)).toBe(false);
  });

  it('null => false', () => {
    expect(withinTrustWindow(null, now)).toBe(false);
  });

  it('unparseable => false (a bad clock never grants trust)', () => {
    expect(withinTrustWindow('not-a-date', now)).toBe(false);
  });

  it('future timestamp => false (a skewed-ahead clock never grants trust)', () => {
    const future = new Date(now + 60_000).toISOString();
    expect(withinTrustWindow(future, now)).toBe(false);
  });
});

// ─── #65: the Drive-heads fingerprint + row codec ────────────────────────────
// Everything branchy about the #65 change lives here, pure: no fake IDB, no
// worker harness. If these pass, the compatibility ladder is proved.

describe('headsFingerprint / hasUnpushedChanges (#65)', () => {
  it('same heads => not unpushed (the skip is allowed to proceed)', () => {
    const fp = headsFingerprint(['aaa', 'bbb']);
    expect(hasUnpushedChanges(fp, headsFingerprint(['aaa', 'bbb']))).toBe(false);
  });

  it('different heads => unpushed (decline the skip)', () => {
    const baselineFp = headsFingerprint(['aaa']);
    expect(hasUnpushedChanges(baselineFp, headsFingerprint(['aaa', 'bbb']))).toBe(true);
  });

  it('ABSENT baseline fingerprint => unpushed (we cannot prove it is on Drive)', () => {
    expect(hasUnpushedChanges(null, headsFingerprint(['aaa']))).toBe(true);
  });

  it('empty heads is a real, distinguishable value — not conflated with unknown', () => {
    expect(hasUnpushedChanges(headsFingerprint([]), headsFingerprint([]))).toBe(false);
    expect(hasUnpushedChanges(headsFingerprint([]), headsFingerprint(['aaa']))).toBe(true);
  });

  it('is stable across calls (a fingerprint is a pure function of its input)', () => {
    expect(headsFingerprint(['a', 'b'])).toBe(headsFingerprint(['a', 'b']));
  });
});

describe('encodeBaselinePayload / decodeBaselinePayload (#65)', () => {
  it('round-trips a revision WITH a fingerprint', () => {
    const fp = headsFingerprint(['h1', 'h2']);
    expect(decodeBaselinePayload(encodeBaselinePayload('ver:12', fp))).toEqual({
      revision: 'ver:12',
      headsFp: fp,
    });
  });

  it('round-trips a revision with NO fingerprint (terminus could not prove Drive content)', () => {
    expect(decodeBaselinePayload(encodeBaselinePayload('ver:12', null))).toEqual({
      revision: 'ver:12',
      headsFp: null,
    });
  });

  it('reads a LEGACY pre-#65 row (bare namespaced revision) as revision-only', () => {
    // The upgrade path: usable revision, unknown heads => declines once, then the
    // next terminus rewrites the row in the new format. No migration.
    expect(decodeBaselinePayload('ver:7')).toEqual({ revision: 'ver:7', headsFp: null });
  });

  it('returns null for an empty payload (=> no baseline => read)', () => {
    expect(decodeBaselinePayload('')).toBeNull();
  });

  it('returns null for valid JSON of the wrong shape, without throwing', () => {
    expect(decodeBaselinePayload('{"nope":1}')).toBeNull();
    expect(decodeBaselinePayload('[1,2,3]')).toBeNull();
    expect(decodeBaselinePayload('null')).toBeNull();
    expect(decodeBaselinePayload('42')).toBeNull();
  });

  it('ignores a non-string fingerprint rather than trusting it', () => {
    expect(decodeBaselinePayload('{"r":"ver:3","h":99}')).toEqual({
      revision: 'ver:3',
      headsFp: null,
    });
  });

  it('never throws on arbitrary garbage', () => {
    for (const junk of ['{', '\u0000', 'ver:', '{"r":""}', '{"r":null}']) {
      expect(() => decodeBaselinePayload(junk)).not.toThrow();
    }
  });
});

/**
 * ⚠️ THE ROUND-TRIP IS LOAD-BEARING, AND NOTHING ELSE PINS IT.
 *
 * `decodeHeadsFingerprint` is how a stored baseline row becomes the heads the
 * WORKER compares against, which is how the lineage guard tells `clean` from
 * `dirty`. Hashing or truncating `headsFingerprint` — the obvious tidy-up for a
 * value that is only ever compared for equality — would leave every caller
 * compiling and every other test green while the guard silently answered
 * `dirty` forever: no device could ever adopt a compaction, and none could
 * propagate. These are the tests that fail instead.
 */
describe('heads fingerprint round-trip', () => {
  // Real change hashes are 64 lowercase hex chars. Deliberately includes
  // LETTERS: an all-digits head is unchanged by `toUpperCase()`, so the
  // wrong-case case below would silently assert nothing.
  const h = (n: number) => `${n}`.padStart(2, '0').repeat(32).replace(/0/g, 'e');

  it('recovers the exact head list it encoded', () => {
    for (const heads of [[], [h(1)], [h(1), h(2)], [h(1), h(2), h(3)]]) {
      expect(decodeHeadsFingerprint(headsFingerprint(heads))).toEqual(heads);
    }
  });

  it('answers null for "we cannot tell", never a plausible guess', () => {
    expect(decodeHeadsFingerprint(null)).toBeNull();
    // A hashed / truncated / re-formatted fingerprint — i.e. the exact tidy-up
    // the comment on `headsFingerprint` warns against.
    for (const junk of ['deadbeef', h(1).toUpperCase(), h(1).slice(0, 63), 'a b', '  ']) {
      expect(decodeHeadsFingerprint(junk)).toBeNull();
    }
  });

  it('distinguishes "no heads" from "unknown"', () => {
    // Both are falsy-ish and were conflated in a draft; they mean opposite
    // things to the guard (`[]` is a real answer, `null` blocks an adopt).
    expect(decodeHeadsFingerprint('')).toEqual([]);
    expect(decodeHeadsFingerprint(null)).toBeNull();
  });
});
