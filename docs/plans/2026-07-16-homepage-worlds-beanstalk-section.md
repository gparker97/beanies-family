# Plan: Homepage "three worlds" scroll-grown beanstalk section

> Date: 2026-07-16
> Related issues: Notion #56 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-07-16-homepage-worlds-beanstalk-section.md`
> Mockup: `docs/mockups/homepage-worlds-beanstalk-blend-2026-07-16.html` (approved, copy-final)

## User Story

As a potential user landing on beanies.family, I want to quickly and delightfully grasp how beanies helps my family (not just read a feature list), so that I get why it's worth planting my family's beanstalk.

## Context

The marketing homepage (`web/src/pages/index.astro`) goes hero → security → story → CTA and never shows what beanies actually does. We add an engaging, on-brand, scroll-driven "three worlds" beanstalk section **between the hero and the security section**. The design was iterated to approval over ~10 rounds and is captured in the committed mockup `docs/mockups/homepage-worlds-beanstalk-blend-2026-07-16.html` (commit `c037bdf5`), with the copy finalized in greg's 2026-07-16 pass. This plan **ports that prototype into the Astro page as faithfully as possible**.

## FIDELITY MANDATE (governing principle)

greg's explicit direction: _"take especially special care to stay faithful to the mockup. there are many key details that make the mockup work, and these must be preserved and transferred as faithfully as possible. the only time we deviate from the mockup should be when there is a clear conflict with the beanies CIG theme — in that case note those changes."_

Therefore this is a **faithful transfer, not a re-implementation**. Copy the mockup's CSS, JS, and inline SVG **verbatim**, changing ONLY the specific items enumerated in "Required deviations" below (font-family tokens, asset path, Astro-scoping mechanics, section-fade wiring, the decorative-emoji accessibility additions, and reusing rather than re-declaring tokens the page already owns). **Relocating the verbatim CSS/JS/SVG into a dedicated Astro component (see Sustainability note S1), and loading the Caveat brand font on the marketing site (see Approach F), are host-file/asset moves only — the design content itself is unchanged and is NOT a deviation.** Every geometric/timing constant is a key detail and must survive unchanged, specifically:

- The centerline SVG path `d` (`M540 0 C … 540 2260`) and `viewBox="0 0 1080 2400" preserveAspectRatio="none"`.
- The braid generator params: `step=5`, `wl=58`, `phases=[0, 2.0944, 4.1888]`, `amp=3.2 + 11*(s/cLen)`; three strand gradients.
- The growth remap: `pRaw=(vh*0.5 - stageTop)/H`, `P0=0.08*vh/H`, `g=(pRaw-P0)/(1-P0)` clamped — this makes the seed land at the TOP (g=0) and grow down.
- The seed dock/launch (bullet in copy → jumps to stalk top, reversible) via the `--bx/--by` translate + `.docked` class + `.75s` transform transition.
- One-directional card reveal: `g >= (dataCenter - 0.05)` (appears + stays down; hides only on scroll-up).
- Leaf `data-frac` values + `data-side` alternation; leaf unfurl keyed to `g >= frac`.
- The 3-strand braid stroke widths, gradient stops (green→mossy-olive base, never fully brown), tendrils on all four card sides, dirt patch + speckles + pebbles, the front/back grass layers with depth + curl variation, the family hop + grass sprout timing.
- Reduced-motion branch, `rAF`-throttled passive scroll handler, resize rebuild.

**These constants are intentionally opaque and load-bearing. Do NOT "clean them up," extract them to named config, or refactor the generators — future maintenance must edit the mockup first, re-verify the design, then re-port (see Sustainability note S4).** Any place where faithful reproduction would violate the CIG, accessibility, or the section-fade chain is called out in "Required deviations" and resolved in favour of the rule.

## Requirements

