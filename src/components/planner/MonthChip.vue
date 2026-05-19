<script setup lang="ts">
/**
 * Timed-activity chip for the month calendar. Replaces the previous
 * colored-dot row with a readable [left member-color bar][emoji][time][title]
 * lineup. On mobile (where the 7-column grid collapses to a vertical
 * day-stack via the parent) multi-person events also surface a right-edge
 * avatar stack so users can tell "everyone vs just the parents" at a glance.
 *
 * The color resolution rule (confirmed during planning):
 *  - 0 assignees  → "family" — Heritage Orange bar, stack = all human members
 *  - 1 assignee   → "solo"   — member's own color, no right-edge stack
 *  - 2+ assignees → "shared" — Heritage Orange bar, stack = selected members
 *
 * The avatar stack renders only when `kind !== 'solo'` AND we're below the
 * `md` breakpoint — the left bar already conveys "whose" for solo events,
 * and the desktop grid is too tight to fit avatars without crowding titles.
 *
 * Phase B will promote `classify()` to a shared composable so weekly event
 * blocks consume the same rule.
 */
import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { getActivityCategoryById, getActivityFallbackEmoji } from '@/constants/activityCategories';
import { formatNameList, normalizeAssignees } from '@/utils/assignees';
import { formatTime12 } from '@/utils/date';
import MemberChip from '@/components/ui/MemberChip.vue';
import type { FamilyActivity, FamilyMember } from '@/types/models';

interface ActivityOccurrence {
  activity: FamilyActivity;
  date: string;
}

const props = defineProps<{
  occurrence: ActivityOccurrence;
}>();

const emit = defineEmits<{
  'view-activity': [activityId: string, date: string];
}>();

const familyStore = useFamilyStore();
const { getMemberById, getMemberName, getMemberColor } = useMemberInfo();

// Heritage Orange — used for "family" (no assignees) and "shared" (2+) chips.
// Hex constant (not CSS var) because we tint the background with `${hex}1f`
// to match the existing AllDayActivityChip pattern, which only works on hex.
const HERITAGE_ORANGE = '#F15D22';

type Classification =
  | { kind: 'solo'; color: string; members: FamilyMember[] }
  | { kind: 'family'; color: string; members: FamilyMember[] }
  | { kind: 'shared'; color: string; members: FamilyMember[] };

const classification = computed<Classification>(() => {
  const ids = normalizeAssignees(props.occurrence.activity);

  // 0 assignees = whole-family event. Stack = all humans (pets excluded
  // via familyStore.humans).
  if (ids.length === 0) {
    return { kind: 'family', color: HERITAGE_ORANGE, members: familyStore.humans };
  }

  // 1 assignee = solo. Left bar carries the member's color; no stack.
  if (ids.length === 1) {
    return {
      kind: 'solo',
      color: getMemberColor(ids[0]),
      members: [],
    };
  }

  // 2+ assignees = shared. Resolve to real members, drop deleted-ID
  // references. If every assignee turns out to be unknown (rare data-
  // corruption case), fall back to solo semantics with the default color
  // rather than misrepresent as a multi-person event.
  const members = ids.map((id) => getMemberById(id)).filter((m): m is FamilyMember => Boolean(m));

  if (members.length === 0) {
    return { kind: 'solo', color: getMemberColor(null), members: [] };
  }

  return { kind: 'shared', color: HERITAGE_ORANGE, members };
});

const emoji = computed(() => {
  const a = props.occurrence.activity;
  return a.icon ?? getActivityFallbackEmoji(a.category);
});

const time = computed(() => {
  const t = props.occurrence.activity.startTime;
  return t ? formatTime12(t) : '';
});

const title = computed(() => props.occurrence.activity.title);

const categoryLabel = computed(
  () => getActivityCategoryById(props.occurrence.activity.category)?.name ?? ''
);

/**
 * Screen-reader announcement combining member name(s), category, time
 * and title — so a blind user gets the same context the sighted user
 * gets from the color bar + emoji + chip text.
 */
const ariaLabel = computed(() => {
  const ids = normalizeAssignees(props.occurrence.activity);
  const names =
    classification.value.kind === 'solo'
      ? ids.map((id) => getMemberName(id))
      : classification.value.members.map((m) => m.name);
  return [formatNameList(names), categoryLabel.value, time.value, title.value]
    .filter(Boolean)
    .join(' · ');
});

/**
 * 12% alpha tint of the resolved color for the chip's fill. Matches the
 * pattern in `AllDayActivityChip.vue` — `${color}1f` works for any 6-char
 * hex string, which both member.color and HERITAGE_ORANGE always are.
 */
const bgColor = computed(() => `${classification.value.color}1f`);

function onClick(event: MouseEvent) {
  event.stopPropagation();
  emit('view-activity', props.occurrence.activity.id, props.occurrence.date);
}
</script>

<template>
  <button
    type="button"
    class="font-inter text-secondary-500 flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md border-l-[3px] py-0.5 pr-1.5 pl-1 text-left text-xs leading-tight transition-opacity hover:opacity-80 dark:text-gray-200"
    :style="{ borderLeftColor: classification.color, backgroundColor: bgColor }"
    :aria-label="ariaLabel"
    data-testid="month-chip"
    @click="onClick"
  >
    <span aria-hidden="true" class="flex-shrink-0 text-[0.6875rem] leading-none">{{ emoji }}</span>

    <!-- Time — hidden on the cramped 7-column desktop grid, shown on the
         mobile day-stack rows (where the parent flips to `compactable`
         layout and the chip has room). Tablet (md → lg) keeps the title-
         only treatment so titles aren't crowded. -->
    <span
      v-if="time"
      class="text-secondary-500/60 hidden flex-shrink-0 font-medium tabular-nums dark:text-gray-400"
      aria-hidden="true"
    >
      {{ time }}
    </span>

    <span class="min-w-0 flex-1 truncate font-medium">{{ title }}</span>

    <!-- Right-edge avatar stack — mobile-only (`md:hidden`) and only for
         multi-person events (the left bar already says whose for solo). -->
    <span
      v-if="classification.kind !== 'solo' && classification.members.length > 0"
      class="ml-0.5 flex flex-shrink-0 items-center -space-x-1.5 md:hidden"
      aria-hidden="true"
    >
      <MemberChip v-for="m in classification.members" :key="m.id" :member-id="m.id" size="dot" />
    </span>
  </button>
</template>
