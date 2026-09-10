# Plan: The beanie wall device-setup help article, and the card that points at it

> Date: 2026-09-11
> Related issues: None (direct implementation)
> Plan file: `docs/plans/2026-09-11-beanie-wall-setup-help.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent who has just turned on the beanie wall, I want to know exactly which settings to
change on my tablet so the screen stays on and a child cannot wander out of the app, without
having to work it out myself or find the instructions somewhere else.

## Context

`web/src/pages/from/skylight.astro` promises a "setup helper" three times, and the page is live
on production (verified: HTTP 200, the phrase appears 3x in the served HTML):

- `:840` "That's ten minutes of fiddling on your side, once, and the setup helper walks you
  through all of it."
- `:926` "The setup helper handles auto-lock, Guided Access and orientation."
- `:950` "the setup helper walks you through the two device settings that matter: auto-lock set
  to never, and Guided Access"

Nothing behind that copy exists. Greg has decided the copy stays as written and we build the
thing it promises.

The original beanie-wall plan (`docs/plans/2026-08-31-beanie-wall.md`) already specified this.
Requirement 17 promised "a wall setup helper covering the ritual nobody solves in-product:
Auto-Lock → Never, Guided Access, orientation, mounting and charging guidance", and the plan's
Help Center Coverage section (lines ~433-437) resolved it to a single article: category
`getting-started`, type how-to, slug `set-up-the-beanie-wall`. It was listed as a phase 7
deliverable and never written. Its scope notes are carried into this plan verbatim.

The wall itself is shipped and live: `beanieWall: true` in
`src/config/featureFlags.committed.ts:11`. So this documents an existing feature rather than
one arriving alongside it.

Today `WallSetupCard.vue` is 94 lines and does exactly two things: it shows a title and a
one-line description, and it deals with the PIN prerequisite (opens `PinSettings` inside a
`BeanieFormModal`, watches `canEnterWall`, then routes to `/wall`). It says nothing at all
about the device.

## Requirements

1. Write a new Help Center article, slug `set-up-the-beanie-wall`, in
   `src/content/help/getting-started.ts`, following `.claude/skills/beanies-help-docs/SKILL.md`
   (how-to structure, beanies voice, exact UI labels).
2. The article carries **platform-specific checklists that are both always visible**, never
   sniffed. The reader is frequently on their phone reading about the tablet in their other hand,
   so the Apple block and the Android block are both present on the page for every reader.
   They are stacked, not columned: see Approach section 7 for why, and for the explicit
   non-goal of adding a new renderer section type.
3. The article must cover, per the original plan's scope notes:
   - Auto-Lock / screen timeout, and that on a device without Screen Wake Lock the OS setting is
     the **only** thing keeping the screen on.
   - Guided Access (Apple) and screen pinning (Android).
   - The orientation matrix in plain words.
   - Mounting and charging, including that holding a tablet at 100% permanently swells the
     battery, and that many Android tablets can cap the charge while most iPads cannot.
   - That you need a PIN on your own profile before you can start the wall, and that leaving the
     wall asks for that PIN.
   - That no financial information is ever shown on the wall.
4. Update `src/components/settings/WallSetupCard.vue` to add:
   - A **very brief, platform-aware, high-level checklist**. Greg's explicit constraint: it must
     not look intimidating. High-level lines only, detail deferred to the article.
   - A **clear, prominent link** to the article, framed as opening help to set the device up to
     run the wall safely with kids.
5. The checklist's first line is driven by whether the device supports Screen Wake Lock. Where it
   is supported, keeping the screen on is belt and braces. Where it is not, the OS setting is the
   only thing holding the screen on, and the line says so.
6. New card strings go in `uiStrings.ts` with both `en` and `beanie` values. The article is plain
   English with no `t()`.
7. Update the article inventory in `.claude/skills/beanies-help-docs/SKILL.md`.

## Important Notes & Caveats

- **OUT OF SCOPE: any link in the wall lock dropdown** (`WallLockMenu.vue`). Greg considered and
  dropped it. Do not add it. The reasoning is on record and worth preserving: the padlock button
  opens its menu with no challenge at all, so any child can tap it; and `/help/*` is not an
  in-app route but an `externalRedirect` (`src/router/index.ts:37`) doing
  `window.location.replace(MARKETING_URL + path)` cross-origin off the app. A help entry there
  would be an ungated route out of the wall that bypasses the PIN-gated Leave, which is exactly
  what that gate exists to prevent.
- **No mockup.** Greg waived it.
- **The Skylight copy stays as is.** Do not soften, edit, or "align" it.
- **⚠️ `useWakeLock()` must NOT be called from the settings card.** It ends with
  `watch(isVisible, ..., { immediate: true })` which calls `acquire()` synchronously on setup.
  Calling the composable from a Settings card would take a real screen wake lock while the user is
  merely reading Settings, and register a visibility watcher and an `onScopeDispose` release for a
  surface that has no business holding one. Only the `supported` boolean is wanted.
  **Pass 3 makes this structural rather than documentary**: the support predicate moves to
  `capabilities.ts`, so the card never imports `@/composables/useWakeLock` at all and the mistake
  is not available to make. See Approach section 1.
- **Platform detection already exists twice and must not exist a third time.**
  `src/services/sync/capabilities.ts` owns native/web detection under ADR-029 and exports
  `isIosOrIpadOs()`, which already handles the trap where iPadOS Safari reports a desktop UA.
  `PwaReinstallModal.vue:14-21` then bolts an inline `/Android/` UA test onto it with a comment
  admitting "Android/desktop stay inline". This plan is the second consumer, which is the trigger
  to consolidate: see Approach section 2. Do not write a new UA parse, and do not reuse
  `src/utils/platformLabel.ts` (its header states it is telemetry-only and deliberately
  untranslated, and its vocabulary is a Slack vocabulary that must not cross into UI).
- **⚠️ 32 test files replace `@/services/sync/capabilities` wholesale.** Verified:
  `grep -rln "vi.mock('@/services/sync/capabilities'" src` returns 32 files, each supplying a
  hand-written factory that exports only the names that file happens to need. Adding
  `getDevicePlatform` and `isWakeLockSupported` to that module is safe only while no such test
  transitively reaches a new consumer, and today none does (they are store and login tests;
  `useWakeLock` has exactly one importer, `BeanieWallPage.vue:78`, and `PwaReinstallModal.vue` is
  mounted in no test). The failure mode if that ever changes is a bare "undefined is not a
  function" with no hint at the cause, so: run the **full** unit suite after the `capabilities.ts`
  edit, not just the new files, and if one goes red add the missing key to that file's factory
  rather than moving the function back out. Checked and clear: `capabilities.ts` imports only
  `@capacitor/core` and `@/config/features` (which imports nothing), so there is no import cycle
  with `useWakeLock`, and nothing under `web/src` imports `src/services/**`, so nothing pulls
  Capacitor into the Astro build.
- **Detect the OS, not the form factor.** Apple phones and tablets both use Guided Access; Android
  phones and tablets both use screen pinning. So OS detection gives the correct vocabulary whether
  the user is standing at the tablet or reading Settings on their phone.
- **`primary-lift` does not exist.** The Heritage Orange dark-mode partner is `accent-lift`
  (`--color-accent-lift: #ff8b5e`, `packages/brand/theme.css:132`), used across roughly 190
  existing `src/**/*.vue` call sites. `dark:text-primary-lift` would generate no CSS, is not caught by
  `vue/no-restricted-class` (which bans the raw grey ramp, not invented tokens), and would ship
  as unreadable orange on dark. Use `dark:text-accent-lift`.
- **`HelpArticle` requires `excerpt`.** `src/content/help/types.ts` declares it non-optional.
  Omitting it is a type-check failure, not a soft miss.
- **⚠️ Heading `id`s must be unique across the whole article.** Verified: the article page builds
  its "On this page" nav from `article.sections.filter(s => s.type === 'heading' && s.id)`
  (`web/src/pages/help/[category]/[...slug].astro:30-36`) and **level-3 headings are included**
  (indented with `pl-3` at `:147`), while `HelpArticleRenderer.astro:20` writes `id` straight onto
  the tag. This article has two Apple blocks and two Android blocks, so the obvious wording
  ("On an iPad" under both "Make the screen stay on" and "Stop small hands wandering off") would
  emit duplicate DOM ids, an invalid document, two identical TOC rows and an anchor that always
  jumps to the first one. Each level-3 heading must be distinct in **both** text and id. See
  Approach section 7 for the required set.
- **Android menu paths vary by manufacturer.** Samsung, Pixel and Lenovo all name these screens
  differently. The article must say so rather than assert one path as universal.
- **Phase 8 (Android native landscape) has NOT shipped**, verified: no `@capacitor/screen-orientation`
  in `package.json`, and `useWallOrientation.ts` has no native branch. So the orientation paragraph
  stands as the original plan wrote it. The original plan requires that paragraph be revisited when
  phase 8 ships; carry that instruction into the article file as a code comment so the next person
  finds it.
- **Night mode is manual only.** It is a `nightNow` ref set from the lock menu
  (`BeanieWallPage.vue:68, 767`). There is no schedule and no setting. Do not imply one.
- **No em-dashes** in the article or the card copy.
- **Both light and dark mode** authored in the same change for the card.
- Adding an article to `GETTING_STARTED_ARTICLES` needs **no** `index.ts` change; that array is
  already spread into `ALL_ARTICLES`.
- **Do not import `@/content/help` into the app bundle.** The help corpus is 5,326 lines and is
  consumed only by the Astro site. The slug-drift guard is a test-time import (Approach section 6),
  never a runtime one.
- **Do not rename the `pwaReinstall.desktopStep*` string keys.** The `PwaReinstallModal` migration
  renames a local TypeScript token (`'desktop'` to `'other'`) and nothing else. Renaming the
  translation keys to match would touch `uiStrings.ts`, `scripts/updateTranslations.mjs` output and
  the shipped Chinese translations for zero user benefit. That is exactly the drift this plan is
  trying not to cause.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. `beanieWall` remains `true` in committed prod flags, so the card is visible to real users.
2. The Skylight page keeps its "setup helper" copy.
3. Phase 8 (Android native landscape) is still unshipped, so an installed Android PWA and the
   Android app remain portrait.
4. The help center remains English-first and rendered only by the Astro site, so the article needs
   no `t()` plumbing.
5. `MARKETING_URL` + `openExternal` remain the house pattern for in-app links to help. Verified:
   `AppHeader.vue:190`, `AppSidebar.vue:98`, `ActivityViewEditModal.vue:188`,
   `CreatePodWelcome.vue:86`, `useInstallNudge.ts:125`, `WhatsNewBody.vue:82`,
   `InfoHintBadge.vue:77` all route through it, and `PwaReinstallModal.vue:54` and
   `TodoItemRow.vue:15` build the same kind of URL.
6. `src/utils/discord.ts` remains the house precedent for "one module owns a marketing-relative URL
   plus the single tracked open-path for it". `helpLinks.ts` (Approach section 3) is deliberately
   its twin, not a new invention.

## Approach

### 1. A `supported` check that does not take a lock, and cannot be mistaken for one

`useWakeLock.ts:25` currently computes support inline:

```ts
const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
```

Pass 2 proposed exporting that expression from `useWakeLock.ts`. Pass 3 moves it one file over
instead, into `src/services/sync/capabilities.ts`:

```ts
/**
 * Whether this device can hold the screen awake from within the page
 * (Screen Wake Lock API). Lives here, not in `useWakeLock`, so a surface that
 * wants only the ANSWER (the Settings wall card) never imports the composable
 * that TAKES the lock. Safe at module/SSR time.
 */
