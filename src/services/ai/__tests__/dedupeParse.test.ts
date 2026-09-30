/**
 * The dedupe parser (#116): shape only. It never knows which ids the client sent (the caller
 * checks that against its list); it guarantees a safe name, at least 2 distinct ids per group,
 * and bounded output from a hostile or off-day reply.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { DEDUPE_NAME_MAX } from '@/utils/dedupePayload';
import {
  EXTRACTION_PARSERS,
  EXTRACTION_TASKS,
  MODEL_LIST_MAX,
  parseDedupeResult,
} from '../extractionPrompt';

const group = (over: Record<string, unknown> = {}) => ({
  name: 'ground beef',
  lineIds: ['L1', 'L2'],
  ...over,
});

describe('parseDedupeResult', () => {
  it('keeps a well-formed group', () => {
    expect(parseDedupeResult({ groups: [group()] })).toEqual({
      groups: [{ name: 'ground beef', lineIds: ['L1', 'L2'] }],
    });
  });

  it('is the registered parser for a text-only task', () => {
    expect(EXTRACTION_PARSERS.dedupe).toBe(parseDedupeResult);
    expect([...EXTRACTION_TASKS.dedupe.sources]).toEqual(['text']);
  });

  it('throws when "groups" is missing, and on a non-object', () => {
    expect(() => parseDedupeResult({})).toThrow(/missing keys: groups/);
    expect(() => parseDedupeResult('nope')).toThrow();
    expect(() => parseDedupeResult(null)).toThrow();
  });

  it('reads a non-array "groups" as no groups', () => {
    expect(parseDedupeResult({ groups: 'L1,L2' })).toEqual({ groups: [] });
  });

  it('normalises whole-number ids to strings and drops other shapes', () => {
    const out = parseDedupeResult({
      groups: [group({ lineIds: [1, 'L2', 2.5, -1, null, {}, '  ', true] })],
    });
    expect(out.groups[0]!.lineIds).toEqual(['1', 'L2']);
  });

  it('drops repeated ids BEFORE the two-id check', () => {
    // One line listed twice is not a duplicate of anything.
    expect(parseDedupeResult({ groups: [group({ lineIds: ['L1', 'L1', ' L1 '] })] })).toEqual({
      groups: [],
    });
    expect(
      parseDedupeResult({ groups: [group({ lineIds: ['L1', 'L2', 'L1'] })] }).groups[0]!.lineIds
    ).toEqual(['L1', 'L2']);
  });

  it('drops singletons, missing ids, and non-object entries', () => {
    const out = parseDedupeResult({
      groups: [group({ lineIds: ['L1'] }), group({ lineIds: undefined }), 'L1', null, group()],
    });
    expect(out.groups).toHaveLength(1);
  });

  it('collapses every whitespace run, U+2028/2029 included, to one space', () => {
    const out = parseDedupeResult({
      groups: [group({ name: '  ground  beef \t\n mince  ' })],
    });
    expect(out.groups[0]!.name).toBe('ground beef mince');
  });

  it('strips control and format characters (bidi overrides, zero-widths)', () => {
    const out = parseDedupeResult({
      groups: [group({ name: 'gro‮und​ be\u0007ef ⁦x⁩' })],
    });
    expect(out.groups[0]!.name).toBe('ground beef x');
  });

  it('drops a group whose name is empty once cleaned', () => {
    for (const name of ['', '   ', '​‮', 42, null]) {
      expect(parseDedupeResult({ groups: [group({ name })] }).groups).toEqual([]);
    }
  });

  it('caps the name at DEDUPE_NAME_MAX code points without splitting a surrogate pair', () => {
    const long = '🥩'.repeat(DEDUPE_NAME_MAX + 10);
    const name = parseDedupeResult({ groups: [group({ name: long })] }).groups[0]!.name;
    expect(Array.from(name)).toHaveLength(DEDUPE_NAME_MAX);
    expect(name).toBe('🥩'.repeat(DEDUPE_NAME_MAX));
  });

  it('bounds groups and ids per group at MODEL_LIST_MAX', () => {
    const ids = Array.from({ length: MODEL_LIST_MAX * 3 }, (_, i) => `L${i}`);
    const groups = Array.from({ length: MODEL_LIST_MAX * 3 }, () => group({ lineIds: ids }));
    const out = parseDedupeResult({ groups });
    expect(out.groups).toHaveLength(MODEL_LIST_MAX);
    expect(out.groups[0]!.lineIds).toHaveLength(MODEL_LIST_MAX);
  });

  it('never carries anything but name and lineIds', () => {
    const out = parseDedupeResult({
      groups: [group({ amount: '750 g', text: 'merged' })],
    });
    expect(Object.keys(out.groups[0]!).sort()).toEqual(['lineIds', 'name']);
  });
});
