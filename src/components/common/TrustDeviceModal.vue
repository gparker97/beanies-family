<script setup lang="ts">
/**
 * The trust question. Asked FIRST on the first sign-in of any device that is not trusted
 * and has not answered (2026-09-23, "always ask"), so it renders on `layer="top"` to sit
 * above the onboarding wizard. See `AuthPromptModal` for why the other prompts stay 'base'.
 */
import AuthPromptModal from '@/components/auth/AuthPromptModal.vue';
import { BaseButton } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ trust: []; decline: [] }>();

const { t } = useTranslation();
</script>

<template>
  <AuthPromptModal
    :open="open"
    layer="top"
    :title="t('trust.title')"
    :body="t('trust.description')"
    :footnote="t('trust.hint')"
  >
    <BaseButton variant="primary" @click="emit('trust')">
      {{ t('trust.trustButton') }}
    </BaseButton>
    <BaseButton variant="ghost" @click="emit('decline')">
      {{ t('trust.notNow') }}
    </BaseButton>
  </AuthPromptModal>
</template>
