<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

defineProps<{
  link: string;
  qrUrl: string;
  loading?: boolean;
}>();

const { t } = useTranslation();
</script>

<template>
  <div class="space-y-4">
    <!-- QR Code with branded frame -->
    <div v-if="loading" class="flex items-center justify-center py-6">
      <div
        class="border-t-primary-500 h-6 w-6 animate-spin rounded-full border-2 border-gray-300"
      />
    </div>
    <div v-else-if="qrUrl" class="flex justify-center">
      <div class="relative inline-block">
        <!-- Warm gradient frame -->
        <div
          class="rounded-3xl bg-gradient-to-br from-[var(--tint-orange-8)] via-white to-[var(--tint-silk-20)] p-3 shadow-[0_4px_20px_rgba(241,93,34,0.08)] dark:from-slate-700/60 dark:via-slate-800 dark:to-slate-700/40"
        >
          <img
            :src="qrUrl"
            alt="Invite QR code"
            class="h-48 w-48 rounded-2xl"
            data-testid="invite-qr"
          />
        </div>
        <!-- Corner accent dots -->
        <div class="bg-primary-500/20 absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full" />
        <div
          class="absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full bg-[var(--color-sky-silk-300)]/30"
        />
      </div>
    </div>

    <!-- Scan/share hint -->
    <p class="text-center text-sm text-gray-500 dark:text-gray-400">
      {{ t('family.scanOrShare') }}
    </p>

    <!-- Action slot (share button) -->
    <slot name="actions" />

    <!-- Expiry note -->
    <p class="text-center text-xs text-gray-400 dark:text-gray-500">
      {{ t('family.linkExpiry') }}
    </p>
  </div>
</template>
