# Plan: Dark mode remediation — a measured palette, an elevation ladder, and a lint gate

> Date: 2026-09-04
> Related: Discord early-adopter report (Brendan) — "dark mode makes text difficult to read
> in some places, specifically the recipe tab... text is gray"

## Context

An early adopter reported that dark mode was hard to read. Measuring every text/surface
pairing in the app turned "some places" into a number: **630 strings below the WCAG AA
4.5:1 floor**, and three surfaces where text was effectively invisible.

It was not one bug. Four causes, with different shapes, which is why it read as a general
malaise rather than a broken screen:

1. **Light-surface islands.** Cards that never got a dark variant stayed cream or white
   while the text on them switched to its dark colour. The cookbook page title sat at
   **1.02:1** — the same colour as the paper behind it. The nook's Milestones and Recent
   Activity cards were white slabs with 1.47:1 body text, on the app's own homepage.
2. **Deep Slate at partial opacity.** 49 places used `text-secondary-500/60` with no dark
   override. In light mode that is soft grey on white; in dark it composites Deep Slate
   over a Deep Slate ground and lands at **1.08–1.27:1**.
3. **A grey ramp borrowed from another palette.** 1,420 hand-written `dark:text-*`
   utilities reached for Tailwind's _grey_ while surfaces used its _slate_ — two hue
   families. 580 of them were below the floor (`gray-400` = 3.98 on the commonest card,
   `gray-500` = 2.14).
4. **No elevation ladder.** Five competing surface values, and `--color-surface` was
   defined but used zero times — so the same ink read fine on one card and vanished on
   the next.

Root cause of (3) was one line in the CIG: _"Keep existing Tailwind `dark:` prefix
pattern, swap in brand colors."_ It licensed 1,420 individual colour decisions and the
second half never happened.

## Approach

A measured semantic scale in `packages/brand/theme.css`, dark-values-only so light mode
is untouched. Four surfaces, three inks, two line weights, five lifted accents. Every ink
clears AA against **all four** surfaces, so a component can move up or down the ladder
without a fresh contrast review.

Shipped in five independently verifiable steps: fix the invisible ones; define the tokens
and convert the base components; codemod the ramp; give the light islands a dark
treatment; close the door with `vue/no-restricted-class`.

Two CIG rules were wrong and were rewritten: the `dark:` prefix instruction above, and
"use a muted `#E0551F` on dark" — darkening moves an accent _toward_ the background and
scored worse than leaving it alone. On dark you lighten.

## Outcome

Beyond the planned work, three defect classes were found only by looking at rendered
screens, and one by the review:

- **`:global(X) Y` silently drops `Y`.** Vue compiles `:global(.dark) .my-card` to
  `.dark { … }`, painting the declarations onto `<html>`. Live in **86 rules across 31
  components** — none of that dark styling had ever applied, including the one component
  cited everywhere as the correct example. Now written as plain scoped `html.dark .x`,
  which keeps scoping _and_ wins on specificity.
- **Undefined tokens.** `primary-900`, `secondary-900` and `cloud-white` were referenced
  by 14 utilities but defined nowhere, so selected pills kept their light background in
  dark mode (2.12:1). Added to the scale.
- **Opacity with no colour of its own.** `SummaryStatCard`'s subtitle inherited Deep Slate
  on two tiles and white on a third — which is exactly why "September 2026" was legible in
  the Net tile and invisible beside it.
- **Native shell drift.** Three hardcoded copies of the retired `#0F172A` (Capacitor window
  background, `values-night/colors.xml`, the PWA `theme-color`) now track `surface-ground`.

Verified by re-shooting all 18 screens at both widths and reading them, plus a light-mode
pass to confirm nothing moved before sunset.

## Files affected

- `packages/brand/theme.css` — the scale
- `src/style.css` — dark variable block, `.beanies-input`, scrapbook paper, celebration surface
- `eslint.config.js` — `vue/no-restricted-class` extended to every colour property
- ~300 `.vue` files — codemod onto the ladder
- `.claude/skills/beanies-theme/SKILL.md`, `docs/brand/beanies-cig-v2.html`, `docs/lessons.md`
- `src/composables/useNativeShell.ts`, `src/stores/settingsStore.ts`,
  `android/app/src/main/res/values-night/colors.xml` — native ground colour

---

## Addendum — beanie wall gate + tablet landscape (same session)

**Wall gate.** The wall needs room on BOTH axes, and it works in either orientation, so the
gate is deliberately not an orientation test. `(min-width: 600px) and (min-height: 600px)`.
A width-only threshold (the first attempt) was wrong twice over: an iPad mini in portrait
(744px) was refused a wall it renders perfectly well, and a phone held sideways (844x390)
was handed one it had no height to draw. Verified across 9 viewport shapes.

**Tablet landscape.** Android reads `R.bool.allow_rotation` (`values/` false,
`values-sw600dp/` true) in `MainActivity`; iPad was already correct in `Info.plist`; the
installed PWA releases its manifest lock at boot when `min(screen.width, screen.height)

> = 600`. Smallest-side is the load-bearing detail: a phone in landscape exceeds any
width-based tablet breakpoint, and the 2026-06-12 regression was phones rotating against a
locked OS setting. `useWallOrientation` now owns the policy and restores to the device's
> base orientation on wall exit rather than always portrait. 14 tests pin it.

Still needs an on-device check on a real Android tablet and an iPad; the native half cannot
be verified from here and needs new store builds to reach users.

---

## Follow-up — 2026-09-05: this pass created two bugs it could not see

Recorded here so this plan's Outcome is not read as "dark mode is finished".

greg reported white text on a yellow banner (scrapbook header) and an unreadable family
note on a recipe. Both were **produced by this remediation**, not missed by it. It added
`dark:text-ink` / `dark:text-ink-soft` to headings and captions app-wide, which is correct
on a `bg-white` card because the card has a `dark:bg-*` partner — but on a hand-painted
pastel (`bg-[#fff7c8]`, or an inline `style="background: linear-gradient(…)"`) the surface
has no dark partner and never switches. The ink went near-white and the paper stayed
yellow: **1.01:1**.

The blind spot was structural, not careless. A search for `bg-white` finds none of these
surfaces, and `vue/no-restricted-class` cannot see an arbitrary hex or an inline style. The
rule learned: **the ink and the surface under it are one unit of work**; a `dark:text-*`
added on its own is a half-change, and the missing half is the one that makes text vanish.

The follow-up sweep (`02f49910`) also found three `html.dark` rules that had never once
applied, an `opacity`-in-dark cluster across onboarding, ~120 accent sites with no `-lift`
partner, and a missing `silk-lift` token. It corrected a contrast figure this plan's
lineage had asserted from memory: Heritage Orange on `surface-ground` is 5.08, not 3.61.

See `docs/STATUS.md` (2026-09-05 block), `docs/lessons.md` (top entry), and CIG slides
08–09.
