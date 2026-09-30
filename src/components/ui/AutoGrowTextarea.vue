<script setup lang="ts">
/**
 * A one-line text field that wraps instead of cutting off: a textarea that grows to fit
 * its text (extracted from `MagicTodoReviewDrawer`'s draft titles for #116, second use).
 *
 * The growing is pure CSS. A hidden `::after` mirror of the text and the textarea share
 * one grid cell, so the cell (and the textarea in it) is as tall as the wrapped text. No
 * resize observer, no measuring script.
 *
 * Enter never adds a line (the value is one line); it emits `enter` instead, except while
 * an IME is composing, where Enter commits the composed text. By default paste is left
 * alone, so pasted text may still carry line breaks: each caller decides what they mean
 * (the to-do drawer folds them into spaces, the ingredient checklist splits them into items
 * on save).
 *
 * `singleLine` stops a line break at the SOURCE instead, for a field whose value can never
 * hold one (a list item): a soft keyboard's line break that arrives without an Enter keydown
 * (`beforeinput` insertLineBreak / insertParagraph) is blocked and emits `enter` too, and a
 * paste carrying line breaks is inserted at the caret with each run of them as one space.
 * So the DOM never diverges from the caller's value and the caret stays where it was.
 *
 * `inheritAttrs: false`: every attribute and listener (`class`, `aria-label`,
 * `placeholder`, `data-testid`, `@blur`) lands on the TEXTAREA, where tests and assistive
 * tech look for it. The font lives on the wrapper (`wrapperClass`), because the mirror and
 * the textarea must measure the same text in the same face. `focus()` is exposed, since a
 * `ref` on the component is its instance rather than the textarea.
 */
import { ref } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  modelValue: string;
  /** Classes for the grid wrapper: put the FONT here (size, weight, family). */
  wrapperClass?: string;
  /** The value can never hold a line break: block one typed or pasted (see above). */
  singleLine?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  /** Enter was pressed (and blocked), or a `singleLine` field refused a line break. */
  enter: [event: KeyboardEvent | InputEvent];
}>();

function onEnter(e: KeyboardEvent): void {
  if (e.isComposing) return;
  e.preventDefault();
  emit('enter', e);
}

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}

/** A soft keyboard's Return can arrive as a line-break input with no Enter keydown. */
function onBeforeInput(e: InputEvent): void {
  if (!props.singleLine) return;
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  e.preventDefault();
  emit('enter', e);
}

/** Paste as one line, at the caret, so the field never holds text its value does not. */
function onPaste(e: ClipboardEvent): void {
  if (!props.singleLine) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!/[\r\n]/.test(text)) return; // nothing to fold: the native paste (and its undo) stands
  e.preventDefault();
  const el = e.target as HTMLTextAreaElement;
  const folded = text.replace(/[\r\n]+/g, ' ');
  const caret = el.selectionStart + folded.length;
  el.setRangeText(folded, el.selectionStart, el.selectionEnd);
  // Placed explicitly rather than by `setRangeText`'s 'end' mode, which not every engine honours.
  el.setSelectionRange(caret, caret);
  emit('update:modelValue', el.value);
}

const field = ref<HTMLTextAreaElement | null>(null);

/** Focus the textarea (a `ref` on this component is the instance, not the element). */
function focus(): void {
  field.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <div class="auto-grow" :class="wrapperClass" :data-value="`${modelValue} `">
    <textarea
      ref="field"
      v-bind="$attrs"
      :value="modelValue"
      rows="1"
      class="resize-none overflow-hidden"
      @input="onInput"
      @keydown.enter="onEnter"
      @beforeinput="onBeforeInput"
      @paste="onPaste"
    />
  </div>
</template>

<style scoped>
/* The hidden ::after mirror and the textarea share one grid cell, so the cell (and the
   textarea) is as tall as the wrapped text. The trailing space in `data-value` keeps a
   trailing line break from collapsing. */
.auto-grow {
  display: grid;
}

.auto-grow::after {
  content: attr(data-value);
  visibility: hidden;
  white-space: pre-wrap;
}

.auto-grow > textarea,
.auto-grow::after {
  border-bottom-width: 1px;
  font: inherit;
  grid-area: 1 / 1 / 2 / 2;
  overflow-wrap: anywhere;
  padding: 0.125rem 0.25rem;
}
</style>