export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}
```

`useWakeLock()` keeps `const supported = isWakeLockSupported();`, imported from capabilities, so
there is exactly one definition and its single existing consumer (`BeanieWallPage.vue:78`) is
untouched.

**Why this is better than exporting it from the composable, in four concrete ways:**

1. **The footgun stops existing.** Under the Pass 2 shape the card's imports read
   `import { isWakeLockSupported } from '@/composables/useWakeLock'`, which is an invitation for
   the next reader to reach one line further and call `useWakeLock()`. The whole ⚠️ caveat above
   then depends on that person having read this plan. Under this shape the composable is not in
   the card's import graph at all, so there is nothing to reach for.
2. **The transitive import disappears, and so does the proof obligation.** `useWakeLock.ts` imports
   `useToday` and `@/services/telemetry/logEvent`. Pass 2 had to spend a paragraph establishing
   that pulling those into the Settings chunk registered no listener and acquired no lock. Correct,
   but it is a proof that has to be re-done by hand every time either of those modules changes.
   Importing from `capabilities.ts` (which imports only `@capacitor/core` and `@/config/features`,
   both already in the Settings graph) makes the question moot.
3. **It lands in a file that has a test.** Verified: `src/composables/__tests__/` has no
   `useWakeLock` test, so a predicate exported from there ships uncovered. `capabilities.ts` has
   `src/services/sync/__tests__/capabilities.test.ts`, which already mocks `@capacitor/core` and
   is the file this plan is extending anyway.
4. **The card gets one capability import instead of two.** `getDevicePlatform` and
   `isWakeLockSupported` both come from the same module, which is also the honest description of
   what they are.

**Update the module docblock.** `capabilities.ts` currently says "Browser capability detection for
sync features". It already hosts `isStandalone()` and `isIosOrIpadOs()`, neither of which is
sync-specific, and this change adds two more. Change the header to say plainly that this is the
app's single browser/device capability seam (ADR-029), and that the native/web half of it is the
part ADR-029 pins. That is one comment, and it stops the next person adding a parallel
`deviceCapabilities.ts` because this file's title told them it was for sync.

This is the entire change to `useWakeLock.ts`: one import added, one expression removed.

### 2. One platform seam for UI copy

Add to `src/services/sync/capabilities.ts`, beside `isIosOrIpadOs()`:

```ts
export type DevicePlatform = 'ios' | 'android' | 'other';

/**
 * OS family for USER-FACING copy that must name a platform's own vocabulary
 * (Guided Access vs screen pinning, Share sheet vs three-dot menu).
 * Deliberately OS, not form factor: an iPhone and an iPad both say "Guided
 * Access". Not to be confused with `getPlatform()`, which answers "which
 * Capacitor shell", or `platformLabel.ts`, which is Slack-only telemetry.
 * Safe at module/SSR time (returns 'other' when `navigator` is missing).
 */
