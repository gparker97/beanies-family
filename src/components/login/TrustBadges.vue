<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
</script>

<template>
  <div class="mt-6 space-y-3">
    <div class="flex items-start gap-3">
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="mt-0.5 h-5 w-5 flex-shrink-0"
      />
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('auth.securityEncrypted') }}
      </p>
    </div>
    <div class="flex items-start gap-3">
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="mt-0.5 h-5 w-5 flex-shrink-0"
      />
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('auth.securityNoServers') }}
      </p>
    </div>
    <div class="flex items-start gap-3">
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="mt-0.5 h-5 w-5 flex-shrink-0"
      />
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('auth.securityBackup') }}
      </p>
    </div>
  </div>
</template>
