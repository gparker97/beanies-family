<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

const { t } = useTranslation();
const familyStore = useFamilyStore();

const emit = defineEmits<{
  add: [payload: { title: string; dueDate?: string; assigneeId?: string }];
}>();

const title = ref('');
const dueDate = ref('');
const assigneeId = ref('');
const showOptions = ref(false);

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
  showOptions.value = false;
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAdd();
  }
}
</script>

<template>
  <div
    class="rounded-2xl border border-[var(--color-border)] bg-white p-3 dark:bg-[var(--color-surface)]"
    style="box-shadow: var(--card-shadow)"
  >
    <div class="flex items-center gap-2">
      <input
        v-model="title"
        type="text"
        :placeholder="t('todo.quickAddPlaceholder')"
        class="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm transition-colors outline-none focus:border-purple-400 dark:text-white"
        @keydown="handleKeydown"
      />

      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-purple-8)]"
        :class="{ 'bg-[var(--tint-purple-8)] text-purple-500': showOptions }"
        @click="showOptions = !showOptions"
      >
        <BeanieIcon name="sliders" size="sm" />
      </button>

      <button
        type="button"
        class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
        style="background: linear-gradient(135deg, #9b59b6, #8e44ad)"
        :disabled="!title.trim()"
        @click="handleAdd"
      >
        <BeanieIcon name="plus" size="sm" />
        {{ t('action.add') }}
      </button>
    </div>

    <!-- Expandable options row -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="max-h-0 opacity-0"
      enter-to-class="max-h-24 opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="max-h-24 opacity-100"
      leave-to-class="max-h-0 opacity-0"
    >
      <div v-if="showOptions" class="mt-2 flex flex-wrap items-center gap-2 overflow-hidden pt-2">
        <div class="flex items-center gap-1.5">
          <BeanieIcon name="calendar" size="xs" class="text-[var(--color-text-muted)]" />
          <input
            v-model="dueDate"
            type="date"
            class="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs transition-colors outline-none focus:border-purple-400 dark:text-white"
          />
        </div>

        <div class="flex items-center gap-1.5">
          <BeanieIcon name="user" size="xs" class="text-[var(--color-text-muted)]" />
          <select
            v-model="assigneeId"
            class="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs transition-colors outline-none focus:border-purple-400 dark:text-white"
          >
            <option value="">{{ t('todo.unassigned') }}</option>
            <option v-for="member in familyStore.members" :key="member.id" :value="member.id">
              {{ member.name }}
            </option>
          </select>
        </div>
      </div>
    </Transition>
  </div>
</template>
