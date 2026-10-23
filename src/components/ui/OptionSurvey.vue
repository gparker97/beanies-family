<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';

/**
 * A single-question option survey: a two-column grid of icon tiles, single-select with
 * tap-to-clear, and a free-text field under any option that `requiresText`.
 *
 * Translation- and Slack-agnostic, like `ChoiceModal`: callers pass ALREADY-TRANSLATED labels
 * and placeholders and decide what the answer means (a Slack label, a registry query, ...).
 * Hosts: `CreatePodSurvey` ("how did you hear about us?") and `ExitReasonSurvey` (the delete
 * drawer's "why are you leaving?").
 *
 * Controlled through `v-model`. Every selection or text change emits the answer as it now
 * stands: `{ id }` for an option without text, `{ id, text }` (trimmed) for one that requires
 * it, and `null` while nothing valid is selected (nothing picked, or text required and empty
 * after trimming). The tile highlight and the typed text are kept here, because `null` cannot
 * say "this option is picked but its text is still empty".
 */
export interface OptionSurveyOption {
  id: string;
  label: string;
  icon: string;
  requiresText?: boolean;
  textPlaceholder?: string;
  /** Hard cap for the free text (the host's own cap, e.g. `EXIT_REASON_TEXT_MAX`), so nothing is silently truncated later. */
  textMaxLength?: number;
}

export interface OptionSurveyAnswer {
  id: string;
  text?: string;
}

const props = defineProps<{
  options: readonly OptionSurveyOption[];
  modelValue: OptionSurveyAnswer | null;
  testidPrefix: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [answer: OptionSurveyAnswer | null];
}>();

const selectedId = ref<string | null>(null);
/** Typed text per option, so switching between two text options never carries one into the other. */
const texts = reactive<Record<string, string>>({});
/** What this component last emitted (or was seeded with), so its own echo is not re-applied. */
let lastEmitted: OptionSurveyAnswer | null = null;

const selected = computed(() => props.options.find((o) => o.id === selectedId.value) ?? null);

function sameAnswer(a: OptionSurveyAnswer | null, b: OptionSurveyAnswer | null): boolean {
  return (a?.id ?? null) === (b?.id ?? null) && (a?.text ?? '') === (b?.text ?? '');
}

/**
 * Take the host's value as our own. A null from the host clears the typed texts too, so a
 * discarded answer cannot resurrect on the next tap of the same tile.
 *
 * ⚠️ A host reset to null is indistinguishable from the echo of our own null (an incomplete
 * selection) when our last emission was null, so the echo filter in the watch below skips it.
 * Hosts that must reset while a selection is incomplete remount the component (`v-if` / `:key`),
 * which both current hosts already do (the delete drawer is `v-if`'d; the create survey never
 * resets).
 */
function adopt(value: OptionSurveyAnswer | null) {
  lastEmitted = value;
  selectedId.value = value?.id ?? null;
  if (value === null) {
    for (const key of Object.keys(texts)) delete texts[key];
    return;
  }
  if (value.text !== undefined) texts[value.id] = value.text;
}

watch(
  () => props.modelValue,
  (value) => {
    if (!sameAnswer(value, lastEmitted)) adopt(value);
  },
  { immediate: true }
);

function current(): OptionSurveyAnswer | null {
  const opt = selected.value;
  if (!opt) return null;
  if (!opt.requiresText) return { id: opt.id };
  const text = (texts[opt.id] ?? '').trim();
  return text ? { id: opt.id, text } : null;
}

function emitCurrent() {
  const answer = current();
  lastEmitted = answer;
  emit('update:modelValue', answer);
}

function select(id: string) {
  if (selectedId.value === id) {
    // Tap-to-clear discards the tile AND its typed text: the host echoes our null, which the
    // watch skips, so nothing else would forget the text and a re-tap would resurrect it.
    selectedId.value = null;
    delete texts[id];
  } else {
    selectedId.value = id;
  }
  emitCurrent();
}

function onText(event: Event) {
  if (!selectedId.value) return;
  texts[selectedId.value] = (event.target as HTMLInputElement).value;
  emitCurrent();
}
</script>

<template>
  <div>
    <div class="grid grid-cols-2 gap-2.5">
      <button
        v-for="opt in options"
        :key="opt.id"
        type="button"
        :aria-pressed="selectedId === opt.id"
        :data-testid="`${testidPrefix}-opt-${opt.id}`"
        class="font-outfit flex items-center gap-2.5 rounded-[14px] border-[1.5px] p-3 text-left text-sm font-semibold transition-colors"
        :class="
          selectedId === opt.id
            ? 'border-primary-500 dark:text-ink bg-[var(--tint-orange-8)] text-gray-900'
            : 'dark:border-line-strong dark:text-ink hover:border-primary-500 dark:hover:border-accent-lift border-[var(--tint-slate-5)] text-gray-700'
        "
        @click="select(opt.id)"
      >
        <span
          class="dark:bg-surface-overlay grid h-7 w-7 shrink-0 place-items-center rounded-[10px] bg-[var(--tint-slate-5)] text-base"
          aria-hidden="true"
          >{{ opt.icon }}</span
        >
        {{ opt.label }}
      </button>
    </div>

    <!-- Free text for an option that requires it. `normal-case` opts the person's own typing
         out of any lowercase display style a host sets on its wrapper. -->
    <input
      v-if="selected?.requiresText"
      :key="selected.id"
      :value="texts[selected.id] ?? ''"
      type="text"
      :placeholder="selected.textPlaceholder"
      :maxlength="selected.textMaxLength"
      :aria-label="selected.textPlaceholder ?? selected.label"
      :data-testid="`${testidPrefix}-other-input`"
      class="dark:bg-surface-overlay dark:text-ink dark:border-line-strong focus:border-primary-500 dark:placeholder-ink-faint focus:ring-sky-silk-100 dark:focus:ring-primary-700 mt-2.5 w-full rounded-xl border-[1.5px] border-gray-300 p-3 text-base text-gray-900 normal-case placeholder-gray-400 focus:ring-2 focus:outline-none"
      @input="onText"
    />
  </div>
</template>
