<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { addTag, removeTag, MAX_TAGS, MAX_TAG_LENGTH, type AddTagStatus } from '@/utils/recipeTags';

/**
 * Free-form recipe tags: removable pills, an entry field, and previously-used suggestions.
 *
 * ⚠️ This component holds NO RULES. Normalisation, the duplicate check and both caps live in
 * `utils/recipeTags.ts`; the component only renders the `status` that `addTag` returns. That
 * status is the whole reason the util has one: an input that silently ignores a duplicate or
 * an over-cap entry looks broken — the user presses Enter, nothing happens, and there is no
 * way to tell a swallowed tag from a dead key.
 */
const props = defineProps<{
  modelValue: string[];
  /** Previously-used tags, already filtered and capped by the caller. */
  suggestions?: string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const { t } = useTranslation();

const draft = ref('');
const status = ref<AddTagStatus | null>(null);

const atLimit = computed(() => props.modelValue.length >= MAX_TAGS);

/**
 * Only the statuses a USER needs to act on get a message. 'added'/'empty' are self-evident.
 *
 * `atLimit` is checked FIRST and independently of `status`, because reaching the cap disables
 * the input and hides the suggestions — so `addTag` can never return 'limit' from this UI, and
 * without this the field would simply go dead with an empty placeholder and no explanation.
 * That is the silent failure `addTag`'s status codes exist to prevent, arriving by the back
 * door. The util keeps its 'limit' branch as defence for non-UI callers.
 */
const message = computed(() => {
  if (atLimit.value) return fillTemplate(t('recipes.tags.limit'), { max: MAX_TAGS });
  if (status.value === 'duplicate') return t('recipes.tags.duplicate');
  if (status.value === 'limit') return fillTemplate(t('recipes.tags.limit'), { max: MAX_TAGS });
  if (status.value === 'truncated')
    return fillTemplate(t('recipes.tags.truncated'), { max: MAX_TAG_LENGTH });
  return '';
});

function commit(raw: string) {
  if (props.disabled) return;
  const result = addTag(props.modelValue, raw);
  status.value = result.status;
  if (result.status === 'added' || result.status === 'truncated') {
    emit('update:modelValue', result.tags);
    draft.value = '';
  } else if (result.status === 'empty') {
    draft.value = '';
  }
}

function onKeydown(e: KeyboardEvent) {
  // A rejection is about the entry that caused it. Once the user types the next character it
  // is stale, and leaving it up reads as a complaint about what they are typing NOW.
  // Cleared here rather than in a `watch(draft)` because `commit` blanks the draft on success,
  // which would wipe the 'truncated' notice the moment it appeared.
  if (e.key !== 'Enter' && e.key !== ',') status.value = null;

  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    commit(draft.value);
    return;
  }
  // Backspace on an empty field removes the last tag — the token-input idiom.
  if (e.key === 'Backspace' && draft.value === '' && props.modelValue.length > 0) {
    e.preventDefault();
    drop(props.modelValue[props.modelValue.length - 1]!);
  }
}

function drop(tag: string) {
  if (props.disabled) return;
  status.value = null;
  emit('update:modelValue', removeTag(props.modelValue, tag));
}

function onBlur() {
  // Committing on blur is what stops a typed-but-unconfirmed tag vanishing when the user taps
  // Save — the most likely way to lose a tag on a phone.
  if (draft.value.trim()) commit(draft.value);
}
</script>

<template>
  <div>
    <div
      class="dark:border-line-strong dark:bg-surface-raised flex flex-wrap items-center gap-1.5 rounded-2xl border border-gray-200 bg-white p-2"
    >
      <span
        v-for="tag in modelValue"
        :key="tag"
        class="font-inter dark:bg-surface-overlay dark:text-ink-soft inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--tint-slate-5)] py-0.5 pr-1 pl-2.5 text-xs text-[var(--color-text)]"
      >
        <span class="truncate">{{ tag }}</span>
        <button
          type="button"
          class="dark:hover:text-accent-lift flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-10)] hover:text-[#F15D22]"
          :aria-label="`${t('recipes.tags.remove')}: ${tag}`"
          :disabled="disabled"
          @click="drop(tag)"
        >
          ×
        </button>
      </span>
      <input
        v-model="draft"
        type="text"
        class="font-inter min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-[var(--color-text)] outline-none"
        :placeholder="atLimit ? '' : t('recipes.tags.placeholder')"
        :disabled="disabled || atLimit"
        :maxlength="MAX_TAG_LENGTH"
        @keydown="onKeydown"
        @blur="onBlur"
      />
    </div>

    <p class="font-inter mt-1 text-xs text-[var(--color-text-muted)]">
      {{ t('recipes.tags.hint') }}
    </p>

    <!--
      Rejections are SPOKEN, never swallowed.

      ⚠️ Rendered UNCONDITIONALLY, with only its text toggling. A `v-if` here would insert the
      element and its content in the same mutation, and screen readers do not announce a live
      region's INITIAL content — so every rejection would have been silent to exactly the users
      who cannot see the pills fail to appear, which is the failure these statuses exist to
      prevent.
    -->
    <p
      class="font-inter dark:text-accent-lift mt-1 text-xs font-semibold text-[#F15D22] empty:mt-0"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </p>

    <div v-if="suggestions?.length && !atLimit" class="mt-2">
      <p class="font-outfit mb-1 text-xs text-[var(--color-text-muted)]">
        {{ t('recipes.tags.suggestions') }}
      </p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="s in suggestions"
          :key="s"
          type="button"
          class="font-inter dark:bg-surface-overlay dark:text-ink-soft rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-10)]"
          :disabled="disabled"
          @click="commit(s)"
        >
          {{ s }}
        </button>
      </div>
    </div>
  </div>
</template>
