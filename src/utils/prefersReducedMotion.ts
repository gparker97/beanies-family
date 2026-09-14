/**
 * Does this person want motion kept to a minimum?
 *
 * A FUNCTION, not a module-level const, and that matters twice over. The repo's only previous
 * JS check evaluated `matchMedia` once at module load, which freezes the answer for the app's
 * lifetime — wrong after an OS setting change, and un-stubbable in a test without module-cache
 * games. It now gates a deliberate pause in the ingest pipeline and an acceptance criterion, so
 * a test has to be able to set it.
 *
 * CSS handles its own reduced-motion cases via the media query in `style.css`; this is only for
 * the places JS has to decide something — a timing, a transition it drives by hand.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}
