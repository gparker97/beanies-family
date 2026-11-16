<script setup lang="ts">
/**
 * Stars and rewards (#148): a grown-up's read-only path strip for one child's week
 * (requirement 11). It draws `pathSteps` (`utils/choreStars.ts`) and decides nothing:
 *
 *  - at most 20 steps; above that each step is several stars and the caption says so;
 *  - earned steps are filled (a step lights only when all its stars are in); today's open
 *    chores are the next steps, lit softly; steps past a full week are thin (bonus only);
 *  - a notch after the bar's step, with the weekly reward's emoji above it (lit once reached);
 *  - the child's avatar above the step reached, and a "This Week" award's marker above its step;
 *  - the words: "N more stars to Ice Cream", or "Achieved" with the day; when the bar can no
 *    longer be reached this week the strip says nothing about it (only the week's stars), and
 *    never "out of reach";
 *  - one quiet line for the nearest saved-up award (`awardProgressLabel`, the one wording).
 *
 * The root is `role="img"` with one spoken summary, so a screen reader hears a sentence, not
 * twenty steps.
 *
 * Dark mode (plan, Dark Mode Coverage): the strip sits on a `bg-white` / `surface-raised` card.
 * Earned steps and a lit reward marker are Heritage Orange fills (filled marks, the same in
 * both themes). Next steps are `--tint-orange-15` with an orange inset line that lifts to
 * `accent-lift`; ahead steps `--tint-slate-10` (both custom properties carry dark values in
 * `style.css`). The notch is `primary-600` / `accent-lift`; "N more stars" is `primary-700` (it
 * clears AA on white, where `primary-600` measures 4.39) / `accent-lift`; the caption
 * `secondary-500` / `ink`; small text `secondary-400` / `ink-faint`; the saved-up line
 * `secondary-500` / `ink-soft`; Achieved is green-700 / `success-lift` on `--tint-success-10`.
 * Markers are `bg-white` / `surface-raised`. The only scoped rule is geometry (no paint).
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { choreDayShort, rewardName } from '@/components/chores/starText';
import { awardProgressLabel, type StarPath, type WeekStars } from '@/utils/choreStars';
import { fillTemplate } from '@/utils/fillTemplate';
import type { AwardStanding } from '@/stores/starStore';
import type { ChoreAward, FamilyMember } from '@/types/models';

const props = withDefaults(
  defineProps<{
    week: Pick<WeekStars, 'total' | 'bar' | 'full' | 'hitOn'>;
    path: StarPath;
    /** The nearest saved-up award: the one quiet line under the strip. */
    nearest?: AwardStanding | null;
    /** The "This Week" award whose marker sits above its step. */
    thisWeek?: Pick<ChoreAward, 'emoji'> | null;
    /** The weekly reward's name and emoji, as the family typed them. */
    rewardTitle?: string;
    rewardEmoji?: string;
    /** The bar in percent, for the "Bar 80%" caption. */
    barPct?: number;
    /** Whose week: their avatar rides on the step reached. */
    member?: FamilyMember | null;
  }>(),
  {
    nearest: null,
    thisWeek: null,
    rewardTitle: '',
    rewardEmoji: '',
    barPct: 100,
    member: null,
  }
);

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

const reward = computed(() => rewardName(props.rewardTitle, t));
const hasBar = computed(() => props.path.barAt !== null && props.week.bar > 0);

type StepTone = 'earned' | 'next' | 'ahead';
const steps = computed(() =>
  Array.from({ length: props.path.steps }, (_, i) => {
    const p = props.path;
    const tone: StepTone = i < p.earned ? 'earned' : i < p.earned + p.next ? 'next' : 'ahead';
    return { i, tone, thin: i >= p.thinFrom, notchAfter: p.barAt === i };
  })
);

/** Where a marker sits along the strip, in percent, kept off the very edges. */
const at = (fraction: number) => `${Math.min(95, Math.max(5, fraction * 100))}%`;

