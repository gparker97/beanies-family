/**
 * The STATE half of a pod-blocker banner: is this banner's block up, has the
 * user dismissed it, and is its exit in flight.
 *
 * ⚠️ WHY THIS IS ITS OWN FILE. `useBlockerBanner`'s header rejected splitting the
 * adopt action from the banner state, and its reason was sound at the time:
 * "these two components are the only ones in the repo that carry a `dismissed`
 * flag AND the only ones that call `useRemoteFileOverLocalDocument`, so the
 * second composable's consumer set is exactly the first's". `PodUnreadableBanner`
 * is precisely the case that breaks that premise — it carries `dismissed` and it
 * does NOT adopt the family file; its exit is a retry. So the consumer sets are
 * no longer the same set, and the state half is what all three share.
 *
 * ⚠️ AN EXTRACTION, NOT A DISCRIMINATOR. The alternative considered and rejected
 * was an `action:` option on `useBlockerBanner` selecting between adopt and
 * retry. That makes `useTheFamilyFile` a function that sometimes does not use
 * the family file, and it puts one switch arm per future banner into shared
 * code. A fourth banner with a fourth exit needs no edit to this file at all,
 * which is the test a good extension shape has to pass.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useSyncStore, type BackgroundSyncErrorKind } from '@/stores/syncStore';

/**
 * Which blocker kinds the user has dismissed the banner for, right now.
 *
 * ⚠️ MODULE SCOPE, DELIBERATELY, and it exists to close a hole the banner work
 * opened. `BackgroundSyncBar` suppresses its toast for kinds that have a banner —
 * but `dismissed` was a component-local ref, so the bar could not see it. One tap
 * on Dismiss therefore left a session-ending blocker with NO surface at all:
 * the banner hidden by `dismissed`, the toast suppressed by a condition whose own
 * comment claims to check "is a banner ACTUALLY up".
 *
 * A `Set` rather than a ref per component because the reader is a different
 * component from the writer, and the question is about the KIND, not about any
 * one instance of a banner.
 */
const dismissedKinds = new Set<NonNullable<BackgroundSyncErrorKind>>();

/** Has the user dismissed the banner for this kind, for this block? */
export function isBlockerDismissed(kind: NonNullable<BackgroundSyncErrorKind>): boolean {
  return dismissedKinds.has(kind);
}

export interface BlockerLatch {
  /** The pod is latched on THIS banner's kind. */
  blocked: ComputedRef<boolean>;
  /** Dismissed for this block only — a NEW block speaks again. */
  dismissed: Ref<boolean>;
  /** This banner's exit is in flight, including any confirmation dialog's lifetime. */
  busy: Ref<boolean>;
}

export function useBlockerLatch(kind: NonNullable<BackgroundSyncErrorKind>): BlockerLatch {
  const syncStore = useSyncStore();

  const dismissed = ref(dismissedKinds.has(kind));
  const busy = ref(false);
  const blocked = computed(
    () => syncStore.podUnopenable && syncStore.backgroundSyncErrorKind === kind
  );

  // Mirror every dismissal into the module-scope set so the toast layer can see
  // it. `watch` rather than a setter so a banner that assigns `dismissed = true`
  // directly — which all three do — stays correct without changing its template.
  watch(dismissed, (isDismissed) => {
    if (isDismissed) dismissedKinds.add(kind);
    else dismissedKinds.delete(kind);
  });

  // A NEW block after a dismissal must speak again — the user dismissed the last
  // one, not every one. `clearPodUnopenable` is the only thing that clears the
  // latch, so this re-arms exactly when the state genuinely resolved. It lives in
  // the same file as the `blocked` it watches, which is why the two travel
  // together rather than each banner keeping its own copy.
  watch(blocked, (isBlocked) => {
    if (!isBlocked) {
      dismissed.value = false;
      dismissedKinds.delete(kind);
    }
  });

  // `busy` belongs here, not in each banner, because the rule that governs it is
  // the same everywhere and it is easy to get wrong: CLAIM IT BEFORE THE AWAIT.
  // Setting it after a confirm resolves leaves the whole length of the dialog
  // unguarded — the button is not disabled yet and the flag is still false, so
  // two clicks open two dialogs and run two exits.
  return { blocked, dismissed, busy };
}

/** Test-only: drop every recorded dismissal. */
export function __resetBlockerDismissalsForTesting(): void {
  dismissedKinds.clear();
}
