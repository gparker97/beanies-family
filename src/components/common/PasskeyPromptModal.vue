<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import { BaseButton } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ enable: []; decline: [] }>();

const { t } = useTranslation();
</script>

<template>
  <BaseModal :open="open" size="sm" :closable="false">
    <div class="text-center">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-4 h-16 w-16"
      />
      <h2 class="font-outfit mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ t('passkey.promptTitle') }}
      </h2>
      <p class="mb-6 text-sm text-gray-600 dark:text-gray-400">
        {{ t('passkey.promptDescription') }}
      </p>
      <div class="flex flex-col gap-3">
        <BaseButton variant="primary" @click="emit('enable')">
          {{ t('passkey.promptEnable') }}
        </BaseButton>
        <BaseButton variant="ghost" @click="emit('decline')">
          {{ t('passkey.promptDecline') }}
        </BaseButton>
      </div>
      <p class="mt-4 text-xs text-gray-400 dark:text-gray-500">
        {{ t('passkey.promptHint') }}
      </p>
    </div>
  </BaseModal>
</template>
