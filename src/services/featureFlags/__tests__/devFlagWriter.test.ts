import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setProdFlag } from '../devFlagWriter';

describe('services/featureFlags/devFlagWriter', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true); // setProdFlag is a no-op unless DEV
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs the flag change and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(setProdFlag('aiPhotoExtract', true)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      '/__feature-flags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ flag: 'aiPhotoExtract', enabled: true }),
      })
    );
  });

  it('throws the server-supplied error message on an HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'could not write file' }),
      })
    );

    await expect(setProdFlag('aiPhotoExtract', true)).rejects.toThrow('could not write file');
  });

  it('falls back to a status-based message when the error body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('no body');
        },
      })
    );

    await expect(setProdFlag('aiPhotoExtract', true)).rejects.toThrow('HTTP 503');
  });

  it('throws actionable guidance on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await expect(setProdFlag('aiPhotoExtract', true)).rejects.toThrow(/npm run dev/);
  });

  it('is a no-op in production (never calls fetch)', async () => {
    vi.stubEnv('DEV', false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(setProdFlag('aiPhotoExtract', true)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
