<script setup lang="ts">
/**
 * Friendly empty-state prompt. Used inside OverviewModule bodies and
 * tab contents when no data exists yet — gives the user a hint of
 * what to do next plus an optional CTA.
 *
 * An optional `title` heads the message, and the default slot carries anything that belongs
 * under it (the wall's stars sheet puts its child chips there, #154).
 *
 * `size`: `md`, the default, is the app's look and renders exactly as it always has (its
 * classes are pinned by a test, since ~36 call sites draw it). `lg` is the wall's, read from a
 * few steps away (#154): a bigger emoji, title and message, with the message on the semantic
 * muted ink rather than md's older opacity-tinted slate.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    emoji?: string;
    /** Optional heading above the message. */
    title?: string;
    message: string;
    /** Optional CTA label — when set, renders a primary-styled button. */
    actionLabel?: string;
    /** `md`: the app's empty state; `lg`: the wall's. */
    size?: 'md' | 'lg';
  }>(),
  { emoji: undefined, title: undefined, actionLabel: undefined, size: 'md' }
);

/**
 * Every size-dependent class, per size. `md` is the empty state as it has always been drawn
 * (HEAD's classes, colour included); `lg` carries the token-based message colour.
 */
const SIZES = {
  md: {
    root: 'gap-2 py-6',
    emoji: 'text-3xl',
    title: 'text-lg',
    message: 'text-secondary-500/60 dark:text-ink-soft text-sm',
  },
  lg: {
    root: 'gap-3 py-8',
    emoji: 'text-4xl',
    title: 'text-2xl',
    message: 'dark:text-ink-soft max-w-prose text-[var(--muted-text,#4d5d6c)] text-lg',
  },
} as const;
const sz = computed(() => SIZES[props.size]);

defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center" :class="sz.root">
    <span v-if="emoji" class="leading-none" :class="sz.emoji" aria-hidden="true">{{ emoji }}</span>
    <h3
      v-if="title"
      class="font-outfit text-secondary-500 dark:text-ink font-bold text-balance"
      :class="sz.title"
      data-testid="empty-state-title"
    >
      {{ title }}
    </h3>
    <p class="font-outfit" :class="sz.message">
      {{ message }}
    </p>
    <slot />
    <button
      v-if="actionLabel"
      type="button"
      class="font-outfit text-primary-500 dark:text-accent-lift mt-1 text-xs font-semibold hover:underline"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>