export function getDevicePlatform(): DevicePlatform {
  if (isIosOrIpadOs()) return 'ios';
  if (typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent ?? '')) {
    return 'android';
  }
  return 'other';
}
```

Then **migrate `PwaReinstallModal.vue` onto it**. Its local `type Platform = 'ios' | 'android' |
'desktop'` and its inline `/Android/` test both delete; its `platform` computed becomes
`computed(getDevicePlatform)`, and its `steps` / `screenshot` computeds keep their existing
`'ios'` / `'android'` branches with the fallback arm now reached by `'other'` instead of
`'desktop'`. Verified against the file: both fallback arms are bare `return` statements at the end
of the computed, so there is no `=== 'desktop'` comparison to update. The net diff is six lines
deleted and one changed. The translation keys stay `pwaReinstall.desktopStep1..4` (see caveats).

**Honest scope of the claim.** After this change `/Android/` still appears in three files, and
that is correct, not a miss:

| file                               | vocabulary                                    | why it stays separate                                                     |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `services/sync/capabilities.ts`    | `'ios' \| 'android' \| 'other'`               | user-facing copy; the one this change owns                                |
| `utils/platformLabel.ts`           | `'android' \| 'ios' \| 'desktop' \| 'device'` | Slack-only telemetry; its own header forbids crossing vocabularies        |
| `services/auth/biometricShared.ts` | `'iOS' \| 'Android' \| 'Windows' ...`         | authenticator label ("Face ID · Safari, iOS"); a different question again |

`platformLabel.formFactor()` could in principle be rewritten on top of `getDevicePlatform()`, but
its `'desktop'` and `'device'` arms have no equivalent in the UI vocabulary and collapsing them
would silently change strings that land in Slack. **Explicitly deferred**, not overlooked.

Extend `src/services/sync/__tests__/capabilities.test.ts` (it already exists and already mocks
`@capacitor/core`) with the three `getDevicePlatform` branches plus `isWakeLockSupported`,
mirroring the `vi.spyOn(navigator, 'userAgent', 'get')` idiom used in
`src/utils/platformLabel.test.ts`.

This is the reason the plan does not create the `useWallDeviceTips` composable Pass 1 proposed:
the only genuinely new logic in it was a platform branch that already existed in the modal.

### 3. One way to open a help article

Six call sites hand-build a `${MARKETING_URL}/help/<category>/<slug>` ARTICLE url, two of them
(`useInstallNudge.ts:33` and `PwaReinstallModal.vue:54`) the byte-identical `install-as-app` url.
The full set, verified by grep: `OnboardingAccount.vue:35`, `TodoItemRow.vue:15`,
`ActivityViewEditModal.vue:188`, `PwaReinstallModal.vue:54`, `CreatePodWelcome.vue:31`,
`useInstallNudge.ts:33`.

Three further sites build a help INDEX rather than an article and are deliberately outside this
set, because `HelpPath` is typed `category/slug` and none of them has that shape:
`AppHeader.vue:190` and `constants/navigation.ts:246` (the bare `/help`) and `WhatsNewBody.vue:82`
(`/help/whats-new`, a category page). Pulling those in would mean widening `HelpPath` to admit
one-segment paths, which would in turn weaken the drift guard in section 6 from "this article
exists" to "this string has a slash in it, maybe". Leave them alone.

Exactly one of the six, `CreatePodWelcome.openSafetyHelp`, carries the full error contract: log the
click, wrap the call, report a warning if it throws. That one is right and the other five are
copies of a weaker version of it.

`openExternal` is genuinely the house pattern and it does refuse an empty URL and a non-http(s)
scheme, but the plan must not overstate it: it refuses to `console.error` and returns `void`, so
the caller cannot detect the refusal and, on a wall-mounted tablet in a kitchen, nobody will ever
read that console. It is a dev-time guard, not a production signal.

So create `src/utils/helpLinks.ts`, modelled directly on `src/utils/discord.ts` (the same shape
already exists for the Discord link: one module owning the URL and the single tracked open-path):

```ts
/**
 * The ONE way the app opens a Help Center article, and the ONE place their
 * paths are declared.
 *
 * Help lives on the marketing apex, origin-isolated from the app, so every link
 * must be absolute and must go through `openExternal` (a relative /help/... is an
 * `externalRedirect` bounce, and a raw `window.open` breaks in a standalone PWA).
 *
 * Declaring the paths here rather than at the call site is what makes the
 * drift guard possible: `helpLinks.test.ts` resolves EVERY value below against
 * the real article corpus, so a renamed slug fails CI instead of shipping a 404.
 * Add a new path to HELP_PATHS; never inline a string at a call site.
 *
 * ONE HELP LINK PER SURFACE. The `help_click` event distinguishes call sites by
 * `surface` alone, so a surface with two help links would emit two
 * indistinguishable events. If that day comes, carry the article on the existing
 * allowlisted `kind` context key rather than adding a new one.
 *
 * Migration target: `ActivityViewEditModal.vue`, `TodoItemRow.vue`,
 * `OnboardingAccount.vue`, `PwaReinstallModal.vue` and `useInstallNudge.ts` still
 * build an article url by hand. New code uses this module; do not add a sixth
 * hand-built variant.
 *
 * NOT a migration target: `AppHeader.vue`, `constants/navigation.ts` and
 * `WhatsNewBody.vue` open a help INDEX (`/help`, `/help/whats-new`), not an
 * article. `HelpPath` is `category/slug` on purpose, because that is what makes
 * the drift guard able to resolve a real article.
 */
export const HELP_PATHS = {
  wallSetup: 'getting-started/set-up-the-beanie-wall',
  zeroKnowledge: 'security/zero-knowledge-architecture',
} as const;

export type HelpPath = (typeof HELP_PATHS)[keyof typeof HELP_PATHS];

export function helpUrl(path: HelpPath): string {
  return `${MARKETING_URL}/help/${path}`;
}

/**
 * Where a help open was triggered from. A closed union exactly like
 * `DiscordSurface` in `discord.ts`, and the thing that makes the
 * one-link-per-surface invariant above reviewable rather than aspirational:
 * adding a surface is a deliberate edit here, next to the rule it has to obey.
 */
export type HelpSurface = 'wall-setup-card' | 'create-welcome';

export function openHelpArticle(path: HelpPath, surface: HelpSurface): void { ... }
```

Two Pass 3 refinements over the Pass 2 sketch, both of which remove code rather than add it:

- **`HELP_PATHS` lives here, not in `wallDeviceTips.ts`.** Pass 2 put `WALL_SETUP_HELP_PATH` in the
  tips module, which coupled a help-slug concern to a checklist concern and scoped the drift guard
  to exactly one link. Declaring paths in the module that owns help links costs nothing, puts the
  constant where a reader looks for it, and turns the guard into a **class** guard: the test
  iterates `Object.values(HELP_PATHS)` and asserts each resolves, so every future entry is covered
  for free.
- **`HelpPath` is a union, so the normalising regex goes.** Pass 2 had
  `path.replace(/^\/+/, '')`. With a closed union of already-normalised constants that branch can
  never fire, so it is untested dead code defending against a caller the type system now rejects.
  This is the same reasoning the plan uses for `UIStringKey[]` in section 5: make the typo a
  compile error and delete the runtime guard.

`openHelpArticle` does three things, in order, synchronously inside the caller's click handler
(the popup-blocker constraint `openExternal` documents):

1. `logEvent({ level: 'info', surface, message: 'help_click', context: { action: 'help_click' } })`.
   `action` is an existing `ALLOWED_CONTEXT_KEYS` member (verified in
   `src/utils/diagnosticContext.ts:68`), so no allowlist, Lambda-mirror or store-declaration change
   is triggered. `logEvent` is documented fire-and-forget and never throws, so it is safe ahead of
   the navigation.
2. `openExternal(helpUrl(path))` inside a `try`.
3. `catch` to `reportError({ surface, severity: 'warning', message: 'help link failed', error })`,
   so a throw is telemetry plus console rather than a dead button. Severity `warning` is correct:
   this is not data at risk, so it must not page `#beanies-errors`.

