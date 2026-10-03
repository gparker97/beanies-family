/**
 * The magic-beans tile vocabulary, shared by the capture drawer's kind tiles (#108) and the
 * quick-add tiles (#119), so the app has one "selected" look.
 *
 * The selected look is the same light recipe `ChipButton` ships (Heritage Orange text, border
 * and `--tint-orange-8`). On dark the tile sits on `surface-overlay`, so its selected
 * background is the next surface step and the accent takes its `-lift` partner, never a darker
 * orange, per the CIG.
 */
export const MAGIC_TILE_AT_REST =
  'dark:bg-surface-overlay dark:hover:bg-surface-hover border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)]';

export const MAGIC_TILE_SELECTED =
  'border-primary-500 dark:border-accent-lift dark:bg-surface-hover bg-[var(--tint-orange-8)]';

/**
 * The keyboard focus ring every magic-beans and quick-add control shares: Sky Silk, offset from
 * the control, and offset onto the raised card's colour on dark so the gap is not a light slab.
 * A literal string under `src/`, so Tailwind's source scan sees every class.
 */
export const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-silk-300 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-raised';
