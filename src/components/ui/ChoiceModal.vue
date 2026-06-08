<script setup lang="ts">
/**
 * Generic "pick one of these" modal — a small BaseModal with a vertical list of
 * icon-squircle choice buttons (label + optional description). Presentational
 * only: callers pass ALREADY-TRANSLATED strings and handle the chosen id. The
 * markup idiom mirrors RecurringEditScopeModal (a future candidate to migrate
 * onto this once it has a characterization test).
 */
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

export interface ChoiceOption {
  id: string;
  /** BeanieIcon name. */
  icon: string;
  label: string;
  description?: string;
}

defineProps<{
  open: boolean;
  title: string;
  options: ChoiceOption[];
}>();

const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'close'): void;
}>();
</script>

<template>
  <BaseModal :open="open" :title="title" size="sm" layer="overlay" @close="emit('close')">
    <div class="flex flex-col gap-2">
      <button
        v-for="opt in options"
        :key="opt.id"
        class="flex cursor-pointer items-center gap-3.5 rounded-2xl border border-[var(--tint-slate-5)] px-4 py-3.5 text-left transition-colors hover:border-[#F15D22]/30 hover:bg-[rgba(241,93,34,0.04)] dark:border-slate-600 dark:hover:border-orange-500/30 dark:hover:bg-orange-900/10"
        @click="emit('select', opt.id)"
      >
        <!-- Icon squircle -->
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-slate-5)] dark:bg-slate-700"
        >
          <BeanieIcon :name="opt.icon" size="md" class="text-[var(--color-text)] opacity-50" />
        </div>

        <!-- Label + optional description -->
        <div>
          <p class="font-outfit text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ opt.label }}
          </p>
          <p v-if="opt.description" class="text-xs text-[var(--color-text)] opacity-40">
            {{ opt.description }}
          </p>
        </div>
      </button>
    </div>
  </BaseModal>
</template>
