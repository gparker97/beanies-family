# ADR-037: The beanie wall's display tier — two floors, and a size-keyed density

> Status: Accepted
> Date: 2026-09-16
> Supersedes: the single 600px floor introduced in `5a7c55d4`
> Related: [`docs/plans/2026-09-16-wall-small-tablet-tier.md`](../plans/2026-09-16-wall-small-tablet-tier.md), Notion tracker #96

## Context

`docs/plans/2026-08-31-beanie-wall.md:382` promised an ADR for the wall's display tier. It was never written, so the only record of the 600px floor was an addendum inside an unrelated dark-mode plan (`docs/plans/2026-09-04-dark-mode-remediation.md:84-91`), a commit body, and a docblock. This ADR discharges that debt and records the decision that replaced it.

An early adopter mounted a Lenovo Tab M8 (TB-8505F, 8", 800x1280) and got "The wall needs a wider screen". She had done exactly what the product asks: `WallSetupCard` says "Turn a spare tablet into the family wall display", and `/from/skylight` promises "Any tablet with a browser works: iPad, Android, Fire, the one with the cracked corner."

The admission gate was `(min-width: 600px) and (min-height: 600px)` against the **CSS viewport**. The budget 8-inch Android tablet class lands at 533 or 601 CSS px on its short side depending on the density the OEM shipped, and then loses a further 56–130px of that to the browser toolbar and the Android status and nav bars. The Fire HD 8 we name by name in marketing is a 601px device: one pixel of headroom before any chrome exists.

Worse, there were **two** independent `600` literals for what the docs called "one idea":

| Constant             | File                    | Measured against                      |
| -------------------- | ----------------------- | ------------------------------------- |
| `WALL_MIN_SIDE_PX`   | `useWallRoomGate.ts`    | the viewport, via `matchMedia`        |
| `TABLET_MIN_SIDE_PX` | `useWallOrientation.ts` | the device, via `screen.width/height` |

On a 601px device they actively contradicted each other: the screen test said "tablet, rotate freely" while the viewport test said "too small to be a wall". At 533 they failed in lockstep with no override.

## Decision

### 1. Admission is two questions, not one

They live in `src/components/wall/wallRoom.ts`:

- **`WALL_MIN_DEVICE_SIDE_PX = 500`** — read off `screen`. "Is this a thing that should ever be a wall?" Immune to browser chrome, system bars and soft keyboards by construction. This is what refuses a phone.
- **`WALL_MIN_BOX_SIDE_PX = 400`** — read off the viewport. "Can the box we have been handed draw one right now?" This is what refuses a desktop window someone dragged small, where they can fix it by resizing.

The box floor is deliberately the **lower** of the two. On a fixed-size device the box is the device minus chrome, and that is not the user's fault. Collapsing them back to one number is the bug.

**The device floor is constrained to (430, 533].** 430 is the largest phone in the pinned test table; 533 is the smallest tablet we mean to admit. `wallRoom.test.ts` asserts the constant stays inside that window, so a future change that would start admitting phones fails with an explanation.

### 2. An unmeasurable device gets opposite defaults

`screen` is absent under SSR and in jsdom, and some embedded webviews report 0. One guarded read, two callers, two safe defaults:

- `deviceCanBeAWall()` → **true**. Do not refuse what you cannot measure. Refusing would blank the wall in SSR, in every component test, and in any webview reporting 0. It matches `useMediaQuery`'s open-by-default `initial`.
- `deviceCanRotate()` → **false**. Do not unlock what you cannot measure. Releasing the manifest's portrait lock on something that turns out to be a phone is the 2026-06-12 regression.

A `wall_room_unknown_screen` warning fires on that path, so the fallback is a visible decision rather than a silent branch.

### 3. Density is keyed on size, not orientation

`wallTierFor(shortSidePx)` returns `full` (≥720), `mid` (600–719) or `compact` (<600), and the wall binds it as `data-tier`. Every value that steps between tiers is a custom property.

The wall's previous step-down was `.wall-portrait`, keyed on **orientation**, which gets it wrong in both directions at once: an iPad in portrait is 810px wide and never needed it, while an 8" tablet in **landscape** is 533px tall and never got it. `.wall-portrait` survives only for genuinely orientation-specific rules.

### 4. One number for the page chrome

`wallChromeFor(tier)` is the single source for the page padding and arrow gutter. `BeanieWallPage` writes them onto `.wall-root` as `--wall-pad` / `--wall-arrow-gutter` **and** passes the same object to `daysLayoutFor`/`railFits`. CSS and the column arithmetic therefore read one value.

A CSS copy and a JS copy would drift, and the only symptom would be a column count computed against a width the wall does not have — invisible, because `.wall-root` is `overflow-hidden` and clips its own mistakes tidily.

`wallLayout.ts` takes a resolved `WallChrome` and **never learns what a tier is**. It stays pure arithmetic about widths.

### 5. The header wraps rather than truncating the date

The date is the one thing on the wall read from the far side of the kitchen. It was `flex-1 min-w-0`, the only flexible item in a row of fixed-width controls, so it absorbed every shortfall and ellipsised — at 601px wide, down to the single letter "W". Even the 1280px baseline was already truncating.

The header now wraps and the date carries a `min-width` in `ch`, which scales with the tier's own font-size for free. The controls drop to their own row exactly when they no longer fit beside a legible date.

**No breakpoint.** An earlier attempt used tier-aware `max-width` media queries and was wrong twice over: the tier is keyed on the short side, so a 961x601 wall is the `mid` tier at a width no width-keyed rule ever caught, and the date truncated anyway. The question is not "how wide is the wall" but "does the date still fit", and flexbox can answer that itself.

## Consequences

**Every 8" and 8.7" tablet now gets a wall**, in both orientations, on all four surfaces.

**Rotation changes app-wide, not just on the wall.** `isRotatableFormFactor()` gates `applyOrientationPolicy()` at boot from `main.ts:135`, so devices between 500 and 600 on their smaller side — small tablets, and an unfolded foldable's inner screen — now rotate freely everywhere in the app. This is intended: they are tablets, and a mounted wall tablet must be able to be landscape. It is pinned by tests rather than left to be discovered.

**The keyboard latch is no longer load-bearing on large tablets.** Moving admission onto `screen` means a soft keyboard cannot close the gate on a 1280x800 tablet (the `db3a3fb8` case): `screen` does not move, and the reduced viewport still clears 400. On a _small_ tablet a keyboard can still take the box under 400, so the asymmetric latch stays, unchanged and fully tested. It is now defence-in-depth on large devices and the primary mechanism only on small ones.

**The 1280x800 baseline gained a header row** and lost its truncated date. That is the trade, and it is the right way round.

**Telemetry gained four coarse context keys** (`viewport_w`, `viewport_h`, `screen_w`, `screen_h`) plus a success-path `wall_tier_rendered` counter. The old event could say only _that_ the gate closed, never which floor rejected the device — which is why this bug needed a research pass instead of a CloudWatch filter. It also fired only on a _transition_, so a refusal that was true from the first evaluation (the reported case) produced no telemetry at all. Both are fixed. The keys are declared to Apple and Google as collected Diagnostics.

## Alternatives considered

**One floor, measured on the viewport, lowered to ~400.** Rejected: it would admit a 400px-wide desktop window and a phone in landscape, both of which draw an unreadable wall. The device question and the box question genuinely differ.

**One floor, measured on `screen` only.** Rejected: on a desktop, `screen` is the monitor, so every window would be admitted however small.

**Scoping the change to the wall and leaving rotation at 600.** Rejected: it would admit a 533px tablet to the wall and then hold it portrait-locked, unable to be mounted landscape, and would recreate the two-numbers-for-one-idea defect this ADR exists to remove.

**Making `AXIS_WIDTH_PX` tier-aware too.** Deferred. It lives in `wallTimeGrid.ts` and is consumed as an inline style by three components; the blast radius is larger than the gain, which the padding change already delivers.
