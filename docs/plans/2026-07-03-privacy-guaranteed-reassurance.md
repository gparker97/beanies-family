# Plan: "Privacy, guaranteed" reassurance treatment (hero + onboarding)

> Date: 2026-07-03
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-03-privacy-guaranteed-reassurance.md`
> Mockup: `docs/mockups/2026-07-03-privacy-guaranteed.html`

## User Story

As a privacy-conscious parent evaluating beanies.family, I want the app to state plainly — on the homepage and again at the exact moment I'm asked to enter financial data — that my data stays in my control, and to let me learn _how_ in one tap, so that I trust the product enough to add my real accounts.

## Context

Privacy/local-first is beanies.family's single strongest differentiator — no mainstream family-finance app (Mint, Copilot, Monarch) can honestly say "we can't read your data." Today that story is under-sold:

- **Homepage hero** buries it as the tail of a three-clause run-on subhead (`web/src/pages/index.astro:43-46`): _"…open source and fully encrypted. no ads, no tracking, no nonsense."_
- **Onboarding** — the moment a user hesitates to type in a bank balance — says nothing about privacy at all.

greg approved a mockup (`docs/mockups/2026-07-03-privacy-guaranteed.html`) that (1) gives the hero its own "privacy, guaranteed." beat and (2) adds a calm reassurance line + tappable "how?" hint on the account-onboarding step, linking to the real Zero-Knowledge Architecture help article.

**Accuracy is load-bearing here (YMYL).** The claim is _"your data never leaves your **hands**"_ — deliberately **not** "device." beanies supports optional Google Drive sync of the encrypted `.beanpod`, so "never leaves your device" would be literally false. "Hands" stays true even with cloud sync on: the `.beanpod` is ciphertext locked to a key only the user holds, so it's always in the user's control, never Google's or ours.

## Requirements

### (1) Homepage hero — `web/src/pages/index.astro`

1. Keep the existing subhead (`hero__sub`) unchanged.
2. Add a new privacy beat **below** the subhead and **above** the CTA group:
   - A green `🔒 local-first` chip (echoes the existing floating `AES-256 encrypted` card at `index.astro:80-82`; uses `--soft-green`).
   - The line: `your data never leaves your hands.` (muted slate) + `privacy, guaranteed.` rendered in the **existing orange→terracotta gradient** (the same `.hero__headline em` treatment used for "counts.").
3. Marketing site = English-first, **all-lowercase** brand voice; **exempt** from the i18n lint (not a Vue template). No `t()`, no `uiStrings` entry.
4. Copy is decorative-glyph-safe: the `🔒` sits beside real text — mark it `aria-hidden` per the theme's glyph rule.

### (2) Onboarding account step — `src/components/onboarding/OnboardingAccount.vue`

5. Add a reassurance block directly under `OnboardingStepHeader` (before the `ob-section` form), only in the entry state (it can live above the added-rows list; visible on the step regardless of `accountAdded`).
6. Line (in-app = **sentence case** per the casing standard, brand terms lowercase): **"Your data stays with you. Privacy, guaranteed."** — "Privacy, guaranteed." emphasized (Heritage Orange, semibold; **not** a gradient — gradients are a marketing-hero device, not an in-app pattern).
7. A **"How?"** trigger pill (the word "How?" + the `?` badge), a larger tap target than a bare 16px icon. Tapping it opens the existing `InfoHintBadge` popover.
8. Popover uses `items` mode with three proofs (each an i18n key):
   - "your data lives in a file only you hold"
   - "even in the cloud, it's locked to your key alone"
   - "we can't read it, ever"
9. Popover foot shows a **"Learn how it works →"** link → the Zero-Knowledge Architecture help article.
10. All new onboarding strings go through `uiStrings.ts` (CI-enforced i18n; every key needs `en` + `beanie`).

### (3) `InfoHintBadge.vue` — small backward-compatible enhancement

11. Add a single optional `link?: { text: string; href: string }` prop (one atomic object, not two loose props — an invalid half-set state isn't representable, the render guard is just `v-if="link"`, and no `!` non-null assertion is needed). When present, render a link at the foot of the popover (below `text`/`items`), visually separated by a top divider.
12. The link must open **externally and native-safely** — use the shared `openExternal` (`@/utils/openExternal`), which already handles web and Capacitor. Do **not** hand-roll `<a target="_blank">` (breaks on native iOS). Harden `openExternal` with an empty-`url` guard (see Approach) so the shared util never silently no-ops.
13. Existing 10+ call sites (text-only, items-only, dark variants) must be **completely unaffected** — the link only renders when the new props are supplied.

## Important Notes & Caveats

- **Origin isolation.** Onboarding runs in the Vue app (`app.beanies.family`); the help article lives on the marketing origin (`beanies.family/help/...`). The link **must be absolute** via `MARKETING_URL` (`@/utils/marketing`): `` `${MARKETING_URL}/help/security/zero-knowledge-architecture` ``. A relative `/help/...` would 404 against the app origin. This is the established pattern (see `useInstallNudge.ts:32`, `WhatsNewBody.vue:66`).
- **Article is real and already published.** `src/content/help/security.ts:254` — category `security`, slug `zero-knowledge-architecture`, title "Zero-Knowledge Architecture", excerpt "We can't see your data. Period." No article work required; **no Help Center Coverage section** (this plan reuses existing docs, introduces no new user-facing feature that needs documenting).
- **"Hands" not "device".** Do not "correct" the hero copy to "device" — the wording is intentional for cloud-sync accuracy (see Context).
- **Gradient is hero-only.** The in-app onboarding emphasis is solid Heritage Orange, not the gradient. Keep the marketing signature on the marketing site.
- **`items` i18n pattern.** InfoHintBadge `items` takes a plain `string[]`; the DRY-correct call is `:items="[t('key1'), t('key2'), t('key3')]"` (see `TransactionModal.vue:958`). Do not add a new array-translation mechanism.
- **Arrow lives inside the translated value.** "Learn how it works →" — the `→` is part of the `onboarding.privacy.learnMore` value (a `t()` argument), so it passes `vue/no-bare-strings-in-template`. Do NOT split the arrow into separate template markup.
- **No dedup across origins.** The hero's hardcoded lowercase "privacy, guaranteed." (marketing origin, no i18n) and the onboarding `onboarding.privacy.guaranteed` key (app origin, sentence case) are intentionally separate — different origins, different casing rules. Not duplication; do not consolidate.
- **Help-URL construction.** Follow the established inline pattern `` const zkHelpUrl = `${MARKETING_URL}/help/security/zero-knowledge-architecture` `` (as in `useInstallNudge.ts:32`, `WhatsNewBody.vue:66`). A shared `helpUrl(slug)` helper would be a reasonable future consolidation across the ~6 inline sites, but is out of scope here.
- **Insertion point (unambiguous).** The reassurance block goes between `<OnboardingStepHeader …/>` (ends line 155) and `<div class="ob-section">` (line 157), which is BEFORE the `v-if="!accountAdded"` branch that starts at line 173 — so it stays visible in both the entry and after-add states.
- **InfoHintBadge coupling — deliberate & capped.** This change gives InfoHintBadge two independent optional axes (popover foot-link content + trigger affordance), driven by a single new consumer while 13 existing consumers use neither. Reuse is chosen over a bespoke onboarding popover because `positionPopover()`'s viewport-flip/measurement machinery (lines 19-45) is non-trivial and not worth duplicating. Both axes are **capped here** (see trigger-ceiling note); further per-consumer variance should live at call sites, not as new props. This is a documented architectural decision, not incidental scope-creep.
- **CSS specificity in `index.astro`.** The hero styles use single-class selectors with heavy per-property rules; add the new `.hero__privacy*` classes as their own block and derive every value from existing CSS custom properties (`--soft-green`, `--heritage-orange`, `--terracotta`, `--deep-slate`, `--body-text`). No new color literals.
- **rem-based text rule.** All new font sizes use rem/standard classes — no `text-[Xpx]`, no `font-size: Npx` in scoped styles (Large-reading-mode + stylelint).
- **Beanie-mode casing.** `beanie` values for every new key are all-lowercase; `en` values are sentence case. The emphasized fragment "Privacy, guaranteed." → `en: 'Privacy, guaranteed.'`, `beanie: 'privacy, guaranteed.'`

## Assumptions

> **Review before implementation.**

1. The Zero-Knowledge Architecture article stays at `/help/security/zero-knowledge-architecture` (verified present 2026-07-03).
2. `openExternal` is the correct native-safe external-link mechanism app-wide (verified: used by WhatsNewBody, useInstallNudge, PwaReinstallModal).
3. `MARKETING_URL` resolves to the apex marketing origin in all environments via its built-in fallback (per `utils/marketing.ts`; no env gating needed — confirmed in `features.ts:36-38` note).
4. The onboarding account step is the right/only step for the reassurance (it's the first step that collects financial figures). Savings/recurring steps do not need a repeat.
5. No E2E selector depends on the current onboarding step-2 DOM structure in a way the new block would break (the reassurance is inserted, existing testids unchanged).

## Approach

Faithfully implement the approved mockup, sourcing every style token from the CIG / existing CSS custom properties.

### Hero (`web/src/pages/index.astro`)

Insert between `hero__sub` (line 46) and `hero__cta-group` (line 48):

```html
<div class="hero__privacy">
  <span class="hero__lockchip" aria-hidden="true">🔒 local-first</span>
  <span class="hero__privacy-line">
    <span class="hero__privacy-muted">your data never leaves your hands.</span>
    <em class="hero__privacy-em">privacy, guaranteed.</em>
  </span>
