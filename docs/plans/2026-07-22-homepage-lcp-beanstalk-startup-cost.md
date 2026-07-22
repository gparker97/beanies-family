# Plan: Get homepage LCP under budget by removing the beanstalk's startup SVG work

> Date: 2026-07-22
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-22-homepage-lcp-beanstalk-startup-cost.md`

## User Story

As a visitor landing on beanies.family from search or social on a mid-range phone, I want the hero to appear promptly instead of after three seconds of blank page, so that I don't judge the product by a slow first impression.

As the developer, I want the Lighthouse gate green on a real fix rather than on a relaxed threshold.

## Context

Today's session made the Lighthouse gate honest (`aggregationMethod: median`, TBT/perf-score demoted to `warn` with recorded reasons) and fixed a real homepage CLS defect (0.187 → 0.018, confirmed on CI). That exposed a second problem the old best-of-N aggregation had been hiding: **homepage LCP is over budget on CI hardware and has been for some time.**

### Authoritative CI measurement

Run `29907683159`, `workflow_dispatch` on `main` @ `edcffa31`, 5 runs, `aggregationMethod: median`, `benchmarkIndex 2408`.

| Metric      | Weight | Score    | Value                                     |
| ----------- | ------ | -------- | ----------------------------------------- |
| FCP         | 10     | 0.93     | 1.7s                                      |
| **LCP**     | 25     | **0.73** | **3.2s** — the only `error`-level failure |
| TBT         | 30     | 0.69     | 390ms                                     |
| CLS         | 25     | 1.00     | 0.018 — today's fix, confirmed            |
| Speed Index | 10     | 1.00     | 1.7s                                      |

LCP assertion: expected ≤3000, found **3162.464** (runs: 3165.1, 3162.5, 3161.9, 3162.6, 2034.6).

**`benchmarkIndex` 2408 is comparable to the local machine's 2321–2908.** This is _not_ a "CI is slow hardware" story — the page genuinely takes this long.

### Where the time goes

LCP element is the hero mascot `<img>` (`div.landing-page > section#top > div.hero__mascot > img`). Its phases:

| Phase            | Time       | Share   |
| ---------------- | ---------- | ------- |
| TTFB             | 456ms      | 14%     |
| Load Delay       | 0ms        | 0%      |
| Load Time        | 94ms       | 3%      |
| **Render Delay** | **2612ms** | **83%** |

From the network waterfall: the 46KB hero webp is **requested at 20ms and finishes downloading at 38ms** — then does not paint for another 3.1 seconds. The image is not the problem. The main thread is busy.

Main-thread work:

| Category                     | Time      |
| ---------------------------- | --------- |
| **Script Evaluation**        | **858ms** |
| Style & Layout               | 707ms     |
| Other                        | 258ms     |
| Rendering                    | 65ms      |
| Parse HTML & CSS             | 56ms      |
| Script Parsing & Compilation | 5ms       |

DOM 718 elements, `render-blocking-resources: none`, bootup 0.8s.

### Root cause

`bootup-time` attributes almost all script evaluation to one file:

```
total=928ms  eval=819ms   _astro/WorldsBeanstalk.astro_..._lang.DFQCnX-G.js   (2KB transferred)
total=859ms  eval=16ms    index.html
total=139ms  eval=10ms    Unattributable
```

**A 2KB script is burning 819ms of main thread**, and it belongs to a section that is entirely below the fold (`index.astro:413`, well past the hero at `index.astro:31–52`).

`web/src/components/WorldsBeanstalk.astro` runs this synchronously at module evaluation, inside the `try {` at line 673:

```js
buildBraid();
measure();
positionLeaves();
```

`buildBraid()` (line 491) walks the SVG centre path in 5px steps over a 1080×2400 viewBox, calling `center.getPointAtLength()` **three times per iteration** (`s-1.2`, `s+1.2`, `s`) plus `getTotalLength()` — roughly **1,500 SVG geometry computations** — then writes three braid `d` attributes. `measure()` (line 508) calls `getTotalLength()` on each of the five `.grow` paths. `positionLeaves()` (line 531) adds twelve more `getPointAtLength()` calls plus twelve style writes, **interleaved read-after-write** (see the layout-thrash finding below).

### Why yesterday's fix didn't catch it

`docs/plans/2026-07-21-homepage-lcp-critical-css.md` added `content-visibility: auto` (component line 250), which defers the section's **rendering**, and asserted the beanstalk's "JavaScript is already off the critical path" because Astro emits it as an external deferred module.

That claim is **half right, and the half that's wrong is the bug**: a deferred module defers the _download_, not the _execution_. A 2KB `type="module"` script still executes on the main thread before LCP.

### Methodology: CI measurement only

**Local measurement misled this session twice.** (a) I argued LCP was trustworthy from a 0.1% spread measured _within one CI job_; across environments it varies 17% (local 2709ms vs CI 3162ms) — within-run stability is not cross-environment validity. (b) I A/B'd `inlineStylesheets: always` vs `auto` locally and named the 112KB inline CSS as the prime LCP suspect; the CI report shows **Parse HTML & CSS is 56ms**, refuting it outright.

Therefore: **every measurement that decides anything in this plan is taken on CI**, via `gh workflow run lighthouse-ci.yml --ref <branch>`. Local runs smoke-test that a change works at all; they never decide whether it helped.

### Findings that reshape the obvious approach

Assumptions from the initial brief were checked against the file. Findings:

