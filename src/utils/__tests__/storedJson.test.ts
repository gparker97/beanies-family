import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readStoredJson,
  removeStoredJson,
  storedKeysWithPrefix,
  writeStoredJson,
} from '../storedJson';

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

  it('lists only the keys with the prefix', () => {
    localStorage.setItem('p.a', '1');
    localStorage.setItem('p.b', '2');
    localStorage.setItem('other', '3');
    expect(storedKeysWithPrefix('p.', 'test').sort()).toEqual(['p.a', 'p.b']);
  });

  it('returns a snapshot, so removing while iterating visits every key', () => {
    for (const k of ['p.1', 'p.2', 'p.3']) localStorage.setItem(k, '1');
    for (const k of storedKeysWithPrefix('p.', 'test')) localStorage.removeItem(k);
    expect(storedKeysWithPrefix('p.', 'test')).toEqual([]);
  });

  it('treats a throwing key scan as empty and warns with the prefix', () => {
    const keySpy = vi.spyOn(localStorage, 'key').mockImplementation(() => {
      throw new Error('blocked');
    });
    localStorage.setItem('p.a', '1');
    expect(storedKeysWithPrefix('p.', 'test')).toEqual([]);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"p."');
    keySpy.mockRestore();
  });
});
