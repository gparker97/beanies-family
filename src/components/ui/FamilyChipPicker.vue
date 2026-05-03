<script setup lang="ts">
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  modelValue: string | string[];
  mode?: 'single' | 'multi';
  compact?: boolean;
  showShared?: boolean;
  /**
   * Opt-in to include pets. Default false — most assignment contexts
   * (todos, financial owners, dropoff/pickup duties) are humans-only.
   * Activities can include pets as participants ("walk with Buddy"),
   * so the activity-assignee call sites pass `:include-pets="true"`.
   */
  includePets?: boolean;
  /**
   * Override the default member list. When provided, the picker renders
   * exactly these members in this order (no internal filtering, no pet
   * inclusion logic). Used by callers that need a custom slice — e.g.
   * "adults only, excluding the current owner" for ownership transfer.
   * `includePets` is ignored when this prop is set.
   */
  members?: import('@/types/models').FamilyMember[];
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'single',
  compact: false,
  showShared: false,
  includePets: false,
  members: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: string | string[]];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

// FamilyChipPicker is used for ASSIGNMENT contexts. Most assignment
// contexts are humans-only (todos, account/asset/goal owners, vacation
// travelers, activity dropoff/pickup duties), so the default excludes
// pets. Activity assignees opt in via `include-pets` because pets can
// be participants in family activities (e.g. "walk with Buddy").
const members = computed(() => {
  if (props.members) return props.members;
  return props.includePets ? familyStore.sortedMembers : familyStore.sortedHumans;
});

const SHARED_ID = '__shared__';

function isSelected(id: string): boolean {
  if (props.mode === 'multi') {
    return Array.isArray(props.modelValue) && props.modelValue.includes(id);
  }
  return props.modelValue === id;
}

function toggle(id: string) {
  if (props.mode === 'multi') {
    const current = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
    const idx = current.indexOf(id);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(id);
    }
    emit('update:modelValue', current);
  } else {
    emit('update:modelValue', id === props.modelValue ? '' : id);
  }
}

const avatarSize = computed(() => (props.compact ? 'h-6 w-6 text-xs' : 'h-7 w-7 text-xs'));
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <!-- Shared/Joint option -->
    <button
      v-if="showShared"
      type="button"
      class="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-150"
      :class="
        isSelected(SHARED_ID)
          ? 'border-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700'
      "
      @click="toggle(SHARED_ID)"
    >
      <span
        class="from-primary-500 to-terracotta-400 flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white"
        :class="avatarSize"
      >
        {{ t('common.all').charAt(0) }}
      </span>
      <span class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-200">
        {{ t('common.shared') }}
      </span>
    </button>

    <!-- Member chips -->
    <button
      v-for="member in members"
      :key="member.id"
      type="button"
      class="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-150"
      :class="
        isSelected(member.id)
          ? 'border-primary-500 dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'border-2 border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)] dark:bg-slate-700'
      "
      @click="toggle(member.id)"
    >
      <span
        class="flex items-center justify-center rounded-full font-semibold text-white"
        :class="avatarSize"
        :style="{ background: `linear-gradient(135deg, ${member.color}, ${member.color}dd)` }"
      >
        {{ member.name.charAt(0).toUpperCase() }}
      </span>
      <span class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-200">
        {{ member.name }}
      </span>
    </button>
  </div>
</template>