**Why the log comes first here, when `discord.ts` navigates first.** `discord.ts` calls
`openExternal` ahead of `track()` and its docblock calls that order load-bearing, so this
difference has to be written down or the next reader will "align" them and quietly lose an event.
It is deliberate on two grounds. `track()` is a Plausible network call, whereas `logEvent` is a
synchronous, documented fire-and-forget buffer write that never throws, so it cannot cost the user
gesture. And logging first means a click that ends in a thrown `openExternal` still produces BOTH
a `help_click` and a warning, which is exactly the pair needed to see "people are trying the setup
helper and it is failing" rather than silence. It also preserves `CreatePodWelcome.openSafetyHelp`'s
existing order byte for byte, which is part of why its tests pass untouched.

Import `logEvent` from `@/services/telemetry` (the index), not from
`@/services/telemetry/logEvent`. This matters: `CreatePodWelcome.test.ts:22` mocks the index, and
the helper must be interceptable by the same mock. (The index's own docblock notes that a dozen
test files mock this barrel with `{ logEvent }` alone, which is precisely why it is the right
import here.)

Then **migrate `CreatePodWelcome.vue`** to `openHelpArticle(HELP_PATHS.zeroKnowledge,
'create-welcome')`, deleting its local `SAFETY_HELP_URL` (`:31`) and the whole body of
`openSafetyHelp` (`:75-95`): the `logEvent` call inside it, the `try/catch` and the `openExternal`
call. Exactly three imports become unused and are removed: `reportError`, `openExternal` and
`MARKETING_URL`. **`logEvent` stays imported** (`:7`); `onMounted`, `proceed()` and `cancel()` all
still use it, and dropping that import would fail three other tests in the same file. This is the
one place the migration can go wrong, so it is spelled out rather than left to "delete the unused
imports". Its existing tests ("safety link opens the encryption help article and
logs help_click" and "a thrown external-link error is reported as a warning and never propagates")
pass unchanged, verified against the test file: it mocks `@/utils/openExternal`,
`@/utils/errorReporter`, `@/services/telemetry` and `@/utils/marketing`, all four of which the
helper imports, and it asserts `reportError` with `expect.objectContaining({ surface, severity })`
so the generic message does not break it. Those two tests become the helper's regression net for
free.

The remaining five article sites are **not** migrated here. Each has its own telemetry contract
(`trackInstallClicked`, `track('install_help')`, per-item `cta.href` from content), and rewriting
them is a separate, testable change rather than cargo on this one. The docblock above is what
stops the count growing.

### 4. The card

`WallSetupCard.vue` keeps its existing PIN-prerequisite behaviour, modal, watcher and button
untouched. Added between the description and the button:

```ts
import { getDevicePlatform, isWakeLockSupported } from '@/services/sync/capabilities';
import { openHelpArticle, HELP_PATHS } from '@/utils/helpLinks';
import { wallDeviceTipKeys } from '@/utils/wallDeviceTips';

const tipKeys = wallDeviceTipKeys(getDevicePlatform(), isWakeLockSupported());

function openSetupHelp(): void {
  openHelpArticle(HELP_PATHS.wallSetup, 'wall-setup-card');
}
```

Three imports and five lines of script. Computed once at setup, not reactive: neither input can
change during the card's life, and a `computed` would imply otherwise.

**Budget, so this card does not become the next thing that needs refactoring.** The card is 94
lines today and its script gains under ten. If a future change would push the added script past
roughly forty lines, or add a second `watch`, that is the signal to extract, not to keep bolting
on. Recorded here rather than left to judgement, because "the settings card that grew" is the
predictable failure mode of a card that has both a prerequisite flow and a content block.

Template:

- A lead-in line (`t('wall.setup.tips.lead')`) then a `<ul>` of three `<li>`, each
  `text-sm leading-snug text-secondary-400 dark:text-ink-soft`, with a bullet glyph in a
  `<span aria-hidden="true" class="text-primary-500 dark:text-accent-lift">`. Visual weight kept
  deliberately low so it reads as a nudge, not homework.
- Beneath it, a single `<button type="button" data-testid="wall-setup-help">` calling
  `openSetupHelp()`, styled `text-sm font-semibold text-primary-500 dark:text-accent-lift
hover:underline`. A `<button>` rather than an `<a>` because the navigation is
  `openExternal`'s synthetic anchor, and a real `<a href>` here would be a second, divergent
  link path.

The card paints no new background, so there is no new dark partner to author beyond the two
`-lift` accents above.

### 5. The tip picker, as a pure function

`src/utils/wallDeviceTips.ts`:

```ts
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { DevicePlatform } from '@/services/sync/capabilities';

/** The three high-level lines the wall card shows, as translation keys. */
export function wallDeviceTipKeys(
  platform: DevicePlatform,
  wakeLockSupported: boolean
): UIStringKey[] { ... }
```

One export, one job. (Pass 2 also parked `WALL_SETUP_HELP_PATH` here; Pass 3 moved it to
`helpLinks.ts`, which is where a help path belongs. See section 3.)

Three keys, in order: keep the screen on (wording differs on wake-lock support), lock it to
beanies (Guided Access / screen pinning / generic), mount it near a socket.

It is a `utils` function taking its inputs as arguments, not a composable:

- It uses no Vue API and is not reactive, so `use*` in `src/composables/` would misdescribe it and
  invite a future reader to add a `ref` it does not need.
- Injecting `platform` and `wakeLockSupported` means the test needs no module mocking at all: six
  table-driven cases (three platforms x two wake-lock states) assert the exact key triples in a
  few lines, with no mount and no `vi.mock`.
- Returning `UIStringKey[]` rather than resolved strings means a typo is a **compile** error, and
  the card keeps calling `t()` where every other card does, which also keeps
  `eslint-rules/no-bare-render-strings.js` satisfied. (That rule covers `src/constants/**` and
  `src/composables/**`, not `src/utils/**`, so returning keys is the belt as well as the braces.)

**Rejected: `InfoHintBadge.vue`.** It genuinely already does "bulleted `items` plus an optional
foot `link` opened via `openExternal`" (`OnboardingAccount.vue:170-178` is exactly that shape),
and it was checked first. It is rejected because it is a `?`-badge popover: its content is hidden
until tapped, which defeats requirement 4's "clear, prominent link" and puts the checklist behind
an interaction on the one surface that is meant to reassure at a glance. Nothing is duplicated by
declining it, because the card does not re-implement a popover, a teleport or a positioner. If a
second surface ever wants this exact "inline checklist plus prominent help link" block, that is
when it becomes a component; one consumer is not a pattern.

### 6. The slug-drift guard

The only realistic silent failure in this change is the link and the article disagreeing: the card
would open a marketing 404 and no code anywhere would notice. Close it with a test, not with
runtime code.

