import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeServiceWorkerUpdate } from '../safeServiceWorkerUpdate';

function registration(update: () => Promise<unknown>): ServiceWorkerRegistration {
  return { update } as unknown as ServiceWorkerRegistration;
}

describe('safeServiceWorkerUpdate', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('default: a rejection is console-only and never escapes', async () => {
    safeServiceWorkerUpdate(
      registration(() => Promise.reject(new Error('sw.js 503'))),
      'test'
    );
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
  });

  it('hands the rejection to the optional onError sink', async () => {
    const onError = vi.fn();
    const err = new Error('sw.js 503');
    safeServiceWorkerUpdate(
      registration(() => Promise.reject(err)),
      'test',
      onError
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(err));
  });

  it('does not call onError on success', async () => {
    const onError = vi.fn();
    const update = vi.fn(() => Promise.resolve());
    safeServiceWorkerUpdate(registration(update), 'test', onError);
    await Promise.resolve();
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('contains a throwing sink (still no unhandled rejection)', async () => {
    const onError = vi.fn(() => {
      throw new Error('sink died');
    });
    safeServiceWorkerUpdate(
      registration(() => Promise.reject(new Error('x'))),
      'test',
      onError
    );
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
  });
});
