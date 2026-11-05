/**
 * Calendar drag and drop (#142): the ONE drop-target ring, for every surface a lifted item
 * can land on (a timeline slot preview, the week's all-day cells, a week-strip pill). The
 * meal board's ring (`MealSlotCell`) in semantic tokens: Heritage Orange with its dark lift,
 * over the orange wash, which has its own dark value (`--tint-orange-15`, `style.css`).
 * Inset, so it never shifts layout or spills over a neighbour. A literal string, so
 * Tailwind's source scan sees every class.
 */
export const DROP_TARGET_RING =
  'ring-primary-500 dark:ring-accent-lift bg-[var(--tint-orange-15)] ring-2 ring-inset';
