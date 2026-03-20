<script setup lang="ts">
import { computed } from 'vue';
import type { VacationSegmentStatus } from '@/types/models';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

interface Props {
  icon: string;
  title: string;
  subtitle?: string;
  status: VacationSegmentStatus;
  keyValue?: string;
  collapsed: boolean;
  readOnly?: boolean;
  deletable?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:title': [value: string];
  'update:collapsed': [value: boolean];
  delete: [];
}>();

const statusConfig = computed(() => {
  const map: Record<VacationSegmentStatus, { bg: string; text: string; key: string }> = {
    booked: {
      bg: 'bg-[var(--tint-success-10)]',
      text: 'text-green-700 dark:text-green-400',
      key: 'vacation.status.booked',
    },
    pending: {
      bg: 'bg-[var(--vacation-gold-tint)]',
      text: 'text-[#B8860B]',
      key: 'vacation.status.pending',
    },
    not_booked: {
      bg: 'bg-[var(--tint-slate-5)]',
      text: 'text-gray-500 dark:text-gray-400',
      key: 'vacation.status.not_booked',
    },
    researching: {
      bg: 'bg-[var(--vacation-teal-tint)]',
      text: 'text-teal-700 dark:text-teal-400',
      key: 'vacation.status.researching',
    },
  };
  return map[props.status];
});

const isNotBooked = computed(() => props.status === 'not_booked');

function toggleCollapse() {
  emit('update:collapsed', !props.collapsed);
}
</script>

<template>
  <div
    class="rounded-2xl border bg-white transition-shadow hover:shadow-md dark:bg-slate-800"
    :class="
      isNotBooked
        ? 'border-dashed border-[var(--vacation-gold-tint)] bg-[var(--vacation-gold-tint)]'
        : 'border-[var(--tint-slate-10)] dark:border-slate-700'
    "
  >
    <!-- Header -->
    <div class="flex cursor-pointer items-center gap-2 px-4 py-3" @click="toggleCollapse">
      <span class="text-base">{{ icon }}</span>

      <input
        v-if="!readOnly"
        :value="title"
        class="font-outfit min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-slate-900 outline-none focus:border-b focus:border-dashed focus:border-slate-400 dark:text-gray-100"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        @click.stop
      />
      <span
        v-else
        class="font-outfit min-w-0 flex-1 text-sm font-semibold text-slate-900 dark:text-gray-100"
      >
        {{ title }}
      </span>

      <span v-if="subtitle" class="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">
        {{ subtitle }}
      </span>

      <span
        v-if="keyValue && collapsed"
        class="hidden text-xs text-gray-500 sm:inline dark:text-gray-400"
      >
        {{ keyValue }}
      </span>

      <span
        class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
        :class="[statusConfig.bg, statusConfig.text]"
      >
        {{ t(statusConfig.key as any) }}
      </span>

      <span class="text-xs text-gray-400 transition-transform" :class="{ 'rotate-90': !collapsed }">
        ▸
      </span>

      <button
        v-if="deletable && !readOnly"
        class="ml-1 text-sm opacity-50 transition-opacity hover:opacity-100"
        @click.stop="emit('delete')"
      >
        🗑️
      </button>
    </div>

    <!-- Collapsible body -->
    <div
      class="overflow-hidden transition-all duration-300"
      :class="collapsed ? 'max-h-0 opacity-0' : 'max-h-[600px] opacity-100'"
    >
      <div class="px-4 pb-4">
        <slot />
      </div>
    </div>
  </div>
</template>
