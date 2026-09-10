---
date: 2026-09-11
category: enhancement
issue: none
plan: docs/plans/2026-09-11-beanie-wall-setup-help.md
tags: [beanie-wall, help-center, settings, capabilities, dry, i18n, marketing-claim]
---

# The beanie wall's "setup helper" — a live marketing promise with nothing behind it

## Prompts

**2026-09-11, morning SGT — is this real?** greg asked, verbatim:

> In a few different places you talked about how there is a 'setup assistant' or something to
> that effect for the wall (i believe this was mentioned in the switching pages - i.e. skylight,
> maple, etc) which helps to set the right settings on your ipad or android tab so it stays
> awake, doesn't lock, prevents kids from switching apps, etc. where is this setup assistant -
> is it built yet or planned? what is the plan for it - i.e. just a help page, or something like
> an actual on app setup wizard that guides you thru the settings? just wanted to know if this
> is an actual thing or just a idea (or maybe a hallucination)

**The answer: planned, promised on prod, never built.** `web/src/pages/from/skylight.astro`
claims a "setup helper" three times (`:840`, `:926`, `:950`), live and serving (HTTP 200,
phrase present 3x in the served HTML). The original beanie-wall plan
(`docs/plans/2026-08-31-beanie-wall.md`) requirement 17 had specified it, and its Help Center
Coverage section resolved it to an article slug `set-up-the-beanie-wall` as a phase 7
deliverable. The article was never written, `WallSetupCard.vue` said nothing about the device,
and grepping the whole app and help corpus for "Guided Access" or "auto-lock" returned nothing.
Not a hallucination; a promise that outran the build.

**Follow-up 1 — build it, and a request for an opinion.** greg:

> Leave the copy as is, just go ahead to write the set up beanie wall help article with the
> platform specific checklists inside help (rather than on the app, which could look confusing
> or intimidating). update the the wall setup card to include a clear and prominent link to the
> help article explaining to users to open up help to configure / optimize their device to run
> the beanie wall safely with kids once it's setup, as well as a link in the beanie wall lock
> dropdown. you can include a very very brief, short, and concise platform-aware checklist in
> the wall setup card (ensuring it does not look too intimidating) with just high level steps a
> link to the relevant help article for more details
>
> what do yo utihnk or would you suggest a different approach?

**Pushback given, and accepted: the lock-dropdown link was dropped.** The padlock menu opens
with **no challenge**, so any child can tap it, and `/help/*` is not an in-app route:
`src/router/index.ts:37` does `window.location.replace(MARKETING_URL + path)` cross-origin off
the app. A help entry there would be an ungated route out of the wall that bypasses the
PIN-gated Leave, which is the exact thing that gate exists to prevent, and under Guided Access
it either dies as a dead tap or strands a child on the marketing site. An unlocked-state-only
variant was offered as a compromise and also declined.

**Follow-up 2 — proceed.** greg:

> ok go ahead to write the help article and make the changes, can skip the wall lock link, no
> need a mockup. then go ahead to run the plan through /beanies-plan. once the plan is done
> proceed to implementation

**Follow-up 3 — review after.** greg:

> once implementation is complete, run a quick code review (probably does not need max) to
> ensure everything was done right, and fix any issues found

**Side note during the session.** greg flagged that he was running a separate session to push
the day's blog, so shared files (`CHANGELOG.md`, `docs/STATUS.md`) were pulled and re-read
before writing and staged by explicit path, never `git add -A`. See
`feedback_never_git_reset_concurrent_session`.

**Follow-up 4 — commit.** greg: "commit changes".

## Outcome

Shipped to `main` (undeployed). Full record in the plan; four review passes are logged there.

- New Help Center article `getting-started/set-up-the-beanie-wall`. Apple and Android blocks
  both unconditionally visible, never sniffed, because the reader is usually on their phone
  holding the tablet. Device menu paths verified against Apple, Google and Samsung support docs
  rather than written from memory.
- `WallSetupCard` gains a three-line platform-aware nudge plus a prominent help link.
- `isWakeLockSupported()` and `getDevicePlatform()` added to `src/services/sync/capabilities.ts`;
  `PwaReinstallModal` migrated onto the latter (it had the identical branch inline).
- `openHelpArticle` + `HELP_PATHS` extracted to `src/utils/helpLinks.ts`, with `CreatePodWelcome`
  migrated onto it and its existing tests passing unmodified.

**Three defects the review passes caught before they shipped:** `dark:text-primary-lift` (a token
that does not exist, would have rendered nothing on dark); repeated level-3 headings that would
have emitted duplicate DOM ids and duplicate TOC rows; and a proposed `CreatePodWelcome` import
cleanup that would have removed a `logEvent` import three other call sites still need, failing
three unrelated tests.

**Verified:** `npm run lint` exit 0, `type-check` clean, full unit suite 7358 passed / 601 files,
and the article rendered in a real Astro build (200, 12 unique heading ids, 12 distinct TOC rows,
listed on the category page and in `help-index.json`).

**Known weak point:** `PwaReinstallModal.vue` has no unit test, so its migration rests on
`getDevicePlatform()`'s own tests plus a manual UA walk that is still owed.
