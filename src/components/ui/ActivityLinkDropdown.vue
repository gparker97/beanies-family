<script setup lang="ts">
import { ref, computed } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  modelValue?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string | undefined];
}>();

const { t } = useTranslation();
const activityStore = useActivityStore();
const familyStore = useFamilyStore();

const isOpen = ref(false);

const activities = computed(() => activityStore.activeActivities);

const selectedActivity = computed(() => {
  if (!props.modelValue) return null;
  return activities.value.find((a) => a.id === props.modelValue) ?? null;
});

function getMemberName(memberId?: string): string {
  if (!memberId) return '';
  const member = familyStore.members.find((m) => m.id === memberId);
  return member?.name ?? '';
}

function select(id: string | undefined) {
  emit('update:modelValue', id);
  isOpen.value = false;
}

function toggle() {
  isOpen.value = !isOpen.value;
}

function handleBlur() {
  // Delay to allow click on option
  setTimeout(() => {
    isOpen.value = false;
  }, 150);
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="font-outfit flex w-full items-center gap-2 rounded-[14px] border-2 bg-[var(--tint-slate-5)] px-4 py-2.5 text-left text-[0.8rem] transition-all duration-150 dark:bg-slate-700"
      :class="
        isOpen
          ? 'border-primary-500 shadow-[0_0_0_3px_rgba(241,93,34,0.1)]'
          : 'border-transparent hover:bg-[var(--tint-slate-10)]'
      "
      @click="toggle"
      @blur="handleBlur"
    >
      <template v-if="selectedActivity">
        <span class="text-base">{{ selectedActivity.icon || '📋' }}</span>
        <span class="flex-1 truncate text-[var(--color-text)] dark:text-gray-200">
          {{ selectedActivity.title }}
        </span>
      </template>
      <template v-else>
        <span class="text-base">📋</span>
        <span class="flex-1 text-[var(--color-text-muted)]">{{ t('modal.selectActivity') }}</span>
      </template>
      <svg
        class="h-4 w-4 flex-shrink-0 text-[var(--color-text-muted)] transition-transform"
        :class="isOpen ? 'rotate-180' : ''"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 -translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="isOpen"
        class="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[14px] bg-white py-1 shadow-lg dark:bg-slate-800"
      >
        <!-- None option -->
        <button
          type="button"
          class="font-outfit flex w-full items-center gap-2 px-4 py-2 text-[0.75rem] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-5)] dark:hover:bg-slate-700"
          @mousedown.prevent="select(undefined)"
        >
          {{ t('common.none') }}
        </button>
        <!-- Activity options -->
        <button
          v-for="activity in activities"
          :key="activity.id"
          type="button"
          class="font-outfit flex w-full items-center gap-2 px-4 py-2 text-[0.75rem] hover:bg-[var(--tint-slate-5)] dark:hover:bg-slate-700"
          @mousedown.prevent="select(activity.id)"
        >
          <span class="text-sm">{{ activity.icon || '📋' }}</span>
          <span class="flex-1 truncate text-[var(--color-text)] dark:text-gray-200">{{
            activity.title
          }}</span>
          <span v-if="activity.assigneeId" class="text-[0.6rem] text-[var(--color-text-muted)]">
            {{ getMemberName(activity.assigneeId) }}
          </span>
        </button>
        <div
          v-if="activities.length === 0"
          class="font-outfit px-4 py-2 text-[0.7rem] text-[var(--color-text-muted)]"
        >
          {{ t('modal.noMoreActivities') }}
        </div>
      </div>
    </Transition>
  </div>
</template>
