<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import MemberChip from '@/components/ui/MemberChip.vue';
import type { FamilyMember } from '@/types/models';

// Fully-controlled member view-filter for the To-Do page. Reads `modelValue`
// ('all' or a memberId) and emits on change — a lens over the list, NOT an
// assignment control (that's the QuickAddBar AssigneePickerButton). Rendered in
// the page toolbar beside Sort; the "Showing" label + the enclosing segmented
// track are what make it read as a switch rather than assignable member chips.
const props = defineProps<{
  modelValue: string;
  members: FamilyMember[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t } = useTranslation();

// Clicking the already-active member clears back to 'all' (same toggle
// behaviour as the previous pill row); Everyone always selects 'all'.
function select(value: string) {
  emit('update:modelValue', props.modelValue === value ? 'all' : value);
}
</script>

<template>
  <div class="flex items-center gap-2" role="group" :aria-label="t('todo.filterGroupLabel')">
    <span
      class="font-outfit text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)] uppercase opacity-45"
    >
      {{ t('todo.showingLabel') }}
    </span>
    <div
      class="flex max-w-full items-center gap-1 overflow-x-auto rounded-[14px] bg-[var(--tint-slate-5)] p-1 dark:bg-slate-700"
    >
      <!-- Everyone (default) -->
      <button
        type="button"
        class="font-outfit shrink-0 rounded-[11px] px-3 py-1.5 text-xs font-semibold transition-all duration-200"
        :class="
          modelValue === 'all'
            ? 'bg-white text-[var(--color-text)] shadow-sm dark:bg-slate-600 dark:text-white'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] dark:text-gray-400 dark:hover:text-gray-200'
        "
        :aria-pressed="modelValue === 'all' ? 'true' : 'false'"
        @click="emit('update:modelValue', 'all')"
      >
        {{ t('todo.filterEveryone') }}
      </button>

      <!-- One segment per member — avatar only (name via MemberChip title/aria) -->
      <button
        v-for="member in members"
        :key="member.id"
        type="button"
        class="flex shrink-0 items-center rounded-[11px] px-2.5 py-1.5 transition-all duration-200"
        :class="
          modelValue === member.id
            ? 'bg-white shadow-sm dark:bg-slate-600'
            : 'hover:bg-[var(--tint-slate-5)]'
        "
        :aria-pressed="modelValue === member.id ? 'true' : 'false'"
        @click="select(member.id)"
      >
        <span
          class="flex transition-all duration-200"
          :class="modelValue === member.id ? '' : 'opacity-45 grayscale'"
        >
          <MemberChip :member-id="member.id" size="dot" />
        </span>
      </button>
    </div>
  </div>
</template>
