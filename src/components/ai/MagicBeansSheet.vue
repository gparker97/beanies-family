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
 * This used to sit beside `RecipeLinkModal`, which asked the same question in a link-only way:
 * it validated a URL, disabled save until it routed, and showed a three-way hint. That modal is
 * gone. Every door now opens THIS sheet, which accepts anything non-empty and validates
 * nothing, because deciding what the content is IS the feature — a link-only second door was
 * the last place that still asked the user to have the right KIND of thing in hand.
 *
 * ⚠️ Every action closes this sheet BEFORE starting the ingest, and that must not be relaxed.
 * Two of the three original reasons still hold: `useFullscreenOverlay` holds a body-scroll
 * lock, and `openQuickAdd()` refuses outright while any overlay is open, which would leave the
 * FAB dead until a reload.
 *
 * The third — a z-index collision with `AiProcessingOverlay` at `z-[60]` — went away when this
 * moved to `layer="top"` (`z-[250]`). That move is SAFE BECAUSE of this ordering, not a
 * replacement for it: do not reason backwards from the z-index.
 *
 * WHY `layer="top"`. Since the doors were unified this sheet opens from inside other modals —
 * the activity modal's quick-start tile, the recipe form's source strip. At `layer="overlay"`
 * its backdrop sits at `z-[55]`, UNDER a host modal's own `z-[60]` panel, leaving that host
 * bright and clickable behind it. Fixing it here rather than per-door is what stops every
 * future door having to make a stacking decision it can get wrong.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import AiSourceButtons from '@/components/ai/AiSourceButtons.vue';
import { useTranslation } from '@/composables/useTranslation';
import { MAGIC_DESTINATIONS, MAGIC_DESTINATION_KINDS } from '@/constants/magicDestinations';
import { routeUrl } from '@/utils/recipeSourceUrl';

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

/**
 * A single pasted token that looks like a link but will not route.
 *
 * Only for the single-token case: a link inside a sentence is handled by the spine's
 * link-vs-text triage, and flagging it here would second-guess that. This is purely an
 * explanation — `handleSave` still accepts anything non-empty.
 */
const showBadLinkHint = computed(() => {
  const value = text.value.trim();
  if (!value || /\s/.test(value)) return false;
  if (!/^[a-z]+:\/\//i.test(value) && !value.includes('.')) return false;
  return routeUrl(value).kind === 'invalid';
});
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
    layer="top"
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
    <!-- The tagline band. Caveat + Heritage Orange on a soft gradient tint, and the thing the
         sheen travels across — deliberately NOT the textarea: a shimmer over an input is the
         skeleton-loader idiom, so it reads as loading or disabled and it fights the caret.

         The band lives in the BODY rather than the header because `customHeader` is modal-only
         and this is a drawer; the standard header (icon box + title) is the house pattern and
         stays. --magic-sheen-color is set here because the shared sheen is white, which is
         invisible on a light tint. -->
    <div class="magic-shimmer magic-shimmer-slow magic-tagline-band mb-4 rounded-2xl px-3.5 py-3">
      <p
        class="text-primary-500 dark:text-accent-lift relative z-[1] m-0 font-[Caveat,Outfit,cursive] text-base leading-snug font-bold"
      >
        {{ t('ai.capture.tagline') }}
      </p>
    </div>

    <FormFieldGroup :label="t('ai.capture.label')">
      <div ref="fieldWrap">
        <!-- A TEXTAREA, not an input: a pasted class-group message is several lines, and a
             single-line field that scrolls sideways makes it impossible to check what you
             pasted. Keyboard avoidance is inherited from BaseSidePanel's full-height
             scrolling column — no visualViewport code belongs here. -->
        <BaseTextarea v-model="text" :rows="4" :placeholder="t('ai.capture.placeholder')" />
      </div>
      <!-- Non-blocking. The sheet refuses ONLY emptiness — deciding what the content is IS the
           feature — so a link that will not route is explained, never disallowed. -->
      <p
        v-if="showBadLinkHint"
        class="font-outfit text-primary-500 dark:text-accent-lift mt-1.5 text-xs"
      >
        {{ t('ai.capture.badLinkHint') }}
      </p>
    </FormFieldGroup>

    <AiSourceButtons @camera="emit('camera')" @file="emit('file')" />

    <!-- What beanies can make. A capability statement, not a question: the tiles never ask the
         user to choose, they say what the answer could be. Visually unlabelled by design — the
         strings are their ACCESSIBLE names, because an icon-only tile with no name is unusable
         with a screen reader.

         At rest here; they tick and resolve in AiProcessingOverlay, which is where the reading
         actually happens (this sheet closes before the ingest starts). Carrying the same three
         tiles across that transition is what makes the resolve read as an answer. -->
    <ul class="mt-6 flex list-none gap-2 p-0">
      <li v-for="kind in MAGIC_DESTINATION_KINDS" :key="kind" class="min-w-0 flex-1">
        <div
          class="dark:bg-surface-overlay rounded-[14px] bg-[var(--tint-slate-5)] px-1.5 pt-2.5 pb-2 text-center"
        >
          <span aria-hidden="true" class="block text-xl leading-none">{{
            MAGIC_DESTINATIONS[kind].emoji
          }}</span>
          <span
            class="font-outfit text-secondary-400 dark:text-ink-faint mt-1.5 block text-xs font-semibold"
          >
            {{ t(`ai.capture.dest.${kind}`) }}
          </span>
        </div>
      </li>
    </ul>
  </BeanieFormModal>
</template>
