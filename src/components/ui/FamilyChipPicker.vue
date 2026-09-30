<script setup lang="ts">
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
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
  /**
   * Multi mode only: a trailing text button at the end of the chip row that picks every
   * chip ("Everyone") or, once they are all picked, unpicks them ("Clear"). "All" is
   * measured against THIS picker's own member list. Visual only: what an all-picked or
   * empty value MEANS is the caller's business. No `aria-pressed`: its label names the
   * action, like the checklist's tick-all toggle.
   */
  allToggle?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'single',
  compact: false,
  showShared: false,
  includePets: false,
  members: undefined,
  allToggle: false,
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

const showAllToggle = computed(
  () => props.allToggle && props.mode === 'multi' && members.value.length > 0
);
const allPicked = computed(() => members.value.every((m) => isSelected(m.id)));

/** Pick every chip, or unpick them all; ids outside this picker's list are kept. */
function toggleAll() {
  const current = Array.isArray(props.modelValue) ? props.modelValue : [];
  const ids = members.value.map((m) => m.id);
  emit(
    'update:modelValue',
    allPicked.value
      ? current.filter((id) => !ids.includes(id))
      : [...current, ...ids.filter((id) => !current.includes(id))]
  );
}

const avatarSize = computed(() => (props.compact ? 'h-6 w-6 text-xs' : 'h-7 w-7 text-xs'));

const { memberAvatarBindings } = useMemberAvatarBindings();
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
          : 'dark:bg-surface-overlay border-2 border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)]'
      "
      @click="toggle(SHARED_ID)"
    >
      <span
        class="from-primary-500 to-terracotta-400 flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white"
        :class="avatarSize"
      >
        {{ t('common.all').charAt(0) }}
      </span>
      <span class="font-outfit dark:text-ink text-xs font-semibold text-[var(--color-text)]">
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
          : 'dark:bg-surface-overlay border-2 border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)]'
      "
      @click="toggle(member.id)"
    >
      <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="xs" />
      <span class="font-outfit dark:text-ink text-xs font-semibold text-[var(--color-text)]">
        {{ member.name }}
      </span>
    </button>

    <button
      v-if="showAllToggle"
      type="button"
      class="font-outfit text-primary-600 dark:text-accent-lift self-center px-1 text-xs font-semibold underline underline-offset-2"
      data-testid="family-chip-all-toggle"
      @click="toggleAll"
    >
      {{ allPicked ? t('action.clear') : t('common.everyone') }}
    </button>
  </div>
</template>
