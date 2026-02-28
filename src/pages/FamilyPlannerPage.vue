<script setup lang="ts">
import { ref, computed } from 'vue';
import ViewToggle from '@/components/planner/ViewToggle.vue';
import MemberFilter from '@/components/planner/MemberFilter.vue';
import CalendarGrid from '@/components/planner/CalendarGrid.vue';
import UpcomingActivities from '@/components/planner/UpcomingActivities.vue';
import TodoPreview from '@/components/planner/TodoPreview.vue';
import ActivityModal from '@/components/planner/ActivityModal.vue';
import DayAgendaSidebar from '@/components/planner/DayAgendaSidebar.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
  TodoItem,
} from '@/types/models';

const { t } = useTranslation();
const activityStore = useActivityStore();

const activeView = ref('month');
const showInactive = ref(false);
const showModal = ref(false);
const editingActivity = ref<FamilyActivity | null>(null);
const selectedDate = ref<string | undefined>(undefined);
const sidebarDate = ref<string | null>(null);
const defaultStartTime = ref<string | undefined>(undefined);

const calendarGridRef = ref<InstanceType<typeof CalendarGrid> | null>(null);

const headerSubtitle = computed(() => {
  const month = calendarGridRef.value?.monthLabel ?? '';
  const count = calendarGridRef.value?.activityCount ?? 0;
  return t('planner.subtitle').replace('{month}', month).replace('{count}', String(count));
});

function openAddModal(date?: string) {
  editingActivity.value = null;
  selectedDate.value = date;
  showModal.value = true;
}

function openEditModal(id: string) {
  const activity = activityStore.activities.find((a) => a.id === id);
  if (activity) {
    editingActivity.value = activity;
    showModal.value = true;
  }
}

function handleCalendarDateClick(date: string) {
  sidebarDate.value = date;
}

function handleSidebarAdd() {
  const date = sidebarDate.value ?? undefined;
  sidebarDate.value = null;
  defaultStartTime.value = '09:00';
  openAddModal(date);
}

function handleSidebarEdit(id: string) {
  sidebarDate.value = null;
  openEditModal(id);
}

async function handleSave(
  data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }
) {
  if ('id' in data && 'data' in data) {
    await activityStore.updateActivity(data.id, data.data);
  } else {
    await activityStore.createActivity(data as CreateFamilyActivityInput);
  }
  showModal.value = false;
  editingActivity.value = null;
}

async function handleDelete() {
  if (!editingActivity.value) return;
  const activityToDelete = editingActivity.value;
  showModal.value = false;
  const confirmed = await confirm({
    title: 'planner.deleteActivity',
    message: 'planner.deleteConfirm',
    variant: 'danger',
  });
  if (confirmed) {
    await activityStore.deleteActivity(activityToDelete.id);
  }
  editingActivity.value = null;
}

// --- Todo view/edit modal ---
const selectedTodo = ref<TodoItem | null>(null);

function openTodoViewModal(todo: TodoItem) {
  selectedTodo.value = todo;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="font-outfit text-2xl font-bold text-[#2C3E50] dark:text-gray-100">
          &#x1F4C5; {{ t('planner.title') }}
        </h1>
        <p class="mt-0.5 text-sm text-[#2C3E50]/40 dark:text-gray-500">
          {{ headerSubtitle }}
        </p>
      </div>
      <button
        type="button"
        class="font-outfit inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#F15D22] to-[#E67E22] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
        @click="openAddModal()"
      >
        {{ t('planner.addActivity') }}
      </button>
    </div>

    <!-- View toggle + Member filter -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <ViewToggle :active-view="activeView" @update:active-view="activeView = $event" />
      <MemberFilter />
    </div>

    <!-- Calendar grid -->
    <CalendarGrid
      ref="calendarGridRef"
      :selected-date="sidebarDate ?? undefined"
      @select-date="handleCalendarDateClick"
    />

    <!-- Two-column layout: Upcoming + Todo preview -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <UpcomingActivities @edit="openEditModal" />
      <TodoPreview @view="openTodoViewModal" />
    </div>

    <!-- Inactive activities toggle -->
    <div v-if="activityStore.inactiveActivities.length > 0">
      <button
        type="button"
        class="flex items-center gap-2 text-sm text-[#2C3E50]/50 transition-colors hover:text-[#2C3E50] dark:text-gray-500 dark:hover:text-gray-300"
        @click="showInactive = !showInactive"
      >
        <span class="text-xs opacity-50">{{ showInactive ? '&#x25B2;' : '&#x25BC;' }}</span>
        <span class="font-semibold">
          {{ t('planner.inactiveActivities') }}
          ({{ activityStore.inactiveActivities.length }})
        </span>
      </button>

      <div v-if="showInactive" class="mt-3 space-y-1.5">
        <button
          v-for="activity in activityStore.inactiveActivities"
          :key="activity.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border-l-4 bg-white/60 px-3 py-2.5 text-left opacity-60 shadow-[0_2px_10px_rgba(44,62,80,0.03)] transition-all hover:opacity-100 hover:shadow-[0_4px_16px_rgba(44,62,80,0.06)] dark:bg-slate-800/60"
          style="border-left-color: #95a5a6"
          @click="openEditModal(activity.id)"
        >
          <span class="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gray-400" />
          <span
            class="font-outfit min-w-0 flex-1 truncate text-sm font-semibold text-[#2C3E50]/60 dark:text-gray-400"
          >
            {{ activity.title }}
          </span>
          <span class="flex-shrink-0 text-xs text-[#2C3E50]/30 dark:text-gray-500">
            {{ t('planner.showInactive') }}
          </span>
        </button>
      </div>
    </div>

    <!-- Day agenda sidebar -->
    <DayAgendaSidebar
      :date="sidebarDate ?? ''"
      :open="sidebarDate !== null"
      @close="sidebarDate = null"
      @add-activity="handleSidebarAdd"
      @edit-activity="handleSidebarEdit"
    />

    <!-- Activity modal -->
    <ActivityModal
      :open="showModal"
      :activity="editingActivity"
      :default-date="selectedDate"
      :default-start-time="defaultStartTime"
      @close="
        showModal = false;
        defaultStartTime = undefined;
      "
      @save="handleSave"
      @delete="handleDelete"
    />

    <TodoViewEditModal :todo="selectedTodo" @close="selectedTodo = null" />
  </div>
</template>
