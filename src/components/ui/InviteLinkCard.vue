<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

/**
 * Three ADDITIVE optionals so this can serve the magic link as well as an invite, each
 * defaulting to today's string so the invite wizard renders byte-identically.
 *
 * ⚠️ The `alt` and the hint matter as much as the footnote. Shipping only a footnote
 * slot would leave a screen reader announcing "QR code for your invite" on a magic-link
 * card — an accessibility defect, not a copy nit.
 */
withDefaults(
  defineProps<{
    link: string;
    qrUrl: string;
    loading?: boolean;
    /** Override the QR's alt text. */
    qrAlt?: string;
    /** Override the scan/share hint under the QR. */
    hint?: string;
    /** Set false to drop the default expiry footnote (use the `#footnote` slot instead). */
    showDefaultFootnote?: boolean;
  }>(),
  { showDefaultFootnote: true }
);

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
          class="dark:from-surface-overlay/60 dark:via-surface-raised dark:to-surface-overlay/40 rounded-3xl bg-gradient-to-br from-[var(--tint-orange-8)] via-white to-[var(--tint-silk-20)] p-3 shadow-[0_4px_20px_rgba(241,93,34,0.08)]"
        >
          <img
            :src="qrUrl"
            :alt="qrAlt ?? t('invite.qrAlt')"
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
    <p class="dark:text-ink-soft text-center text-sm text-gray-500">
      {{ hint ?? t('family.scanOrShare') }}
    </p>

    <!-- Action slot (share button) -->
    <slot name="actions" />

    <!-- Footnote: the invite's expiry by default, overridable for other link kinds. -->
    <slot name="footnote">
      <p v-if="showDefaultFootnote" class="dark:text-ink-faint text-center text-xs text-gray-400">
        {{ t('family.linkExpiry') }}
      </p>
    </slot>
  </div>
</template>
