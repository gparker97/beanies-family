<script setup lang="ts">
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useTranslation } from '@/composables/useTranslation';

const familyStore = useFamilyStore();
const memberFilter = useMemberFilterStore();
const { t } = useTranslation();

const members = computed(() => familyStore.members);

function toggleAll() {
  if (memberFilter.isAllSelected) return;
  memberFilter.selectAll();
}

function toggleMember(id: string) {
  memberFilter.toggleMember(id);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <!-- All members chip -->
    <button
      type="button"
      class="inline-flex cursor-pointer items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all"
      :class="
        memberFilter.isAllSelected
          ? 'bg-gradient-to-r from-[#2C3E50] to-[#3D5368] text-white'
          : 'bg-[var(--tint-slate-5)] text-[var(--color-text)]/65 dark:bg-slate-700 dark:text-gray-400'
      "
      @click="toggleAll"
    >
      <span class="text-base">&#x1F468;&#x200D;&#x1F469;&#x200D;&#x1F467;</span>
      {{ t('filter.allMembers') }}
    </button>

    <!-- Individual member chips -->
    <button
      v-for="member in members"
      :key="member.id"
      type="button"
      class="inline-flex cursor-pointer items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all"
      :class="
        memberFilter.isMemberSelected(member.id) && !memberFilter.isAllSelected
          ? 'bg-gradient-to-r from-[#2C3E50] to-[#3D5368] text-white'
          : 'bg-[var(--tint-slate-5)] text-[var(--color-text)]/65 dark:bg-slate-700 dark:text-gray-400'
      "
      @click="toggleMember(member.id)"
    >
      <span
        class="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[0.6rem] font-bold text-white"
        :style="{ background: `linear-gradient(135deg, ${member.color}, ${member.color}dd)` }"
      >
        {{ member.name.charAt(0).toUpperCase() }}
      </span>
      {{ member.name }}
    </button>
  </div>
</template>
