/**
 * Drift tripwire — client env parity between the web deploy and the mobile lanes.
 *
 * The Vue bundle is built FIVE times by CI (web deploy + Android/iOS release +
 * Android/iOS debug), each with its own hand-maintained `env:` block. A var added
 * to `deploy.yml` alone therefore ships configured on web and UNCONFIGURED in both
 * native apps — with no build error and, for the fire-and-forget `no-cors` Slack
 * paths, no runtime signal either.
 *
 * That is not hypothetical: `VITE_FEEDBACK_WEBHOOK_URL` was added to `deploy.yml`
 * with #45 (2026-07-09) and to nothing else, so every Android and iOS build for the
 * next month called `slackPost(undefined, …)` and silently discarded the user's
 * feedback behind a thank-you screen. Feedback is stored nowhere else, so those
 * submissions are unrecoverable.
 *
 * This test asserts the release lanes carry every `VITE_` var the web deploy does,
 * minus an explicitly-justified allowlist. Adding a var to `deploy.yml` now fails
 * here until it is either mirrored or deliberately exempted.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOWS = resolve(__dirname, '../../../.github/workflows');

function viteVars(file: string): Set<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed workflow dir, test-only
  const src = readFileSync(resolve(WORKFLOWS, file), 'utf8');
  return new Set(Array.from(src.matchAll(/^\s*(VITE_[A-Z0-9_]+):/gm), (m) => m[1]));
}

/**
 * Vars a lane may legitimately omit, each with the reason. An entry here is a
 * decision on the record — not a place to silence a genuine gap.
 */
const EXEMPT: Record<string, Record<string, string>> = {
  'mobile-android-release.yml': {
    VITE_PLAUSIBLE_DOMAIN: 'web analytics is a separate decision for the native app',
  },
  'mobile-ios-release.yml': {
    VITE_PLAUSIBLE_DOMAIN: 'web analytics is a separate decision for the native app',
  },
};

describe('CI client-env parity', () => {
  const web = viteVars('deploy.yml');

  it('deploy.yml still defines the operational webhooks this test exists to protect', () => {
    // Guards against the regex silently matching nothing and the suite passing vacuously.
    expect(web.has('VITE_FEEDBACK_WEBHOOK_URL')).toBe(true);
    expect(web.has('VITE_SLACK_WEBHOOK_URL')).toBe(true);
    expect(web.has('VITE_BEANIES_ERROR_WEBHOOK_URL')).toBe(true);
  });

  for (const lane of ['mobile-android-release.yml', 'mobile-ios-release.yml']) {
    it(`${lane} carries every VITE_ var the web deploy does`, () => {
      const laneVars = viteVars(lane);
      const exempt = EXEMPT[lane] ?? {};
      const missing = [...web].filter((v) => !laneVars.has(v) && !(v in exempt)).sort();
      expect(missing).toEqual([]);
    });
  }

  /**
   * REVIEW-DEMO: the reverse direction, which the parity loop above is
   * structurally incapable of checking.
   *
   * That loop asserts release ⊇ web, so it can only catch a var that the web
   * deploy has and a native lane lacks. The demo bypass is the opposite shape —
   * mobile-only, and it must STAY that way: shipping it on the web bundle would
   * put a code-gated bypass on the public app for every visitor, permanently,
   * with no store-review reason for it to be there.
   *
   * Delete this test when demo mode is retired.
   */
  it('deploy.yml never carries the review-demo bypass', () => {
    const demoVars = [...web].filter((v) => v.startsWith('VITE_REVIEW_DEMO'));
    expect(demoVars).toEqual([]);
  });

  it('the shipped store builds wire the feedback webhook', () => {
    // Called out separately from the parity loop: feedback is fire-and-forget over
    // `no-cors` and persisted nowhere, so a missing URL is invisible at both ends.
    for (const lane of ['mobile-android-release.yml', 'mobile-ios-release.yml']) {
      expect(viteVars(lane).has('VITE_FEEDBACK_WEBHOOK_URL')).toBe(true);
    }
  });
});
