<script setup lang="ts">
/**
 * One bean's stars on the wall (#154): the body of the drill-in sheet a head in the chore lanes
 * opens (`WallSheet`, target `{ kind: 'stars', memberId }`). Read-only, and read by anyone walking
 * past: the reward names and the notes on bonus and take-away stars are shown on purpose.
 *
 * ONE computed decides what it shows, in this order, so the template stays flat:
 *  - `off`: Stars and Rewards is off (for anyone, a grown-up included). What it is, and where a
 *    grown-up turns it on;
 *  - `adult`: not a star earner (a grown-up, a pet, or a member this device no longer knows,
 *    deleted elsewhere). One friendly line and a chip per child that switches the sheet
 *    (`switch-member`, which `WallSheet` re-emits as its `open`). With no children, no chips and
 *    no "tap a child" line;
 *  - `loading`: on, but the stores are not loaded yet (`stripFor` answers null): one quiet line,
 *    so nothing ever reads a null strip;
 *  - `bare`: no weekly reward and no special reward for this child. Their stars this week, and
 *    where a grown-up adds a reward;
 *  - `stars`: the earned banner when the weekly reward is reached (every time it opens that
 *    week), the week's path (`StarPathStrip`), each special reward with its progress
 *    (`AwardProgressCell`; a complete one gets the Earned badge and the orange tile), and the
 *    week's bonus and take-away entries (`starStore.weekGiftsFor`, drawn by `StarGiftRow`). A
 *    `null` from the getter is a normal state: only the week's net is known, shown alone under
 *    the app's own net wording.
 *
 * MVO: every number is a `starStore` getter; this only words and draws them.
 *
 * Telemetry (surface `beanie-wall`, context `action` only; never a name, a note or an id):
 * `stars_sheet_state` once per bean shown (on open and on a chip switch, once the state is
 * known), `action` = the state; `unknown-member` at warn instead, for a member the store does not
 * know; `stars_sheet_gifts` `gifts-net-only` at info when only the net is known.
 *
 * Dark mode: cards `bg-white` / `surface-raised` on the sheet's `surface-ground` panel; titles
 * `secondary-500` / `ink`; labels `--muted-text` (its own dark value, `ink-soft`); gift tiles and
 * chips `--tint-slate-5` / `surface-overlay`; the special reward's icon tile `--tint-orange-8` /
 * `primary-500/15`; the earned banner, the Earned badge and a complete reward's tile are the brand
 * gradient with white ink in both themes (utilities, a filled mark). The strip, the rows and the
 * progress cell carry their own dark pairs.
 *
 * Layout and scale: read from a few steps away, often by a child. One column on a narrow wall;
 * from a 48rem wide sheet (a container query on the root, so it follows the sheet, not the
 * screen) This Week and the special rewards sit side by side, with the earned banner above and
 * the bonus stars below at full width. The strip, the reward rows, the bonus rows and the empty
 * states use their `lg` (wall) size; the labels and lines the wall's own sheet classes.
 */
import { computed, watch } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import AwardProgressCell from '@/components/chores/AwardProgressCell.vue';
import RewardEarnedBanner from '@/components/chores/RewardEarnedBanner.vue';
import StarCount from '@/components/chores/StarCount.vue';
import StarGiftRow from '@/components/chores/StarGiftRow.vue';
import StarPathStrip from '@/components/chores/StarPathStrip.vue';
import { bonusLine, rewardBannerText, signedStars } from '@/components/chores/starText';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { DEFAULT_REWARD_EMOJI } from '@/constants/choreStars';
import { logEvent } from '@/services/telemetry/logEvent';
import { useFamilyStore } from '@/stores/familyStore';
import { useStarStore } from '@/stores/starStore';
import { firstName } from '@/utils/assignees';
import { awardProgressLabel } from '@/utils/choreStars';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatUiDate } from '@/utils/uiLocale';

export type WallStarsState = 'off' | 'adult' | 'loading' | 'bare' | 'stars';

const props = defineProps<{ memberId: string }>();
const emit = defineEmits<{ 'switch-member': [memberId: string] }>();

const SURFACE = 'beanie-wall';

const { t, currentLanguage } = useTranslation();
const starStore = useStarStore();
const familyStore = useFamilyStore();
const { memberAvatarBindings } = useMemberAvatarBindings();

const member = computed(() => familyStore.members.find((m) => m.id === props.memberId) ?? null);
const name = computed(() => firstName(member.value?.name));
const strip = computed(() => starStore.stripFor(props.memberId));
const awards = computed(() => starStore.awardsFor(props.memberId));

const state = computed<WallStarsState>(() => {
  if (!starStore.isOn) return 'off';
  if (!starStore.earners.includes(props.memberId)) return 'adult';
  if (!strip.value) return 'loading';
  if (!starStore.rewards.weeklyOn && awards.value.length === 0) return 'bare';
  return 'stars';
});

