# Plan: Phone toolbars and the Who Owns What deal card as hero

> Date: 2026-09-30
> Related issues: None (direct implementation, greg's request in session)
> Plan file: `docs/plans/2026-09-30-phone-toolbars-and-deal-hero.md`
> Mockup: `docs/mockups/phone-toolbars-and-deal-hero-2026-09-30.html` (approved by greg 2026-09-30; artifact https://claude.ai/artifact/T6mzN6mZbTiJrgmatnucWL)

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent using beanies on my phone, I want the Meal Planner and Who Owns What toolbars to fit on one
row and the Who Owns What card to fill the screen, so I spend my screen on the week and the card rather
than on buttons, and I can flick through cards with my thumb.

## Context

- Only two pages carry both **Share** (image) and **Export as PDF**: `src/pages/MealPlannerPage.vue`
  (header button row `:291`, Share `:331-344`, Export `:345-356`) and `src/pages/WhoOwnsWhatPage.vue`
  (controls row `:444-498`, Share `:468`, Export `:482`, both inside `v-if="hasKept"`). Both run through
  `useSheetExportRunner`. Other share buttons (recipe, invites) and the recovery-kit / pod-export file saves
  are out of scope.
- On native (Capacitor) Export as PDF ends in the OS share sheet exactly like Share (`shareOrDownloadFile.ts`
  ignores `preferDownload` on native, `:336-340`); on mobile web it downloads the PDF (`:351-353`). On a
  phone it is redundant with Share, and both buttons wrap onto extra rows (screenshots 2026-09-30).
- Who Owns What deal view on phones (`DealPile.vue`, `DealPileStage.vue`): a decorative tagline row
  (`WhoOwnsWhatPage.vue:430-442`, `PageWelcomeSubtitle` "Who's holding what this week? 🙋" + compact
  `AddEntityButton` + `OverflowMenu`), a controls row (`TogglePillGroup` + Share + Export), a progress block
  ("N cards to go" + bar, `DealPile.vue:514-533`), a position line ("{category} · card n of total",
  `:535-540`, computed `:197-204` from `cursor.position`), the card at `.pile { width: 12.25rem }`
  (`DealPileStage.vue:173-182`, 18.75rem at ≥ 48rem) between 2.5rem arrows, a question line ("Keep this card,
  or skip it?"), and Keep / Skip (`DeckActionButton variant="choice"`).
- The pile has **no swipe** (the deal-board plan's swipe requirement covered the Card Details drawer only,
  where `CardViewDrawer.vue:216-223` uses `useHorizontalSwipe`). `useHorizontalSwipe`
  (`src/composables/useHorizontalSwipe.ts`) is the shared helper (Pointer Events, axis lock, `ignoreMouse`,
  needs `touch-action: pan-y` on the target).
- House icon-only-on-phone pattern: `MagicReaderPill.vue:31-36` and `AddEntityButton compact`
  (`h-10 w-10 rounded-full … sm:` pill, label `hidden sm:inline`, `aria-label` always).

## Requirements

1. **Export as PDF hidden below `md` (48rem, CSS)** on MealPlannerPage and WhoOwnsWhatPage.
   Tablets (≥ 768px) and desktops keep it unchanged. Nothing else about export changes.
2. **Share compacts to a round gradient icon below `md` (CSS)** on both pages (same gradient, same action,
   `aria-label` = the existing label key), and is the full labelled pill at ≥ 768px as today.
3. **Meal Planner (phone):** Copy last week / Copy here, Shopping List and the Share icon fit one row at
   390px (header right column stays `flex-wrap`, so a narrower phone wraps rather than overflows).
4. **Who Owns What (phone, all views):** the tagline row is not rendered; the view switch, the compact ＋,
   the Share icon (only when `hasKept`, as today) and the ⋯ overflow share ONE row. Tablet/desktop layout
   unchanged (tagline row, labelled Share + Export).
5. **Deal pile progress (phone):** one element: "N cards to go" + the bar. The position line is hidden on
   phones (CSS, `hidden md:block`); instead the card's category chip reads "{category} · {n} of {total}"
   (one translatable key, `whoOwnsWhat.pile.positionChip`), shown only when the position is counted, i.e.
   NOT while `cursor.visiting` (today's rule, `DealPile.vue:202`). Tablet/desktop keep the position line and a
   plain chip.
6. **Deal card as hero (phone):** the pile width is `min(18.75rem, 100% - 2.5rem)` at every size except the
   drawer's hand (18.75rem at 390px; the stage's own box, never `100vw`, so Large reading mode at 360px never
   scrolls sideways; the 48rem width media query is deleted). Art and text use today's `md` sizes on the pile
   (the hand, and the shared watermark span, keep `text-6xl md:text-7xl`). The arrows keep their 2.5rem size
   and overlap the pile edges IN FLOW below 48rem on the pile only (`margin-inline: -1.25rem`, root `gap: 0`,
   arrow `z-index: 1`, `box-shadow: var(--card-shadow)`, which already has a dark value); the mockup's smaller
   34px absolute arrows are deliberately not followed. A disabled arrow on the phone pile stays opaque with a
   muted icon colour (never hidden: the arrows are also disabled while `busy`, so hiding would flicker; never
   0.4 opacity over the card); the drawer keeps its 0.4. The question line ("Keep this card, or skip it?") is
   hidden on phones (CSS `hidden md:block`, so `deal-pile-question` stays in the DOM for tests). Keep / Skip
   get taller via an `@media (width < 48rem)` rule on `.deck-action.is-choice` (DealPileBanner's choice buttons
   too, consistently). Tablet/desktop and the Card Details drawer are unchanged.
7. **Swipe (touch), owned by `DealPileStage`:** `useHorizontalSwipe` on the stage's stable root (only the
   `<article>` is keyed), `touch-action: pan-y pinch-zoom` (keeps pinch-zoom), `ignoreMouse: true`, enabled when `props.arrows`; swipe left
   emits `step(1, 'swipe')` when `canNext`, right emits `step(-1, 'swipe')` when `canPrev` — exactly the
   arrows' guards (`canPrev/canNext` already carry `!busy && cursor.canStep()`). The Card Details drawer's own
   swipe (`CardViewDrawer.vue:216-223` + `.hand { touch-action }`) is DELETED and it binds the stage's
   `step(dir, via)` instead, so pile and drawer share one swipe. Swipe works whenever the arrows work
   (including while picking).
8. **Swipe hint:** "Swipe to see the next card" under the card on phones (`md:hidden`) while
   `usePersistedChoice(STORAGE_KEYS.WHO_OWNS_WHAT_SWIPE_HINT, ['show', 'seen'] as const, 'show')` is `'show'`
   and the pile holds 2+ cards (`cursor.total >= 2`, stable across actions; not `canStep`, not `busy`); set to
   `'seen'` after the first step of any kind (arrow, key or swipe).
9. **i18n / a11y / dark:** new keys `whoOwnsWhat.pile.positionChip` ("{category} · {n} of {total}") and
   `whoOwnsWhat.pile.swipeHint`; the icon Share shows a white ring spinner (`<span>`, pulses under reduced motion) + the building
   aria-label + `aria-busy` while building (never an empty circle); Export is `aria-busy` while the PDF builds; icon buttons keep an accessible name; every changed surface has its dark
   treatment (see Dark Mode Coverage).

## Important Notes & Caveats

- Width logic uses `useBreakpoint().isMobile` (≤ 767px) in script **and** the matching Tailwind `md:` breakpoint
  in templates; the two must agree (both are the 768px line). `MagicReaderPill` switches at `sm` (640px) —
  do NOT copy its `sm:` classes; use `md:` here so "phone" means the same thing as `isMobile`.
- The E2E spec `e2e/specs/cross-entity.spec.ts:579-589` drives `deal-pile`, `deal-pile-card-*`,
  `deal-pile-keep` — keep every testid (`deal-pile-position` stays on the desktop line; phone uses a new
  `deal-pile-position-chip` on the chip).
- `DealPileStage`'s card is `:key`'d per card, so the swipe target must be a stable wrapper ref (the drawer's
  pattern), never the card element.
- Swipe must not fight vertical scroll (`pan-y`) or the picker/inline member picker; mouse drags on desktop do
  nothing (`ignoreMouse`).
- Share / Export telemetry is unchanged (`useSheetExportRunner`).
- Hiding Export on phones removes the only PDF path on phones: acceptable per greg (PDF is a laptop need).
- **Breakpoint rule (one per element, never both):** changes that MOVE an element between containers (the
  WOW tagline row, the phone copies of ＋ / ⋯; DealModeSwitch `:454` is untouched) use the existing
  `isMobile` (no second name for it); changes that SHRINK or HIDE inside their own box (SheetExportActions, the position
  line, the question, the chip, the arrows, Keep / Skip) use CSS `md:`. `useBreakpoint` is px (767px) and
  `md:` is rem (48rem); they agree at the default font and any drift is harmless (an icon Share beside the
  desktop header).
- The phone ＋ / ⋯ copies are `v-if` on `isMobile` (＋ is `v-if="canDeal && isMobile"`, keeping its gate;
  never CSS-hidden), so only ONE `OverflowMenu` and one `who-owns-what-add` test id is ever mounted; both
  copies bind the same `menuItems` / `onMenu` / `newCard`. A page test at phone width (mocked `matchMedia`)
  pins exactly one of each.
- `touch-action: pan-y pinch-zoom` sits on the stage root UNCONDITIONALLY (the drawer used to get it from `.hand`).

## Assumptions

1. `useBreakpoint()` is the right width source for both pages (both already import it).
2. The count is hidden exactly when `cursor.visiting` is true (verified, `DealPile.vue:202`).
3. `usePersistedChoice` (already used on this page, `:97`, `:216`) is the device-local flag for the hint.

## Approach

1. **`src/components/export/SheetExportActions.vue` (new, shared, beside `ExportSheet.vue`):** single root
   (`inline-flex gap-2`); props `exportingFormat: SheetExportFormat | null` (derives `disabled`),
   `shareLabel` (translated; the pages differ), optional `testid` PREFIX (`${testid}-share` / `-export`, keeping
   `who-owns-what-share` / `-export`); emits `run(format: SheetExportFormat)`. Share = gradient; label in
   `hidden md:inline`, `:aria-label` always, icon-only circle below `md`; while building: `BeanieSpinner` +
   building aria-label + `aria-busy`. Export = `hidden md:inline-flex` (with the `dark:bg-surface-raised`
   partner WOW already has). CSS-only phone rule, no `isMobile`. One component-owned key pair replaces the
   duplicate "Preparing…" / "Export as PDF" keys (`uiStrings.ts:1385/12883`, `1451/13516`); update
   `MealPlannerPage.export.test.ts:75-152` key strings. Both pages bind `@run="runExport"`; WOW's
   `exportDeck` png→image mapping is deleted.
2. **MealPlannerPage:** render `SheetExportActions` in the button row (Req 1-3).
3. **WhoOwnsWhatPage:** tagline row `v-if="!isMobile"` (existing `isMobile`, `:213`); on phones ＋ and ⋯ also
   render in the controls row in the mockup order (toggle, ＋, Share, ⋯) — two repeated component tags,
   accepted over `display: contents` tricks. Note: `AddEntityButton compact` expands at `sm`, so 640-767px
   shows "＋ Add" next to the icon Share; acceptable.
4. **DealPileStage:** swipe on the root (Req 7), emit `step: [dir, via]` with an exported
   `StageStepVia = 'arrow' | 'swipe'`; ONE size modifier on the root (`:class="`is-${size}`"`), rules written
   as `.is-hand .pile` / `.is-pile .arrow`; pile width `min(18.75rem, 100% - 2.5rem)` (hand keeps its own
   sizes); art/text `md:` variants dropped on the non-hand branch; arrows per Req 6; optional `count?: { n: number; total: number } | null` prop: when set, the chip renders
   `<span class="md:hidden" data-testid="deal-pile-position-chip">` with
   `fillTemplate(t('whoOwnsWhat.pile.positionChip'), { category: categoryText, n, total })` +
   `<span class="hidden md:inline">categoryText</span>`; otherwise the plain `categoryText` (the drawer never
   gets two spans; ONE category source, so an unknown category reads "Other" in both); update the stale
   header comment (":7-8, 196px on a phone") and list swipe among its jobs.
5. **DealPile:** passes `:count="cursor.visiting ? null : { n, total }"` to the stage (no positionLine
   refactor); position line + question
   `hidden md:block`; `stepBy(dir, via = 'arrow')` logs `pile_step` detail `next|prev|swipe_next|swipe_prev`
   and, right after `cursor.step`, sets the hint to `'seen'` on every step; the hint is
   `usePersistedChoice(STORAGE_KEYS.WHO_OWNS_WHAT_SWIPE_HINT, ['show', 'seen'] as const, 'show')`.
6. **CardViewDrawer:** delete its swipe + `.hand { touch-action }`; bind `@step="go"` (`go(dir, input)`
   already matches; its `'swipe'` telemetry unchanged). NEW drawer test: a touch swipe on the `card-view`
   stage emits `navigate` + logs detail `swipe`; a mouse drag does nothing (it has no swipe test today).
7. **DeckActionButton:** `@media (width < 48rem)` taller `.is-choice` (rem padding + font-size).
8. i18n keys; `STORAGE_KEYS.WHO_OWNS_WHAT_SWIPE_HINT`; tests (Testing Plan).

## Files Affected

- `src/pages/MealPlannerPage.vue`, `src/pages/WhoOwnsWhatPage.vue`
- `src/components/responsibilities/DealPile.vue`, `DealPileStage.vue`, `DeckActionButton.vue`,
  `CardViewDrawer.vue`
- new `src/components/export/SheetExportActions.vue` (+ test); `STORAGE_KEYS` file
- new `src/test/pointerSwipe.ts` (shared pointer/swipe test helpers, moved from `useHorizontalSwipe.test.ts`
  and `useCalendarSlide.test.ts:53-80`; imported by those two + the new stage and drawer tests)
- `src/content/help/features.ts` (`:137`, `:2594`: Export as PDF is a computer/tablet button, phones use
  Share; `:2447`: "or swipe on a phone")
- `src/services/translation/uiStrings.ts`
- tests: `src/components/responsibilities/__tests__/DealPile.test.ts` (+ stage), page tests
- Mockup: `docs/mockups/phone-toolbars-and-deal-hero-2026-09-30.html`

## Dark Mode Coverage

- **Share icon button** (both pages): gradient `from-primary-500 to-terracotta-400`, white icon, same in both
  modes (≥ 4.5:1 for the icon on the orange end is not required for a 16px icon with an aria name, but the
  white icon on #F15D22 is 3.3:1 ≥ 3:1 non-text); focus ring `focus-visible` Sky Silk.
- **Toolbar row** (WOW phone): `TogglePillGroup`, compact `AddEntityButton`, `OverflowMenu` keep their existing
  dark partners; nothing new painted.
- **Category chip with the count**: the whole label uses the chip's existing tint + `dark:text-ink-soft`
  (no new colour); verify ≥ 4.5:1 in both modes.
- **Overlapping arrows**: `.arrow` already has dark partners (background/colour `DealPileStage.vue:214-217`,
  hover `:224-226`, border via `--color-border-strong`, re-pointed in dark at `style.css:177`); any added
  shadow needs an `html.dark` partner.
- **Swipe hint**: `text-xs` `ink-faint` light (`var(--color-text-muted)`) / `dark:text-ink-faint`.
- **Adjacent**: re-check the deal pile, Keep / Skip and the Meal Planner header in dark at 390px; fix cheap
  local breakage.

## Observability Coverage

- Existing `logOnce('pile_step', 'prev'|'next')` gains `swipe_prev` / `swipe_next` detail values for swipes, so
  swipe vs arrow use is measurable (surface and keys unchanged, `detail` is allowlisted).
- Share / Export keep their existing `useSheetExportRunner` / `file-delivery` telemetry (outcome per format).
- No new context keys; no failure paths added (pure layout + a gesture calling existing actions).

## Acceptance Criteria

- [ ] At 390px: Meal Planner shows Copy + Shopping List + a round Share icon on one row, no Export.
- [ ] At 390px: Who Owns What shows no tagline row; view switch + ＋ + Share icon (when something is kept) + ⋯
      on one row; no Export.
- [ ] At ≥ 768px both pages look as today (labelled Share + Export, WOW tagline row), except two intended
      changes: the Meal Planner's Export gains its dark partner, and Share shows a spinner while building.
- [ ] Deal pile at 390px: one progress bar; chip reads "Home & Household · 1 of 20"; no position line, no
      question line; card 18.75rem wide; arrows overlap the pile edges, stay visible (muted when disabled) and
      still work; Keep / Skip taller and do not jump during an action.
- [ ] Touch swipe left/right steps the pile (whenever the arrows would, including while picking); vertical
      scroll still works; a mouse drag does nothing; no step past the pile's ends (`canStep`).
- [ ] The Card Details drawer still swipes on touch (now via the shared stage).
- [ ] At 360px in Large reading mode the deal page never scrolls sideways.
- [ ] The swipe hint shows until the first step (arrow, key or swipe) on the device, then never again.
- [ ] Every changed surface checked in dark (desktop + phone) and matches Dark Mode Coverage.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified.

## Testing Plan

1. Unit: DealPileStage swipe (left/right emit `step(±1,'swipe')`, blocked when `canNext`/`canPrev` false,
   mouse ignored; reuse `useHorizontalSwipe.test.ts` pointer helpers); DealPile (hint stored after a real
   step, chip text, `stepBy` detail values); `SheetExportActions` (aria-label, busy spinner, emitted `run`);
   CardViewDrawer tests still green with the stage's swipe; updated `MealPlannerPage.export.test.ts`.
2. `npm run validate`.
3. Browser: extend `scripts/design-screenshots/who-owns-what-capture.ts` (or a scoped script) for 390px +
   1280px, light + dark: both toolbars, the deal pile, a touch swipe (Playwright touchscreen / pointer events
   with `pointerType: 'touch'`), a mouse drag (no step), the hint disappearing.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the two audits (share/export across views; WOW deal view + swipe)
  and the approved mockup.
- **Pass 2 (DRY + error handling)**: one shared `SheetExportActions` (CSS-only phone rule, one key pair, busy spinner for the icon); swipe moved into `DealPileStage` and the drawer's copy deleted; hint via `usePersistedChoice`; CSS hiding keeps test markers; chip uses one full translatable key and the real `visiting` rule; drawer sizing pinned; arrows keep 40px; taller Keep/Skip via scoped media rule.
- **Pass 3 (Sustainability)**: fixed the AC/Req contradictions; pile width from the stage's box (no `100vw`, Large-mode safe) with in-flow overlapping arrows; one root size modifier; `touch-action` unconditional; new drawer swipe test; chip spans only when counted (`phoneChipLabel`); one `compactHeader` flag for moved elements and a written CSS-vs-JS rule; tightened `SheetExportActions` API; correct `usePersistedChoice` signature.
- **Pass 4 (Fresh-eyes sweep)**: Req 6 rewritten as one statement (in-flow 2.5rem arrows, one width); disabled arrows muted not hidden (no flicker while busy); hint not gated on busy; arrow shadow via `--card-shadow`; `pan-y pinch-zoom`; chip via a `count` prop with one category source; `compactHeader` dropped for `isMobile`; Req 1/2 say CSS; AC lists the intended desktop changes; shared `src/test/pointerSwipe.ts`; help text updated; phone ＋ keeps `canDeal` + a phone-width page test; watermark sizes kept for the hand.
- **Round-1 code review (after implementation)**: swipe hint changed (Req 8: any step marks it seen, shown while the pile has 2+ cards, so arrow-only users lose it and actions never toggle it); the Share spinner became a white ring and Export gained `aria-busy`; pile geometry centralised in `--pile-w` / `--slab` on `.stage` (fixes a 4px md+ overflow) with the pile art sized from the pile (`cqi`); one category label source (`categoryLabelOrOther`) for the position line and the chip; help copy says the tablet app's Export opens the share sheet.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

"I noticed that the meal planner, who owns what, and perhaps other pages that have both a "share" and an "export to pdf" button are taking up a lot of space on mobile/app width views ... To save space on mobile, should we hide any 'export to pdf' button that exists? IF more space savings are needed ... perhaps also shortening the share button to just a share icon could also be an option. Can you perform a review of all views ... Also 2 other small changes on the 'who owns what' page: 1) ... ensure the cards are made larger and given a prominent and central role on the page ... two counters on the page above the cards ... I woudl lean towards keeping the overall progress as a clear element ... Perhaps the row "who owns what this week" which is primarily decorative, could be dropped on mobile so that the view switch, together with the add card and share icon could even fit onto 1 row ... invoke /frontend-design for a review as well. 2) Add the ability to use swipe gestures on mobile/app to swipe the cards left and right"

### Follow-up 1

"looks very good, yes go ahead with /beanies-build-auto"

</details>
