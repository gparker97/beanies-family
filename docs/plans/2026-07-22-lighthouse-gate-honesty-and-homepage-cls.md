# Plan: Make the Lighthouse gate measure what it claims, and fix the homepage CLS it was hiding

> Date: 2026-07-22
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-22-lighthouse-gate-honesty-and-homepage-cls.md`

## User Story

As the developer of beanies.family, I want the Lighthouse CI gate to fail only when the site actually regressed — and to fail when it _has_ regressed — so that I can trust a red check instead of re-running it, and so real Core Web Vitals defects stop reaching production unnoticed.

As a visitor landing on the homepage from search or social, I want the hero to stop jumping under my eyes as the fonts load.

## Context

`lighthouse-ci.yml` has been red on nearly every run since 2026-07-20. Yesterday's session (`docs/plans/2026-07-21-homepage-lcp-critical-css.md`) fixed a genuine LCP regression, but the gate stayed red and was recorded in `docs/STATUS.md` as "flaps on runner noise" — a blocker deferred for want of a quiet measurement environment.

That environment was available locally. Measured 2026-07-22 with Playwright Chromium 1228 against the static `web/dist` build, 5 runs, versus the CI job's 3 runs on `ubuntu-latest`:

| Metric     | CI (3 runs, one job) | Local (5 runs)                    | Budget | Verdict                               |
| ---------- | -------------------- | --------------------------------- | ------ | ------------------------------------- |
| TBT        | 434 / 435 / **1343** | 0 / 3 / 14 / 44 / 346 → median 14 | ≤300   | runner-CPU noise, not a site property |
| LCP        | 3157.9–3161.9        | 2634–2721                         | ≤3000  | stable, passing                       |
| CLS        | 0 / 0 / 0            | **0.1868 ×5, zero variance**      | ≤0.1   | **real defect, hidden by the gate**   |
| perf score | 0.60 / 0.65 / 0.85   | 0.79–0.86                         | ≥0.90  | unreachable until CLS is fixed        |

Only `index.html` fails. The blog and help URLs pass.

### Three distinct problems, only one of which is flakiness

**1. TBT and the composite performance score measure the runner, not the site.**
Lighthouse's simulated throttling scales observed main-thread work by a CPU slowdown multiplier derived from a per-run `benchmarkIndex` calibration. On a contended shared runner that calibration collapses and TBT inflates by up to ~30×. LCP is _network_-simulated, which is why its spread across the same three runs is 0.1% (3157.9–3161.9) while TBT's is 3× (434–1343). TBT and `categories:performance` (30% of which _is_ TBT) are the only CPU-derived assertions in the config, and they are the only unstable ones. The asymmetry is the whole signature.

The site's real blocking time is **~14ms**. The homepage ships 194KB of HTML and ~10KB of JS; there is nothing to block on. A 300ms budget asserted against a number that arrives with 30× multiplicative noise cannot distinguish pass from fail.

**2. The gate hides real regressions.**
`web/lighthouserc.json` sets no `aggregationMethod`, so LHCI defaults to `optimistic` — best-of-N. Verified at `node_modules/@lhci/utils/src/assertions.js:139` (`aggregationMethod = 'optimistic'` default) and `:65-67` (for a `maxNumericValue` assertion, `optimistic` takes `Math.min` of the runs). This is why CI reports homepage CLS as `0, 0, 0` while the metric is deterministically **0.1868** — nearly 2× budget — on every local run. The gate simultaneously flaps on noise and launders a genuine defect. Fixing the noise without fixing the aggregation would produce a gate that is quietly, confidently wrong.

**3. There is a real, fully-reproducible CLS defect on the homepage.**
One layout shift, `score 0.1868`, identical on all five runs. Lighthouse attributes it to `div.hero__deco` (`web/src/pages/index.astro:44`) with three sub-item causes, all `"Web font loaded"`: `outfit-latin-wght-normal.woff2`, `inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2`.

Mechanism, confirmed against the source:

- `web/src/layouts/BaseLayout.astro:11-12` imports `@fontsource-variable/outfit` and `@fontsource-variable/inter`. Both ship `font-display: swap` with **no fallback metric overrides and no preload**.
- `.hero` is `display: flex; flex-direction: column; min-height: 100vh` (`index.astro:870`). On Lighthouse's mobile emulation (412×823, DSR 1.75) the hero's content is **taller than 823px**, so the section's height is content-driven, not viewport-driven.
- **Ten** absolutely-positioned decorations inside `.hero` are anchored on **percentages of that content-driven height** — enumerated by reading lines 32-44 directly. (Pass 4 said seven, then nine; the count was wrong three times. The fix chosen below is count-independent, which is why it survived being wrong.)

  | Line | Element           | Content-height-dependent anchor |
  | ---- | ----------------- | ------------------------------- |
  | 32   | `.hero__bean`     | `top: 10%`                      |
  | 33   | `.hero__bean`     | `top: 25%`                      |
  | 34   | `.hero__bean`     | `bottom: 18%`                   |
  | 35   | `.hero__bean`     | `top: 60%`                      |
  | 36   | `.hero__bean`     | `bottom: 35%`                   |
  | 38   | `.hero__deco-img` | `top: 8%`                       |
  | 39   | `.hero__deco-img` | `bottom: 15%`                   |
  | 40   | `.hero__deco-img` | `top: 45%`                      |
  | 43   | `.hero__deco`     | `bottom: calc(10% - 300px)`     |
  | 44   | `.hero__deco`     | `top: calc(40% - 240px)`        |

- Fonts swap in → the hero section's height changes → all ten percentage anchors resolve differently → everything anchored to them jumps, the largest being a 680×680 decorative box. **NOTE: implementation proved this mechanism only partly right — see the Outcome section. The decos did ride the height change, but the dominant shift was horizontal, not vertical.**

**Three corrections made during review, all material:**

- The deco at **line 42 is not affected** — it is `right: -150px; top: -100px`, pure pixels. An earlier pass's "the three `.hero__deco` divs are anchored on percentages" was wrong.
- The horizontal percentages (`right: 5%`, `left: 4%`, …) resolve against _width_, which fonts do not change. They are not part of the defect and must not be touched.
- Conversely, the **seven `.hero__bean` / `.hero__deco-img` elements the early passes never mentioned are affected by exactly the same mechanism.** Lighthouse names only the largest contributor; the other eight shift in the same event. This is Assumption 1 made concrete, and it changes the shape of the fix (see Step 2).

The shift costs 25% of the performance score (CLS subscore 0.65). Even with TBT scoring a perfect 1.0 locally, the composite lands at 0.86. **The 0.9 threshold is unreachable at any noise level until CLS is fixed** — so the score assertion is not merely noisy, it is currently asserting something false.

### The deferred `inlineStylesheets` question is now settled

Commit `529ca220` explicitly deferred the `always` vs `auto` comparison, stating it "needs a quiet CI runner and we did not have one". Measured on the same quiet machine, back to back:

| Setting  | perf | LCP    | FCP    | TBT | CLS   | `dist/index.html` |
| -------- | ---- | ------ | ------ | --- | ----- | ----------------- |
| `always` | 0.86 | 2708ms | 2108ms | 14  | 0.187 | 194KB             |
| `auto`   | 0.84 | 2793ms | 2269ms | 0   | 0.187 | 82KB              |

`always` wins LCP by 85ms and FCP by 161ms — consistent with the 87ms figure `529ca220` corrected the record to, and it does not affect CLS either way. **Keep `always`.** This plan only replaces the "NOT YET RE-VALIDATED" comment block with a short conclusion plus a pointer to this plan file, so the open question is not re-litigated a third time.

### What already exists (reuse audit)

- **There is no `@font-face` fallback-metrics pattern anywhere in the repo.** The only hand-written `@font-face` reference in `web/`, `src/`, or `packages/` is the _comment_ at `web/src/components/WorldsBeanstalk.astro:25`.
- **The Caveat colocation in `WorldsBeanstalk.astro:23-28` is a real convention**: a face used by exactly one component is imported by that component; faces used by every page stay in `BaseLayout.astro`. `BaseLayout.astro:13-17` states the same rule from the other side.
- **The font stacks are hardcoded ~87 times, not centralised.** `grep` finds literal `'Outfit Variable', Outfit, sans-serif` / `'Inter Variable', Inter, sans-serif` stacks across 11 files (54 in `index.astro` alone, many in inline `style=` attributes). Only 3 sites use `var(--font-outfit)` / `var(--font-inter)` (`global.css:10,29`, `LegalLayout.astro:34`).
- **There are also non-conforming stragglers**: `web/src/pages/discord.astro:35` declares `font-family: Outfit, system-ui, sans-serif` (bare `Outfit`, _no_ `Outfit Variable` — this page never renders in Outfit today and would render entirely in any face registered under that name); `web/src/pages/plausible-exclude.astro:25` declares `'Outfit', sans-serif`; `404.astro` and `DraftPlaceholder.astro` use `var(--font-outfit, Outfit, sans-serif)`; `WorldsBeanstalk.astro:410` uses `'Caveat Variable', Caveat, 'Outfit', cursive`. **This is decisive for the name-overloading question — see Caveats and Step 2.**
- **`packages/brand/theme.css:54-55` is shared with the Vue app** (`--font-outfit: 'Outfit Variable', 'Outfit', sans-serif`, `--font-inter: 'Inter Variable', 'Inter', system-ui, sans-serif`). Not the seam for a marketing-site fix.
- **`web/package.json` has no scripts beyond `dev`/`build`/`preview`/`astro`**; the repeatable-local-recipe-as-npm-script convention lives in the **root** `package.json` (`store:screenshots`, `promo:record`, `translate`).
- **There is no marketing-site screenshot or visual-regression harness**, and the two Playwright configs that exist (`playwright.config.ts` → Vue app on :5173; `playwright.screenshots.config.ts` + `scripts/store-screenshots/capture.ts` → seeds a synthetic family through IndexedDB and mocks the photo CDN) are app-specific and not reusable. No third config is created.
- **LHCI config autodiscovery, verified at `node_modules/@lhci/utils/src/lighthouserc.js:13-24`**, in order: `.lighthouserc.cjs`, `lighthouserc.cjs`, `.lighthouserc.js`, `lighthouserc.js`, `.lighthouserc.json`, `lighthouserc.json`, `.lighthouserc.yml`, `lighthouserc.yml`, `.lighthouserc.yaml`, `lighthouserc.yaml`. **YAML configs are fully supported** — loaded via `js-yaml` at `:82`. This drives the config-format decision; see Step 3.
- **`aggregationMethod: 'median'` is real and top-level**, verified at `assertions.js:56-61` (true median of the per-run values) and `:426` (`const options = {aggregationMethod, ...assertionOptions}` — a top-level `assert.aggregationMethod` propagates into every assertion, and per-assertion options can still override it). Note `'median-run'` is a _different_ mode (`:427` — picks one representative run's LHR). We want `'median'`.
- **The config uses `preset: "lighthouse:no-pwa"`**, which supplies a large body of assertions beyond the 18 listed explicitly. Any reformat must carry the preset across verbatim; dropping it would silently delete most of the gate.
- **The CI step is `npx --workspace=web @lhci/cli@0.15 autorun`** while `web/package.json` pins `"@lhci/cli": "^0.15.1"` as a devDependency. The version is stated twice and the `npx` spec ignores the lockfile — a Requirement 11 violation on a line this plan already has to edit.

## Requirements

1. Every assertion in the LHCI config that remains at `error` must measure a property of the _site_, reproducible on a quiet runner, not a property of the CI machine.
2. The gate must stop reporting best-of-N. It must not be able to hide a defect that is present on every run.
3. Homepage CLS must come under the 0.1 budget, measured as a median over ≥5 local runs, without altering the hero's visual design in any way a reviewer would notice.
4. The `.hero__deco` gradient geometry warning at `index.astro:888-901` must be respected — the pre-baked radial gradients must not be reverted to `filter: blur()`, and their _internal_ geometry (box size, gradient stops) must not change. That comment constrains gradient derivation, not anchoring; re-anchoring is in scope, and the acceptance test is the screenshot diff.
5. Any threshold that is changed, demoted, or left in place must carry a one-line justification in the config **plus a pointer to this plan file** for the full measurement. The config is an index, not a second copy of the data.
6. No assertion may be weakened solely to turn CI green. Where a metric cannot be honestly gated in this environment, it is demoted to `warn` **with the reason recorded**, not deleted and not silently relaxed.
7. The `inlineStylesheets` comment in `web/astro.config.mjs` must record the settled conclusion and drop the "NOT YET RE-VALIDATED" language.
8. Local Lighthouse runs must stop creating junk directories in the repo — fixed at source, not only ignored.
9. **No font-family name may be given a meaning it does not have.** A fallback face must be registered under a name that says it is a fallback.
10. **No step may fail silently.** Specifically: a fallback `@font-face` that does not apply produces _no error and no visible difference_ — only a number that quietly fails to move; and a renamed LHCI config that is not found produces a run with different assertions. Both need an explicit positive check, not an inference from a null result.
11. **Every configuration value must have exactly one home.** No run count, dist path, URL list, threshold, or tool version may be stated in both the LHCI config and its callers.
12. **The LHCI config must remain declarative** — no `require`, no environment branching, no computed thresholds. A gate whose thresholds depend on where it runs cannot be reasoned about. Prefer a format in which this is _impossible_, not merely discouraged.
13. **Ship the smallest fix that clears the budget with headroom.** A second, riskier layer of fix is adopted only if the first is measured to be insufficient — not pre-emptively.
14. No production deploy. Deploy is manual-only and explicitly out of scope for this plan.

## Important Notes & Caveats

- **Do not revert the `.hero__deco` gradients.** `index.astro:888-901` documents that these boxes are derived geometry — each grown by 3σ per side from the original blurred div. Changing the anchoring is in scope; changing the box size or gradient stops is not.
- **Nine elements shift, not three, and one deco does not shift at all.** Early passes had this wrong in both directions. The fix must cover `.hero__bean` (×4) and `.hero__deco-img` (×3) as well as the two percentage-anchored `.hero__deco` divs, and must leave line 42 alone. Fixing only the decos would leave seven shifting elements behind and under-deliver.
- **Only the _vertical_ percentage anchors are implicated.** `right: 5%` / `left: 4%` resolve against width, which font loading does not change. Touching them is churn and risk with no benefit.
- **CI numbers in this plan are best-of-3, not typical** (optimistic aggregation). Once `aggregationMethod` changes, CI numbers will get _worse_ on paper without the site changing. That is the gate becoming honest, and it must not be mistaken for a regression. Record this in the commit message so a future session does not "fix" it.
- **The score threshold interacts with the CLS fix.** Do not decide the fate of `categories:performance` before CLS is fixed and re-measured — the current 0.86 is dominated by the CLS subscore (0.65). Sequence matters: fix CLS, re-measure, _then_ set the threshold.
- **Local absolute values differ from CI** because `benchmarkIndex` differs. Local measurement is authoritative for _comparisons on the same machine_ and for _variance_, not for predicting CI's absolute numbers. Do not set a CI threshold to a local absolute value without headroom.
- **The `Outfit`/`Inter` name-overloading shortcut is rejected. It is a trap.** The shortcut would register a metric-adjusted system face under the bare name `Outfit` on the theory that the slot is inert. It is not inert everywhere: `web/src/pages/discord.astro:35` declares `font-family: Outfit, system-ui, sans-serif` with no `Outfit Variable` entry, so that page would silently and permanently render in a system fallback instead of the brand face — a live visual regression, with no error channel and nothing in an early test plan that would catch it. `plausible-exclude.astro:25` and `WorldsBeanstalk.astro:410` are lesser instances of the same class. A shortcut whose blast radius the plan mis-enumerated on three consecutive passes is not one whose blast radius is known. Strategy A, _if_ it is needed, uses honest `'Outfit Fallback'` / `'Inter Fallback'` names.
- **A `local()`-only fallback face is platform-conditional.** `size-adjust`/`*-override` only take effect if `src` resolves. A face whose `src` is `local('Arimo')` does nothing on a machine without Arimo. The measurement machine (WSL Linux + Playwright Chromium) has a _completely different_ system font set from a typical Windows or macOS visitor, so **a green local CLS would not prove the fix works for real users.** This is the second reason strategy A is not the primary fix.
- **`font-display: optional` is a brand decision, not a perf decision.** It would zero the CLS by construction but means some visitors never see Outfit/Inter. Do not adopt it without greg's explicit sign-off.
- **Font preloading competes with the LCP image.** The hero mascot is already `<link rel="preload" as="image" fetchpriority="high">` (`BaseLayout.astro:77`). If preload is used at all it must be measured on both metrics, not assumed.
- **Do not touch `packages/brand/theme.css`.** It is imported by the Vue app as well as `web/`, so a homepage-CLS fix routed through it has a cross-application blast radius, and it would only reach 3 of ~90 font-family declarations on the marketing site anyway.
- **Do not pin a machine-specific Chrome path into a committed script.** `~/.cache/ms-playwright/chromium-1228/...` is both greg's WSL path and a version that changes on every Playwright bump. `CHROME_PATH` stays an _optional environment override_.
- **`100vh` is deliberate over `100dvh`.** `vh` is the large-viewport unit and does not change as mobile browser chrome hides on scroll; `dvh` does, which would reintroduce a shift on scroll. `.hero`'s `min-height` is already `100vh`, so this is consistent with what is there.
- Marketing site only (`web/`, Astro). English-first surface, **not** covered by the i18n lint rules — no `t()` work here.
- `web/.lighthouseci/` and `web/dist/` are already gitignored (`web/.gitignore:2,14`). The junk dirs are not.

## Assumptions

> **Review these before implementation.** They were valid on 2026-07-22 but may have changed.

1. **All nine percentage-anchored decorations shift in the same event.** Lighthouse names only `.hero__deco` (line 44) as the largest contributor; the enumeration above is derived from reading the source, not from Lighthouse output. If Step 2's measurement shows a residual shift after all nine are re-anchored, the remaining contributor is the hero's own flow content and strategy A becomes necessary.
2. The hero's content exceeds 823px on mobile emulation, so the section height is content-driven. Inferred from the deco's reported `boundingRect` (top 585, bottom 1265, extending past the 823px viewport) plus `min-height: 100vh`. If content ever fits within 100vh the mechanism changes to flex re-centering and the fix differs — re-verify if the hero copy is shortened.
3. `@fontsource-variable/*` continues to ship `font-display: swap` with no metric overrides. A dependabot bump could change this; re-check `node_modules/@fontsource-variable/outfit/index.css` if results diverge.
4. `@lhci/cli` 0.15.x's YAML config loader (`lighthouserc.js:82`, `js-yaml`) accepts the same object shape as the JSON loader. Verified by reading the loader — it parses and hands off to the same normalisation path — but confirm empirically by checking the first run's job log echoes the config filename and the assertion set is unchanged.
5. A recent Chrome/Chromium is available locally. The _same_ binary must be used across an A/B comparison; the plan does not pin a version.
6. The three URLs in the LHCI config are still representative of the site's page archetypes (homepage / blog post / help article).

## Approach

Sequenced deliberately: **fix the real defect first, then set thresholds against the fixed site.** Setting thresholds first would bake today's defect into the budget.

### Step 0 — Make the local measurement one command, and stop polluting the repo

A Windows-style `TMP`/`TEMP` leaks into this WSL shell, so Chrome creates throwaway profile directories literally named `web/C:\Users\gpsp2\AppData\Local\lighthouse.<n>`. Thirteen exist right now.

- **Add an `lhci:local` script to `web/package.json`**, following the root package.json convention for repeatable local capture recipes. Its entire job: set `TMPDIR=/tmp`, name the config explicitly, run `autorun`. Roughly `TMPDIR=/tmp lhci autorun --config=./lighthouserc.yml`.
  - **It must not restate `numberOfRuns`, `staticDistDir`, the URL list, or the CLI version** (Requirement 11). Those live in the LHCI config and the lockfile and are inherited.
  - **`CHROME_PATH` is an optional environment override**, prefixed at the call site: `CHROME_PATH=… npm run --workspace=web lhci:local`. Record the path used in the measurement notes, not in `package.json`.
- Every testing step below invokes `npm run --workspace=web lhci:local`, so the command string exists in exactly one place and `TMPDIR` cannot be forgotten. **This is the actual remedy for the junk directories**; the gitignore entry is only a backstop.
- **Delete the existing junk dirs safely.** A bare `rm -rf 'web/C:\Users\...'*` glob silently deletes a _literal_ path if nothing matches — use `find web -maxdepth 1 -name 'C:*' -print -exec rm -rf {} +` and check the printed list. Never run an unbounded `rm -rf` with an unexpanded glob.
- **Add `C:*` to `web/.gitignore`**, next to `.lighthouseci/`, with a one-line comment naming the WSL `TMP` cause.

### Step 1 — Make the gate honest about aggregation

In the LHCI config (still `.json` at this point — the format change is Step 3, and keeping them separate keeps each commit's effect attributable):

- Add `"aggregationMethod": "median"` to the `assert` block (`'median'`, _not_ `'median-run'`). Verified to propagate to every assertion via `assertions.js:426`.
- Raise `numberOfRuns` 3 → 5 in `collect`. Median of 5 is materially more stable than median of 3, and the job is short (~2 min). Because `lhci:local` inherits the config, this is the only place the number appears.

Own commit. **Expect CI numbers to get worse and CLS to start failing** — that is the point, and it is the proof the change worked.

### Step 2 — Fix the homepage CLS at source

Four candidate strategies:

| #   | Strategy                                                                                         | Blast radius                                                      | Addresses                                        |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------ |
| B   | Re-anchor the nine percentage-anchored hero decorations onto a font-independent containing block | Homepage hero only, deterministic                                 | The cause of the reported shift, structurally    |
| A   | Honestly-named `@font-face` metric-override fallbacks wired into the stacks                      | All 91 pages, platform-conditional, requires stack centralisation | The residual: the hero's own flow-content reflow |
| C   | `<link rel="preload">` the two critical woff2 files                                              | All 91 pages, + LCP risk                                          | Removes the swap window                          |
| D   | `font-display: optional`                                                                         | All 91 pages, brand                                               | Eliminates swap entirely                         |

**B ships first and unconditionally. A ships only if B is measured to be insufficient** (Requirement 13). Reasons:

- B is a genuine structural defect fix in one file, deterministic, with no cross-platform dependence. Anchoring decorations off percentages of a _content-driven_ height couples decorative geometry to text metrics — it will shift again whenever the hero copy, font size, or breakpoint changes, entirely independently of fonts.
- A is the systemic layer, but it is platform-conditional, it cannot be validated on the measurement machine alone, and — now that the name-overloading shortcut is off the table — it requires centralising ~87 hardcoded stacks first. That is a large, correct, but _separable_ piece of work. Shipping it pre-emptively, before knowing whether B already clears the budget, is over-engineering.
- Assumption 1 says B may not be enough. Measurement, not speculation, decides.

**C and D remain in reserve.** C must be measured against LCP, not just CLS. D requires greg's sign-off (brand).

#### Implementation of B — remove the content-height coupling

Preferred form, **one edit covering all nine elements**:

- Wrap the nine percentage-anchored decorations (`index.astro:33-36, 38-40, 43-44`) plus the fixed-position deco at line 42 in a single `<div class="hero__deco-layer">` placed where they are now — before `.hero__mascot`, so paint order is unchanged.
- Style it `position: absolute; top: 0; left: 0; right: 0; height: 100vh; pointer-events: none;` — **no `overflow` property**; `.hero` already has `overflow: hidden` and continues to do the clipping.
- Every child's percentage now resolves against the layer's `100vh` (absolutely-positioned elements resolve percentages against the nearest _positioned_ ancestor's padding box), which font loading cannot change. **No per-element value is recomputed and no inline style is edited** — the nine percentage values stay exactly as written.

Consequence to accept explicitly: the blobs will sit at slightly different absolute offsets than today, because `60%` now means 60% of 823px rather than 60% of the ~1265px content height. They are 0.04–0.06-opacity decorative blurs; the acceptance test is a before/after screenshot at mobile and desktop with greg's eye on it, not pixel identity. **Get that sign-off before committing.**

Fallback form, if sign-off is withheld: convert each of the nine vertical percentages to the equivalent `vh` value computed against the current content height, preserving positions exactly. Nine edits instead of one, nine magic numbers instead of zero, and the same fragility returns the next time the copy changes — hence not preferred.

- **Extend the comment block at `index.astro:888-901`** with one line: decorative absolutes must be anchored to a viewport-sized layer, never to the hero's content-driven height, because font swap changes that height and every percentage anchor with it. This keeps a future reader from "tidying" the layer away.

#### Implementation of A — only if B leaves CLS above 0.05

Two commits, in order:

1. **Centralise the font stacks.** Mechanically replace the ~87 literal `'Outfit Variable', Outfit, sans-serif` / `'Inter Variable', Inter, sans-serif` occurrences with `var(--font-outfit)` / `var(--font-inter)`. This is a fixed-string substitution, verifiable by `grep -c` dropping to zero, and semantically a no-op today (`theme.css:54-55` defines the identical stacks; the only difference is `--font-inter` also carries `system-ui`, which is inert once a fallback face resolves). Handle the stragglers individually: `discord.astro:35`, `plausible-exclude.astro:25`, `404.astro`, `DraftPlaceholder.astro`, `WorldsBeanstalk.astro:410`. Screenshot-diff the homepage and one guide page to confirm nothing moved.
2. **Add the fallback faces.** In `web/src/styles/global.css`, immediately after the `@beanies/brand/theme.css` import: two `@font-face` blocks named `'Outfit Fallback'` and `'Inter Fallback'`, plus a web-only `:root` override appending each to `--font-outfit` / `--font-inter`. `packages/brand/theme.css` and the Vue app are untouched.
   - **Derive the metrics, do not guess them.** Compute `size-adjust` / `ascent-override` / `descent-override` / `line-gap-override` from each web font's own metrics (`unitsPerEm`, ascender, descender, lineGap, average glyph advance) against the chosen system fallback's, or generate them with a tool. Hand-tuned magic numbers with no derivation are exactly what `index.astro:888-901` warns against.
   - **The `local()` list must be a cross-platform chain**, covering the common metric-compatible faces across Linux / macOS / Windows (e.g. Arimo, Liberation Sans, Helvetica Neue, Segoe UI, Roboto). A single-entry `src` produces a fix that is green locally and absent in production.
   - Short comment block above the faces: (a) what they are for; (b) the derivation inputs and tool, so the numbers can be recomputed on a font bump; (c) a pointer to this plan file. Keep numbers and tables in the plan file, not duplicated here.

**Verification that the faces are actually live (Requirement 10).** Before drawing any conclusion from CLS:

- `document.fonts.check('1em "Outfit Fallback"')` and `'1em "Inter Fallback"'` return `true` after the change (and `false` before — capture both).
- The same probe on **one non-Linux browser** (Windows or macOS Chrome), to prove the `local()` chain resolves for real visitors.
- `getComputedStyle(document.querySelector('.hero__headline')).fontFamily` lists the fallback family.
- With the woff2 requests blocked, the headline renders at _the same_ box size as with fonts loaded.

If any is false, **stop and fix the face** — a null result from an unverified `@font-face` is uninterpretable, and this is the plan's designed-in silent failure.

### Step 3 — Re-measure, then set thresholds against the fixed site

Only after Step 2 is green locally:

1. Re-run `npm run --workspace=web lhci:local`. Confirm median CLS is comfortably under 0.1 (target ≤0.05) and LCP/FCP did not regress. Record the new median performance score.
2. Decide each assertion's disposition against evidence:
   - `cumulative-layout-shift` — **stays `error` at 0.1.** Proven zero-variance; now proven fixable.
   - `largest-contentful-paint` — **stays `error` at 3000.** 0.1% spread across runs.
   - `categories:seo` — stays `error`. Not perf-sensitive.
   - `total-blocking-time` — **demote to `warn`.** One-line justification inline: real value ~14ms, CI readings 434–1343ms, i.e. the assertion's noise floor exceeds its budget by 4×. A `warn` still surfaces a genuine 10× regression in the log. Note explicitly that this is _not_ a relaxation: the 300ms budget number is unchanged, only the severity.
   - `categories:performance` — **decide from the post-fix measurement.** ≥0.93 (≥3pts headroom) → may stay `error`; 0.90–0.93 → `warn`, because a composite carrying 30% TBT weight inherits TBT's noise. Do not move the 0.90 number itself.
3. **Convert `web/lighthouserc.json` → `web/lighthouserc.yml`.** Requirement 5 is unsatisfiable in JSON — that is precisely how the `inlineStylesheets` rationale went stale.
   - **YAML, not CJS.** A `.cjs` config would need a header comment asking future editors not to use `require`, `process.env`, or conditionals. **YAML makes that impossible by construction** rather than by convention, which is the strictly more robust way to satisfy Requirement 12. It also gets the one thing CJS was wanted for — comments — and avoids the `"type": "module"` / `.cjs` extension footgun entirely. The repo already uses YAML for every workflow, so no new format is introduced. Loader confirmed at `@lhci/utils/src/lighthouserc.js:82`.
   - **Comments are one line each plus a pointer to the plan file.** Do not paste the measurement tables in — a second copy of the numbers is a second thing to go stale.
   - **Carry `preset: lighthouse:no-pwa`, the full URL list, `staticDistDir`, and `upload.target: temporary-public-storage` across verbatim.** Diff the effective config by comparing the assertion list printed in a local run before and after the conversion — do not eyeball it.
   - **`git rm` the old `lighthouserc.json` in the same commit.** `.json` outranks `.yml` in the discovery order, so a leftover `.json` would silently keep winning while the `.yml` looks authoritative. Two configs is the silent failure here, not a missing one.
4. **Update the CI invocation** in `lighthouse-ci.yml`: `npx --workspace=web lhci autorun --config=./lighthouserc.yml`. Two changes, both earning their place — the explicit `--config` turns a future rename or typo into a loud "config not found" instead of a run whose assertions quietly changed; dropping the `@lhci/cli@0.15` spec makes the lockfile the single source of the tool version (Requirement 11), which it already claims to be via the `^0.15.1` devDependency. Confirm the job log names the file.

### Step 4 — Record the settled `inlineStylesheets` conclusion

In `web/astro.config.mjs`, replace the "NOT YET RE-VALIDATED against 'auto'" paragraph (lines ~33-40) with **two or three lines**: measured 2026-07-22 on a quiet machine, `always` wins LCP by 85ms and FCP by 161ms, CLS unaffected, cacheability trade-off accepted; full table in this plan file. Leave the setting unchanged. Keep the existing correction about the 1510ms-vs-87ms estimate — it is the reason the comment exists. Do not grow the block; a source file accumulating measurement history is how it went stale the first time.

### Step 5 — Follow-up, only if A was not needed

If B alone cleared the budget, strategy A's stack centralisation was not performed. In that case, open a tracker issue to centralise the ~87 hardcoded font stacks onto `var(--font-outfit)` / `var(--font-inter)` — noting that it is the prerequisite for any future site-wide font-loading work, and that `discord.astro:35` / `plausible-exclude.astro:25` are non-conforming stragglers needing individual judgement.

If A _was_ needed, the centralisation shipped as part of it and this step is a no-op — say so in the commit rather than filing a redundant issue.

## Files Affected

- `web/lighthouserc.json` → **replaced by** `web/lighthouserc.yml` (aggregation, run count, severities, one-line justifications). The `.json` is deleted, not left behind.
- `.github/workflows/lighthouse-ci.yml` (explicit `--config=./lighthouserc.yml`; drop the duplicated `@0.15` version spec)
- `web/package.json` (new `lhci:local` script — the single source of the local measurement recipe; carries no config values)
- `web/src/pages/index.astro` (new `.hero__deco-layer` wrapper around lines 33-44; one line added to the comment block at 888-901)
- `web/astro.config.mjs` (`inlineStylesheets` comment only; setting unchanged)
- `web/.gitignore` (defensive `C:*` entry with cause noted)
- `docs/plans/2026-07-22-lighthouse-gate-honesty-and-homepage-cls.md` (this plan — the canonical record for every measurement referenced elsewhere)
- `docs/STATUS.md` (record the outcome; retire the "flaps on runner noise" blocker)
- `CHANGELOG.md` (user-visible: the homepage stops shifting as fonts load)

**Only if strategy A proves necessary:** `web/src/styles/global.css` (two honestly-named fallback `@font-face` blocks + a web-only token override) and the ~11 files carrying hardcoded font stacks (mechanical `var(--font-*)` substitution).

**Explicitly NOT touched:** `packages/brand/theme.css` (shared with the Vue app, and reaches only 3 of ~90 stacks); `web/src/layouts/BaseLayout.astro` (the fontsource imports and the LCP preload are correct as they stand); `playwright.screenshots.config.ts` / `playwright.config.ts` (app-specific — no third config is created).

## Observability Coverage

This change adds **no client runtime code paths** — it is a CI configuration change plus a CSS layout fix on the Astro marketing site. The marketing site is a separate origin from the Vue PWA and does not link `logEvent`/`reportError`/`perfTiming`; there is no `surface` to add and no new `context` key, so **no `ALLOWED_CONTEXT_KEYS` or store-declaration update is required.**

What the work must nonetheless leave observable:

- **The regression signal itself is the deliverable.** The Lighthouse gate _is_ this surface's observability. Today it is a broken instrument: it fires on runner weather and stays silent on a real 0.187 CLS. Steps 1–3 restore its ability to distinguish signal from noise. Success criterion: a deliberately-introduced layout shift makes the gate fail (Testing Plan step 8) — the equivalent of "emit on the failure path".
- **Success-path signal.** LHCI already uploads full reports to `temporary-public-storage` on every run, so passing runs publish their numbers, not just failing ones. Preserve this verbatim through the format conversion; dropping it during a reformat is a silent loss of the only historical record.
- **No silent failures in the gate.** Demoting TBT (and possibly `categories:performance`) to `warn` must _not_ mean losing the number. `warn`-level assertions still print their value and `all values:` spread in the job log every run. Confirm this in CI — if a demoted assertion goes fully silent, that is a silent failure and the disposition must change.
- **No silent failures in the fix.** Strategy B's failure mode is visible by construction (the blobs move, and the screenshot diff catches it). Strategy A's is not — CSS has no error channel, so the `document.fonts.check` probes on two platforms, the computed stack check, and the blocked-font box-size check are what convert "CSS that may or may not be doing anything" into a verified state. The `--config=` flag and the deletion of `lighthouserc.json` do the same job for the config.
- **One canonical record, with pointers.** This plan file holds the measurements. `lighthouserc.yml` and `astro.config.mjs` carry a one-line reason plus a pointer to it. A future session must be able to see _why_ a threshold is what it is without re-deriving it — and must not find three divergent copies of the same table.

## Acceptance Criteria

- [ ] Homepage median CLS ≤0.05 over 5 local runs (real headroom under the 0.1 budget, not a hairline pass)
- [ ] Homepage median LCP and FCP have not regressed versus the pre-change baseline (LCP 2708ms, FCP 2108ms)
- [ ] All nine content-height-dependent anchors in the hero (lines 33, 34, 35, 36, 38, 39, 40, 43, 44) resolve against a font-independent containing block; line 42's fixed-pixel anchors and every horizontal percentage are unchanged
- [ ] The comment block at `index.astro:888-901` records why decorative absolutes are not anchored to the hero's content height
- [ ] The hero is visually acceptable at mobile and desktop widths, signed off from a before/after screenshot pair — not by reading the CSS
- [ ] `aggregationMethod: median` and `numberOfRuns: 5` in effect, each stated exactly once in the repo
- [ ] `cumulative-layout-shift`, `largest-contentful-paint`, `categories:seo` remain `error`; each carries a one-line justification plus a pointer to this plan
- [ ] `total-blocking-time` demoted to `warn` with the noise measurement recorded; its 300ms budget number unchanged
- [ ] `categories:performance` disposition decided from the post-fix median per the Step 3 rule, with the number recorded
- [ ] `web/lighthouserc.json` is deleted; `lighthouserc.yml` is the only config and preserved `preset`, `staticDistDir`, the URL list and `upload.target` — verified by diffing the printed assertion list before and after conversion, not by eye
- [ ] The workflow names the config explicitly and no longer duplicates the `@lhci/cli` version
- [ ] The CI job passes on a PR touching `web/**`, and reports a non-zero CLS consistent with local measurement
- [ ] A deliberately-introduced layout shift causes the gate to fail (instrument verified, not assumed)
- [ ] `web/astro.config.mjs` records the `always` vs `auto` conclusion in ≤3 lines with a pointer to this plan; "NOT YET RE-VALIDATED" is gone; the setting is still `always`
- [ ] `npm run --workspace=web lhci:local` exists, contains no config values (no run count, dist path, URL list, tool version, or hardcoded Chrome path), is the only place the measurement command lives, and leaves `git status --short` clean
- [ ] The `web/C:\Users\...` junk directories are deleted and cannot be recommitted
- [ ] **If strategy A shipped:** no font-family name is overloaded — the fallback faces are named `'Outfit Fallback'` / `'Inter Fallback'`; the stack centralisation is complete (`grep` for the literal stacks returns only the token definitions); `document.fonts.check` proves both faces live on the measurement machine _and_ one non-Linux browser; `discord.astro` and `plausible-exclude.astro` render in the brand face, not a system fallback
- [ ] **If strategy A did not ship:** a follow-up issue exists to centralise the font stacks, naming the non-conforming stragglers
- [ ] `docs/STATUS.md` retires the "Lighthouse flakiness" blocker with the outcome
- [ ] `CHANGELOG.md` updated
- [ ] No production deploy performed

## Testing Plan

Every measurement below runs the **same one command** — `npm run --workspace=web lhci:local` (Step 0). It is not restated per step, so it cannot drift and `TMPDIR` cannot be forgotten.

1. **Baseline.** Build (`npm run build:web`), run `lhci:local` against the current build. Record median perf/LCP/FCP/TBT/CLS. (Known: 0.86 / 2708 / 2108 / 14 / 0.187.) Keep the `.lighthouseci/lhr-*.json` reports — they carry the before-side screenshot for step 6.
2. **Aggregation change verified from the baseline data — no revert dance.** The baseline run already contains five per-URL CLS values. Confirm from the report JSON that all five read ≈0.187 while the pre-change config's `optimistic` aggregation asserts 0. Direct proof the aggregation was hiding the defect; re-running CI with the fix reverted buys nothing and costs a branch and a CI cycle.
3. **Apply B (deco layer), rebuild, re-run.** Record the CLS delta. Confirm visually (step 6).
4. **Decision point.** If median CLS ≤0.05, **stop here — strategy A is not shipped** (Requirement 13) and Step 5 files the centralisation issue instead. If CLS is still above 0.05, proceed to 4a/4b.
   - **4a. Centralise the stacks, rebuild, screenshot-diff.** Purely mechanical; must produce no visual change on the homepage or a guide page. Confirm `discord.astro` and `plausible-exclude.astro` now render in Outfit (they did not before).
   - **4b. Font-face liveness — before reading any metric from A.** Capture `document.fonts.check('1em "Outfit Fallback"')` / `'1em "Inter Fallback"'` pre- and post-change on the measurement machine **and on one non-Linux browser**, plus the headline box size with the woff2 requests blocked. All must flip `false` → `true`. A failure here is a bug in the `@font-face` block, not evidence against strategy A — fix and repeat.
5. **If A shipped: rebuild, re-run, compare medians against steps 1 and 3.** Combined CLS must be below 0.05; LCP/FCP must not regress. Record A's and B's individual contributions — if A contributes nothing on this machine, that is the platform-conditionality risk showing up, and it must be recorded rather than glossed.
6. **Visual regression on the hero — reuse the artefact you already have.** Each `lhci:local` run's `.lighthouseci/lhr-*.json` includes the `full-page-screenshot` audit (a base64 render at the 412×823 mobile emulation). Extract the before and after images and compare; get greg's sign-off on any blob movement. For a desktop-width check, and as a fallback if the audit is absent from the LHR, use a single ad-hoc `npx playwright screenshot` against the local `dist` preview for both sides. **Do not build a new Playwright config or visual-regression harness for a one-off check, and do not reuse `playwright.screenshots.config.ts`.**
7. **Cross-page check.** The blog and help URLs are already in the LHCI config, so the same run covers them — confirm neither regressed. If A shipped, spot-check a guide page visually (guides use `--font-display`/`--font-serif`, different stacks, so they exercise the change differently) and load `plausible-exclude.astro` and `discord.astro`.
8. **Instrument verification (negative test), locally.** Temporarily introduce a layout shift (e.g. an unsized image above the fold), rebuild, run `lhci:local`, confirm the assertion fails. Revert. The assertion engine is the same one CI runs, so this needs no scratch branch or CI cycle. A gate that has never been seen to fail is not known to work.
9. **CI run.** Open a PR touching `web/**`; confirm the job is green, the log names `lighthouserc.yml`, CLS reports near the local value (not 0), and the demoted assertions still print their values and spreads. **If CI CLS still reads 0 while local reads a real number, stop** — that discrepancy is unexplained and must be root-caused before the gate is trusted.
10. **Repo hygiene.** `git status --short` is clean of `C:*` entries after a local Lighthouse run — i.e. `TMPDIR` in the script actually prevented the dirs, rather than the gitignore merely hiding them.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the session's completed diagnosis — three-problem framing (noise / optimistic aggregation / real CLS), CLS fix sequenced before threshold-setting, four candidate CLS strategies to be chosen by measurement.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the repo and rewrote strategy A to register the fallback faces under the _existing_ bare `Outfit`/`Inter` names in one `global.css` block — eliminating an 87-site font-stack edit and dropping the shared `packages/brand/theme.css` change entirely; collapsed the four repeated `lhci` command strings into a single `lhci:local` npm script (which also fixes the junk-dir cause at source rather than ignoring it); made the two silent-failure modes loud (a non-applying `@font-face` now needs a positive `document.fonts.check` before any metric is interpreted, and the renamed LHCI config must delete the old `.json` and be named explicitly via `--config`); reused the existing `full-page-screenshot` LHCI artefact for the visual diff instead of standing up a third Playwright config; and gated strategy B's edit on measurement so it is not shipped speculatively into a load-bearing-geometry block.
- **Pass 3 (Sustainability)**: Flagged that a `local()`-only fallback face is platform-conditional — green on the WSL/Linux measurement machine proves nothing for Windows/macOS visitors — so promoted strategy B from conditional-hardening to a mandatory structural fix applied _first_, with A as the systemic layer; required a cross-platform `local()` chain and a non-Linux liveness probe; documented the costs of the `Outfit`/`Inter` name overloading and added a step to file the follow-up that retires it; removed config duplication between `lhci:local` and the LHCI config (Requirement 11) and de-pinned the machine-specific `CHROME_PATH`; constrained the new config to a plain declarative literal so it cannot grow environment-dependent logic (Requirement 12); made this plan file the single canonical record; and simplified testing by proving the aggregation fix from the baseline report data and running the negative test locally.
- **Pass 4 (Fresh-eyes sweep)**: Corrected the defect's shape by reading `index.astro:33-44` — **nine** decorations are content-height-anchored (four `.hero__bean`, three `.hero__deco-img`, two `.hero__deco`), not three; line 42 is unaffected; horizontal percentages are irrelevant — and replaced per-element re-anchoring with a single `.hero__deco-layer` wrapper that fixes all nine with one edit and zero recomputed values. **Killed the `Outfit`/`Inter` name-overloading shortcut**: found `discord.astro:35` (`font-family: Outfit, system-ui, sans-serif`, no `Outfit Variable`), which the shortcut would have silently and permanently switched to a system face with no test able to catch it — a blast radius the plan had mis-enumerated on three consecutive passes; strategy A now uses honest `'Outfit Fallback'` names preceded by the stack centralisation, and the old requirement that forced the shortcut is replaced by "no name may be given a meaning it does not have". **Switched the config target from `.cjs` to `.yml`** — verified LHCI loads YAML at `lighthouserc.js:82`; YAML makes Requirement 12 impossible to violate rather than merely discouraged, gets the comments that were the only reason for CJS, avoids the `type: module`/`.cjs` footgun, and reuses a format already in the repo. Made strategy A **conditional on B's measurement** rather than mandatory (new Requirement 13). Cut the separate "Verify in CI" step, which duplicated Testing Plan step 9 verbatim, and folded the follow-up issue into a now-conditional final step. Also caught the `@lhci/cli@0.15` version being stated in both the workflow and `web/package.json` (Requirement 11); relaxed Requirement 4 to say the 888-901 comment constrains gradient geometry, not anchoring; and added a fallback path for the `full-page-screenshot` artefact in case it is absent from the LHR.
- **Post-pass verification (main thread)**: Spot-checked Pass 4's three decisive claims against the source. `discord.astro:35`, the LHCI YAML loader (`lighthouserc.js:82`), and the duplicated `@lhci/cli` version all confirmed. Corrected Pass 4's element enumeration: there are **four** `.hero__bean` divs with vertical percentage anchors (lines 33-36), not two, so **nine** elements shift, not seven. The single-wrapper fix covers all of them regardless, so the fix shape is unchanged.

## Outcome (implemented 2026-07-22)

**Scope was trimmed by greg before implementation** to "tier 1 + tier 2" — the CLS fix, the aggregation fix, the severity dispositions, and the junk-dir cleanup. Deferred: the YAML config conversion, the `lhci:local` npm script, the `--config` flag, the `@lhci/cli` version dedup, and the 87-file font-stack centralisation. The threshold justifications went into the `lighthouse-ci.yml` header instead of the config, since JSON cannot hold comments and the workflow is YAML and was free.

### The plan's central diagnosis was wrong, and measurement caught it

The plan asserted the shift was **vertical**: fonts swap → headline reflows → hero section grows → percentage anchors re-resolve. The deco half of that was right. The rest was not.

Direct measurement (Playwright, 412×823, with and without the woff2 requests blocked) showed **every `y` coordinate identical** and only **widths** changing:

| element            | with Outfit   | fallback (DejaVu) | delta      |
| ------------------ | ------------- | ----------------- | ---------- |
| `.btn-primary`     | x83.3 w245.4  | x63.3 w285.4      | +40px wide |
| `.hero__headline`  | x96.9 w218.1  | x72.6 w266.8      | +49px wide |
| `.hero__jump-link` | x125.5 w161.1 | x106.7 w198.6     | +37px wide |

The platform fallback is ~19% wider than Outfit and the hero is centre-aligned, so text slid **horizontally** on swap. This invalidated the reasoning behind making `size-adjust` optional — it is precisely the width-matching lever, and it turned out to be the whole fix.

### Measured results (5 runs each, quiet local machine)

| state                                  | perf     | LCP        | FCP  | CLS                              |
| -------------------------------------- | -------- | ---------- | ---- | -------------------------------- |
| baseline                               | 0.86     | 2708       | 2108 | 0.1868 (5/5 identical)           |
| + `.hero__deco-layer`                  | 0.85     | 2649       | 2109 | 0.10–0.14, **straddles budget**  |
| + font preload (both)                  | 0.89     | **3091** ✗ | 1816 | 0 (5/5)                          |
| + font preload (Outfit only)           | 0.92     | **3085** ✗ | 2110 | 0                                |
| + preload `fetchpriority=low`          | 0.92     | **3088** ✗ | 2113 | 0                                |
| **+ `size-adjust` fallback (shipped)** | **0.94** | **2709**   | 2109 | **0.0075** (range 0.0056–0.0075) |

**Font preload was tested and rejected.** It takes CLS to a clean 0 but costs a hard **+377ms LCP**, busting the 3000ms budget; `fetchpriority="low"` does not mitigate it. The hero mascot has only ~290ms of LCP headroom, so any extra critical-path request breaks it. An anti-preload note is recorded in `BaseLayout.astro` so it is not re-attempted.

**The wrapper alone was not sufficient**, contrary to the plan's expectation. Two independent 5-run sessions of the identical build gave medians of 0.0996 and 0.1414 — it straddles the 0.1 budget rather than clearing it. The first session nearly got reported as a pass; it was a lucky sample. This is the third time in this plan's life that a conclusion drawn from one sample was wrong.

### What shipped

- `web/src/pages/index.astro` — `.hero__deco-layer` wrapper (ten decorations re-parented onto a `100vh` containing block, no inline style touched) + an `'Outfit Fallback'` `@font-face` (`size-adjust: 95.5%`, ascent/descent overrides = Outfit's metrics ÷ size-adjust, `local()` chain of Arial-metric faces) appended to all 51 Outfit stacks **in this file only**.
- `web/lighthouserc.json` — `aggregationMethod: median`, `numberOfRuns` 3→5, TBT and `categories:performance` → `warn` (budget numbers unchanged).
- `.github/workflows/lighthouse-ci.yml` — the assertion-disposition rationale.
- `web/.gitignore` — `C:*` backstop; 13 junk dirs deleted.
- `web/src/layouts/BaseLayout.astro` — anti-preload note only.

The name-overloading shortcut stayed rejected: the fallback is honestly named `'Outfit Fallback'`, so `discord.astro:35` and `plausible-exclude.astro:25` are untouched. Because the change is scoped to `index.astro`'s scoped styles, the 87-file centralisation was not needed — the other 90 pages are unaffected.

### Verification

- Full CI config (`lhci autorun`, 3 URLs × 5 runs, median aggregation) passes locally: **exit 0, zero error-level assertions**.
- `document.fonts.check('1em "Outfit Fallback"')` → `true` (the face is live, not silently inert).
- Residual horizontal movement reduced ~3.5× (button 40px → 11px). The correction slightly overshoots — the fallback is now marginally narrower than Outfit — which is inherent to one scalar across four weights and not worth per-weight faces at 13× under budget.
- `npm run build:web` clean; `npm run lint` 0 errors.
- **Not verified:** cross-platform. The `local()` chain is tuned to Arial metrics, which Arimo / Liberation Sans / Nimbus Sans / Helvetica / Arial all share, but only Nimbus Sans exists on the measurement machine. Windows and macOS behaviour is inferred from shared metrics, not observed.

### Still open

- CI has not yet run this; local `autorun` is a strong proxy but not proof.
- Deferred tier-3 items above, if they are ever judged worth it.
- `categories:performance` is `warn` and would now pass at `error` locally (0.94) — but CI cannot reproduce that number, since 30% of it is TBT. Left as `warn` deliberately.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (session start)

> /good-morning

### Follow-up 1

> fix the stale #49 line in STATUS.md and continue lighthouse CI gate flakiness diagnosis and fix

### Follow-up 2

> prepare /beanies-plan to implement

(The diagnosis summarized in Context was produced in-session between Follow-up 1 and Follow-up 2, and was passed into `/beanies-plan` verbatim as the skill arguments.)

</details>
