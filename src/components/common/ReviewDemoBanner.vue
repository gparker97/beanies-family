<script setup lang="ts">
/**
 * REVIEW-DEMO: persistent "this is sample data" banner, shown for the whole
 * duration of a seeded demo session. TEMPORARY — see the retirement checklist in
 * `docs/runbooks/native-store-submission.md`.
 *
 * A thin wrapper over the shared `ErrorBanner` chrome, following the
 * `DurabilityBanner` pattern: inline in the app-shell flow (pushes AppHeader
 * down, never overlaps it) and Heritage-Orange `notice` tone — routine status,
 * never Alert Red.
 *
 * No CTA, unlike `DurabilityBanner`: there is nowhere for a reviewer to go, and
 * an action button would imply the demo is a problem to fix.
 */
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { isDemoSession } from '@/utils/reviewDemo';

const { t } = useTranslation();
</script>

<template>
  <ErrorBanner :show="isDemoSession" severity="notice">
    <template #title>{{ t('reviewDemo.bannerTitle') }}</template>
    <template #message>{{ t('reviewDemo.bannerMessage') }}</template>
  </ErrorBanner>
</template>
