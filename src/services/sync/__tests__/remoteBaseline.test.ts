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
  revisionAdvance,
  decideMergeConfirm,
  readStanding,
  type PendingRead,
  type BaselinePayload,
  type ChangeResult,
  type OpenReadInputs,
  baselineFromMarker,
  baselineFromRow,
  classifyWriteAdvance,
  decideOpenRead,
  describeChange,
  isTrustedBasis,
  markerOf,
  toStoredContentId,
  unknownChange,
} from '../remoteBaseline';

const baseline = (over: Partial<RemoteBaseline> = {}): RemoteBaseline => ({
  revision: 'ver:10',
  modifiedTime: '2026-08-13T00:00:00.000Z',
  checkedAt: '2026-08-13T00:00:00.000Z',
  headsFp: null,
  contentId: null,
  envelopeFp: null,
  ...over,
});

/** A row payload in the current codec; unspecified ids are null. */
const row = (over: Partial<BaselinePayload> = {}): string =>
  encodeBaselinePayload({
    revision: null,
    headsFp: null,
    contentId: null,
    envelopeFp: null,
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

describe('toStoredContentId (requirement 11)', () => {
  it('prefixes a raw md5Checksum with md5:', () => {
    expect(toStoredContentId('abc')).toBe('md5:abc');
  });
  it('answers null for anything but a non-empty string (=> version basis)', () => {
    for (const v of [null, undefined, '', 42, {}, ['abc']]) expect(toStoredContentId(v)).toBeNull();
  });
});

/**
 * Requirement 11: equal content ids are the ONLY new trust. Every row where the
 * content basis is not available must answer exactly as the version basis did.
 */
describe('compareMarkers — content basis (requirement 11)', () => {
  const C1 = 'md5:aaa';
  const C2 = 'md5:bbb';
  it.each<[string, RemoteBaseline | null, RemoteMarker, Partial<ChangeResult>]>([
    [
      'both present and equal, version equal => unchanged on content, nothing to adopt',
      baseline({ contentId: C1 }),
      marker({ contentId: C1 }),
      { status: 'unchanged', basis: 'content', adoptRevision: null, drift: 0 },
    ],
    [
      'both present and equal, version DRIFTED => unchanged on content, adopt the new revision',
      baseline({ revision: 'ver:10', contentId: C1 }),
      marker({ revision: 'ver:12', contentId: C1 }),
      { status: 'unchanged', basis: 'content', adoptRevision: 'ver:12', drift: 2 },
    ],
    [
      'both present and different, version equal => changed (read), never trusted on version',
      baseline({ contentId: C1 }),
      marker({ contentId: C2 }),
      { status: 'changed', basis: 'content', adoptRevision: null },
    ],
    [
      'probe missing a content id => version compare exactly as before (unchanged)',
      baseline({ contentId: C1 }),
      marker({ contentId: null }),
      { status: 'unchanged', basis: 'revision', adoptRevision: null, drift: null },
    ],
    [
      'probe missing a content id, version moved => changed on version',
      baseline({ contentId: C1 }),
      marker({ revision: 'ver:11' }),
      { status: 'changed', basis: 'revision' },
    ],
    [
      'LEGACY baseline (no content id) => version compare; a drifted version still reads',
      baseline({ contentId: null }),
      marker({ revision: 'ver:11', contentId: C1 }),
      { status: 'changed', basis: 'revision', adoptRevision: null },
    ],
    [
      'no baseline at all => first sight reads, whatever the content id',
      null,
      marker({ contentId: C1 }),
      { status: 'changed', basis: 'revision', reason: 'no-baseline' },
    ],
    [
      'non-Drive provider (no revision, no content id) => mtime basis as before',
      baseline({ revision: null, modifiedTime: 'T1' }),
      marker({ revision: null, modifiedTime: 'T1', contentId: undefined }),
      { status: 'unchanged', basis: 'mtime' },
    ],
    [
      'a malformed content id on either side is no content id (version basis)',
      baseline({ contentId: 'aaa' }),
      marker({ contentId: 'aaa' }),
      { status: 'unchanged', basis: 'revision' },
    ],
    [
      'an empty digest is no content id',
      baseline({ contentId: 'md5:' }),
      marker({ revision: 'ver:11', contentId: 'md5:' }),
      { status: 'changed', basis: 'revision' },
    ],
  ])('%s', (_name, b, m, expected) => {
    expect(compareMarkers(b, m)).toMatchObject(expected);
  });

  it('carries the probe content id, so a learn after the merge records it', () => {
    const r = compareMarkers(null, marker({ contentId: C1 }));
    expect(markerOf(r)).toEqual({
      revision: 'ver:10',
      modifiedTime: '2026-08-13T00:00:00.000Z',
      contentId: C1,
    });
  });

  it('an unknown never carries a content id or a revision to adopt', () => {
    expect(
      compareMarkers(baseline({ contentId: C1 }), { revision: null, modifiedTime: null })
    ).toEqual(unknownChange('no-evidence'));
  });
});

describe('isTrustedBasis / describeChange', () => {
  it('trusts content and version, never mtime or none', () => {
    expect(isTrustedBasis('content')).toBe(true);
    expect(isTrustedBasis('revision')).toBe(true);
    expect(isTrustedBasis('mtime')).toBe(false);
    expect(isTrustedBasis('none')).toBe(false);
  });
  it('names the basis content|version and the drift for the change-probe detail', () => {
    const drifted = compareMarkers(
      baseline({ contentId: 'md5:a' }),
      marker({ revision: 'ver:13', contentId: 'md5:a' })
    );
    expect(describeChange(drifted)).toBe('status=unchanged;basis=content;drift=3');
    const onVersion = compareMarkers(baseline(), marker());
    expect(describeChange(onVersion)).toBe('status=unchanged;basis=version;drift=none');
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

const decoded = (over: Partial<BaselinePayload> = {}): BaselinePayload => ({
  revision: null,
  headsFp: null,
  contentId: null,
  envelopeFp: null,
  ...over,
});

describe('encodeBaselinePayload / decodeBaselinePayload (#65, requirement 11)', () => {
  it('round-trips a revision WITH a fingerprint', () => {
    const fp = headsFingerprint(['h1', 'h2']);
    expect(decodeBaselinePayload(row({ revision: 'ver:12', headsFp: fp }))).toEqual(
      decoded({ revision: 'ver:12', headsFp: fp })
    );
  });

  it('round-trips the content id (c) and envelope fingerprint (e)', () => {
    const full = decoded({
      revision: 'ver:12',
      headsFp: 'h',
      contentId: 'md5:abc',
      envelopeFp: 'ef',
    });
    expect(JSON.parse(encodeBaselinePayload(full))).toEqual({
      r: 'ver:12',
      h: 'h',
      c: 'md5:abc',
      e: 'ef',
    });
    expect(decodeBaselinePayload(encodeBaselinePayload(full))).toEqual(full);
  });

  it('tolerates a row written before c/e existed: both decode as null', () => {
    expect(decodeBaselinePayload('{"r":"ver:3","h":"h"}')).toEqual(
      decoded({ revision: 'ver:3', headsFp: 'h' })
    );
  });

  it('a revision-less row never carries content trust, even if c is present', () => {
    expect(decodeBaselinePayload('{"r":null,"h":"h","c":"md5:abc","e":"ef"}')).toEqual(
      decoded({ headsFp: 'h', envelopeFp: 'ef' })
    );
  });

  it('a malformed c or e decodes as null, never a guess', () => {
    expect(decodeBaselinePayload('{"r":"ver:3","h":null,"c":"abc","e":7}')).toEqual(
      decoded({ revision: 'ver:3' })
    );
    expect(decodeBaselinePayload('{"r":"ver:3","h":null,"c":42}')).toEqual(
      decoded({ revision: 'ver:3' })
    );
  });

  it('reads a LEGACY pre-#65 row (bare namespaced revision) as revision-only', () => {
    // The upgrade path: usable revision, unknown heads => declines once, then the
    // next terminus rewrites the row in the new format. No migration.
    expect(decodeBaselinePayload('ver:7')).toEqual(decoded({ revision: 'ver:7' }));
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
    expect(decodeBaselinePayload('{"r":"ver:3","h":99}')).toEqual(decoded({ revision: 'ver:3' }));
  });

  it('never throws on arbitrary garbage', () => {
    for (const junk of ['{', '\u0000', 'ver:', '{"r":""}', '{"r":null}']) {
      expect(() => decodeBaselinePayload(junk)).not.toThrow();
    }
  });
});

describe('baselineFromRow / baselineFromMarker', () => {
  it('seeds the in-memory baseline from a row, checkedAt from the row', () => {
    const payload = row({ revision: 'ver:4', headsFp: 'h', contentId: 'md5:c', envelopeFp: 'e' });
    expect(baselineFromRow({ payload, checkedAt: 'T0' })).toEqual({
      revision: 'ver:4',
      headsFp: 'h',
      contentId: 'md5:c',
      envelopeFp: 'e',
      modifiedTime: null,
      checkedAt: 'T0',
    });
    expect(baselineFromRow(null)).toBeNull();
    expect(baselineFromRow({ payload: '{"nope":1}', checkedAt: 'T0' })).toBeNull();
  });

  it('a learned marker keeps its content id and starts heads and envelope unknown', () => {
    expect(
      baselineFromMarker({ revision: 'ver:4', modifiedTime: null, contentId: 'md5:c' }, 'T1')
    ).toEqual(
      baseline({ revision: 'ver:4', modifiedTime: null, checkedAt: 'T1', contentId: 'md5:c' })
    );
    expect(
      baselineFromMarker({ revision: 'ver:4', modifiedTime: null }, 'T1').contentId
    ).toBeNull();
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

describe('baseline payload round-trip', () => {
  /**
   * ⚠️ THE TWO ARMS READ THE SAME FIELD TWO WAYS. The revision-less arm required
   * a NON-EMPTY string; the revision arm accepted any string. So an empty heads
   * fingerprint survived one and not the other — and `''` is not hypothetical:
   * `decodeHeadsFingerprint('')` deliberately answers `[]`, because "a document
   * with no heads" is a real, empty answer rather than a missing one. One helper
   * now reads it for both arms, so they cannot disagree again.
   */
  it('round-trips an EMPTY heads fingerprint on the revision-less arm', () => {
    expect(decodeBaselinePayload(row({ headsFp: '' }))).toEqual(decoded({ headsFp: '' }));
  });

  it('round-trips an empty heads fingerprint on the revision arm too', () => {
    expect(decodeBaselinePayload(row({ revision: 'ver:1', headsFp: '' }))).toEqual(
      decoded({ revision: 'ver:1', headsFp: '' })
    );
  });

  it('still decodes a NULL fingerprint as null on both arms', () => {
    // "We committed a baseline and could not prove what the remote held" (a terminus
    // that could not prove Drive content) — the fail-safe row, which must keep
    // reading as `dirty`.
    expect(decodeBaselinePayload(row())).toEqual(decoded());
    expect(decodeBaselinePayload(row({ revision: 'ver:1' }))).toEqual(
      decoded({ revision: 'ver:1' })
    );
  });
});

describe('revisionAdvance (audit C4 write-race check)', () => {
  it('measures how far a Drive revision moved, in BigInt (int64 strings)', () => {
    expect(revisionAdvance('ver:10', 'ver:11')).toBe(1);
    expect(revisionAdvance('ver:10', 'ver:13')).toBe(3);
    expect(revisionAdvance('ver:9007199254740993', 'ver:9007199254740995')).toBe(2);
  });
  it('answers null — "no evidence", never a race — for anything not comparable', () => {
    expect(revisionAdvance(null, 'ver:2')).toBeNull();
    expect(revisionAdvance('ver:1', null)).toBeNull();
    expect(revisionAdvance('ver:1', undefined)).toBeNull();
    expect(revisionAdvance('ver:1', 'rev:2')).toBeNull();
    expect(revisionAdvance('ver:x', 'ver:2')).toBeNull();
    // A partial ack (not even a string) must not throw after a write that landed.
    expect(revisionAdvance('ver:1', 42 as never)).toBeNull();
  });
});

describe('classifyWriteAdvance (requirement 12)', () => {
  const m = (revision: string, contentId: string | null = null) => ({
    revision,
    modifiedTime: null,
    contentId,
  });
  it.each<
    [
      string,
      string | null,
      Parameters<typeof classifyWriteAdvance>[1],
      ReturnType<typeof classifyWriteAdvance>,
    ]
  >([
    [
      'advance of exactly 1 is clean, as today',
      'ver:10',
      { revision: 'ver:11' },
      { kind: 'clean', advance: 1, marker: m('ver:11') },
    ],
    [
      'advance of 1 with a content id is clean and learns the content id',
      'ver:10',
      { revision: 'ver:11', contentId: 'md5:ours' },
      { kind: 'clean', advance: 1, marker: m('ver:11', 'md5:ours') },
    ],
    [
      'advance above 1 WITH a content id on the ack is own-bytes (commit + confirm by probe)',
      'ver:10',
      { revision: 'ver:13', contentId: 'md5:ours' },
      { kind: 'own-bytes', advance: 3, marker: m('ver:13', 'md5:ours') },
    ],
    [
      'advance above 1 WITHOUT a content id is raced, exactly as today',
      'ver:10',
      { revision: 'ver:13' },
      { kind: 'raced', advance: 3 },
    ],
    [
      'a malformed content id on the ack is no content id => raced',
      'ver:10',
      { revision: 'ver:13', contentId: 'ours' },
      { kind: 'raced', advance: 3 },
    ],
    [
      'no probe revision => advance unknown => clean (no evidence is never a race)',
      null,
      { revision: 'ver:13' },
      { kind: 'clean', advance: null, marker: m('ver:13') },
    ],
    [
      'no ack revision (malformed 2xx) => no-ack, the caller re-probes',
      'ver:10',
      { revision: null },
      { kind: 'no-ack' },
    ],
    ['no ack at all (void provider) => no-ack', 'ver:10', null, { kind: 'no-ack' }],
  ])('%s', (_name, probe, ack, expected) => {
    expect(classifyWriteAdvance(probe, ack)).toEqual(expected);
  });
});

/**
 * Requirement 13: the open-read ladder, one rung per call. The shell answers
 * `check-heads` and `probe`; these rows feed those answers in directly.
 */
describe('decideOpenRead (requirement 13)', () => {
  const NOW = Date.parse('2026-11-15T12:00:00.000Z');
  const fresh = new Date(NOW - 60_000).toISOString();
  const old = new Date(NOW - 3 * BASELINE_MAX_TRUST_MS).toISOString();
  const contentBase = baseline({ contentId: 'md5:a', headsFp: 'h', checkedAt: old });
  const versionBase = baseline({ headsFp: 'h', checkedAt: fresh });
  const probe = (b: RemoteBaseline, over: Partial<RemoteMarker> = {}) =>
    compareMarkers(b, marker(over));
  const run = (i: Partial<OpenReadInputs>) => decideOpenRead({ baseline: null, nowMs: NOW, ...i });

  it.each<[string, Partial<OpenReadInputs>, ReturnType<typeof decideOpenRead>]>([
    [
      'no baseline reads without any I/O',
      {},
      { kind: 'read', reason: 'no-baseline', probed: null },
    ],
    [
      'version baseline with no revision reads without I/O',
      { baseline: baseline({ revision: null, checkedAt: fresh }) },
      { kind: 'read', reason: 'no-baseline', probed: null },
    ],
    [
      'version baseline past the trust window reads without I/O (unchanged)',
      { baseline: baseline({ headsFp: 'h', checkedAt: old }) },
      { kind: 'read', reason: 'trust-expired', probed: null },
    ],
    [
      'a CONTENT baseline past the trust window still asks for the heads check',
      { baseline: contentBase },
      { kind: 'check-heads' },
    ],
    [
      'heads that differ from the baseline read, before any probe',
      { baseline: contentBase, headsBlock: 'unpushed-local-changes' },
      { kind: 'read', reason: 'unpushed-local-changes', probed: null },
    ],
    [
      'an unknown (null) heads fingerprint reads, before any probe',
      { baseline: { ...contentBase, headsFp: null }, headsBlock: 'baseline-heads-unknown' },
      { kind: 'read', reason: 'baseline-heads-unknown', probed: null },
    ],
    [
      'clean heads ask for the probe',
      { baseline: contentBase, headsBlock: null },
      { kind: 'probe' },
    ],
    [
      'content unchanged AND heads equal skip at ANY baseline age',
      {
        baseline: contentBase,
        headsBlock: null,
        change: probe(contentBase, { contentId: 'md5:a', revision: 'ver:99' }),
      },
      { kind: 'skip', reason: 'content-unchanged' },
    ],
    [
      'version baseline, in window, unchanged on version skips as before',
      { baseline: versionBase, headsBlock: null, change: probe(versionBase) },
      { kind: 'skip', reason: 'unchanged-revision-in-window' },
    ],
    [
      'an unknown probe reads and hands no marker to the load',
      { baseline: contentBase, headsBlock: null, change: unknownChange('auth') },
      { kind: 'read', reason: 'auth', probed: null },
    ],
  ])('%s', (_name, inputs, expected) => {
    expect(run(inputs)).toEqual(expected);
  });

  it('content changed reads and hands the deciding probe to the load (requirement 14)', () => {
    const change = probe(contentBase, { contentId: 'md5:b' });
    expect(run({ baseline: contentBase, headsBlock: null, change })).toEqual({
      kind: 'read',
      reason: 'changed',
      probed: change,
    });
  });

  it('a content baseline whose probe has no content id falls back to the trust window', () => {
    const change = probe(contentBase, { contentId: null });
    expect(change.basis).toBe('revision');
    expect(run({ baseline: contentBase, headsBlock: null, change })).toEqual({
      kind: 'read',
      reason: 'trust-expired',
      probed: change,
    });
    const inWindow = { ...contentBase, checkedAt: fresh };
    expect(
      run({ baseline: inWindow, headsBlock: null, change: probe(inWindow, { contentId: null }) })
    ).toEqual({ kind: 'skip', reason: 'unchanged-revision-in-window' });
  });

  it('never skips on an mtime basis', () => {
    const change = compareMarkers(versionBase, { revision: null, modifiedTime: 'T' });
    expect(run({ baseline: versionBase, headsBlock: null, change })).toMatchObject({
      kind: 'read',
      reason: 'no-revision',
    });
  });
});

describe('decideMergeConfirm (requirement 17)', () => {
  const marker: RemoteMarker = { revision: 'ver:6', modifiedTime: null };
  const pending = (over: Partial<PendingRead> = {}): PendingRead => ({
    marker,
    commitSeq: 3,
    ...over,
  });

  it.each<[string, PendingRead | null, number, ReturnType<typeof decideMergeConfirm>]>([
    [
      'learns the sampled marker when nothing committed since',
      pending(),
      3,
      { kind: 'learn', marker },
    ],
    [
      'commits with no revision when the probe failed',
      pending({ marker: null }),
      3,
      { kind: 'no-marker' },
    ],
    [
      'commits nothing when any commit landed after the sample',
      pending(),
      4,
      { kind: 'superseded' },
    ],
    [
      'superseded wins over a failed probe (no heads either)',
      pending({ marker: null }),
      5,
      { kind: 'superseded' },
    ],
    ['commits nothing when no read is pending (reset or rollback)', null, 3, { kind: 'no-read' }],
  ])('%s', (_name, p, seqNow, expected) => {
    expect(decideMergeConfirm(p, seqNow)).toEqual(expected);
  });
});

describe('readStanding: a confirm or rollback acts only on its own read', () => {
  const read = (over: Partial<PendingRead> = {}): PendingRead => ({
    marker: null,
    commitSeq: 0,
    ...over,
  });
  const mine = read();
  const newer = read();
  const done = read({ settled: true });

  it.each<[string, PendingRead | null, PendingRead | null, ReturnType<typeof readStanding>]>([
    ['the newest outstanding read acts', mine, mine, 'own'],
    ['an older read, while a newer one is outstanding, is superseded', mine, newer, 'superseded'],
    ['an older read after every read settled is superseded', mine, null, 'superseded'],
    ['a settled read never acts again', done, null, 'settled'],
    ['a settled read never acts, even if still named newest', done, done, 'settled'],
    ['no read registered (load returned early) is a no-op', null, mine, 'settled'],
  ])('%s', (_name, r, newest, expected) => {
    expect(readStanding(r, newest)).toBe(expected);
  });
});
