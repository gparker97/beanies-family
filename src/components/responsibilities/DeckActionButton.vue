<script setup lang="ts">
/**
 * Who Owns What (#109): the outlined deck action button, shared by the deal pile, the deal
 * board's tap picker and the check-in drawer so they stay one look. Sits on a raised or
 * overlay surface in both modes.
 *
 * `variant="choice"` is the deal pile's Keep / Skip / revisit buttons (round 7): larger, and
 * every choice looks equally unselected until it is hovered (pointer devices only, so a tap
 * can't leave it lit), focused from the keyboard, or its shortcut is pressed (the one-shot
 * `key-press` animation in `style.css`, which paints the `--press-*` tokens from `style.css` so it can
 * never stick, and is killed under reduced motion).
 */
withDefaults(defineProps<{ disabled?: boolean; variant?: 'default' | 'choice' }>(), {
  disabled: false,
  variant: 'default',
});
defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    class="deck-action"
    :class="{ 'is-choice': variant === 'choice' }"
    :disabled="disabled"
    @click="$emit('click')"
  >
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

/* ── choice ─────────────────────────────────────────────────────────────── */
.deck-action.is-choice {
  align-items: center;
  border: 1.5px solid var(--color-border-strong);
  border-radius: 1rem;
  display: inline-flex;
  font-weight: 700;
  gap: 0.5rem;
  justify-content: center;
  padding: 0.75rem 0.625rem;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}

.deck-action.is-choice:focus-visible {
  background: var(--press-bg);
  border-color: var(--press-edge);
}

html.dark .deck-action.is-choice {
  background: var(--color-surface-raised);
}

html.dark .deck-action.is-choice:focus-visible {
  background: var(--press-bg);
  border-color: var(--press-edge);
}

@media (hover: hover) {
  .deck-action.is-choice:hover:not(:disabled) {
    background: var(--press-bg);
    border-color: var(--press-edge);
  }

  html.dark .deck-action.is-choice:hover:not(:disabled) {
    background: var(--press-bg);
    border-color: var(--press-edge);
  }
}

@media (hover: none) {
  .deck-action.is-choice:hover:not(:disabled) {
    background: #fff;
  }

  html.dark .deck-action.is-choice:hover:not(:disabled) {
    background: var(--color-surface-raised);
  }
}
</style>
