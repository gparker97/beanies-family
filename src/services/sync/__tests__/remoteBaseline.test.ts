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
  toStoredRevision,
  withinTrustWindow,
  type RemoteBaseline,
  type RemoteMarker,
} from '../remoteBaseline';

const baseline = (over: Partial<RemoteBaseline> = {}): RemoteBaseline => ({
  revision: 'ver:10',
  modifiedTime: '2026-08-13T00:00:00.000Z',
  checkedAt: '2026-08-13T00:00:00.000Z',
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
