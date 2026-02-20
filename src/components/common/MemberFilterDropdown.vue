<script setup lang="ts">
import { computed, watch } from 'vue';
import BaseMultiSelect from '@/components/ui/BaseMultiSelect/index.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import type { Gender, AgeGroup } from '@/types/models';

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

// Build options from family members (include gender/ageGroup for avatar rendering)
const memberOptions = computed(() =>
  familyStore.members.map((member) => ({
    value: member.id,
    label: member.name,
    color: member.color || '#3b82f6',
    gender: member.gender,
    ageGroup: member.ageGroup,
  }))
);

// Look up the single selected member (when exactly 1 is selected)
const singleSelectedMember = computed(() => {
  if (selectedIds.value.length !== 1) return null;
  const opt = memberOptions.value.find((o) => o.value === selectedIds.value[0]);
  return opt ?? null;
});

// Watch for family member changes and sync the filter
watch(
  () => familyStore.members.length,
  () => {
    if (memberFilterStore.isInitialized) {
      memberFilterStore.syncWithMembers();
    }
  }
);
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
      :borderless="true"
    >
      <!-- Custom trigger: show avatar icons instead of text -->
      <template #trigger="{ isAllSelected, selectedCount }">
        <div class="flex items-center gap-2">
          <!-- All members selected: large family group icon + "all" -->
          <template v-if="isAllSelected">
            <BeanieAvatar variant="family-group" color="#3b82f6" size="lg" />
            <span class="text-sm text-gray-700 dark:text-gray-300">all</span>
          </template>
          <!-- Single member selected: their avatar + name -->
          <template v-else-if="singleSelectedMember">
            <BeanieAvatar
              :variant="
                getMemberAvatarVariant({
                  gender: singleSelectedMember.gender,
                  ageGroup: singleSelectedMember.ageGroup,
                })
              "
              :color="singleSelectedMember.color"
              size="lg"
            />
            <span class="text-sm text-gray-700 dark:text-gray-300">
              {{ singleSelectedMember.label }}
            </span>
          </template>
          <!-- Multiple but not all: filtered icon + count -->
          <template v-else>
            <BeanieAvatar variant="family-filtered" color="#3b82f6" size="lg" />
            <span class="text-sm text-gray-700 dark:text-gray-300">
              {{ selectedCount }}
            </span>
          </template>
        </div>
      </template>

      <template #option="{ option }">
        <BeanieAvatar
          :variant="
            getMemberAvatarVariant({
              gender: option.gender as Gender | undefined,
              ageGroup: option.ageGroup as AgeGroup | undefined,
            })
          "
          :color="option.color as string"
          size="xs"
        />
        <span class="truncate text-sm text-gray-700 dark:text-gray-300">
          {{ option.label }}
        </span>
      </template>
    </BaseMultiSelect>
  </div>
</template>
