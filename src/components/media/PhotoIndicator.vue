<script setup lang="ts">
/**
 * Tiny "this entity has photos" indicator. Drop into card / chip
 * surfaces next to the entity title. Renders nothing when there are
 * no photos, so it's safe to scatter unconditionally.
 *
 * Entity-agnostic — works for any entity with `photoIds?: UUID[]`.
 * Defaults to icon-only; opt into a count number with `show-count`.
 *
 * Usage:
 *   <PhotoIndicator :photo-ids="activity.photoIds" />
 *   <PhotoIndicator :photo-ids="recipe.photoIds" show-count />
 */
import { computed } from 'vue';
import type { UUID } from '@/types/models';
import { useTranslation } from '@/composables/useTranslation';

const props = withDefaults(
  defineProps<{
    photoIds?: UUID[] | null;
    /** Show the numeric count after the icon when count > 1. Default: icon only. */
    showCount?: boolean;
    /** Lead glyph. Defaults to 📷 (photos); the travel surface passes 📎 (documents). */
    icon?: string;
  }>(),
  { photoIds: null, showCount: false, icon: '📷' }
);

const { t } = useTranslation();

const count = computed(() => props.photoIds?.length ?? 0);

const ariaLabel = computed(() =>
  count.value === 1
    ? t('photos.indicator.one')
    : t('photos.indicator.many').replace('{n}', String(count.value))
);
</script>

<template>
  <span
    v-if="count > 0"
    class="ml-1 inline-flex flex-shrink-0 items-center gap-0.5 text-xs leading-none opacity-70"
    :aria-label="ariaLabel"
    role="img"
  >
    {{ icon }}<span v-if="showCount && count > 1">{{ count }}</span>
  </span>
</template>
