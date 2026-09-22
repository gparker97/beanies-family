import { describe, it, expect } from 'vitest';
import { repoFile } from '@/test/repoFile';
import { EXTERNAL_DEEP_LINK_PATHS } from '../externalDeepLinkPaths';

/**
 * Drift tripwire for the OS-level deep-link claims (#63).
 *
 * THREE LAYERS MUST AGREE and none of them can import the others: the TypeScript
 * allowlist (`EXTERNAL_DEEP_LINK_PATHS`, which also backs `inboundLinkBridge`'s
 * `ROUTABLE_PATHS`), the iOS AASA, and the Android intent-filter. When they disagree the
 * bug is invisible in every other test and shows up only on a physical device:
 *
 *  - OS claims MORE than the allowlist routes → the link opens the app and leaves it on
 *    whatever screen it was already on. That is the failure `inboundLinkBridge` exists to
 *    prevent, and the one users report as "the link did nothing".
 *  - OS claims LESS → the link silently opens the browser, which looks exactly like the
 *    bug this issue fixed.
 *
 * ⚠️ ADDING A DEEP-LINKABLE PATH IS THREE EDITS: `src/constants/externalDeepLinkPaths.ts`
 * (usually via `ENTITY_DEEP_LINKS`), `public/.well-known/apple-app-site-association`, and
 * `android/app/src/main/AndroidManifest.xml`. Every failure message below names them.
 *
 * ⚠️ DO NOT REPLACE EITHER MANIFEST'S LIST WITH A WILDCARD. `/oauth/callback` on the app
 * origin is the Drive Picker's WEB return path (`pickerRedirect.ts`); handing it to the
 * app breaks a flow validated on a production iPhone on 2026-09-20.
 */

const APP_HOST = 'app.beanies.family';
const APP_AASA = 'public/.well-known/apple-app-site-association';
const APEX_AASA = 'web/public/.well-known/apple-app-site-association';
const ANDROID_MANIFEST = 'android/app/src/main/AndroidManifest.xml';

const THREE_FILES = `Keep these three in sync: src/constants/externalDeepLinkPaths.ts, ${APP_AASA}, ${ANDROID_MANIFEST}.`;

interface AasaComponent {
  '/': string;
  exclude?: boolean;
}

/**
 * The paths an AASA actually CLAIMS — excluded components dropped.
 *
 * Reads only `'/'` and `exclude`, so the `comment` prose carried on the exclusion
 * component (this repo's way of putting reasoning in a file that permits no `//`) can
 * never break it.
 */
function aasaPaths(relative: string): string[] {
  const aasa = JSON.parse(repoFile(relative)) as {
    applinks: { details: { components: AasaComponent[] }[] };
  };
  return aasa.applinks.details.flatMap((d) =>
    d.components.filter((c) => !c.exclude).map((c) => c['/'])
  );
}

/**
 * The `<intent-filter android:autoVerify="true">` block that claims the app host, with
 * XML comments stripped first.
 *
 * ⚠️ SCOPED TO THE FILTER, AND COMMENT-STRIPPED, BECAUSE A RAW LINE SCAN PASSES WHILE
 * ANDROID CLAIMS NOTHING. Verified: commenting out the entire filter left a naive scan
 * reporting all 12 paths (they are still text in the file), counts equal, no pathPrefix
 * offenders and no /oauth claims — six green assertions describing a manifest that claims
 * nothing at all. That is the "OS claims LESS" case this suite's own docblock names, and
 * it is the one a tripwire must never sleep through. Scoping also stops a `<data>` line
 * moved to a NON-autoVerify filter from counting as a verified claim.
 */
function appHostFilterBlock(manifest: string): string {
  const withoutComments = manifest.replace(/<!--[\s\S]*?-->/g, '');
  const blocks = withoutComments.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? [];
  const claiming = blocks.filter(
    (b) => b.includes('android:autoVerify="true"') && b.includes(`android:host="${APP_HOST}"`)
  );
  expect(
    claiming.length,
    `Expected exactly ONE autoVerify intent-filter claiming ${APP_HOST} in ${ANDROID_MANIFEST}. Zero means Android claims nothing and every deep link opens the browser; more than one means this scan is reading only part of the claim.`
  ).toBe(1);
  return claiming[0];
}

