<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';

const { t } = useTranslation();
const familyStore = useFamilyStore();

const emit = defineEmits<{
  add: [payload: { title: string; dueDate?: string; assigneeId?: string }];
}>();

const title = ref('');
const dueDate = ref('');
const assigneeId = ref('');

function handleAdd() {
  const trimmed = title.value.trim();
  if (!trimmed) return;

  emit('add', {
    title: trimmed,
    dueDate: dueDate.value || undefined,
    assigneeId: assigneeId.value || undefined,
  });

  title.value = '';
  dueDate.value = '';
  assigneeId.value = '';
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAdd();
  }
}
</script>

<template>
  <div class="flex gap-2">
    <!-- Main input bar -->
    <div
      class="flex flex-1 items-center gap-2.5 rounded-2xl px-4 py-3.5"
      style="background: var(--tint-slate-5)"
    >
      <span class="text-lg opacity-40">✏️</span>
      <input
        v-model="title"
        type="text"
        :placeholder="t('todo.quickAddPlaceholder')"
        class="font-outfit min-w-0 flex-1 bg-transparent text-base font-medium text-[var(--color-text)] outline-none placeholder:opacity-40"
        @keydown="handleKeydown"
      />
      <button
        v-if="title.trim()"
        type="button"
        class="font-outfit shrink-0 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90"
        style="background: linear-gradient(135deg, #9b59b6, #8e44ad)"
        @click="handleAdd"
      >
        {{ t('action.add') }}
      </button>
    </div>

    <!-- Date picker -->
    <div
      class="flex shrink-0 items-center gap-1.5 rounded-2xl px-3 transition-colors"
      :class="dueDate ? 'bg-[var(--tint-orange-8)]' : ''"
      :style="!dueDate ? 'background: var(--tint-slate-5)' : undefined"
    >
      <span class="text-base">📅</span>
      <input
        v-model="dueDate"
        type="date"
        class="beanies-input font-outfit cursor-pointer border-none bg-transparent py-3 text-xs font-semibold shadow-none focus:shadow-none focus:ring-0"
        :style="{ color: dueDate ? 'var(--color-primary)' : 'var(--color-text)' }"
      />
    </div>

    <!-- Assign dropdown -->
    <div
      class="flex shrink-0 items-center gap-1.5 rounded-2xl px-3 transition-colors"
      :class="assigneeId ? 'bg-[var(--tint-purple-8)]' : ''"
      :style="!assigneeId ? 'background: var(--tint-slate-5)' : undefined"
    >
      <span class="text-base">👤</span>
      <select
        v-model="assigneeId"
        class="beanies-input font-outfit cursor-pointer border-none bg-transparent py-3 text-xs font-semibold text-[var(--color-text)] shadow-none focus:shadow-none focus:ring-0"
      >
        <option value="">{{ t('todo.assignTo') }}</option>
        <option v-for="member in familyStore.members" :key="member.id" :value="member.id">
          {{ member.name }}
        </option>
      </select>
    </div>
  </div>
</template>
