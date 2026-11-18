<script setup lang="ts">
import { computed } from 'vue';
import GroupedChipPicker from '@/components/ui/GroupedChipPicker.vue';
import type { ChipGroup } from '@/components/ui/GroupedChipPicker.vue';
import {
  getActivityCategoriesGrouped,
  ACTIVITY_GROUP_EMOJI_MAP,
  ACTIVITY_EMOJI_MAP,
} from '@/constants/activityCategories';
import { useActivityCategoryLabel } from '@/composables/useActivityCategoryLabel';
import { OCCASION_TYPES, isOccasionCategory } from '@/utils/occasions';
import type { ActivityCategoryDef } from '@/constants/activityCategories';

defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { categoryLabel, groupLabel } = useActivityCategoryLabel();

/** The words the search matches besides the name: the guess's own, strong and weak. The
 *  occasions keep theirs on `OCCASION_TYPES`, their one definition. */
function searchWords(cat: ActivityCategoryDef): readonly string[] {
  const occasion = isOccasionCategory(cat.id) ? OCCASION_TYPES[cat.id].keywords : [];
  return [...cat.keywords, ...(cat.weakKeywords ?? []), ...occasion];
}

const groups = computed<ChipGroup[]>(() =>
  getActivityCategoriesGrouped().map((g) => ({
    name: groupLabel(g.name),
    icon: ACTIVITY_GROUP_EMOJI_MAP[g.name] || '📌',
    items: g.categories.map((cat) => ({
      value: cat.id,
      label: categoryLabel(cat.id),
      icon: ACTIVITY_EMOJI_MAP[cat.id] || '📌',
      keywords: searchWords(cat),
    })),
  }))
);
</script>

<template>
  <GroupedChipPicker
    :model-value="modelValue"
    :groups="groups"
    searchable
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
