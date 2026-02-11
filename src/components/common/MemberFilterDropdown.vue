<script setup lang="ts">
import { computed, watch } from 'vue';
import BaseMultiSelect from '@/components/ui/BaseMultiSelect/index.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';

const familyStore = useFamilyStore();
const memberFilterStore = useMemberFilterStore();
const { t } = useTranslation();

// Convert Set to array for v-model
const selectedIds = computed({
  get: () => Array.from(memberFilterStore.selectedMemberIds),
  set: (value: string[]) => {
    // Update the store by syncing selections
    for (const member of familyStore.members) {
      const isCurrentlySelected = memberFilterStore.isMemberSelected(member.id);
      const shouldBeSelected = value.includes(member.id);

      if (isCurrentlySelected !== shouldBeSelected) {
        memberFilterStore.toggleMember(member.id);
      }
    }
  },
});

// Build options from family members
const memberOptions = computed(() =>
  familyStore.members.map((member) => ({
    value: member.id,
    label: member.name,
    color: member.color || '#3b82f6',
  }))
);

// Watch for family member changes and sync the filter
watch(
  () => familyStore.members.length,
  () => {
    if (memberFilterStore.isInitialized) {
      memberFilterStore.syncWithMembers();
    }
  }
);

// Compact display for header
const _displayText = computed(() => {
  if (!memberFilterStore.isInitialized || familyStore.members.length === 0) {
    return t('filter.members');
  }
  if (memberFilterStore.isAllSelected) {
    return t('filter.allMembers');
  }
  const count = memberFilterStore.selectedCount;
  const total = familyStore.members.length;
  return `${count}/${total}`;
});
</script>

<template>
  <div v-if="familyStore.members.length > 0" class="relative">
    <BaseMultiSelect
      v-model="selectedIds"
      :options="memberOptions"
      :min-selection="1"
      :all-selected-label="t('filter.allMembers')"
      count-label=""
      :placeholder="t('filter.members')"
    />
  </div>
</template>
