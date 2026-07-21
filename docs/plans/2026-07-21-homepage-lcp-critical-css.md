# Plan: Homepage LCP — get Lighthouse green without changing how the beanstalk looks

> Date: 2026-07-21
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-21-homepage-lcp-critical-css.md`

## User Story

As a visitor landing on beanies.family from search or social, I want the page to paint quickly on a mid-range phone, so that I see the beanies and the value proposition before I lose patience — while greg keeps the decorative "three worlds" beanstalk exactly as designed.

## Context

`lighthouse-ci.yml` has failed on every PR since 2026-07-20 (green through 07-14). Root-caused 2026-07-21: a genuine homepage performance regression, not a build break.

An earlier diagnosis in `docs/STATUS.md` claimed a `unified is not a function` build break caused by a floating Node pin. **That was wrong** — it came from sampling one Lighthouse run which happened to be PR #289 (astro 5→7, which legitimately breaks `astro check`) and generalising. Corrected in STATUS; the Node hypothesis is withdrawn.

A partial fix already shipped to `main` (`6333c378`): `build.inlineStylesheets: 'always'` in `web/astro.config.mjs`. It removed both render-blocking stylesheets (2 → 0) and fixed the performance-score assertion (0.88 → 0.91, budget ≥0.90), but LCP only moved 3245ms → 3158ms against a 3000ms budget. **Lighthouse is still red, by ~158ms — and see the aggregation caveat below, which makes the true gap larger than that.**

Current CI measurements on `main` (`6333c378`), homepage only — blog and help pages score 0.99:

| Metric                     | Value        | Budget  | State    |
| -------------------------- | ------------ | ------- | -------- |
| `categories:performance`   | 0.91         | ≥0.90   | pass     |
| `largest-contentful-paint` | 3158ms       | ≤3000ms | **FAIL** |
| `cumulative-layout-shift`  | 0.018        | ≤0.1    | pass     |
| `total-blocking-time`      | 70ms         | ≤300ms  | pass     |
| `first-contentful-paint`   | 2.1s         | —       | —        |
| render-blocking resources  | 0            | —       | —        |
| DOM size                   | 717 elements | —       | pass     |

> **Read these numbers as best-of-three, not typical.** Verified in `node_modules/@lhci/utils/src/assertions.js:139`: LHCI's `aggregationMethod` defaults to `'optimistic'`, which for a `maxNumericValue` assertion takes the **lowest** of the three runs and for `minScore` the **highest**. So 3158ms is the friendliest of three runs and 0.91 likewise. The honest gap is therefore **larger than 158ms**, and `categories:performance` may already be under 0.90 at the median. Step 5b addresses this; every headroom target in this plan is stated against the _median_, not the optimistic value.

LCP element is the hero mascot `<img>` (`div.landing-page > section#top > div.hero__mascot > img`, `/brand/beanies_family_hugging_transparent_512x512.webp`, 46KB, already `fetchpriority="high"` and preloaded). Phase breakdown:

- TTFB 454ms (14%)
- Load Delay 0ms (0%)
- Load Time 160ms (5%)
- **Render Delay 2544ms (81%)**

The image transfer is not the problem and JS execution is not the problem (TBT 70ms, bootup 0.8s, DOM healthy). The cost is everything the main thread must do between receiving the document and being able to composite the mascot: parse ~193KB of HTML, parse and match ~112KB of CSS over 746 tags, and **raster the hero's paint effects**.

### Measured composition of the built homepage

`dist/index.html` is 193,226 chars: **111,708 chars of inline CSS** (a direct consequence of `inlineStylesheets: 'always'`) and ~81,500 chars of markup and inline script. Attributing the CSS by owner (brace-matched, via `data-astro-cid-*`):

| Owner                                                          | Inline CSS chars | Share |
| -------------------------------------------------------------- | ---------------- | ----- |
| Tailwind utilities + `@beanies/brand/theme.css` + `global.css` | 48,323           | 43%   |
| `web/src/pages/index.astro` scoped styles                      | 34,918           | 31%   |
| `web/src/components/WorldsBeanstalk.astro` scoped styles       | 19,652           | 18%   |
| `Footer.astro`                                                 | 6,965            | 6%    |
| `Nav.astro`                                                    | 1,849            | 2%    |

Of the Tailwind block, `@font-face` rules for all three families account for only **3,986 chars** (Outfit 722, Inter 2,029, Caveat 1,235), and Tailwind 4's legacy `@property` fallback for only **1,771 chars**. Neither is a meaningful lever.

Markup-side, excluding the style block the document is 81,503 chars, of which the beanstalk section is **20,139 chars spanning 204 of the page's 746 tags — 27% of the DOM**.

### What that means

