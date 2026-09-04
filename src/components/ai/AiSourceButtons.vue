<script setup lang="ts">
/**
 * The quieter "or from…" pair beneath an AI reader's primary field: take a photo, or choose
 * a file.
 *
 * Extracted from `RecipeLinkModal` (#84) at the moment a SECOND caller appeared — the
 * magic-beans sheet — rather than after the copy shipped. `docs/lessons.md` §11 applied one
 * step earlier than usual, which is the only time it is cheap.
 *
 * ⚠️ HARD CONSTRAINT: zero props and zero logic. Two emits, three `t()` calls, no
 * conditionals, no variants, no sizes. The instant a third caller wants it *different*, copy
 * it — do NOT parameterise it. A props-driven version of thirty lines of markup is worse than
 * two copies, and this component exists specifically to not become that.
 *
 * The buttons are deliberately subordinate to whatever sits above them: a hairline divider,
 * no fill, muted text. Present in one tap, never competing with the primary field.
 */
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';

const emit = defineEmits<{
  /** The device camera. On native this MUST reach an image-only `capture` input — a mixed
   *  accept routes to the system documents picker, which has no camera entry at all. */
  camera: [];
  /** The file picker (an image or a PDF). */
  file: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <div class="mt-6">
    <div class="flex items-center gap-3">
      <span class="h-px flex-1 bg-[var(--divider,rgba(44,62,80,0.08))]"></span>
      <span
        class="font-outfit text-secondary-500/50 dark:text-ink-soft text-xs font-semibold tracking-[0.08em] uppercase"
      >
        {{ t('ai.picker.orFrom') }}
      </span>
      <span class="h-px flex-1 bg-[var(--divider,rgba(44,62,80,0.08))]"></span>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2.5">
      <button
        type="button"
        class="font-outfit text-secondary-500 dark:border-line-strong dark:text-ink flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-[var(--tint-slate-10)] bg-transparent px-3 text-sm font-semibold transition-colors hover:bg-[var(--tint-slate-5)]"
        @click="emit('camera')"
      >
        <BeanieIcon name="camera" size="sm" class="opacity-60" />
        <span class="truncate">{{ t('ai.picker.takePhoto') }}</span>
      </button>
      <button
        type="button"
        class="font-outfit text-secondary-500 dark:border-line-strong dark:text-ink flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-[var(--tint-slate-10)] bg-transparent px-3 text-sm font-semibold transition-colors hover:bg-[var(--tint-slate-5)]"
        @click="emit('file')"
      >
        <BeanieIcon name="image" size="sm" class="opacity-60" />
        <span class="truncate">{{ t('ai.picker.chooseFile') }}</span>
      </button>
    </div>
  </div>
</template>