1. Insert a new `<section class="worlds" aria-label="what's inside beanies">` (its markup, styles, and script) into `web/src/pages/index.astro` **in place of the current `<div class="section-fade section-fade--hero-out"></div>`, between the hero `</section>` and the `#security` section**, replacing the current single dark hero-out fade with the correct light→light→(worlds)→light→dark fade chain. The section itself is delivered as a self-contained component (`WorldsBeanstalk.astro`, see Sustainability note S1); `index.astro` gains a single `<WorldsBeanstalk />` include plus the two rewired fades.
2. Port the mockup's full markup (intro, stage, SVG vine, climber seed, 12 feature leaves, 3 world cards with 4 tendrils each, rooted family + dirt + grass + payoff) verbatim, minus the mockup-only faux hero/security framing (the real page already has those), and with the decorative-emoji `aria-hidden` additions of Required deviation #6.
3. Port the mockup's `<style>` verbatim into the component's scoped `<style>`, adjusted only for: font-family tokens (incl. the Caveat brand-font stack), the token-reuse rule (do not re-declare tokens the page already defines; do add the two vine tokens the page lacks), and Astro scoped-style mechanics (see deviations).
4. Port the mockup's `<script>` (IIFE: braid build, grass build, leaf positioning, seed dock/launch, growth/reveal/celebrate, resize) verbatim as the component's Astro `<script>`, with the fail-safe wrapper described in Approach C (no behavioural change to the animation).
5. Copy is FINAL — transfer every user-visible string exactly as in the mockup; do not re-write.
6. Re-sequence the section fades so the new LIGHT section sits cleanly between the light hero and the dark security block, with no visible seam and no regression to the existing fade chain.
7. Wire the family image via the site's real public path `/brand/beanies_family_hugging_transparent_512x512.webp` (the climber is an emoji — no asset).
8. Load the **Caveat** brand accent font on the marketing site so the handwritten payoff note renders in Caveat as the mockup intends (see Approach F).
9. Full reduced-motion fallback, mobile-responsive (no horizontal scroll), keyboard/a11y-safe (decorative SVG + decorative emoji `aria-hidden`; the `.vine-leaf` text labels are real content and stay readable), and smooth scroll performance.

## Important Notes & Caveats

