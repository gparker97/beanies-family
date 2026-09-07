/**
 * Which picker a surface opens, and why the two surfaces disagree on purpose.
 *
 * ⚠️ THE BUG THIS PINS. Settings' "load another data file" used the same
 * platform-first rule as the sign-in screen. On Chromium desktop that rule picks
 * the local File System Access picker, which cannot see Google Drive at all — so
 * a Drive family was shown a picker that could not show it the pre-compaction
 * safety copy `compaction.safetyCopyNote` tells it to use, and picking a local
 * file then re-homed the entire family off Drive, stranding every peer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ⚠️ MOCK THE PRIMITIVES, NOT THE EXPORTS. `podFileSourceArm` calls `isNative`
// and `supportsFileSystemAccess` as module-internal references, which a
// `vi.spyOn` on the module's exports cannot intercept — the spy would be
// installed and the function would still call the real one, giving a test that
// passes for the wrong reason. Driving `Capacitor` and `window` is the only way
// to move the real predicates.
const caps = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => caps.native, getPlatform: () => 'web' },
}));

import { podFileSourceArm } from '@/services/sync/capabilities';

describe('podFileSourceArm', () => {
  beforeEach(() => {
    caps.native = false;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });

  function stub(native: boolean, fsa: boolean) {
    caps.native = native;
    const w = window as unknown as Record<string, unknown>;
    if (fsa) {
      w.showOpenFilePicker = () => {};
      w.showSaveFilePicker = () => {};
    } else {
      delete w.showOpenFilePicker;
      delete w.showSaveFilePicker;
    }
  }

  describe('with no provider preference — the sign-in question, unchanged', () => {
    it('native gets the OS sheet', () => {
      stub(true, false);
      expect(podFileSourceArm()).toBe('os-sheet');
    });

    it('Chromium desktop gets the local FSA picker', () => {
      stub(false, true);
      expect(podFileSourceArm()).toBe('fsa-local');
    });

    it('a browser without FSA falls back to the Google Picker', () => {
      stub(false, false);
      expect(podFileSourceArm()).toBe('drive-picker');
    });
  });

  describe('with a Drive family — the Settings question', () => {
    it('CHROMIUM DESKTOP GETS THE DRIVE PICKER, which is the whole fix', () => {
      // Platform-first would answer `fsa-local` here, and that picker cannot see
      // the Drive safety copy. This is the assertion that would have caught the
      // reported bug.
      stub(false, true);
      expect(podFileSourceArm({ preferProvider: 'google_drive' })).toBe('drive-picker');
    });

    it('a browser without FSA also gets the Drive picker', () => {
      stub(false, false);
      expect(podFileSourceArm({ preferProvider: 'google_drive' })).toBe('drive-picker');
    });

    it('native STILL gets the OS sheet, because the Picker is unreliable in the iOS WebView', () => {
      // `LoadPodView` records this; the provider preference must not override a
      // platform constraint, only a platform preference.
      stub(true, false);
      expect(podFileSourceArm({ preferProvider: 'google_drive' })).toBe('os-sheet');
    });
  });

  describe('with a local family', () => {
    it('keeps the local picker on Chromium desktop', () => {
      stub(false, true);
      expect(podFileSourceArm({ preferProvider: 'local' })).toBe('fsa-local');
    });

    it('treats a null preference exactly like no preference', () => {
      stub(false, true);
      expect(podFileSourceArm({ preferProvider: null })).toBe(podFileSourceArm());
    });
  });
});
