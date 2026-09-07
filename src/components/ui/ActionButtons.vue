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
    size?: 'sm' | 'md' | 'lg';
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
} as const;

const BASE =
  'dark:hover:bg-surface-hover rounded-lg text-gray-400 transition-colors hover:bg-gray-100';

const btn = (tone: 'primary' | 'danger'): string =>
  [
    SIZES[props.size].btn,
    BASE,
    tone === 'danger' ? 'hover:text-red-600' : 'hover:text-primary-600',
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
