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
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import { useActivityCategoryLabel } from '@/composables/useActivityCategoryLabel';
import { formatNameList, normalizeAssignees } from '@/utils/assignees';
import { formatTime12 } from '@/utils/date';
import { useClash } from '@/composables/useClash';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import ClashIndicator from '@/components/planner/ClashIndicator.vue';
import type { FamilyActivity } from '@/types/models';

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

const { getMemberName } = useMemberInfo();
const { identityFor } = useActivityIdentity();
const { categoryLabel: resolveCategoryLabel } = useActivityCategoryLabel();

/** Whose, which faces, which glyph, celebration, wash — one call, one rule. */
const identity = computed(() => identityFor(props.occurrence.activity));
const emoji = computed(() => identity.value.emoji);

const time = computed(() => {
  const t = props.occurrence.activity.startTime;
  return t ? formatTime12(t) : '';
});

const title = computed(() => props.occurrence.activity.title);

// External-calendar clash (#34) — resolved through the single `useClash` seam.
// The clash is signalled solely by the OverlapMark glyph (see ClashIndicator in
// the template), matching every other surface (drawer / week / day / agenda / list).
// The chip deliberately wears NO orange ring: orange outlines are reserved for
// date-state (today / selected day), and a ring here read as "today" at grid scale.
const clash = useClash(
  () => props.occurrence.activity.id,
  () => props.occurrence.date
);

// Localized + beanie-aware (zh / beanie mode) — matches every other surface; the
// raw constant name would announce English to screen-reader users in other locales.
const categoryLabel = computed(() => resolveCategoryLabel(props.occurrence.activity.category));

/**
 * Screen-reader announcement combining member name(s), category, time
 * and title — so a blind user gets the same context the sighted user
 * gets from the color bar + emoji + chip text.
 */
const ariaLabel = computed(() => {
  const ids = normalizeAssignees(props.occurrence.activity);
  const names =
    identity.value.kind === 'solo'
      ? ids.map((id) => getMemberName(id))
      : identity.value.stackMembers.map((m) => m.name);
  return [formatNameList(names), categoryLabel.value, time.value, title.value]
    .filter(Boolean)
    .join(' · ');
});

function onClick(event: MouseEvent) {
  event.stopPropagation();
  emit('view-activity', props.occurrence.activity.id, props.occurrence.date);
}
</script>

<template>
  <button
    type="button"
    class="font-inter text-secondary-500 flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md border-l-[3px] py-0.5 pr-1.5 pl-1 text-left text-xs leading-tight transition-opacity hover:opacity-80 dark:text-gray-200"
    :class="identity.dashed ? 'border-dashed' : ''"
    :style="identity.style"
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

    <ClashIndicator :clash="clash" class="flex-shrink-0" />

    <!--
      Right-anchored owner faces. No longer `md:hidden`: the month grid on desktop
      showed no faces at all, so hue was the sole identity signal on the very surface
      where the most events are visible at once. And no longer skipped for solo — the
      month grid is not a bean lane, so nothing else here names the owner.
    -->
    <ActivityOwnerStack :members="identity.stackMembers" size="xs" class="ml-0.5" />
  </button>
</template>
