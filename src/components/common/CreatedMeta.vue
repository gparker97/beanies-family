<script setup lang="ts">
/**
 * Shared "created by + when" footer for view drawers (to-do, activity, …).
 *
 * A subtle, low-emphasis metadata line pinned to the bottom of a drawer:
 *   "Created by Greg · 21 Apr 2026 at 8:30am"
 *
 * It resolves the creator's name itself (via useMemberInfo) and formats the
 * timestamp via the shared `formatCreatedAt`, so every drawer that adopts it
 * reads identically — this is the standard convention for showing when an
 * item was created. Renders nothing if it has neither piece of data.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { formatCreatedAt } from '@/utils/date';

const props = defineProps<{
  createdAt?: string | null;
  createdBy?: string | null;
}>();

const { t } = useTranslation();
const { getMemberName } = useMemberInfo();

const creatorName = computed(() => (props.createdBy ? getMemberName(props.createdBy) : null));
const timestamp = computed(() => (props.createdAt ? formatCreatedAt(props.createdAt) : null));
</script>

<template>
  <div
    v-if="creatorName || timestamp"
    class="border-t border-gray-100 pt-2.5 dark:border-slate-700"
  >
    <p class="font-inter text-xs text-[var(--color-text-muted)]">
      <template v-if="creatorName">{{ t('common.createdBy') }} {{ creatorName }}</template>
      <span v-if="creatorName && timestamp" class="px-1 opacity-50" aria-hidden="true">·</span>
      <template v-if="timestamp">{{ timestamp }}</template>
    </p>
  </div>
</template>
