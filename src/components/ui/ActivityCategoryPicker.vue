<script setup lang="ts">
import { computed } from 'vue';
import GroupedChipPicker from '@/components/ui/GroupedChipPicker.vue';
import type { ChipGroup } from '@/components/ui/GroupedChipPicker.vue';
import {
  getActivityCategoriesGrouped,
  ACTIVITY_GROUP_EMOJI_MAP,
  ACTIVITY_EMOJI_MAP,
} from '@/constants/activityCategories';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { isBeanieMode } = useTranslation();

const groups = computed<ChipGroup[]>(() =>
  getActivityCategoriesGrouped().map((g) => ({
    name: isBeanieMode.value ? g.name.toLowerCase() : g.name,
    icon: ACTIVITY_GROUP_EMOJI_MAP[g.name] || '📌',
    items: g.categories.map((cat) => ({
      value: cat.id,
      label: isBeanieMode.value ? cat.name.toLowerCase() : cat.name,
      icon: ACTIVITY_EMOJI_MAP[cat.id] || '📌',
    })),
  }))
);
</script>

<template>
  <GroupedChipPicker
    :model-value="modelValue"
    :groups="groups"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
