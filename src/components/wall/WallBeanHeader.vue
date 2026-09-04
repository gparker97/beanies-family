<script setup lang="ts">
/**
 * A bean's name plate — avatar, name, and one line of context.
 *
 * Extracted so the lanes view and `WallBeanColumn` share it rather than the
 * lanes view growing a `headerOnly` flag on the column. `WallBeanColumn`'s own
 * docblock explains why that component is slot-driven and not mode-flagged: a
 * `mode` prop grows a branch for every future difference. On the time grid the
 * lanes need the plate WITHOUT the card shell — the shell is now one continuous
 * plot surface — so the plate is the thing to share, not the card.
 */
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import type { FamilyMember } from '@/types/models';

defineProps<{
  member: FamilyMember;
  subtitle: string;
  /**
   * The jobs board gives a bean the whole column and can afford the big avatar.
   * A lane header sits above a grid that wants every pixel of height.
   */
  compact?: boolean;
  /** Lay out side by side rather than stacked — the lane header's shape. */
  inline?: boolean;
}>();

const { memberAvatarBindings } = useMemberAvatarBindings();
</script>

<template>
  <span
    class="flex w-full min-w-0 overflow-hidden"
    :class="inline ? 'items-center justify-center gap-2' : 'flex-col items-center text-center'"
    :style="inline ? undefined : { gap: compact ? '0.25rem' : '0.5rem' }"
  >
    <BeanieAvatar
      v-bind="memberAvatarBindings(member)"
      fallback="initials"
      :size="compact ? 'lg' : '2xl'"
    />
    <!--
      `w-full` in the stacked case is what gives `truncate` something to truncate
      AGAINST: in a centred flex column the text span sizes to its content, so it
      overflowed the column and was clipped mid-word by the parent instead of
      ellipsing ("3 today · 2 tomorro").
    -->
    <span class="min-w-0" :class="inline ? 'text-left' : 'w-full'">
      <span
        class="font-outfit text-secondary-500 wall-bean-name dark:text-ink block truncate font-bold"
      >
        {{ member.name }}
      </span>
      <span class="font-inter wall-bean-count block truncate text-[var(--muted-text,#4d5d6c)]">
        {{ subtitle }}
      </span>
    </span>
  </span>
</template>
