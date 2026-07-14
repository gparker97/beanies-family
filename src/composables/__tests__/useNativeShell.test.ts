import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isNativePlatform, setColor } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  setColor: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform, getPlatform: () => 'android' },
  // Custom WindowBackground plugin (#53) — return our spy for `setColor`.
  registerPlugin: () => ({ setColor }),
}));

const { hide, setStyle, setOverlaysWebView, addListener, exitApp } = vi.hoisted(() => ({
  hide: vi.fn(),
  setStyle: vi.fn(),
  setOverlaysWebView: vi.fn(),
  addListener: vi.fn(),
  exitApp: vi.fn(),
}));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide } }));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle, setOverlaysWebView },
  Style: { Default: 'DEFAULT', Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));

import { useNativeShell, __resetNativeShellForTesting } from '../useNativeShell';

describe('useNativeShell (ADR-029 A5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatform.mockReturnValue(true);
    hide.mockResolvedValue(undefined);
    setStyle.mockResolvedValue(undefined);
    setColor.mockResolvedValue(undefined);
    setOverlaysWebView.mockResolvedValue(undefined);
    addListener.mockResolvedValue({ remove: vi.fn() });
    exitApp.mockResolvedValue(undefined);
    document.documentElement.classList.remove('dark');
    document.querySelectorAll('meta[name="viewport"]').forEach((m) => m.remove());
    __resetNativeShellForTesting();
  });

  it('no-ops on web', () => {
    isNativePlatform.mockReturnValue(false);
    useNativeShell();
    expect(hide).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });

  it('on native: hides the splash, goes edge-to-edge, sets icon contrast, registers a backButton listener', () => {
    useNativeShell();
    expect(hide).toHaveBeenCalled();
    expect(setOverlaysWebView).toHaveBeenCalledWith({ overlay: true });
    // Light mode (no `dark` class): dark icons + light window background (#53).
    expect(setStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(setColor).toHaveBeenCalledWith({ color: '#F9FAFB' });
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
  });

  it('on native: dark mode uses light status-bar icons + dark window background (#53)', () => {
    document.documentElement.classList.add('dark');
    useNativeShell();
    expect(setStyle).toHaveBeenCalledWith({ style: 'DARK' });
    // #53: window background tracks the IN-APP theme, not OS DayNight.
    expect(setColor).toHaveBeenCalledWith({ color: '#0F172A' });
    document.documentElement.classList.remove('dark');
  });

  it('on native: opts the viewport into safe-area insets (viewport-fit=cover)', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'viewport');
    meta.setAttribute('content', 'width=device-width, initial-scale=1.0');
    document.head.appendChild(meta);

    useNativeShell();

    expect(meta.getAttribute('content')).toContain('viewport-fit=cover');
  });

  it('is idempotent (registers the backButton listener at most once)', () => {
    useNativeShell();
    useNativeShell();
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it('back button navigates history back when canGoBack, else exits the app', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    useNativeShell();
    const handler = addListener.mock.calls[0][1] as (e: { canGoBack: boolean }) => void;

    handler({ canGoBack: true });
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();

    handler({ canGoBack: false });
    expect(exitApp).toHaveBeenCalledTimes(1);

    backSpy.mockRestore();
  });
});
