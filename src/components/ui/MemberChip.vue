<script setup lang="ts">
import { computed } from 'vue';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { resolveMemberColor } from '@/constants/memberColors';

// 'dot' — a 24px member FACE (delegates to BeanieAvatar). Use in cramped contexts
// (lane-packed timeline cards, tablet-width calendar columns) where full-name pills
// would wrap or overflow.
// 'sm'  — compact name pill for inline labels and dense grids.
// 'md'  — gradient pill used on hero rows / filter chips where readability
// trumps density.
//
// The two are different things doing different jobs, which is why they live in one
// component: `dot` is a face (identity, where the surrounding context does not name
// the member), `sm`/`md` are NAME pills (where the member IS the content, e.g. a
// detail modal's assignee row).
const props = withDefaults(
  defineProps<{
    memberId: string;
    size?: 'dot' | 'sm' | 'md';
  }>(),
  { size: 'sm' }
);

const { getMemberById } = useMemberInfo();
const { memberAvatarBindings } = useMemberAvatarBindings();

/**
 * The chip is keyed on a member ID that may live inside an entity's
 * `assigneeIds` long after the member was removed (deletes don't rewrite
 * existing activities / todos — the orphaned ID is preserved so the
 * assignment is restored automatically if the member is ever un-archived).
 *
 * When the lookup fails, render nothing rather than a stale "Unknown"
 * pill with a generic gray fallback — every consumer that loops
 * `assigneeIds` then transparently skips orphaned entries instead of
 * needing its own filter pass.
 */
const member = computed(() => getMemberById(props.memberId));
const name = computed(() => member.value?.name ?? '');
const color = computed(() => resolveMemberColor(member.value?.color));
</script>

<template>
  <template v-if="member">
    <!--
      `dot` delegates rather than drawing its own circle, so there is ONE avatar
      implementation in the app. It grows 16px → 24px in doing so: the collision rule
      can widen an initial to two letters, and two letters cannot sit legibly in a 16px
      circle against the 12px type floor with Large reading mode scaling it. The same
      trade was made for MemberChipFilter (18px → 24px).
    -->
    <BeanieAvatar
      v-if="size === 'dot'"
      v-bind="memberAvatarBindings(member)"
      fallback="initials"
      size="xs"
      :title="name"
      class="dark:ring-surface-raised ring-1 ring-white"
    />
    <span
      v-else
      class="inline-flex items-center text-xs font-medium text-white"
      :class="
        size === 'sm'
          ? 'rounded-full px-2 py-0.5'
          : 'font-outfit rounded-full px-3 py-1.5 font-semibold'
      "
      :style="{
        background: size === 'sm' ? color : `linear-gradient(135deg, ${color}, ${color}cc)`,
      }"
    >
      {{ name }}
    </span>
  </template>
</template>
