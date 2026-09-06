<script setup lang="ts">
/**
 * "This device has changes that cannot be combined with the family file."
 *
 * ⚠️ WHY THIS EXISTS AT ALL. The lineage block used to reach the user as a
 * TRANSIENT TOAST over a 3px bar with no text node — so during the first real
 * two-session test greg missed it completely, and reported the block as "the
 * data just didn't sync". A message that says unsaved work is at risk must be
 * dismissed by the PERSON, not by a timer.
 *
 * A thin wrapper over the shared `ErrorBanner` chrome, exactly like
 * `DurabilityBanner` / `SaveFailureBanner` / `PodAccessBanner`, bound to flags
 * that already exist — no new store state beyond the message KEY.
 *
 * ⚠️ TWO VERDICTS, TWO PIECES OF COPY. `adopt-remote` is recoverable by the
 * person sitting there; `conflict` (two devices compacted at the same moment)
 * is not, and offering "Use the family file" would invite them to discard one
 * of two equally-valid reorganisations. The banner branches on the store's
 * message KEY rather than on rendered prose, which changes with every wording
 * edit and every language.
 *
 * ⚠️ AND THE RECOVERY HAS TO ACTUALLY WORK. The first version told the user to
 * export and reload. A reload re-opens the same cached document against the
 * same baseline, so the guard blocks again — forever — and saving cannot
 * resolve it either, because the save path refuses on any remote blocker by
 * design. The second action is the only exit there is.
 *
 * The dismissal is per-SESSION and local to this component on purpose: a lineage
 * block latches for the session and only `clearPodUnopenable` resolves it, so
 * persisting a dismissal would hide a state the user still has to act on.
 *
 * Heritage Orange (`notice`), never Alert Red: nothing has been lost and nothing
 * is being deleted. Red is for destructive confirmations — which is why the
 * discard itself goes through `confirm({ variant: 'danger' })`.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { useSyncStore } from '@/stores/syncStore';

const { t } = useTranslation();
const router = useRouter();
const syncStore = useSyncStore();

const dismissed = ref(false);
const busy = ref(false);
const blocked = computed(
  () => syncStore.podUnopenable && syncStore.backgroundSyncErrorKind === 'lineage'
);
/** Two devices compacted at once. Nothing the user can safely choose between. */
const isConflict = computed(() => syncStore.podBlockMessageKey === 'podLineage.conflictInline');
const title = computed(() =>
  isConflict.value ? t('podLineage.conflictTitle') : t('podLineage.bannerTitle')
);
const message = computed(() =>
  isConflict.value ? t('podLineage.conflictInline') : t('podLineage.bannerMessage')
);

// A NEW block after a dismissal must speak again — the user dismissed the last
// one, not every one. `clearPodUnopenable` is the only thing that clears the
// latch, so this re-arms exactly when the state genuinely resolved.
watch(blocked, (isBlocked) => {
  if (!isBlocked) dismissed.value = false;
});

function goToExport(): void {
  router.push({ path: '/settings', query: { open: 'family-data' } });
}

async function useTheFamilyFile(): Promise<void> {
  // ⚠️ CLAIM `busy` BEFORE THE AWAIT, not after the confirm resolves. Setting it
  // later leaves the whole length of the confirmation dialog unguarded: the
  // button is not disabled yet (`:disabled="busy"`) and the flag is still false,
  // so two clicks open two dialogs and run two adopts. Claiming it here makes
  // the guard and the disabled attribute cover the same window.
  if (busy.value) return;
  busy.value = true;
  try {
    const ok = await confirm({
      title: 'podLineage.useFileConfirmTitle',
      message: 'podLineage.useFileConfirmMessage',
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
    // ⚠️ CATCH, not just `finally`. The store already reports and re-mirrors the
    // latch, but if anything escapes it the banner has ALREADY been removed (the
    // latch was cleared before the download), so a bare `finally` would leave the
    // user believing it worked. `PodAccessBanner` carries the same last-resort
    // guard for the same reason.
    showToast('error', t('podLineage.useFileFailed'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ErrorBanner :show="blocked && !dismissed" severity="notice">
    <template #title>{{ title }}</template>
    <template #message>{{ message }}</template>
    <template #actions>
      <button
        v-if="!isConflict"
        type="button"
        class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 disabled:cursor-not-allowed disabled:bg-white/10"
        :disabled="busy"
        @click="goToExport"
      >
        {{ t('podLineage.bannerCta') }}
      </button>
      <button
        v-if="!isConflict"
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
