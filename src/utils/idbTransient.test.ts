import { describe, it, expect, vi } from 'vitest';
import { isIdbTransientError, withIdbRetry } from './idbTransient';

describe('isIdbTransientError', () => {
  it('matches iOS WebKit "internal error" message', () => {
    const err = new Error('An internal error was encountered in the Indexed Database server');
    expect(isIdbTransientError(err)).toBe(true);
  });

  it('matches UnknownError DOMException when message mentions IDB', () => {
    const err = new Error('UnknownError: indexed db operation failed');
    err.name = 'UnknownError';
    expect(isIdbTransientError(err)).toBe(true);
  });

  it('does NOT match a generic UnknownError without IDB context', () => {
    const err = new Error('Something else went wrong');
    err.name = 'UnknownError';
    expect(isIdbTransientError(err)).toBe(false);
  });

  it('matches connection-lost transients', () => {
    const err = new Error('Connection to Indexed Database server lost. Refresh the page.');
    expect(isIdbTransientError(err)).toBe(true);
  });

  it('does NOT match genuine permanent failures (quota, schema)', () => {
    expect(isIdbTransientError(new Error('QuotaExceededError'))).toBe(false);
    expect(
      isIdbTransientError(new Error('The user denied permission to access the database'))
    ).toBe(false);
    expect(isIdbTransientError(new Error('VersionError: existing version is newer'))).toBe(false);
  });

  it('handles non-Error inputs without throwing', () => {
    expect(isIdbTransientError(null)).toBe(false);
    expect(isIdbTransientError(undefined)).toBe(false);
    expect(
      isIdbTransientError('An internal error was encountered in the Indexed Database server')
    ).toBe(true);
  });
});

describe('withIdbRetry', () => {
  it('returns value on first-try success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    const result = await withIdbRetry('test', fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once and returns success on the second attempt', async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt === 1) {
        throw new Error('An internal error was encountered in the Indexed Database server');
      }
      return 'recovered';
    });
    const result = await withIdbRetry('test', fn);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows on the second failure (no infinite retry)', async () => {
    const fn = vi.fn(async () => {
      throw new Error('An internal error was encountered in the Indexed Database server');
    });
    await expect(withIdbRetry('test', fn)).rejects.toThrow(/internal error/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on permanent failures', async () => {
    const fn = vi.fn(async () => {
      throw new Error('QuotaExceededError');
    });
    await expect(withIdbRetry('test', fn)).rejects.toThrow(/QuotaExceeded/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
