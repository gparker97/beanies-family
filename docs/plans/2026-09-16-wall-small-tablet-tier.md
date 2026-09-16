# Plan: The beanie wall turns away the 8-inch tablets it is marketed for

> Date: 2026-09-16
> Related issues: Notion tracker #96. **No GitHub issue created** — approved for direct implementation.
> Plan file: `docs/plans/2026-09-16-wall-small-tablet-tier.md`
> Mockup: `docs/mockups/wall-small-tablet-tier-2026-09-16.html` (approved, committed `0804af67`)

## User Story

As a parent who has mounted a cheap spare 8-inch tablet in the kitchen, I want the beanie wall to actually draw on it, either way up, so that the display the product told me to set up is the display I get.

## Context

An early adopter mounted a Lenovo Tab M8 (TB-8505F, 8", 800x1280) and got "The wall needs a wider screen".

She did exactly what the product asked. `WallSetupCard` says "Turn a spare tablet into the family wall display" and checks only that she has a PIN. `/from/skylight:946` promises "Any tablet with a browser works: iPad, Android, Fire, the one with the cracked corner." The help article at `getting-started.ts:942` says "a phone screen is too narrow for the wall in any case", which a reader takes to mean tablets are fine.

The gate is `(min-width: 600px) and (min-height: 600px)` against the **CSS viewport** (`useWallRoomGate.ts:80-83`). The budget 8-inch Android tablet class lands at **533 or 601** CSS px on its short side depending on OEM density, then loses a further 56–130px to the browser toolbar and the Android status and nav bars. The Fire HD 8 we name in marketing is a 601px device: one pixel of headroom before any chrome exists.

Two independent `600` literals exist for what the docs call "one idea":

| Constant             | File                       | Measures                                  |
| -------------------- | -------------------------- | ----------------------------------------- |
| `WALL_MIN_SIDE_PX`   | `useWallRoomGate.ts:51`    | the **viewport**, via `matchMedia`        |
| `TABLET_MIN_SIDE_PX` | `useWallOrientation.ts:40` | the **device**, via `screen.width/height` |

On a 601px device they actively contradict: the screen test says "tablet, rotate freely" while the viewport test says "too small to be a wall". At 533 they fail in lockstep with no override.

The 600 floor has **no ADR**. Its only record is an addendum in `docs/plans/2026-09-04-dark-mode-remediation.md:84-91`, commit `5a7c55d4`, and `docs/STATUS.md:3441-3448`. `docs/plans/2026-08-31-beanie-wall.md:382` promised `docs/adr/035-wall-display-tier.md`; never written.

### What already works, and must NOT be rebuilt

Reading `wallLayout.ts` changed the shape of this work:

- `daysLayoutFor` clamps to `MIN_DAY_COLUMNS` (3). At 533 portrait it already yields **3 columns at ~120px**, at or above `MIN_READABLE_COLUMN_PX` (120), so every block keeps its title.
- `WallTimeBlock` already has a width-keyed density ladder (`BLOCK_SLIVER_PX` 95, `BLOCK_FULL_PX` 210, `NOW_TAG_MIN_PX`, `META_MIN_HEIGHT_PX`, `FACES_MIN_HEIGHT_PX`).
- `WallViewShell`'s peripheral wrapper is already `shrink`/`overflow-hidden`, so a mis-sized band clips a card rather than painting over the evening.

The wall's **content** already scales. What does not is (a) the gate and (b) the **fixed chrome**: `PAGE_PADDING_PX` 56, the 11.5rem clock reservation, the labelled four-button switcher, and the type scale, which today have exactly one alternative tier keyed on **orientation** (`.wall-portrait`, `BeanieWallPage.vue:1320-1377`) rather than on size.

## Requirements

1. The wall renders on any 8-inch tablet (short side 533 or 601 CSS px), both orientations, on all four surfaces: browser tab, installed PWA, Android app, iOS app.
2. Browser chrome, the Android status and nav bars, and the soft keyboard must not count as "a smaller device".
3. Phones stay refused (430x932 and 852x393 still get the refusal screen).
4. A genuinely small desktop **window** still gets the refusal screen, because there the user can fix it by resizing.
5. The two `600` literals resolve to a single shared source of truth, or differ only for a reason written down beside them.
6. At the smallest admitted size nothing overflows the `overflow-hidden` root, the date is not ellipsised, clock and date do not collide, and every day header sits at 0px offset from the column it names.
7. Requirement 6 continues to hold with Large reading mode on (root scale 1.1875).
8. Refusal copy describes the real test (both axes, not "wider"); `WallSetupCard`, the help article's "Which way up", and `/from/skylight`'s claim all match shipped behaviour.
9. The decision is recorded in an ADR, discharging the one promised at `docs/plans/2026-08-31-beanie-wall.md:382`.
10. `wall_room_gate_closed` still fires on a genuine close and `wall_room_gate_held` still suppresses a keyboard shrink (do not regress `db3a3fb8`).

## Important Notes & Caveats

- **Do not rebuild the column or block-density machinery.** It already works at 533. This is a gate-and-chrome change.
- **The CSS padding and the `wallLayout.ts` arithmetic must be the same number.** If CSS paints 14px of padding while the arithmetic still subtracts 56, `daysLayoutFor` computes columns against a width the wall does not have. This is the single most likely source of a subtle bug here, and §4 removes the possibility structurally rather than by discipline.
- **`.wall-portrait` is orientation-keyed, and an iPad in portrait (810 short side) is not a small tablet.** Do not fold it into the size tier wholesale; keep it for genuinely orientation-specific rules (the band's `grid-cols-2`). Verify iPad portrait has not moved.
- **Lowering the device floor to 500 changes app-wide orientation policy, not just the wall.** `isRotatableFormFactor()` gates `applyOrientationPolicy()` at boot (`main.ts:135`), so devices in (500, 600) — small tablets, and an unfolded foldable's inner screen — will now be allowed to rotate everywhere in the app. This is intended (they are tablets) but it is a deliberate app-wide behaviour change and must be tested, not discovered.
- Never write `:global(.dark) .foo` in a scoped block; use `html.dark .foo`. Every new painted background needs a dark partner, including inline `style` and `<style scoped>` rules.
- The wall's across-the-room type scale legitimately uses custom rem sizes rather than the six-level Tailwind scale — a pre-existing deliberate exception. Do not "fix" it; do not let any value fall below `0.75rem`.
- **Tap targets must not drop below 2.4rem (38px).** A mounted tablet is operated by children standing at it. This is also the floor on shrinking `ARROW_GUTTER_PX`.
- Android native landscape (wall plan phase 8) is **unshipped**; on the installed Android app the wall is portrait-locked, so portrait width is the only axis that matters there today. Do not depend on phase 8.

## Assumptions

> **Review these before implementation.**

1. The TB-8505F is either 533 or 601 CSS px on its short side; density unconfirmed and no public source gives it, so the fix covers both. Asking the reporter to open the wall in **portrait** settles it for free (portrait width is not reduced by browser chrome, so it passes at 601 and fails at 533). Nothing here blocks on the answer.
2. We do not know whether she is in a browser tab, the installed PWA, or the Android app, so all four surfaces are in scope.
3. Chrome for Android's toolbar is ~56dp and the Android status/nav bars ~24dp/~48dp. Used only to justify the _direction_ of the fix; never hardcoded anywhere.
4. `screen.width`/`screen.height` are stable across browser chrome and soft keyboards. **Load-bearing** — verify on a real Android tablet during implementation.
5. No E2E spec covers the wall and there is no 8" screenshot profile, so verification is unit tests plus a driven real-browser pass at pinned viewports.

## Approach

Replace two constants that answer the same question badly with two that answer two different questions honestly, and replace one orientation-keyed CSS tier with one size-keyed density tier.

### 1. One module owns "how much room is there" — `src/components/wall/wallRoom.ts`

```ts
/**
 * Two floors, because there are two different questions.
 *
 * DEVICE: is this a thing that should ever be a wall? Read off `screen`, so a
 * browser toolbar, the Android status and nav bars, and a soft keyboard cannot
 * change the answer. A tablet does not stop being a tablet because Chrome is
 * drawing a toolbar on it. 500 admits the whole 8"/8.7" class (533 and 601) and
 * still refuses every phone (the largest is 430).
 *
 * BOX: can the box we have been handed draw one right now? Read off the
 * viewport. This exists for the desktop window dragged small, where the user can
 * fix it by resizing. Deliberately LOWER than the device floor, because on a
 * fixed-size device the box is the device minus chrome and that is not the
 * user's fault.
 *
 * They are two numbers ON PURPOSE. Collapsing them to one is what produced the
 * bug this module exists to fix.
 */
export const WALL_MIN_DEVICE_SIDE_PX = 500;
export const WALL_MIN_BOX_SIDE_PX = 400;
```

`wallRoom.ts` also hosts the single `screen`-reading function, so the read is not duplicated:

```ts
/**
 * ⚠️ Returns TRUE when `screen` is unavailable or reports zero — "assume
 * capable", matching `useMediaQuery`'s open-by-default stance for the box test.
 * `isRotatableFormFactor` returns FALSE in that case, which is correct for
 * ROTATION (do not unlock what you cannot measure) and wrong for ADMISSION
 * (do not refuse what you cannot measure). Same read, opposite safe default;
 * that difference is the whole reason this is one function with one flag
 * rather than two copies of `screen.width`.
 */
export function deviceShortSidePx(): number | null; // null = unknown
export function deviceCanBeAWall(): boolean; // null → true
export function deviceCanRotate(): boolean; // null → false
```

Admission = `deviceCanBeAWall() && boxCanDrawOne`:

| Case                                | screen short | viewport short | Device ≥500 | Box ≥400 | Result   |
| ----------------------------------- | ------------ | -------------- | ----------- | -------- | -------- |
| Lenovo M8 (hdpi) portrait, browser  | 533          | 533            | ✓           | ✓        | **wall** |
| Lenovo M8 (hdpi) landscape, browser | 533          | ~405           | ✓           | ✓        | **wall** |
| Lenovo M8 (tvdpi) / Fire HD 8       | 601          | ≥473           | ✓           | ✓        | **wall** |
| Galaxy Tab A9 8.7"                  | 533          | ≥405           | ✓           | ✓        | **wall** |
| iPhone 15, either way               | 393          | 393            | ✗           | —        | refused  |
| Large phone 430x932                 | 430          | 430            | ✗           | —        | refused  |
| Desktop, 320px window               | 1080         | 320            | ✓           | ✗        | refused  |
| SSR / jsdom (no `screen`)           | unknown      | —              | ✓           | ✓        | **wall** |

The `(430, 533]` window pinned by the existing `useWallOrientation` tests is satisfied by 500.

`useWallOrientation` drops its private `TABLET_MIN_SIDE_PX` and calls `deviceCanRotate()`. One constant, one read, two documented defaults.

**The keyboard latch.** Moving admission onto `screen` means a soft keyboard can no longer close the gate on a 1280x800 tablet (the `db3a3fb8` case): `screen` does not move, and the reduced viewport still clears 400. On a _small_ tablet a keyboard can still take the box under 400, so the asymmetric latch stays load-bearing there and is kept exactly as-is, all eight tests included. It becomes defence-in-depth on large devices and the primary mechanism only on small ones.

### 2. A size-keyed density tier

```ts
export type WallTier = 'full' | 'mid' | 'compact';

/** Keyed on the wall box's SMALLER side, whichever side that currently is. */
export function wallTierFor(shortSidePx: number): WallTier {
  // Non-finite or zero (pre-layout) → 'full': the least destructive default,
  // and the page's own SSR defaults are 1280x800.
  if (!Number.isFinite(shortSidePx) || shortSidePx <= 0 || shortSidePx >= 720) return 'full';
  return shortSidePx >= 600 ? 'mid' : 'compact';
}
```

`BeanieWallPage` computes `tier` from `Math.min(viewportWidth, viewportHeight)` and binds `:data-tier`. Per the mockup:

| Property          | full (≥720) | mid (600–719) | compact (<600)  |
| ----------------- | ----------- | ------------- | --------------- |
| date              | 2.6rem      | 1.85rem       | 1.45rem         |
| clock reservation | 11.5rem     | 8.5rem        | 5.6rem          |
| clock             | 2.3rem      | 1.7rem        | 1.35rem         |
| day number        | 1.65rem     | 1.35rem       | 1.15rem         |
| block title       | 0.95rem     | 0.9rem        | 0.85rem         |
| tap target        | 2.75rem     | 2.5rem        | 2.4rem          |
| page padding      | 28px        | 20px          | 14px            |
| subtitle          | shown       | shown         | hidden          |
| switcher labels   | shown       | glyph only    | glyph only      |
| peripheral cards  | card row    | card row      | scrolling chips |

Nothing below `0.75rem`; no tap target below `2.4rem`.

### 3. The header wraps before the date dies

The mockup's most valuable finding. Below the threshold the header cannot hold date + navigator + switcher + clock on one row; the date is the only flexible item (`min-w-0 flex-1`) so it absorbs the entire shortfall and collapses to an ellipsis — at 601 portrait, to the single letter "W". The baseline **already** does this at 1280.

The date is the one thing read from the far side of the kitchen, so it keeps its row and the controls take their own. The threshold is **tier-aware**, not width-alone: the full tier still labels its four switcher buttons (~210px) so it runs out at 900, while the glyph-only tiers hold to 700. Wrapping costs a row of height, the scarcest thing on a 533px-tall wall, so it is not spent until the date is at risk.

### 4. One number for the padding, consumed by both CSS and arithmetic

The hazard flagged above, removed structurally. `wallRoom.ts` owns the tier→chrome table; `BeanieWallPage` writes it onto `.wall-root` as custom properties (`--wall-pad`, `--wall-arrow-gutter`), and **CSS reads those same properties**. There is then literally one number per tier, not a CSS copy and a JS copy that can drift.

`wallLayout.ts` stays a **pure width calculator that never learns what a tier is** — it takes the resolved chrome, not the enum:

```ts
export interface WallChrome {
  padding: number;
  arrowGutter: number;
}
function chromeFreeWidth(viewportPx: number, withRail: boolean, chrome: WallChrome): number;
export function daysLayoutFor(viewportPx: number, portrait: boolean, chrome: WallChrome);
export function railFits(viewportPx: number, columns: number, chrome: WallChrome);
```

This keeps the layering honest: `wallRoom` decides tiers, `wallLayout` does arithmetic, neither imports the other's concerns.

`AXIS_WIDTH_PX` stays fixed at 62 for this change. It lives in `wallTimeGrid.ts` and is consumed as an inline style by three components; making it tier-aware widens the blast radius for a gain the padding change already delivers. **Deliberate deferral, recorded in the ADR.**

At 533 portrait with compact chrome: `533 − 28 − 62 − 38` = 405 → clamps to 3 columns at ~135px, comfortably above `MIN_READABLE_COLUMN_PX` (120).

### 5. Copy

- `wall.tooNarrow.title` — retitle to describe the real test rather than "wider".
- `wall.tooNarrow.body` — stop telling someone on a tablet to open it on a tablet; say what did not fit.
- `WallSetupCard` copy / `wallDeviceTips` — keep accurate; no size caveat needed once 8" tablets work.
- `src/content/help/getting-started.ts:942` — the "Which way up" section.
- `web/src/pages/from/skylight.astro:946` — verify the Fire claim is now true; do not edit.

Every touched key needs both `en` and `beanie`, and this is a device/error surface, so the `beanie` value keeps the real nouns ("screen", "device") and only drops case.

### 6. Fold in the owed wake-lock guard

`useWakeLock(SURFACE)` is called unconditionally at `BeanieWallPage.vue:103`, before the gate, so it holds a wake lock on the refusal screen — the item owed since `docs/STATUS.md:3449`. We are editing exactly this component and this is a one-line guard. Leaving it is how owed items become permanent.

### 7. ADR

`docs/adr/037-wall-display-tier.md` (`035` is taken). Records both floors and why they are two numbers, the opposite safe defaults for unknown `screen`, the tier boundaries, the `(430, 533]` constraint, the app-wide orientation consequence, and the `AXIS_WIDTH_PX` deferral. Discharges the ADR promised at `docs/plans/2026-08-31-beanie-wall.md:382`.

## Files Affected

**Created**

- `src/components/wall/wallRoom.ts`
- `src/components/wall/__tests__/wallRoom.test.ts`
- `docs/adr/037-wall-display-tier.md`
- `docs/plans/2026-09-16-wall-small-tablet-tier.md` (this plan)

**Modified**

- `src/composables/useWallRoomGate.ts` — device + box admission; latch unchanged
- `src/composables/useWallOrientation.ts` — drop `TABLET_MIN_SIDE_PX`, call `deviceCanRotate()`
- `src/components/wall/wallLayout.ts` — take `WallChrome` instead of module padding constants
- `src/pages/BeanieWallPage.vue` — tier, `data-tier`, custom properties, wrapping header, refusal copy, wake-lock guard
- `src/components/wall/WallViewShell.vue`, `WallDaysView.vue`, `WallLanesView.vue`, `WallPeripheralCards.vue`, `WallFooter.vue` — consume tier chrome; `WallFooter.vue:50-59`'s prose derivation from "the wall's floor is 600px" is now wrong and must be rewritten
- `src/services/translation/uiStrings.ts` — refusal + setup copy (`en` **and** `beanie`)
- `src/content/help/getting-started.ts` — "Which way up", bump `updatedDate`
- `src/utils/diagnosticContext.ts` — new allowlisted context keys
- `docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro` — data-collection declarations
- `playwright.screenshots.config.ts` — an 8" profile
- Tests: `useWallRoomGate.test.ts`, `useWallOrientation.test.ts`, `wallLayout.test.ts`
- `CHANGELOG.md`, `docs/STATUS.md`

## Help Center Coverage

The work contradicts what an existing article says, so this section applies.

- **Action**: `update existing`
- **Category**: `getting-started`
- **Slug**: `set-up-the-beanie-wall` (`src/content/help/getting-started.ts:772`; "Which way up" at `:935`, paragraph `:942`)
- **Title**: unchanged — "Set up the beanie wall on a tablet"
- **Scope**: The section says "a phone screen is too narrow for the wall in any case, so beanies will tell you it needs a wider screen". The boundary moves: small tablets work, phones still do not. Say which of the reader's devices can be a wall.
- **Notes**: Do not state "500px" — a parent cannot measure it. Frame by device class ("any tablet, including the small 8-inch ones; phones are still too small"). The portrait caveat for the installed Android app stays true and must not be removed (phase 8 unshipped). Bump `updatedDate`.

## Observability Coverage

- **`wall_room_gate_closed`** (`logEvent`, `info`, surface `beanie-wall`) — gains `kind: 'device-too-small' | 'box-too-small'`. Today it says only that the gate closed; the reason this bug needed a research pass is that the event could not say which floor rejected her, or by how much. Context gains `screen_w`, `screen_h`, `viewport_w`, `viewport_h`.
- **`wall_room_gate_held`** — unchanged (`kind: 'text-entry'`).
- **`wall_tier_rendered`** (`logEvent`, `info`, surface `beanie-wall`) — the **success-path** counter, once per wall session, `kind: 'full' | 'mid' | 'compact'` plus the same dimensions. Without it we can count refusals but not the population they came from, which is exactly why nobody noticed a whole device class was being turned away. It is also how we confirm after deploy that the fix reached small tablets.
- **`wall_room_unknown_screen`** (`logEvent`, `warn`) — fires when `screen` is unavailable or reports zero and admission fell back to "assume capable". Without it that fallback is a silent branch, and a webview reporting 0 would look identical to a healthy tablet.
- **Failure modes covered**: refused-when-it-should-draw and drawn-when-it-cannot are separated by `kind` plus four dimensions; a tier mis-assignment shows as a `wall_tier_rendered` whose `kind` disagrees with its dimensions; a keyboard regression shows as `wall_room_gate_closed`/`box-too-small` arriving in bursts. No bare `catch {}`: the gate has no throwing path, `wallTierFor` is total, and the `screen` read is guarded and logged.
- **Critical vs telemetry**: none warrant `severity: 'critical'`. No user action fails and no data is at risk; the wall is a display surface whose fallback is a legible refusal screen. Firehose only, no Slack page.
- **Privacy / store gate**: `screen_w`, `screen_h`, `viewport_w`, `viewport_h` are **new** context keys. Each must be added to `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts`) **and** declared as collected Diagnostics in `docs/runbooks/native-store-submission.md` plus its consumers (`PrivacyInfo.xcprivacy`, the Play Data-Safety and App Store App-Privacy answers, `privacy.astro`). Coarse integers with no identifier value beyond what a UA string already exposes, but they are device characteristics and the declaration is not optional. `kind` is already allowlisted.

## Acceptance Criteria

- [ ] 533x853 and 601x961 render the wall in **both** orientations, not the refusal screen
- [ ] 430x932 and 852x393 still get the refusal screen
- [ ] A desktop window under 400px on its short side still gets the refusal screen
- [ ] With `screen` unavailable or reporting 0, the wall **renders** (assume capable) and `wall_room_unknown_screen` is logged
- [ ] At 533 short side: no overflow on `.wall-root`, date not ellipsised, clock and date do not collide, every day header at 0px offset from its column
- [ ] All of the above with Large reading mode on (root scale 1.1875)
- [ ] iPad portrait (810x1080) and the 1280x800 baseline unchanged except for the header-wrap fix
- [ ] Devices in (500, 600) now rotate app-wide, verified deliberately rather than discovered
- [ ] The CSS padding and the `wallLayout` arithmetic provably read the same number (pinned by test)
- [ ] `useWallOrientation` and `useWallRoomGate` share one device constant; no second literal remains
- [ ] Refusal copy, `WallSetupCard`, help "Which way up", and `/from/skylight`'s claim all match shipped behaviour
- [ ] Every new/changed `uiStrings.ts` key has `en` + `beanie`, and the beanie value keeps the real noun on this device/error surface
- [ ] `db3a3fb8`'s eight latch tests still pass unchanged
- [ ] No wake lock is held on the refusal screen
- [ ] Help Center article updated, `updatedDate` bumped
- [ ] Observability events implemented; new context keys allowlisted **and** declared in the store data-collection table and consumers
- [ ] `docs/adr/037-wall-display-tier.md` written
- [ ] `npm run type-check`, `npm run lint`, full vitest suite pass

## Testing Plan

1. **`wallRoom.test.ts`** — pin the eight-row device table as a data-driven table, admitted/refused each. Pin `wallTierFor` boundaries (599/600, 719/720), zero, and non-finite. Pin the opposite safe defaults: unknown `screen` → `deviceCanBeAWall()` true, `deviceCanRotate()` false.
2. **`useWallRoomGate.test.ts`** — keep all eight latch tests **unchanged** (the `db3a3fb8` regression suite). Add: a 533 device with chrome is admitted; a phone is refused on the device floor; a small desktop window is refused on the box floor. These pin the _numbers_, which the existing suite deliberately does not — and that is why a threshold change currently breaks nothing there, which means it also catches nothing.
3. **`useWallOrientation.test.ts`** — the `:60` case labelled "a 600dp Android tablet, exactly on the threshold" is no longer on the threshold; relabel it and add a real boundary at 499/500. The phone rows (430x932, 393x852) must stay `false` and are the guard on lowering the floor.
4. **`wallLayout.test.ts`** — extend the pinned viewport table with mid and compact chrome, asserting column count and that per-column width stays above `MIN_READABLE_COLUMN_PX`.
5. **CSS/JS agreement test** — mount the wall at each tier and assert the computed `--wall-pad` equals the `WallChrome.padding` the arithmetic used. This is the guard on §4's hazard; without it the two can drift and the only symptom is a slightly wrong column count.
6. **Real-browser pass** (per `docs/lessons.md`: 4563 green tests hid three real defects). Drive Playwright over 533x853, 853x533, 601x961, 961x601, 800x1280, 1280x800, 430x932, 852x393, light and dark, Large reading mode on and off, asserting programmatically: no scroll overflow on `.wall-root`; `.wall-date` `scrollWidth <= clientWidth`; every day header at 0px offset from its column. A guard that cannot fire at the viewport that motivated it is no guard (`docs/lessons.md:484`).
7. **Screenshot profile** — add an 8" profile to `playwright.screenshots.config.ts` (closest today is `tablet7` 720x1280) so this class stays covered.
8. **On-device** — a real Android tablet and an iPad, confirming assumption 4 (`screen` stable across chrome and the soft keyboard), that rotation behaves for a (500,600) device, and that `wall_tier_rendered` reaches CloudWatch with the expected `kind`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup plus a codebase read that changed the shape of the fix — the column and block-density machinery already works at 533, so this is a gate-and-chrome change, not a layout-engine change.
- **Pass 2 (DRY + error handling)**: Caught that `isRotatableFormFactor` returns **false** on unknown `screen` while `useMediaQuery` defaults **true**, so naively sharing the device test would have made the wall refuse to render in SSR/jsdom and in webviews reporting 0; resolved into one guarded read with two documented safe defaults, plus a `wall_room_unknown_screen` event so the fallback is not a silent branch. Also moved the single `screen` read into `wallRoom.ts` rather than leaving two copies.
- **Pass 3 (Sustainability)**: Stopped `wallLayout.ts` learning what a tier is — it now takes a resolved `WallChrome` and stays a pure width calculator — and made CSS and the arithmetic read the _same_ custom property so the padding cannot drift into two numbers, with a test pinning that agreement.
- **Pass 4 (Fresh-eyes sweep)**: Surfaced that lowering the device floor changes **app-wide** orientation policy via `main.ts:135`, not just the wall, and promoted it to an explicit caveat, acceptance criterion and on-device test; folded in the owed `useWakeLock`-on-refusal-screen guard since this change edits that exact component.

> **Process deviation, disclosed:** the skill requires Passes 2–4 to run in fresh `Plan` subagents. Four subagent attempts across three agent types (`Plan` ×2, `general-purpose`, `Explore`) each stalled without returning, so these three passes were run inline in the main thread instead. They were applied with their verbatim lenses and each produced real changes (above), but they did **not** have independent context windows. If you want the discipline re-run properly, the plan file is the input and nothing else needs redoing.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> one of my early adopters is trying to use the wall on a Lenovo TB-8505F tablet and she is saying she gets the message that the screen needs more space - can you check the dimenstions and let me know if this is expected or a bug?

### Follow-up 1 (invoking /beanies-new-issue)

> yes create a high prio issue and move straight to /beanies-pre-plan and /beanies-plan once the plan is done build it directly with /beanies-build-auto. Note that there is a parallel session running that is working on pinterest skill and also ai encryption, so be sure to only touch and commit files you are working on. work autonomously and move all the way through the skills. if you have any questions please ask now then get started.

### Follow-up 2 (answers to the intake questions)

> Scope: "Every 8" tablet, wall scales down" — lower the bar to roughly a 500px short side AND make the wall's lanes/type scale down so it still reads across a room.
> Mockup: Yes.
> GitHub issue: Do not create.
> Her setup: "Don't know / can't ask right now" plus "it must work across all surfaces as the fix is for her but also for all users, ensure it works on ios app as well".

### Follow-up 3 (mockup approval)

> approved, carry on

</details>