</div>
```

Add a CSS block near `.hero__sub`:

- `.hero__privacy` — flex, centered, wrap, gap, sensible top/bottom margin bridging `hero__sub` and the CTA.
- `.hero__lockchip` — `--soft-green` text on `rgb(39 174 96 / 10%)`, pill radius, small.
- `.hero__privacy-em` — **DRY the gradient via a grouped selector, not a new utility.** There is no shared gradient-text class in `web/src/`, and a global one wouldn't work anyway: `--heritage-orange`/`--terracotta` are declared per-file scoped to `.landing-page` (`index.astro:816-819`), not in `global.css`. Since `.hero__headline em` already carries the exact recipe in the same file and same var scope, add the new element to that existing rule:
  ```css
  .hero__headline em,
  .hero__privacy-em {
    background: linear-gradient(135deg, var(--heritage-orange), var(--terracotta));
    background-clip: text;
    font-style: normal;
    -webkit-text-fill-color: transparent;
  }
  ```
  One rule, zero duplication, no new global surface.
- `.hero__privacy-muted` — `--deep-slate` at reduced opacity, weight 600.

### Onboarding (`src/components/onboarding/OnboardingAccount.vue`)

- Import `InfoHintBadge` (already in the codebase) and `MARKETING_URL`.
- Add a `zkHelpUrl` computed/const: `` `${MARKETING_URL}/help/security/zero-knowledge-architecture` ``.
- Insert a reassurance block after `<OnboardingStepHeader … />` (line 155):

```html
<div class="ob-privacy">
  <p class="ob-privacy__line">
    {{ t('onboarding.privacy.reassure') }}
    <strong class="ob-privacy__em">{{ t('onboarding.privacy.guaranteed') }}</strong>
  </p>
  <InfoHintBadge
    :trigger-label="t('onboarding.privacy.how')"
    :items="[
      t('onboarding.privacy.proof1'),
      t('onboarding.privacy.proof2'),
      t('onboarding.privacy.proof3'),
    ]"
    :link="{ text: t('onboarding.privacy.learnMore'), href: zkHelpUrl }"
  />
