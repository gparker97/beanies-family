import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let usePWA: typeof import('@/composables/usePWA').usePWA;

describe('usePWA', () => {
  const listeners: {
    beforeinstallprompt: EventListener[];
    appinstalled: EventListener[];
  } = {
    beforeinstallprompt: [],
    appinstalled: [],
  };

  beforeEach(async () => {
    listeners.beforeinstallprompt = [];
    listeners.appinstalled = [];

    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, handler: unknown) => {
      if (type === 'beforeinstallprompt' || type === 'appinstalled') {
        listeners[type].push(handler as EventListener);
      }
    });

    // Mock matchMedia for standalone detection
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    // Clear localStorage
    localStorage.clear();

    vi.resetModules();
    const mod = await import('@/composables/usePWA');
    usePWA = mod.usePWA;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with canInstall false and isInstalled false', () => {
    const { canInstall, isInstalled } = usePWA();
    expect(canInstall.value).toBe(false);
    expect(isInstalled.value).toBe(false);
  });

  it('detects installed state via standalone media query', async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, handler: unknown) => {
      if (type === 'beforeinstallprompt' || type === 'appinstalled') {
        listeners[type].push(handler as EventListener);
      }
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    vi.resetModules();
    const mod = await import('@/composables/usePWA');
    const { isInstalled } = mod.usePWA();
    expect(isInstalled.value).toBe(true);
  });

  it('sets canInstall to true when beforeinstallprompt fires', () => {
    const { canInstall } = usePWA();
    expect(canInstall.value).toBe(false);

    // Simulate beforeinstallprompt
    const event = new Event('beforeinstallprompt', { cancelable: true });
    (event as unknown as Record<string, unknown>).prompt = vi.fn();
    (event as unknown as Record<string, unknown>).userChoice = Promise.resolve({
      outcome: 'dismissed',
    });
    listeners.beforeinstallprompt.forEach((fn) => fn(event));

    expect(canInstall.value).toBe(true);
  });

  it('sets isInstalled to true when appinstalled fires', () => {
    const { isInstalled, canInstall } = usePWA();

    // First make it installable
    const promptEvent = new Event('beforeinstallprompt', { cancelable: true });
    (promptEvent as unknown as Record<string, unknown>).prompt = vi.fn();
    (promptEvent as unknown as Record<string, unknown>).userChoice = Promise.resolve({
      outcome: 'dismissed',
    });
    listeners.beforeinstallprompt.forEach((fn) => fn(promptEvent));
    expect(canInstall.value).toBe(true);

    // Then simulate install
    listeners.appinstalled.forEach((fn) => fn(new Event('appinstalled')));
    expect(isInstalled.value).toBe(true);
    expect(canInstall.value).toBe(false);
  });

  it('installApp triggers the deferred prompt', async () => {
    const { installApp } = usePWA();

    const promptFn = vi.fn();
    const promptEvent = new Event('beforeinstallprompt', { cancelable: true });
    (promptEvent as unknown as Record<string, unknown>).prompt = promptFn;
    (promptEvent as unknown as Record<string, unknown>).userChoice = Promise.resolve({
      outcome: 'accepted',
    });
    listeners.beforeinstallprompt.forEach((fn) => fn(promptEvent));

    const result = await installApp();
    expect(promptFn).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('installApp returns false when no prompt is available', async () => {
    const { installApp } = usePWA();
    const result = await installApp();
    expect(result).toBe(false);
  });

  it('dismissInstallPrompt stores timestamp in localStorage', () => {
    const { dismissInstallPrompt, isDismissed } = usePWA();
    expect(isDismissed()).toBe(false);
    dismissInstallPrompt();
    expect(isDismissed()).toBe(true);
  });
});