- **The `#vine-center` path is a static, hardcoded `d` attribute** (line 113). It never changes at runtime. The braid geometry is derived purely from that path plus fixed constants (`stepv=5`, `wl=58`, three fixed phases, `amp = 3.2 + 11*(s/cLen)`) — so it _is_ precomputable. That remains true and is why Step 3 exists. It is not, however, the cheapest correct first move (see "Why not precompute (yet)").
- **The same `d` literal is written out three times** (lines 113, 114, 115 — `#vine-center`, `#vine-trunk`, `#vine-core`). That is an existing DRY violation and a live drift hazard: editing one and not the others silently desynchronises the trunk from the braid.
- **The startup `render()` does _not_ call `frontierPoint()`.** It is guarded by `if (launchedState)` (line 623), and `launchedState` only becomes true in `readScroll()` once the stage passes the launch anchor — false on a cold load. **`frontierPoint()` contributes nothing pre-LCP.**
- **The 83KB `inter-latin-ext` font is legitimately required.** It is triggered by `xiǎo dòu dou` — the pinyin ruby annotation in the story section (`index.astro:567`). **Do not remove it.**
- **The 73KB `caveat-latin` font is a genuine deferral candidate**: it serves exactly one decorative element, `.root-note` (markup at line 215, styled at line 410), inside the below-fold beanstalk.
- **NEW (Pass 4) — `positionLeaves()` thrashes layout.** Per leaf it writes `style.left`, `style.top` and toggles a class, then the _next_ iteration reads `center.getPointAtLength()`. Every geometry read after a style write forces a style/layout flush: twelve forced flushes in a row. Same shape in `render()`, which writes five `strokeDashoffset` values and _then_ calls `frontierPoint()` — a forced flush **every animation frame**. Batching reads before writes is output-identical and removes both.
- **NEW (Pass 4) — the missing-DOM early return does NOT call `renderStatic()`.** Lines 468–475 `console.warn` and `return`. Its comment says "the section renders statically", which is true _today only because the default CSS leaves the paths fully drawn_. Any change that hides `.grow` by default silently falsifies that comment and turns this branch into an invisible-beanstalk failure. This constrains the design of Step 1b.
- **NEW (Pass 4) — `data-side` has exactly one consumer**, the `classList.toggle('l'/'r')` in `positionLeaves()`. Once the class is emitted statically the attribute is dead and must be deleted, not left as a second source of truth.

### What actually has to stay at runtime

| Call site                                        | Why it must stay live                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontierPoint()` (line 519)                     | `getPointAtLength(frac * len)` at a _continuous_ `frac` from the eased scroll position. Runs per animation frame, only once the section is on screen.                                     |
| `dockOffset()` / `readScroll()` (lines 549, 571) | `getBoundingClientRect()` on `#stage` and `#seedSlot`. CSS-pixel viewport measurements, inherently live, and the source of the `dockDirty` degenerate-rect guard. Untouched by this plan. |

## Requirements

1. Homepage LCP median ≤3000ms on CI, with real headroom — target **≤2700ms** so the gate does not flap on a marginal pass.
2. CLS must not regress: stays ≤0.05 (currently 0.018 on CI).
3. The beanstalk must look and animate **identically** — same growth behaviour, same seed tracking, same feel. greg's standing constraint from yesterday's session.
4. Every decision-grade measurement is taken on CI, never local.
5. The existing defensive discipline in `WorldsBeanstalk.astro` is preserved: the `renderStatic()` fail-safe, the `try/catch`, the missing-DOM early return, `prefers-reduced-motion` handling, the `dockDirty` degenerate-rect refusal, and `console.warn` with fix guidance. Per `CLAUDE.md`, no silent failures.
6. The resize path (`onResize()`) must keep working.
7. **The pre-setup window must be covered.** Between first paint and the moment deferred setup runs, the section must present a defensible state — and critically, **the "no setup will ever run" cases must degrade to a complete, visible beanstalk, not a blank one**. That covers: JavaScript disabled or the module failing to load; the missing-DOM early return; a throw inside setup; and a visitor parked below the section who never triggers the observer.
8. **Revertible in one commit.** No new committed derived state unless Step 3 triggers.
9. If geometry is precomputed and committed (Step 3 only), there must be a **guard against drift** — editing `#vine-center` without regenerating must fail loudly at test time.
10. Precomputed values (Step 3 only) must be **validated at runtime before use**. A missing, empty, zero or non-finite value must route into the existing `catch` → `console.warn` + `renderStatic()`, never produce a `NaN` dash offset.
11. No production deploy. Deploy is manual-only via `/deploy-prod-auto`.

## Important Notes & Caveats

- **Do not propose font preload as an LCP fix.** Measured today: it takes CLS to 0 but costs a hard **+377ms LCP**. Recorded in `docs/plans/2026-07-22-lighthouse-gate-honesty-and-homepage-cls.md` and in an anti-preload note in `BaseLayout.astro`.
- **Do not remove `inter-latin-ext`** — it renders the pinyin in greg's story.
- **Do not touch** the `.hero__deco` gradient comment block, `.hero__deco-layer`, or the `'Outfit Fallback'` `@font-face` in `index.astro`.
- **Do not touch the `dockOffset()` degenerate-rect guard** (lines 549–567) or the `content-visibility` comment block (lines 236–251).
- **TBT is the metric to watch.** Deferral _relocates_ work rather than deleting it. TBT is currently `warn` with a 0–398ms noise floor. If the relocated ~800ms lands inside the Lighthouse trace window, that is a legitimate reason to escalate to Step 3.
- **NEW (Pass 4) — the relocated work lands on scroll, which is the worst moment for it.** An ~800ms synchronous task fired by an `IntersectionObserver` on scroll approach will freeze scrolling for roughly half a second right as the section comes into view. Lighthouse will not see it (Lighthouse does not scroll), but a human will. **The escalation trigger for Step 3 is therefore "CI TBT regressed **or** the approach visibly janks on a throttled device"** — not CI evidence alone. Verify this by hand on 4× CPU throttle (Testing Plan §5) before declaring Step 1 sufficient.
- **NEW (Pass 4) — do not observe `#stage`.** `#stage` lives _inside_ the `content-visibility: auto` subtree, and while that subtree is skipped its descendants are unlaid-out with degenerate (0×0) rects — this is exactly what the `dockOffset()` guard exists for. An `IntersectionObserver` on such a target cannot report a meaningful intersection until the browser has already decided the section is relevant and rendered it, which collapses the `rootMargin` head-start to roughly zero and fires the 800ms task at the worst possible instant. **Observe the `.worlds` section element (`#features`) instead** — it is the element _carrying_ `content-visibility: auto`, is laid out normally at its `contain-intrinsic-size` of 3000px, and is outside the skipped subtree. This is the single most important correctness fix in Pass 4.
- **NEW (Pass 4) — do not use `stroke-dasharray: 4000` as the pre-setup default.** It is a magic number that silently assumes every current and future `.grow` path is shorter than 4000 user units. The braids are materially longer than the centre path (sinusoidal offset, amplitude ramping 3.2 → 14.2 over wavelength 58 — a rough arc-length uplift of ~25% on average and ~48% at the base), putting them in the low 3000s. The margin is real but thin, and nothing enforces it. Use a **length-independent** hide instead (see Step 1b). Same visual result, zero assumptions, one fewer constant to maintain.
- **NEW (Pass 4) — a purely-CSS default hide is a new silent-failure surface** and violates Requirement 7. `.grow { … }` in the stylesheet applies with JS disabled, with the module failing to load, and on the missing-DOM early return — all three of which today render a visible (if unbraided) beanstalk. The hide must be **applied by JS and removed by JS**, so that "no JS ran" and "JS ran and failed" both fall back to the current, visible behaviour.
- **NEW (Pass 4) — deferral does not fully fix the `dockDirty` situation, it only improves the odds.** The plan previously claimed deferral means `dockOffset()` runs against a rendered section. With the observer on `.worlds` and a generous `rootMargin`, setup can still fire _before_ the browser promotes the section out of `content-visibility` skipping, so `dockDirty` can still be set. The existing refuse-and-retry guard remains load-bearing and untouched. The honest claim is: **fewer** cold loads hit the degenerate path than today, where setup runs at module eval when the section is certainly skipped.
- **819ms across ~1500 `getPointAtLength` calls is ~0.5ms/call**, implausibly slow for pure Bézier flattening. The interleaved read-after-write patterns found in Pass 4 (`positionLeaves`, `render`) plus forced style/layout under `content-visibility: auto` are the likelier dominant cost. Deferral is robust to whatever the cause turns out to be; **precompute may not be** — if the cost is layout flushing rather than geometry, precomputing the geometry would not remove it.
- **`Style & Layout` is 707ms** — the second-largest item and not yet explained. The read/write batching in Step 1c is a direct, behaviour-identical attack on it. Measure and re-attribute after Step 2; do not assume.
- **Precompute (Step 3) would make the braid engine-independent.** Today Chromium, Gecko and WebKit each flatten the Bézier in their own `getPointAtLength`, so the braid differs by fractions of a pixel between browsers. After Step 3 every browser would get Chromium's flattening — an accepted, sub-0.1px, invisible change, noted so it is not later mistaken for a regression.

