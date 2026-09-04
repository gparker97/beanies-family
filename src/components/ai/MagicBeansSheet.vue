<script setup lang="ts">
/**
 * The one magic-beans surface (#84) — direction B of
 * `docs/mockups/magic-beans-one-button-2026-09-03.html`.
 *
 * DESIGN NOTE — why there is no source chooser.
 *
 * The three chips this replaces (📸 invite / ✈️ travel booking / 🍳 recipe) asked the user
 * "what IS this?" before beanies had looked at it. That is the AI's job, and it is a question
 * a person can get *wrong* — and picking wrong did not produce a helpful error, it produced a
 * bad extraction: a filled-in form of the wrong shape that the user has to notice. The share
 * path never asked it, which is why the same school PDF landed correctly from Gmail and
 * wrongly from inside beanies.
 *
 * So this asks "where is it?" instead, which is a question the user always knows the answer
 * to. The paste field is the hero because it is the case with no other home — a photo already
 * has a camera button, but a class-group message has nothing. Camera and file sit underneath,
 * one tap away and visually quieter.
 *
 * This is deliberately the SAME shape as `RecipeLinkModal`, whose header describes the
 * identical decision. It is NOT generalised with it: the two agree on the container and the
 * secondary buttons (both now shared) and disagree on everything else — that modal validates
 * a URL, disables save until it routes, and shows a three-way hint; this one accepts anything
 * non-empty and validates nothing, because deciding what the content is IS the feature. A
 * props-driven super-modal would carry both sets of semantics and be worse than either.
 *
 * ⚠️ Every action closes this sheet BEFORE starting the ingest. Three separate things break
 * otherwise: `AiProcessingOverlay` is `z-[60]` and so is this panel; `useFullscreenOverlay`
 * holds a body-scroll lock; and `openQuickAdd()` refuses outright while any overlay is open,
 * which would make the FAB dead until a reload.
 */
import { nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import AiSourceButtons from '@/components/ai/AiSourceButtons.vue';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  /** Pasted text or a pasted link — the orchestrator decides which. */
  submit: [text: string];
  camera: [];
  file: [];
}>();

const { t } = useTranslation();

const text = ref('');
const fieldWrap = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    text.value = '';
    // Focused on open — the whole point of this layout is that you can paste immediately.
    // Guarded because BaseTextarea may not have mounted on the first tick.
    await nextTick();
    fieldWrap.value?.querySelector('textarea')?.focus();
  }
);

function handleSave(): void {
  const value = text.value.trim();
  // Empty is the ONLY thing refused here. Length bands, link-vs-text and the budget all live
  // in the orchestrator's `sourceFromText`, shared with the share path — a second opinion
  // about what text is acceptable is exactly the divergence #84 exists to remove.
  if (!value) return;
  emit('submit', value);
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    layer="overlay"
    :open="open"
    :title="t('ai.capture.title')"
    icon="✨"
    icon-bg="var(--tint-orange-8)"
    size="default"
    :save-disabled="!text.trim()"
    :save-label="t('ai.capture.action')"
    @close="emit('close')"
    @save="handleSave"
  >
    <FormFieldGroup :label="t('ai.capture.label')">
      <div ref="fieldWrap">
        <!-- A TEXTAREA, not an input: a pasted class-group message is several lines, and a
             single-line field that scrolls sideways makes it impossible to check what you
             pasted. Keyboard avoidance is inherited from BaseSidePanel's full-height
             scrolling column — no visualViewport code belongs here. -->
        <BaseTextarea v-model="text" :rows="4" :placeholder="t('ai.capture.placeholder')" />
      </div>
      <p class="font-outfit text-secondary-500/70 dark:text-ink-soft mt-1.5 text-xs">
        {{ t('ai.capture.hint') }}
      </p>
    </FormFieldGroup>

    <AiSourceButtons @camera="emit('camera')" @file="emit('file')" />
  </BeanieFormModal>
</template>
