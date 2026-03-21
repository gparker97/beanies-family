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
  /** Show the edit pencil button (for view/detail contexts, not inline editing wizards) */
  showEdit?: boolean;
  /** Helpful hint message (overlap warning) — shown when expanded */
  hint?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:title': [value: string];
  'update:collapsed': [value: boolean];
  edit: [];
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
  };
  return map[props.status] ?? map.pending;
});

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
    class="group/card rounded-2xl border transition-shadow hover:shadow-md"
    :class="
      hint || status === 'pending'
        ? 'border-amber-300/50 bg-amber-50/30 dark:border-amber-500/20 dark:bg-amber-900/5'
        : 'border-[var(--tint-slate-10)] bg-white dark:border-slate-700 dark:bg-slate-800'
    "
  >
    <!-- Header -->
    <div class="cursor-pointer px-4 py-3" @click="toggleCollapse">
      <div class="flex items-center gap-2">
        <span class="text-base">{{ icon }}</span>

        <span
          class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
          :class="[statusConfig.bg, statusConfig.text]"
        >
          {{ t(statusConfig.key as any) }}
        </span>

        <!-- Title (read-only display) -->
        <span
          class="font-outfit min-w-0 shrink truncate text-sm font-semibold text-slate-900 dark:text-gray-100"
        >
          {{ title }}
        </span>

        <span v-if="subtitle" class="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">
          {{ subtitle }}
        </span>

        <!-- Spacer to push actions to right -->
        <div class="flex-1" />

        <!-- Hint indicator — static icon signaling a hint exists -->
        <span
          v-if="hint || status === 'pending'"
          class="shrink-0 text-sm text-amber-400"
          title="Scheduling hint"
        >
          ⚠️
        </span>

        <!-- Chevron -->
        <button
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base text-gray-400 transition-colors hover:bg-slate-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
          @click.stop="toggleCollapse"
        >
          <span class="transition-transform" :class="{ 'rotate-90': !collapsed }">▸</span>
        </button>
      </div>

      <!-- Key info line — shown below title when collapsed -->
      <div
        v-if="keyValue && collapsed"
        class="mt-1 truncate pl-8 text-xs text-gray-400 dark:text-gray-500"
      >
        {{ keyValue }}
      </div>
    </div>

    <!-- Collapsible body -->
    <div
      class="overflow-hidden transition-all duration-300"
      :class="collapsed ? 'max-h-0 opacity-0' : 'max-h-[1200px] opacity-100'"
    >
      <div class="px-4 pb-2">
        <!-- Hint banner (shown when expanded, for hints or pending items) -->
        <div
          v-if="hint || status === 'pending'"
          class="mb-3 flex items-start gap-2 rounded-xl border border-amber-200/40 bg-amber-50/60 px-3 py-2 dark:border-amber-500/10 dark:bg-amber-900/10"
        >
          <span class="mt-0.5 text-sm">⚠️</span>
          <span class="text-xs text-amber-800 dark:text-amber-300">
            <template v-if="hint">{{ hint }}</template>
            <template v-else
              >{{ t('vacation.status.pending') }} — {{ t('travel.needsBooking') }}</template
            >
          </span>
        </div>

        <!-- Slot content -->
        <slot />
      </div>
    </div>

    <!-- Edit / Delete actions — outside overflow container to avoid click issues -->
    <div
      v-if="!collapsed && (showEdit || (deletable && !readOnly))"
      class="flex items-center gap-2 border-t border-gray-100 px-4 py-2 dark:border-slate-700/40"
    >
      <button
        v-if="showEdit"
        type="button"
        class="font-outfit inline-flex items-center gap-1 rounded-lg bg-[rgba(0,180,216,0.08)] px-3 py-1.5 text-xs font-semibold text-[#00B4D8] transition-colors hover:bg-[rgba(0,180,216,0.15)]"
        @click="$emit('edit')"
      >
        ✏️ {{ t('action.edit') }}
      </button>
      <button
        v-if="deletable && !readOnly"
        type="button"
        class="font-outfit inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
        @click="handleDelete"
      >
        🗑️ {{ t('common.delete') }}
      </button>
    </div>
  </div>
</template>
