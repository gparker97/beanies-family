/**
 * How much room is there, and what should the wall do with it?
 *
 * ## Two floors, because there are two different questions
 *
 * This module exists because there used to be ONE idea ("600px on the smaller
 * side") implemented as TWO literals measured against TWO different things —
 * `WALL_MIN_SIDE_PX` against the viewport and `TABLET_MIN_SIDE_PX` against
 * `screen`. On a device whose screen is 601px they actively contradicted each
 * other: the screen test said "tablet, rotate freely" while the viewport test
 * said "too small to be a wall". An early adopter's 8" Lenovo hit exactly that.
 *
 * The fix is not to pick one measurement. It is to notice that admission is
 * genuinely two questions, and to name them:
 *
 *   DEVICE — is this a thing that should ever be a wall? Read off `screen`, so
 *   a browser toolbar, the Android status and nav bars, and a soft keyboard
 *   cannot change the answer. A tablet does not stop being a tablet because
 *   Chrome is drawing a toolbar on it.
 *
 *   BOX — can the box we have actually been handed draw one right now? Read off
 *   the viewport. This exists for the desktop window that has been dragged
 *   small, where the user can fix it by resizing.
 *
 * They are two numbers ON PURPOSE, and the BOX floor is deliberately the LOWER
 * of the two: on a fixed-size device the box is the device minus chrome, and
 * that is not the user's fault. Collapsing them back into one number is what
 * produced the bug this module exists to fix.
 *
 * @see docs/adr/037-wall-display-tier.md
 * @see docs/plans/2026-09-16-wall-small-tablet-tier.md
 */

/**
 * The smaller side a DEVICE must have before it can be a wall at all.
 *
 * 500 admits the whole budget 8"/8.7" Android tablet class, which lands at
 * either 533 CSS px (hdpi, DPR 1.5 — Lenovo Tab M8, Galaxy Tab A9 8.7") or 601
 * (tvdpi, DPR 1.33 — Amazon Fire HD 8, and the Lenovo on the other density).
 * It still refuses every phone: the largest in the pinned test table is 430.
 *
 * ⚠️ The usable window is (430, 533]. Below 431 it would start admitting large
 * phones; above 533 it stops admitting the hdpi 8" tablets that motivated this.
 * `useWallOrientation`'s phone rows are the guard on the lower bound and must
 * keep failing if this is lowered.
 *
 * This is ALSO the app's tablet threshold for rotation (see `deviceCanRotate`),
 * so "big enough to rotate" and "big enough to be a wall" are now genuinely one
 * constant rather than two literals and a docblock claiming they agree.
 */
export const WALL_MIN_DEVICE_SIDE_PX = 500;

/**
 * The smaller side the VIEWPORT must have before the wall will draw into it.
 *
 * Lower than the device floor on purpose. On a phone-or-tablet the viewport is
 * the screen minus whatever chrome the runtime draws — Chrome for Android's
 * toolbar, the status bar, the nav bar — and refusing a tablet because its
 * browser has a toolbar is the original bug. On a desktop the viewport is the
 * window, which the user chose and can change, so a genuinely tiny window still
 * gets the refusal screen rather than an unreadable wall.
 *
 * 400 clears the worst realistic case: a 533px-short tablet in landscape with a
 * toolbar and both system bars still has roughly 405.
 */
export const WALL_MIN_BOX_SIDE_PX = 400;

/**
 * The device's smaller side in CSS px, or `null` when it cannot be measured.
 *
 * `null` is a real answer, not a failure: SSR and jsdom have no `screen`, and
 * some embedded webviews report 0. The two callers below turn `null` into
 * OPPOSITE defaults, which is the whole reason this returns `null` rather than
 * picking one itself.
 */
export function deviceShortSidePx(): number | null {
  if (typeof screen === 'undefined') return null;
  const { width, height } = screen;
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return Math.min(width, height);
}

/**
 * Is this device one that should ever show a wall?
 *
 * ⚠️ Unknown size → **true**. "Assume capable", matching `useMediaQuery`'s
 * open-by-default `initial` for the box test: the first real measurement
 * corrects it, and the failure mode of guessing wrong is a wall that looks
 * cramped for a frame rather than a wall that never appears. Refusing what we
 * cannot measure would blank the wall in SSR, in jsdom (every component test),
 * and in any webview that reports 0.
 */
export function deviceCanBeAWall(): boolean {
  const side = deviceShortSidePx();
  return side === null || side >= WALL_MIN_DEVICE_SIDE_PX;
}

/**
 * Is this device big enough that landscape is a reasonable way to hold the
 * whole app?
 *
 * ⚠️ Unknown size → **false**, the OPPOSITE default to `deviceCanBeAWall`, and
 * deliberately so. Admission is "do not refuse what you cannot measure"; an
 * orientation unlock is "do not unlock what you cannot measure", because
 * releasing the manifest's portrait lock on something that turns out to be a
 * phone is the 2026-06-12 regression. Same read, two safe defaults, one place.
 */
export function deviceCanRotate(): boolean {
  const side = deviceShortSidePx();
  return side !== null && side >= WALL_MIN_DEVICE_SIDE_PX;
}

/**
 * How dense the wall draws itself.
 *
 * Keyed on SIZE, not orientation. The wall's only other step-down (`.wall-portrait`)
 * is orientation-keyed, which gets it wrong in both directions at once: an iPad
 * in portrait is 810px wide and needs no step-down, while an 8" tablet in
 * landscape is 533px tall and needs one badly.
 */
export type WallTier = 'full' | 'mid' | 'compact';

/**
 * The tier for a wall box of this smaller side.
 *
 * Total: a non-finite, zero or negative input yields `'full'`. That is the
 * least destructive default and it is the pre-layout case — `BeanieWallPage`
 * measures `window.innerWidth/Height` and falls back to 1280x800 under SSR, so
 * a 0 here means "we have not measured yet", not "this screen is tiny".
 */
export function wallTierFor(shortSidePx: number): WallTier {
  if (!Number.isFinite(shortSidePx) || shortSidePx <= 0) return 'full';
  if (shortSidePx >= 720) return 'full';
  return shortSidePx >= 600 ? 'mid' : 'compact';
}

/**
 * The wall's page chrome at a given tier, in px.
 *
 * ⚠️ This is the SINGLE source for these numbers. `BeanieWallPage` writes them
 * onto `.wall-root` as custom properties (`--wall-pad`, `--wall-arrow-gutter`)
 * and the CSS reads those same properties, so the painted padding and the
 * padding `wallLayout` subtracts are provably the same value. Keeping a CSS
 * copy and a JS copy is how `daysLayoutFor` would quietly compute a column
 * count against a width the wall does not have; `wallRoom.test.ts` pins the
 * agreement so the two cannot drift.
 */
export interface WallChrome {
  /** Horizontal page padding, both sides summed. */
  padding: number;
  /** Right gutter the days view reserves for its forward arrow. */
  arrowGutter: number;
}

/**
 * ⚠️ `arrowGutter` never drops below 38px — a 2.4rem tap target, the floor for
 * a wall a child operates standing at it. It is a gutter reserving room for a
 * button, so shrinking it past the button is shrinking the button.
 */
const WALL_CHROME: Readonly<Record<WallTier, WallChrome>> = {
  full: { padding: 56, arrowGutter: 56 },
  mid: { padding: 40, arrowGutter: 44 },
  compact: { padding: 28, arrowGutter: 38 },
};

export function wallChromeFor(tier: WallTier): WallChrome {
  return WALL_CHROME[tier] ?? WALL_CHROME.full;
}
