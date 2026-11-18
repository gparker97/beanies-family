<script setup lang="ts">
/**
 * A child's avatar in their stars ring (#148, #154): the ONE drawing of it, used by the wall's chore
 * lane header (`size="lane"`) and a child's day head in the app (`size="day"`).
 *
 * With an `arc`, a thin `ProgressRing` around the avatar fills toward the weekly reward (or the
 * nearest saved-up award), with the reward's emoji as a corner badge once achieved. When the
 * weekly goal is reached (`arc.badgeEmoji` is set exactly then, `choreStars.arcFor`), a star sits
 * on top of the ring with two sparkles for the rest of the week. Without an arc it is the avatar
 * alone. Either way the root is ONE wrapper, so a caller's class always lands in the same place.
 *
 * The differences between the two callers are props: the size (ring box, avatar, badge), the
 * avatar's fallback and the test ids. The lane's ring is drawn AROUND the avatar's own footprint
 * (3.6rem pulled in by 0.3rem on every side: exactly the 3rem avatar in the layout), so a lane
 * header is the same height with or without stars. The star and the sparkles sit INSIDE the ring's
 * box, because the lane is `overflow-hidden` and would clip anything outside it.
 *
 * Dark mode: the ring's track and fill are `ProgressRing`'s (its own `html.dark` partner); the
 * badge is `bg-white` / `surface-raised` with a `--color-border-strong` / `line` edge; the star and
 * sparkles are emoji glyphs, nothing painted. They twinkle only without reduced motion.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ProgressRing from '@/components/ui/ProgressRing.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import type { StarArc } from '@/utils/choreStars';
import type { FamilyMember } from '@/types/models';

const props = withDefaults(
  defineProps<{
    member: FamilyMember;
    /** The ring, or nothing (stars off, a grown-up, nothing to draw): the avatar alone. */
    arc?: Pick<StarArc, 'percent' | 'badgeEmoji'> | null;
    size: 'lane' | 'day';
    /** The avatar's fallback when there is no photo (`BeanieAvatar`'s own default otherwise). */
    fallback?: 'initials' | 'beanie';
    ringTestid?: string;
    badgeTestid?: string;
  }>(),
  { arc: null, fallback: undefined, ringTestid: undefined, badgeTestid: undefined }
);

const { memberAvatarBindings } = useMemberAvatarBindings();

const SIZES = {
  lane: {
    ring: 'wall-star-ring',
    avatar: 'lg',
    badge: 'h-6 w-6 text-xs',
    star: 'text-sm',
  },
  day: {
    ring: 'h-20 w-20 flex-none',
    avatar: 'xl',
    badge: 'h-7 w-7 text-sm',
    star: 'text-lg',
  },
} as const;

const look = computed(() => SIZES[props.size]);
/** The arc as `ProgressRing` draws it: one gradient segment. */
const segments = computed(() =>
  props.arc ? [{ value: props.arc.percent / 100, tone: 'fill' as const }] : []
);
</script>

<template>
  <span class="relative inline-flex shrink-0" data-testid="star-ring-avatar" :data-size="size">
    <ProgressRing
      v-if="arc"
      :class="look.ring"
      :segments="segments"
      :stroke-width="6"
      :data-testid="ringTestid"
      :data-percent="arc.percent"
    >
      <BeanieAvatar
        v-bind="memberAvatarBindings(member)"
        :fallback="fallback"
        :size="look.avatar"
      />
      <template v-if="arc.badgeEmoji">
        <span
          class="star-ring-star leading-none"
          :class="look.star"
          aria-hidden="true"
          data-testid="star-ring-star"
          >⭐</span
        >
        <span class="star-ring-spark star-ring-spark-l text-xs leading-none" aria-hidden="true"
          >✨</span
        >
        <span class="star-ring-spark star-ring-spark-r text-xs leading-none" aria-hidden="true"
          >✨</span
        >
      </template>
      <template v-if="arc.badgeEmoji" #badge>
        <span
          class="dark:bg-surface-raised dark:border-line grid place-items-center rounded-full border border-[var(--color-border-strong)] bg-white leading-none"
          :class="look.badge"
          :data-testid="badgeTestid"
          >{{ arc.badgeEmoji }}</span
        >
      </template>
    </ProgressRing>
    <BeanieAvatar
      v-else
      v-bind="memberAvatarBindings(member)"
      :fallback="fallback"
      :size="look.avatar"
    />
  </span>
</template>

<style scoped>
/* The lane's ring: 3.6rem pulled in by 0.3rem on every side, exactly the 3rem avatar in layout. */
.wall-star-ring {
  height: 3.6rem;
  margin: -0.3rem;
  width: 3.6rem;
}

/* The star on top of the ring and its two sparkles: inside the ring's box, never outside it. */
.star-ring-star {
  filter: drop-shadow(0 0.125rem 0.25rem rgb(44 62 80 / 30%));
  left: 50%;
  position: absolute;
  top: 0;
  transform: translate(-50%, -10%);
}

.star-ring-spark {
  position: absolute;
}

.star-ring-spark-l {
  left: 0;
  top: 12%;
}

.star-ring-spark-r {
  right: 0;
  top: 38%;
}

@media (prefers-reduced-motion: no-preference) {
  .star-ring-star {
    animation: star-ring-twinkle 1.8s ease-in-out infinite alternate;
  }

  .star-ring-spark {
    animation: star-ring-twinkle 1.4s ease-in-out infinite alternate;
  }

  .star-ring-spark-r {
    animation-delay: 0.6s;
  }
}

@keyframes star-ring-twinkle {
  0% {
    opacity: 0.7;
    scale: 0.85;
  }

  100% {
    opacity: 1;
    scale: 1.1;
  }
}
</style>
