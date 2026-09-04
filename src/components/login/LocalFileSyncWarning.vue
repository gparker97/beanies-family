<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';

/**
 * Confirmation modal shown when the user picks "local file" on the create-pod
 * storage step. Frames the real trade-off (a local file doesn't sync with the
 * family and has to be shared manually), nudges back toward Google Drive, and
 * is never a trap — the modal's × returns to the storage picker.
 *
 * Used by `CreatePodView`'s "Save & Secure" step. The primary "Use Google
 * Drive instead" action is hidden when Drive isn't available (a self-host
 * without an OAuth proxy), so there's never a no-op button.
 */
defineProps<{
  open: boolean;
  googleDriveAvailable: boolean;
}>();

const emit = defineEmits<{
  close: [];
  proceed: [];
  'use-google-drive': [];
}>();

const { t } = useTranslation();
</script>

<template>
  <BaseModal :open="open" size="sm" @close="emit('close')">
    <div class="p-5">
      <div class="mb-3 flex items-center gap-3">
        <div
          class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[13px] text-xl"
          style="background: var(--tint-orange-8)"
          aria-hidden="true"
        >
          {{ '💾' }}
        </div>
        <h3 class="font-outfit dark:text-ink text-base leading-snug font-bold text-gray-900">
          {{ t('storage.localFileWarningTitle') }}
        </h3>
      </div>
      <p class="dark:text-ink-soft mb-2.5 text-sm leading-relaxed text-gray-600">
        {{ t('storage.localFileWarning') }}
      </p>
      <p class="dark:text-ink-soft mb-2.5 text-sm leading-relaxed text-gray-500">
        <span aria-hidden="true">{{ '💻' }}</span> {{ t('storage.localFileBestOnDesktop') }}
      </p>
      <p class="dark:text-ink-soft mb-4 text-sm leading-relaxed text-gray-500">
        🔒 {{ t('storage.localFileWarningEncryption') }}
      </p>
      <div class="space-y-2">
        <BaseButton v-if="googleDriveAvailable" class="w-full" @click="emit('use-google-drive')">
          {{ t('storage.useGoogleDriveInstead') }}
        </BaseButton>
        <BaseButton
          :variant="googleDriveAvailable ? 'ghost' : 'primary'"
          :size="googleDriveAvailable ? 'sm' : 'md'"
          class="w-full"
          @click="emit('proceed')"
        >
          {{ t('storage.localFileContinue') }}
        </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
