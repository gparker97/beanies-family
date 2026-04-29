import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function importInit() {
  vi.resetModules();
  return (await import('./plausible')).initAnalytics;
}

describe('services/analytics/plausible', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', '');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete window.plausible;
    document.head.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
  });

  it('is a no-op when VITE_PLAUSIBLE_DOMAIN is unset', async () => {
    const initAnalytics = await importInit();
    initAnalytics();

    expect(window.plausible).toBeUndefined();
    expect(document.querySelector('script[src*="plausible.io"]')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('injects the script with the env-provided domain when set', async () => {
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', 'mySiteHash');
    const initAnalytics = await importInit();
    initAnalytics();

    const script = document.querySelector(
      'script[src="https://plausible.io/js/pa-mySiteHash.js"]'
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
    expect(window.plausible).toBeDefined();
  });

  it('logs [analytics] warning when script.onerror fires', async () => {
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', 'mySiteHash');
    const initAnalytics = await importInit();
    initAnalytics();

    const script = document.querySelector(
      'script[src*="plausible.io"]'
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    script?.onerror?.(new Event('error'));

    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const analyticsLog = messages.find(
      (m: string) => m.includes('[analytics]') && m.includes('failed to load')
    );
    expect(analyticsLog).toBeDefined();
  });

  it('catches and logs when DOM mutation throws', async () => {
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', 'mySiteHash');
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('DOM blocked by CSP');
    });

    const initAnalytics = await importInit();
    initAnalytics();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('[analytics]');
    expect(String(warnSpy.mock.calls[0][0])).toContain('failed to initialize');
    createElementSpy.mockRestore();
  });
});
