<script setup lang="ts">
import { BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ShareChannelGrid from '@/components/family/ShareChannelGrid.vue';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{
  open: boolean;
  link: string;
  familyName: string;
  memberName: string;
  /**
   * Optional title override — used when this modal is reused outside
   * the per-bean share context (e.g. the join-flow "Continue on
   * another device" recovery). Falls back to `share.title`.
   */
  title?: string;
  /** Optional subtitle override. Falls back to `share.subtitle`. */
  subtitle?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <BaseModal :open="open" size="sm" layer="overlay" custom-header @close="emit('close')">
    <template #header>
      <!-- Warm branded hero header -->
      <div
        class="relative overflow-hidden rounded-t-3xl border-b border-[var(--color-sky-silk-300)]/30 dark:border-slate-600/50"
      >
        <!-- Background gradient -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-[var(--tint-orange-8)] via-[var(--tint-silk-10)] to-[var(--tint-orange-4)] dark:from-slate-700/80 dark:via-slate-800 dark:to-slate-700/60"
        />

        <!-- Decorative dots -->
        <div
          class="bg-primary-500/10 absolute top-2 left-3 h-1.5 w-1.5 rounded-full dark:bg-orange-400/15"
        />
        <div
          class="absolute top-4 right-12 h-1.5 w-1.5 rounded-full bg-[var(--color-sky-silk-300)]/30 dark:bg-sky-300/20"
        />
        <div
          class="bg-primary-500/8 absolute bottom-2 left-6 h-2 w-2 rounded-full dark:bg-orange-400/10"
        />

        <!-- Content -->
        <div class="relative flex items-center gap-3 px-5 py-3">
          <!-- Close button -->
          <button
            type="button"
            class="absolute top-2 right-2 rounded-xl p-1.5 text-gray-400/60 transition-colors hover:bg-white/40 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-slate-700/50 dark:hover:text-gray-300"
            @click="emit('close')"
          >
            <BeanieIcon name="close" size="md" />
          </button>

          <!-- Beanies family hugging illustration -->
          <img
            src="/brand/beanies_family_hugging_transparent_192x192.png"
            alt="Beanies family"
            class="h-16 w-16 flex-shrink-0 drop-shadow-sm"
          />

          <!-- Title & subtitle -->
          <div class="min-w-0 pr-6">
            <h2 class="font-outfit text-secondary-500 text-lg font-bold dark:text-gray-100">
              {{ props.title ?? t('share.title') }}
            </h2>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ props.subtitle ?? t('share.subtitle') }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <ShareChannelGrid :link="link" :family-name="familyName" :member-name="memberName" />
  </BaseModal>
</template>
