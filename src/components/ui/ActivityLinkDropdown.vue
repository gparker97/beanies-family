<script setup lang="ts">
import { computed } from 'vue';
import EntityLinkDropdown from './EntityLinkDropdown.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { normalizeAssignees } from '@/utils/assignees';

defineProps<{
  modelValue?: string;
}>();

defineEmits<{
  'update:modelValue': [value: string | undefined];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const { getMemberName } = useMemberInfo();

const items = computed(() =>
  activityStore.activeActivities.map((a) => {
    const names = normalizeAssignees(a)
      .map((id) => getMemberName(id))
      .filter((n) => n !== 'Unknown');
    return {
      id: a.id,
      icon: a.icon || '📋',
      label: a.title,
      secondary: names.length ? names.join(', ') : undefined,
    };
  })
);
</script>

<template>
  <EntityLinkDropdown
    :model-value="modelValue"
    :items="items"
    :placeholder="t('modal.selectActivity')"
    :empty-text="t('modal.noMoreActivities')"
    default-icon="📋"
    @update:model-value="$emit('update:modelValue', $event)"
  />
</template>
