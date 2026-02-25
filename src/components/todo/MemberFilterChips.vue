<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';

const { t } = useTranslation();
const familyStore = useFamilyStore();

defineProps<{
  selected: string; // 'all' | memberId | 'unassigned'
}>();

const emit = defineEmits<{
  'update:selected': [value: string];
}>();
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <!-- All Beans -->
    <button
      class="font-outfit inline-flex items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-[0.6rem] font-semibold transition-all"
      :class="selected === 'all' ? 'text-white' : 'text-[var(--color-text)] opacity-50'"
      :style="
        selected === 'all'
          ? 'background: linear-gradient(135deg, var(--color-secondary-500), #3D5368)'
          : 'background: var(--tint-slate-5)'
      "
      @click="emit('update:selected', 'all')"
    >
      <span class="text-[0.65rem]">👨‍👩‍👦</span>
      {{ t('todo.allBeans') }}
    </button>

    <!-- Individual members -->
    <button
      v-for="member in familyStore.members"
      :key="member.id"
      class="font-outfit inline-flex items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-[0.6rem] font-semibold transition-all"
      :class="selected === member.id ? 'text-white' : 'text-[var(--color-text)] opacity-50'"
      :style="
        selected === member.id
          ? 'background: linear-gradient(135deg, var(--color-secondary-500), #3D5368)'
          : 'background: var(--tint-slate-5)'
      "
      @click="emit('update:selected', member.id)"
    >
      <span
        class="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[0.5rem] font-bold text-white"
        :style="{ background: `linear-gradient(135deg, ${member.color}, ${member.color}dd)` }"
      >
        {{ member.name.charAt(0).toUpperCase() }}
      </span>
      {{ member.name }}
    </button>

    <!-- Unassigned -->
    <button
      class="font-outfit inline-flex items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-[0.6rem] font-semibold transition-all"
      :class="selected === 'unassigned' ? 'text-white' : 'text-[var(--color-text)] opacity-50'"
      :style="
        selected === 'unassigned'
          ? 'background: linear-gradient(135deg, var(--color-secondary-500), #3D5368)'
          : 'background: var(--tint-slate-5)'
      "
      @click="emit('update:selected', 'unassigned')"
    >
      <span class="text-[0.55rem] opacity-60">🚫</span>
      {{ t('todo.unassigned') }}
    </button>
  </div>
</template>
