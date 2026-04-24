<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import AssigneePickerButton from '@/components/ui/AssigneePickerButton.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';

const { t } = useTranslation();

const emit = defineEmits<{
  add: [payload: { title: string; dueDate?: string; assigneeIds?: string[] }];
}>();

const title = ref('');
const dueDate = ref('');
const assigneeIds = ref<string[]>([]);
const titleInput = ref<HTMLInputElement>();

function focus() {
  titleInput.value?.focus();
}

defineExpose({ focus });

function handleAdd() {
  const trimmed = title.value.trim();
  if (!trimmed) return;

  emit('add', {
    title: trimmed,
    dueDate: dueDate.value || undefined,
    assigneeIds: assigneeIds.value.length > 0 ? assigneeIds.value : undefined,
  });

  title.value = '';
  dueDate.value = '';
  assigneeIds.value = [];
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAdd();
  }
}
</script>

<template>
  <div class="space-y-2">
    <!-- Row 1: Input bar + date (desktop) + assignee (desktop) -->
    <div class="flex gap-2">
      <div
        class="flex flex-1 items-center gap-2.5 rounded-2xl px-4 py-3.5"
        style="background: var(--tint-slate-5)"
      >
        <span class="text-lg opacity-40">✏️</span>
        <input
          ref="titleInput"
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

      <!-- Date picker (desktop) -->
      <div class="hidden shrink-0 sm:block">
        <BeanieDatePicker v-model="dueDate" :placeholder="t('todo.selectDueDate')" />
      </div>

      <!-- Assignee (desktop) -->
      <div class="hidden sm:flex">
        <AssigneePickerButton v-model="assigneeIds" />
      </div>
    </div>

    <!-- Row 2: Date + Assignee on same line (mobile only) -->
    <div class="grid grid-cols-2 gap-2 sm:hidden">
      <BeanieDatePicker v-model="dueDate" :placeholder="t('todo.selectDueDate')" />
      <div class="flex items-center gap-1.5">
        <span class="font-outfit text-xs font-semibold text-[var(--color-text)] opacity-35">
          {{ t('todo.who') }}
        </span>
        <AssigneePickerButton v-model="assigneeIds" size="sm" class="flex-1" />
      </div>
    </div>
  </div>
</template>
