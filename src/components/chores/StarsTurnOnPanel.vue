<script setup lang="ts">
/**
 * Stars and rewards (#148): what the "Stars and Rewards" view of the Choreboard shows while the
 * feature is off (`Settings.choreRewards` absent or `on: false`; the two mean the same, there is
 * no dismissed state). One primary action, "Turn On Stars and Rewards" (`setRewards({ on: true })`);
 * the view then shows the setup. A `null` from the store has already been toasted and logged:
 * nothing is shown again here.
 *
 * The strip is an illustration (fixed sample numbers), drawn with the real `StarPathStrip` and,
 * when the family has a child, that child's avatar.
 *
 * Dark mode: the card is `bg-white` / `surface-raised` with a Heritage Orange edge (an accent
 * line, `accent-lift` on dark); the strip's tile `--tint-slate-5` / `surface-overlay`; the icon
 * box `--tint-orange-8` (dark value in `style.css`); text `secondary-*` / `ink*`. The button is
 * the brand gradient with white ink in both themes.
 */
import { computed, ref } from 'vue';
import StarPathStrip from '@/components/chores/StarPathStrip.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useStarStore } from '@/stores/starStore';
import { DEFAULT_REWARD_EMOJI } from '@/constants/choreStars';
import type { StarPath } from '@/utils/choreStars';

const { t } = useTranslation();
const familyStore = useFamilyStore();
const starStore = useStarStore();

/** The illustration: 11 of a 20-star week, the bar at 80% (16 stars), one chore open today. */
const SAMPLE_WEEK = { total: 11, bar: 16, full: 20 } as const;
const SAMPLE_PATH: StarPath = {
  stepSize: 1,
  steps: 20,
  earned: 11,
  next: 1,
  thinFrom: 20,
  barAt: 15,
  awardAt: null,
  toBar: 5,
  reached: false,
  reachable: true,
};

/** The family's first child, for the strip's avatar (none: the strip draws without one). */
const sampleKid = computed(() => starStore.earnerMembers[0] ?? null);

const busy = ref(false);

async function turnOn(): Promise<void> {
  const actorId = familyStore.currentMemberId;
  if (busy.value || !actorId) return;
  busy.value = true;
  try {
    await starStore.setRewards({ on: true }, actorId);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    class="border-primary-500 dark:border-accent-lift dark:bg-surface-raised flex max-w-xl flex-col gap-3 rounded-3xl border bg-white p-4 shadow-[var(--card-shadow)]"
    data-testid="stars-turn-on-panel"
  >
    <div class="flex items-start gap-3">
      <span
        class="grid h-11 w-11 flex-none place-items-center rounded-[14px] bg-[var(--tint-orange-8)] text-xl"
        aria-hidden="true"
        >⭐</span
      >
      <div class="min-w-0 flex-1">
        <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg leading-tight font-bold">
          {{ t('choreStars.title') }}
        </h2>
        <p class="text-secondary-400 dark:text-ink-soft text-xs">
          {{ t('choreStars.turnOn.subtitle') }}
        </p>
      </div>
    </div>

    <p class="text-secondary-500 dark:text-ink-soft text-sm">{{ t('choreStars.turnOn.body') }}</p>

    <div class="dark:bg-surface-overlay rounded-2xl bg-[var(--tint-slate-5)] px-3 py-2.5">
      <StarPathStrip
        :week="SAMPLE_WEEK"
        :path="SAMPLE_PATH"
        :reward-title="t('choreStars.turnOn.sampleReward')"
        :reward-emoji="DEFAULT_REWARD_EMOJI"
        :bar-pct="80"
        :member="sampleKid"
      />
    </div>

    <button
      type="button"
      class="font-outfit from-primary-500 to-terracotta-400 focus-visible:ring-sky-silk-300 rounded-2xl bg-gradient-to-r px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(241,93,34,0.25)] focus-visible:ring-2 focus-visible:outline-none"
      :disabled="busy"
      data-testid="stars-turn-on"
      @click="turnOn"
    >
      {{ t('choreStars.turnOn.action') }}
    </button>

    <p class="text-secondary-400 dark:text-ink-faint text-xs">
      {{ t('choreStars.turnOn.footnote') }}
    </p>
  </section>
</template>
