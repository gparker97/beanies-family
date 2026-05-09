<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

/**
 * Green-tinted confirmation row used by Account / Recurring / Activity
 * steps after a successful Add. Single-source visual contract — adding
 * a 4th caller is just `<OnboardingAddedRow ... />` with no new code.
 *
 * When `removable` is true, a small trash button renders on the right.
 * Caller is responsible for the actual store mutation in their `@remove`
 * handler — this component only emits.
 */
defineProps<{
  /** Leading icon glyph (emoji or single char). */
  icon: string;
  /** Bold primary label — account name / description / activity title. */
  title: string;
  /** Faded sub-label. Optional; pass empty/undefined to omit. */
  meta?: string;
  /**
   * Right-aligned tag chip — type label like "savings" / "expense" /
   * activity category. Optional.
   */
  tag?: string;
  /**
   * Visual variant for the tag chip. `category` = neutral slate (default,
   * Account + Activity); `income` / `expense` = green/orange tint
   * (Recurring step's two flavors).
   */
  tagVariant?: 'category' | 'income' | 'expense';
  /** When true, renders a trash button that emits `remove`. */
  removable?: boolean;
}>();

const emit = defineEmits<{
  remove: [];
}>();

const { t } = useTranslation();
</script>

<template>
  <div class="ob-added-row">
    <span class="text-base">{{ icon }}</span>
    <div class="min-w-0 flex-1">
      <div class="font-heading truncate text-xs font-bold">{{ title }}</div>
      <div v-if="meta" class="truncate text-xs opacity-45">{{ meta }}</div>
    </div>
    <span
      v-if="tag"
      :class="
        tagVariant === 'income'
          ? 'ob-added-type ob-type-income'
          : tagVariant === 'expense'
            ? 'ob-added-type ob-type-expense'
            : 'ob-added-category'
      "
    >
      {{ tag }}
    </span>
    <span class="text-xs font-bold" style="color: #27ae60">✓</span>
    <button
      v-if="removable"
      type="button"
      class="ob-added-remove"
      :aria-label="t('onboarding.remove')"
      :title="t('onboarding.remove')"
      @click="emit('remove')"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.ob-added-remove {
  background: rgb(241 93 34 / 8%);
  border: none;
  border-radius: 6px;
  color: var(--heritage-orange, #f15d22);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- decorative X glyph in fixed-size button */
  font-size: 14px;
  font-weight: 700;
  height: 22px;
  line-height: 1;
  padding: 0;
  transition: background 0.15s;
  width: 22px;
}

.ob-added-remove:hover {
  background: rgb(241 93 34 / 16%);
}
</style>
