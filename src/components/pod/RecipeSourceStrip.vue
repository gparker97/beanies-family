<script setup lang="ts">
/**
 * "Start from a link" — the shortcut band at the top of an EMPTY Add Recipe form (#72).
 *
 * WHY IT LIVES INSIDE THE FORM. Typing a recipe out by hand is the slowest thing in the
 * cookbook, and the moment a user is most likely to realise there is a faster way is the
 * moment they are staring at an empty Name field. Putting the shortcut on the page behind
 * them means they only find it if they already knew to look. So the form itself offers it,
 * once, at the top, and then gets out of the way.
 *
 * DESIGN — a band, not a second form. It is deliberately quieter than the fields below it in
 * structure (one row, no labels) but warmer in colour, so it reads as an offer rather than a
 * required step. Matching the link modal's hierarchy exactly — link primary, photo/PDF
 * secondary — so the two entry points feel like one feature rather than two.
 *
 * It renders ONLY on a blank add. Editing an existing recipe must never invite you to
 * overwrite it from a link, and a form already filled in by a capture has no use for it.
 */
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecipeLinkInput } from '@/composables/useRecipeLinkInput';

const emit = defineEmits<{
  /** A usable link — the parent closes this form and runs the capture. */
  submit: [url: string];
  /** Hand off to the magic beans picker for a photo or a PDF. */
  document: [];
}>();

const { t } = useTranslation();
const { link, touched, showError, hintKey, trySubmit } = useRecipeLinkInput();

function handleSubmit(): void {
  const url = trySubmit();
  if (url) emit('submit', url);
}
</script>

<template>
  <section
    class="mb-5 rounded-[var(--sq)] border border-[rgb(230_126_34_/_18%)] bg-[#fbf3e3] p-3.5 sm:p-4"
  >
    <h3 class="font-outfit text-secondary-500 flex items-center gap-2 text-sm font-extrabold">
      <span aria-hidden="true">✨</span>
      <span>{{ t('recipeExtract.strip.title') }}</span>
    </h3>
    <p class="font-outfit text-secondary-500/70 mt-0.5 text-xs">
      {{ t('recipeExtract.strip.subtitle') }}
    </p>

    <div class="mt-2.5 flex flex-col gap-2 sm:flex-row">
      <div class="flex-1">
        <BaseInput
          v-model="link"
          type="url"
          :placeholder="t('recipeExtract.link.placeholder')"
          @blur="touched = true"
          @keyup.enter="handleSubmit"
        />
      </div>
      <button
        type="button"
        class="bg-primary-500 font-outfit h-11 shrink-0 cursor-pointer rounded-2xl px-4 text-sm font-semibold text-white transition-colors hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="link.trim().length === 0"
        @click="handleSubmit"
      >
        {{ t('recipeExtract.strip.action') }}
      </button>
    </div>

    <!-- Heritage Orange, never Alert Red: a mistyped link is routine, not a failure. -->
    <p
      class="font-outfit mt-1.5 text-xs"
      :class="showError ? 'text-primary-500' : 'text-secondary-500/70'"
    >
      {{ t(hintKey) }}
    </p>

    <button
      type="button"
      class="font-outfit text-secondary-500/70 hover:text-primary-500 mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold underline underline-offset-2 transition-colors"
      @click="emit('document')"
    >
      <BeanieIcon name="image" size="sm" class="opacity-60" />
      <span>{{ t('recipeExtract.strip.document') }}</span>
    </button>
  </section>
</template>