const rewards = computed(() => starStore.rewards);
const rewardEmoji = computed(() => rewards.value.emoji || DEFAULT_REWARD_EMOJI);

/** The earned banner's words: the app's banner title, and the day it was reached. */
const reached = computed(() => {
  const s = strip.value;
  if (!s?.path.reached) return null;
  const total = s.week.total;
  const day = s.week.hitOn
    ? formatUiDate(s.week.hitOn, currentLanguage.value, { weekday: 'long' })
    : '';
  return {
    title: rewardBannerText({ beanName: name.value, title: rewards.value.title ?? '' }, total, t)
      .title,
    line: day
      ? fillTemplate(
          t(total === 1 ? 'choreStars.wall.reached.one' : 'choreStars.wall.reached.other'),
          { name: name.value, day, count: total }
        )
      : '',
  };
});

/** Each special reward for this child, worded once per render. */
const awardRows = computed(() => {
  const full = strip.value?.week.full ?? 0;
  return awards.value.map(({ award, progress }) => {
    const label = awardProgressLabel(award, progress, full, t);
    return {
      award,
      label,
      achieved: !!progress.achievedOn,
      percent: progress.achievedOn ? 100 : Math.round(progress.fraction * 100),
      aria: fillTemplate(t('choreStars.report.savedAria'), {
        name: name.value,
        reward: award.title,
        progress: label,
      }),
    };
  });
});

const nameOf = (id: string) => firstName(familyStore.members.find((m) => m.id === id)?.name);

/** This week's bonus and take-away entries; `null`: only the net is known. */
const weekGifts = computed(() =>
  state.value === 'stars' ? starStore.weekGiftsFor(props.memberId, strip.value?.week) : []
);
const giftLines = computed(() => (weekGifts.value ?? []).map((g) => bonusLine(g, nameOf, t)));
const netOnly = computed(() =>
  weekGifts.value === null && strip.value ? signedStars(strip.value.week.bonus, t) : ''
);

/** The `bare` heading: this child's stars this week. */
const bareTitle = computed(() => {
  const count = strip.value?.week.total ?? 0;
  return fillTemplate(
    t(count === 1 ? 'choreStars.strip.thisWeek.one' : 'choreStars.strip.thisWeek.other'),
    { count }
  );
});

/** The `adult` sheet's chips: every star-earning child, with their stars this week. */
const kids = computed(() =>
  starStore.earnerMembers.map((m) => ({
    member: m,
    name: firstName(m.name),
    count: starStore.weekFor(m.id)?.total ?? null,
  }))
);

const empty = computed(() => {
  switch (state.value) {
    case 'off':
      return {
        emoji: '🌱',
        title: t('choreStars.wall.off.title'),
        message: t('choreStars.wall.off.body'),
      };
    case 'bare':
      return {
        emoji: '⭐',
        title: bareTitle.value,
        message: fillTemplate(t('choreStars.wall.bare.body'), { name: name.value }),
      };
    case 'adult':
      return {
        emoji: '⭐',
        title: t('choreStars.wall.adult.title'),
        message: t('choreStars.wall.adult.body'),
      };
    default:
      return null;
  }
});

// ── Telemetry ───────────────────────────────────────────────────────────────

/** The bean the state was last logged for, so a re-render or a load never logs twice. */
let loggedFor: string | null = null;
let netLoggedFor: string | null = null;
watch(
  [() => props.memberId, state],
  ([id, now]) => {
    if (now === 'loading' || loggedFor === id) return;
    loggedFor = id;
    if (!member.value) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'stars_sheet_state',
        context: { action: 'unknown-member' },
      });
      return;
    }
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'stars_sheet_state',
      context: { action: now },
    });
  },
  { immediate: true }
);
watch(
  [() => props.memberId, netOnly],
  ([id, net]) => {
    if (!net || netLoggedFor === id) return;
    netLoggedFor = id;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'stars_sheet_gifts',
      context: { action: 'gifts-net-only' },
    });
  },
  { immediate: true }
);

const card = 'dark:bg-surface-raised rounded-[20px] bg-white p-5 shadow-[var(--card-shadow)]';
const label =
  'font-outfit wall-sheet-label mb-3 block font-bold tracking-[0.08em] text-[var(--muted-text,#4d5d6c)] uppercase';
const earnedBadge =
  'font-outfit from-primary-500 to-terracotta-400 inline-flex flex-none items-center gap-1.5 rounded-full bg-gradient-to-r px-3 py-1 text-sm font-bold text-white';
</script>