`src/utils/__tests__/helpLinks.test.ts` imports `HELP_PATHS` and `getArticle` from
`@/content/help`, and for **every** value in `HELP_PATHS` splits on the first `/` and asserts the
article resolves. The import is test-time only, so nothing is added to the app bundle. If either
side is renamed, the suite goes red on the same commit.

Scoping the guard to the whole `HELP_PATHS` record rather than to one constant is the Pass 3
change, and it is free: the loop is the same length as the single assertion would have been, and
every future help link declared in that module inherits the protection instead of needing its own
bespoke test. The same file also asserts `helpUrl()` composes the expected absolute URL against a
mocked `MARKETING_URL`, and that `openHelpArticle` logs then opens (the error path is already
covered by `CreatePodWelcome.test.ts`, so it is not re-asserted here).

### 7. The article

New `HelpArticle` appended to `GETTING_STARTED_ARTICLES`:

| field         | value                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`        | `set-up-the-beanie-wall`                                                                                                                                                   |
| `category`    | `getting-started`                                                                                                                                                          |
| `title`       | `Set up the beanie wall on a tablet`                                                                                                                                       |
| `excerpt`     | one sentence, required by `types.ts`: turn a spare tablet into the family wall display, and set the two device settings that keep it awake and keep small hands in the app |
| `icon`        | 🧱                                                                                                                                                                         |
| `readTime`    | 6                                                                                                                                                                          |
| `popular`     | **omitted**                                                                                                                                                                |
| `updatedDate` | `2026-09-11`                                                                                                                                                               |

**`popular` is deliberately omitted.** Twelve of the corpus's articles already carry
`popular: true`, and `getPopularArticles()` feeds a "popular" list whose usefulness is inversely
proportional to its length. A brand-new article is not popular by evidence; marking it so is an
unfalsifiable claim that makes the flag mean "recently written". Discovery is already covered
three ways: the card's own prominent link (the whole point of this change), the Getting Started
category page, and help search. Flip it to `true` later on real traffic, which is a one-line,
zero-risk edit.

Section order (every `heading` gets a kebab-case `id` for the TOC, matching the existing
`what-is-a-pod` / `step-by-step` convention):

1. **paragraph** why the wall exists and what you get by the end.
2. **callout** you need a PIN on your own profile first, because leaving the wall asks for it.
3. **heading + steps** Turn the wall on: Settings, the **Beanie Wall** card, **Start the wall**,
   pick a view. Name the four views exactly: **The week**, **Each bean**, **Today**,
   **The chore board**.
4. **heading** (`keep-the-screen-on`) Make the screen stay on. A paragraph explaining that beanies
   holds the screen awake by itself where the browser allows it, and that where it cannot, the
   tablet's own timeout is the only thing keeping it lit, which is why the setting below matters.
   - **heading level 3** `screen-on-apple` "Keep an iPad or iPhone awake" + steps
   - **heading level 3** `screen-on-android` "Keep an Android tablet awake" + steps, with an
     explicit note that the exact menu names vary by manufacturer.
5. **heading** (`stop-wandering`) Stop small hands wandering off, with two more level-3 blocks and
   a callout that this is what stops a child leaving beanies for YouTube.
   - **heading level 3** `guided-access-apple` "Turn on Guided Access (Apple)" + steps
   - **heading level 3** `screen-pinning-android` "Turn on screen pinning (Android)" + steps
6. **heading + paragraph** Which way up. The orientation matrix in plain words.
7. **heading + steps/list** Mounting and charging, with a **callout** on battery swelling.
8. **heading + list** What the wall shows, and what it never shows. Finances are structurally
   excluded regardless of who is signed in.
9. **heading + paragraph** Getting back out: the padlock, **Unlock editing** (any grown-up's
   PIN), **Lock the wall again**, **Start night mode now**, **Leave the beanie wall** (your own
   PIN).
10. **paragraph** What's next, pointing at the family planner and beanie lists articles.

**The four level-3 ids and headings above are load-bearing, not a suggestion.** Both the ids and
the visible text are distinct because both are rendered: the id lands on the `<h3>` and the text
lands in the "On this page" nav, indented. "On an iPad" appearing twice would produce a duplicate
id and two identical, ambiguous TOC rows. Naming them by what the reader is trying to achieve
("Keep an iPad or iPhone awake", "Turn on Guided Access (Apple)") is also simply better copy: the
TOC then reads as a task list rather than as a platform list repeated twice.

**Why stacked and not columned.** `SectionType` is
`heading | paragraph | callout | infoBox | codeBlock | list | steps`, and
`HelpArticleRenderer.astro` maps each to a single element in one vertical
`space-y-5` stream. There is no table, grid or column type and no article uses one. Requirement 2
is satisfied by the pair of level-3 blocks under a shared level-2 heading: both platforms are
unconditionally present, neither is sniffed, and the TOC gives a one-tap jump to whichever the
reader needs. **Explicit non-goal: do not add a `SectionType` for this.** A new section type is a
change to a shared renderer, a shared type and a search-text flattener for the benefit of one
article, which is exactly the bloat this pass exists to prevent.

A file comment above the article records that its orientation paragraph must be revisited when
phase 8 ships.

### 8. Skill inventory

Add the article to the Getting Started list in `.claude/skills/beanies-help-docs/SKILL.md:270-277`
and bump the heading count from `(6)` to `(7)`.

### 9. Blast radius: the two refactors, judged

The user scoped this as "write a help article and update one card". Pass 2 added two refactors of
existing, working code. CLAUDE.md mandates DRY rigorously **and** mandates minimal blast radius and
maximal simplicity, so the tension is real and is resolved here rather than left implicit.

The resolving question is not "does this remove duplication" (both do). It is: **does shipping
without this refactor leave the codebase better or worse than it is today?**

**`PwaReinstallModal.vue` onto `getDevicePlatform()` — KEEP.**

This one is not optional in the way it first appears. Without it, this change **introduces**
duplication rather than merely declining to remove it: `getDevicePlatform()` would ship as a new
shared function whose three-way branch is byte-for-byte the logic already sitting inline in
`PwaReinstallModal.vue`, and both would live on. Today there is one copy; deferring would leave
two. That is a net worsening caused by this change, which is a different thing from an inherited
debt we chose not to pay.

Against that, the cost is genuinely small and was measured against the file, not assumed: six lines
deleted, one changed, both fallback arms are bare `return`s so there is no comparison to update,
and the only semantic delta is a local token rename (`'desktop'` to `'other'`). The translation
keys are explicitly frozen (see caveats) so nothing crosses into `uiStrings.ts` or the translation
pipeline.

The honest weakness: **`PwaReinstallModal.vue` has no unit test** (verified: nothing matching it in
`src/components/common/__tests__/`), so the migration is CI-unverified and rests on manual UA
checks. The proportionate response is _not_ to write one. A mount test for that modal would need
`BaseModal`, `useStalePwaNotice`, `claimInterruption` and `sessionStorage` all mocked, making it
the single largest new artefact in a change that is supposed to be an article and a card. Instead:
`getDevicePlatform()` itself is unit-tested in `capabilities.test.ts`, the modal diff is required
to be a pure substitution with no other edit in that file in the same commit (so a reviewer can
verify it by eye in seconds), and the manual UA walk stays as testing-plan step 10.

**`CreatePodWelcome.vue` onto `openHelpArticle` — KEEP.**

Note first what is _not_ in question: `helpLinks.ts` itself is new code this change needs, because
the new card must open a help link with telemetry and error handling. Only the migration of the
existing consumer is beyond the ask.

Three things carry it:

1. **It is the source the contract was copied from.** `openHelpArticle` is `openSafetyHelp` with
   the surface parameterised. Shipping the shared version while leaving the original hand-rolled
   twin in place is the textbook setup for divergence: the next fix to the error contract lands in
   one of them.
2. **It reuses coverage the repo already has, and proves the extraction was faithful.**
   `CreatePodWelcome.test.ts`'s two help-link tests transfer onto the helper unchanged, including
   the thrown-error path. Verified line by line: the file mocks `@/services/telemetry`,
   `@/utils/openExternal`, `@/utils/errorReporter` and `@/utils/marketing` (all four of the
   helper's imports), asserts the resolved url
   `https://beanies.family/help/security/zero-knowledge-architecture` (which
   `helpUrl(HELP_PATHS.zeroKnowledge)` reproduces exactly), reads `context.action` (unchanged),
   and matches `reportError` with
   `expect.objectContaining({ surface: 'create-welcome', severity: 'warning' })`, so the helper's
   more generic message does not break it. Not claimed: that this is the ONLY way to cover the
   helper. Section 6 already covers log-then-open in `helpLinks.test.ts`, and the error path would
   be a further six lines there. The value is that a green, PRE-EXISTING test is the strongest
   available evidence that the extraction changed no behaviour, which a test written alongside the
   helper could not be.
