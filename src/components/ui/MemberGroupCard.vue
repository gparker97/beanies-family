<script setup lang="ts">
/**
 * One member's group card: face, name, a caption line, then whatever the caller groups
 * under that member (default slot). Markup and tokens are `DeckByBean`'s per-person card,
 * lifted unchanged, so every "things grouped by person" panel reads the same.
 *
 * With no `member` (a group of things nobody holds, "Unassigned"), it shows `name` without a
 * face, so that group still reads as one of the set.
 */
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import type { FamilyMember } from '@/types/models';

withDefaults(
  defineProps<{
    member?: FamilyMember | null;
    /** The heading when there is no member (or to override the member's name). */
    name?: string;
    /** The small line under the name (role, a count). Omitted when empty. */
    caption?: string;
  }>(),
  { member: null, name: '', caption: '' }
);

const { memberAvatarBindings } = useMemberAvatarBindings();
</script>

<template>
  <div
    class="dark:border-line dark:bg-surface-raised flex flex-col gap-2.5 rounded-2xl border border-[var(--color-border)] bg-white p-3.5 shadow-[var(--card-shadow)]"
    data-testid="member-group-card"
  >
    <div class="flex items-center gap-3">
      <BeanieAvatar
        v-if="member"
        v-bind="memberAvatarBindings(member)"
        fallback="initials"
        size="sm"
      />
      <div class="min-w-0 flex-1">
        <p
          class="font-outfit dark:text-ink truncate text-base font-semibold text-[var(--color-text)]"
        >
          {{ name || member?.name }}
        </p>
        <p v-if="caption" class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
          {{ caption }}
        </p>
      </div>
    </div>
    <slot />
  </div>
</template>
