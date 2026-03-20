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

      <div v-if="!readOnly" class="group/title relative min-w-0 flex-1" @click.stop>
        <input
          :value="title"
          class="font-outfit w-full border-0 border-b border-dashed border-transparent bg-transparent text-sm font-semibold text-slate-900 transition-colors outline-none hover:border-slate-300 focus:border-[var(--vacation-teal)] dark:text-gray-100 dark:hover:border-slate-500"
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        />
        <span
          class="pointer-events-none absolute top-1/2 right-0 -translate-y-1/2 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover/title:opacity-100 dark:text-slate-500"
        >
          ✏️
        </span>
      </div>
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
      :class="collapsed ? 'max-h-0 opacity-0' : 'max-h-[1200px] opacity-100'"
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
