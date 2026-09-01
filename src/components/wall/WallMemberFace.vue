<script setup lang="ts">
/**
 * Who this belongs to, readable from across the room.
 *
 * A photo when there is one; otherwise the person's INITIAL on their own
 * colour — not the beanie variant. The beanie is chosen from age group and
 * species, so a family with two adults or three children gets three identical
 * faces, and the one job this element has on a shared board is telling them
 * apart. An initial plus the member colour does that at two metres.
 *
 * Wall-only on purpose: elsewhere in the app the beanie is a deliberate piece
 * of brand character, and those surfaces show one member at a time or name
 * them in text alongside.
 */
import { computed } from 'vue';
import { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberInfo';
import type { FamilyMember } from '@/types/models';

const props = withDefaults(defineProps<{ member: FamilyMember; size?: 'sm' | 'md' | 'lg' }>(), {
  size: 'md',
});

const SIZES = {
  sm: 'h-8 w-8 text-[0.8rem]',
  md: 'h-11 w-11 text-base',
  lg: 'h-14 w-14 text-xl',
} as const;

const photoUrl = computed(() => getMemberAvatarUrl(props.member));

/** First letter of the name — a pet with an emoji name falls back to a dot. */
const initial = computed(() => {
  const first = [...props.member.name.trim()][0] ?? '';
  return first.toLocaleUpperCase();
});
</script>

<template>
  <span
    class="wall-face grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white"
    :class="SIZES[size]"
    :style="{ background: member.color }"
    :title="member.name"
    :aria-label="member.name"
    role="img"
  >
    <img
      v-if="photoUrl"
      :src="photoUrl"
      alt=""
      class="h-full w-full object-cover"
      @error="markMemberAvatarError(member)"
    />
    <span v-else class="font-outfit leading-none" aria-hidden="true">{{ initial }}</span>
  </span>
</template>
