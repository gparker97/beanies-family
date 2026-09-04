<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

/**
 * Inline hint shown to non-admin members on family-shared Settings sections
 * (currency, country/holidays, week-start). The controls themselves render
 * disabled; this explains why and points the user at someone who can change it.
 * Presentational only — visibility is the caller's concern (`v-if="!canManagePod"`).
 */
const { t } = useTranslation();
</script>

<template>
  <p class="dark:text-ink-soft flex items-start gap-1.5 text-xs text-gray-500">
    <span aria-hidden="true">🔒</span>
    <span>{{ t('settings.adminOnly') }}</span>
  </p>
</template>