- **Caveat is an approved CIG accent font — keep the handwritten note in Caveat.** Caveat was added to the CIG in 2026-04 with The Pod as the third, accent-only font (`.claude/skills/beanies-theme/SKILL.md` §"Caveat — third, accent-only font"), used sparingly for handwritten captions/subtitles (in-app: `RecipeDetailPage.vue`, `FamilyCookbookPage.vue`, `ScrapbookEntryCard.vue`, `StickyNote.vue`, `BeanCard.vue`, etc.). The mockup's single handwritten payoff note is within the "use sparingly — ≤ once per screen" discipline. So the note stays in Caveat (faithful + on-brand). The **only** related work is that the **marketing site does not yet load Caveat** — its `BaseLayout.astro` imports only Outfit + Inter — so we add the font there (Approach F). Fallback stack per the CIG: `'Caveat', 'Outfit', cursive`.
- **Reuse the page's existing brand tokens — do NOT copy the mockup's `:root` block.** The live page already declares `--heritage-orange`, `--deep-slate`, `--sky-silk`, `--terracotta`, `--cloud-white`, `--soft-green`, `--muted-text`, and `--sq: 24px` under `.landing-page` (index.astro ~line 825). The worlds section renders **inside** `.landing-page`, so it inherits all of these. Re-declaring them in the section would be duplication and a future drift hazard — **drop the mockup's `:root { … }` block entirely** and let the section inherit. (This inheritance holds even after the section is extracted into its own component — CSS custom properties cascade at runtime by DOM position, and Astro style-scoping only narrows _selector matching_, not custom-property inheritance; the component's DOM still renders inside `.landing-page`. See S1.)
- **Two tokens the page does NOT have must be added (else silent visual failure).** The mockup's CSS references `var(--vine-green)` (`#3e8e52`) and `var(--vine-green-light)` (`#57a56a`) in the intro label chevron, `.card__kicker`, and blade default colors. These are **not defined anywhere on the live page**, so a verbatim CSS port would leave every `var(--vine-green)` reference unresolved (falling back to `inherit`/initial — wrong colors) with no error. **Resolution:** declare `--vine-green` and `--vine-green-light` on the `.worlds` root rule inside the component (they are decorative beanstalk tokens, not brand tokens, so scoping them to the section keeps them out of the global brand surface while satisfying the references). This preserves the mockup's exact hexes.
- **Astro scoped-style + dynamically-created elements gotcha.** Astro scopes `<style>` by rewriting selectors with a `data-astro-*` attribute stamped onto elements **present in the template at build time**. Elements the script creates at runtime (`document.createElement`) do NOT receive that attribute, so scoped rules won't match them. The mockup's `buildGrass()` creates grass blades/bean-sprouts at runtime → their scoped styles would silently not apply. **Resolution (preferred): pre-render the grass blades in the component template at build time** (a frontmatter loop emitting the `<span class="blade …" style="--x:…">` nodes) so every element exists in the scoped DOM. This drops the runtime `buildGrass()` entirely, is SSR-friendly, removes runtime DOM churn, and is visually identical. The braid paths, by contrast, already exist in the template (the script only sets their `d`), so they stay scoped-safe and their runtime generation is retained (it requires `getTotalLength`/`getPointAtLength` on the rendered SVG).
- **Grass pre-render must be deterministic (reproducible builds).** The mockup's `buildGrass()` uses `Math.random()`. Running that in Astro frontmatter would emit a _different_ patch on every build. Replace the RNG with a **fixed-seed generator** — a small, documented pure function (a tiny inline seeded LCG) that reproduces the mockup's **counts** (20 back blades, 24 front blades), value **ranges**, and its depth-based sizing formula (`depthF = 1 - y/(depth+8)`, `h = rand(hMin,hMax)*(0.7+depthF*0.5)`, curl at ~42%, sway/delay params, `--c1/--c2` per row) so each blade's CSS custom props come from the _same distribution and formula_ the mockup used. The goal is a **visually equivalent, build-stable patch**, not a byte-for-byte reproduction of the original `Math.random()` draw (that draw was never canonical). **Prefer the generator function over a hand-frozen literal array** (S2 — a frozen array is opaque and can't be regenerated when a count/formula changes). The 4 `gbean` emoji are already fixed positions in the mockup — port them as literal nodes.
- **Everything else stays in one self-contained script.** The section's scroll behavior must NOT be routed through the page's global `.reveal` IntersectionObserver — that observer is **one-shot** (`unobserve` after first reveal), which would break the required scroll-up re-hide. Keep the section's own `rAF` scroll handler exactly as in the mockup.
- **No class collisions** were found in `index.astro` (it uses `.mock-*` names, not the mockup's `.card/.worlds/.leaf/.blade/.scene/.root/.dirt/.grass/.vine-leaf/.climber` etc.), and component-level Astro scoping further isolates them — so the mockup class names transfer as-is. (If any later collide, prefer scoping under the `.worlds` root rather than renaming, to preserve fidelity.)
- **Component is a singleton.** The mockup's script and markup use unique element IDs (`#stage`, `#vine-center`, `#climber`, `#grassBack`, `#grassFront`, `#seedSlot`). Include `<WorldsBeanstalk />` exactly once on the homepage (its only intended use); a second instance would produce duplicate IDs and is out of scope.
- **Do not touch** the hero, security, story, or CTA sections beyond the minimal fade rewiring in Requirement 6.
- **Anchor all edits to stable markers, not raw line numbers.** Line numbers in this plan (389, 825, 1212, 1216) are pointers-in-time against a 1410-line file and _will_ drift. Locate edit sites by their stable selectors/classes — the `.section-fade--hero-out` div between `</section>` (hero) and `<section id="security">`, the `.landing-page` token block, and the `.section-fade--to-dark` rule — rather than by line number (S3).
- The stage is tall (~2400px desktop / 2550px mobile). Keep the scroll handler `rAF`-throttled with a passive listener (as in the mockup) so it doesn't jank.
- Marketing site is **English-first and NOT in the app i18n system** (per `CLAUDE.md`) — no `t()`; strings stay literal.

## Assumptions

> Review before implementation.

1. The approved mockup `docs/mockups/homepage-worlds-beanstalk-blend-2026-07-16.html` (commit `c037bdf5`) is the final design + copy. (Verified: greg approved this pass.)
2. `web/public/brand/beanies_family_hugging_transparent_512x512.webp` exists and is the correct family asset (verified present; it is already the page's `lcpImage`).
3. `index.astro`'s brand tokens (`--heritage-orange` etc.) are defined under `.landing-page` (~line 825) and the worlds section renders inside `.landing-page`, so they are inherited even from an extracted component. (Verified.) The section adds only `--vine-green` / `--vine-green-light`, which the page does not define.
4. The site's font stack is `'Outfit Variable', Outfit` (headings/values) + `'Inter Variable', Inter` (body), loaded globally in `BaseLayout.astro` via `@fontsource-variable/outfit` + `@fontsource-variable/inter`. **Caveat is a CIG-approved accent font (theme skill, added 2026-04) but is NOT yet loaded on the marketing site** — Approach F adds it. (Verified.)
5. The section ships live on the next `deploy-web` — there is no draft flag for the homepage. It must be prod-ready before deploy.
6. Extracting the section into `web/src/components/WorldsBeanstalk.astro` follows the repo's established pattern — `src/components/` already holds several self-contained `.astro` components that combine scoped `<style>` + `<script>` (e.g. `HelpSearch.astro`, `Nav.astro`, `SubstackSubscribe.astro`). (Verified.)

## Approach

Port the mockup into a dedicated, self-contained Astro component and include it in `index.astro` as a faithful transfer. Concretely:

**A. Markup.** Create `web/src/components/WorldsBeanstalk.astro` containing the full `<section class="worlds" …>` from the mockup (intro → `#stage` with vine SVG + `#climber` + 12 leaves + 3 world cards (each with its 4 `card__vine` tendrils) + `#root` family/dirt/grass + payoff), minus the mockup's faux framing sections. The SVG and `#seedSlot` keep their existing `aria-hidden`; the family `<img>` keeps its `alt`; add `aria-hidden="true"` to the decorative emoji per Required deviation #6 (the `#climber` seed glyph, the `.gbean` sprouts, and the `↓` grow-hint chevron), leaving the `.vine-leaf` feature-name text readable. Pre-render the grass `<span class="blade …">` / `<span class="gbean …">` nodes in the component template (deterministic frontmatter loop) inside `#grassBack`/`#grassFront`. Then in `index.astro`, replace the lone `<div class="section-fade section-fade--hero-out"></div>` (the div between the hero `</section>` and `<section id="security">`) with:

1. a light hero-out fade (see fade wiring),
2. `<WorldsBeanstalk />`,
3. a `section-fade--to-dark` fade,

then the existing security section. The mockup's markup/CSS/SVG/JS content is transferred verbatim; only its host file changes (mockup → component).

**B. Styles.** Transfer the mockup's `<style>` rules for the section verbatim into the component's scoped `<style>`, with these adjustments only:

- **Drop the mockup's `:root { … }` block** — inherit the page's `.landing-page` brand tokens (and `--sq`) instead of duplicating them.
- **Add `--vine-green: #3e8e52;` and `--vine-green-light: #57a56a;` on the `.worlds` root rule** (the only tokens the page lacks; scoped to the component).
- Map `font-family: 'Outfit', …` → `'Outfit Variable', Outfit, sans-serif`, `'Inter', …` → `'Inter Variable', Inter, sans-serif`, and the payoff note's `'Caveat', cursive` → `'Caveat Variable', Caveat, 'Outfit', cursive` (the CIG Caveat fallback stack), to match the site's loaded fonts.
- Keep colors/gradients/radii/spacing/shadows exactly as in the mockup (they already use the CIG hexes; the vine greens are the section-local decorative tokens above).
- **Transfer ALL `@keyframes` verbatim.** The complete inventory in the mockup is: `bob` (grow-hint chevron), `climberBob` (seed idle wobble), `burst` (celebrate flourish), `sprout` (grass/leaf), `sway` (grass), `popbean` (gbean pop), and `familyHop` (family hop). (Note: the seed dock/launch is a `.climber { transition: transform .75s … }` + `.docked` transform, **not** a keyframe — there is no `seedFly`.) Ensure the grass blade/gbean rules and all seven keyframes are present; since grass is now build-time-rendered and lives in the same component, no `:global()` is needed.

**C. Script.** Add the mockup's IIFE as the component's Astro `<script>` (processed → `type=module`, deferred, DOM-ready). Keep verbatim: `buildBraid()`, leaf positioning, `homeAtStalkTop()`/`dockOffset()`, the reduced-motion branch, the `update()` growth remap (`P0`, `g`), dock/launch, one-directional card reveal, celebrate, and the resize handler. **Two structural changes, neither of which alters the animation:**

- **Remove** `buildGrass()` — grass is now pre-rendered (the only script deletion). (`buildGrass()` was never called from the resize handler, so removing it doesn't change resize behaviour.)
- **Fail loud, degrade safe (no silent failures).** Factor the "show everything statically" logic already present in the `prefersReduced` branch into a single `renderStatic()` helper (DRY — it is currently written inline and would otherwise be duplicated by the guard). Then:
  - The existing `if (!stage || !center) return;` guard becomes `if (!stage || !center) { console.warn('[worlds] beanstalk section could not initialise: missing #stage or #vine-center in the DOM — the section will render statically. If this fires, the worlds markup in WorldsBeanstalk.astro is out of sync with the script (see docs/mockups/homepage-worlds-beanstalk-blend-2026-07-16.html).'); return; }` — the SSR markup stays fully visible, so a mis-wire is self-evident _and_ explained on the console.
  - Wrap the animated setup (`buildBraid`/`measure`/`positionLeaves`/`dockOffset` + the initial vine-hide `strokeDashoffset` seed + listener registration) in a `try { … } catch (err) { console.warn('[worlds] animation setup failed — falling back to the static beanstalk. Fix guidance: verify the SVG path #vine-center is present and getTotalLength/getPointAtLength are available.', err); renderStatic(); }`. Any runtime error therefore lands in the known-good, fully-visible static state with a developer-actionable console message. (`renderStatic()` resets `strokeDasharray`/`strokeDashoffset` to the full-vine state, so it cleanly overrides any partial setup that ran before the throw.)
  - The `prefersReduced` branch calls the same `renderStatic()` and returns.

  Everything else is unchanged. Keeping the whole script inside the component confines its `document.querySelector` reach to the component's own DOM, reducing coupling to the rest of the page.

**D. Fade wiring (Requirement 6).** Today: hero → `.section-fade--hero-out` (light 0% → light 30% → **dark** 100%) → security (dark). New: hero → **light** fade → worlds (light) → **light→dark** fade → security (dark). Implement by:

- Changing `.section-fade--hero-out` to end light instead of dark: `linear-gradient(180deg, var(--cloud-white) 0%, #fffdfb 100%)` (blends the hero's cloud-white into the worlds section's near-white top). This class is used only at the one hero-out site, so the change is localized and non-regressing.
- Inserting `<div class="section-fade section-fade--to-dark"></div>` (the **existing** `.section-fade--to-dark` class — `linear-gradient(180deg, var(--cloud-white) 0%, var(--deep-slate) 100%)`, already defined but currently unused) between `<WorldsBeanstalk />` and the security section, giving the same hero→dark transition the page had before — just relocated below the new section. No new fade class is created (DRY).
- Both fade `<div>`s and both fade CSS rules stay in `index.astro` (they are page-level chrome, not part of the section), keeping the page↔component boundary clean.

**E. Reference the mockup.** The approved mockup file stays in the repo as the design source of truth; the plan and a header comment in `WorldsBeanstalk.astro` point at it (path + commit `c037bdf5`), plus the "load-bearing constants" guardrail from the Fidelity Mandate.

**F. Load the Caveat brand font on the marketing site.** Caveat is a CIG accent font but the marketing site's `BaseLayout.astro` currently imports only Outfit + Inter. Add `@fontsource-variable/caveat` (variable, matching the site's `@fontsource-variable/*` pattern; or `@fontsource/caveat` weights 500/700 if the variable package isn't available) to `web/package.json` and import it in `BaseLayout.astro` alongside the existing font imports. The payoff note then uses `font-family: 'Caveat Variable', Caveat, 'Outfit', cursive`. This is an asset addition, not a design change — it makes the marketing site render the same brand font the app already uses.

### Required deviations from the mockup (CIG / platform / accessibility conflicts — the ONLY changes)

1. **Font family tokens.** `'Outfit'`/`'Inter'`/`'Caveat'` → the site's `'Outfit Variable', Outfit` / `'Inter Variable', Inter` / `'Caveat Variable', Caveat, 'Outfit', cursive` stacks (alignment to the site's loaded fonts; no visual change — Caveat is retained, see Approach F).
2. **Asset path.** `../../web/public/brand/…webp` (mockup's file-relative path) → `/brand/beanies_family_hugging_transparent_512x512.webp` (the Astro public path).
3. **Token reuse.** The mockup's `:root` brand tokens are dropped (inherited from `.landing-page`); the two missing decorative tokens `--vine-green` / `--vine-green-light` are added on the `.worlds` root inside the component. Mechanism/DRY change; identical rendered colors.
4. **Grass rendering mechanism.** Runtime `document.createElement` grass → build-time, deterministic (fixed-seed) pre-rendered nodes (Astro scoped-style requirement + reproducible builds). Purely a mechanism change; visually equivalent. Not a design deviation.
5. **Google Fonts `<link>`.** The mockup's `<link>` to Google Fonts is dropped — the site self-hosts fonts via `@fontsource-variable` (Outfit + Inter today; Caveat added per Approach F). No visual change.
6. **Decorative-emoji accessibility (a11y conflict).** The mockup only marks the SVG and `#seedSlot` `aria-hidden` and gives the family `<img>` an `alt`; its decorative **emoji** (the `#climber` seed glyph 🌱, the four `.gbean` sprouts 🌱/🫘, and the `↓` grow-hint chevron) are unmarked, but Requirement 9 and the acceptance criteria require decorative emoji to be `aria-hidden`. The Fidelity Mandate explicitly permits accessibility deviations. **Resolution:** add `aria-hidden="true"` to those purely-decorative emoji only. The `.vine-leaf` nodes carry real feature-name text — they are genuine content and are deliberately left readable. No visual change.

No other deviations. Colors, the entire animation system, geometry, timing, copy, and the Caveat handwritten note transfer unchanged. (The component extraction, fade rewiring, and Caveat font-load are host-file/asset/structure changes, not design deviations.)

## Sustainability & Maintainability Notes

- **S1 — Extract the section into its own component (`web/src/components/WorldsBeanstalk.astro`); do NOT inline ~600+ lines of markup/CSS/JS into the already-1410-line `index.astro`.** The single biggest complexity reduction. Astro components co-locate markup + scoped `<style>` + `<script>`, which (a) keeps `index.astro` readable (its diff becomes one include + two fade tweaks), (b) confines the verbatim mockup blob to one reviewable unit, (c) scopes styles/JS so there is zero leak risk into hero/security/story/CTA, and (d) matches the repo's own pattern (`HelpSearch.astro`, `Nav.astro`, `SubstackSubscribe.astro`). Fidelity is preserved — content transferred verbatim; only the host file changes. Token inheritance from `.landing-page` is unaffected (custom properties cascade by DOM position at runtime).
- **S2 — Grass generator is a documented pure seeded function, not a frozen magic array.** A hand-frozen 44-element literal is opaque and un-regenerable. A small seeded-LCG helper (seed + formula commented) stays legible and adjustable. Keep it as a tiny frontmatter helper in `WorldsBeanstalk.astro` (or a colocated `worldsGrass.ts` if cleaner); pin the seed with a comment that determinism is for reproducible builds.
- **S3 — Anchor edits to stable selectors, not line numbers** (see Notes). Find each edit site by its class/selector marker so a few added lines elsewhere never mis-target an edit.
- **S4 — Guardrail against future refactors of load-bearing constants.** A header comment in `WorldsBeanstalk.astro` states the rule: change the mockup first, re-verify the design, then re-port — never edit the braid/growth/geometry/timing constants in place.
- **S5 — No new coupling introduced.** The section doesn't join the page's one-shot `.reveal` observer and doesn't touch the app telemetry pipeline. Its only interfaces to the page are the two fade divs that bracket the include — a minimal, explicit boundary.

## Files Affected

- `web/src/components/WorldsBeanstalk.astro` — **new**: the self-contained worlds section — verbatim mockup markup (incl. deterministically pre-rendered grass and the decorative-emoji `aria-hidden` additions), the mockup's scoped `<style>` (minus `:root`, plus the two `.worlds` vine tokens and the font-stack deviations incl. the Caveat stack), and the fail-safe `<script>`. Header comment references the mockup + commit + the load-bearing-constants guardrail.
- `web/src/pages/index.astro` — **modified**: replace the lone hero-out fade with `light hero-out fade` + `<WorldsBeanstalk />` + `.section-fade--to-dark` fade; import the component; adjust the `.section-fade--hero-out` gradient to end light.
- `web/src/layouts/BaseLayout.astro` — **modified**: import the Caveat brand font (`@fontsource-variable/caveat`) alongside the existing Outfit/Inter imports (Approach F).
- `web/package.json` (+ lockfile) — **modified**: add the `@fontsource-variable/caveat` (or `@fontsource/caveat`) dependency.
- `docs/mockups/homepage-worlds-beanstalk-blend-2026-07-16.html` — **already committed** (design source of truth; referenced, not changed).
- `docs/plans/2026-07-16-homepage-worlds-beanstalk-section.md` — this plan.

## Observability Coverage

This is a **static marketing-site section** (Astro component in `index.astro`) with **no data operations, no network calls, and no access to the app's telemetry pipeline** — the `logEvent`/`reportError`/`perfTiming` firehose is the Vue app's, not the Astro site's. So there is **no CloudWatch signal to emit and none is needed.** The only runtime failure surfaces are handled so nothing fails silently:

- **The family image fails to load** → the `<img>` has honest `alt` text and the layout degrades gracefully; no JS depends on the image.
- **The section markup is missing / out of sync** → the script's init guard `console.warn`s an explicit, developer-actionable message (naming the missing node and the mockup source) instead of returning silently; the SSR markup remains fully visible.
- **The section script throws at runtime** → the animated setup is wrapped in `try/catch`; any error calls the shared `renderStatic()` fallback (the same complete static state the reduced-motion branch uses) and `console.warn`s a fix-guidance message. A script failure leaves the section fully visible rather than broken, with cause + remedy on the console.
- **The Caveat font fails to load** → the `'Caveat', 'Outfit', cursive` fallback renders the note in Outfit (CIG-sanctioned fallback), no breakage.

No new `ALLOWED_CONTEXT_KEYS` and no store-declaration changes (nothing is collected). Intentionally observability-light, consistent with the rest of the Astro marketing site.

## Acceptance Criteria

- [ ] The worlds section renders (from `<WorldsBeanstalk />`) between the hero and security sections, with the fade chain reading light-hero → light → worlds → light→dark → dark-security (no visible seam; existing sections unchanged).
- [ ] On load the section is below the fold; the seed sits as a bullet in the "reduce the mental load and watch your family grow" line.
- [ ] Scrolling past the launch point makes the seed **jump to the very top of the stalk** (growth starts at zero) and grow the braided vine down as you scroll; scrolling back up returns the seed to the bullet.
- [ ] The three world cards appear in order as the seed reaches them and **stay visible** while scrolling down; they hide again only when scrolling back up past their entry point.
- [ ] Feature leaves unfurl on alternating sides only as the seed passes each; the climber ducks behind cards and the family; the family hops as front+back grass sprouts from the dirt patch; the closing tag + CTA read as in the mockup.
- [ ] All copy matches the mockup verbatim; the handwritten payoff note renders in **Caveat** (brand accent font, now loaded on the site), with the `'Caveat','Outfit',cursive` fallback wired.
- [ ] On-brand: colors/type/radii from CIG; `--vine-green`/`--vine-green-light` resolve correctly (kicker, chevron, blade colors are the mockup greens, not fallbacks); the documented deviations (font stacks, asset path, token reuse, build-time grass, dropped Google-Fonts link, decorative-emoji `aria-hidden`) are applied.
- [ ] `prefers-reduced-motion` shows the full section statically with no animation; mobile (≤780px) reflows with no horizontal scroll; decorative SVG + decorative emoji are `aria-hidden` while the `.vine-leaf` feature labels remain readable; keyboard focus on the CTA is visible.
- [ ] No scroll jank (rAF-throttled, passive listener); no layout shift on load.
- [ ] Forcing a script failure (e.g. temporarily renaming `#vine-center`) degrades to the full static section with a `console.warn`, never a blank/broken section.
- [ ] The section lives in `web/src/components/WorldsBeanstalk.astro`; `index.astro`'s change is limited to the import, the `<WorldsBeanstalk />` include, and the two fades (no inlined section blob).
- [ ] `npm run build` (web) succeeds; greg approves in a local `dev:web` preview and (post-deploy) in prod.
- [ ] Diagnostic logging per **Observability Coverage** — confirmed none is required (static section); script fails safe with a shared static fallback + console guidance.

## Testing Plan

1. **Local build + preview:** `npm run dev:web` (or `npm run dev:all`) and load `/`. Scroll the full section top→bottom and back up; verify the seed dock→jump-to-top→descend→return, the sticky one-directional cards, leaf timing, climber occlusion, and the grass/family payoff all match the mockup.
2. **Fade chain:** confirm hero→worlds→security transitions have no dark seam and the existing hero/security visuals are unchanged.
3. **Font + token check:** confirm the payoff note renders in Caveat (not the fallback), and the kicker/chevron/blade colors resolve to the mockup greens — confirming `@fontsource-variable/caveat` is loaded and `--vine-green`/`--vine-green-light` + inherited brand tokens resolve inside the component.
4. **Reduced motion:** enable OS "reduce motion"; confirm the whole section renders statically (vine full, all cards + leaves + grass shown, no animation, seed not docked).
5. **Fail-safe:** temporarily break an ID (e.g. rename `#vine-center`) and confirm the section still renders statically with the expected `console.warn` (guard + catch paths), then revert.
6. **Responsive:** at ≤780px and narrow widths, confirm cards/leaves/braid reflow, the family + grass sit correctly, and there is no horizontal scroll.
7. **A11y:** tab to the CTA (visible focus), confirm the decorative SVG + decorative emoji (climber seed, gbeans, chevron) are `aria-hidden`, the `.vine-leaf` labels and the family `<img>` alt are read, and run a quick axe/lighthouse pass.
8. **Perf:** scrub-scroll and watch for jank/dropped frames (rAF handler); confirm no CLS on load.
9. **Build:** `npm run build` for the web site passes (no Astro scoped-style warnings about the section) and is reproducible (grass identical across two builds).
10. **Deploy:** only on greg's explicit go-ahead, ship via `deploy-web`; re-verify on `beanies.family`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the faithful-transfer plan — verbatim CSS/JS/SVG port with a fidelity mandate; enumerated the CIG/platform deviations; specified the hero↔security fade rewiring and the Astro scoped-style/dynamic-element gotcha.
- **Pass 2 (DRY + error handling)**: Added the missing `--vine-green`/`--vine-green-light` tokens (would otherwise silently fail); mandated dropping the mockup `:root` block to reuse `.landing-page` brand tokens; reused the existing unused `.section-fade--to-dark`; made grass pre-render deterministic; replaced the script's silent early-return with a shared `renderStatic()` fallback + `console.warn` guidance under a try/catch.
- **Pass 3 (Sustainability)**: Extracted the ~600-line section into its own `WorldsBeanstalk.astro` component (one-line include in `index.astro`, matching the repo pattern, scoping style/JS); mandated the grass generator be a documented pure seeded function; added a load-bearing-constants guardrail; directed edits to stable selectors over line numbers.
- **Pass 4 (Fresh-eyes sweep)**: Corrected the keyframe checklist (removed the nonexistent `seedFly` — the seed dock is a `.75s` transform transition — and added the `bob` chevron keyframe, listing all seven); added the decorative-emoji `aria-hidden` deviation; tightened the grass note to an equivalent deterministic distribution (not a byte-match); flagged the single-instance/unique-ID singleton constraint.
- **Post-Pass-4 correction (greg, 2026-07-16)**: greg identified that **Caveat is a documented CIG accent font** (not a conflict), used in-app on scrapbook/cookbook/recipe headers. Reclassified: the handwritten note **stays in Caveat** (faithful + on-brand); the only work is loading `@fontsource-variable/caveat` on the marketing site (new Approach F; `BaseLayout.astro` + `web/package.json` added to Files Affected). Removed Caveat from the deviations list (deviations renumbered 1-6). Light factual correction — does not change scope/approach, so passes 2-4 were not re-run.

## Prompt Log

> No GitHub issue created — this plan is approved for direct implementation. Full intake + iteration history lives on Notion #56 (`beanies-plan prompt`, and the Notes field's ORIGINAL PROMPT + REFINEMENT); the design iteration is captured across the mockup's v1→v10 history in this session.

Initial prompt: the assembled `=== BEANIES PRE-PLAN ===` block handed off from `/beanies-pre-plan #56` (see Notion #56 `beanies-plan prompt`).

Follow-up (2026-07-16, mid-plan): "For the implementation, please take especially special care to stay faithful to the mockup. there are many key details that make the mockup work, and these must be preserved and transferred to the actual implementation as faithfully as possible. the only time we deviate from the mockup should be when there is a clear conflict with the beanies CIG theme, in that case please note those changes." → folded in as the **Fidelity Mandate**.

Follow-up (2026-07-16, at approval): "I'm pretty sure we use caveat and we've also documented it as an allowed variation, its used on the different views under the head in the app, i.e. on the travel plans page 'where are the beans headed next' etc." → verified (theme skill §Caveat, in-app usage); Caveat reclassified from deviation to a brand-approved font that the marketing site simply needs to load (Approach F).