## Assumptions

> **Review these before implementation.**

1. `buildBraid()` + `measure()` + `positionLeaves()` account for the bulk of the 819ms. Inferred from the code plus the `bootup-time` attribution, not from a profile. **Profile before committing to the fix (Step 0)** — if something else dominates, the approach changes.
2. `IntersectionObserver` on the `.worlds` section fires on scroll approach and **not** during the Lighthouse trace. Lighthouse does not scroll, and the section sits far below the 823px emulated viewport (hero at `index.astro:31`, beanstalk at `index.astro:413`). **Verify on CI in Step 2** by confirming the beanstalk chunk no longer appears in `bootup-time`.
3. Registering `scroll`/`resize` listeners inside `setup()` is safe because `setup()` synchronously calls `schedule()` → `frame()` → `readScroll()`, which reads the _current_ scroll position from `getBoundingClientRect()` rather than replaying missed events. Verified against the source; still exercised explicitly in Testing Plan §3.
4. `#vine-center`'s `d` is static and will stay static. True today.
5. CI `benchmarkIndex` stays in the ~2400 range.
6. Batching geometry reads before style writes in `positionLeaves()` and `render()` produces byte-identical output. True by inspection — no value read depends on a value written in the same pass — but confirmed visually in Testing Plan §2.

## Approach

Sequenced so the cheapest decisive measurement comes first, and so each lever's contribution is separately attributable on CI.

### Step 0 — Profile before fixing (do not skip)

Assumption 1 is the whole basis of the plan and it is currently an inference. Confirm it cheaply: instrument the three startup calls with `performance.mark`/`measure` in a local build, load the homepage, and record the split between `buildBraid()`, `measure()` and `positionLeaves()`. Also record, from the DevTools Performance panel, how much of each is **"Recalculate Style" / "Layout"** rather than scripting — that distinction decides whether Step 3 could ever help.

This is a **local** run and that is legitimate — it answers "which function is expensive", a within-machine attribution question, not "did LCP improve". Remove the instrumentation before committing.

If `buildBraid()` is not dominant, stop and re-plan against what actually is.

### Why not precompute (yet)

Precomputing the braid at build time (Step 3) removes the work for every visitor rather than moving it, and on paper that is strictly better. It is nevertheless the wrong _first_ move:

1. **It taxes designer iteration.** The header docblock says the braid params were tuned by eye in the mockup and must be re-ported, not refactored. Precompute moves `stepv`/`wl`/`phases`/`amp` into a generator, so every future tweak becomes edit → regenerate → commit a 21KB diff, instead of edit → reload.
2. **"One source of truth" is achieved by deletion, which means nothing ever re-verifies the numbers.** Once `buildBraid()` is gone from the bundle there is no runtime that could disagree with the generated file, so a subtly wrong generated braid is undetectable except by eye.
3. **It adds ~7KB gzipped to the critical HTML document for every visitor**, on a page whose whole problem is time-to-first-paint.
4. **It creates a new failure class — stale committed geometry** — which then needs a generator, a drift test, a README section and a runtime validator to contain. That is four new artifacts to maintain in exchange for one deleted function.
5. **It is not reversible.** Deferral is a ~15-line change revertible in one commit (Requirement 8); precompute is a new module graph.

Also relevant: the section already carries `content-visibility: auto`, so the browser is _already_ deferring its layout and paint to approximately the moment the observer will fire. Deferring the script aligns the JS with what the rendering engine is doing anyway, rather than fighting it.

### Step 1 — Defer the beanstalk setup (primary lever)

Wrap everything currently inside the `try` block (lines 673–690) into a named `setup()` function and call it from an `IntersectionObserver`.

```
Everything moves WHOLESALE and UNMODIFIED:
  buildBraid(); measure(); positionLeaves();
  if (prefersReduced) { renderStatic(); return; }
  strokeDasharray/strokeDashoffset seeding
  dockOffset()
  climber 'animationend' listener
  window scroll + resize listeners
  schedule()
…plus the try/catch, the console.warn guidance and renderStatic().
```

**Ordering is load-bearing: `buildBraid()` must run before the `prefersReduced` branch.** `renderStatic()` sets `strokeDasharray: 'none'` on the `.grow` paths, but `#braidA/B/C` have **no `d` attribute in the markup** — they are drawn only by `buildBraid()`. Reordering so that reduced-motion returns early would silently ship a beanstalk with no braid strands. **DO NOT REORDER.**

The observer:

- **Target: the `.worlds` section (`#features`)**, obtained as `stage.closest('.worlds')` (falling back to `stage` if `closest` returns null). **Not `#stage`** — see the Caveats entry; `#stage` is inside the `content-visibility: auto` skipped subtree and cannot be observed reliably or early.
- **`rootMargin: '1200px 0px'`** — larger than the originally-proposed 600px, because the task being deferred is ~800ms and needs to complete before the user arrives. 1200px is roughly 1.5 viewports on mobile and still leaves the section far outside the Lighthouse trace.
- **Callback contract**, in this exact order:
  1. `if (!entries.some(function (e) { return e.isIntersecting; })) return;`
  2. `io.disconnect();` — **before** calling `setup()`, so a throw inside setup cannot leave a live observer that re-runs setup on every subsequent scroll.
  3. `setup();`