3. **The plan's own rule points here.** Section 5 rejects `InfoHintBadge` on the grounds that "one
   consumer is not a pattern". A `helpLinks.ts` with exactly one consumer would fail that same
   test. Two consumers is what makes the module a seam rather than a wrapper.

The change is also net-negative in lines: roughly twenty deleted from the component against a
one-line call. Blast radius is one presentational modal whose only failure mode is "the safety link
does not open", which is precisely the non-critical class the warning severity already encodes.

**What stays deferred, and is written down so it does not get done by accident:** the other six
hand-built help URLs (`AppHeader`, `ActivityViewEditModal`, `WhatsNewBody`, `TodoItemRow`,
`OnboardingAccount`, `useInstallNudge`); `platformLabel.formFactor()` on top of
`getDevicePlatform()`; and any `WallLockMenu` change (out of scope by decision). Each of those
either has its own telemetry contract to reconcile or changes strings that leave the app, so each
is its own small, testable commit. The `helpLinks.ts` docblock and the table in section 2 are what
keep those from quietly growing.

## Files Affected

**Modified**

- `src/services/sync/capabilities.ts` add `DevicePlatform` + `getDevicePlatform()` +
  `isWakeLockSupported()`; broaden the module docblock from "sync features" to the app's browser
  capability seam.
- `src/services/sync/__tests__/capabilities.test.ts` three `getDevicePlatform` branches plus
  `isWakeLockSupported`.
- `src/components/common/PwaReinstallModal.vue` drop the local `Platform` type and the inline
  `/Android/` test, consume `getDevicePlatform()`. Pure substitution, no other edit in this commit.
- `src/composables/useWakeLock.ts` import `isWakeLockSupported` from capabilities instead of
  computing it inline. One import added, one expression removed.
- `src/components/login/CreatePodWelcome.vue` consume `openHelpArticle`; delete the local
  `SAFETY_HELP_URL`, the `openSafetyHelp` body and the now-unused `reportError` / `openExternal` /
  `MARKETING_URL` imports. The `logEvent` import STAYS (three other call sites in the file).
- `src/components/settings/WallSetupCard.vue` checklist + help link.
- `src/services/translation/uiStrings.ts` new `wall.setup.tips.*` and `wall.setup.help.*` keys,
  `en` + `beanie`.
- `src/services/translation/uiStrings.test.ts` add `'wall.setup.tips.'` to `IMPORTANT_PREFIXES`.
- `src/content/help/getting-started.ts` the new article.
- `.claude/skills/beanies-help-docs/SKILL.md` inventory.
- `CHANGELOG.md` user-facing entry.
- `docs/STATUS.md` session record.

**Created**

- `src/utils/helpLinks.ts` (`HELP_PATHS`, `HelpPath`, `helpUrl`, `openHelpArticle`)
- `src/utils/__tests__/helpLinks.test.ts` (URL composition, log-then-open, and the
  every-path-resolves drift guard)
- `src/utils/wallDeviceTips.ts` (`wallDeviceTipKeys` only)
- `src/utils/__tests__/wallDeviceTips.test.ts` (the six-case tip-triple table)
- `src/components/settings/__tests__/WallSetupCard.test.ts` (renders three lines, link calls
  `openHelpArticle` with the right path and surface)

**Explicitly NOT modified**

- `src/components/wall/WallLockMenu.vue` out of scope, see caveats.
- `web/src/pages/from/skylight.astro` copy stays.
- `web/src/components/HelpArticleRenderer.astro` and `src/content/help/types.ts` no new section
  type, see Approach section 7.
- `src/utils/platformLabel.ts` and `src/services/auth/biometricShared.ts` keep their own UA parses,
  see the table in Approach section 2.
- `AppHeader.vue`, `ActivityViewEditModal.vue`, `WhatsNewBody.vue`, `TodoItemRow.vue`,
  `OnboardingAccount.vue`, `useInstallNudge.ts` deferred `helpLinks` migration, see Approach
  sections 3 and 9.

## Help Center Coverage

- **Action**: `new article`
- **Category**: `getting-started`
- **Article type**: `how-to`
- **Slug**: `set-up-the-beanie-wall`
- **Title**: Set up the beanie wall on a tablet
- **Scope**: How to turn a spare tablet into the family's wall display: starting the mode, picking
  a view, and the device setup that makes it stay on and stay put (Auto-Lock or screen timeout,
  Guided Access or screen pinning, orientation, mounting and charging).
- **Notes**: must call out the PIN prerequisite and that leaving asks for it; that a permanently
  charged tablet swells its battery and many Android tablets can cap the charge while most iPads
  cannot; the orientation matrix; that where Screen Wake Lock is unavailable the OS timeout is the
  only thing keeping the screen on; that Android menu names vary by manufacturer; and that no
  financial information is ever shown on the wall.

## Observability Coverage

This change adds a Settings-surface link and a static checklist. It performs no I/O, no crypto,
no persistence and no network call of its own, so it adds no new failure class. It deliberately
adds **no per-render telemetry**: an event per card render would be noise on a surface that
cannot fail.

It does add one event and one guard, because the pass-2 rule is that nothing fails silently:

- **`help_click`.** `openHelpArticle` logs `{ level: 'info', surface: 'wall-setup-card',
message: 'help_click', context: { action: 'help_click' } }`. This is the same event
  `CreatePodWelcome` already emits, now emitted from one place, and it is what answers "did anyone
  actually follow the setup helper the Skylight page promises". `action` is an existing
  `ALLOWED_CONTEXT_KEYS` member (`src/utils/diagnosticContext.ts:68`).
  **The event distinguishes call sites by `surface` alone**, which is exact today because every
  surface has at most one help link. That invariant is written into the `helpLinks.ts` docblock,
  and the documented escape hatch if it ever breaks is the already-allowlisted `kind` key, not a
  new one. Stating the invariant now is what stops a future second link on the same surface
  silently making the metric unreadable.
