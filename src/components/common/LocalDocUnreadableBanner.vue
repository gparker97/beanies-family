<script setup lang="ts">
/**
 * "beanies could not open this device's own copy of your family data."
 *
 * ⚠️ WHY THIS IS ITS OWN COMPONENT AND NOT A THIRD ARM IN `LineageBanner`.
 * That component's gate is `=== 'lineage'`, its title and message are two-way
 * ternaries on `isConflict`, and its whole doc-comment is about combining
 * histories. A third condition makes all three of those three-way and makes the
 * comment false — a decision nested inside a decision, in a component that
 * already carries two. The house pattern is one thin `ErrorBanner` wrapper per
 * condition (`DurabilityBanner`, `SaveFailureBanner`, `PodAccessBanner`,
 * `LineageBanner`), each small enough to read in one screen and test on its own.
 *
 * ⚠️ AND WHY IT EXISTS AT ALL. When the local cache could not be READ, the app
 * used to treat this device as EMPTY and install the family file wholesale —
 * silently discarding work that had never been saved anywhere, with no banner,
 * no rebase and nothing in the firehose. The refusal that replaced that must be
 * visible, or it is just a quieter version of the same bug. Three review passes
 * of the plan each produced a refusal whose banner could not render; this is the
 * render site, and there is a mounted test that proves it.
 *
 * The reassurance leads because it is both true and the thing the user needs
 * first: nothing has been replaced, their unsaved work is still here.
 *
 * Heritage Orange (`notice`), never Alert Red — nothing is lost and nothing is
 * being deleted. The discard itself goes through `confirm({ variant: 'danger' })`
 * inside the store action, exactly as `LineageBanner` does.
 */
import { computed, ref, watch } from 'vue';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { useSyncStore } from '@/stores/syncStore';

const { t } = useTranslation();
const syncStore = useSyncStore();

const dismissed = ref(false);
const busy = ref(false);
const blocked = computed(
  () => syncStore.podUnopenable && syncStore.backgroundSyncErrorKind === 'local-unreadable'
);

// A NEW block after a dismissal must speak again — the user dismissed the last
// one, not every one. `clearPodUnopenable` is the only thing that clears the
// latch, so this re-arms exactly when the state genuinely resolved.
watch(blocked, (isBlocked) => {
  if (!isBlocked) dismissed.value = false;
});

/**
 * The one exit that does not need another tab closed.
 *
 * ⚠️ IT WORKS ONLY BECAUSE THE REFUSAL SKIPS `chosenByUser`. This calls
 * `useRemoteFileOverLocalDocument`, which re-enters the same load path that
 * raised the block — with `userChoseThisFile: true`. Without that skip in
 * `replaceDocWithCacheRecovery` the one button offered to resolve the block
 * would re-raise it, forever. Same policy as `user-file` everywhere else: a
 * human who has been shown "this will replace what is on this device" and said
 * yes is never blocked.
 */
async function useTheFamilyFile(): Promise<void> {
  // Claim `busy` BEFORE the await, so the confirmation dialog's whole lifetime
  // is guarded rather than just the work after it (see `LineageBanner`).
  if (busy.value) return;
  busy.value = true;
  try {
    const ok = await confirm({
      title: 'podLocalUnreadable.useFileConfirmTitle',
      message: 'podLocalUnreadable.useFileConfirmMessage',
      confirmLabel: 'podLineage.useFileConfirmAction',
      variant: 'danger',
    });
    if (!ok) return;
    const adopted = await syncStore.useRemoteFileOverLocalDocument();
    showToast(
      adopted ? 'success' : 'error',
      t(adopted ? 'podLineage.useFileDone' : 'podLineage.useFileFailed')
    );
  } catch {
    // CATCH, not just `finally`: the latch is cleared before the download, so
    // the banner has already gone and a silent throw would leave the user
    // believing it worked.
    showToast('error', t('podLineage.useFileFailed'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ErrorBanner :show="blocked && !dismissed" severity="notice">
    <template #title>{{ t('podLocalUnreadable.title') }}</template>
    <template #message>{{ t('podLocalUnreadable.inline') }}</template>
    <template #actions>
      <button
        type="button"
        class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 disabled:cursor-not-allowed disabled:bg-white/10"
        :disabled="busy"
        :aria-busy="busy"
        @click="useTheFamilyFile"
      >
        {{ busy ? t('podLineage.useFileBusy') : t('podLineage.useFileCta') }}
      </button>
      <button
        type="button"
        class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/10"
        @click="dismissed = true"
      >
        {{ t('action.dismiss') }}
      </button>
    </template>
  </ErrorBanner>
</template>
