import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDeviceInfo, formatDeviceInfo } from './diagnostics';

const PROBE_KEY = '__beanies_storage_probe__';

describe('getDeviceInfo — Web Storage probe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Defensive: ensure no probe key leaks between tests.
    try {
      window.localStorage.removeItem(PROBE_KEY);
      window.sessionStorage.removeItem(PROBE_KEY);
    } catch {
      /* ignore */
    }
  });

  it('reports true for both storages on a healthy environment', () => {
    const info = getDeviceInfo();
    expect(info.localStorage).toBe(true);
    expect(info.sessionStorage).toBe(true);
  });

  it('leaves no probe key behind after a successful round-trip', () => {
    getDeviceInfo();
    expect(window.localStorage.getItem(PROBE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(PROBE_KEY)).toBeNull();
  });

  it('reports false when setItem throws (blocked / quota), without crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwingStorage = {
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
      getItem: () => null,
      removeItem: () => {},
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(throwingStorage);
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(throwingStorage);
    const info = getDeviceInfo();
    expect(info.localStorage).toBe(false);
    expect(info.sessionStorage).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('reports false when the read value is wrong (storage silently no-ops)', () => {
    const noopStorage = {
      setItem: () => {},
      getItem: () => 'not-1',
      removeItem: () => {},
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(noopStorage);
    vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(noopStorage);
    const info = getDeviceInfo();
    expect(info.localStorage).toBe(false);
    expect(info.sessionStorage).toBe(false);
  });

  it('reports false when accessing the storage property itself throws (no leak)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    const info = getDeviceInfo();
    // localStorage untouched, sessionStorage getter throws → false.
    expect(info.localStorage).toBe(true);
    expect(info.sessionStorage).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('formatDeviceInfo renders the LS/SS lines', () => {
    const text = formatDeviceInfo({
      userAgent: 'ua',
      wasm: true,
      crypto: true,
      indexedDb: true,
      serviceWorker: true,
      localStorage: false,
      sessionStorage: false,
    });
    expect(text).toContain('LS: false');
    expect(text).toContain('SS: false');
  });
});
