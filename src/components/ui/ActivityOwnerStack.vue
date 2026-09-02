<script setup lang="ts">
/**
 * Whose event this is, as a row of overlapping faces.
 *
 * PURELY PRESENTATIONAL — it takes resolved members and imports no store. Not for
 * lint reasons (the wall's finance fence bans finance stores only, and `BeanieAvatar`
 * reads `photoStore` already) but for a correctness one: classification must happen
 * ONCE PER ACTIVITY, not once per face. A stack that classified internally would
 * re-derive the owner set on every render of every avatar, and could disagree with
 * the wash colour its own parent already computed from the same activity.
 *
 * It is also the ONE place the overflow cap lives. Before this there were eight
 * hand-rolled overlap stacks across the planner and the wall, and they disagreed:
 * two capped at three with no "+n", one showed a count, five were uncapped, and the
 * overlap itself ranged from -6px to -10px.
 *
 * The lane rule ("a solo card in a bean lane shows no face, because the lane header
 * already names them") is NOT decided here — it is a question about which members
 * belong in the set, so it lives in `useActivityIdentity` alongside the
 * classification. This component draws whatever set it is handed.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import type { FamilyMember } from '@/types/models';

const props = withDefaults(
  defineProps<{
    members: FamilyMember[];
    /**
     * Hard ceiling on faces drawn. Three plus a count keeps the reserved width
     * bounded, so a family of eight cannot push a card's title into a two-word
     * column — the whole reason the stack is right-anchored.
     */
    max?: number;
    /**
     * Space is at a premium — collapse to ONE face plus a count.
     *
     * On a month cell four pills can eat half the row, and the title is the only thing
     * a reader cannot recover by tapping the card: the faces are one tap away, the
     * truncated title is not. A single face plus `+3` still says "shared, tap to see
     * who", which is the job at this size.
     */
    dense?: boolean;
    size?: 'xs' | 'sm' | 'md';
  }>(),
  { max: 3, size: 'sm', dense: false }
);

const { memberAvatarBindings } = useMemberAvatarBindings();

const cap = computed(() => (props.dense ? 1 : props.max));
const shown = computed(() => props.members.slice(0, cap.value));
const overflow = computed(() => Math.max(0, props.members.length - cap.value));

/**
 * The stack is decorative for a screen reader — the card's own accessible name
 * already says whose it is — so the faces are hidden and this is the single label.
 * Reading eight names between the title and the time is worse than reading none.
 */
const label = computed(() => props.members.map((m) => m.name).join(', '));

/** The overflow pill must match the FACES, not a fixed 24px — `sm` renders 32px ones. */
const OVERFLOW_SIZE: Record<string, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
};
const overflowSize = computed(() => OVERFLOW_SIZE[props.size] ?? OVERFLOW_SIZE.xs);
</script>

<template>
  <span v-if="members.length" class="flex shrink-0 items-center" role="img" :aria-label="label">
    <BeanieAvatar
      v-for="person in shown"
      :key="person.id"
      v-bind="memberAvatarBindings(person)"
      fallback="initials"
      :size="size"
      aria-hidden="true"
      class="-ml-1.5 ring-2 ring-white first:ml-0 dark:ring-slate-800"
    />
    <span
      v-if="overflow"
      :class="overflowSize"
      class="font-outfit -ml-1.5 grid place-items-center rounded-full bg-[var(--tint-slate-10)] text-xs font-bold text-[var(--color-text-muted)] ring-2 ring-white dark:bg-slate-600 dark:text-gray-200 dark:ring-slate-800"
      aria-hidden="true"
      >+{{ overflow }}</span
    >
  </span>
</template>
