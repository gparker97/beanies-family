/**
 * Characterization tests for the deep-link marker parser.
 *
 * This module had ZERO tests despite being the thing that carries a family-wide credential
 * out of a URL, and despite two separate defects (the 0.21.3 device-approval delivery bug,
 * and the earlier hand-rolled-regex drift its docblock describes) landing next to it.
 *
 * These pin behaviour that already works — they pass before and after the delivery fix —
 * so they are deliberately NOT presented as regression tests for that bug. What they stop
 * is someone "tidying" the fragment handling and quietly changing what a malformed link,
 * or an absent marker, does.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readHashMarker, consumeHashMarker, APPROVAL_LINK_HASH, KIT_LINK_HASH } from '../deepLinks';

describe('readHashMarker', () => {
  it('returns the decoded value when the marker is present', () => {
    expect(readHashMarker(`#${APPROVAL_LINK_HASH}abc123`, APPROVAL_LINK_HASH)).toBe('abc123');
  });

  it('percent-decodes the value', () => {
    expect(readHashMarker(`#${APPROVAL_LINK_HASH}a%2Bb`, APPROVAL_LINK_HASH)).toBe('a+b');
  });

  it('returns null when the marker is absent, which is how callers tell "not our link" from "our link, empty value"', () => {
    // `parseKitInput` depends on exactly this distinction to accept a hand-typed code.
    expect(readHashMarker('#something-else=1', APPROVAL_LINK_HASH)).toBeNull();
    expect(readHashMarker('', APPROVAL_LINK_HASH)).toBeNull();
  });

  it('returns an empty string (not null) for a present-but-empty marker', () => {
    expect(readHashMarker(`#${APPROVAL_LINK_HASH}`, APPROVAL_LINK_HASH)).toBe('');
  });

  it('falls back to the raw value when the escape is malformed rather than throwing', () => {
    // A bare `%` makes decodeURIComponent throw; the raw value is still the best guess.
    expect(readHashMarker(`#${APPROVAL_LINK_HASH}50%`, APPROVAL_LINK_HASH)).toBe('50%');
  });

  it('stops at a & or ? so a trailing param is not swallowed into the value', () => {
    expect(readHashMarker(`#${APPROVAL_LINK_HASH}abc&x=1`, APPROVAL_LINK_HASH)).toBe('abc');
  });

  it('does not confuse one marker for another', () => {
    const hash = `#${KIT_LINK_HASH}kitvalue`;
    expect(readHashMarker(hash, KIT_LINK_HASH)).toBe('kitvalue');
    expect(readHashMarker(hash, APPROVAL_LINK_HASH)).toBeNull();
  });
});

describe('consumeHashMarker', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/welcome');
  });

  it('reads the value AND strips the fragment in the same call', () => {
    history.replaceState({}, '', `/welcome?a=1#${KIT_LINK_HASH}secret`);

    expect(consumeHashMarker(KIT_LINK_HASH)).toBe('secret');

    // The strip is the point: a credential left in the hash survives every later
    // pushState, shows up in a screenshot of the address bar, and is handed to anything
    // that reads location.href.
    expect(window.location.hash).toBe('');
    expect(window.location.pathname + window.location.search).toBe('/welcome?a=1');
  });

  it('leaves the URL untouched when the marker is absent', () => {
    history.replaceState({}, '', '/welcome#unrelated=1');

    expect(consumeHashMarker(KIT_LINK_HASH)).toBeNull();
    expect(window.location.hash).toBe('#unrelated=1');
  });

  it('preserves history state, because passing null would wipe vue-router’s', () => {
    history.replaceState({ marker: 'keep-me' }, '', `/welcome#${KIT_LINK_HASH}v`);

    consumeHashMarker(KIT_LINK_HASH);

    expect(history.state).not.toBeNull();
  });
});
