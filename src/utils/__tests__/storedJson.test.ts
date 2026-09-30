import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredJson, removeStoredJson, writeStoredJson } from '../storedJson';

describe('storedJson', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a missing key as missing, without warning', () => {
    expect(readStoredJson('k', 'test')).toEqual({ kind: 'missing' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads valid JSON as ok', () => {
    localStorage.setItem('k', JSON.stringify({ a: true }));
    expect(readStoredJson('k', 'test')).toEqual({ kind: 'ok', value: { a: true } });
  });

  it('reads unparseable JSON as corrupt and warns with the key', () => {
    localStorage.setItem('k', '{nope');
    expect(readStoredJson('k', 'test')).toEqual({ kind: 'corrupt' });
    expect(String(warn.mock.calls[0]?.[0])).toContain('"k"');
  });

  it('treats a throwing read as missing and warns with the key', () => {
    // happy-dom's localStorage methods live on the instance, not Storage.prototype.
    const getSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredJson('k', 'test')).toEqual({ kind: 'missing' });
    expect(String(warn.mock.calls[0]?.[0])).toContain('"k"');
    getSpy.mockRestore();
  });

  it('writes JSON and reports ok', () => {
    expect(writeStoredJson('k', { a: 1 }, 'test')).toEqual({ ok: true });
    expect(localStorage.getItem('k')).toBe('{"a":1}');
  });

  it('returns the error on a refused write and warns with the key', () => {
    const quota = new Error('quota');
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quota;
    });
    expect(writeStoredJson('k', { a: 1 }, 'test')).toEqual({ ok: false, error: quota });
    expect(String(warn.mock.calls[0]?.[0])).toContain('"k"');
    setSpy.mockRestore();
  });

  it('removes a key and reports ok, including a key that was never there', () => {
    localStorage.setItem('k', '1');
    expect(removeStoredJson('k', 'test')).toEqual({ ok: true });
    expect(localStorage.getItem('k')).toBeNull();
    expect(removeStoredJson('k', 'test')).toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns the error on a refused removal and warns with the key', () => {
    const blocked = new Error('blocked');
    const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw blocked;
    });
    expect(removeStoredJson('k', 'test')).toEqual({ ok: false, error: blocked });
    expect(String(warn.mock.calls[0]?.[0])).toContain('"k"');
    removeSpy.mockRestore();
  });
});
