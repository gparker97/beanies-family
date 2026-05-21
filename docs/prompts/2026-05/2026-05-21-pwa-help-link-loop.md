---
date: 2026-05-21
category: bug
issue: null
plan: none
tags: [pwa, standalone, help, marketing-site, redirect-loop, external-links, dry]
---

# PWA Help link redirect loop

## Prompts

**[~11:1x]** There's an issue opening the help page from the PWA — on browser, clicking Help in the sidebar or account-view dropdown opens the help center in a new tab, but on the PWA it throws the PWA into a loop. Investigate and fix.

**[approval]** Chose the two-layer fix (app-side `openExternal` helper + marketing-side `from-stale-pwa` loop backstop) over app-only / marketing-only.

## Outcome

Implemented on `main` (not yet deployed — touches **both** the Vue app and the Astro marketing site, so both surfaces need a deploy).

**Root cause:** an infinite cross-origin redirect ping-pong. The app opened Help via `window.open('https://beanies.family/help', '_blank', 'noopener,noreferrer')`, which in standalone display mode navigates the PWA window in-place (the opened context still reports `display-mode: standalone`). The marketing site's `BaseLayout.astro` "stale-PWA escape hatch" (#167) then `window.location.replace`s any standalone visitor to `app.beanies.family/help?from-stale-pwa=1`; the app router's `externalRedirect('/help/:pathMatch(.*)*')` immediately replaces back to `beanies.family/help` (before the app mounts and `useStalePwaNotice` can strip the param) → loop. In a real browser, `window.open` opens a `display-mode: browser` tab, the escape-hatch condition is false, and Help renders normally.

**Fix (two layers, defense in depth):**

- **App side (primary):** new `src/utils/openExternal.ts` — opens links via a transient out-of-scope `<a target="_blank" rel="noopener noreferrer">` click, which hands the navigation to the system browser (real `display-mode: browser` tab) on iOS/Android standalone PWAs, so the escape-hatch never fires. DRY across the three identical marketing-link call sites: `AppSidebar.vue`, `AppHeader.vue`, `WhatsNewModal.vue`. Security posture preserved (`noopener noreferrer`). `ShareChannelGrid.vue` left untouched (bespoke mailto / error-toast logic; its links don't trigger the loop).
- **Marketing side (backstop):** `BaseLayout.astro` now skips the redirect when `from-stale-pwa=1` is already present — converts a worst-case infinite loop into at most one bounce. The genuine stale-PWA launch hits the apex without the param, so it still bounces exactly once.

**Verification:** `openExternal.test.ts` (2 tests) green; `npm run type-check` clean; eslint clean on touched files; `npm run build:web` (`astro check && astro build`) green (61 pages). No existing tests asserted the old `window.open` behavior on the touched components.
