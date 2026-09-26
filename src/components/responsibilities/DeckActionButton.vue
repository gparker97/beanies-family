<script setup lang="ts">
/**
 * Who Owns What (#109): the small outlined action button beside a "Who owns it?" picker
 * (Split It, Skip), shared by the deal pile, the deal board's tap picker and the check-in
 * drawer so the three stay one look. Sits on a raised or overlay surface in both modes.
 */
withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
defineEmits<{ click: [] }>();
</script>

<template>
  <button type="button" class="deck-action" :disabled="disabled" @click="$emit('click')">
    <slot />
  </button>
</template>

<style scoped>
.deck-action {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  color: var(--color-text);
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.5rem 0.75rem;
}

.deck-action:disabled {
  cursor: default;
}

.deck-action:focus-visible {
  outline: 2px solid #aed6f1;
  outline-offset: 2px;
}

html.dark .deck-action {
  background: var(--color-surface-overlay);
  border-color: var(--color-line-strong);
  color: var(--color-ink);
}

.deck-action:hover:not(:disabled) {
  background: var(--tint-slate-5);
}

html.dark .deck-action:hover:not(:disabled) {
  background: var(--color-surface-hover);
}
</style>
