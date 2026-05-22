import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isNativePlatform } = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => true) }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform, getPlatform: () => 'android' },
}));

const { hide, setStyle, addListener, exitApp } = vi.hoisted(() => ({
  hide: vi.fn(),
  setStyle: vi.fn(),
  addListener: vi.fn(),
  exitApp: vi.fn(),
}));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide } }));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle },
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
    addListener.mockResolvedValue({ remove: vi.fn() });
    exitApp.mockResolvedValue(undefined);
    __resetNativeShellForTesting();
  });

  it('no-ops on web', () => {
    isNativePlatform.mockReturnValue(false);
    useNativeShell();
    expect(hide).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });

  it('on native: hides the splash, sets a status-bar style, registers a backButton listener', () => {
    useNativeShell();
    expect(hide).toHaveBeenCalled();
    expect(setStyle).toHaveBeenCalledWith({ style: 'DEFAULT' });
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
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
