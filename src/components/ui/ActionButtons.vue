<script setup lang="ts">
/**
 * The app's icon-action cluster: edit / copy / delete as neutral icon buttons that take
 * their tone on hover. Used by the Accounts and Transactions rows and by the Beanie List
 * tiles.
 *
 * Visibility is three static booleans rather than a data-driven `actions` array on
 * purpose: with three call sites, `v-if` says the same thing as a config array plus an
 * exported type, a dispatcher and a tone map — and it keeps "who emits `copy`?"
 * answerable by grep.
 */
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useTranslation } from '@/composables/useTranslation';

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg' | 'xl';
    editTestId?: string;
    /** `showDelete`, not `delete` — `delete` is a JS keyword and cannot be a bare
     *  template expression. Defaults reproduce the original edit+delete pair, so the
     *  pre-existing call sites need no changes. */
    showEdit?: boolean;
    showCopy?: boolean;
    showDelete?: boolean;
  }>(),
  { size: 'sm', showEdit: true, showCopy: false, showDelete: true }
);

defineEmits<{
  edit: [];
  copy: [];
  delete: [];
}>();

const { t } = useTranslation();

/**
 * The BUTTON scale and the GLYPH scale are not the same scale. `BeanieIcon`'s `lg` is
 * 24px, but the brand convention this cluster follows is a 36px button around a 16px
 * glyph (see `BeanCard`), so `lg` deliberately pairs a bigger box with the `sm` glyph.
 */
const SIZES = {
  sm: { btn: 'p-1.5', glyph: 'sm' },
  md: { btn: 'p-2', glyph: 'md' },
  lg: { btn: 'flex h-9 w-9 items-center justify-center', glyph: 'sm' },
  /**
   * 44px, for the beanie wall. A wall-mounted tablet is read and tapped from
   * across a kitchen, and 36px is the app's desk-distance size; every control a
   * child reaches for on the wall holds this floor.
   */
  xl: { btn: 'flex h-11 w-11 items-center justify-center', glyph: 'md' },
} as const;

/**
 * `text-gray-400` and `hover:text-red-600` are raw Tailwind greys with no dark
 * partner, so the resting glyph and the hover both fell back to a light-mode
 * colour on a dark surface. The dark partners below are strictly ADDITIVE:
 * light mode is pixel-identical to what shipped, and only dark mode changes.
 */
const BASE =
  'dark:hover:bg-surface-hover dark:text-ink-faint rounded-lg text-gray-400 transition-colors hover:bg-gray-100';

const btn = (tone: 'primary' | 'danger'): string =>
  [
    SIZES[props.size].btn,
    BASE,
    tone === 'danger'
      ? 'hover:text-red-600 dark:hover:text-danger-lift'
      : 'hover:text-primary-600 dark:hover:text-accent-lift',
  ].join(' ');
</script>

<template>
  <div class="flex gap-1">
    <button
      v-if="showEdit"
      type="button"
      :class="btn('primary')"
      :data-testid="editTestId"
      :title="t('action.edit')"
      @click="$emit('edit')"
    >
      <BeanieIcon name="edit" :size="SIZES[size].glyph" />
    </button>
    <button
      v-if="showCopy"
      type="button"
      :class="btn('primary')"
      :title="t('action.copy')"
      @click="$emit('copy')"
    >
      <BeanieIcon name="copy" :size="SIZES[size].glyph" />
    </button>
    <button
      v-if="showDelete"
      type="button"
      :class="btn('danger')"
      :title="t('action.delete')"
      @click="$emit('delete')"
    >
      <BeanieIcon name="trash" :size="SIZES[size].glyph" />
    </button>
  </div>
</template>
