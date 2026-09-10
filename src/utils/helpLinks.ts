/**
 * The ONE way the app opens a Help Center article, and the ONE place their
 * paths are declared.
 *
 * Help lives on the marketing apex, origin-isolated from the app, so every link
 * must be absolute and must go through `openExternal` (a relative `/help/...`
 * is an `externalRedirect` bounce, and a raw `window.open` breaks in a
 * standalone PWA).
 *
 * Declaring the paths here rather than at the call site is what makes the drift
 * guard possible: `helpLinks.test.ts` resolves EVERY value in `HELP_PATHS`
 * against the real article corpus, so a renamed slug fails CI instead of
 * shipping a 404 nobody notices. Add a new path to `HELP_PATHS`; never inline a
 * string at a call site.
 *
 * ONE HELP LINK PER SURFACE. The `help_click` event distinguishes call sites by
 * `surface` alone, so a surface with two help links would emit two
 * indistinguishable events. If that day comes, carry the article on the
 * already-allowlisted `kind` context key rather than adding a new one.
 *
 * Migration target: `ActivityViewEditModal.vue`, `TodoItemRow.vue`,
 * `OnboardingAccount.vue`, `PwaReinstallModal.vue` and `useInstallNudge.ts`
 * still build an article url by hand. New code uses this module; do not add a
 * sixth hand-built variant.
 *
 * NOT a migration target: `AppHeader.vue`, `constants/navigation.ts` and
 * `WhatsNewBody.vue` open a help INDEX (`/help`, `/help/whats-new`), not an
 * article. `HelpPath` is `category/slug` on purpose, because that shape is what
 * lets the drift guard resolve a real article.
 */

import { openExternal } from './openExternal';
import { MARKETING_URL } from './marketing';
import { reportError } from './errorReporter';
import { logEvent } from '@/services/telemetry';

/**
 * Every help article the app links to, as `category/slug`.
 *
 * Every value here is asserted to resolve against the real corpus by
 * `helpLinks.test.ts`, so adding an entry buys that protection for free.
 */
export const HELP_PATHS = {
  wallSetup: 'getting-started/set-up-the-beanie-wall',
  zeroKnowledge: 'security/zero-knowledge-architecture',
} as const;

export type HelpPath = (typeof HELP_PATHS)[keyof typeof HELP_PATHS];

/**
 * Where a help open was triggered from. A closed union exactly like
 * `DiscordSurface` in `discord.ts`, and the thing that makes the
 * one-link-per-surface invariant above reviewable rather than aspirational:
 * adding a surface is a deliberate edit here, next to the rule it has to obey.
 */
export type HelpSurface = 'wall-setup-card' | 'create-welcome';

/** The absolute, cross-origin url for a help article. */
export function helpUrl(path: HelpPath): string {
  return `${MARKETING_URL}/help/${path}`;
}

/**
 * Open a Help Center article, recording that it happened.
 *
 * ⚠️ KNOWN GAP, so nobody reads more assurance into this than it gives. The
 * `catch` below only fires on a genuine throw, and the two failures that could
 * realistically happen do not throw: `openExternal` returns early with just a
 * `console.error` for an empty or non-http(s) url, and a popup-blocked
 * synthetic click fails silently in the browser. So a misconfigured
 * `VITE_MARKETING_URL`, or a blocked click, currently reads in CloudWatch as a
 * successful open: a `help_click` with no paired warning. Closing that means
 * `openExternal` returning a boolean, which is a change to a util with eight
 * callers and belongs in its own commit. Until then, do not treat the absence
 * of warnings here as evidence that help links are working.
 *
 * Order is deliberate, and differs from `discord.ts`, which navigates before it
 * tracks and calls that order load-bearing. Two reasons it is inverted here.
 * `track()` there is a Plausible network call, whereas `logEvent` is a
 * synchronous, fire-and-forget buffer write that never throws, so it cannot
 * cost the user gesture `openExternal` needs. And logging first means a click
 * that ends in a throw still produces BOTH a `help_click` and a warning, which
 * is the pair needed to see "people are trying this and it is failing" rather
 * than silence.
 *
 * `warning`, not `critical`: a help link that will not open is an annoyance,
 * not data at risk, so it belongs in the firehose without paging Slack.
 */
export function openHelpArticle(path: HelpPath, surface: HelpSurface): void {
  logEvent({
    level: 'info',
    surface,
    message: 'help_click',
    context: { action: 'help_click' },
  });
  try {
    openExternal(helpUrl(path));
  } catch (error) {
    reportError({
      surface,
      severity: 'warning',
      message: 'help link failed',
      error,
    });
  }
}
