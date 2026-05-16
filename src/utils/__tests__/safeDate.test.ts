import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseIsoDateSafely } from '../safeDate';

describe('parseIsoDateSafely', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('parses a valid ISO date string', () => {
    const d = parseIsoDateSafely('2026-05-16', 'test');
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString().slice(0, 10)).toBe('2026-05-16');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('parses a full ISO datetime string', () => {
    const d = parseIsoDateSafely('2026-05-16T08:40:00Z', 'test');
    expect(d).toBeInstanceOf(Date);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null silently for null input', () => {
    expect(parseIsoDateSafely(null, 'test')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null silently for undefined input', () => {
    expect(parseIsoDateSafely(undefined, 'test')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null silently for empty string', () => {
    expect(parseIsoDateSafely('', 'test')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null and logs a context-labelled warn for an invalid string', () => {
    const result = parseIsoDateSafely('not-a-date', 'goal abc-123.deadline');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /\[safeDate\] could not parse "not-a-date" in goal abc-123\.deadline/
    );
  });
});