const barPos = computed(() =>
  props.path.barAt === null ? null : (props.path.barAt + 1) / Math.max(1, props.path.steps)
);
const awardPos = computed(() =>
  props.path.awardAt === null || !props.thisWeek
    ? null
    : (props.path.awardAt + 0.5) / Math.max(1, props.path.steps)
);
const avatarPos = computed(() =>
  props.path.earned > 0 ? (props.path.earned - 0.5) / Math.max(1, props.path.steps) : 0
);
/**
 * Centred on its step; too close to the reward marker, the avatar steps aside (before it, or
 * after it once reached), as the mockup draws it.
 */
const avatarShift = computed(() => {
  if (barPos.value === null || Math.abs(avatarPos.value - barPos.value) >= 0.1) return '-50%';
  return props.path.reached ? '60%' : '-160%';
});

const moreText = computed(() => {
  const n = props.path.toBar;
  return fillTemplate(t(n === 1 ? 'choreStars.strip.more.one' : 'choreStars.strip.more.other'), {
    count: n,
  });
});
/** "{more} to {reward}", split so the count can be emphasised in any word order. */
const toRewardParts = computed(() => {
  const [before = '', after = ''] = t('choreStars.strip.toReward').split('{more}');
  return {
    before: fillTemplate(before, { reward: reward.value }),
    after: fillTemplate(after, { reward: reward.value }),
  };
});
const plainText = computed(() =>
  fillTemplate(
    t(props.week.total === 1 ? 'choreStars.strip.thisWeek.one' : 'choreStars.strip.thisWeek.other'),
    { count: props.week.total }
  )
);

/** The caption's state: reached, still reachable, or nothing to say about the bar. */
const caption = computed<'achieved' | 'more' | 'plain'>(() => {
  if (!hasBar.value) return 'plain';
  if (props.path.reached) return 'achieved';
  return props.path.reachable ? 'more' : 'plain';
});

const achievedOn = computed(() =>
  fillTemplate(t('choreStars.strip.achievedOn'), {
    reward: reward.value,
    day: choreDayShort(props.week.hitOn, t),
  })
);

const smallCaption = computed(() => {
  if (props.path.stepSize > 1) {
    return fillTemplate(t('choreStars.strip.stepSize'), { count: props.path.stepSize });
  }
  if (hasBar.value && props.barPct < 100) {
    return fillTemplate(t('choreStars.strip.barPct'), { pct: props.barPct });
  }
  return '';
});

const savedLine = computed(() => {
  const n = props.nearest;
  if (!n) return '';
  return fillTemplate(t('choreStars.strip.saved'), {
    progress: awardProgressLabel(n.award, n.progress, props.week.full, t),
    reward: n.award.title,
  });
});

