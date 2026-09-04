<script setup lang="ts">
/**
 * Recipe reader intake (#72).
 *
 * DESIGN NOTE — why this is the FIRST thing the user sees, not the second.
 *
 * The original flow was: tap the reader → a chooser with three equal options → if you picked
 * "link", a second modal for the URL. But the three sources are not equally used: a link is
 * the everyday case, and camera/file are the occasional one. Making the common path cost two
 * taps and a modal transition to reach a text field was the wrong shape.
 *
 * So the link field IS the modal. It opens focused and ready to paste. Camera and file stay
 * one tap away underneath, visually quieter — present, but not competing. Nothing is hidden;
 * the hierarchy just matches how the feature is actually used.
 *
 * Validation is the SAME `routeUrl` the resolver uses, so what the user is told here and what
 * the fetcher will accept can never disagree.
 */
import { nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import AiSourceButtons from '@/components/ai/AiSourceButtons.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecipeLinkInput } from '@/composables/useRecipeLinkInput';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  submit: [url: string];
  /** Fall back to the device camera — the occasional path, not the common one. */
  camera: [];
  /** Fall back to the file picker (an image or a PDF). */
  file: [];
}>();

const { t } = useTranslation();

const inputWrap = ref<HTMLElement | null>(null);

// Validation, error timing and hint copy are shared with the Add Recipe form's shortcut band
// so the two can never disagree about what a usable link is.
const { link, touched, isValid, showError, hintKey, reset, trySubmit } = useRecipeLinkInput();

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    reset();
    // Focus the field on open — the whole point of this layout is that you can paste
    // immediately. Guarded because BaseInput may not have mounted on the first tick.
    await nextTick();
    inputWrap.value?.querySelector('input')?.focus();
  }
);

function handleSave(): void {
  const url = trySubmit();
  if (url) emit('submit', url);
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    layer="overlay"
    :open="open"
    :title="t('recipeExtract.link.title')"
    icon="🍳"
    icon-bg="var(--tint-orange-8)"
    size="default"
    :save-disabled="!isValid"
    :save-label="t('recipeExtract.link.action')"
    @close="emit('close')"
    @save="handleSave"
  >
    <FormFieldGroup :label="t('recipeExtract.link.label')" required>
      <div ref="inputWrap">
        <BaseInput
          v-model="link"
          type="url"
          :placeholder="t('recipeExtract.link.placeholder')"
          @blur="touched = true"
          @keyup.enter="handleSave"
        />
      </div>
      <!-- Heritage Orange, never Alert Red: a mistyped link is routine, not a failure. -->
      <p
        class="font-outfit mt-1.5 text-xs"
        :class="showError ? 'text-primary-500' : 'text-secondary-500/70 dark:text-ink-soft'"
      >
        {{ t(hintKey) }}
      </p>
    </FormFieldGroup>

    <!-- Secondary sources. Deliberately quieter than the field above: a hairline divider,
         no fill, muted text. Available in one tap, but never competing with the link.
         Shared with the magic-beans sheet (#84) — see `AiSourceButtons`. -->
    <AiSourceButtons @camera="emit('camera')" @file="emit('file')" />
  </BeanieFormModal>
</template>