- A `var didSetup = false;` guard as belt-and-braces against duplicate invocation.
- **Fallback:** `if (typeof IntersectionObserver === 'undefined') { setup(); return; }` — call `setup()` immediately.

Answering the "already scrolled past on load" question explicitly (deep link, refresh mid-page, browser scroll restoration): `IntersectionObserver` delivers an initial observation on the first frame after `observe()`, so a visitor who loads already inside or near the section gets `setup()` immediately — no missed-event problem. And because the moved `scroll` listener is accompanied by a synchronous `schedule()`, `readScroll()` reads the live `getBoundingClientRect()` and lands on the correct state without needing any scroll event to have occurred (Assumption 3). A visitor parked _more than 1200px below_ the whole section never triggers setup — Requirement 7 and Step 1b are what make that case safe rather than blank.

**Rationale for `IntersectionObserver` over `requestIdleCallback`:** an idle callback risks dropping an ~800ms task into Lighthouse's TBT window, converting an LCP failure into a TBT failure. The observer fires on scroll approach, outside the Lighthouse trace.

### Step 1b — Cover the pre-setup window (Requirement 7)

The window between first paint and `setup()` must show something sensible, **without** creating a state that persists when setup never runs.

**Mechanism: a JS-applied, JS-removed attribute — not a bare CSS default.**

- Immediately **after** the existing missing-DOM early return passes (i.e. we know `#stage` and `#vine-center` exist and the module is alive), set `section.setAttribute('data-beanstalk', 'pending')` on the `.worlds` element.
- CSS, scoped to that attribute:
  ```css
  .worlds[data-beanstalk='pending'] .grow {
    opacity: 0;
  }
  ```
  **`opacity`, not `stroke-dasharray: 4000`.** Visually identical to an ungrown stalk, but with no dependence on any path's length — nothing to re-derive if the path is ever edited, and no magic constant to go stale.
- **Remove the attribute as the first statement inside `setup()`.** One removal point covers every exit: the normal animated path, the `prefersReduced` → `renderStatic()` path, and the `catch` → `renderStatic()` path. Because setup runs synchronously within a single task, the browser cannot paint between the removal and the dasharray seeding, so there is no flash.

Why this shape satisfies Requirement 7 where a plain CSS rule would not:

| Case                                           | Behaviour                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| JS disabled / module fails to load             | Attribute never set → paths fully drawn, exactly as today                                                                      |
| Missing-DOM early return (lines 468–475)       | Attribute never set → the branch's own comment ("renders statically") stays true                                               |
| Setup throws                                   | Attribute already removed at the top of setup → `catch` → `renderStatic()`                                                     |
| Visitor parked far below, observer never fires | Stalk hidden — the only genuinely-degraded case, and it is invisible-by-definition since they are not looking at it. Accepted. |

Also in this step, and only these:

- **Emit the `l` / `r` leaf class statically in markup.** It is a pure function of the authored side, so it need not wait for JS. Concretely: `data-side="l"` → `class="vine-leaf l"`, `data-side="r"` → `class="vine-leaf r"`, and **delete `data-side` entirely** — `positionLeaves()` was its only consumer (verified), so leaving it would create a second, unenforced source of truth for the same fact. Twelve single-line substitutions; no drift possible afterwards because there is only one attribute left.
  - This also fixes a latent flash that exists today: until JS runs, no leaf has `l` or `r`, so all twelve are _visible_ and unmirrored (`.vine-leaf.l::before { transform: scaleX(-1) }` and the `.l .t` padding both key off the class). Emitting statically makes them correctly hidden and correctly mirrored from first paint.
