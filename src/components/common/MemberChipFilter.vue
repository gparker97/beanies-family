<script setup lang="ts">
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

withDefaults(
  defineProps<{
    isAllActive: boolean;
    isMemberActive: (id: string) => boolean;
    showUnassigned?: boolean;
    isUnassignedActive?: boolean;
    allLabel?: string;
  }>(),
  {
    showUnassigned: false,
    isUnassignedActive: false,
  }
);

const emit = defineEmits<{
  'select-all': [];
  'select-member': [id: string];
  'select-unassigned': [];
}>();

const familyStore = useFamilyStore();
const { t } = useTranslation();

const chipBase =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all';
const chipActive = 'bg-gradient-to-r from-secondary-500 to-[#3D5368] text-white';
const chipInactive =
  'bg-[var(--tint-slate-5)] text-[var(--color-text)]/65 dark:bg-slate-700 dark:text-gray-400';
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <!-- All members chip -->
    <button
      type="button"
      :class="[chipBase, isAllActive ? chipActive : chipInactive]"
      @click="emit('select-all')"
    >
      <span class="text-base">&#x1F468;&#x200D;&#x1F469;&#x200D;&#x1F467;</span>
      {{ allLabel ?? t('filter.allMembers') }}
    </button>

    <!-- Individual member chips -->
    <button
      v-for="member in familyStore.members"
      :key="member.id"
      type="button"
      :class="[chipBase, isMemberActive(member.id) ? chipActive : chipInactive]"
      @click="emit('select-member', member.id)"
    >
      <span
        class="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[0.6rem] font-bold text-white"
        :style="{ background: `linear-gradient(135deg, ${member.color}, ${member.color}dd)` }"
      >
        {{ member.name.charAt(0).toUpperCase() }}
      </span>
      {{ member.name }}
    </button>

    <!-- Unassigned chip (optional) -->
    <button
      v-if="showUnassigned"
      type="button"
      :class="[chipBase, isUnassignedActive ? chipActive : chipInactive]"
      @click="emit('select-unassigned')"
    >
      <span class="text-base opacity-60">🚫</span>
      {{ t('todo.unassigned') }}
    </button>
  </div>
</template>
