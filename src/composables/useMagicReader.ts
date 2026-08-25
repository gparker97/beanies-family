/**
 * "beanies can do magic" — shared gating + cross-boundary dispatch for the two
 * AI document readers (invitation photo → prefilled activity; travel itinerary
 * → prefilled trip). The extraction flows themselves live on the host pages
 * (`handleAddFromPhoto` on FamilyPlannerPage, `handleAddFromDocument` on
 * TravelPlansPage); this module is ONLY the doors + gating.
 *
 * Two parts, mirroring the `useQuickAdd` / `useConfirm` / `useToast`
 * module-singleton idiom already used across the app:
 *
 *  (a) A typed dispatch singleton. `pendingMagic` records which reader a magic
 *      affordance asked for; the host page picks it up via the
 *      `useMagicReaderConsumer` wiring. This lets the GLOBAL FAB card (mounted
 *      at the app shell, outside any page) hand off to a page handler WITHOUT
 *      inventing a second `?action=` query vocabulary. The ref is ephemeral —
 *      set on tap, cleared the instant a page reads it, lost on reload (correct
 *      for a transient button action).
 *
 *  (b) The `useMagicReader()` composable — the single source of truth for the
 *      gating computeds (permission × dev-flag), replacing the per-page
 *      `canAddFromPhoto` / `canAddTravelFromDoc` locals, plus the dispatchers.
 */
import { computed, onMounted, watch, type Ref } from 'vue';
import { ref } from 'vue';
import router from '@/router';
import { usePermissions } from '@/composables/usePermissions';
import { isFlagEnabled } from '@/config/flags';
import {
  closeQuickAdd,
  closeSheetForNavigation,
  hasSheetHistoryMarker,
} from '@/composables/useQuickAdd';

/** Which AI reader an affordance asked to open. */
export type MagicReader = 'photo' | 'document' | 'recipe';

/**
 * One registry per reader, replacing what used to be four parallel structures (the union,
 * a route map, a named opener, and a gating computed) that each needed an edit per reader.
 * A fourth reader is now ONE entry here plus a one-line wrapper.
 *
 * `flag` is optional on purpose: the recipe reader ships UNGATED by explicit decision
 * (greg, #72). Do not add a flag for it — feature gating in this project is by request only.
 */
const MAGIC_READERS: Record<
  MagicReader,
  { route: string; flag?: 'aiPhotoExtract' | 'aiTravelExtract' }
> = {
  photo: { route: '/activities', flag: 'aiPhotoExtract' },
  document: { route: '/travel', flag: 'aiTravelExtract' },
  recipe: { route: '/pod/cookbook' },
};

// --- Module singleton state ------------------------------------------------

/** Set by a magic affordance, consumed once by the destination page. */
const pendingMagic = ref<MagicReader | null>(null);

/**
 * Read-only view for host pages / tests to observe `pendingMagic`. Test-facing:
 * production reads go through `useMagicReaderConsumer`, not this export.
 */
export const pendingMagicReader = computed(() => pendingMagic.value);

/**
 * Open a reader. Records the request (so the destination page's consumer can run
 * the matching handler), closes the quick-add sheet, and routes to the host page.
 *
 * Runs OUTSIDE `setup()` (click handlers), so we use the imported `router`
 * singleton — the same constraint `useQuickAdd` documents. We must mirror
 * `useQuickAdd`'s navigate-from-sheet discipline: `closeQuickAdd()` calls
 * `history.back()` when the sheet pushed a history marker, and doing that
 * alongside a `router.push()` RACES the navigation (the back wins and bounces
 * the user back to the page they were on — see `closeSheetForNavigation`'s note).
 * So:
 *   - cross-page → `closeSheetForNavigation()` (no `history.back()`) + `router`
 *     REPLACE when a sheet marker is present (overwrites the marker entry, no
 *     dead back-stack entry), else PUSH.
 *   - same-page → no navigation needed; setting `pendingMagic` already fires the
 *     page's `watch`. Here `closeQuickAdd()`'s `history.back()` is safe (there is
 *     no competing navigation) and it tidily pops the marker.
 * Navigation errors (cancelled / duplicate) are expected — warn, never throw.
 */