- **A thrown link is reported, not swallowed.** `openHelpArticle` wraps `openExternal` and reports
  `severity: 'warning'` on a throw. Warning, not critical: the user's data is not at risk, so this
  must reach telemetry and the console without paging `#beanies-errors`. No bare `catch {}` is
  added anywhere in this change.

The candidate silent failures are closed as follows:

- **A mis-wired or refused URL.** `openExternal` (`src/utils/openExternal.ts`) refuses an empty URL
  and a non-http(s) scheme with an explicit `console.error` naming the cause and the fix. That is a
  dev-time guard only, since it returns `void` and a kitchen tablet has no console, so this plan
  does not lean on it: the URL is built by `helpUrl()` from a **closed union of module constants**,
  so it cannot become empty or non-http at runtime and the type system rejects any other input.
- **The link and the article drifting apart** (the one failure that could realistically ship). A
  renamed slug on either side would open a marketing 404 with no error anywhere. Closed by the
  test in Approach section 6, which resolves **every** `HELP_PATHS` value against `ALL_ARTICLES` at
  test time. This is the right place for it: a runtime check would mean importing 5,326 lines of
  help content into the app bundle to detect a mistake that only a developer can make.
- **Platform detection.** `getDevicePlatform()` is SSR-safe by construction and returns `'other'`
  when `navigator` is missing; `isWakeLockSupported()` is guarded the same way. Both degrade to a
  correct generic checklist rather than an empty one. Degradation is a normal render path, not an
  error, so it warrants no event.
- **Missing strings.** `wallDeviceTipKeys()` returns `UIStringKey[]`, so a mistyped key fails
  `npm run type-check` rather than rendering a raw key on a user's screen.
- **A misleading beanie-mode value on device instructions.** These lines tell a parent what to do
  to their device, so "keep your bean awake" would be a euphemism a reader could act wrongly on,
  which is exactly the floor CLAUDE.md sets. Rather than leave that to review, add
  `'wall.setup.tips.'` to `IMPORTANT_PREFIXES` in `uiStrings.test.ts` so it is enforced. The
  narrow prefix (not a blanket `wall.`) follows the discipline that file already documents for the
  wall's playful chore copy. Add it as its own entry with its own one-line reason, NOT appended to
  the existing `wall.job.*` / `wall.*Failed.*` group: that group's comment reads "The wall's
  DESTRUCTIVE copy only", and tacking a device-instruction prefix under it would make a correct
  comment false. Note also that `wall.setup.help.*` is deliberately left out; the link label is
  chrome, not an instruction a parent could act on wrongly.

**Signal preserved, not removed:** the wall's own `beanie-wall` surface is untouched. In
particular `useWakeLock`'s existing `wall_wakelock_denied` / `wall_wakelock_released` /
`wall_wakelock_reacquired` events keep firing exactly as they do today. Relocating
`isWakeLockSupported()` from `useWakeLock.ts` to `capabilities.ts` moves one boolean expression
between modules and changes no call site's behaviour, so the existing ability to see, in
CloudWatch, that a specific family's wall could not hold its screen awake is preserved intact.
That existing event remains the way this feature's real-world failure ("the wall went dark
overnight") is diagnosed.

**No new `context` keys**, so `ALLOWED_CONTEXT_KEYS`, the Lambda mirror and the store
data-collection declarations (`docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`,
the Data-Safety answers, `privacy.astro`) need no update.

## Acceptance Criteria

- [ ] `set-up-the-beanie-wall` exists in `getting-started.ts` with a non-empty `excerpt` and
      renders at `beanies.family/help/getting-started/set-up-the-beanie-wall` in `npm run dev:web`.
- [ ] The article carries both an Apple block and an Android block, both unconditionally visible,
      and every UI label in it matches the shipped strings exactly (**Start the wall**,
      **The week**, **Each bean**, **Today**, **The chore board**, **Unlock editing**,
      **Lock the wall again**, **Start night mode now**, **Leave the beanie wall**).
- [ ] Every heading `id` in the article is unique, and the rendered "On this page" nav shows four
      distinct level-3 rows (no repeated "On an iPad"). Verify in the browser, not by reading.
- [ ] No new `SectionType` was added and `HelpArticleRenderer.astro` is unmodified.
- [ ] The article covers all six scope notes: PIN prerequisite, battery swelling, orientation
      matrix, wake-lock caveat, Android naming variance, no finances on the wall.
- [ ] `WallSetupCard` shows a three-line checklist and a prominent help link, and the whole card
      still reads as an invitation rather than a chore list.
- [ ] The checklist's wording changes when Screen Wake Lock is unsupported.
- [ ] The checklist names Guided Access on Apple and screen pinning on Android.
- [ ] `WallSetupCard.vue` does **not** import from `@/composables/useWakeLock`, and no wake lock is
      acquired by visiting Settings.
- [ ] `getDevicePlatform()` is the only OS-family branch used for **user-facing copy**:
      `grep -rn "/Android/" src/` returns `capabilities.ts`, `platformLabel.ts` (Slack telemetry)
      and `biometricShared.ts` (authenticator label) only, and `PwaReinstallModal.vue` is no longer
      among them.
- [ ] The `PwaReinstallModal.vue` diff is a pure substitution and nothing else: the local
      `Platform` type (`:14`) and the inline UA computed (`:16-22`) deleted,
      `const platform = computed(getDevicePlatform);` in their place, and the `:7` import swapped
      from `isIosOrIpadOs` to `getDevicePlatform` (leaving `isIosOrIpadOs` imported would fail
      `@typescript-eslint/no-unused-vars`, which is `error`). No change to the
      `pwaReinstall.desktopStep*` keys, to the `steps` / `screenshot` computeds (both already end
      in a bare fallback `return`, verified, so there is no `=== 'desktop'` to update), or to
      anything else in the file.
- [ ] `openHelpArticle` is the only new help-link path; every help path in this change is declared
      in `HELP_PATHS`; and `CreatePodWelcome.test.ts` passes **unmodified**.
- [ ] The drift test iterates every `HELP_PATHS` value and fails if either the constant or the
      article slug is renamed (verify by temporarily breaking one).
- [ ] Every new card string has both `en` and `beanie`, `'wall.setup.tips.'` is in
      `IMPORTANT_PREFIXES`, and `uiStrings.test.ts` passes with real nouns kept on device wording.
- [ ] Card is correct in light and dark mode; every accent used as text uses `dark:text-accent-lift`
      and no invented `-lift` token appears.
- [ ] No em-dashes anywhere in the new prose.
- [ ] `WallLockMenu.vue` is unmodified.
- [ ] `npm run lint`, `npm run type-check`, and the unit suite pass.

## Testing Plan

1. `npm run dev:all`. Open Settings, confirm the Beanie Wall card renders the checklist and link,
   and that it does not read as intimidating at phone and tablet widths.
2. Click the help link. Confirm it opens the article in a new tab, the app is still on Settings
   behind it, and a `help_click` event is emitted for surface `wall-setup-card`.
3. Toggle dark mode on that card. Confirm the checklist bullets and the link render in
   `accent-lift` and not in an unstyled colour.
4. Confirm no wake lock is taken by Settings: with the card mounted, check
   `navigator.wakeLock` is not held, and that no `wall_wakelock_*` event fires from a Settings
   visit. Also confirm by inspection that the card's import list contains no composable.
