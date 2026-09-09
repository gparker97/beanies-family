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
 * ⚠️ IT WAS ONE COMPOSABLE, AND 2026-09-09 SPLIT THE STATE HALF OUT. The reason
 * given for keeping them together was that "these two components are the only
 * ones in the repo that carry a `dismissed` flag AND the only ones that call
 * `useRemoteFileOverLocalDocument`, so the second composable's consumer set is
 * exactly the first's". `PodUnreadableBanner` broke exactly that premise: it
 * carries `dismissed` and its exit is a RETRY, not an adopt. The state half now
 * lives in `useBlockerLatch` and all three banners share it; this file keeps the
 * adopt action and its two message keys, and its exported signature is
 * deliberately unchanged so `LineageBanner` and `LocalDocUnreadableBanner` have a
 * zero-line diff. If either appears in that commit's diff, the split was done
 * wrong.
 */
import { type ComputedRef, type Ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { useBlockerLatch } from '@/composables/useBlockerLatch';
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

  const { blocked, dismissed, busy } = useBlockerLatch(opts.kind);

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
