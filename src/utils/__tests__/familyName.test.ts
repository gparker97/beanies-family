import { describe, it, expect } from 'vitest';
import { deriveFamilyName } from '@/utils/familyName';

const EN = 'The {name} family';
const ZH = '{name}一家';

describe('deriveFamilyName', () => {
  it('uses the whole name when it is a single token', () => {
    expect(deriveFamilyName('Greg', EN)).toBe('The Greg family');
  });

  it('uses the last whitespace-separated token of a multi-token name', () => {
    expect(deriveFamilyName('Greg Parker', EN)).toBe('The Parker family');
    expect(deriveFamilyName('  Mary   Ann  van Dyke  ', EN)).toBe('The Dyke family');
  });

  it('strips trailing punctuation but keeps inner punctuation', () => {
    expect(deriveFamilyName('Greg Parker.', EN)).toBe('The Parker family');
    expect(deriveFamilyName('Greg Parker!!', EN)).toBe('The Parker family');
    expect(deriveFamilyName("Sean O'Brien,", EN)).toBe("The O'Brien family");
    expect(deriveFamilyName('Anna Smith-Jones', EN)).toBe('The Smith-Jones family');
    expect(deriveFamilyName('Greg .', EN)).toBe('The Greg family');
  });

  it('returns an empty string for an empty or punctuation-only name', () => {
    expect(deriveFamilyName('', EN)).toBe('');
    expect(deriveFamilyName('   ', EN)).toBe('');
    expect(deriveFamilyName('...', EN)).toBe('');
  });

  it('fills a zh template', () => {
    expect(deriveFamilyName('张伟', ZH)).toBe('张伟一家');
    expect(deriveFamilyName('Wei Zhang', ZH)).toBe('Zhang一家');
  });

  it('inserts a $-bearing name literally', () => {
    expect(deriveFamilyName('Bob $1', EN)).toBe('The $1 family');
  });
});