The beanstalk (`WorldsBeanstalk.astro`, 655 lines) is **below the fold** (verified by construction — see Assumption 1), **scroll-driven** (nothing animates until the user scrolls), and both its images are already `loading="lazy"`. It contributes **19.7KB of CSS and 27% of the DOM** to first paint and needs none of it. Its **JavaScript is already off the critical path** — verified in `dist/index.html`, Astro emits it as `<script type="module" src="/_astro/WorldsBeanstalk.astro_astro_type_script_index_0_lang.bD17Twcx.js">`, an external deferred module. It shipped 2026-07-17 (#56: `e77bc9b7`, `67f2edd7`, `8101c3a6`, `1d226f04`) — exactly matching the green→red transition.

Separately, the hero itself carries expensive pre-paint work that has never been examined: `index.astro:28-30` renders three absolutely-positioned decorative circles, two with `filter: blur(100px)` and `filter: blur(80px)`, inside a `min-height: 100vh` hero (`:862`) — plus `filter: drop-shadow(0 12px 32px …)` on `.hero__mascot` itself (`:946-953`), which is the LCP element's own container. Large-radius blurs are among the most expensive raster operations on a 4×-throttled mobile CPU, and they must complete before the hero can be composited. This is a first-class suspect for the 2,544ms render delay and has the cheapest possible fix.

`@fontsource-variable/caveat` was also added by #56 and is imported bare in `BaseLayout.astro:15`, so **every page on the site** carries its `@font-face` rules. **Verified: Caveat is used in exactly one place — `WorldsBeanstalk.astro:385`.** (`guides/[...slug].astro:453` declares `--font-hand: 'Caveat', 'Caveat Variable', cursive` but nothing in the repo consumes `--font-hand`; it is dead code, and its family order would have fallen through to `cursive` anyway since fontsource registers `Caveat Variable`, not `Caveat`.)

greg's constraint, verbatim: _"I am fine to defer the beanstalk or do something to improve the performance as long as we can keep it as i like it as a decorative element"_ — the beanstalk may be deferred, lazied, or optimised, but must look and animate exactly as it does today.

## Requirements

1. `lighthouse-ci.yml` passes on the homepage: LCP ≤3000ms and performance ≥0.90, under the **explicitly declared** LHCI `aggregationMethod` (see Step 5b) — not by luck of a single favourable run. Since the current default is `optimistic` (verified), "passing today" is a weaker statement than it looks; the target is to pass at the **median**.
2. The beanstalk renders and animates **identically** to today: same visuals, same scroll-grown vine, same semi-circular mascot hop, same seed dock position, same timing curves, same reduced-motion behaviour.
3. No visual regression anywhere else on the marketing site — hero, features, FAQ, footer, blog, guides, help.
4. No FOUC (flash of unstyled content) on any section, including if a user scrolls fast to the beanstalk immediately on load.
5. CLS stays ≤0.1 (currently 0.018 — deferring rendering risks _raising_ this; it must be measured, not assumed).
6. Blog and help pages must not regress from 0.99.
7. The fix is verified with **CI** Lighthouse numbers, never local ones.
8. The beanstalk's existing runtime fail-safe (`renderStatic()` + guided `console.warn`) must remain intact and reachable.
9. **No new hand-maintained artefact.** Any derived asset must be regenerable by a checked-in script; any hard-coded measurement must either be self-correcting or labelled as an estimate that nobody is expected to maintain.
10. **All in-page navigation to `#features` continues to work**, from every entry point: Nav desktop (`Nav.astro:23`), Nav drawer (`:76`), hero jump-link (`index.astro:62`), Footer (`Footer.astro:12`), and — the riskiest case — a cross-page `/#features` fragment resolved by the browser at load time from any non-homepage.

## Important Notes & Caveats

- **Local Lighthouse on this host is unusable as a signal.** Three runs of identical code produced perf 0.81/0.85/0.92 and LCP 1813/3157/3161ms. Only `gh workflow run lighthouse-ci.yml --ref <branch>` counts. Local runs also litter `web/` with `C:\Users\...` junk directories (WSL path interop) and a `.lighthouseci/` dir — clean them before committing.
- **The gap is small but the margin must not be thin, and the reported gap understates it.** The 158ms figure is against the _optimistic_ aggregate. A fix that lands at 2950ms optimistic will flap red on runner variance and is probably already red at the median. Target meaningful headroom (~2700ms **at the median**, or better). **This is the single most important sustainability property of the whole plan** — a just-barely-green result is a deferred failure, not a fix. If the work lands green but with <300ms of median headroom, say so out loud and treat it as unfinished.
- **The lab number is a proxy; the field number is the truth.** `web/src/scripts/vitals.ts` already reports real-user `CWV LCP` (with Google's good/needs-improvement/poor rating) to Plausible from every page (`BaseLayout.astro:121`). Lighthouse CI is the _regression tripwire_; Plausible's LCP distribution is the _outcome_. Never let optimising the tripwire diverge from the outcome.
- **Deferring rendering can trade LCP for CLS — and for scroll stability.** Anything that lets the page paint before laying out below-fold content can surface layout shift and, with `content-visibility`, mid-scroll document-height changes. CLS is currently 0.018 with lots of headroom, but every candidate change must be checked against it _and_ against smooth-scroll behaviour.
- **`inlineStylesheets: 'always'` forfeits cross-page CSS caching** across a 91-page site. A repeat visitor re-downloads ~110KB of CSS per page instead of hitting cache. That is a real cost the current state has already incurred and this plan should revisit, not entrench.
- **Config-comment anti-rot rule (applies to every comment this plan writes).** The existing `astro.config.mjs` comment rotted because it stated measured numbers as timeless fact ("1510ms of render-blocking savings", "2707ms render delay") with no date and no provenance. Every comment this plan adds or replaces states **the decision, the date, and a pointer to the evidence** (CI run / plan file) — not a bare number that a future reader will trust indefinitely.
- **Do not weaken the thresholds as the primary fix.** greg was offered that and chose to optimise.
- **Do not deploy.** `deploy-web` is a separate explicit step; the live site is unchanged until greg asks.
- Lighthouse runs only on `pull_request` and `workflow_dispatch` (verified, `.github/workflows/lighthouse-ci.yml:7-15`), never on push to `main` — so `main` can silently regress. Worth addressing (see PR D) but it is a **separate concern** from the LCP fix and must not be conflated with it.
- Astro scopes component styles with `data-astro-cid-*` hashes. Any scheme that moves a component's styles out of the bundle must preserve that scoping or styles will not match the markup. This is the primary reason the plan prefers mechanisms that leave the bundle alone.
- `WorldsBeanstalk.astro` carries a **load-bearing-constants warning** in its header comment (lines 8-14): the SVG path, braid params, growth remap, seed dock/launch, leaf `data-frac` values and animation timings were tuned by eye against an approved mockup and must not be refactored in place. Nothing in this plan changes any of those values. Step 2 does add a defensive guard _inside_ `dockOffset()` — that guard changes no tuned constant, only the condition under which the existing computation is trusted.
- **Unexamined suspect, deliberately not a step: the third-party analytics fetch.** `BaseLayout.astro:104` loads `https://plausible.io/js/…` (`async`, third origin: DNS + TLS + fetch) and `:121` imports the `web-vitals` module, both inside the exact window where the 2,544ms render delay sits. TBT is only 70ms so this is not _execution_ cost, but connection setup and bandwidth contention on a throttled runner are plausible contributors. **If PRs A–B do not produce the required headroom, this is the next lever to investigate** (e.g. `preconnect`, or deferring the analytics fetch to `load`). Recorded here so it is not re-discovered from first principles in six months.
- **Considered and rejected: the above-the-fold `loading="lazy"` deco images** (`index.astro:24-26`). Lazy-loading above-fold images can delay them, but these render at 0.04–0.06 opacity, are not the LCP element, and are not on the LCP dependency path. Changing them is churn. Noted so a future reader does not re-open it.
- **Considered and rejected in Pass 4: shrinking the hero mascot asset.** See Step 1a — it is a net negative, and the reasoning is recorded there so nobody re-proposes it.

## Assumptions

> Review before implementation.

1. ~~The beanstalk section is below the fold~~ — **verified by construction, no longer an assumption.** `.hero` is `min-height: 100vh` (`index.astro:862`) and `<WorldsBeanstalk />` is its immediately following sibling (`index.astro:17`, `:393`). At Lighthouse's 412×823 mobile viewport the section therefore begins at scroll offset ≥823px. Confirming against the `full-page-screenshot` audit is still a cheap sanity check but Step 2's rationale no longer rests on it.
2. ~~Tailwind's output is reducible~~ — **retired, verified false.** Tailwind's legacy `@property` fallback is 1,771 chars and its `@property` block 4,064. Tailwind is already JIT-pruned and is not a lever.
3. ~~The `uses-responsive-images` saving is achievable without visible quality loss~~ — **retired, verified false.** See Step 1a: `.hero__mascot` is 180 CSS px at _every_ breakpoint (verified — the only other `.hero__mascot` rules are `index.astro:954` and `:1392`, and none of the three media queries at `:1325/:1397/:1405` touch it), but Lighthouse's mobile emulation uses DPR 2.625 and common phones use DPR 3, so the needed asset is 473–540px. The shipped 512px file is already correctly sized; shrinking it would degrade quality. The saving is not achievable.
4. Nothing outside the homepage depends on `index.astro`'s scoped styles. (`WorldsBeanstalk` is imported only by `index.astro:3`, confirmed.)
5. Astro 5.18's `inlineStylesheets` accepts `'auto' | 'always' | 'never'` and `'auto'` inlines below ~4KB (the pre-`6333c378` behaviour).
6. `content-visibility: auto` on the beanstalk section does not disturb its scroll-driven animation **once Step 2's `dockOffset()` guard is in place**. The failure mode is now understood and specific rather than vague (see Step 2), but the _absence of any other_ layout-dependent read must still be confirmed in a real browser before the step is accepted; abandon for the fallback if anything else is off.
7. ~~LHCI's `aggregationMethod` is implicit; confirm the default~~ — **resolved, verified.** `node_modules/@lhci/utils/src/assertions.js:139` reads `aggregationMethod = 'optimistic'` as the default. Step 5b now proceeds from fact rather than from a question.

## Approach

### Shipping units (read this before the steps)

The steps below are grouped into **four independently shippable PRs**. This grouping is the plan's answer to "what happens if someone stops midway": each PR is coherent, valuable and revertable on its own, and abandoning the plan after any PR leaves a clean state rather than a half-migration.

| PR                                   | Contains       | Coherent alone?                                                                                                                                  | Value if the rest is never done                                                                                                   |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **A — LCP fix**                      | Steps 1, 1a, 2 | **Yes — this is the minimum coherent shippable unit.** All three are pure homepage paint/critical-path reductions with no cross-cutting surface. | The stated goal: homepage green with headroom.                                                                                    |
| **B — Caveat scoping**               | Step 3         | Yes                                                                                                                                              | A latent correctness bug fixed (a font loaded on 91 pages when one component uses it) plus dead code removed, independent of LCP. |
| **C — `inlineStylesheets` decision** | Step 4         | Yes                                                                                                                                              | A config decision made on evidence, and a factually wrong comment removed.                                                        |
| **D — Gate hardening**               | Steps 5a, 5b   | Yes                                                                                                                                              | `main` regressions become attributable; the gate stops silently grading on best-of-three.                                         |

Within PR A the three steps are still **separate commits, measured separately** — so we learn which lever paid — but they merge together. Splitting A across PRs would ship a partially-optimised homepage that is still red, which is the worst state to leave behind.

**PRs B and C must not be blocked on A.** If A stalls (e.g. the beanstalk verification fails), B and C still ship. **PR D is hard-blocked on A** (see 5a and 5b) — tightening the aggregation while the page is red just installs a permanently-failing check.

Two principles govern every step:

- **Prefer a browser primitive over new machinery.** Where the platform already provides deferral (`content-visibility`, module scripts, native lazy loading), use it rather than writing an `IntersectionObserver` / async-CSS harness that must then be maintained and tested.
- **Do not add a fail-safe where one already exists.** `WorldsBeanstalk.astro:433-452,645-652` already degrades to a fully-rendered static beanstalk with a guided `console.warn` on any runtime error. The job is to keep that path reachable, not to build a second one.

### Step 0 — Establish a trustworthy baseline (no code change, no commit)

Dispatch Lighthouse on `main` twice and record LCP/perf/CLS **from all six runs** (three per dispatch), not just the aggregate. This quantifies CI run-to-run variance so later deltas can be distinguished from noise, **and it establishes today's median** — which is the number every later target is measured against, and which the current `optimistic` default has been hiding. Without this, a 158ms "improvement" is unfalsifiable. Record the numbers in the PR A description — this is the only place the variance figure needs to live, and it is dated by the PR itself.

### PR A — the LCP fix

#### Step 1 — Cut the hero's pre-paint raster cost (cheapest, highest suspicion, CSS-only)

This is the first move and it targets **paint cost**, which the earlier draft never examined.

`index.astro:28-30` renders three decorative blobs above the fold, two of them with `filter: blur(100px)` and `filter: blur(80px)` on 300×300 and 200×200 boxes. A large-radius CSS blur forces the compositor to raster a filter region substantially larger than the element, on the main thread, before first paint — on a 4×-throttled emulated mobile CPU this is routinely hundreds of milliseconds each. `.hero__mascot` (the LCP element's own container, `index.astro:946-953`) additionally carries `filter: drop-shadow(0 12px 32px …)` while running a continuous `mascotFloat` animation.

Change, in order of increasing intervention — stop at the first that clears the gap:

- **(a)** Replace the two blurred blobs' `background` + `filter: blur(N)` with an equivalent pre-baked `radial-gradient` (a blurred flat circle at 4-6% opacity is visually indistinguishable from a soft radial gradient, and rasters at effectively zero cost). These are inline `style` attributes on decorative `<div>`s with `aria-hidden` semantics — no markup or class changes needed, and no other element uses `.hero__deco` beyond `border-radius/opacity/position` (`index.astro:870`).

  **Fidelity note, so the visual check does not fail for the wrong reason:** `blur(100px)` spreads colour roughly 300px _beyond_ the element box, so the visible blob is far larger than its 300×300 div. A same-sized gradient box will obviously not match. The replacement must **enlarge the box to the blur's real visual extent** (roughly `size + 3×radius`, so ~900px for the 100px blur, ~600px for the 80px) and re-anchor its offsets, with the gradient stops tuned so the perceived centre position, radius and falloff are unchanged. `border-radius: 50%` becomes irrelevant once the gradient itself fades to transparent — leave the class alone rather than editing it, since it is shared.

- **(b)** If (a) is not enough, move `.hero__mascot`'s `drop-shadow` onto its own compositor layer or replace it with a `box-shadow`-on-a-pseudo-element approximation, so the LCP image's own paint is not gated on a filter pass.

Zero bytes change, zero DOM change, zero JS. Verify with a side-by-side screenshot of the hero at mobile and desktop widths — if the gradient is not visually indistinguishable, revert (a) and report rather than shipping a different-looking hero.

**Do not** apply the same treatment to `.ambient-orb` (`index.astro:1232`) or the beanstalk's `.orb--*` (`WorldsBeanstalk.astro:232-235`) in this step: they are below the fold and Step 2 removes their paint cost wholesale. Touching them here would be unmeasurable churn.

#### Step 1a — Make the hero image path unrepresentable-to-drift (and explicitly _not_ resize it)

**This step was substantially cut in Pass 4. What remains is the part that was actually valuable.**

**The resize is rejected on measurement.** `.hero__mascot` is `180px × 180px` at every breakpoint (verified: `index.astro:946-953`; the only other `.hero__mascot` rules are `:954` and the reduced-motion `:1392`, and none of the media queries at `:1325`, `:1397`, `:1405` override the box). But CSS pixels are not device pixels:

- Lighthouse's mobile emulation (Moto G Power profile) uses **DPR 2.625** → the device needs **472.5px** of image.
- Common real phones use **DPR 3** → **540px**.
- The shipped asset is **512px**, i.e. ~2.84× — squarely in the right range for both.

A 360px asset would therefore be **upscaled and visibly soft on the very device Lighthouse emulates**, and on most modern phones. It would trade a guaranteed quality regression for ~24KB off a phase (Load Time) that is 160ms of a 3158ms LCP — 5% of the metric, and the phase that is already demonstrably _not_ the bottleneck. And the audit it was meant to satisfy, `uses-responsive-images`, is configured as `"warn"` in `web/lighthouserc.json` — it has never gated anything.

Consequently, **dropped from this plan entirely**: the `DERIVED` size table in `scripts/convert-images.mjs`, the two new committed binaries (`_360x360.png` / `.webp`), and the "regenerates byte-identically" acceptance criterion (which was in any case unachievable — `sharp`/libvips output is not guaranteed stable across versions, so that criterion would have failed for reasons unrelated to correctness). This removes an entire workstream, two binary files, a script change and a false test from the plan. **Simpler is the point.**

_(Also verified while investigating, and recorded so it is not re-derived: `astro:assets` / `<Image>` / `<Picture>` appear nowhere in `web/`; the convention is raw files under `web/public/brand/` referenced by root-relative path. `web/src/lib/rehype-image-dims.mjs` applies to markdown images only. No mascot variant smaller than 512 exists. Introducing `astro:assets` for one image remains rejected: it adds a second parallel image convention, requires moving the asset out of `public/` (breaking the stable path `lcpImage` depends on), and buys `srcset` for an element rendered at one fixed size where `srcset` has nothing to choose between.)_

**What this step still does — the real defect, and it is a genuine silent-failure hazard.** The served path is written twice: `index.astro:13` (`lcpImage="/brand/beanies_family_hugging_transparent_512x512.webp"`, which `BaseLayout.astro:75` turns into `<link rel="preload" as="image" fetchpriority="high">`) and `index.astro:34` (`<img src="…">`). If they ever drift, the browser preloads a file it never uses, the LCP image loses its preload, and the _only_ signal is a Chrome console notice — Lighthouse's LCP silently gets worse with no failing assertion pointing at the cause.

Fix: hoist into a single frontmatter constant and pass it to both.

```
const HERO_MASCOT = '/brand/beanies_family_hugging_transparent_512x512.webp';
```

Add a short comment beside it recording **why 512 is the right size** — 180 CSS px display box (`index.astro:946`) × DPR 2.625–3 = 473–540 device px — so the next person who reads "512 for a 180px box" does not "optimise" it back down and reintroduce the softness this pass just rejected. Date the note and point at this plan file, per the anti-rot rule.

Keep `width="512" height="512"`, `fetchpriority="high"`, `decoding="async"` exactly as they are. Zero bytes change, zero visual change, one class of silent failure eliminated.

Expected LCP effect: **none.** Ship it as the correctness fix it is; do not attribute any of the gap to it.

#### Step 2 — Take the beanstalk off the critical path

The beanstalk contributes **19,652 chars of CSS and 204 of the page's 746 tags (27% of the DOM)** to a first paint that needs none of it. **Its JavaScript is already deferred** — verified in `dist/index.html` as an external `type="module"` script — so there is nothing to do there and no JS to "extract".

Preferred mechanism, in order — pick the first that works and verify no FOUC:

- **(a) `content-visibility: auto` + `contain-intrinsic-size` on the beanstalk's root `<section id="features" class="worlds">` (`WorldsBeanstalk.astro:72`, styled at `:228`).** One declaration in the component's existing `<style>` block. The browser then skips style, layout and paint for the section entirely while it is off-screen, and does the work automatically as it approaches the viewport — which is precisely the "render delay" symptom, and it removes the **markup, style, layout and paint** cost (including the three blurred `.orb` elements at `:232-235`), not merely the 19.7KB of CSS.

  Why this over anything hand-rolled: it needs no new file, no async-CSS trick, no `<noscript>` fallback, no `IntersectionObserver`, and no JS at all. It cannot FOUC (the content is styled the instant it is rendered, by the same inline stylesheet as today) and it works with JavaScript disabled. It is a single-line revert.

  **(a-i) MANDATORY companion change — without this, (a) ships a visible bug.**

  `content-visibility: auto` applies `contain: size layout style paint` while the subtree is skipped, so **descendants are not laid out and `getBoundingClientRect()` on them returns a degenerate rect**. The beanstalk's setup path depends on exactly that:

  - `WorldsBeanstalk.astro:633` calls `dockOffset()` during initial setup.
  - `dockOffset()` (`:521-527`) reads `stage.getBoundingClientRect()` and `seedSlot.getBoundingClientRect()` — **both elements are inside the section** (`#stage` at `:84`, `#seedSlot` at `:80`) — and writes the results into the `--bx` / `--by` custom properties that position the docked seed over its slot in the copy.
  - It is only recomputed on `resize` (`:622-626`) or on a re-dock _after_ a launch (`:548`). Since `docked` starts `true`, neither fires on a normal first visit.

  So with (a) alone, on every cold load the seed's dock offset is computed from zero-sized rects and the seed sits in the wrong place until the user resizes the window. That is silent, visual, and directly violates Requirement 2 — and it is exactly the kind of bug that would ship because "the animation still runs".

  **Fix — self-healing, ~4 lines, no new API dependency:**

  - In `dockOffset()`, if either rect is degenerate (`st.width === 0 || sl.width === 0`), set a module-scoped `dockDirty = true` and return **without writing** `--bx`/`--by` (writing garbage is worse than writing nothing — the existing CSS default is at least stable).
  - In `readScroll()`'s `!launched` branch, recompute if `dockDirty` is set, clearing it on a successful (non-degenerate) computation. `readScroll` runs from `onScroll → schedule → frame`, so by the time the user has scrolled anywhere near the section it has been rendered and the rects are real.

  This changes **no tuned constant** — it only makes an existing computation refuse to trust an invalid measurement and retry. It is browser-agnostic (unlike `contentvisibilityautostatechange`, which is not universally available) and it additionally hardens the component against any other zero-layout condition, e.g. a future `display: none` ancestor. Prefer it over the event-based approach for exactly that reason.

  **Use the self-maintaining form of the intrinsic size, with a _derived_ literal:**

  ```
  contain-intrinsic-size: auto 3000px;
  ```

  The `auto` keyword tells the browser to _remember the element's last actually-rendered size_ and use that on subsequent skips; the literal is only a first-paint estimate. This is deliberate and important for maintainability: a plain `contain-intrinsic-size: 1180px` measured in devtools today is a magic number that silently rots the first time the section's content or responsive layout changes, and nobody will remember to re-measure it. With `auto`, the placeholder self-corrects.

  **The literal is derived, not eyeballed** (Pass 4 correction — the earlier 1200px value was ~1800px too small, which would have caused a ~1.8k-pixel document-height jump the first time the section rendered). `.stage` has a **fixed** height of `2400px` (`:253`), raised to `2550px` at `≤780px` (`:395`); adding the intro block, payoff block and padding puts the mobile section at roughly **3000px**. Being a fixed CSS constant rather than content-driven, this is a sound estimate at both breakpoints and will not drift with copy changes.

  Comment it accordingly — **"first-paint estimate derived from `.stage`'s fixed height (`:253`/`:395`); the `auto` keyword makes the browser use the real measured size after first render. Do not treat this number as a measurement and do not maintain it."** If CLS moves at all, that is the signal the estimate is badly wrong; adjust once and move on.

  **Verification gate — all of the following, or abandon (a) for (b):**
  1. The scroll-grown vine, the mascot's semi-circular hop (arc and apex), the leaf sprouts, the seed's **docked position over its slot in the lede copy**, and the reduced-motion branch are bit-identical to today, on a **cold load with no resize** (this is the specific case (a-i) exists to protect).
  2. `#features` navigation works from **every** entry point: Nav desktop (`Nav.astro:23`), Nav drawer (`:76`), hero jump-link (`index.astro:62`), and Footer (`Footer.astro:12`). Note the homepage cases go through a JS handler — `Nav.astro:105-106` calls `el.scrollIntoView({ behavior: 'smooth', block: 'start' })` — so the section re-renders and grows from ~3000px to its real height _during_ the smooth-scroll animation. Confirm the scroll still lands on the section top and does not overshoot, undershoot, or stall.
  3. **The cross-page case, which is the riskiest and is easy to forget:** from `/blog`, `/help`, or any non-homepage, click the Footer/Nav `what's inside` link (which emits `/#features`, `Nav.astro:10`, `Footer.astro:12`). The browser resolves the fragment during page load, while the section is still skipped. Confirm it lands correctly. Repeat by pasting `https://…/#features` into a fresh tab.
  4. Browser find-in-page still locates text inside the section (Chrome activates `content-visibility: auto` subtrees for find-in-page, but confirm rather than assume), and the section's headings still appear in the accessibility tree.

- **(b) Fallback — move the beanstalk's styles into a separate stylesheet loaded asynchronously** (`media="print"` + `onload="this.media='all'"`, with a `<noscript>` link so it still styles with JS disabled). Adopt this **only if (a) fails verification**, and record why in the commit message. Its real costs, stated plainly so they are chosen knowingly: it requires preserving Astro's `data-astro-cid-*` scoping across the extraction, adds a new file under `web/src/styles/`, introduces the site's first async-CSS mechanism (there is currently none anywhere in `web/`), and re-opens a FOUC surface on fast scroll that (a) does not have. It also leaves 27% of the DOM on the critical path, so it is strictly the weaker fix even when it works. **If (b) is chosen, that is a long-term maintenance cost the site did not previously carry — say so explicitly in the PR description so the trade is visible to whoever reviews it.**

  Note that (b) does **not** need the (a-i) guard, since nothing is size-contained. Shipping the guard anyway is still worthwhile as defence in depth, but it is not load-bearing under (b).

- **(c) Rejected outright: gating on `IntersectionObserver` with a large `rootMargin` plus a `requestIdleCallback` fallback.** This is a hand-written reimplementation of exactly what `content-visibility: auto` does natively, with more code, more failure modes and a fallback path that would need its own error handling. If (a) is viable, (c) is duplication; if (a) is not viable, (b) is simpler than (c).

**Whichever is chosen, the section must be indistinguishable from today**, and `renderStatic()` must remain reachable on error. If no mechanism can guarantee that, stop and report rather than shipping a subtly different beanstalk; greg's constraint outranks the metric.

### PR B — Step 3: Load Caveat from the one component that uses it

`BaseLayout.astro:15` imports `@fontsource-variable/caveat` bare, so its `@font-face` rules are inlined into all 91 pages.

**Verified in Pass 4: Caveat is used in exactly one place — `WorldsBeanstalk.astro:385`** (`font-family: 'Caveat Variable', Caveat, 'Outfit', cursive` on `.root-note`). An earlier draft claimed a second usage in `guides/[...slug].astro:453`; that line only _declares_ `--font-hand: 'Caveat', 'Caveat Variable', cursive`, and grepping the whole repo for `font-hand` returns that declaration and nothing else. It is dead code. (It would also not have worked: fontsource-variable registers the family as `Caveat Variable`, and this stack lists bare `Caveat` first, so it would have resolved to `cursive`.)

That single-consumer fact makes the fix simpler than the earlier draft's:

- **Move the import into `WorldsBeanstalk.astro`'s frontmatter.** Astro bundles CSS imported from a component's frontmatter into whatever page includes the component, so the font ships on the homepage and nowhere else — automatically, with no cross-file coordination. **This is strictly better than importing it in `index.astro`:** the component that needs the font declares its own dependency, so the font cannot be lost if the component is ever reused elsewhere, and — importantly — the stale header comment problem disappears rather than being reworded. There is no longer any comment asserting a fact about another file, because there is no longer a cross-file relationship to describe.
- Delete the `Caveat`-referencing lines 15-16 from `WorldsBeanstalk.astro`'s header block (they say the font "is loaded in BaseLayout"), since the import sitting three lines below is now self-documenting.
- Remove `import '@fontsource-variable/caveat'` and its two-line comment from `BaseLayout.astro:13-15`.
- Delete the dead `--font-hand` declaration from `guides/[...slug].astro:453`. It references a font that will no longer be loaded on that page and that nothing consumes — leaving it is a trap for the next reader.
- Leave `outfit` and `inter` in `BaseLayout`: they are the site-wide body and heading faces (`global.css:9,29`) and every page uses them. Subsetting them per-page would be churn for nothing.

**Precedent:** the codebase already does per-consumer font loading for Fraunces — `@fontsource-variable/fraunces` is deliberately not in `BaseLayout` and is imported by the six pages that need it (`blog/index.astro:9`, `blog/[...slug].astro:21`, `guides/index.astro:9`, `guides/[...slug].astro:9`, `help/faq.astro:9`, `help/glossary.astro:9`) — all verified. This step follows that convention, pushed one level further down to the component, which is where the single consumer actually lives.

**No flash-of-fallback risk.** fontsource CSS is bundled into the page's stylesheet, which on the homepage is inlined into the document `<head>` exactly as today (`inlineStylesheets: 'always'`). The `@font-face` rules arrive at the same moment in the same way; only the _set of pages that carry them_ changes. On the 90 pages that lose Caveat, nothing rendered in Caveat, so there is nothing to flash.

**Expected value, measured and stated honestly:** the three families' `@font-face` rules total 3,986 chars of inline CSS, of which Caveat is 1,235. The woff2 files are never fetched unless a glyph is actually rendered, so this does **not** save network bytes on pages that don't use Caveat — only inline-CSS parse, and only on the 90 pages that are already at 0.99. It is a **correctness-and-cleanliness** step (the global import is simply wrong, and it removes dead code), not an LCP lever. Ship it on its own merits and do not expect it to close any part of the gap.

### PR C — Step 4: Reconsider `inlineStylesheets` with data

After PR A has landed and been measured, re-measure and decide between:

- **Keep `'always'`** if LCP now has comfortable median headroom — accepting the lost cross-page caching.
- **Revert to `'auto'`** if the shrunken critical CSS is small enough that two cacheable external stylesheets beat a fat inline blob, which also restores repeat-visit caching across the 91-page site.

Decide on measured CI numbers, not preference. **Replace the existing comment in `web/astro.config.mjs` either way** — it currently asserts a 1510ms saving and a 2707ms render delay that did not materialise (the actual delta was 87ms), and it must not be left in the codebase as fact.

Write the replacement per the **config-comment anti-rot rule**: state the decision, the date, and a pointer to the evidence (`docs/plans/2026-07-21-homepage-lcp-critical-css.md` and the CI run), and state the _condition under which the decision should be revisited_ (e.g. "revisit if the site becomes browse-heavy, or if critical CSS grows past ~40KB"). Do not restate a millisecond figure as a standing fact — that is precisely how the current comment became misleading.

### PR D — Make the gate meaningful and its meaning explicit

Ship 5a and 5b together; both are about the gate's trustworthiness, and neither touches site code. **Both are hard-blocked on PR A being green with median headroom** — 5b in particular tightens the gate and would go red immediately if landed early.

#### Step 5a — Run Lighthouse on `main`

Lighthouse never runs on `main` (`lighthouse-ci.yml:7-15` triggers on `pull_request` + `workflow_dispatch` only, verified), so `main` can regress silently — exactly what happened here between 07-14 and 07-20. Add `push: branches: [main]` with the same `paths` filter so a regression is caught at merge rather than discovered weeks later on an unrelated PR.

**Ordering constraint:** land this **only once the homepage is green with meaningful median headroom**. Enabling it while red just adds a permanently-failing check on `main`.

**Mitigating the "red main everyone ignores" risk — this is the actual maintenance hazard, and it needs a written rule, not good intentions.** Add to the workflow's existing comment header:

> This job runs on push to `main` for **attribution**: it tells us which merge caused a perf regression. It is not a merge gate (nothing can block a push that already happened). If it goes red on `main`: either the regression is real and gets fixed/reverted, or the budget is wrong and gets changed — in a PR, with the reasoning written down. **If it flaps red twice in a month without a real regression, that is a defect in the budget or the test, and fixing that takes priority over any feature work.** A check nobody trusts is worse than no check.

That rule is the difference between a signal and background noise, and it costs one comment block.

#### Step 5b — Stop grading on best-of-three

**Verified fact, not a question (Pass 4):** `web/lighthouserc.json` sets `numberOfRuns: 3` but no `aggregationMethod`, and `@lhci/cli@0.15`'s default is `'optimistic'` — `node_modules/@lhci/utils/src/assertions.js:139` reads `const {minScore, maxLength, maxNumericValue, aggregationMethod = 'optimistic'} = options;`, and `:65-66` shows `optimistic` selecting the _most favourable_ value for `max*` assertions.

The consequence is significant and was not visible in earlier drafts: **every number in this plan's baseline table is the friendliest of three runs.** The 3158ms LCP is the best run; the 0.91 performance score is the best run. The typical experience is worse, and `categories:performance` may already be below 0.90 at the median.

So this is not a cosmetic "declare what you inherit" change — **it is a real tightening**, and it must be treated as one:

1. **Measure first.** From the Step 0 baseline and PR A's final run, compute the median LCP and median performance score by hand from the three per-run values in the CI log. Do not set `aggregationMethod` until PR A demonstrably passes at the median.
2. **Then set it explicitly**: `"aggregationMethod": "median"` under `ci.assert` in `web/lighthouserc.json`. `median` is the right choice: stable against one unlucky run without being so strict that ordinary runner variance flaps the build (`pessimistic` would flap constantly on a shared GitHub runner).
3. **Reword Requirement 1** to match, and note in the PR description that the gate got _stricter_, so a future reader does not mistake a post-change red for a regression in the site.

If PR A cannot reach green at the median, that is important information, not a reason to skip 5b — it means the LCP fix is incomplete and the third-party-script lever (see Important Notes) should be pulled before declaring victory.

**Explicitly rejected — a second, tighter "canary" LCP budget at warn level.** It sounds right (fail at 3000, warn at 2700, so drift is visible before it is red) but **LHCI's `assertions` object is keyed by audit id, so one audit cannot carry two assertions at two levels**; `assertMatrix` splits by URL, not by severity. Recorded here so nobody spends an afternoon rediscovering this. The headroom requirement is instead enforced by (i) the acceptance criteria in this plan, and (ii) the **Plausible field-LCP trend**, which is the genuine early-warning signal and needs no CI change at all.

Note that `lighthouserc.json` is JSON and cannot carry comments; the _rationale_ for the budgets — and now for the aggregation choice — therefore lives in the workflow's YAML comment header and in this plan file, and any budget change must update it there. That constraint is worth stating once so the rationale does not end up nowhere.

### Explicitly out of scope

- Changing assertion thresholds as the fix (greg chose to optimise). Changing _how the threshold is aggregated_ (5b) is in scope — that is about the gate's honesty. Note it makes the gate stricter, not looser.
- Redesigning or visually altering the beanstalk, or changing any of its load-bearing tuned constants. (Step 2's `dockOffset()` guard changes none of them.)
- Resizing or regenerating the hero mascot asset (rejected on measurement — Step 1a).
- Adopting `astro:assets`, piecemeal or site-wide.
- Reducing Tailwind output (verified not a lever).
- Deferring or reworking the Plausible/`web-vitals` head scripts — documented as the next lever if PRs A–B miss, but not attempted here.
- Any Vue app change.
- Deploying.

## Files Affected

**PR A**

- `web/src/pages/index.astro` — hero blur→gradient paint fix at `:28-30` (Step 1); `HERO_MASCOT` const feeding both `lcpImage` (`:13`) and `<img src>` (`:34`), plus the dated comment recording why 512 is the correct size (Step 1a)
- `web/src/components/WorldsBeanstalk.astro` — `content-visibility: auto` + `contain-intrinsic-size: auto 3000px` on `.worlds` in the existing `<style>` block at `:228`; the `dockDirty` degenerate-rect guard in `dockOffset()` (`:521-527`) and its retry in `readScroll()` (`:543-551`) (Step 2a + 2a-i)
- _Only if Step 2 falls back to (b):_ a new `web/src/styles/worlds-beanstalk.css`

_(No new binary assets and no change to `scripts/convert-images.mjs` — both were cut in Pass 4.)_

**PR B**

- `web/src/components/WorldsBeanstalk.astro` — add `import '@fontsource-variable/caveat'` to frontmatter; drop the now-redundant Caveat lines from the header comment block (`:15-16`)
- `web/src/layouts/BaseLayout.astro` — remove the bare Caveat import and its comment (`:13-15`)
- `web/src/pages/guides/[...slug].astro` — delete the dead `--font-hand` declaration (`:453`)

**PR C**

- `web/astro.config.mjs` — revisit `build.inlineStylesheets`; replace the factually wrong comment per the anti-rot rule

**PR D**

- `.github/workflows/lighthouse-ci.yml` — add `push: branches: [main]`; extend the comment header with the escalation rule and the aggregation rationale
- `web/lighthouserc.json` — set `"aggregationMethod": "median"` under `ci.assert`

**Throughout**

- `docs/STATUS.md` — update the CI-health entry with the final outcome
- `CHANGELOG.md` — only if any user-visible change results (a pure perf win with identical visuals may warrant a brief "faster homepage" line)

## Observability Coverage

**Correction to an earlier draft of this plan:** it stated the Astro site emits no telemetry. That is wrong. `web/src/scripts/vitals.ts` is imported by `BaseLayout.astro:121` on **every page of the marketing site** and reports `LCP`, `INP`, `CLS`, `FCP` and `TTFB` to Plausible as `CWV <name>` custom events, carrying both the rounded value and web-vitals' good/needs-improvement/poor `rating`. This plan ships no new client code, but it is directly measurable in the field by an instrument that already exists.

That reframes the whole observability story, and it is the plan's answer to "is optimising to just under a threshold sustainable?":

- **Field LCP (Plausible) is the outcome; Lighthouse CI is the tripwire.** The lab number is a synthetic proxy measured on a shared GitHub runner with 4× CPU throttling; it exists to catch regressions at commit granularity. The Plausible `CWV LCP` distribution is what users actually experience. **If a future change makes the lab number green but the field distribution worse, the field wins.** Stating this explicitly is what stops the team from optimising the tripwire instead of the site.
- **This gives us a rate-limited, non-flapping early warning that a second lab assertion could not** (see Step 5b for why a warn-level canary budget is not expressible in LHCI). Field LCP drifting toward the "needs improvement" boundary is visible weeks before CI flips red, without any CI change and without any flake.
- **The lab signal is currently more optimistic than it looks, and Step 5b fixes that.** Grading on best-of-three means the tripwire only fires once _all three_ runs are bad — i.e. well after a regression has landed. Moving to `median` makes the tripwire report the typical case, which is what a tripwire is for.
- **Existing CI signal preserved**: `lighthouse-ci.yml` remains the diagnostic surface. Every run uploads full reports to `temporary-public-storage`, and the run log carries per-assertion expected/found values plus all three runs' values — which is exactly what made this root-cause possible today, and what makes the per-run median computable by hand in Step 5b.
- **CI signal improved (Step 5a + 5b)**: the `push: [main]` trigger closes the blind spot that let this regression sit undetected from 07-17 to 07-20, converting Lighthouse from "noticed incidentally on an unrelated PR" to "attributable to the merge that caused it".
- **Failure modes and how they are diagnosed blind**: a future homepage perf regression surfaces as a named failing assertion (`largest-contentful-paint` / `categories:performance`) on a specific commit, with the LCP element and its four-phase breakdown (TTFB / load delay / load time / render delay) in the uploaded report — the same trail used here to prove the image transfer was innocent and render delay was the cause. In the field, the same regression appears as a shift in the `CWV LCP` rating mix in Plausible.
- **The beanstalk's runtime fail-safe already exists and is not being rebuilt.** `WorldsBeanstalk.astro:433-452` defines `renderStatic()` — the fully-grown, all-revealed, un-animated state — and documents it as the shared path for both the reduced-motion branch and any runtime error. `:645-652` wraps setup in `try/catch`, calls it, and emits a `console.warn` carrying explicit developer fix guidance ("verify the SVG path `#vine-center` is present and `getTotalLength`/`getPointAtLength` are available"); `:446` emits a second warning on markup/script drift. **The requirement for this plan is that Step 2 keeps that path reachable and unchanged**, verified by forcing a throw in devtools and confirming the static beanstalk still renders with the warning. No new error-handling code is warranted or wanted.
- **A silent-failure class is closed by Step 2a-i, not opened.** The degenerate-rect guard means an invalid measurement produces _no write_ rather than a wrong write, and retries. That is the difference between "the seed is subtly in the wrong place and nobody can explain why" and "the seed is right, always". It also hardens the component against any future zero-layout ancestor, not just `content-visibility`.
- **Silent-failure defect being fixed, not introduced**: the duplicated hero image path (`index.astro:13` vs `:34`) is a live silent-failure hazard — drift makes the preload warm an unused file with no CI signal and no user-visible symptom beyond a slower LCP. Step 1a makes it structurally impossible via a single source of truth.
- **No new derived asset, so no asset-drift hazard to manage.** Pass 4 removed the 360px variant entirely; the plan now adds zero binary files and zero build-script surface.
- **Step 2a needs no `<noscript>` fallback** because `content-visibility` is pure CSS and degrades to "renders normally" in any browser that does not support it. If Step 2 falls back to mechanism (b), a `<noscript>` link becomes mandatory and is called out there.
- **No new `ALLOWED_CONTEXT_KEYS` entry and no store-declaration change**, since no new client context key ships. `docs/runbooks/native-store-submission.md` and `PrivacyInfo.xcprivacy` are untouched.

## Acceptance Criteria

**PR A**

- [ ] CI Lighthouse (`workflow_dispatch` on the working branch) passes with LCP ≤3000ms **and meaningful headroom at the median** — target ≤2700ms median, computed by hand from the three per-run values in the CI log, not read off the optimistic aggregate. Landing green only on the optimistic aggregate is reported as _unfinished_, not as success
- [ ] `categories:performance` ≥0.90 **at the median of all 3 homepage runs**, not merely at the best run
- [ ] CLS ≤0.1 (verify it has not risen from 0.018 — the `contain-intrinsic-size` estimate is the specific risk)
- [ ] Blog and help pages still ≥0.95 (currently 0.99)
- [ ] Hero visually unchanged after the blur→gradient swap, at mobile and desktop widths — including the blob's _visual extent_, not just its centre
- [ ] Hero image path exists in exactly one place in `index.astro`; preload target and `<img src>` provably identical; no "preloaded but not used" console warning; asset size still 512 and the comment explaining why is present
- [ ] `contain-intrinsic-size` uses the `auto <estimate>` form, the literal is ~3000px (derived from `.stage`'s fixed height), and it carries the "do not maintain this number" comment
- [ ] **Cold-load dock check:** on a hard reload with no resize, the seed is docked exactly over its slot in the lede copy — identical to production. This is the specific bug `content-visibility` would otherwise cause
- [ ] Beanstalk otherwise verified visually identical: scroll-grown vine, mascot hop arc and apex, leaf sprout order, timing, and `prefers-reduced-motion` behaviour all unchanged
- [ ] `#features` navigation verified from all five entry points: Nav desktop, Nav drawer, hero jump-link, Footer, **and a cross-page `/#features` fragment resolved at load time from a non-homepage**
- [ ] Find-in-page still locates text inside the beanstalk section; its headings still appear in the accessibility tree
- [ ] Beanstalk `renderStatic()` fail-safe still fires with its guided warning when setup is forced to throw
- [ ] No FOUC when scrolling immediately to the beanstalk on a cold load, and with JS disabled

**PR B**

- [ ] Caveat no longer imported in `BaseLayout`; imported in `WorldsBeanstalk.astro`'s frontmatter
- [ ] The homepage's `.root-note` payoff line still renders in Caveat (not the `cursive` fallback), verified in the built output
- [ ] `guides/[...slug].astro` renders unchanged after `--font-hand` is deleted (it was unreferenced — confirm by grepping for `font-hand` returning zero hits repo-wide)
- [ ] Build output confirms Caveat `@font-face` rules appear on the homepage and on no other page
- [ ] `WorldsBeanstalk.astro`'s header comment no longer asserts anything about which file loads the font

**PR C**

- [ ] `web/astro.config.mjs` comment states decision + date + evidence pointer + revisit condition, and contains no bare millisecond claim; the withdrawn 1510ms assertion is gone

**PR D**

- [ ] `push: [main]` landed only after PR A is green with median headroom
- [ ] `"aggregationMethod": "median"` set in `lighthouserc.json`, landed only after the branch was shown to pass at the median; Requirement 1's wording matches it; the PR description records that the gate got stricter
- [ ] Workflow comment carries the "two flaps in a month = fix the budget or the test" escalation rule and the aggregation rationale

**All PRs**

- [ ] `npm run build:web` clean; no `C:\Users\...` or `.lighthouseci/` junk committed
- [ ] `docs/STATUS.md` CI-health entry updated with the final measured outcome, replacing the "partial fix, still red" state
- [ ] Diagnostic coverage per **Observability Coverage** holds

## Testing Plan

1. **Baseline (Step 0)**: dispatch Lighthouse on `main` twice; record LCP/perf/CLS from **each of the six individual runs** to quantify variance and establish today's median. Put the numbers in the PR A description.
2. After **each commit** within PR A, on the working branch: `gh workflow run lighthouse-ci.yml --ref <branch>`, then extract LCP, perf, CLS, and the LCP phase breakdown from the uploaded report — recording the per-run values, not just the aggregate. Record the delta attributable to that commit. **A commit that buys less than the measured run-to-run variance is not a win — drop it rather than keeping it "just in case".** Carrying an unproven change forward is how a codebase accumulates unexplainable micro-optimisations. (Step 1a is exempt: it is a correctness fix with no expected metric movement and should not be dropped for failing to move one.)
3. **Hero visual verification (Step 1)**: screenshot the hero before and after the blur→gradient swap at 412px and 1440px widths and diff them. Check the blob's outer falloff specifically, not just its core. Any perceptible difference means revert and report.
4. **Cold-load dock verification (Step 2a-i)** — the highest-value test in this plan: hard-reload the homepage with cache disabled and **without resizing the window**, then scroll slowly to the beanstalk. Confirm the seed sits exactly over its slot in the lede line before it launches. Then repeat with `content-visibility` temporarily removed via devtools and confirm the two are identical. Repeat at 412px and 1440px, and after a mid-scroll resize.
5. **Visual verification of the beanstalk (Step 2)** — the constraint that outranks the metric: load the built site locally, scroll through the section slowly and quickly, and compare against the current production homepage side by side. Confirm the vine growth, the mascot's semi-circular hop (apex height and arc), the leaf sprout order and the descent speed are unchanged. Check `prefers-reduced-motion: reduce` still suppresses motion.
6. **Anchor navigation (Requirement 10)**: click `what's inside` from Nav desktop, Nav drawer, the hero jump-link and the Footer on the homepage — confirming the smooth scroll lands on the section top and does not overshoot as the section expands mid-animation. Then, from `/blog`, `/help/faq` and `/guides`, click the same link (which navigates to `/#features`) and confirm the browser lands correctly on a cold load. Repeat by pasting `/#features` into a fresh tab. Finally, Ctrl+F for a phrase that only appears inside the beanstalk and confirm the browser finds and scrolls to it.
7. **Fail-safe check (Step 2)**: force the beanstalk's setup to throw (e.g. rename `#vine-center` in devtools before script execution) and confirm `renderStatic()` still produces the complete static section and the guided `console.warn` still fires.
8. **FOUC / CLS check**: throttle to slow 3G, hard-reload, and immediately scroll to the beanstalk — confirm it is styled on arrival and that the scrollbar does not jump noticeably as the ~3000px placeholder is replaced by the real height. Repeat at a narrow and a wide viewport (the `auto` intrinsic size should absorb the difference after first render). Repeat with JavaScript disabled.
9. **Cross-page regression (PR B)**: build and spot-check a blog post, a guide, a help article, privacy and terms for unchanged appearance — `BaseLayout` is used by every page. Confirm the homepage payoff line still renders in Caveat, and grep the built output to confirm Caveat's `@font-face` appears on `index.html` only.
10. **Repeat-visit caching sanity (PR C, if it reverts to `'auto'`)**: confirm the CSS is emitted as a cacheable external file and shared across pages.
11. **Gate verification (PR D)**: after merge, confirm the `push` trigger actually fires on `main` and reports green under `median`; confirm the run log's assertion output reflects the median rather than the best run.
12. Final full CI: dispatch Lighthouse on each branch before merge and confirm green, then dispatch once more on `main` after merging PR A to confirm the merged result.
13. **Field follow-up (post-deploy, when greg deploys — not part of this plan's completion):** check the Plausible `CWV LCP` rating mix a week after release and confirm the field distribution moved in the same direction as the lab number. If it did not, the lab win was an artefact and this plan's conclusion needs revisiting.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from measured CI evidence — root-caused LCP to critical-bytes (2544ms render delay, 111KB inline CSS), ordered fixes cheapest-first with per-step measurement, and made greg's "beanstalk must look identical" constraint an explicit stop condition.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the codebase and corrected four wrong ones — no `astro:assets` pipeline exists, no smaller mascot variant exists, the beanstalk's JS is already a deferred external module, and no `faq.css` exists; replaced the invented async-CSS + `IntersectionObserver` machinery with the native `content-visibility: auto` primitive (which also removes 27% of the DOM, not just 19.7KB of CSS); pointed the Caveat fix at the codebase's existing per-page `fraunces` import pattern; recorded that the beanstalk's `renderStatic()` fail-safe already exists and must be preserved rather than duplicated; fixed the duplicated hero image path that could silently mis-target the preload; and added a new cheapest-first step targeting the hero's above-the-fold `blur(100px)` raster cost, which the draft never considered.
- **Pass 3 (Sustainability)**: Corrected the false "no telemetry" claim — `web/src/scripts/vitals.ts` already ships field CWV to Plausible on every page — and made field LCP the durable outcome signal with the lab number as a tripwire, which is the structural answer to optimising near a threshold; regrouped seven steps into four independently shippable PRs so stopping midway leaves a coherent state; replaced the hand-generated committed image with a regenerable `DERIVED` entry in the existing `scripts/convert-images.mjs`; made `contain-intrinsic-size` self-maintaining via the `auto` keyword instead of a devtools-measured magic number; made LHCI's `aggregationMethod` explicit and documented why a warn-level canary budget is not expressible in LHCI; added a config-comment anti-rot rule and a written escalation rule for a red `main`; and recorded the unexamined third-party-script LCP suspect as the next lever.
- **Pass 4 (Fresh-eyes sweep)**: Found and fixed a bug Step 2 would have shipped — `content-visibility: auto` size-contains the subtree, so `dockOffset()`'s setup-time `getBoundingClientRect()` on `#stage`/`#seedSlot` returns degenerate rects and mis-positions the docked seed on every cold load until a resize; added a self-healing guard and a cold-load acceptance test. Verified `aggregationMethod` defaults to `'optimistic'` (best-of-three), so the baseline understates the gap and Step 5b is a _tightening_ that must be measured before it is landed. Cut the 360px hero resize entirely — Lighthouse emulates DPR 2.625 and phones use DPR 3, so 512px is already correct and 360px would ship visible softness; this also deletes the `DERIVED` script table, two committed binaries and an unachievable byte-identical test. Corrected `contain-intrinsic-size` from 1200px to ~3000px, derived from `.stage`'s fixed 2400/2550px height. Found Caveat has one consumer, not two (`--font-hand` in guides is dead code), and moved the import into `WorldsBeanstalk.astro` itself, which dissolves the stale-comment problem instead of rewording it. Added the Footer and cross-page `/#features` fragment-on-load cases to the anchor verification, and a blur-extent fidelity note so Step 1's visual check cannot fail for the wrong reason. Upgraded "below the fold" from assumption to verified-by-construction.

## Prompt Log

> No GitHub issue created — approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial prompt (this thread, after the Lighthouse root-cause was reported)

> I am fine to defer the beanstalk or do something to improve the performance as long as we can keep it as i like it as a decorative element

### Preceding context that shaped it

> Can we address the lighthouse CI issues now?

and, on being offered "focused homepage perf pass" vs "raise the LCP budget", greg chose to optimise rather than weaken the threshold.

</details>

---