</div>
```

- Scoped styles: `.ob-privacy` centered stack; `.ob-privacy__em` Heritage Orange semibold. rem-based only.

### InfoHintBadge (`src/components/ui/InfoHintBadge.vue`)

Two additive, backward-compatible changes:

1. **Foot link** — add one `link?: { text: string; href: string }` prop; when set, render below `text`/`items` as a link-styled `<button type="button">` (avoids href-less-anchor a11y pitfalls; `type="button"` so it can never submit a form):

   ```html
   <button v-if="link" type="button" class="<divider + orange link classes>" @click.stop="openLink">
     {{ link.text }}
   </button>
   ```

   with `function openLink() { if (!link) return; openExternal(link.href); show.value = false; }` (imports `openExternal` from `@/utils/openExternal`). **No try/catch or toast inside InfoHintBadge** — it's a generic leaf UI component with no logging/toast dependency; `document.createElement('a').click()` cannot throw in a real browser, and `link.href` is always truthy (`MARKETING_URL` has a hard fallback in `marketing.ts`). The render guard `v-if="link"` + the util-level empty-url guard (see below) fully cover it; wrapping it would be bloat on an unreachable path.

   **Silent-failure fix belongs in the shared util, not here.** `openExternal` (`src/utils/openExternal.ts:22`) has no empty-`url` guard — an empty href navigates to the current page (a silent no-op reload). Add, after the existing `document` guard, a DRY guard that protects all ~8 callers:

   ```ts
   if (!url) {
     console.error('[openExternal] called with empty url — link will no-op');
     return;
   }
   ```

   Add a matching case to `src/utils/__tests__/openExternal.test.ts`.

2. **"How?" trigger** — the mockup's trigger is a pill (word + `?`), not the default bare `?` badge. Add an **optional** `triggerLabel?: string` (already-resolved string) prop:
   - When absent → current bare `?` badge (all existing call sites unchanged).
   - When present → render the pill: `<button class="hint-trigger" ref="btn" type="button">{{ triggerLabel }} <span class="hint-q">?</span></button>`, styled per mockup (Heritage-Orange-tint pill).
   - **Both trigger branches (`v-if`/`v-else`) MUST keep `ref="btn"` and call `toggle()`** — `positionPopover()` (`InfoHintBadge.vue:19-45`) reads `btn.getBoundingClientRect()`, so the popover machinery works unchanged for either trigger.
   - Pass the already-translated string (`:trigger-label="t('onboarding.privacy.how')"`) — **do not** call `t()` inside the component; this matches its existing "pass resolved `text`/`items` strings" contract (verified: every call site passes `t(...)`).

   _(Alternative considered: a `<slot name="trigger">`. A slot is heavier at the call site and unused elsewhere; a single optional prop matches the component's resolved-string contract. Prefer the prop.)_

   **Trigger-variant ceiling:** `triggerLabel` is the **last acceptable prop-based trigger variant**. A third trigger shape must trigger a refactor to `<slot name="trigger">` (the component owns the button + `ref="btn"`), NOT another boolean/label prop like `triggerIcon`/`triggerVariant`. Recording the threshold now keeps the trigger axis from drifting into a god-component.

## Files Affected

- `web/src/pages/index.astro` — new hero privacy beat (markup + CSS).
- `src/components/onboarding/OnboardingAccount.vue` — reassurance block + InfoHintBadge usage + scoped styles.
- `src/components/ui/InfoHintBadge.vue` — optional foot-link + optional pill-trigger; import `openExternal`. Both trigger branches keep `ref="btn"`.
- `src/utils/openExternal.ts` — add empty-`url` guard (DRY silent-failure fix benefiting all ~8 callers); `src/utils/openExternal.test.ts` — add the empty-url case.
- `src/components/ui/__tests__/InfoHintBadge.test.ts` (new — matches the `__tests__` convention, e.g. `BaseCombobox.test.ts`) — backward-compat + new-path coverage for the now-many-consumer shared component (see Testing Plan).
- `src/services/translation/uiStrings.ts` — new `onboarding.privacy.*` keys (`reassure`, `guaranteed`, `how`, `proof1`, `proof2`, `proof3`, `learnMore`), each `en` + `beanie`.
- `public/locales/zh.json` (or the translation pipeline output) — regenerate via `npm run translate`; spot-check the auto-`zh` for the new keys and fix if MyMemory mangles them (per project translation-review convention).
- `docs/mockups/2026-07-03-privacy-guaranteed.html` — the approved mockup (already committed; part of this change's record).

## Acceptance Criteria

- [ ] Homepage hero shows the `🔒 local-first` chip + "your data never leaves your hands. **privacy, guaranteed.**" (gradient on the emphasized fragment), between subhead and CTA, all-lowercase, responsive down to mobile, no horizontal scroll.
- [ ] Onboarding account step shows "Your data stays with you. **Privacy, guaranteed.**" (sentence case, solid orange emphasis) + a "How?" pill under the step header.
- [ ] Tapping "How?" opens the popover with the three proofs and a "Learn how it works →" link.
- [ ] The link opens `https://beanies.family/help/security/zero-knowledge-architecture` correctly on web **and** native (via `openExternal`), and lands on the real article.
- [ ] All existing `InfoHintBadge` usages render and behave exactly as before (bare `?` trigger, no foot link) — visually diff a couple (e.g. NetWorthHeroCard dark variant, TransactionModal items).
- [ ] New strings resolve via `t()`; `en` sentence case, `beanie` lowercase; `npm run translate` runs clean; `zh` spot-checked.
- [ ] `npm run lint` (incl. `vue/no-bare-strings-in-template`), `npm run type-check`, stylelint, `npm run build` (app) and `build:web` (Astro) all green.
- [ ] No `text-[Xpx]` / `font-size: Npx`; all new sizing rem/standard classes.

