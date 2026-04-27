import { describe, it, expect, vi } from 'vitest';
import { frequencyDisplayFor, isValidDosesPerDay } from '../medicationFrequency';

describe('frequencyDisplayFor', () => {
  // Stub `t`: returns the key as-is so we can assert against the expected
  // translation keys without pulling in the real translation system.
  const t = vi.fn((key: string) => key);

  it('maps 1 to onceDaily key', () => {
    expect(frequencyDisplayFor(1, t)).toBe('medications.frequencyAuto.onceDaily');
  });

  it('maps 2 to twiceDaily key', () => {
    expect(frequencyDisplayFor(2, t)).toBe('medications.frequencyAuto.twiceDaily');
  });

  it('maps 3 to threeDaily key', () => {
    expect(frequencyDisplayFor(3, t)).toBe('medications.frequencyAuto.threeDaily');
  });

  it('maps 4 to fourDaily key', () => {
    expect(frequencyDisplayFor(4, t)).toBe('medications.frequencyAuto.fourDaily');
  });

  it('returns empty string for out-of-range values', () => {
    expect(frequencyDisplayFor(0, t)).toBe('');
    expect(frequencyDisplayFor(5, t)).toBe('');
    expect(frequencyDisplayFor(-1, t)).toBe('');
    expect(frequencyDisplayFor(2.5, t)).toBe('');
    expect(frequencyDisplayFor(NaN, t)).toBe('');
  });
});

describe('isValidDosesPerDay', () => {
  it('accepts 1, 2, 3, 4', () => {
    expect(isValidDosesPerDay(1)).toBe(true);
    expect(isValidDosesPerDay(2)).toBe(true);
    expect(isValidDosesPerDay(3)).toBe(true);
    expect(isValidDosesPerDay(4)).toBe(true);
  });

  it('rejects 0, 5, negatives, and non-integers', () => {
    expect(isValidDosesPerDay(0)).toBe(false);
    expect(isValidDosesPerDay(5)).toBe(false);
    expect(isValidDosesPerDay(-1)).toBe(false);
    expect(isValidDosesPerDay(2.5)).toBe(false);
    expect(isValidDosesPerDay(NaN)).toBe(false);
  });

  it('rejects null, undefined, and non-numbers', () => {
    expect(isValidDosesPerDay(null)).toBe(false);
    expect(isValidDosesPerDay(undefined)).toBe(false);
    expect(isValidDosesPerDay('2')).toBe(false);
    expect(isValidDosesPerDay({})).toBe(false);
  });
});
