/**
 * Publish one element's rendered height as a root CSS custom property, and as a
 * reactive number for JS consumers (#141).
 *
 * The planner's command bar publishes `--planner-cmdbar-h` so the views can dock their
 * column headers under it (`sticky; top: var(--planner-cmdbar-h)`), and the month grid
 * reads the phone tab bar's height to fit six weeks above it. Both used to be (or would
 * have been) a hand-rolled `ResizeObserver` with bespoke cleanup; this observes through
 * `useElementSize`, the one guarded observer, with no mode flag added to it.
 *
 *  - Publishes ON MOUNT and again whenever the measured height changes, so the value is
 *    present even when the first measure reads 0 (and tests are deterministic).
 *  - Publishes `offsetHeight` (border included), the number the command bar always used.
 *  - `publishedHeight(cssVar)` reads the same number reactively, without parsing CSS.
 *  - OWNERSHIP: each instance holds its own token. On unmount it clears the property and
 *    the entry only while it is still the owner, so an overlapping remount (a route
 *    transition that briefly mounts two command bars) cannot wipe the newer one's value.
 *    The last writer wins while both are mounted.
 *  - A failing `setProperty` is caught and reported once per instance
 *    (`publish_height_failed`, naming the var), never thrown out of an observer.
 */
import { onMounted, onScopeDispose, reactive, watch, type Ref } from 'vue';
import { useElementSize } from '@/composables/useElementSize';
import { logEvent } from '@/services/telemetry/logEvent';

const published = reactive(new Map<string, { owner: symbol; px: number }>());

/** The last published height for `cssVar`, in px; 0 when nothing has published it. */
export function publishedHeight(cssVar: string): number {
  return published.get(cssVar)?.px ?? 0;
}

export function usePublishedHeight(
  elRef: Readonly<Ref<HTMLElement | null>>,
  cssVar: string,
  surface: string
): void {
  const owner = Symbol(cssVar);
  const { height } = useElementSize(elRef, { surface });
  let warned = false;

  function publish(): void {
    const el = elRef.value;
    if (!el) return;
    const px = el.offsetHeight;
    published.set(cssVar, { owner, px });
    try {
      document.documentElement.style.setProperty(cssVar, `${px}px`);
    } catch (err) {
      console.warn(`[${surface}] failed to publish ${cssVar}`, err);
      if (warned) return;
      warned = true;
      logEvent({
        level: 'warn',
        surface,
        message: 'publish_height_failed',
        context: { action: 'publish_height', detail: cssVar },
        error: err,
      });
    }
  }

  onMounted(publish);
  watch(height, publish);

  onScopeDispose(() => {
    if (published.get(cssVar)?.owner !== owner) return;
    published.delete(cssVar);
    try {
      document.documentElement.style.removeProperty(cssVar);
    } catch (err) {
      console.warn(`[${surface}] failed to clear ${cssVar}`, err);
    }
  });
}
