<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';

export interface ConfirmDetail {
  label: string;
  value: string;
  highlight?: boolean;
}

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    details: ConfirmDetail[];
    /**
     * When true, render a small text-link below the primary OK button that
     * lets the user immediately start creating a similar item (e.g. another
     * activity on the same day). Used by the planner's batch-create flow —
     * setting up a kid's term-of-school routine often means 4-6 activities
     * back-to-back, and skipping the close → reopen → choose-date dance is
     * meaningful friction relief.
     */
    allowCreateAnother?: boolean;
    /** Custom label for the create-another link (defaults to "+ add another"). */
    createAnotherLabel?: string;
  }>(),
  {
    allowCreateAnother: false,
    createAnotherLabel: '',
  }
);

const emit = defineEmits<{ close: []; 'create-another': [] }>();
const { t } = useTranslation();
</script>

<template>
  <BaseModal :open="open" :title="title" size="sm" layer="overlay" @close="emit('close')">
    <div class="-mt-12 flex flex-col items-center gap-0 text-center">
      <img
        src="/brand/beanies_celebrating_circle_transparent_300x300.png"
        alt=""
        class="-mb-2 w-full max-w-[200px]"
      />
      <p class="font-outfit dark:text-ink text-sm font-semibold text-gray-700">
        {{ message }}
      </p>

      <div
        class="dark:bg-surface-overlay/50 mt-2 w-full rounded-2xl bg-gray-50 px-4 py-3 text-left text-sm"
      >
        <div class="space-y-2">
          <div
            v-for="detail in details"
            :key="detail.label"
            class="flex items-center justify-between"
          >
            <span class="dark:text-ink-faint text-xs text-gray-400">{{ detail.label }}</span>
            <span
              class="font-outfit max-w-[60%] truncate text-right font-semibold"
              :class="detail.highlight ? 'text-[#27ae60]' : 'dark:text-ink text-gray-800'"
            >
              {{ detail.value }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-col items-end gap-2">
        <BaseButton variant="primary" size="sm" @click="emit('close')">
          {{ t('action.ok') }}
        </BaseButton>
        <button
          v-if="allowCreateAnother"
          type="button"
          class="text-secondary-500/55 hover:text-primary-500 font-outfit dark:text-ink-soft text-xs font-semibold transition-colors"
          @click="emit('create-another')"
        >
          {{ createAnotherLabel || t('planner.addAnotherActivity') }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>
