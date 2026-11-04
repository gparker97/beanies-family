<script setup lang="ts">
/**
 * Timed-activity content adapter for the month chip (#141). It says WHAT the chip
 * shows and nothing about how it draws: identity (whose hue, wash, dashed edge, faces,
 * celebration) from `useActivityIdentity.identityFor`, the title, the start time and a
 * spoken label, handed to `MonthChipFrame`, which owns every density's anatomy and
 * reads the month chip context. So no presentation prop exists here, and the reveal
 * hooks (`data-activity-id` / `data-occurrence-date`) are set once, by `MonthDayItem`.
 *
 * The colour rule is the planner-wide one in `useActivityIdentity`: family (no owner)
 * = Heritage Orange; solo = the member's hue; shared = the first owner's edge over a
 * blend of the first two hues, with a dashed edge and the face stack.
 */
import { computed } from 'vue';
import { useMemberInfo } from '@/composables/useMemberInfo';
import CelebrationConfetti from '@/components/ui/CelebrationConfetti.vue';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import { useActivityCategoryLabel } from '@/composables/useActivityCategoryLabel';
import { formatNameList, normalizeAssignees } from '@/utils/assignees';
import { formatTime12 } from '@/utils/date';
import { useClash } from '@/composables/useClash';
import ClashIndicator from '@/components/planner/ClashIndicator.vue';
import MonthChipFrame from '@/components/planner/MonthChipFrame.vue';
import type { ActivityOccurrence } from '@/utils/calendar/occurrence';

const props = defineProps<{
  occurrence: ActivityOccurrence;
}>();

const emit = defineEmits<{
  'view-activity': [activityId: string, date: string];
}>();

const { getMemberName } = useMemberInfo();
const { identityFor, displayTitle } = useActivityIdentity();
const { categoryLabel: resolveCategoryLabel } = useActivityCategoryLabel();

/** Whose, which faces, which glyph, celebration, wash — one call, one rule. */
const identity = computed(() => identityFor(props.occurrence.activity));

const time = computed(() => {
  const t = props.occurrence.activity.startTime;
  return t ? formatTime12(t) : '';
});

const title = computed(() => displayTitle(props.occurrence.activity, props.occurrence.date));

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

// The frame stops propagation itself, so a chip click never also opens the day.
function onClick() {
  emit('view-activity', props.occurrence.activity.id, props.occurrence.date);
}
</script>

<template>
  <MonthChipFrame
    :color="identity.style.borderLeftColor ?? identity.color"
    :wash="identity.style.background"
    :dashed="identity.dashed"
    :celebrating="identity.celebration.celebrating"
    :emoji="identity.emoji"
    :label="title"
    :time="time"
    :faces="identity.stackMembers"
    :solo="identity.kind === 'solo'"
    :spoken-label="ariaLabel"
    testid="month-chip"
    @click="onClick"
  >
    <template #decor>
      <CelebrationConfetti
        v-if="identity.celebration.celebrating"
        :activity-id="occurrence.activity.id"
        density="month"
      />
    </template>
    <ClashIndicator :clash="clash" class="flex-shrink-0" />
  </MonthChipFrame>
</template>
