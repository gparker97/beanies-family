/**
 * The Drive restore option must render on native.
 *
 * `canRestoreFromDrive` carried a `!isNative()` gate, added in `02c2e347`
 * because the restore was going to use the Google Picker (unreliable in the iOS
 * WebView, ADR-026). In the SAME commit the mechanism was swapped to
 * `GoogleDriveFilePicker` — REST `files.list` plus a plain modal, no gapi, no
 * third-party iframe — which works fine in a WebView. The guard outlived its
 * reason and the comment above it contradicted the line below it.
 *
 * The effect: a native-only user could not restore their family from Drive at
 * all, which is the one place a family's data actually lives. There was no test
 * on this predicate, which is exactly how it shipped. This is that test.
 *
 * See docs/investigations/2026-09-08-compaction-fallout.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Drive restore availability on native', () => {
  const source = readFileSync('src/pages/SettingsPage.vue', 'utf8');

  it('does not gate canRestoreFromDrive on isNative()', () => {
    const predicate = source.slice(
      source.indexOf('const canRestoreFromDrive'),
      source.indexOf('const canRestoreFromDrive') + 240
    );
    expect(predicate).toContain('google_drive');
    expect(predicate).not.toContain('isNative');
  });

  it('acquires the listing token silently, because the popup path is not native-safe', () => {
    // `requestAccessToken` opens a popup (`openBlankPopup`), which does not
    // survive a Capacitor WebView. Now that this path runs on native, an
    // expired token must route to the reconnect affordance instead.
    expect(source).toContain('listGoogleDriveFiles({ silent: true })');
    // ⚠️ `classifyDriveFailure`, not `instanceof TokenExpiredError`.
    // `getValidTokenSilent` hands back the cached token whenever `isTokenValid()`
    // — a LOCAL expiry check — so a grant revoked on another device surfaces as
    // `DriveApiError(401)` from the listing request and an instanceof check
    // misses the very case that most needs a reconnect.
    expect(source).toContain("classifyDriveFailure(e) === 'CONSENT_EXPIRED'");
    // And the selection half must be silent too, or the dead end just moves from
    // the list to the tap.
    expect(source).toContain('silent: true');
  });
});
