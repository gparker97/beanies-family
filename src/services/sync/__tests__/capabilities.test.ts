import { describe, it, expect, vi, beforeEach } from 'vitest';

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
