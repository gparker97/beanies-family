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
import type { SharePayload, ShareKind } from '@/types/magicPayload';
import { reportError } from '@/utils/errorReporter';

/** Which AI reader an affordance asked to open. */
export type MagicReader = 'photo' | 'document' | 'recipe';

/**
 * reader → the share kind it consumes, at the TYPE level, so a page's consumer receives
 * exactly its own payload variant and cannot be handed another reader's. Kept in step with
 * `MAGIC_READERS.shareKind` by the totality test.
 */
export interface ReaderShareKind {
  photo: 'event';
  document: 'travel';
  recipe: 'recipe';
}

/** The one payload variant a given reader can ever receive. */
export type PayloadFor<R extends MagicReader> = Extract<SharePayload, { kind: ReaderShareKind[R] }>;

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
  { route: string; flag?: 'aiPhotoExtract' | 'aiTravelExtract'; shareKind: ShareKind }
> = {
  photo: { route: '/activities', flag: 'aiPhotoExtract', shareKind: 'event' },
  document: { route: '/travel', flag: 'aiTravelExtract', shareKind: 'travel' },
  recipe: { route: '/pod/cookbook', shareKind: 'recipe' },
};

/**
 * kind → reader, so a shared document's detected kind resolves to a route + flag + permission
 * through the ONE registry above rather than a second parallel map (#64). The mapping is
 * asserted total and injective by a unit test, so a fourth reader cannot half-land.
 */
export function readerForShareKind(kind: ShareKind): MagicReader {
  const entry = (Object.keys(MAGIC_READERS) as MagicReader[]).find(
    (r) => MAGIC_READERS[r].shareKind === kind
  );
  // Unreachable while the totality test passes; throwing beats returning a wrong reader.
  if (!entry) throw new Error(`No magic reader for share kind "${kind}"`);
  return entry;
}

/**
 * Is this reader available to this member, right now? Permission AND (when the reader
 * declares one) its feature flag.
 *
 * Deliberately a PLAIN function, not a computed: the share orchestrator runs from a native
 * listener, outside any `setup()`. The gating computeds below wrap this same function, so
 * there is exactly one answer to "is this reader available" rather than two that can drift.
 * Availability being permission × flag is also why a member without `canEditActivities` gets
 * an honest "that reader isn't available" message instead of a dead end.
 */
/**
 * `usePermissions()` registers a diagnostic `watch` every time it is called, so calling it
 * per evaluation — which is what a computed getter does — creates a watcher on every
 * invalidation, none of them owned by an effect scope and therefore none ever disposed.
 * Resolved ONCE, lazily: the watch it registers is a whole-app diagnostic that should live
 * for the app's lifetime anyway, and Pinia is not active at module import so it cannot be
 * hoisted to module scope.
 */
let permissions: ReturnType<typeof usePermissions> | null = null;
function sharedPermissions(): ReturnType<typeof usePermissions> {
  permissions ??= usePermissions();
  return permissions;
}

export function isReaderEnabled(reader: MagicReader): boolean {
  const { canEditActivities } = sharedPermissions();
  const { flag } = MAGIC_READERS[reader];
  return canEditActivities.value && (flag === undefined || isFlagEnabled(flag));
}

// --- Module singleton state ------------------------------------------------

/**
 * Set by a magic affordance, consumed once by the destination page.
 *
 * Carries an optional PAYLOAD (#64): a share has already run the extraction, so it hands the
 * typed result over rather than asking the page to open a picker. `openReader()` sets no
 * payload, which is byte-identical to the previous "open the picker" behaviour.
 */
interface PendingMagic {
  reader: MagicReader;
  payload?: SharePayload;
}

const pendingMagic = ref<PendingMagic | null>(null);

/**
 * Read-only view for host pages / tests to observe `pendingMagic`. Test-facing:
 * production reads go through `useMagicReaderConsumer`, not this export.
 */
export const pendingMagicReader = computed(() => pendingMagic.value?.reader ?? null);

/**
 * Drop any un-consumed request.
 *
 * The share orchestrator deliberately does NOT call this: it only ever sets the ref by
 * dispatching, so clearing on a failure path cancelled a magic-reader request the USER had
 * just made from the FAB. Kept because a payload does hold a File until a page reads it, and
 * a future caller that owns the request may legitimately need to drop it — but it must only
 * ever be called by whoever set it.
 */
export function clearPendingMagic(): void {
  pendingMagic.value = null;
}

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
function openReader(reader: MagicReader, payload?: SharePayload): void {
  pendingMagic.value = { reader, payload };
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
 * Hand an already-extracted shared document to the page that owns its review modal (#64).
 *
 * Reuses the SAME channel and the same navigation discipline as the magic affordances —
 * including the cold-start race the consumer already handles — rather than inventing a
 * second dispatch mechanism.
 */
export function dispatchSharePayload(payload: SharePayload): void {
  openReader(readerForShareKind(payload.kind), payload);
}

/**
 * Pick up a pending request for ONE surface. Idempotent: the ref is ALWAYS
 * cleared once it matches this surface — even when the gate is closed — so a
 * stale request can never get stuck or re-fire on the next navigation. Whichever
 * trigger (watch / onMounted) fires first runs the handler; the other no-ops.
 */
export function consumePendingMagic<R extends MagicReader>(
  surface: R,
  handler: (payload?: PayloadFor<R>) => void,
  gateOpen: boolean
): void {
  const pending = pendingMagic.value;
  if (pending?.reader !== surface) return;
  pendingMagic.value = null;

  const payload = pending.payload;
  if (!gateOpen) {
    // Dropping an OPENER here is correct and expected — the affordance is gated, so there is
    // nothing to open. Dropping a PAYLOAD is not: the AI call has already been billed and
    // consent already given, so it must not disappear without a trace.
    if (payload) {
      reportError({
        surface: 'share-target-ingest',
        message: 'extracted share dropped: destination reader closed on arrival',
        severity: 'warning',
        context: { action: 'reader_disabled', kind: payload.kind },
      });
    }
    return;
  }
  if (payload && payload.kind !== MAGIC_READERS[surface].shareKind) {
    // Unreachable while `dispatchSharePayload` routes via `readerForShareKind`, but a
    // mismatch must never be delivered: handing a travel result to the activity form would
    // corrupt the prefill silently. Drop it loudly instead of casting the problem away.
    reportError({
      surface: 'share-target-ingest',
      message: 'share payload kind does not match the reader it reached',
      severity: 'error',
      context: { action: 'threw', kind: payload.kind },
    });
    return;
  }
  handler(payload as PayloadFor<R> | undefined);
}

/**
 * Host-page wiring. Call once in a page's setup with its surface, the existing
 * extraction handler, and a reactive gate. Wires BOTH a `watch` (catches the
 * already-on-this-page case, where `router.push` was a no-op) and `onMounted`
 * (catches arriving from another page, where the ref was set before this page
 * mounted) onto the single idempotent `consumePendingMagic`.
 */
export function useMagicReaderConsumer<R extends MagicReader>(
  surface: R,
  handler: (payload?: PayloadFor<R>) => void,
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
  /** Permission × (flag, when the reader declares one) — one shared predicate, see above. */
  const gate = (reader: MagicReader) => computed(() => isReaderEnabled(reader));
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
