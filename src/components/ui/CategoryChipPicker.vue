<script setup lang="ts">
import { computed } from 'vue';
import GroupedChipPicker from '@/components/ui/GroupedChipPicker.vue';
import type { ChipGroup } from '@/components/ui/GroupedChipPicker.vue';
import { getCategoriesGrouped, GROUP_EMOJI_MAP, CATEGORY_EMOJI_MAP } from '@/constants/categories';

const props = defineProps<{
  modelValue: string;
  type: 'income' | 'expense';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const groups = computed<ChipGroup[]>(() =>
  getCategoriesGrouped(props.type).map((g) => ({
    name: g.name,
    icon: GROUP_EMOJI_MAP[g.name] || '📦',
    items: g.categories.map((cat) => ({
      value: cat.id,
      label: cat.name,
      icon: CATEGORY_EMOJI_MAP[cat.id] || '📦',
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