- **Do NOT add a `.vine-leaf { opacity: 0 }` base rule.** Once every leaf carries `l` or `r` statically, `.vine-leaf.r` and `.vine-leaf.l` (lines 312/314) _already_ set `opacity: 0` plus the collapsed transform. A base rule would be a duplicate declaration of a fact already stated twice — a DRY violation with no behavioural effect. The Pass-3 draft called for it; it is dropped.
- **`.climber { opacity: 0 }` as a plain base rule**, cleared only once the dock offset is _known good_. The correct clearing point is **inside `dockOffset()`, on the success path, immediately before `dockDirty = false`** — one line, one place. That is important: if `dockOffset()` refuses a degenerate rect, `--bx`/`--by` are unset and revealing the climber would park the seed visibly in the wrong spot. Putting the reveal on the success path means the `readScroll()` retry (line 597) reveals it automatically once the section is really laid out, with no second code path. `renderStatic()` already sets `climber.style.opacity = '0'` explicitly, and `render()` takes over opacity once `launchedState` is true, so both other lifecycles are unaffected. (Note this is a small _improvement_ on today, where a pre-dock climber can briefly sit at the stage's top-left corner.)

### Step 1c — Cheap, contained tidies (behaviour-identical)

Only changes that cannot alter a single rendered pixel:

- **Hoist the triple-duplicated `#vine-center` `d` literal** (lines 113/114/115) into a frontmatter `const VINE_CENTER_D` **in `WorldsBeanstalk.astro` itself** — not a new `lib/` module. There is exactly one consumer; a shared module would be indirection without a second caller. Render it as `d={VINE_CENTER_D}` on all three paths. Kills the existing desync hazard for free.
- **Cache the per-frame attribute reads.** `render()` currently does `getAttribute` + `parseFloat` for twelve leaves and three scenes on **every animation frame**. Build `leafFracs` and `sceneCenters` arrays once, in `setup()`, **before `positionLeaves()` runs**, and use them in both `positionLeaves()` and `render()` — one parse site, two consumers. Index alignment with the existing `leaves` / `scenes` arrays is by construction.
- **Batch reads before writes in `positionLeaves()`.** Today: write `style.left`/`style.top`/class for leaf _i_, then read `getPointAtLength()` for leaf _i+1_ — twelve forced style/layout flushes. Restructure to: compute all twelve points into an array first, then write all twelve positions. `data-side`-based class toggling disappears entirely (now static markup), so the function reduces to position writes only.
- **Batch reads before writes in `render()`.** Today: write five `strokeDashoffset` values, then call `frontierPoint()` (a geometry read) — a forced flush **every frame**. Move the `frontierPoint()` call above the `grows.forEach` dashoffset loop and stash the result. Output is identical; the per-frame flush is gone. This is the cheapest available attack on the unexplained 707ms `Style & Layout`, and it also directly reduces the scroll-time jank that Step 1 relocates.
- **Do not** change `stepv`, `wl`, `phases`, `amp`, `EASE`, `MAXSTEP`, `P0`, or any leaf `data-frac`. Raising `stepv` from 5 to 10 would halve the geometry calls and was considered — it changes the braid's rendered shape, so it is refused under Requirement 3 and the file's own load-bearing-constants warning.

### Step 2 — Measure on CI, attribute the win

Branch, push, `gh workflow run lighthouse-ci.yml --ref <branch>`, then parse the report:

```
gh run view <id> --log | grep -o "https://storage.googleapis.com/lighthouse-infrastructure[^ ]*"
```

Fetch the report HTML and parse the embedded `window.__LIGHTHOUSE_JSON__` (locate `__LIGHTHOUSE_JSON__ =`, then `json.JSONDecoder().raw_decode` from the following `{`). Record LCP median, the LCP phase breakdown, `mainthread-work-breakdown`, and `bootup-time` attribution.

Three checks decide what happens next:

1. **Did the beanstalk chunk leave `bootup-time`?** If it is still there, the observer fired inside the trace and the target/rootMargin choice needs revisiting before anything else.
2. **Did TBT move?** It must not regress. It is `warn`-level with a 0–398ms noise floor, so read it as a trend across the 5 runs, not a single number.
3. **Re-attribute `Style & Layout`.** If it dropped alongside script evaluation, it was downstream of the same cause. If it held near 700ms it is an independent problem and gets its own investigation before any further change — and, per the ~0.5ms/call caveat, that would also be evidence that Step 3 could not have helped.

Also confirm `resource-summary:script:size` is unchanged (deferral moves nothing across the wire) and that the document did **not** grow — a useful sanity check that Step 1 is what shipped.

### Step 3 — Precompute the geometry (CONTINGENCY ONLY)

**Build this only if Step 2's CI evidence, or the throttled hand-test in Testing Plan §5, requires it.** Trigger conditions: LCP still above the ≤2700 target with the beanstalk still attributed; **or** TBT regressed; **or** the deferred task visibly janks scrolling on a throttled device. Do not build it speculatively — see "Why not precompute (yet)".

Full spec retained:

#### 3a. Two small modules, one source of truth

The runtime copy is **deleted**, not duplicated: after this change `buildBraid()`, `measure()` and `positionLeaves()` do not exist in the shipped bundle at all.

- `web/src/lib/beanstalkPath.ts` — **hand-authored input**, one export: `export const VINE_CENTER_D = '…';`. If Step 1c already hoisted the literal into the component frontmatter, this step promotes that same constant to a module (now genuinely two consumers: the component and the generator).
- `web/src/lib/beanstalkGeometry.generated.ts` — **generated output**, committed, never hand-edited. Header comment says so and names the regen command. Exports one frozen object:
  - `sourceD` — a copy of `VINE_CENTER_D` as generated (this _is_ the drift guard; no hashing needed)
  - `centerLength` — `cLen`
  - `braid: { A, B, C }` — the three `d` strings
  - `lengths: { trunk, core, braidA, braidB, braidC }`
  - `leaves: Array<{ frac, leftPct, topPct }>`
  - `home: { xPct, yPct }` — `getPointAtLength(0)` as viewBox percentages, for `homeAtStalkTop()`

No JSON file, no fetch, no runtime parsing beyond the `data-*` attributes already in use.

#### 3b. The generator: `scripts/generateBeanstalkGeometry.mjs`

Follows the established convention exactly — `scripts/<name>.mjs`, `#!/usr/bin/env node`, a header docblock stating purpose / usage / idempotency / fail-loud contract (same shape as `generateHolidays.mjs` and `derive-store-version.mjs`), an npm alias in the **root** `package.json` alongside `generate:holidays` and `update-airports`:

```json
"generate:beanstalk": "node scripts/generateBeanstalkGeometry.mjs"
```

and a new section in `scripts/README.md`.

Mechanics:

1. Import `VINE_CENTER_D` directly. **No text-parsing of the `.astro` file.**
2. Launch headless Chromium via `@playwright/test` (already a root devDependency). `setContent()` a minimal standalone SVG document — no dev server, no `astro build`.
3. `page.evaluate()` the **verbatim** `buildBraid()` / `measure()` / leaf-position maths lifted out of the component, and return the numbers.
4. Render the output file and run Prettier on it (as `updateAirports.mjs` does).
5. **Idempotent**: skip the write if the content is byte-identical.
6. **Fail loud on every path**: browser launch failure prints the `npx playwright install chromium` remedy and exits 1; a zero/non-finite length or empty `d` throws with the offending key named; write to the target only after all validation passes.

#### 3c. Component changes

- Frontmatter renders `d={VINE_CENTER_D}`, `d={geom.braid.A|B|C}`, `data-len={…}` on all five `.grow` paths, and `style={'left:…%;top:…%;--r:…'}` on each `.vine-leaf` (the static `l`/`r` class already landed in Step 1b), keeping `data-frac` because `render()` still needs it.
- `buildBraid()`, `measure()` and `positionLeaves()` **deleted**. In their place, inside the existing `try`, a single `readGeometry()` that reads `cLen` from a `data-center-length` attribute, reads each path's `data-len` into `p._len`, and **validates**: every length `Number.isFinite(n) && n > 0`, every braid `d` non-empty. On failure it `throw`s with the offending element id and the remedy (`run npm run generate:beanstalk`) — landing in the existing `catch`, which already warns and calls `renderStatic()`. **No new fallback path is invented** (Requirement 10).
- `homeAtStalkTop()` uses `geom.home` percentages instead of `getPointAtLength(0)`.
- `frontierPoint()` untouched — it needs live geometry and runs post-LCP. Its `if (!bp || !bp._len) continue;` guard and centre-path fallback remain correct.
- `onResize()` reduces to `if (docked) dockOffset(); schedule();` — **only after Assumption 6' (resize-invariance of viewBox-relative geometry) is verified empirically** in Testing Plan §11.
- The deferral from Step 1 **stays**. Step 3 is additive, not a replacement: even with zero geometry work, deferring keeps the script off the pre-LCP main thread.

#### 3d. Drift guard: `scripts/__tests__/generateBeanstalkGeometry.test.mjs`

`vitest.config.ts` already includes `scripts/**/*.{test,spec}.mjs`, and `npm run test:run` runs in both `main-ci.yml` and `pr-checks.yml` — so a test here is already wired into the gate. No new CI plumbing, no Playwright in CI, no hash to maintain. It asserts:

1. `geom.sourceD === VINE_CENTER_D` — the actual drift case. Failure message: _"#vine-center changed but the braid was not regenerated — run `npm run generate:beanstalk`."_
2. Structural validity: each braid `d` is a non-empty `M…L…` polyline of finite coordinates with the expected point count; every length is finite and positive; `leaves.length` matches the number of `.vine-leaf` elements.

Its limitation — it cannot prove the _numbers_ are right, only that they are well-formed and derived from the current input — is accepted and stated in the test's header comment.

### Step 4 — Defer the Caveat font (secondary lever, only if Step 2 leaves LCP short)

73KB serving one decorative `.root-note` line below the fold, downloading at 177–210ms and competing for bandwidth with the hero image. Options in increasing order of intervention: load it lazily when the beanstalk approaches the viewport (which Step 1 now gives us a natural hook for — the same observer callback); or accept a system-cursive fallback for that one line.

**Only pursue this if Step 2 leaves LCP above the ≤2700 target.** Today's session established that touching font loading on this page has surprising second-order effects on LCP.

### Step 5 — Reconsider gate severities, on CI evidence only

If LCP clears with headroom, revisit whether `total-blocking-time` and `categories:performance` can return from `warn` to `error`.

**The evidence currently says no for TBT**: across 5 CI runs on identical code it read 0 / 385 / 392 / 398 / 315ms — the noise floor still exceeds the 300ms budget. Do not promote on wishful thinking. `categories:performance` inherits 30% of that noise. Record the decision either way in the `lighthouse-ci.yml` header, next to the existing dispositions.

## Files Affected

**Step 1 / 1b / 1c — one source file plus docs:**

- `web/src/components/WorldsBeanstalk.astro` — setup wrapped in `setup()` behind an `IntersectionObserver` on the `.worlds` section; `data-beanstalk="pending"` attribute set after the missing-DOM guard and cleared at the top of `setup()`; `.worlds[data-beanstalk='pending'] .grow { opacity: 0 }` and `.climber { opacity: 0 }` rules added, the latter cleared on `dockOffset()`'s success path; `l`/`r` leaf classes emitted statically and `data-side` deleted; `VINE_CENTER_D` hoisted into frontmatter; `data-frac`/`data-center` reads cached into arrays at setup; reads batched before writes in `positionLeaves()` and `render()`
- `docs/plans/2026-07-22-homepage-lcp-beanstalk-startup-cost.md` — this plan
- `docs/STATUS.md`, `CHANGELOG.md`
- `.github/workflows/lighthouse-ci.yml` — only if Step 5 changes a severity

**Step 3 — contingency only, built only if Step 2 or the throttled hand-test demands it:**

- `web/src/lib/beanstalkPath.ts` — **new**
- `web/src/lib/beanstalkGeometry.generated.ts` — **new**, generated + committed
- `scripts/generateBeanstalkGeometry.mjs` — **new**
- `scripts/__tests__/generateBeanstalkGeometry.test.mjs` — **new**
- `scripts/README.md` — new section
- `package.json` (root) — `generate:beanstalk` alias

**Explicitly NOT touched:** `web/src/layouts/BaseLayout.astro` font imports (except a Caveat change if Step 4 runs); `inter-latin-ext`; the `.hero__deco*` and `'Outfit Fallback'` blocks in `index.astro`; `packages/brand/theme.css`; `frontierPoint()`'s logic, `readScroll()`, `renderStatic()`, the `dockDirty` guard and the `content-visibility` comment block in `WorldsBeanstalk.astro`; all tuned constants (`stepv`, `wl`, `phases`, `amp`, `EASE`, `MAXSTEP`, `P0`, leaf `data-frac`).

## Observability Coverage

This is a static marketing-site change on a separate origin from the Vue PWA; there is no `logEvent`/`reportError`/`perfTiming` on this surface, no `surface` to add, and **no new `context` key**, so no `ALLOWED_CONTEXT_KEYS` or store-declaration update is required.

What must nonetheless stay observable:

- **The existing fail-safes are the observability, and they are reused rather than duplicated.** The component has exactly one degradation path — `console.warn` with concrete fix guidance, then `renderStatic()` — reached from the missing-DOM early return and from the `catch`. Deferral moves that `try/catch` wholesale into `setup()`; it does not add a branch. Step 3's `readGeometry()` validation would `throw` into that same `catch` rather than adding a parallel warn/fallback.
- **No new silent-failure surface — and this is the specific thing Pass 4 had to defend.** Hiding the stalk before setup is only safe because the hide is _applied by JS after the DOM guard passes_ and _removed by JS as setup's first statement_. Every "setup will never run" path therefore leaves the stalk visible: JS off, module load failure, missing DOM. Every "setup ran and failed" path clears the hide before it throws. A bare CSS default would have converted three currently-visible degradations into a blank section, which is exactly the class of silent failure `CLAUDE.md` forbids.
- **No magic-constant failure mode.** Using `opacity` rather than `stroke-dasharray: 4000` means there is no numeric assumption about path length that could go quietly wrong when the path is edited.
- **Degenerate measurement under `content-visibility` keeps its guard.** Deferral makes the degenerate case _less_ frequent but does not eliminate it (setup can still fire before the section is promoted out of skipping). The `dockDirty` refuse-and-retry logic is untouched and now additionally gates the climber's visibility, so a refused measurement can no longer render a mis-parked seed at all.
- **The Lighthouse gate is the regression detector.** LCP stays at `error`, so a future regression past 3000ms fails CI rather than passing quietly.
- **Success-path signal:** the CI report is uploaded to `temporary-public-storage` on every run, pass or fail, so the LCP trend stays measurable rather than only visible when it breaks.

## Acceptance Criteria

- [ ] Homepage LCP median ≤2700ms on CI (headroom under the 3000ms budget, not a hairline pass)
- [ ] CLS still ≤0.05 on CI (no regression of today's 0.018)
- [ ] `bootup-time` no longer attributes ~800ms to the beanstalk script
- [ ] TBT did not regress on CI, and the deferred task does not visibly stall scrolling on a 4×-throttled device
- [ ] `Style & Layout` re-attributed after the fix — either it fell with script evaluation, or it is documented as an independent open problem
- [ ] The beanstalk is visually and behaviourally identical: growth animation, seed tracking, leaf sprouting, celebrate state, reduced-motion path
- [ ] `renderStatic()` fail-safe, `try/catch`, missing-DOM early return, `dockDirty` guard and `console.warn` guidance all still present and reachable
- [ ] `buildBraid()` still runs before the `prefersReduced` branch (braids have no authored `d`)
- [ ] With JavaScript disabled, the beanstalk renders as a complete visible stalk — no blank section
- [ ] The observer targets the `.worlds` section, not `#stage`, and disconnects before `setup()` runs
- [ ] Setup fires exactly once across scroll down → up → down
- [ ] The climber becomes visible only after a _successful_ `dockOffset()`, including via the `readScroll()` retry
- [ ] No `stroke-dasharray` magic number was introduced
- [ ] `data-side` is gone from the markup and the `l`/`r` class is authored statically — one source of truth per leaf
- [ ] The `#vine-center` `d` literal appears exactly once in the component, not three times
- [ ] `positionLeaves()` and `render()` perform all geometry reads before any style writes
- [ ] Resize still works
- [ ] Step 1 is revertible in a single commit and adds no committed derived state
- [ ] Step 3 artifacts exist **only** if Step 2 or the throttled hand-test triggered them; if built, the drift guard fails `npm run test:run` loudly when `#vine-center` changes without regeneration
- [ ] All decision-grade measurements in the record are CI measurements
- [ ] `npm run build:web`, `npm run lint` and `npm run test:run` clean
- [ ] No production deploy performed

## Testing Plan

1. **Step 0 profile** — local, instrumented, to confirm `buildBraid()` dominates and to split scripting vs style/layout. Recorded in the plan's outcome.
2. **Visual + behavioural equivalence** — before/after at mobile (412×823) and desktop, scrolling the section start to finish: stalk grows, seed rides the leading edge, leaves sprout in order, root celebrates, climber hops. Braid strands must be indistinguishable (validates Assumption 6, the read/write batching).
3. **Deferral actually defers** — DevTools performance trace of a cold load at the top of the page: no beanstalk module body executes before LCP, and the beanstalk chunk is absent from the pre-LCP main-thread work.
4. **Fires exactly once** — scroll down past the section, back up to the top, down again. Confirm via a breakpoint or temporary log that `setup()` ran once and the observer is disconnected.
5. **Pre-setup jank under throttle (the Step 3 trigger)** — 4× CPU throttle, scroll from the top toward the section at a natural speed. Confirm the setup task completes before the section is on screen and does not produce a visible scroll stall. If it does, escalate to Step 3.
6. **Pre-setup visual state** — with heavy CPU throttling, confirm the section shows no half-drawn stalk, no unmirrored/visible leaves, and no misplaced climber before setup lands.
7. **No-JS / no-module** — load with JavaScript disabled (and separately, block the beanstalk chunk in DevTools). The stalk must render fully visible. Then simulate the missing-DOM branch by renaming `#vine-center` in a local build: expect the `console.warn` **and** a visible stalk.
8. **`IntersectionObserver` undefined** — stub `window.IntersectionObserver = undefined` before the module runs and confirm `setup()` executes immediately and everything behaves as it does today.
9. **Deep link / scroll restoration** — load `#features` directly, and separately refresh while scrolled mid-section, and separately reload while scrolled _below_ the whole section. In the first two, setup must fire immediately and the state must be correct. In the third, confirm the stalk becomes correct on scrolling back up.
10. **Reduced motion** — with `prefers-reduced-motion: reduce`, scroll to the section and confirm the full static state including **all three braid strands** (the ordering hazard) and a hidden climber.
11. **Cold-load dock** — hard-reload at the top and scroll down once; confirm the seed docks over `#seedSlot` correctly and becomes visible only once docked, i.e. the `dockDirty` retry still fires under `content-visibility: auto`.
12. **Resize** — resize across breakpoints mid-animation; braid, leaves and dock offset must match the pre-change build. (Also the precondition for the Step 3 `onResize()` simplification, if that ever runs.)
13. **CI measurement** — `gh workflow run lighthouse-ci.yml --ref <branch>`; parse `__LIGHTHOUSE_JSON__`; confirm LCP ≤2700 median, CLS unchanged, TBT not regressed, and record the new main-thread breakdown.
14. **Cross-page** — the blog and help URLs are already in the LHCI config, so the same run covers them; confirm neither regressed.
15. `npm run build:web`, `npm run lint`, `npm run test:run`.
16. **Contingency only (Step 3)** — failure path: temporarily blank a `data-len` and separately a braid `d`, confirm each produces the `console.warn` with regen guidance and a complete `renderStatic()` beanstalk. Drift guard: alter `VINE_CENTER_D` and confirm `npm run test:run` fails with the regen instruction. Generator failure: run with Chromium uninstalled and confirm non-zero exit, the install remedy, and the previous generated file left intact. Generator idempotency: run twice; the second run reports no change and `git status` is clean.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the CI-hardware diagnosis; established precompute-over-defer as the preferred lever after confirming `#vine-center` is static; corrected the brief's wrong assumption that `inter-latin-ext` was removable; added a profile-first step so the plan's central assumption is verified before it is built on.
- **Pass 2 (DRY + error handling)**: Verified the precompute claim against the full script — corrected the false caveat that startup `render()` calls `frontierPoint()` (it is gated by `launchedState`), and named exactly what must stay live; replaced the ad-hoc hash drift guard with a `sourceD` equality test in `scripts/__tests__/`; moved the input `d` into a single module, retiring the triplicated literal; specified the generator to follow the established `scripts/*.mjs` + root-alias + README + `__tests__` convention; and closed the silent-failure gaps by routing all precomputed-value validation through the component's **existing** `catch → console.warn → renderStatic()` path.
- **Pass 3 (Sustainability)**: Judged the build-time precompute over-engineered as a first move — five reasons recorded in "Why not precompute (yet)" (designer-iteration tax, verification-by-deletion, ~7KB gz on the critical document, a new stale-geometry failure class needing four artifacts to contain, and irreversibility). Demoted it to Step 3 contingency with its full spec retained, and promoted `IntersectionObserver` deferral to the primary lever with a new Step 1b (pre-setup static defaults, Requirement 7), Step 1c (cheap contained tidies), Requirement 8 (revertible in one commit), and caveats on TBT relocation, the improved `dockDirty` situation, and the implausibly-slow ~0.5ms/call figure pointing at layout rather than Bézier flattening.
- **Pass 4 (Fresh-eyes sweep)**: Found and fixed four correctness defects in the newly-promoted deferral design — retargeted the observer from `#stage` (inside the `content-visibility: auto` skipped subtree, where it cannot report early and collapses the `rootMargin` head-start) to the `.worlds` section, widened `rootMargin` to 1200px, and required `disconnect()` before `setup()`; replaced the magic `stroke-dasharray: 4000` with a length-independent `opacity` hide; made that hide a **JS-applied, JS-removed** `data-beanstalk="pending"` attribute after discovering the missing-DOM early return does **not** call `renderStatic()`, so a bare CSS default would have turned three currently-visible degradations (JS off, module load failure, missing DOM) into a blank section; and pinned the climber reveal to `dockOffset()`'s success path so a refused degenerate measurement can no longer show a mis-parked seed. Also dropped the redundant `.vine-leaf { opacity: 0 }` base rule (`.l`/`.r` already declare it), required `data-side` be deleted rather than left as a second source of truth alongside the new static class, added read-before-write batching in `positionLeaves()` and `render()` (twelve forced layout flushes at startup and one per animation frame, output-identical to remove), and made "visible scroll jank on a throttled device" an explicit Step 3 escalation trigger alongside CI evidence.

## Outcome (attempted and REVERTED, 2026-07-22)

**Steps 0–2 were executed. Step 1 achieved its mechanical goal completely and did not improve LCP at all. It was reverted. The plan's central premise is disproven — do not retry this approach, and do not build Step 3.**

### Step 0 — profile (confirmed the plan's assumption)

Local, instrumented, `performance.now()` around each startup call:

|                    | CPU 1×      | CPU 4× (≈CI) |
| ------------------ | ----------- | ------------ |
| `buildBraid()`     | **242.7ms** | **894.4ms**  |
| `measure()`        | 0.4ms       | 1.8ms        |
| `positionLeaves()` | 4.9ms       | 13.9ms       |
| total              | 248.0ms     | 910.1ms      |

`buildBraid()` is 98% of the block, and its 894ms at 4× throttle closely matches CI's 819ms attribution — so CI behaves like a 4×-throttled machine and the diagnosis transfers. **Assumption 1 confirmed.** Note `measure()` costs 0.4ms, so Step 3's machinery for precomputing path lengths was solving a non-problem.

### Step 1 — implemented as specified, and it worked mechanically

`IntersectionObserver` on `.worlds`, `rootMargin: 1200px`, `disconnect()` before `setup()`, JS-applied/JS-removed `data-beanstalk="pending"` hide, plus the `VINE_CENTER_D` DRY fix. Behaviour verified across five cases (cold load defers; fires once on scroll; deep-link fires immediately; missing `IntersectionObserver` falls back to immediate setup; reduced-motion still builds the braid before `renderStatic()`).

### Step 2 — CI measurement: the work vanished, LCP did not move

| Metric                     | Before (`29907683159`) | After (`29911829582`) |
| -------------------------- | ---------------------- | --------------------- |
| Script Evaluation          | 858ms                  | **32ms**              |
| TBT                        | 390ms                  | **0ms**               |
| Style & Layout             | 707ms                  | 399ms                 |
| beanstalk in `bootup-time` | 819ms eval             | **absent entirely**   |
| **LCP**                    | 3162.5ms               | **3158.9ms**          |
| Render Delay               | 2612ms                 | 2692ms                |
| **FCP score**              | 0.89 (tight)           | **0.65 (tight)**      |

**~1.2s of main-thread work was removed and LCP changed by 3ms.** Render delay was never main-thread-bound.

Worse, **FCP regressed from ~1.7s to ~2.6s** — real, not noise (before: 0.89/0.93/0.89/0.89/0.89; after: 0.65/0.65/0.81/0.65/0.65).

Hypothesis tested and refuted: that the `opacity: 0` pending-hide created a stacking context forcing composition of the 2400px subtree that `content-visibility: auto` was skipping. Changing it to `visibility: hidden` (`bbc9c4ac`, run `29912328624`) left FCP at 0.65. **The regression is caused by the deferral itself, not the hide.**

### Verdict

Reverted both commits (`cc03bbad`, `bbc9c4ac`); `WorldsBeanstalk.astro` is byte-identical to its pre-attempt state. A change that costs 0.9s of FCP to buy a TBT improvement Lighthouse cannot reliably measure is net-negative for users — FCP is when the visitor sees anything at all.

### What this rules out for any future attempt

1. **The beanstalk's 819ms was never gating LCP.** Removing it entirely moved LCP by 3ms. The root-cause diagnosis in this plan's Context section is wrong about _consequence_, though right about _magnitude_.
2. **Step 3 (build-time precompute) is now pointless and must not be built.** It removes exactly the same work that deferral already removed to no effect. Six new artifacts for a proven-zero LCP gain.
3. **LCP on this page is ~3160ms invariant** — measured at 3162.5 / 3158.9 / 3159.6 across three materially different builds (beanstalk running, deferred with opacity hide, deferred with visibility hide). Something structural pins it, not page work. TTFB is 454ms and the hero image is fully downloaded at 38ms.
4. **Deferring below-the-fold script can make FCP worse.** Counterintuitive and unexplained; whatever the mechanism, it is now a measured fact about this page.

A future attempt should start by explaining the invariant ~3160ms — not by removing more main-thread work, which has now been demonstrated not to matter.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (session start)

> /good-morning

### Follow-up 1

> fix the stale #49 line in STATUS.md and continue lighthouse CI gate flakiness diagnosis and fix

### Follow-up 2

> prepare /beanies-plan to implement

### Follow-up 3

> let's go with your recommendation

### Follow-up 4

> what is the actual user impact here? after this work, aside from non-functional stuff, what will be the change the user sees?

### Follow-up 5

> ok let's just /deploy-prod-auto and move on, does not seem to be a major issue to focus on for now

### Follow-up 6

> ok go ahead to prepare a plan to fix this now

### Follow-up 7 (Pass 4)

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.

(The CI diagnosis in Context was produced in-session after the deploy, and passed into `/beanies-plan` verbatim as the skill arguments.)

</details>

---

### Critical Files for Implementation

- /home/greg/projects/beanies-family/web/src/components/WorldsBeanstalk.astro
- /home/greg/projects/beanies-family/web/src/pages/index.astro
- /home/greg/projects/beanies-family/web/lighthouserc.json
- /home/greg/projects/beanies-family/.github/workflows/lighthouse-ci.yml
- /home/greg/projects/beanies-family/vitest.config.ts
