<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTodoStore } from '@/stores/todoStore';
import { useAuthStore } from '@/stores/authStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import type { TodoItem } from '@/types/models';

const router = useRouter();
const todoStore = useTodoStore();
const authStore = useAuthStore();
const { getMemberName, getMemberColor } = useMemberInfo();
const { t } = useTranslation();

const emit = defineEmits<{ view: [todo: TodoItem] }>();

const currentMemberId = computed(() => authStore.currentUser?.memberId ?? '');

const PAGE_SIZE = 6;
const visibleCount = ref(PAGE_SIZE);

const previewTodos = computed(() => todoStore.filteredOpenTodos.slice(0, visibleCount.value));
const hasMore = computed(() => todoStore.filteredOpenTodos.length > visibleCount.value);

function showMore() {
  visibleCount.value += PAGE_SIZE;
}

async function handleToggle(e: Event, id: string) {
  e.stopPropagation();
  await todoStore.toggleComplete(id, currentMemberId.value);
}

function goToTodos() {
  router.push('/todo');
}
</script>

<template>
  <div
    class="rounded-3xl border-l-4 bg-gradient-to-r from-white to-[#9B59B6]/[0.03] p-5 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:from-slate-800 dark:to-[#9B59B6]/[0.06]"
    style="border-left-color: #9b59b6"
  >
    <div class="mb-3 flex items-center justify-between">
      <h3 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
        &#x2705; {{ t('planner.todoPreview') }}
      </h3>
      <button
        type="button"
        class="cursor-pointer text-sm font-semibold text-[#9B59B6] transition-colors hover:text-[#8E44AD]"
        @click="goToTodos"
      >
        {{ t('planner.viewAllTodos') }}
      </button>
    </div>

    <div v-if="previewTodos.length === 0" class="py-2 text-center">
      <p class="text-secondary-500/40 text-sm dark:text-gray-500">{{ t('todo.noTodos') }}</p>
    </div>

    <div v-else class="space-y-1.5">
      <button
        v-for="todo in previewTodos"
        :key="todo.id"
        type="button"
        class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[#9B59B6]/[0.04] dark:hover:bg-[#9B59B6]/[0.08]"
        @click="emit('view', todo)"
      >
        <!-- Toggle circle -->
        <span
          role="button"
          tabindex="0"
          class="flex h-[18px] w-[18px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-colors hover:bg-[#9B59B6]/20"
          :style="{ borderColor: '#9B59B6' }"
          @click="handleToggle($event, todo.id)"
          @keydown.enter.prevent="handleToggle($event, todo.id)"
        />

        <!-- Title -->
        <span class="text-secondary-500 min-w-0 flex-1 truncate text-sm dark:text-gray-200">
          {{ todo.title }}
        </span>

        <!-- Assignee chip -->
        <span
          v-if="todo.assigneeId"
          class="flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
          :style="{ backgroundColor: getMemberColor(todo.assigneeId) }"
        >
          {{ getMemberName(todo.assigneeId) }}
        </span>

        <!-- Due date badge -->
        <span
          v-if="todo.dueDate"
          class="flex-shrink-0 rounded-full bg-[#9B59B6]/10 px-2 py-0.5 text-xs font-medium text-[#9B59B6]"
        >
          {{ t('planner.onCalendar') }}
        </span>
      </button>

      <!-- View more -->
      <button
        v-if="hasMore"
        type="button"
        class="mt-2 w-full cursor-pointer rounded-2xl py-2 text-center text-sm font-semibold text-[#9B59B6] transition-colors hover:bg-[#9B59B6]/5"
        @click="showMore"
      >
        {{ t('planner.viewMore') }}
      </button>
    </div>
  </div>
</template>
