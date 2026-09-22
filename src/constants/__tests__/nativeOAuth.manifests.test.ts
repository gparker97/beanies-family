import { describe, it, expect } from 'vitest';
import { repoFile } from '@/test/repoFile';
import { NATIVE_BRIDGE_URI } from '../nativeOAuth';

/**
 * Drift tripwires.
 *
 * The custom scheme genuinely cannot be single-sourced: `Info.plist` and
 * `AndroidManifest.xml` cannot import TypeScript. So guard it instead of hoping.
 * If someone renames the bundle id, these fail in seconds in the unit gate
 * rather than silently, three days later, in a TestFlight build.
 */

// `repoFile` is shared with `deepLinkPaths.manifests.test.ts` and the appChrome
// call-site pin — see `src/test/repoFile.ts` for why it resolves from `process.cwd()`.

const scheme = NATIVE_BRIDGE_URI.split('://')[0];

describe('native manifests declare the bridge scheme', () => {
  it('derives a plausible scheme from NATIVE_BRIDGE_URI', () => {
    expect(scheme).toBe('family.beanies.app');
  });

  it('iOS Info.plist registers the scheme under CFBundleURLSchemes', () => {
    const plist = repoFile('ios/App/App/Info.plist');
    expect(plist).toContain('<key>CFBundleURLSchemes</key>');

    // Assert the scheme sits INSIDE the CFBundleURLSchemes array, not merely
    // somewhere in the file (it also appears in prose comments).
    const arrayStart = plist.indexOf('<key>CFBundleURLSchemes</key>');
    const arrayEnd = plist.indexOf('</array>', arrayStart);
    expect(arrayEnd).toBeGreaterThan(arrayStart);
    expect(plist.slice(arrayStart, arrayEnd)).toContain(`<string>${scheme}</string>`);
  });

  it('AndroidManifest.xml registers the scheme on an intent-filter', () => {
    const manifest = repoFile('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain(`android:scheme="${scheme}"`);
  });

  it('AndroidManifest.xml keeps the verified https App Link filter', () => {
    // The custom scheme is additive. Losing the autoVerify App Link would
    // silently downgrade Android to the bridge page for every sign-in.
    //
    // ⚠️ SCOPED TO THE OAUTH FILTER, NOT A WHOLE-FILE `toContain`. #63 added a second
    // autoVerify filter carrying `android:scheme="https"` on twelve `<data>` lines, so a
    // file-wide scan for those two literals is now satisfied by content that has nothing
    // to do with OAuth — it could fail on only one of three. Consolidating the two
    // filters, or moving the /oauth/native line to a non-autoVerify filter, would then
    // pass while Android claims nothing for the OAuth return and every native sign-in
    // silently downgrades to the bridge page.
    const manifest = repoFile('android/app/src/main/AndroidManifest.xml').replace(
      /<!--[\s\S]*?-->/g,
      ''
    );
    const oauthFilters = (manifest.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? []).filter(
      (b) => b.includes('android:pathPrefix="/oauth/native"')
    );
    expect(
      oauthFilters.length,
      'Expected exactly ONE intent-filter claiming the apex /oauth/native App Link.'
    ).toBe(1);
    const oauthFilter = oauthFilters[0];
    expect(oauthFilter).toContain('android:autoVerify="true"');
    expect(oauthFilter).toContain('android:scheme="https"');
    expect(oauthFilter).toContain('android:host="beanies.family"');
  });
});

/**
 * The SHARED-LINK association (magic links + invite links), separate from OAuth.
 *
 * These assertions exist because every one of them was wrong in production at once, and
 * all three failures are silent — a tapped link simply opens the browser and nobody can
 * tell why. There is no error, no log, and no way to notice except by trying it on a
 * real phone.
 */
// Shared-link + entity deep-link manifest claims (the app-origin AASA, the
// app.beanies.family intent-filter, the entitlement's applinks:app.beanies.family)
// now live in `deepLinkPaths.manifests.test.ts`, which pins them all to
// EXTERNAL_DEEP_LINK_PATHS. They were moved rather than copied (#63): this file
// keeps only what is about OAUTH. Do not re-add them here.

describe('nativeOAuth.ts stays dependency-free', () => {
  it('has no module-level imports, re-exports, or requires', () => {
    const source = repoFile('src/constants/nativeOAuth.ts');

    // Strip comments first: the file documents itself heavily and prose
    // routinely contains words like "import" and "from".
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .split('\n');

    const offenders = code.filter((line) =>
      /^\s*import\s|^\s*export\s[^;]*\sfrom\s|\brequire\s*\(/.test(line)
    );

    // The Astro marketing site imports this module; a Vue/Capacitor/vue-router
    // import here would break the Astro build. Fail fast, in the unit gate.
    expect(offenders).toEqual([]);
  });
});

describe('the Astro interstitial consumes the module rather than restating it', () => {
  it('contains no hardcoded custom-scheme literal', () => {
    const page = repoFile('web/src/pages/oauth/native.astro');
    expect(page).not.toContain(`${scheme}://`);
  });
});

describe('the /oauth/native backstop survives App.vue boot', () => {
  // App.vue redirects any route not in `authPages` to /welcome when
  // authStore.needsAuth — and the backstop is BY DEFINITION reached by an
  // unauthenticated user mid-sign-in. It is exempted by the terminal-OAuth bail
  // instead, which keys on the route NAME. Rename the route without updating
  // the guard and the page silently reverts to the bug it exists to diagnose:
  // mount, report, then get replaced by the welcome gate with the auth code
  // discarded. That drift is invisible at runtime, so pin it here.
  //
  // A behavioural test would need a full App.vue mount; there is no such
  // harness in this repo, and the failure mode is drift between two files,
  // which this catches directly.
  const ROUTE_NAME = 'OAuthNativeBridge';

  it('the router declares the route under the expected name', () => {
    const router = repoFile('src/router/index.ts');
    expect(router).toContain(`name: '${ROUTE_NAME}'`);
    expect(router).toContain("path: '/oauth/native'");
  });

  it("App.vue's terminal-OAuth bail exempts that exact route name", () => {
    const app = repoFile('src/App.vue');
    expect(app).toContain(`route.name === '${ROUTE_NAME}'`);
  });
});