## Testing Plan

1. `npm run dev:all` — visually verify hero (localhost:4321) and onboarding step 2 (localhost:5173) against the mockup, light + dark, mobile width.
2. Click "How?" → popover opens, three proofs render, "Learn how it works →" opens the ZK article (verify the resolved absolute URL points at the marketing origin).
3. Toggle beanie mode → onboarding copy shows lowercase variants; hero unaffected (marketing site).
4. Toggle Large reading mode (Settings → Appearance) → all new text scales.
5. Regression: open 2–3 existing InfoHintBadge instances (dark + items) → identical to before.
   5a. **Automated InfoHintBadge unit/component test** (the sustainable guard for 14 consumers, not just manual diffing): (a) backward compat — no `triggerLabel` → bare `?` badge renders; no `link` → no foot-link renders; (b) new paths — `triggerLabel` renders the pill and still wires `toggle()`/`ref="btn"`; `link` renders the foot button, clicking it calls `openExternal(link.href)` and closes the popover.
6. `npm run lint && npm run type-check && npm run build && npm run build:web` → all green.
7. `npm run translate` → new keys added; inspect `zh` output for the seven new keys, fix if mangled.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan from the approved mockup — hero beat, onboarding reassurance + "How?" pill, InfoHintBadge foot-link + optional pill-trigger, i18n keys, origin-isolation + native-link + accuracy caveats.
- **Pass 2 (DRY + error handling)**: Grouped-selector gradient in `index.astro` (no global utility — vars aren't global); moved the only real silent-failure fix into `openExternal` (empty-url guard, benefits all callers) and kept InfoHintBadge free of try/catch/toast bloat; confirmed `triggerLabel` prop over slot with both trigger branches keeping `ref="btn"`; added arrow-in-`t()`, no-dedup-across-origins, and help-URL inline-pattern notes.
- **Pass 3 (Sustainability)**: Collapsed the foot-link into one atomic `link?: {text, href}` prop (no representable half-set state, no `!`); documented a trigger-variant ceiling (next trigger shape → refactor to a `<slot>`, not another prop); added an automated InfoHintBadge backward-compat + new-path test as the guard for its now-14 consumers; recorded the InfoHintBadge coupling as a deliberate, capped architectural decision.
- **Pass 4 (Fresh-eyes sweep)**: Fixed a real render bug (onboarding snippet passed the raw i18n key as a static `trigger-label` attr → would show the literal "onboarding.privacy.how"; corrected to the bound `:trigger-label="t(...)"` and dropped the invalid in-attribute comment); corrected both test paths to the `__tests__/` convention (`src/utils/__tests__/openExternal.test.ts`, `src/components/ui/__tests__/InfoHintBadge.test.ts`); reconciled stale two-prop language to the atomic `link` prop. Confirmed the bare `?` glyph is allowlisted and all 21 existing call sites stay backward-compatible.

## Prompt Log

> No GitHub issue created — direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (design discussion)

> I'd like to look at our homepage and add the words "privacy guaranteed" as a selling point - for example - under the hero it says "one app to manage your family's money, activities, and all the little beans. open source and fully encypted. no ads, no tracking, no nonsense. privacy guaranteed (with emphases)"
>
> i'd also like to add a line related to "privacy guaranteed (how?)" or something to that effect in the onboarding wizard when we are first asking users to add their financial information, to provide re-assurance and a quick note on how their data is safe and kept private.
>
> clicking on the "how" would leverage the standard "hint" component framework that brings up a text hint and provides a short, concise statement on how data is kept locally, nothing is sent to our servers, and we don't even own a database, with the a "learn even more" link to our privacy/local first documentation in the help center
>
> what do you think of this approach and could we do this and make it clear/prominent without making things too cluttered or messy? let me know your thoughts

### Follow-up 1 (link destination + mockup)

> 1. I was thinking to use this article: http://localhost:4321/help/security/zero-knowledge-architecture what do you think?
> 2. sure prepare a quick mockup

### Follow-up 2 (onboarding trigger wording)

> on the onboarding wizard mockup, rather than "your beans stay with you" for something like this i'd rather not be cute, just say 'your data stays with you - privacy guraranteed (how?)' … this aligns with the homepage and also the how? gives them more of a surface to click on than just the question mark, although we can still use the question mark icon at the end of "how" - does that work?

### Follow-up 3 (accuracy: device → hands)

> since we claim "your data never leaves your device" (on the homepage) but we use google drive and other cloud storage providers, isn't it better to say something liek "your data never leaves your hands"?

### Follow-up 4 (tighten proof copy)

> what does "not even us" mean? i feel this line reads strong simply as "we can't read it, ever" - what do you think?

### Follow-up 5 (proceed to plan)

> ok looks good - let's just run /beanies-plan to prepare the plan, no need the pre-plan

</details>
