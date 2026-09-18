import { useMediaQuery } from '@/composables/useMediaQuery';
import { type Ref } from 'vue';

/**
 * Reactive "is this device touch-primary?" — true on phones and tablets where touch is the
 * primary input, false on laptops and desktops (even those with touchscreens, because the
 * trackpad/mouse is the primary pointer). Used to gate touch-only affordances without
 * resorting to user-agent sniffing.
 *
 * ⚠️ READS SYNCHRONOUSLY AT SETUP, and that matters now. This used to initialise `false` and
 * only consult `matchMedia` in `onMounted`. That was invisible while callers gated a small
 * camera button, but the cold sign-in surface now INVERTS its whole layout on this value, so
 * a lagging initial read painted the pointer-primary layout on a phone and then swapped it.
 *
 * ⚠️ `useMediaQuery`'s docblock says it was "deliberately NOT adopted" here because these
 * were module-scoped singletons. That was never true of this one — it has always created a
 * fresh ref per call and used component lifecycle hooks — so it adopts cleanly, and that
 * note has been corrected. Because the listener is now scope-disposed, call this from
 * `setup()`; outside an effect scope the teardown is silently skipped.
 */
export function useIsTouchPrimary(): Readonly<Ref<boolean>> {
  return useMediaQuery('(pointer: coarse)', false);
}
