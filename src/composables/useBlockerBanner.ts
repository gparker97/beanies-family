/**
 * The behaviour behind a pod-blocker banner: is it showing, has it been
 * dismissed, and the one exit that adopts the family file.
 *
 * ⚠️ WHAT IS SHARED IS BEHAVIOUR, NOT MARKUP. `LineageBanner` and
 * `LocalDocUnreadableBanner` stay separate components — the house pattern is one
 * thin `ErrorBanner` wrapper per condition, each readable in one screen, and
 * `LocalDocUnreadableBanner`'s own header explains why folding it into the other
 * would nest a decision inside a decision. What WAS duplicated, verbatim, is
 * everything below: the same `dismissed`/`blocked`/re-arm block, and the same
 * busy-guard → confirm → adopt → toast → catch → finally, differing only in two
 * message keys.
 *
 * ⚠️ ONE COMPOSABLE, NOT TWO. Splitting the adopt action from the banner state
 * was considered and rejected: these two components are the only ones in the
 * repo that carry a `dismissed` flag AND the only ones that call
 * `useRemoteFileOverLocalDocument`, so the second composable's consumer set is
 * exactly the first's, and its output is only ever read alongside the first's
 * (`:show="blocked && !dismissed"`, `:disabled="busy"`). A file that buys
 * nothing is a file to maintain.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { useSyncStore, type BackgroundSyncErrorKind } from '@/stores/syncStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface BlockerBanner {
  /** The pod is latched on THIS banner's kind. */
  blocked: ComputedRef<boolean>;
  /** Dismissed for this block only — a NEW block speaks again. */
  dismissed: Ref<boolean>;
  /** An adopt is in flight, including the confirmation dialog's lifetime. */
  busy: Ref<boolean>;
  useTheFamilyFile: () => Promise<void>;
}

export function useBlockerBanner(opts: {
  kind: NonNullable<BackgroundSyncErrorKind>;
  confirmTitleKey: UIStringKey;
  confirmMessageKey: UIStringKey;
}): BlockerBanner {
  const { t } = useTranslation();
  const syncStore = useSyncStore();

  const dismissed = ref(false);
  const busy = ref(false);
  const blocked = computed(
    () => syncStore.podUnopenable && syncStore.backgroundSyncErrorKind === opts.kind
  );

  // A NEW block after a dismissal must speak again — the user dismissed the last
  // one, not every one. `clearPodUnopenable` is the only thing that clears the
  // latch, so this re-arms exactly when the state genuinely resolved. It lives in
  // the same file as the `blocked` it watches, which is half the reason the two
  // halves are one composable.
  watch(blocked, (isBlocked) => {
    if (!isBlocked) dismissed.value = false;
  });

  /**
   * Adopt the family file over this device's document.
   *
   * ⚠️ IT WORKS ONLY BECAUSE THE REFUSAL SKIPS `chosenByUser`. This re-enters the
   * same load path that raised the block, with `userChoseThisFile: true`. Without
   * that skip in `replaceDocWithCacheRecovery`, the one button offered to resolve
   * the block would re-raise it, forever. Same policy as `user-file` everywhere
   * else: a human shown "this will replace what is on this device" who says yes
   * is never blocked.
   */
  async function useTheFamilyFile(): Promise<void> {
    // ⚠️ CLAIM `busy` BEFORE THE AWAIT, not after the confirm resolves. Setting
    // it later leaves the whole length of the confirmation dialog unguarded: the
    // button is not disabled yet and the flag is still false, so two clicks open
    // two dialogs and run two adopts.
    if (busy.value) return;
    busy.value = true;
    try {
      const ok = await confirm({
        title: opts.confirmTitleKey,
        message: opts.confirmMessageKey,
        confirmLabel: 'podLineage.useFileConfirmAction',
        variant: 'danger',
      });
      if (!ok) return;
      // The store reports its own failure to the firehose; the toast is what the
      // person in front of the screen needs, because the banner has already gone.
      const adopted = await syncStore.useRemoteFileOverLocalDocument();
      showToast(
        adopted ? 'success' : 'error',
        t(adopted ? 'podLineage.useFileDone' : 'podLineage.useFileFailed')
      );
    } catch {
      // ⚠️ CATCH, not just `finally`. The latch is cleared BEFORE the download,
      // so by the time anything escapes, the banner has already gone — and a
      // bare `finally` would leave the user believing it worked.
      showToast('error', t('podLineage.useFileFailed'));
    } finally {
      busy.value = false;
    }
  }

  return { blocked, dismissed, busy, useTheFamilyFile };
}
