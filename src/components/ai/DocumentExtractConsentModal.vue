<script setup lang="ts">
/**
 * Per-action consent for the photo → activity wedge (#133, ADR-030).
 *
 * Built on BeanieFormModal (the mandated modal hierarchy — never raw BaseModal). The
 * itemised "what / where / after" list is why this is a dedicated modal rather than a
 * useConfirm() call: useConfirm's `detail` is a single untranslated string and can't carry
 * the per-tier translated list. Info-styled and reassuring (no Alert Red — privacy is a
 * calm, deliberate choice, not an alarm). Confirm = @save, cancel/dismiss = @cancel.
 */
import { computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { AiTier } from '@/services/ai/types';

const props = defineProps<{
  open: boolean;
  /** Selected tier — drives the "where it goes" line. */
  tier: AiTier;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const { t } = useTranslation();

const items = computed(() => [
  { icon: '📄', label: t('ai.consent.whatLabel'), value: t('ai.consent.whatValue') },
  {
    icon: '🔒',
    label: t('ai.consent.whereLabel'),
    value: props.tier === 'byok' ? t('ai.consent.whereByok') : t('ai.consent.whereManaged'),
  },
  { icon: '🗑️', label: t('ai.consent.afterLabel'), value: t('ai.consent.afterValue') },
]);
</script>

<template>
  <BeanieFormModal
    variant="modal"
    size="narrow"
    :open="open"
    :title="t('ai.consent.title')"
    icon="📸"
    icon-bg="var(--tint-orange-8)"
    :save-label="t('ai.consent.confirm')"
    @close="emit('cancel')"
    @save="emit('confirm')"
  >
    <p class="font-inter text-sm text-[var(--color-text)] dark:text-gray-200">
      {{ t('ai.consent.intro') }}
    </p>

    <ul class="space-y-3">
      <li v-for="item in items" :key="item.label" class="flex gap-3">
        <span class="text-lg" aria-hidden="true">{{ item.icon }}</span>
        <div class="min-w-0">
          <p
            class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
          >
            {{ item.label }}
          </p>
          <p class="font-inter text-sm text-[var(--color-text)] dark:text-gray-200">
            {{ item.value }}
          </p>
        </div>
      </li>
    </ul>

    <p class="font-inter text-xs text-[var(--color-text-muted)]">
      {{ t('ai.consent.footnote') }}
    </p>
  </BeanieFormModal>
</template>
