import { describe, it, expect } from 'vitest';
import {
  DEDUPE_MAX_PAYLOAD_BYTES,
  DEDUPE_NAME_MAX,
  dedupePayload,
  dedupePayloadBuilder,
  dedupePayloadBytes,
  sanitizeDedupeName,
  type DedupeLine,
} from '../dedupePayload';

describe('dedupePayload (#116)', () => {
  it('sends { id, text } only, whatever else a line carries', () => {
    const line = { id: 'L1', text: '1 onion', recipeName: 'Tacos' } as DedupeLine;
    expect(dedupePayload([line])).toBe('[{"id":"L1","text":"1 onion"}]');
    expect(JSON.parse(dedupePayload([line]))).toEqual([{ id: 'L1', text: '1 onion' }]);
  });

  it('is the same text JSON.stringify gives for the picked array', () => {
    const lines: DedupeLine[] = [
      { id: 'L1', text: '豆腐 "firm" \\ 1 block' },
      { id: 'L2', text: 'a b' },
    ];
    expect(dedupePayload(lines)).toBe(JSON.stringify(lines));
    expect(dedupePayload([])).toBe('[]');
  });

  it('measures UTF-8 bytes of exactly the payload that is sent', () => {
    const lines: DedupeLine[] = [{ id: 'L1', text: '豆腐 "firm" \\ 1 block' }];
    expect(dedupePayloadBytes(lines)).toBe(new TextEncoder().encode(dedupePayload(lines)).length);
    // CJK is 3 bytes a character, so a char count would undercount.
    expect(dedupePayloadBytes(lines)).toBeGreaterThan(dedupePayload(lines).length);
  });

  it('is a positive whole number of bytes', () => {
    expect(Number.isInteger(DEDUPE_MAX_PAYLOAD_BYTES)).toBe(true);
    expect(DEDUPE_MAX_PAYLOAD_BYTES).toBeGreaterThan(0);
  });
});

describe('dedupePayloadBuilder', () => {
  it('keeps the running size equal to dedupePayloadBytes, refusing what would cross it', () => {
    const texts = ['1 onion', '豆腐', 'x'.repeat(40), '"quoted"', 'y'];
    const all = texts.map((text, i) => ({ id: `L${i + 1}`, text }));
    for (let max = 2; max <= dedupePayloadBytes(all) + 2; max += 3) {
      const b = dedupePayloadBuilder(max);
      for (const line of all) b.tryAdd(line);
      expect(dedupePayloadBytes(b.lines)).toBeLessThanOrEqual(max);
    }
    const exact = dedupePayloadBuilder(dedupePayloadBytes(all));
    expect(all.every((l) => exact.tryAdd(l))).toBe(true);
    expect(exact.lines).toEqual(all);
  });

  it('leaves the payload unchanged on a refusal, so a shorter line can still fit', () => {
    const b = dedupePayloadBuilder(dedupePayloadBytes([{ id: 'L1', text: 'ab' }]));
    expect(b.tryAdd({ id: 'L1', text: 'abc' })).toBe(false);
    expect(b.lines).toEqual([]);
    expect(b.tryAdd({ id: 'L1', text: 'ab' })).toBe(true);
  });
});

describe('sanitizeDedupeName', () => {
  it.each([
    ['trims and collapses whitespace', '  Ground   beef\n ', 'Ground beef'],
    ['a line break between words stays a space', 'Ground\nbeef', 'Ground beef'],
    ['a tab between words stays a space', 'Ground\tbeef', 'Ground beef'],
    ['U+2028 / U+2029 become a space', 'Ground beef mince', 'Ground beef mince'],
    ['strips a bidi override and a bell', 'Gar‮lic\u0007', 'Garlic'],
    ['strips a zero-width space inside a word', 'Gar​lic', 'Garlic'],
    ['strips a BOM', '﻿Garlic', 'Garlic'],
    ['no double space where a hidden character sat between spaces', 'a ​ b', 'a b'],
    ['empty once cleaned', ' ​‮ ', ''],
    ['strips an LRM / RLM / Arabic letter mark', '\u200eGar\u200flic\u061c', 'Garlic'],
    ['strips isolates and embeddings', '\u2066Gar\u202alic\u2069\u202c', 'Garlic'],
    ['strips a word joiner and an annotation block', 'Gar\u2060lic\ufff9x\ufffb', 'Garlicx'],
    [
      'keeps ZWNJ in a Persian word',
      '\u0645\u06cc\u200c\u0631\u0648\u0645',
      '\u0645\u06cc\u200c\u0631\u0648\u0645',
    ],
    [
      'keeps ZWJ in an emoji sequence',
      'Family \u{1F468}\u200d\u{1F469}\u200d\u{1F467}',
      'Family \u{1F468}\u200d\u{1F469}\u200d\u{1F467}',
    ],
    ['keeps ZWJ in a Devanagari conjunct', '\u0915\u094d\u200d\u0937', '\u0915\u094d\u200d\u0937'],
  ])('%s', (_label, raw, expected) => {
    expect(sanitizeDedupeName(raw)).toBe(expected);
  });

  it('caps at DEDUPE_NAME_MAX code points without splitting a surrogate pair', () => {
    expect(Array.from(sanitizeDedupeName('é'.repeat(100)))).toHaveLength(DEDUPE_NAME_MAX);
    expect(sanitizeDedupeName('🥩'.repeat(DEDUPE_NAME_MAX + 5))).toBe('🥩'.repeat(DEDUPE_NAME_MAX));
  });

  it('never ends on a space left by the cap', () => {
    const name = sanitizeDedupeName(`${'a'.repeat(DEDUPE_NAME_MAX - 1)} b`);
    expect(name).toBe('a'.repeat(DEDUPE_NAME_MAX - 1));
  });
});
