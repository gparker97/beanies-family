/**
 * The only place the promo compositions read brand values from.
 *
 * Mirrors `docs/brand/beanies-cig-v2.html` + `.claude/skills/beanies-theme/SKILL.md`.
 * These are duplicated rather than imported from `src/` on purpose: the promo
 * bundle is compiled by Remotion's webpack under its own tsconfig, and reaching
 * into `src/` would drag the `@/*` alias and the Vue toolchain in with it.
 * Five hex codes are a cheaper coupling than that.
 */
export const COLORS = {
  heritageOrange: '#F15D22',
  deepSlate: '#2C3E50',
  skySilk: '#AED6F1',
  terracotta: '#E67E22',
  cloudWhite: '#F8F9FA',
} as const;

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

/**
 * A phone screen is 1080x1920 (9:16). 0.78 of the canvas height reads as a phone
 * held up beside the caption rather than a wall of screenshot — and, chosen
 * deliberately, leaves the bottom strip clear so the fixed watermark never clips
 * the bezel on either side of an alternating layout.
 */
export const PHONE = {
  height: Math.round(VIDEO.height * 0.78),
  get width() {
    return Math.round((this.height * 1080) / 1920);
  },
} as const;
