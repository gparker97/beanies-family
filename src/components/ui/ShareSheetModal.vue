<script setup lang="ts">
import { BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';

/**
 * The branded share-sheet shell: `BaseModal` + the warm gradient header with the beanies
 * family art.
 *
 * Extracted from `ShareInviteModal` (#92) rather than hand-built a second time. That
 * component's header was already ~55 lines of gradient, decorative dots, close button and two
 * dark-mode token sets, and it already documented its `title`/`subtitle` props as being for
 * reuse outside the invite context — so a second share sheet would have been a copy of a
 * component that had already announced it expected to be reused.
 *
 * Deliberately holds NO share logic and no invite vocabulary. It is a shell; the channel row,
 * the message and the footer all come from the caller.
 */
defineProps<{
  open: boolean;
  /** Header heading. */
  title: string;
  /** Header sub-line. */
  subtitle: string;
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
        class="dark:border-line-strong/50 relative overflow-hidden rounded-t-3xl border-b border-[var(--color-sky-silk-300)]/30"
      >
        <!-- Background gradient -->
        <div
          class="dark:from-surface-overlay/80 dark:via-surface-raised dark:to-surface-overlay/60 absolute inset-0 bg-gradient-to-br from-[var(--tint-orange-8)] via-[var(--tint-silk-10)] to-[var(--tint-orange-4)]"
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
          <!-- `BeanieIcon` renders `aria-hidden`, so without a label this button has no
               accessible name at all (WCAG 4.1.2) — it announces as "button". -->
          <button
            type="button"
            :aria-label="t('action.close')"
            class="dark:text-ink-faint dark:hover:bg-surface-hover/50 dark:hover:text-ink-soft absolute top-2 right-2 rounded-xl p-1.5 text-gray-400/60 transition-colors hover:bg-white/40 hover:text-gray-600"
            @click="emit('close')"
          >
            <BeanieIcon name="close" size="md" />
          </button>

          <!-- Art. Callers may override it; the beanies family is the default because
               every share is, one way or another, an invitation into a family's things. -->
          <slot name="art">
            <img
              src="/brand/beanies_family_hugging_transparent_192x192.png"
              :alt="t('inviteShare.familyImageAlt')"
              class="h-16 w-16 flex-shrink-0 drop-shadow-sm"
            />
          </slot>

          <!-- Title & subtitle -->
          <div class="min-w-0 pr-6">
            <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-bold">
              {{ title }}
            </h2>
            <p class="dark:text-ink-soft text-xs text-gray-500">
              {{ subtitle }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <slot />
  </BaseModal>
</template>
