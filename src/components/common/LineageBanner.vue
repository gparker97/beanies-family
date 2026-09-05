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
 * that already exist — no new store state.
 *
 * The dismissal is per-SESSION and local to this component on purpose: a lineage
 * block latches for the session and only `clearPodUnopenable` resolves it, so
 * persisting a dismissal would hide a state the user still has to act on.
 *
 * Heritage Orange (`notice`), never Alert Red: nothing has been lost and nothing
 * is being deleted. Red is for destructive confirmations.
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';

const { t } = useTranslation();
const router = useRouter();
const syncStore = useSyncStore();

const dismissed = ref(false);
const blocked = computed(
  () => syncStore.podUnopenable && syncStore.backgroundSyncErrorKind === 'lineage'
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
</script>

<template>
  <ErrorBanner :show="blocked && !dismissed" severity="notice">
    <template #title>{{ t('podLineage.bannerTitle') }}</template>
    <template #message>{{ t('podLineage.bannerMessage') }}</template>
    <template #actions>
      <button
        class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30"
        @click="goToExport"
      >
        {{ t('podLineage.bannerCta') }}
      </button>
      <button
        class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:text-white"
        @click="dismissed = true"
      >
        {{ t('action.dismiss') }}
      </button>
    </template>
  </ErrorBanner>
</template>