<template>
  <div class="@container pb-4" data-testid="wall-stars-sheet" :data-state="state">
    <p
      v-if="state === 'loading'"
      class="font-caveat wall-sheet-empty py-8 text-center"
      data-testid="wall-stars-loading"
    >
      {{ t('action.loading') }}
    </p>

    <div v-else-if="state === 'stars' && strip" class="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
      <RewardEarnedBanner
        v-if="reached"
        class="col-span-full"
        :emoji="rewardEmoji"
        :title="reached.title"
        :line="reached.line"
      />

      <section
        :class="[card, awardRows.length ? '' : 'col-span-full']"
        data-testid="wall-stars-week"
      >
        <span :class="label">{{ t('date.thisWeek') }}</span>
        <StarPathStrip
          v-bind="strip"
          :reward-title="rewards.title"
          :reward-emoji="rewardEmoji"
          :bar-pct="rewards.barPct"
          :member="member"
          size="lg"
        />
      </section>

      <section v-if="awardRows.length" :class="card" data-testid="wall-stars-awards">
        <span :class="label">{{ t('choreStars.awards.title') }}</span>
        <ul class="flex flex-col gap-4">
          <li
            v-for="row in awardRows"
            :key="row.award.id"
            class="flex items-center gap-4"
            data-testid="wall-stars-award"
            :data-award-id="row.award.id"
            :data-state="row.achieved ? 'achieved' : 'progress'"
          >
            <span
              class="grid h-14 w-14 flex-none place-items-center rounded-2xl text-3xl leading-none"
              :class="
                row.achieved
                  ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br shadow-[0_0.25rem_0.75rem_rgb(241_93_34/35%)]'
                  : 'dark:bg-primary-500/15 bg-[var(--tint-orange-8)]'
              "
              aria-hidden="true"
              >{{ row.award.emoji }}</span
            >
            <span class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span class="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  class="font-outfit text-secondary-500 dark:text-ink min-w-0 truncate text-xl font-bold"
                  >{{ row.award.title }}</span
                >
                <span v-if="row.achieved" :class="earnedBadge" data-testid="wall-stars-earned"
                  ><span aria-hidden="true">🎉</span> {{ t('choreStars.wall.earned') }}</span
                >
              </span>
              <AwardProgressCell
                :label="row.label"
                :percent="row.percent"
                :aria="row.aria"
                fill-testid="wall-stars-award-bar"
                size="lg"
              />
            </span>
          </li>
        </ul>
      </section>

      <section
        v-if="giftLines.length || netOnly"
        :class="card"
        class="col-span-full"
        data-testid="wall-stars-gifts"
      >
        <span :class="label">{{ t('choreStars.wall.bonusTitle') }}</span>
        <ul v-if="giftLines.length" class="flex flex-col gap-3">
          <StarGiftRow
            v-for="entry in giftLines"
            :key="entry.gift.id"
            :entry="entry"
            amount-testid="wall-stars-gift-amount"
            size="lg"
            class="dark:bg-surface-overlay flex items-center gap-3 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-3"
            data-testid="wall-stars-gift"
            :data-kind="entry.take ? 'take' : 'bonus'"
          />
        </ul>
        <div
          v-else
          class="wall-sheet-line dark:bg-surface-overlay flex items-center gap-3 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-3"
          data-testid="wall-stars-gifts-net"
        >
          <span class="text-secondary-500 dark:text-ink min-w-0 flex-1">{{
            t('choreStars.report.weekPop.bonusNet')
          }}</span>
          <b
            class="font-outfit flex-none text-xl font-extrabold tabular-nums"
            :class="
              strip.week.bonus < 0
                ? 'text-secondary-500 dark:text-ink'
                : 'dark:text-success-lift text-green-700'
            "
            >{{ netOnly }}</b
          >
        </div>
      </section>
    </div>

    <div v-else-if="empty" :class="card" data-testid="wall-stars-empty">
      <EmptyState :emoji="empty.emoji" :title="empty.title" :message="empty.message" size="lg">
        <template v-if="state === 'adult' && kids.length">
          <p
            class="font-outfit wall-sheet-line dark:text-ink-soft text-[var(--muted-text,#4d5d6c)]"
          >
            {{ t('choreStars.wall.adult.pick') }}
          </p>
          <div class="mt-1 flex flex-wrap justify-center gap-2">
            <button
              v-for="kid in kids"
              :key="kid.member.id"
              type="button"
              class="wall-chip-person text-secondary-500 dark:bg-surface-overlay dark:text-ink flex min-h-[var(--wall-tap,2.75rem)] cursor-pointer items-center gap-2 rounded-full bg-[var(--tint-slate-5)] py-1 pr-4 pl-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AED6F1]"
              :aria-label="fillTemplate(t('choreStars.wall.chip'), { name: kid.name })"
              data-testid="wall-stars-kid"
              :data-member-id="kid.member.id"
              @click="emit('switch-member', kid.member.id)"
            >
              <BeanieAvatar
                v-bind="memberAvatarBindings(kid.member)"
                fallback="initials"
                size="sm"
                aria-hidden="true"
              />
              <span class="font-outfit font-semibold">{{ kid.name }}</span>
              <StarCount v-if="kid.count !== null" :count="kid.count" />
            </button>
          </div>
        </template>
      </EmptyState>
    </div>
  </div>
</template>