/** Every `android:path` on a `<data>` line inside that filter that names the app host. */
function androidClaimedPaths(manifest: string): string[] {
  return appHostFilterBlock(manifest)
    .split('\n')
    .filter((line) => line.includes(`android:host="${APP_HOST}"`))
    .map((line) => /android:path="([^"]+)"/.exec(line)?.[1])
    .filter((p): p is string => p !== undefined);
}

/**
 * Every host named inside the claiming filter. Android matches the scheme x host x path
 * CROSS-PRODUCT, so a stray second host in this filter would claim
 * `<other-host>/accounts` invisibly to a path-only assertion.
 */
function androidClaimedHosts(manifest: string): string[] {
  return [
    ...new Set(
      [...appHostFilterBlock(manifest).matchAll(/android:host="([^"]+)"/g)].map((m) => m[1])
    ),
  ];
}

describe('deep-link path claims agree across all three layers', () => {
  it('the app-origin AASA claims exactly EXTERNAL_DEEP_LINK_PATHS', () => {
    expect(
      aasaPaths(APP_AASA).sort(),
      `${APP_AASA} drifted from the allowlist. ${THREE_FILES}`
    ).toEqual([...EXTERNAL_DEEP_LINK_PATHS].sort());
  });

  it('the app-origin AASA excludes /oauth/* FIRST — order is load-bearing', () => {
    const aasa = JSON.parse(repoFile(APP_AASA)) as {
      applinks: { details: { components: AasaComponent[] }[] };
    };
    const first = aasa.applinks.details[0].components[0];
    expect(
      { path: first['/'], exclude: first.exclude },
      `The /oauth/* exclusion must be the FIRST component in ${APP_AASA}: AASA matches in order, first match wins, so an exclusion after the enumeration is dead. /oauth/callback is the Drive Picker's web return path.`
    ).toEqual({ path: '/oauth/*', exclude: true });
  });

  it('the Android app-host filter claims exactly EXTERNAL_DEEP_LINK_PATHS', () => {
    const paths = androidClaimedPaths(repoFile(ANDROID_MANIFEST));
    expect(paths.sort(), `${ANDROID_MANIFEST} drifted from the allowlist. ${THREE_FILES}`).toEqual(
      [...EXTERNAL_DEEP_LINK_PATHS].sort()
    );
  });

  it('every app-host <data> line yields a path — the line scan cannot go green by finding nothing', () => {
    // Guards the scan's own premise. If someone folds the host onto a separate <data>
    // element, `androidClaimedPaths` would quietly extract zero paths and a set-equality
    // assertion against an empty list would need to fail loudly rather than the tripwire
    // silently stopping doing its job. A tripwire that passes by finding nothing is worse
    // than no tripwire.
    const manifest = repoFile(ANDROID_MANIFEST);
    const hostLines = appHostFilterBlock(manifest)
      .split('\n')
      .filter((line) => line.includes(`android:host="${APP_HOST}"`)).length;
    expect(
      androidClaimedPaths(manifest).length,
      `Every line naming ${APP_HOST} must carry an android:path. If the manifest's shape changed (host split onto its own <data>), update androidClaimedPaths in this file — do not delete this assertion.`
    ).toBe(hostLines);
  });

  it('the Android app-host filter uses exact android:path, never pathPrefix', () => {
    // The tightening from #63: pathPrefix="/join" claimed /joinery at the OS layer and
    // leaned on the bridge to reject it. Exact matching makes the OS claim and
    // ROUTABLE_PATHS the same comparison. The apex /oauth/native filter still uses
    // pathPrefix and is untouched — this assertion is scoped to the app-host lines.
    const appHostLines = repoFile(ANDROID_MANIFEST)
      .split('\n')
      .filter((line) => line.includes(`android:host="${APP_HOST}"`));
    const offenders = appHostLines.filter((line) => line.includes('android:pathPrefix'));
    expect(
      offenders,
      `${ANDROID_MANIFEST}: the ${APP_HOST} filter must use exact android:path. pathPrefix would claim look-alike paths (/joinery) the bridge then rejects, re-opening the two-gate gap.`
    ).toEqual([]);
  });

  it('the claiming filter names ONE host — Android matches host x path as a cross-product', () => {
    expect(
      androidClaimedHosts(repoFile(ANDROID_MANIFEST)),
      `A second android:host inside the ${APP_HOST} autoVerify filter would claim that host x EVERY path above, invisibly to a path-only check. Give another host its own filter.`
    ).toEqual([APP_HOST]);
  });

  it('neither platform claims anything under /oauth', () => {
    const claimed = [...aasaPaths(APP_AASA), ...androidClaimedPaths(repoFile(ANDROID_MANIFEST))];
    expect(
      claimed.filter((p) => p.startsWith('/oauth')),
      `/oauth/callback on ${APP_HOST} is the Drive Picker's WEB return path (pickerRedirect.ts). Claiming it for the app breaks a flow validated on a production iPhone on 2026-09-20.`
    ).toEqual([]);
  });
});

