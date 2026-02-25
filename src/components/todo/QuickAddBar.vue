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
      <span class="text-base opacity-30">✏️</span>
      <input
        v-model="title"
        type="text"
        :placeholder="t('todo.quickAddPlaceholder')"
        class="font-outfit min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--color-text)] outline-none placeholder:opacity-30"
        @keydown="handleKeydown"
      />
      <button
        v-if="title.trim()"
        type="button"
        class="font-outfit shrink-0 rounded-xl px-4 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
        style="background: linear-gradient(135deg, #9b59b6, #8e44ad)"
        @click="handleAdd"
      >
        {{ t('action.add') }}
      </button>
    </div>

    <!-- Date button -->
    <button
      type="button"
      class="relative flex shrink-0 items-center gap-1 rounded-2xl px-3.5 py-3 transition-colors"
      :class="dueDate ? 'bg-[var(--tint-orange-8)]' : 'opacity-35'"
      :style="!dueDate ? 'background: var(--tint-slate-5)' : undefined"
      @click="($refs.dateInput as HTMLInputElement)?.showPicker()"
    >
      <span class="text-sm">📅</span>
      <span class="font-outfit text-[0.65rem] font-semibold">{{ t('todo.dueDate') }}</span>
      <input
        ref="dateInput"
        v-model="dueDate"
        type="date"
        class="absolute inset-0 cursor-pointer opacity-0"
      />
    </button>

    <!-- Assign button -->
    <div
      class="relative flex shrink-0 items-center gap-1 rounded-2xl px-3.5 py-3 transition-colors"
      :class="assigneeId ? 'bg-[var(--tint-purple-8)]' : 'opacity-35'"
      :style="!assigneeId ? 'background: var(--tint-slate-5)' : undefined"
    >
      <span class="text-sm">👤</span>
      <span class="font-outfit text-[0.65rem] font-semibold">{{ t('todo.assignTo') }}</span>
      <select v-model="assigneeId" class="absolute inset-0 cursor-pointer opacity-0">
        <option value="">{{ t('todo.unassigned') }}</option>
        <option v-for="member in familyStore.members" :key="member.id" :value="member.id">
          {{ member.name }}
        </option>
      </select>
    </div>
  </div>
</template>
