<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import AssigneePickerButton from '@/components/ui/AssigneePickerButton.vue';

const { t } = useTranslation();

const emit = defineEmits<{
  add: [payload: { title: string; dueDate?: string; assigneeIds?: string[] }];
}>();

const title = ref('');
const dueDate = ref('');
const assigneeIds = ref<string[]>([]);
const titleInput = ref<HTMLInputElement>();
const dateInputFocused = ref(false);

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
      <div
        class="hidden shrink-0 items-center gap-1.5 rounded-2xl px-3 transition-colors sm:flex"
        :class="dueDate ? 'bg-[var(--tint-orange-8)]' : ''"
        :style="!dueDate ? 'background: var(--tint-slate-5)' : undefined"
      >
        <span class="text-base">📅</span>
        <div class="relative">
          <input
            v-model="dueDate"
            type="date"
            class="beanies-input font-outfit cursor-pointer border-none bg-transparent py-3 text-xs font-semibold shadow-none focus:shadow-none focus:ring-0"
            :style="{
              color: dueDate || dateInputFocused ? 'var(--color-primary)' : 'transparent',
            }"
            @focus="dateInputFocused = true"
            @blur="dateInputFocused = false"
          />
          <span
            v-if="!dueDate && !dateInputFocused"
            class="font-outfit pointer-events-none absolute inset-0 flex items-center pl-2 text-sm font-semibold text-[var(--color-text)]"
          >
            {{ t('todo.selectDueDate') }}
          </span>
        </div>
      </div>

      <!-- Assignee (desktop) -->
      <div class="hidden sm:flex">
        <AssigneePickerButton v-model="assigneeIds" />
      </div>
    </div>

    <!-- Row 2: Date + Assignee on same line (mobile only) -->
    <div class="grid grid-cols-2 gap-2 sm:hidden">
      <div
        class="flex items-center gap-1.5 rounded-2xl px-3 transition-colors"
        :class="dueDate ? 'bg-[var(--tint-orange-8)]' : ''"
        :style="!dueDate ? 'background: var(--tint-slate-5)' : undefined"
      >
        <span class="text-sm">📅</span>
        <div class="relative min-w-0 flex-1">
          <input
            v-model="dueDate"
            type="date"
            class="beanies-input font-outfit w-full min-w-0 cursor-pointer border-none bg-transparent py-2 text-xs font-semibold shadow-none focus:shadow-none focus:ring-0"
            :style="{
              color: dueDate || dateInputFocused ? 'var(--color-primary)' : 'transparent',
            }"
            @focus="dateInputFocused = true"
            @blur="dateInputFocused = false"
          />
          <span
            v-if="!dueDate && !dateInputFocused"
            class="font-outfit pointer-events-none absolute inset-0 flex items-center pl-2 text-xs font-semibold text-[var(--color-text)]"
          >
            {{ t('todo.selectDueDate') }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="font-outfit text-xs font-semibold text-[var(--color-text)] opacity-35">
          {{ t('todo.who') }}
        </span>
        <AssigneePickerButton v-model="assigneeIds" size="sm" class="flex-1" />
      </div>
    </div>
  </div>
</template>
