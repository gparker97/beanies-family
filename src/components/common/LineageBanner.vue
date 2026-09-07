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
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import BannerActionButton from '@/components/common/BannerActionButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useBlockerBanner } from '@/composables/useBlockerBanner';
import { useSyncStore } from '@/stores/syncStore';

const { t } = useTranslation();
const router = useRouter();
const syncStore = useSyncStore();

// The banner state and the adopt action, shared verbatim with
// `LocalDocUnreadableBanner` — see `useBlockerBanner`'s header for why the
// BEHAVIOUR is shared while the two components stay separate.
const { blocked, dismissed, busy, useTheFamilyFile } = useBlockerBanner({
  kind: 'lineage',
  confirmTitleKey: 'podLineage.useFileConfirmTitle',
  confirmMessageKey: 'podLineage.useFileConfirmMessage',
});

/** Two devices compacted at once. Nothing the user can safely choose between. */
const isConflict = computed(() => syncStore.podBlockMessageKey === 'podLineage.conflictInline');
const title = computed(() =>
  isConflict.value ? t('podLineage.conflictTitle') : t('podLineage.bannerTitle')
);
const message = computed(() =>
  isConflict.value ? t('podLineage.conflictInline') : t('podLineage.bannerMessage')
);

function goToExport(): void {
  router.push({ path: '/settings', query: { open: 'family-data' } });
}
</script>

<template>
  <ErrorBanner :show="blocked && !dismissed" severity="notice">
    <template #title>{{ title }}</template>
    <template #message>{{ message }}</template>
    <template #actions>
      <BannerActionButton v-if="!isConflict" :busy="busy" @click="goToExport">
        {{ t('podLineage.bannerCta') }}
      </BannerActionButton>
      <BannerActionButton v-if="!isConflict" :busy="busy" @click="useTheFamilyFile">
        {{ busy ? t('podLineage.useFileBusy') : t('podLineage.useFileCta') }}
      </BannerActionButton>
      <BannerActionButton subtle @click="dismissed = true">
        {{ t('action.dismiss') }}
      </BannerActionButton>
    </template>
  </ErrorBanner>
</template>