describe('the apex 301 table covers every claimed path', () => {
  it('APP_PATHS is a superset of EXTERNAL_DEEP_LINK_PATHS', () => {
    // A FOURTH enumeration of the same set, and the one nothing pointed at. The apex
    // CloudFront function 301s these to app.beanies.family; a claimed path missing here
    // falls through to the Astro rewrite and serves the marketing bucket's 404, so the
    // link never reaches the origin whose manifests claim it. `/pod` and `/lists` were
    // both missing when #63 claimed them.
    // ⚠️ SCOPED TO THE `APP_PATHS` ARRAY, not the whole file. A whole-file scan also harvests
    // `/home`, `/blog`, `/beanstalk` and — worse — `APEX_OWNED_PATHS`, whose entries mean the
    // OPPOSITE (`isAppPath(uri) && !isApexOwned(uri)` gates the 301). Moving a claimed path into
    // that list would leave this assertion green while the apex served a 404 for the link. The
    // character class also admits digits, underscores and nested slashes so a future `/pod/contacts`
    // does not false-fail.
    const fn = repoFile('infrastructure/modules/web/functions/apex-cutover.js');
    const block = /var APP_PATHS\s*=\s*\[([\s\S]*?)\]/.exec(fn);
    expect(
      block,
      'could not find the APP_PATHS array in apex-cutover.js — update this scan'
    ).not.toBeNull();
    const listed = [...block![1].matchAll(/'(\/[A-Za-z0-9_/-]+)'/g)].map((m) => m[1]);
    const missing = EXTERNAL_DEEP_LINK_PATHS.filter((p) => !listed.includes(p));
    expect(
      missing,
      `infrastructure/modules/web/functions/apex-cutover.js APP_PATHS is missing claimed path(s). Without the 301 the apex form serves the marketing 404 instead of reaching app.beanies.family.`
    ).toEqual([]);
  });
});

describe('the entitlement and the apex AASA are unchanged in shape', () => {
  it('iOS claims the APP subdomain, not just the apex', () => {
    // Every shared URL is built by `shareableOrigin()` as https://app.beanies.family/...
    // The entitlement used to claim only `beanies.family`, so no shared link ever matched.
    expect(repoFile('ios/App/App/App.entitlements')).toContain(`applinks:${APP_HOST}`);
  });

  it('the apex still claims the OAuth return link', () => {
    expect(
      aasaPaths(APEX_AASA),
      `${APEX_AASA} must keep claiming the OAuth Universal Link.`
    ).toContain('/oauth/native');
  });

  it('the apex does NOT claim /join — the 301 would defeat it', () => {
    // apex-cutover.js 301s /join to the app subdomain, and both platforms match the
    // TAPPED url without following redirects. An apex claim verifies and never fires.
    expect(aasaPaths(APEX_AASA)).not.toContain('/join');
  });
});
