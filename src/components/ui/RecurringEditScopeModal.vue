<script setup lang="ts">
import BaseModal from '@/components/ui/BaseModal.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import {
  useRecurringEditScope,
  type RecurringEditScope,
} from '@/composables/useRecurringEditScope';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const { state, select, cancel } = useRecurringEditScope();

const options: { scope: RecurringEditScope; icon: string; labelKey: string; descKey: string }[] = [
  {
    scope: 'this-only',
    icon: 'edit',
    labelKey: 'recurring.scopeThisOnly',
    descKey: 'recurring.scopeThisOnlyDesc',
  },
  {
    scope: 'all',
    icon: 'repeat',
    labelKey: 'recurring.scopeAll',
    descKey: 'recurring.scopeAllDesc',
  },
  {
    scope: 'this-and-future',
    icon: 'chevron-right',
    labelKey: 'recurring.scopeThisAndFuture',
    descKey: 'recurring.scopeThisAndFutureDesc',
  },
];
</script>

<template>
  <BaseModal
    :open="state.open"
    :title="t('recurring.editScopeTitle')"
    size="sm"
    layer="overlay"
    @close="cancel"
  >
    <div class="flex flex-col gap-2">
      <button
        v-for="opt in options"
        :key="opt.scope"
        class="flex cursor-pointer items-center gap-3.5 rounded-2xl border border-[var(--tint-slate-5)] px-4 py-3.5 text-left transition-colors hover:border-[#F15D22]/30 hover:bg-[rgba(241,93,34,0.04)] dark:border-slate-600 dark:hover:border-orange-500/30 dark:hover:bg-orange-900/10"
        @click="select(opt.scope)"
      >
        <!-- Icon squircle -->
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-slate-5)] dark:bg-slate-700"
        >
          <BeanieIcon :name="opt.icon" size="md" class="text-[var(--color-text)] opacity-50" />
        </div>

        <!-- Label + description -->
        <div>
          <p class="font-outfit text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ t(opt.labelKey as any) }}
          </p>
          <p class="text-xs text-[var(--color-text)] opacity-40">
            {{ t(opt.descKey as any) }}
          </p>
        </div>
      </button>
    </div>
  </BaseModal>
</template>
