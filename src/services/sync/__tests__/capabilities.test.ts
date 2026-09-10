import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capacitor is the single native↔web seam in capabilities.ts; mock it here so we
// can exercise both web and native branches. (Other test files that rely on the
// REAL @capacitor/core web fallback — e.g. usePwaUpdater.test.ts — are unaffected,
// since vi.mock is per-file.)
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
  },
}));

import { Capacitor } from '@capacitor/core';
import {
  isNative,
  getPlatform,
  canUseLocalFiles,
  getSyncCapabilities,
  supportsFileSystemAccess,
  getDevicePlatform,
  isWakeLockSupported,
} from '../capabilities';

const mockIsNative = vi.mocked(Capacitor.isNativePlatform);
const mockGetPlatform = vi.mocked(Capacitor.getPlatform);

describe('capabilities — native platform detection (ADR-029 A1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsNative.mockReturnValue(false);
    mockGetPlatform.mockReturnValue('web');
  });

  it('isNative() reflects Capacitor.isNativePlatform()', () => {
    expect(isNative()).toBe(false);
    mockIsNative.mockReturnValue(true);
    expect(isNative()).toBe(true);
  });

  it('getPlatform() reflects Capacitor.getPlatform()', () => {
    expect(getPlatform()).toBe('web');
    mockGetPlatform.mockReturnValue('android');
    expect(getPlatform()).toBe('android');
  });

  it('canUseLocalFiles() is true natively even without the web File System Access API', () => {
    // The test DOM has no showSaveFilePicker → the web predicate is false.
    expect(supportsFileSystemAccess()).toBe(false);
    expect(canUseLocalFiles()).toBe(false); // web, no FSA → no local files
    mockIsNative.mockReturnValue(true);
    expect(canUseLocalFiles()).toBe(true); // native rescues it (@capacitor/filesystem)
  });

  it('getSyncCapabilities() reports native + platform', () => {
    mockIsNative.mockReturnValue(true);
    mockGetPlatform.mockReturnValue('ios');
    const caps = getSyncCapabilities();
    expect(caps.native).toBe(true);
    expect(caps.platform).toBe('ios');
  });

  it('getSyncCapabilities() defaults to web when not native', () => {
    const caps = getSyncCapabilities();
    expect(caps.native).toBe(false);
    expect(caps.platform).toBe('web');
  });

  it('A1 is non-breaking: local-file flags still derive from the web API until A3', () => {
    // Native but no provider yet → fileSystemAccess stays false (honest).
    mockIsNative.mockReturnValue(true);
    const caps = getSyncCapabilities();
    expect(caps.fileSystemAccess).toBe(false);
    expect(caps.showSaveFilePicker).toBe(false);
  });
});

describe('getDevicePlatform — OS family for user-facing copy', () => {
  // NOT the same question as `getPlatform()` (which Capacitor shell) — this one
  // decides whether the wall setup card says "Guided Access" or "screen pinning",
  // so it must key off the OS, not the form factor and not the shell.
  const setUA = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports ios for an iPad', () => {
    setUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1');
    expect(getDevicePlatform()).toBe('ios');
  });

  it('reports ios for an iPhone, because Guided Access is the same word there', () => {
    setUA(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
    );
    expect(getDevicePlatform()).toBe('ios');
  });

  it('reports android for an Android tablet', () => {
    setUA(
      'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    );
    expect(getDevicePlatform()).toBe('android');
  });

  it('falls back to other on a desktop browser, which gets the generic wording', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(getDevicePlatform()).toBe('other');
  });

  it('prefers ios over android when a UA somehow claims both', () => {
    // Defensive: the iOS arm is checked first, and that ordering is what keeps
    // iPadOS-13+ desktop-UA Safari on the Apple instructions.
    setUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Android AppleWebKit/605.1.15');
    expect(getDevicePlatform()).toBe('ios');
  });
});

describe('isWakeLockSupported', () => {
  // Lives in capabilities, not useWakeLock, so a surface can ask the question
  // without importing the composable that acquires a lock on setup.
  afterEach(() => {
    // `navigator.wakeLock` is non-optional in the DOM lib, so `delete` needs the
    // cast to a shape that admits its absence. happy-dom ships without it, which
    // is what makes the unsupported branch the default.
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
  });

  it('is false when the browser has no Screen Wake Lock API (the happy-dom default)', () => {
    expect(isWakeLockSupported()).toBe(false);
  });

  it('is true once navigator.wakeLock exists', () => {
    Object.defineProperty(navigator, 'wakeLock', { value: {}, configurable: true });
    expect(isWakeLockSupported()).toBe(true);
  });
});