5. Unit-test `wallDeviceTipKeys` across all six combinations (three platforms x two wake-lock
   states) as a table.
6. Unit-test `helpLinks`: `helpUrl` composition against a mocked `MARKETING_URL`, `openHelpArticle`
   logs then opens, and the every-`HELP_PATHS`-value-resolves drift assertion.
7. Unit-test `WallSetupCard`: three list items render, and clicking the help button calls
   `openHelpArticle` with `HELP_PATHS.wallSetup` and `'wall-setup-card'`.
8. Unit-test `getDevicePlatform` (iOS, Android, fallback) and `isWakeLockSupported` (present and
   absent) in `capabilities.test.ts`. Idioms, both already proven in this repo / environment:
   `vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)` for the platform branches (the
   pattern `src/utils/platformLabel.test.ts:23` uses under `happy-dom`); and, because `happy-dom`
   ships no `navigator.wakeLock`, `Object.defineProperty(navigator, 'wakeLock', { value: {},
configurable: true })` for the supported branch with a `delete` in the matching cleanup, taking
   the absent branch from the default environment.
9. Re-run `CreatePodWelcome.test.ts` unmodified. It must stay green, which is the proof that the
   `openHelpArticle` extraction preserved the error contract.
10. Open the PWA reinstall modal on an iOS UA, an Android UA and a desktop UA and confirm the
    correct step list and screenshot still appear after the `getDevicePlatform()` migration. This
    is a manual check by design (see Approach section 9); do it on all three, not just one.
11. `npm run dev:web`, visit the article URL, read it end to end against the running app with a
    real tablet-width window, confirm every named label matches, and click every "On this page"
    row to confirm each anchor lands on its own heading.
12. Walk the article's iPad steps on a real iPad if one is to hand, since the whole point is that
    the instructions are followable.
13. `npm run lint && npm run type-check && npm run test`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the article outline, the card change, the
  `isWakeLockSupported()` extraction that avoids acquiring a lock from Settings, and the
  `useWallDeviceTips` composable that keeps the platform branch out of the template.
- **Pass 2 (DRY + error handling)**: Replaced the `useWallDeviceTips` composable with a shared
  `getDevicePlatform()` in the ADR-029 capabilities seam (deduping `PwaReinstallModal`'s inline
  UA test) plus a pure `wallDeviceTipKeys()` util; extracted the `CreatePodWelcome` help-link
  contract into `openHelpArticle` so telemetry and `reportError` are not re-hand-rolled a ninth
  time; fixed the non-existent `primary-lift` token to `accent-lift`; added the required `excerpt`
  field; replaced the unrenderable "side by side" columns with stacked blocks and an explicit
  no-new-`SectionType` non-goal; added a slug-drift test as the guard against the one true silent
  failure; and recorded why `InfoHintBadge` was checked and rejected. Verified the
  `isWakeLockSupported()` extraction is genuinely side-effect free.
- **Pass 3 (Sustainability)**: Moved `isWakeLockSupported()` into `capabilities.ts` so the card
  never imports the lock-taking composable (retiring the ⚠️ caveat structurally, dropping a
  transitive `useToday`/telemetry pull into Settings, and landing the predicate in a file that has
  a test); moved help paths out of `wallDeviceTips.ts` into a typed `HELP_PATHS` union in
  `helpLinks.ts`, which deletes the untested normalising regex and widens the drift guard from one
  link to every declared link; caught that the article's repeated "On an iPad" level-3 headings
  would emit duplicate DOM ids and duplicate TOC rows (verified the TOC renders level-3 headings)
  and specified four distinct headings and ids; corrected the overstated "one platform seam, not
  three" claim with a table of the two UA parses that deliberately remain; enforced the
  device-wording beanie floor via `IMPORTANT_PREFIXES` instead of by review; recorded the
  one-help-link-per-surface telemetry invariant and its escape hatch; dropped the unearned
  `popular: true`; added a growth budget for the card; and resolved the DRY-versus-blast-radius
  tension in a new Approach section 9, keeping **both** refactors (the modal because deferring it
  would leave two copies of a branch this change itself introduces, the welcome modal because it is
  the contract's source, is net-negative in lines, and is the only thing giving `openHelpArticle`
  test coverage) while explicitly declining to write a disproportionate mount test for the modal
  and instead constraining its diff to a reviewable pure substitution.
- **Pass 4 (Fresh-eyes sweep)**: Corrected the help-link inventory in Approach 3, which overcounted
  (six hand-built ARTICLE urls, not eight) and listed `AppHeader.vue`, `WhatsNewBody.vue` and
  `constants/navigation.ts` as migration targets when they open a help INDEX that `HelpPath`'s
  `category/slug` shape deliberately excludes; typed `openHelpArticle`'s `surface` as a closed
  `HelpSurface` union so the one-link-per-surface invariant is checkable, matching `DiscordSurface`;
  recorded why the helper logs before it navigates when `discord.ts` documents the opposite order as
  load-bearing; spelled out that `CreatePodWelcome.vue` keeps its `logEvent` import (three other
  call sites) so the migration cannot silently break three unrelated tests; added the caveat that 32
  test files replace `@/services/sync/capabilities` with partial `vi.mock` factories, with the
  full-suite check and the fix if one goes red (and confirmed there is no import cycle and no
  Capacitor-in-SSR path); named the `navigator.wakeLock` / `userAgent` test idioms so section 1's
  "it lands in a file that has a test" argument is actually executable; required the `isIosOrIpadOs`
  to `getDevicePlatform` import swap in the modal's "pure substitution" criterion (an unused import
  is a lint `error`); kept both refactors after re-deriving the reasoning independently, while
  replacing section 9's overstated "only thing that gives `openHelpArticle` a test" with the
  accurate claim (it reuses pre-existing green tests as evidence the extraction was faithful); and
  verified the `CreatePodWelcome.test.ts` passes-unmodified claim assertion by assertion.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> In a few different places you talked about how there is a 'setup assistant' or something to that
> effect for the wall (i believe this was mentioned in the switching pages - i.e. skylight, maple,
> etc) which helps to set the right settings on your ipad or android tab so it stays awake, doesn't
> lock, prevents kids from switching apps, etc. where is this setup assistant - is it built yet or
> planned? what is the plan for it - i.e. just a help page, or something like an actual on app setup
> wizard that guides you thru the settings? just wanted to know if this is an actual thing or just a
> idea (or maybe a hallucination)

### Follow-up 1

> Leave the copy as is, just go ahead to write the set up beanie wall help article with the platform
> specific checklists inside help (rather than on the app, which could look confusing or
> intimidating). update the the wall setup card to include a clear and prominent link to the help
> article explaining to users to open up help to configure / optimize their device to run the beanie
> wall safely with kids once it's setup, as well as a link in the beanie wall lock dropdown. you can
> include a very very brief, short, and concise platform-aware checklist in the wall setup card
> (ensuring it does not look too intimidating) with just high level steps a link to the relevant help
> article for more details
>
> what do yo utihnk or would you suggest a different approach?

### Follow-up 2

> ok go ahead to write the help article and make the changes, can skip the wall lock link, no need a
> mockup. then go ahead to run the plan through /beanies-plan. once the plan is done proceed to
> implementation

### Follow-up 3

> once implementation is complete, run a quick code review (probably does not need max) to ensure
> everything was done right, and fix any issues found

</details>
