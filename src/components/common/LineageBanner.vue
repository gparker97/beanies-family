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
 * ⚠️ WHEN THIS ACTUALLY APPEARS, because the obvious reading is wrong. Coming
 * online after another device compacted does NOT normally raise this banner:
 * `POLICY['adopt-remote']` has no `block` cell at all — a clean device adopts,
 * and a device with unsaved work REBASES, replaying that work onto the compacted
 * file automatically. This banner means one of exactly two things:
 *
 *   1. `conflict` — two devices compacted at the same moment. Nothing can pick
 *      between them, so there is no "use the family file" to offer.
 *   2. The rebase was ATTEMPTED AND COULD NOT RUN (`rebaseUnavailable`), which
 *      happens when this device has no committed remote baseline, or one its own
 *      history does not contain. Without that, "which changes never reached the
 *      file" has no answer, and replaying blind would emit the whole local
 *      document over the compacted one — undoing the compaction.
 *
 * So the copy says beanies could not work out which changes are missing, rather
 * than implying it never tried.
 *
 * ⚠️ THIS COMMENT USED TO CLAIM stage 6 "would shrink case 2 further by carrying
 * local-only entities across". THAT IS FALSE, and it is worth knowing why so
 * nobody re-derives it. `rebaseUnavailable` is set in exactly one place, inside
 * `if (act === 'rebase')`, and `rebase` is reached only from `adopt-remote x dirty`
 * and `adopt-remote x user-file`. The stage-6 carry was scoped to
 * `adopt-remote x clean`. The cells are DISJOINT, so that carry could not affect
 * this banner at all. What would shrink case 2 is a baseline-independent carry on
 * this fallback itself; that has not been designed or decided. See
 * `docs/plans/2026-09-09-stage-6-carry-local-only-entities.md` for the full
 * analysis and for why the first attempt was reverted.
 *
 * ⚠️ TWO VERDICTS, TWO PIECES OF COPY. Case 1 is not recoverable by the person
 * sitting there, and offering the adopt would invite them to discard one of two
 * equally-valid compactions. The banner branches on the store's message KEY
 * rather than on rendered prose, which changes with every wording edit and every
 * language.
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
      <!-- ⚠️ THE WAY FORWARD LEADS. These used to be the other way round, with
           "Export my changes" first, which framed the two as a choice — and only
           one of them goes anywhere. Saving a copy is genuinely secondary: it
           cannot be merged back afterwards, so it is something to READ, not a
           rescue. `subtle` says that without a sentence. -->
      <BannerActionButton v-if="!isConflict" :busy="busy" @click="useTheFamilyFile">
        {{ busy ? t('podLineage.useFileBusy') : t('podLineage.useFileCta') }}
      </BannerActionButton>
      <BannerActionButton v-if="!isConflict" subtle :busy="busy" @click="goToExport">
        {{ t('podLineage.bannerCta') }}
      </BannerActionButton>
      <BannerActionButton subtle @click="dismissed = true">
        {{ t('action.dismiss') }}
      </BannerActionButton>
    </template>
  </ErrorBanner>
</template>
