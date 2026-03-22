<script setup lang="ts">
import { computed } from 'vue';
import BaseModal from './BaseModal.vue';
import BaseSidePanel from './BaseSidePanel.vue';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  open: boolean;
  title: string;
  icon?: string;
  iconBg?: string;
  size?: 'default' | 'narrow' | 'wide' | 'full';
  saveLabel?: string;
  saveGradient?: 'orange' | 'purple' | 'teal';
  saveDisabled?: boolean;
  isSubmitting?: boolean;
  showDelete?: boolean;
  /** When true, uses the #custom-header slot edge-to-edge (no padding/border). Modal only. */
  customHeader?: boolean;
  /** Render as a centered modal or a right-side drawer. */
  variant?: 'modal' | 'drawer';
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
  customHeader: false,
  variant: 'modal',
});

const emit = defineEmits<{
  close: [];
  save: [];
  delete: [];
}>();

const { t } = useTranslation();

const containerComponent = computed(() => (props.variant === 'drawer' ? BaseSidePanel : BaseModal));

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
type DrawerSize = 'narrow' | 'medium' | 'wide' | 'full';

const modalSizeMap: Record<string, ModalSize> = {
  narrow: 'lg',
  default: 'xl',
  wide: '2xl',
};

const drawerSizeMap: Record<string, DrawerSize> = {
  narrow: 'narrow',
  default: 'medium',
  wide: 'wide',
  full: 'full',
};

const containerProps = computed(() => {
  if (props.variant === 'drawer') {
    return {
      open: props.open,
      size: drawerSizeMap[props.size] ?? ('medium' as DrawerSize),
      closable: !props.isSubmitting,
    };
  }
  return {
    open: props.open,
    size: modalSizeMap[props.size] ?? ('xl' as ModalSize),
    closable: !props.isSubmitting,
    fullscreenMobile: true,
    customHeader: props.customHeader,
  };
});
</script>

<template>
  <component :is="containerComponent" v-bind="containerProps" @close="emit('close')">
    <template #header>
      <slot v-if="customHeader && variant === 'modal'" name="custom-header" />
      <div v-else class="flex w-full items-center gap-3">
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
          class="font-outfit flex-1 text-lg font-bold text-[var(--color-text)] dark:text-gray-100"
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
        <!-- Delete button (optional) — always leftmost -->
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

        <!-- Extra footer actions (slot) -->
        <slot name="footer-start" />

        <!-- Save button -->
        <button
          type="button"
          class="font-outfit flex-1 rounded-[16px] py-3.5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            saveGradient === 'purple'
              ? 'bg-gradient-to-r from-purple-500 to-purple-400 hover:from-purple-600 hover:to-purple-500'
              : saveGradient === 'teal'
                ? 'bg-gradient-to-r from-[#00B4D8] to-[#0096B7] hover:from-[#0096B7] hover:to-[#007A96]'
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
  </component>
</template>
