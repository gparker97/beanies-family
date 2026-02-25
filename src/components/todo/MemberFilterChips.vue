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
  <div class="flex flex-wrap gap-1.5">
    <!-- All Beans -->
    <button
      class="rounded-full px-3 py-1.5 text-xs font-medium transition-all"
      :class="
        selected === 'all'
          ? 'bg-[var(--tint-purple-15)] text-purple-500 dark:text-purple-400'
          : 'bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]'
      "
      @click="emit('update:selected', 'all')"
    >
      {{ t('todo.allBeans') }}
    </button>

    <!-- Individual members -->
    <button
      v-for="member in familyStore.members"
      :key="member.id"
      class="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all"
      :class="
        selected === member.id
          ? 'bg-[var(--tint-purple-15)] text-purple-500 dark:text-purple-400'
          : 'bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]'
      "
      @click="emit('update:selected', member.id)"
    >
      <span
        class="inline-block h-2.5 w-2.5 rounded-full"
        :style="{ backgroundColor: member.color }"
      />
      {{ member.name }}
    </button>

    <!-- Unassigned -->
    <button
      class="rounded-full px-3 py-1.5 text-xs font-medium transition-all"
      :class="
        selected === 'unassigned'
          ? 'bg-[var(--tint-purple-15)] text-purple-500 dark:text-purple-400'
          : 'bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]'
      "
      @click="emit('update:selected', 'unassigned')"
    >
      {{ t('todo.unassigned') }}
    </button>
  </div>
</template>