function openReader(reader: MagicReader): void {
  pendingMagic.value = reader;
  const path = MAGIC_READERS[reader].route;
  if (router.currentRoute.value.path === path) {
    closeQuickAdd();
    return;
  }
  const replace = hasSheetHistoryMarker();
  closeSheetForNavigation();
  const go = replace ? router.replace : router.push;
  go.call(router, path).catch((err: unknown) => {
    console.warn('[useMagicReader] navigation swallowed:', err);
  });
}

export function openPhotoReader(): void {
  openReader('photo');
}

export function openDocumentReader(): void {
  openReader('document');
}

export function openRecipeReader(): void {
  openReader('recipe');
}

/**
 * Pick up a pending request for ONE surface. Idempotent: the ref is ALWAYS
 * cleared once it matches this surface — even when the gate is closed — so a
 * stale request can never get stuck or re-fire on the next navigation. Whichever
 * trigger (watch / onMounted) fires first runs the handler; the other no-ops.
 */
export function consumePendingMagic(
  surface: MagicReader,
  handler: () => void,
  gateOpen: boolean
): void {
  if (pendingMagic.value !== surface) return;
  pendingMagic.value = null;
  if (gateOpen) handler();
}

/**
 * Host-page wiring. Call once in a page's setup with its surface, the existing
 * extraction handler, and a reactive gate. Wires BOTH a `watch` (catches the
 * already-on-this-page case, where `router.push` was a no-op) and `onMounted`
 * (catches arriving from another page, where the ref was set before this page
 * mounted) onto the single idempotent `consumePendingMagic`.
 */
export function useMagicReaderConsumer(
  surface: MagicReader,
  handler: () => void,
  gateOpen: Ref<boolean> | (() => boolean)
): void {
  const isOpen = typeof gateOpen === 'function' ? computed(gateOpen) : gateOpen;
  const consume = (): void => consumePendingMagic(surface, handler, isOpen.value);
  watch(pendingMagic, consume);
  onMounted(consume);
}

// --- Composable ----------------------------------------------------------

/**
 * Gating computeds — the single source of truth for whether each reader is
 * available. Each reader is gated by BOTH the activity-edit permission AND its
 * feature flag (issue #31 — the AI readers are the first flag-gated features):
 * `aiPhotoExtract` gates the photo→activity reader, `aiTravelExtract` gates the
 * document→trip reader. `isFlagEnabled` is dev-on for everything (so the readers
 * stay visible while building locally) and reads the committed prod state in
 * production — so a flag committed `false` + deploy is a real prod kill-switch.
 * Flags are reload-to-apply (read once at call time), which is fine here: these
 * computeds re-evaluate on the next load. Consumed by both pages and both magic
 * components; pure, so unit-testable. Also re-exports the dispatchers.
 */
export function useMagicReader() {
  const { canEditActivities } = usePermissions();
  /** Permission × (flag, when the reader declares one). A flagless reader is permission-only. */
  const gate = (reader: MagicReader) =>
    computed(() => {
      const { flag } = MAGIC_READERS[reader];
      return canEditActivities.value && (flag === undefined || isFlagEnabled(flag));
    });
  const canReadPhoto = gate('photo');
  const canReadDocument = gate('document');
  // The cookbook gates its own add/edit affordances on canEditActivities (which is
  // `isOwner || canManagePod || member.canEditActivities` — canManagePod is a strict
  // SUBSET). Gating this reader on canManagePod would hide it from members who are
  // allowed to edit the cookbook.
  const canReadRecipe = gate('recipe');
  const canReadAny = computed(
    () => canReadPhoto.value || canReadDocument.value || canReadRecipe.value
  );
  return {
    canReadPhoto,
    canReadDocument,
    canReadRecipe,
    canReadAny,
    openPhotoReader,
    openDocumentReader,
    openRecipeReader,
  };
}
