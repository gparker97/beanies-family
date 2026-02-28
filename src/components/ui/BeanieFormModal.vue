<script setup lang="ts">
import BaseModal from './BaseModal.vue';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  open: boolean;
  title: string;
  icon?: string;
  iconBg?: string;
  size?: 'default' | 'narrow';
  saveLabel?: string;
  saveGradient?: 'orange' | 'purple';
  saveDisabled?: boolean;
  isSubmitting?: boolean;
  showDelete?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  icon: undefined,
  iconBg: undefined,
  size: 'default',
  saveLabel: undefined,
  saveGradient: 'orange',
  saveDisabled: false,
  isSubmitting: false,
  showDelete: false,
});

const emit = defineEmits<{
  close: [];
  save: [];
  delete: [];
}>();

const { t } = useTranslation();

const modalSize = props.size === 'narrow' ? 'lg' : 'xl';
</script>

<template>
  <BaseModal
    :open="open"
    :size="modalSize"
    :closable="!isSubmitting"
    fullscreen-mobile
    @close="emit('close')"
  >
    <template #header>
      <div class="flex w-full items-center gap-3">
        <!-- Icon box -->
        <div
          v-if="icon"
          class="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-[14px] text-xl"
          :style="{
            backgroundColor: iconBg || 'var(--tint-orange-8)',
          }"
        >
          {{ icon }}
        </div>
        <!-- Title -->
        <h2
          class="font-outfit flex-1 text-[1.1rem] font-bold text-[var(--color-text)] dark:text-gray-100"
        >
          {{ title }}
        </h2>
      </div>
    </template>

    <!-- Body: Cloud White bg, scrollable -->
    <div class="-mx-6 -my-6 bg-[#F8F9FA] px-6 py-5 dark:bg-slate-800/50">
      <div class="space-y-5">
        <slot />
      </div>
    </div>

    <template #footer>
      <div class="flex items-center gap-3">
        <!-- Delete button (optional) -->
        <button
          v-if="showDelete"
          type="button"
          :aria-label="t('action.delete')"
          class="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-[14px] text-xl transition-all duration-150 hover:scale-105"
          style="background: rgb(239 68 68 / 8%)"
          :disabled="isSubmitting"
          @click="emit('delete')"
        >
          🗑️
        </button>

        <!-- Save button -->
        <button
          type="button"
          class="font-outfit flex-1 rounded-[16px] py-3.5 text-[0.88rem] font-bold text-white shadow-sm transition-all duration-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            saveGradient === 'purple'
              ? 'bg-gradient-to-r from-purple-500 to-purple-400 hover:from-purple-600 hover:to-purple-500'
              : 'from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 bg-gradient-to-r'
          "
          :disabled="saveDisabled || isSubmitting"
          @click="emit('save')"
        >
          <span v-if="isSubmitting" class="flex items-center justify-center gap-2">
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {{ t('common.saving') }}
          </span>
          <span v-else>{{ saveLabel || t('action.save') }}</span>
        </button>
      </div>
    </template>
  </BaseModal>
</template>
