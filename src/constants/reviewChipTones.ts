/**
 * Chip tones for the import review lists (calendar import, statement import).
 * Each entry pairs a light ground + ink with its dark partner.
 *
 * ⚠️ The text colour is NOT the accent colour. Heritage Orange on its own 50-tint
 * measures 3.06:1, which fails AA for a 12px semibold chip; primary-700 on the
 * same tint is 5.14:1. Dark mode uses the `-lift` accents, which are built for
 * that ladder. Do not "simplify" these to `text-primary-500`.
 *
 * The travel row's chip is deliberately NOT here: it uses a different hue on a
 * different ground, and sharing would restyle that surface for no reason.
 */
export const REVIEW_CHIP_TONES = {
  /** Heritage Orange tint: "sync with Google", repeat pattern, "look familiar". */
  accent: 'bg-primary-50 text-primary-700 dark:bg-accent-lift/15 dark:text-accent-lift',
  /** Sky Silk tint: "copy into beanies", original-currency amount. */
  silk: 'bg-sky-silk-50 text-[#1f5f80] dark:bg-silk-lift/15 dark:text-silk-lift',
  /** De-emphasised: already imported, imported once. */
  muted: 'bg-secondary-50 text-secondary-400 dark:bg-surface-hover dark:text-ink-faint',
} as const;

export type ReviewChipTone = keyof typeof REVIEW_CHIP_TONES;
