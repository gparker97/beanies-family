<script setup lang="ts">
/**
 * Stars and rewards (#148): a star glyph and a number. The quiet count on a child's wall lane
 * header and day head: the week's stars toward the weekly reward (`kind: 'week'`, "22 stars this
 * week") or, with no weekly reward, the stars saved toward the nearest saved-up award (`kind:
 * 'saved'`, "64 stars saved up"; the arc's own `kind` says which). And a chore's value on its row
 * (`kind: 'value'`, "Worth 2 stars"). Presentational: the number arrives from the star store.
 *
 * The spoken label is on the root (`role="img"`), so a screen reader hears one phrase, not a
 * glyph and a bare number.
 *
 * Dark mode (plan, Dark Mode Coverage): the glyph is Terracotta as an accent icon,
 * `text-terracotta-600` / `terracotta-lift`; the number `text-secondary-500` / `ink-soft`.
 * Nothing is painted behind it, and there is no opacity modifier.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { STAR_GLYPH_PATH } from '@/components/chores/starText';
import type { UIStringKey } from '@/services/translation/uiStrings';

type StarCountKind = 'week' | 'saved' | 'value';

const props = withDefaults(
  defineProps<{
    count: number;
    /** Which phrase a screen reader hears: the week's stars, the stars saved up, or a value. */
    kind?: StarCountKind;
    /** `sm` is a row's value tag (`text-xs`); `md` the header count (`text-sm`). */
    size?: 'sm' | 'md';
  }>(),
  { kind: 'week', size: 'md' }
);

const { t } = useTranslation();

const LABEL: Record<StarCountKind, { one: UIStringKey; other: UIStringKey }> = {
  week: { one: 'choreStars.count.one', other: 'choreStars.count.other' },
  saved: { one: 'choreStars.count.saved.one', other: 'choreStars.count.saved.other' },
  value: { one: 'choreStars.value.one', other: 'choreStars.value.other' },
};

const label = computed(() => {
  const keys = LABEL[props.kind];
  return fillTemplate(t(props.count === 1 ? keys.one : keys.other), { count: props.count });
});
</script>

<template>
  <span
    class="font-outfit text-secondary-500 dark:text-ink-soft inline-flex flex-none items-center gap-1 font-bold whitespace-nowrap"
    :class="size === 'sm' ? 'text-xs' : 'text-sm'"
    role="img"
    :aria-label="label"
    data-testid="star-count"
    :data-kind="kind"
  >
    <svg
      class="text-terracotta-600 dark:text-terracotta-lift flex-none"
      :class="size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path :d="STAR_GLYPH_PATH" />
    </svg>
    <span aria-hidden="true">{{ count }}</span>
  </span>
</template>
