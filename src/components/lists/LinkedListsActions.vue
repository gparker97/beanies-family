<script setup lang="ts">
/**
 * The Lists section's action pills ("+ New List", "From a Template", "Attach a List"), rendered
 * in one place for both spots the section shows them: the eyebrow (lists linked) and the dashed
 * empty row. All are disabled while a create is in flight, so a second action cannot open a
 * sheet under the list that create is about to open.
 */
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface LinkedListsAction {
  key: 'blank' | 'template' | 'attach';
  labelKey: UIStringKey;
  primary: boolean;
  run: () => void;
}

defineProps<{ actions: LinkedListsAction[]; disabled: boolean }>();

const { t } = useTranslation();

// The mockup's mini pills: "+ New List" in Heritage Orange tint, the others quiet. Both tints
// carry their own dark values; text pairs with its dark ink / `-lift` partner.
function actionClass(action: LinkedListsAction): string {
  return action.primary
    ? 'text-primary-600 dark:text-accent-lift bg-[var(--tint-orange-8)] enabled:hover:bg-[var(--tint-orange-15)]'
    : 'dark:text-ink-soft bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] enabled:hover:bg-[var(--tint-orange-8)]';
}
</script>

<template>
  <button
    v-for="action in actions"
    :key="action.key"
    type="button"
    class="linked-lists-action"
    :class="actionClass(action)"
    :disabled="disabled"
    :data-testid="`linked-lists-${action.key}`"
    @click="action.run"
  >
    {{ t(action.labelKey) }}
  </button>
</template>

<style scoped>
/* The mini pill buttons (mockup `.mini-btn`); colors come from the utilities on each button so the
   light/dark pairs sit together. */
.linked-lists-action {
  align-items: center;
  border-radius: 9999px;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.25rem;
  line-height: 1rem;
  padding: 0.3125rem 0.625rem;
  transition: background-color 0.15s;
  white-space: nowrap;
}

.linked-lists-action:focus-visible {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
}

.linked-lists-action:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
