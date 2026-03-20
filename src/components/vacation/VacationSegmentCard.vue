<script setup lang="ts">
import { computed } from 'vue';
import type { VacationSegmentStatus } from '@/types/models';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';

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

async function handleDelete() {
  const ok = await confirm({
    title: 'vacation.deleteSegmentTitle',
    message: 'vacation.deleteSegmentMessage',
    variant: 'danger',
  });
  if (ok) emit('delete');
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

      <span
        class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
        :class="[statusConfig.bg, statusConfig.text]"
      >
        {{ t(statusConfig.key as any) }}
      </span>

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

      <button
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base text-gray-400 transition-colors hover:bg-slate-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
        @click.stop="toggleCollapse"
      >
        <span class="transition-transform" :class="{ 'rotate-90': !collapsed }">▸</span>
      </button>
    </div>

    <!-- Collapsible body -->
    <div
      class="overflow-hidden transition-all duration-300"
      :class="collapsed ? 'max-h-0 opacity-0' : 'max-h-[600px] opacity-100'"
    >
      <div class="px-4 pb-4">
        <slot />

        <!-- Delete button at the bottom of the expanded body -->
        <button
          v-if="deletable && !readOnly"
          class="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
          @click.stop="handleDelete"
        >
          🗑️ {{ t('vacation.deleteSegmentTitle' as any) }}
        </button>
      </div>
    </div>
  </div>
</template>
