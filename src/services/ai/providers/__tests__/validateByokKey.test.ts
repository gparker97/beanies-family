import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateByokKey } from '../validateByokKey';
import type { ByokConfig } from '../byokProvider';

const originalFetch = globalThis.fetch;

function mockFetch(impl: () => Promise<{ ok: boolean; status: number }> | never) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

const OPENAI: ByokConfig = { provider: 'openai', apiKey: 'sk-test' };

beforeEach(() => {
  vi.restoreAllMocks();
  // silence the diagnostic console.warn on failure paths
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('validateByokKey', () => {
  it('200 → ok', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    await expect(validateByokKey(OPENAI)).resolves.toEqual({ ok: true });
  });

  it('401 → invalid_key', async () => {
    mockFetch(async () => ({ ok: false, status: 401 }));
    await expect(validateByokKey(OPENAI)).resolves.toEqual({ ok: false, reason: 'invalid_key' });
  });

  it('403 → invalid_key', async () => {
    mockFetch(async () => ({ ok: false, status: 403 }));
    await expect(validateByokKey(OPENAI)).resolves.toEqual({ ok: false, reason: 'invalid_key' });
  });

  it('429 / other non-2xx → network (retryable, not a key verdict)', async () => {
    mockFetch(async () => ({ ok: false, status: 429 }));
    await expect(validateByokKey(OPENAI)).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('a thrown/aborted fetch → network (never rejects)', async () => {
    mockFetch(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(validateByokKey(OPENAI)).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('missing key → invalid_key without a network call', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(validateByokKey({ provider: 'openai', apiKey: '' })).resolves.toEqual({
      ok: false,
      reason: 'invalid_key',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('non-openai provider → unsupported without a network call', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(validateByokKey({ provider: 'claude', apiKey: 'sk-ant' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