const spoken = computed(() => {
  const vars = { total: props.week.total, bar: props.week.bar, reward: reward.value };
  const head =
    caption.value === 'achieved'
      ? fillTemplate(t('choreStars.strip.aria.achieved'), vars)
      : caption.value === 'more'
        ? fillTemplate(t('choreStars.strip.aria.bar'), vars)
        : fillTemplate(t('choreStars.strip.aria.plain'), vars);
  return savedLine.value ? `${head}. ${savedLine.value}` : head;
});
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    role="img"
    :aria-label="spoken"
    data-testid="star-path-strip"
    :data-steps="path.steps"
  >
    <!-- Markers: the reward over the notch, a This Week award, the child on the step reached. -->
    <div v-if="path.steps > 0" class="relative h-7" aria-hidden="true">
      <span
        v-if="barPos !== null && hasBar"
        class="strip-marker grid h-6 w-6 place-items-center rounded-lg text-sm leading-none"
        :class="
          path.reached
            ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br shadow-[0_3px_8px_rgba(241,93,34,0.3)]'
            : 'border-primary-500 dark:border-accent-lift dark:bg-surface-raised border-[1.5px] border-dashed bg-white'
        "
        :style="{ left: at(barPos) }"
        data-testid="star-path-reward"
        :data-reached="path.reached ? 'true' : 'false'"
        >{{ rewardEmoji || '⭐' }}</span
      >
      <span
        v-if="awardPos !== null && thisWeek"
        class="strip-marker dark:border-line-strong dark:bg-surface-raised grid h-5 w-5 place-items-center rounded-md border border-dashed border-[var(--color-border-strong)] bg-white text-xs leading-none"
        :style="{ left: at(awardPos) }"
        data-testid="star-path-award"
        >{{ thisWeek.emoji }}</span
      >
      <span
        v-if="member"
        class="strip-marker"
        :style="{ left: at(avatarPos), transform: `translateX(${avatarShift})` }"
        data-testid="star-path-avatar"
      >
        <BeanieAvatar v-bind="memberAvatarBindings(member)" size="xs" />
      </span>
    </div>

    <!-- The steps, with the bar's notch after its step. -->
    <div v-if="path.steps > 0" class="flex h-3.5 items-center gap-0.5" aria-hidden="true">
      <template v-for="s in steps" :key="s.i">
        <i
          class="block min-w-0 flex-1 rounded-full"
          :class="[
            s.thin ? 'h-1' : 'h-2',
            s.tone === 'earned'
              ? 'bg-primary-500'
              : s.tone === 'next'
                ? 'ring-primary-500 dark:ring-accent-lift bg-[var(--tint-orange-15)] ring-1 ring-inset'
                : 'bg-[var(--tint-slate-10)]',
          ]"
          data-testid="star-path-step"
          :data-tone="s.tone"
          :data-thin="s.thin ? 'true' : undefined"
        />
        <b
          v-if="s.notchAfter"
          class="bg-primary-600 dark:bg-accent-lift block h-3.5 w-0.5 flex-none rounded-sm"
          data-testid="star-path-notch"
        />
      </template>
    </div>

    <div class="font-outfit flex items-baseline gap-2 text-sm leading-snug" aria-hidden="true">
      <template v-if="caption === 'achieved'">
        <span
          class="dark:text-success-lift rounded-full bg-[var(--tint-success-10)] px-2 py-0.5 text-xs font-bold text-green-700"
          data-testid="star-path-achieved"
          >✓ {{ t('choreStars.achieved') }}</span
        >
        <span class="text-secondary-500 dark:text-ink-soft min-w-0 truncate font-semibold">{{
          achievedOn
        }}</span>
      </template>
      <span
        v-else-if="caption === 'more'"
        class="text-secondary-500 dark:text-ink min-w-0 font-semibold"
        data-testid="star-path-more"
        >{{ toRewardParts.before
        }}<b class="text-primary-700 dark:text-accent-lift font-bold">{{ moreText }}</b
        >{{ toRewardParts.after }}</span
      >
      <span
        v-else
        class="text-secondary-500 dark:text-ink min-w-0 font-semibold"
        data-testid="star-path-plain"
        >{{ plainText }}</span
      >
      <small
        v-if="smallCaption"
        class="font-inter text-secondary-400 dark:text-ink-faint ml-auto text-xs font-medium whitespace-nowrap"
        data-testid="star-path-caption"
        >{{ smallCaption }}</small
      >
    </div>

    <p
      v-if="savedLine && nearest"
      class="text-secondary-500 dark:text-ink-soft text-xs leading-snug"
      aria-hidden="true"
      data-testid="star-path-saved"
    >
      <span aria-hidden="true">{{ nearest.award.emoji }}</span> {{ savedLine }}
    </p>
  </div>
</template>

<style scoped>
/* Geometry only: a marker is centred on its step and sits on the strip. */
.strip-marker {
  bottom: 0;
  position: absolute;
  transform: translateX(-50%);
}
</style>
