import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must reset the module singleton between tests
let useOnline: typeof import('@/composables/useOnline').useOnline;

describe('useOnline', () => {
  let onlineGetter: () => boolean;
  const listeners: { online: EventListener[]; offline: EventListener[] } = {
    online: [],
    offline: [],
  };

  beforeEach(async () => {
    // Reset listeners
    listeners.online = [];
    listeners.offline = [];

    // Mock navigator.onLine
    let onlineValue = true;
    onlineGetter = () => onlineValue;
    Object.defineProperty(navigator, 'onLine', {
      get: () => onlineGetter(),
      configurable: true,
    });

    // Track event listeners
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, handler: unknown) => {
      if (type === 'online' || type === 'offline') {
        listeners[type].push(handler as EventListener);
      }
    });

    // Helper to change online state in tests
    onlineGetter = () => onlineValue;

    setOnline = (v: boolean) => {
      onlineValue = v;
    };

    // Fresh import to reset singleton
    vi.resetModules();
    const mod = await import('@/composables/useOnline');
    useOnline = mod.useOnline;
  });

  let setOnline: (v: boolean) => void;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns isOnline as true when navigator.onLine is true', () => {
    const { isOnline } = useOnline();
    expect(isOnline.value).toBe(true);
  });

  it('returns isOnline as false when navigator.onLine is false', async () => {
    vi.resetModules();
    setOnline(false);
    const mod = await import('@/composables/useOnline');
    const { isOnline } = mod.useOnline();
    expect(isOnline.value).toBe(false);
  });

  it('registers online and offline event listeners', () => {
    useOnline();
    expect(listeners.online).toHaveLength(1);
    expect(listeners.offline).toHaveLength(1);
  });

  it('updates isOnline when offline event fires', () => {
    const { isOnline } = useOnline();
    expect(isOnline.value).toBe(true);

    // Simulate going offline
    setOnline(false);
    listeners.offline.forEach((fn) => fn(new Event('offline')));
    expect(isOnline.value).toBe(false);
  });

  it('updates isOnline when online event fires', () => {
    const { isOnline } = useOnline();

    // First go offline
    setOnline(false);
    listeners.offline.forEach((fn) => fn(new Event('offline')));
    expect(isOnline.value).toBe(false);

    // Then come back online
    setOnline(true);
    listeners.online.forEach((fn) => fn(new Event('online')));
    expect(isOnline.value).toBe(true);
  });
});
