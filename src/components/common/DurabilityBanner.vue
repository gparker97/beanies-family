<script setup lang="ts">
/**
 * Global "local durability broken" banner (#50). A thin wrapper over the shared
 * `ErrorBanner` chrome (the `SaveFailureBanner` pattern) bound to the existing
 * `syncStore.cachePersistFailed` reactive flag — no new state. Renders inline in
 * the app-shell flow (pushes AppHeader down, never overlaps it) so a user who never
 * opens Settings still sees that their device can't save locally. Heritage-Orange
 * `notice` tone (routine, self-recovering status — never Alert Red). The CTA deep-
 * links to the Settings Family-Data modal, which already explains the failure.
 */
import { useRouter } from 'vue-router';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useSyncStore } from '@/stores/syncStore';

const { t } = useTranslation();
const router = useRouter();
const syncStore = useSyncStore();

function goToSettings(): void {
  router.push({ path: '/settings', query: { open: 'family-data' } });
}
</script>

<template>
  <ErrorBanner :show="syncStore.cachePersistFailed" severity="notice">
    <template #title>{{ t('sync.durabilityBannerTitle') }}</template>
    <template #message>{{ t('sync.durabilityBanner') }}</template>
    <template #actions>
      <!-- Neutral-on-orange (NOT SaveFailureBanner's red-on-white — that clashes on orange). -->
      <button
        class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30"
        @click="goToSettings"
      >
        {{ t('sync.durabilityBannerCta') }}
      </button>
    </template>
  </ErrorBanner>
</template>
