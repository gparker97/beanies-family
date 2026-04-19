<script setup lang="ts">
/**
 * Small pill showing a family member's avatar stand-in next to a
 * short label — e.g. "🧒 Neil's fave" on a recipe card. Used
 * anywhere we want to attribute content to a specific bean at a
 * glance.
 *
 * Kept dumb: the caller supplies the display label so the string
 * can be localized at its level.
 */
import { computed } from 'vue';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import type { AvatarVariant } from '@/constants/avatars';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  member: FamilyMember;
  /** Label to show next to the avatar (e.g. "Neil's fave"). */
  label: string;
  tone?: 'light' | 'dark';
}>();

// Map the avatar variant key to a single emoji stand-in that reads
// well inside the pill. The full beanie illustration is too detailed
// at this size.
const VARIANT_EMOJI: Record<AvatarVariant, string> = {
  'adult-male': '\u{1F468}',
  'adult-female': '\u{1F469}',
  'adult-other': '\u{1F9D1}',
  'child-male': '\u{1F9D2}',
  'child-female': '\u{1F467}',
  'child-other': '\u{1F9D2}',
  'pet-dog': '\u{1F436}',
  'family-group': '\u{1F46A}',
  'family-filtered': '\u{1F46A}',
};

const avatarEmoji = computed(() => {
  const variant = getMemberAvatarVariant(props.member);
  return VARIANT_EMOJI[variant] ?? '\u{1F9D1}';
});
</script>

<template>
  <span
    class="font-outfit inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
    :class="
      tone === 'dark'
        ? 'text-secondary-500 bg-white/90'
        : 'text-secondary-500 bg-[var(--tint-slate-5)] dark:bg-slate-700/60 dark:text-gray-100'
    "
    :style="{ boxShadow: `inset 0 0 0 1px ${member.color}30` }"
  >
    <span aria-hidden="true">{{ avatarEmoji }}</span>
    <span>{{ label }}</span>
  </span>
</template>
