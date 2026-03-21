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
  /** Helpful hint message (overlap warning) — shown on click of indicator */
  hint?: string;
  /** Whether the hint tooltip is currently visible */
  hintExpanded?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:title': [value: string];
  'update:collapsed': [value: boolean];
  'toggle-hint': [];
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
      hint
        ? 'border-amber-300/50 bg-amber-50/30 dark:border-amber-500/20 dark:bg-amber-900/5'
        : status === 'pending'
          ? 'border-dashed border-[rgba(184,134,11,0.18)] bg-[rgba(255,217,61,0.06)] dark:border-[rgba(184,134,11,0.25)] dark:bg-[rgba(255,217,61,0.03)]'
          : 'border-[var(--tint-slate-10)] bg-white dark:border-slate-700 dark:bg-slate-800'
    "
  >
    <!-- Hint tooltip (expanded) -->
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition-all duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="hint && hintExpanded"
        class="flex items-start gap-2 border-b border-amber-200/40 bg-amber-50/60 px-4 py-2.5 dark:border-amber-500/10 dark:bg-amber-900/10"
      >
        <span class="mt-0.5 text-xs">⚠️</span>
        <span class="text-[11px] text-amber-800 dark:text-amber-300">{{ hint }}</span>
      </div>
    </Transition>

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

        <!-- Editable title — auto-width, not full row -->
        <div v-if="!readOnly" class="group/title relative min-w-0 shrink" @click.stop>
          <input
            :value="title"
            class="font-outfit w-auto max-w-[180px] min-w-[60px] border-0 border-b border-dashed border-transparent bg-transparent text-sm font-semibold text-slate-900 transition-colors outline-none hover:border-slate-300 focus:border-[var(--vacation-teal)] dark:text-gray-100 dark:hover:border-slate-500"
            :size="Math.max(title.length, 6)"
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
          class="font-outfit min-w-0 shrink text-sm font-semibold text-slate-900 dark:text-gray-100"
        >
          {{ title }}
        </span>

        <span v-if="subtitle" class="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">
          {{ subtitle }}
        </span>

        <!-- Spacer to push actions to right -->
        <div class="flex-1" />

        <!-- Hint indicator — always visible when hint exists -->
        <button
          v-if="hint"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm transition-all"
          :class="
            hintExpanded
              ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
              : 'text-amber-400 hover:bg-amber-50 hover:text-amber-500 dark:text-amber-500 dark:hover:bg-amber-900/20'
          "
          title="Scheduling hint"
          @click.stop="$emit('toggle-hint')"
        >
          ⚠️
        </button>

        <!-- Edit button — always visible on mobile, hover-reveal on desktop -->
        <button
          v-if="showEdit"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs text-gray-300 transition-all hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] lg:opacity-0 lg:group-hover/card:opacity-100"
          title="Edit"
          @click.stop="$emit('edit')"
        >
          ✏️
        </button>

        <!-- Delete button — always visible on mobile, hover-reveal on desktop -->
        <button
          v-if="deletable && !readOnly"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs text-gray-300 transition-all hover:bg-red-50 hover:text-red-500 lg:opacity-0 lg:group-hover/card:opacity-100 dark:hover:bg-red-900/20"
          title="Delete"
          @click.stop="handleDelete"
        >
          🗑️
        </button>

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

    <!-- Collapsible body — clicking whitespace opens edit modal -->
    <div
      class="overflow-hidden transition-all duration-300"
      :class="collapsed ? 'max-h-0 opacity-0' : 'max-h-[1200px] opacity-100'"
    >
      <div class="px-4 pb-4" @click="$emit('edit')">
        <!-- Slot content: click.stop on interactive elements prevents edit -->
        <slot />
      </div>
    </div>
  </div>
</template>
