<script setup lang="ts">
/**
 * Stars and rewards (#148): the Choreboard's "Star Report" view, drawn by `ChoreboardPage` for a
 * grown-up while the feature is on (the view switch offers it only then; requirement 13).
 *
 * By week: the page hands it the weeks (`weeks`, newest first) and the week showing
 * (`v-model:week`), the same week as the Chores view's board (page state only). The main table
 * IS the Chores Done board (`ChoreWeekPanel`, the kids' rows for that week from the chore
 * marks), with its stepper in the header and its `extras` carrying the star facts per kid:
 *  - stars from chores, and the bonus as a signed net ("+2", "-1", "0"). The entries are the
 *    ones the week's breakdown lists (`weekBonusEntries`, the one rule): the gifts dated in that
 *    week, only when they add up to the week's own net. When that rule yields entries the number
 *    is tappable (the fact's `action`) and opens that kid's bonus summary (`StarBonusPopover`,
 *    the same convention as a day's number); otherwise (no entry, or entries on this device that
 *    the frozen week never counted) it is the plain net, as the breakdown's net line shows it;
 *  - the weekly reward: Achieved with the day, or "N of M";
 *  - "No record for this week" (`choreStars.noRecord`) where `starStore.weekFor` answers `null`
 *    (a closed week no device recorded), never a zero. The board still shows that kid's chores.
 * Below it, two cards:
 *  - "Stars by Week": each kid an equal-width well across the card (stacked on a narrow card),
 *    the kid's total over the weeks drawn directly under the kid's name, and a bar per week
 *    offered (this week and up to four before it) that stretches to the well up to a cap, the
 *    group centred past it. Plain CSS bars; each kid against their OWN best week only, never
 *    ranked or scaled against a sibling; the open week striped, a missing week a dashed gap. A
 *    week with a number is a button: it opens that week's breakdown (`StarWeekPopover`, on the
 *    bonus summary's shell): each day's chores done of due and stars, the bonus entries (or the
 *    net), and the total, combined by `weekBreakdown` so they add up to the bar. A gap is not.
 *  - "Special Rewards Progress": in its header Rewards Settings (asks the page for the Rewards
 *    view, `open-rewards`) and Add Special Reward (asks for the page's drawer, empty,
 *    `open-award`); then each special reward, both kinds, as of that week: its title row (the
 *    drawer on it; small avatars of who it is for when that is not every kid) and a line per kid
 *    it is for (`awardIsFor`) with a record, a bar and "64 of 160 stars" (`awardProgressLabel`, the one wording), or the
 *    Achieved tag with its day (its date when it was reached in an earlier week). Saved Up ones
 *    count the weeks up to that week, This Week ones that week alone.
 * The bonus summary lets a grown-up remove an entry of the OPEN week (behind the app's confirm;
 * `starStore.removeGift` refuses a closed week anyway); a closed week's entries are read only.
 *
 * MVO: every star number is a `starStore` getter (closed weeks from the frozen record, the open
 * week live), the chores done `choreStore.weekFor`; each kid's weeks and standings are read ONCE
 * per render (`rows`) and every section draws from them. The one write is `removeGift`, which
 * toasts and logs its own failure. The special reward drawer is the page's ONE
 * `ChoreAwardModal`, asked for with `open-award` (the same intent as the Rewards view's). Telemetry: `report-action` (surface `chore-stars`, `action` add-award |
 * edit-award | rewards-settings | bonus-summary) so the report's shortcuts' use reads from the
 * firehose.
 *
 * Dark mode: the board is `ChoreWeekPanel`'s own; cards `bg-white` / `surface-raised` with `line`
 * edges; a kid's well in Stars by Week `--tint-slate-5` / `surface-overlay`; heads
 * `secondary-400` / `ink-faint`; values `secondary-500` / `ink`; the outline button `bg-white` /
 * `surface-overlay` with `--color-border-strong` / `line-strong`; the kind chip `--tint-slate-5` /
 * `surface-overlay`; Achieved green-700 / `success-lift` on `--tint-success-10`; bars are the
 * brand gradient (a filled mark, the same in both themes) on `ProgressBar`'s `--tint-slate-10`
 * track (its own dark value); the open week's stripes and the missing week's dashed gap are
 * scoped rules built from `--tint-*` properties that carry their own dark values, plus a plain
 * `html.dark` partner for the gap's edge.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import AwardProgressCell from '@/components/chores/AwardProgressCell.vue';
import ChoreWeekPanel, {
  type WeekPanelExtras,
  type WeekPanelFact,
} from '@/components/chores/ChoreWeekPanel.vue';
import StarBonusPopover from '@/components/chores/StarBonusPopover.vue';
import StarWeekPopover, { type WeekBreakdownLines } from '@/components/chores/StarWeekPopover.vue';
import {
  awardForKids,
  bonusLine as bonusLineOf,
  choreDayShort,
  rewardName,
  signedStars,
  type BonusEntryLine,
} from '@/components/chores/starText';
import { confirm } from '@/composables/useConfirm';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import { useChoreStore } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useStarStore, type AwardStanding } from '@/stores/starStore';
import { DEFAULT_REWARD_EMOJI } from '@/constants/choreStars';
import {
  awardIsFor,
  awardProgressLabel,
  weekBreakdown,
  weeklyAchieved,
  type WeekStars,
} from '@/utils/choreStars';
import { choreDayOfWeek, shiftChoreDay } from '@/utils/chores';
import { firstName } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatUiDate } from '@/utils/uiLocale';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreAward, ChoreStarGift, FamilyMember } from '@/types/models';

const props = defineProps<{
  /** The week starts offered, newest first (the page's, shared with the Chores view's board). */
  weeks: readonly string[];
  /** The week start showing. */
  week: string;
}>();
const emit = defineEmits<{
  'update:week': [weekStart: string];
  /** Rewards Settings: the page switches to its Rewards view. */
  'open-rewards': [];
  /** Add Special Reward (`null`) or a special reward's row: the page's ONE drawer opens. */
  'open-award': [award: ChoreAward | null];
}>();

const { t, currentLanguage } = useTranslation();
const familyStore = useFamilyStore();
const choreStore = useChoreStore();
const starStore = useStarStore();
const { memberAvatarBindings } = useMemberAvatarBindings();

const todayYmd = computed(() => choreStore.todayYmd);
/** The week showing: never outside `weeks` (anything else reads as the newest). */
const shown = computed(() =>
  props.weeks.includes(props.week) ? props.week : (props.weeks[0] ?? '')
);
const isOpenWeek = computed(() => shown.value !== '' && shown.value === props.weeks[0]);
const inShownWeek = (ymd: string | undefined) =>
  !!ymd && !!shown.value && ymd >= shown.value && ymd <= shiftChoreDay(shown.value, 6);

const rewards = computed(() => starStore.rewards);
const reward = computed(() => rewardName(rewards.value.title, t));
const rewardEmoji = computed(() => rewards.value.emoji || DEFAULT_REWARD_EMOJI);

const dayShort = (ymd: string) => choreDayShort(ymd, t);
const shortDate = (ymd: string) =>
  formatUiDate(ymd, currentLanguage.value, { month: 'short', day: 'numeric' });
const plural = (
  n: number,
  one: UIStringKey,
  other: UIStringKey,
  vars: Record<string, string | number> = {}
) => fillTemplate(t(n === 1 ? one : other), { count: n, ...vars });

/** "Achieved Fri" for a day of the week showing; "Achieved Nov 13" for an earlier week's day. */
const achievedOn = (ymd: string | undefined) =>
  fillTemplate(t('choreStars.report.achievedOn'), {
    day: !ymd ? '' : inShownWeek(ymd) ? dayShort(ymd) : shortDate(ymd),
  });

/** A signed star count: "+2", "-1", or a plain "0". */
const signed = (n: number) => signedStars(n, t);

function logAction(
  action: 'add-award' | 'edit-award' | 'rewards-settings' | 'bonus-summary' | 'week-breakdown'
): void {
  logEvent({
    level: 'info',
    surface: 'chore-stars',
    message: 'report-action',
    context: { action },
  });
}

// ── The kids: each one's weeks and standings, read once per render ─────────

const kids = computed<FamilyMember[]>(() => starStore.earnerMembers);

interface KidRow {
  member: FamilyMember;
  name: string;
  /** Every week offered, by week start (`null`: a closed week with no record). */
  byWeek: Map<string, WeekStars | null>;
  /** The week showing; `null`: a closed week with no record ("No record", never a zero). */
  week: WeekStars | null;
  /** A full week today, for the full-weeks special rewards' star wording. */
  currentFull: number;
  /** Every special reward's progress as of the week showing (empty without a record). */
  standings: AwardStanding[];
}

const rows = computed<KidRow[]>(() =>
  kids.value.map((member) => {
    const byWeek = new Map(props.weeks.map((ws) => [ws, starStore.weekFor(member.id, ws)]));
    const week = shown.value ? (byWeek.get(shown.value) ?? null) : null;
    return {
      member,
      name: firstName(member.name),
      byWeek,
      week,
      currentFull: byWeek.get(props.weeks[0] ?? '')?.full ?? 0,
      standings: week ? starStore.awardsFor(member.id, week.weekStart) : [],
    };
  })
);

// ── The bonus entries of the week showing, per kid ──────────────────────────

const nameOf = (id: string) => firstName(familyStore.members.find((m) => m.id === id)?.name);

/** One bonus or take-away as every list of them words it (`bonusLine`, `starText.ts`). */
const bonusLine = (gift: ChoreStarGift): BonusEntryLine => bonusLineOf(gift, nameOf, t);

/**
 * Each kid's bonus and take-away entries for the week showing, newest first, as the summary
 * lists them: exactly the breakdown's (`starStore.weekGiftsFor`, the one rule over that kid's
 * week). A kid with no record, no entry, or entries that do not add up to the week's net has
 * none here.
 */
const entriesByKid = computed(() => {
  const by = new Map<string, BonusEntryLine[]>();
  for (const r of rows.value) {
    if (!r.week) continue;
    const entries = starStore.weekGiftsFor(r.member.id, r.week);
    if (entries?.length) by.set(r.member.id, [...entries].reverse().map(bonusLine));
  }
  return by;
});

// ── The bonus summary: which kid's is open ──────────────────────────────────

const BONUS_ACTION = 'bonus';
const openBonus = ref<{ memberId: string; anchor: HTMLElement } | null>(null);
const openBonusRow = computed(() =>
  openBonus.value ? rows.value.find((r) => r.member.id === openBonus.value!.memberId) : undefined
);
const openBonusEntries = computed(() =>
  openBonus.value ? (entriesByKid.value.get(openBonus.value.memberId) ?? []) : []
);

async function onFactAction(payload: { memberId: string; id: string; anchor: HTMLElement }) {
  if (payload.id !== BONUS_ACTION) return;
  if (openBonus.value?.memberId === payload.memberId) {
    openBonus.value = null;
    return;
  }
  // Switching kids: let the first close (and hand focus back) before the next one opens.
  if (openBonus.value) {
    openBonus.value = null;
    await nextTick();
  }
  payload.anchor.focus({ preventScroll: true });
  openBonus.value = { memberId: payload.memberId, anchor: payload.anchor };
  logAction('bonus-summary');
}

function closeBonus(): void {
  openBonus.value = null;
}
// Another week's numbers: the summary open on this one has nothing to point at.
watch(shown, closeBonus);

// ── A week's breakdown (tap a bar in Stars by Week) ─────────────────────────

/** The bar whose breakdown is open: the kid, the week, and the bar it hangs from. */
const openWeekBar = ref<{ memberId: string; weekStart: string; anchor: HTMLElement } | null>(null);
const openWeekRow = computed(() =>
  openWeekBar.value
    ? rows.value.find((r) => r.member.id === openWeekBar.value!.memberId)
    : undefined
);

async function onBar(memberId: string, weekStart: string, event: MouseEvent): Promise<void> {
  const anchor = event.currentTarget as HTMLElement;
  const same =
    openWeekBar.value?.memberId === memberId && openWeekBar.value?.weekStart === weekStart;
  if (openWeekBar.value) {
    openWeekBar.value = null;
    await nextTick();
    if (same) return;
  }
  // Focus returns to what had it at open (Safari does not focus a tapped button).
  anchor.focus({ preventScroll: true });
  openWeekBar.value = { memberId, weekStart, anchor };
  logAction('week-breakdown');
}

function closeWeekBar(): void {
  openWeekBar.value = null;
}

/**
 * The open bar's lines: `weekBreakdown` (the one combining rule) over the kid's week as the bar
 * reads it, their gifts and that week's chore record; worded here. They add up to the bar.
 */
const weekLines = computed<WeekBreakdownLines | null>(() => {
  const open = openWeekBar.value;
  const row = openWeekRow.value;
  const week = open && row ? (row.byWeek.get(open.weekStart) ?? null) : null;
  if (!open || !week) return null;
  const record = choreStore.weekFor(open.memberId, open.weekStart, choreDayOfWeek(open.weekStart));
  // The week's own entries (`weekGiftsFor`); `null` (only the net is known) passes none, which
  // `weekBreakdown` reads the same way: one net line.
  const gifts = starStore.weekGiftsFor(open.memberId, week) ?? [];
  const b = weekBreakdown(week, gifts, record, todayYmd.value);
  const starsText = (n: number) =>
    plural(n, 'choreStars.report.trend.total.one', 'choreStars.report.trend.total.other');
  return {
    days: b.days.map((d) => ({
      ymd: d.ymd,
      label: dayShort(d.ymd),
      chores: !d.chores
        ? ''
        : d.chores.due === 0
          ? t('choreStars.report.weekPop.nothingDue')
          : fillTemplate(
              t(
                d.chores.due === 1
                  ? 'choreStars.report.weekPop.chores.one'
                  : 'choreStars.report.weekPop.chores.other'
              ),
              { done: d.chores.done, due: d.chores.due }
            ),
      stars: starsText(d.stars),
    })),
    entries: b.entries ? b.entries.map(bonusLine) : null,
    net: b.bonus === 0 && !b.entries ? '' : signed(b.bonus),
    netTake: b.bonus < 0,
    total: starsText(b.total),
    floored: b.floored,
  };
});
// The bar gone (another kid list, a week no longer offered): nothing to point at.
watch(weekLines, (lines) => {
  if (!lines && openWeekBar.value) closeWeekBar();
});

/**
 * Remove a bonus or take-away of the open week (the store refuses a closed one). The summary
 * closes first: the confirm is a modal over it, and a tap there would close it anyway.
 */
async function removeEntry(gift: ChoreStarGift): Promise<void> {
  const actorId = familyStore.currentMemberId;
  if (!actorId || !isOpenWeek.value) return;
  closeBonus();
  const ok = await confirm({
    title: 'choreStars.report.remove.title',
    message: 'choreStars.report.remove.message',
    variant: 'danger',
  });
  // null from the store: already toasted and logged.
  if (ok) await starStore.removeGift(gift.id, actorId);
}

// ── The board: Chores Done for that week, with the star facts ──────────────

/** The kids' chores done that week, by the week's own first day (as the Chores view's board). */
const boardRows = computed(() =>
  shown.value
    ? kids.value.map((member) => ({
        member,
        week: choreStore.weekFor(member.id, shown.value, choreDayOfWeek(shown.value)),
      }))
    : []
);

/** The weekly reward's column: while it is on, or when the week showing had one. */
const showWeekly = computed(
  () => rewards.value.weeklyOn || rows.value.some((r) => (r.week?.bar ?? 0) > 0)
);

/**
 * The Bonus column: the signed net, tappable only when the one rule yields entries for that
 * week (`entriesByKid`), so it never opens a list the net does not add up to.
 */
function bonusFact(r: KidRow, w: WeekStars): WeekPanelFact {
  const text = signed(w.bonus);
  const fact: WeekPanelFact = {
    text,
    tone: w.bonus > 0 ? 'good' : w.bonus === 0 ? 'quiet' : undefined,
    testid: 'star-report-bonus',
  };
  if (entriesByKid.value.has(r.member.id)) {
    fact.action = {
      id: BONUS_ACTION,
      label: fillTemplate(t('choreStars.report.bonusAria'), { name: r.name, net: text }),
      expanded: openBonus.value?.memberId === r.member.id,
    };
  }
  return fact;
}

const weeklyOf = (w: WeekStars) =>
  fillTemplate(t('choreStars.report.weeklyOf'), { total: w.total, bar: w.bar });

function weeklyFact(w: WeekStars): WeekPanelFact {
  const testid = 'star-report-weekly';
  if (w.bar <= 0) return { text: '', testid };
  return weeklyAchieved(w)
    ? { text: `✓ ${achievedOn(w.hitOn)}`, tone: 'done', sub: weeklyOf(w), testid }
    : { text: weeklyOf(w), testid };
}

const extras = computed<WeekPanelExtras>(() => ({
  heads: [
    t('choreStars.report.stars'),
    t('choreStars.report.bonus'),
    ...(showWeekly.value ? [`${rewardEmoji.value} ${reward.value}`] : []),
  ],
  rows: Object.fromEntries(
    rows.value.map((r) => [
      r.member.id,
      r.week
        ? [
            { text: String(r.week.stars), tone: 'strong', testid: 'star-report-stars' },
            bonusFact(r, r.week),
            ...(showWeekly.value ? [weeklyFact(r.week)] : []),
          ]
        : { note: t('choreStars.noRecord'), hint: t('choreStars.noRecordHint') },
    ])
  ),
}));

// ── Stars by Week ───────────────────────────────────────────────────────────

/** Every week offered, oldest first ("Now" last). */
const trendWeeks = computed(() => [...props.weeks].reverse());

/** "This week and the four before it": the number of weeks actually drawn. */
const TREND_SPAN: readonly UIStringKey[] = [
  'choreStars.report.trend.span.0',
  'choreStars.report.trend.span.1',
  'choreStars.report.trend.span.2',
  'choreStars.report.trend.span.3',
  'choreStars.report.trend.span.4',
];
const trendSpan = computed(() =>
  t(TREND_SPAN[Math.min(TREND_SPAN.length - 1, Math.max(0, trendWeeks.value.length - 1))]!)
);

const trend = computed(() =>
  rows.value.map((row) => {
    const bars = trendWeeks.value.map((ws) => {
      const week = row.byWeek.get(ws) ?? null;
      const open = ws === props.weeks[0];
      const label = open ? t('choreStars.report.now') : shortDate(ws);
      // Drawn as two parts ("Nov" over "9" in a narrow column, side by side in a wide one).
      const parts = open
        ? [label]
        : [
            formatUiDate(ws, currentLanguage.value, { month: 'short' }),
            formatUiDate(ws, currentLanguage.value, { day: 'numeric' }),
          ];
      return { ws, total: week ? week.total : null, open, label, parts };
    });
    const total = bars.reduce((n, b) => n + (b.total ?? 0), 0);
    // Each kid against their OWN weeks only: never scaled against a sibling.
    const max = Math.max(1, ...bars.map((b) => b.total ?? 0));
    return {
      row,
      total,
      totalText: plural(
        total,
        'choreStars.report.trend.total.one',
        'choreStars.report.trend.total.other'
      ),
      totalAria: plural(
        total,
        'choreStars.report.trend.totalAria.one',
        'choreStars.report.trend.totalAria.other',
        { name: row.name }
      ),
      bars: bars.map((b) => ({
        ...b,
        buttonAria:
          b.total === null
            ? ''
            : plural(
                b.total,
                'choreStars.report.trend.barAria.one',
                'choreStars.report.trend.barAria.other',
                { name: row.name, week: shortDate(b.ws) }
              ),
        height:
          b.total === null ? 0 : Math.max(b.total > 0 ? 6 : 2, Math.round((b.total / max) * 100)),
        aria:
          b.total === null
            ? fillTemplate(t('choreStars.report.trend.noRecordAria'), { week: b.label })
            : plural(
                b.total,
                'choreStars.report.trend.aria.one',
                'choreStars.report.trend.aria.other',
                { week: b.label }
              ),
      })),
    };
  })
);

// ── Special Rewards Progress ────────────────────────────────────────────────

/** The special reward drawer is the page's (ONE, shared with the Rewards view): ask for it. */
function openAward(award: ChoreAward | null): void {
  logAction(award ? 'edit-award' : 'add-award');
  emit('open-award', award);
}

function openRewards(): void {
  logAction('rewards-settings');
  emit('open-rewards');
}

/**
 * Each special reward's progress that week, both kinds, in the order they were made: a line per
 * kid it is for (`awardIsFor`) with a record. A This Week one is read against that week's own
 * full week; a Saved Up one against today's (`awardProgressLabel`'s rule for a full-weeks
 * price). `forKids`: who it is for when that is not every kid (the title row shows them).
 */
const specialProgress = computed(() =>
  starStore.sortedAwards.map((award) => ({
    award,
    forKids: awardForKids(award, kids.value, t),
    lines: rows.value
      .filter((r) => r.week && awardIsFor(award, r.member.id))
      .map((r) => {
        const progress = r.standings.find((s) => s.award.id === award.id)?.progress;
        const notYet = !progress || shown.value < award.weekStart;
        const full = award.kind === 'week' ? (r.week?.full ?? r.currentFull) : r.currentFull;
        const label = progress ? awardProgressLabel(award, progress, full, t) : '';
        return {
          member: r.member,
          name: r.name,
          notYet,
          label,
          percent: progress ? Math.round(progress.fraction * 100) : 0,
          achieved: progress?.achievedOn ? achievedOn(progress.achievedOn) : null,
          aria: fillTemplate(t('choreStars.report.savedAria'), {
            name: r.name,
            reward: award.title,
            progress: label,
          }),
        };
      }),
  }))
);

const cardClass =
  'dark:bg-surface-raised dark:border-line rounded-3xl bg-white p-4 shadow-[var(--card-shadow)] dark:border';
const achievedTag =
  'dark:text-success-lift inline-flex items-center gap-1 rounded-full bg-[var(--tint-success-10)] px-2 py-0.5 text-xs font-bold whitespace-nowrap text-green-700';
const rowButtonClass =
  'dark:hover:bg-surface-hover focus-visible:ring-sky-silk-300 w-full text-left hover:bg-[var(--tint-slate-10)] focus-visible:ring-2 focus-visible:outline-none';
const chevronClass = 'dark:text-ink-faint text-secondary-400 flex-none text-lg leading-none';
const barButtonClass =
  'dark:hover:bg-surface-hover focus-visible:ring-sky-silk-300 -mx-0.5 cursor-pointer rounded-lg px-0.5 hover:bg-[var(--tint-slate-10)] focus-visible:ring-2 focus-visible:outline-none';
const barExpanded = (memberId: string, ws: string) =>
  openWeekBar.value?.memberId === memberId && openWeekBar.value?.weekStart === ws
    ? 'true'
    : 'false';
</script>

<template>
  <div class="flex flex-col gap-4 max-md:pb-20" data-testid="star-report-view" :data-week="shown">
    <!-- Under 768px the bottom padding lets the last card scroll clear of the quick-add button. -->
    <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-bold">
      {{ t('choreStars.view.report') }}
    </h2>

    <p
      v-if="!kids.length"
      :class="cardClass"
      class="text-secondary-500 dark:text-ink-soft text-sm"
      data-testid="star-report-no-kids"
    >
      {{ t('choreStars.worth.noKids') }}
    </p>

    <template v-else>
      <!-- The Chores Done board for that week, its stepper, and the star facts per kid. -->
      <ChoreWeekPanel
        :rows="boardRows"
        :today-ymd="todayYmd"
        :weeks="weeks"
        :week="shown"
        :extras="extras"
        @update:week="emit('update:week', $event)"
        @fact-action="onFactAction"
      />

      <div class="report-lower grid grid-cols-1 items-start gap-4">
        <!-- Stars by Week: each kid a well, against their own weeks. -->
        <section
          :class="cardClass"
          class="trend-card flex flex-col gap-3"
          data-testid="star-report-trend"
        >
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 class="font-outfit text-secondary-500 dark:text-ink flex-1 text-base font-bold">
              {{ t('choreStars.report.trend.title') }}
            </h3>
            <span
              class="text-secondary-400 dark:text-ink-faint text-xs"
              data-testid="star-report-trend-span"
              >{{ trendSpan }}</span
            >
          </div>
          <div class="trend-grid grid gap-3">
            <div
              v-for="kid in trend"
              :key="kid.row.member.id"
              class="trend-kid dark:bg-surface-overlay flex min-w-0 flex-col gap-2 rounded-2xl bg-[var(--tint-slate-5)] p-3"
              data-testid="star-report-trend-kid"
              :data-member-id="kid.row.member.id"
            >
              <!-- The kid's name with their total directly under it: one unit. -->
              <div class="flex min-w-0 items-center gap-2" data-testid="star-report-trend-head">
                <BeanieAvatar
                  class="flex-none"
                  v-bind="memberAvatarBindings(kid.row.member)"
                  size="sm"
                />
                <div class="min-w-0">
                  <span
                    class="font-outfit text-secondary-500 dark:text-ink block truncate text-sm leading-tight font-semibold"
                    data-testid="star-report-trend-name"
                    >{{ kid.row.name }}</span
                  >
                  <span
                    class="font-outfit text-primary-700 dark:text-accent-lift block text-sm leading-tight font-extrabold whitespace-nowrap tabular-nums"
                    :aria-label="kid.totalAria"
                    data-testid="star-report-trend-total"
                    :data-total="kid.total"
                    >{{ kid.totalText }}</span
                  >
                </div>
              </div>
              <div class="trend-bars flex items-end gap-2">
                <!-- A week with a number is a button (its breakdown); a gap is a picture. -->
                <component
                  :is="bar.total === null ? 'div' : 'button'"
                  v-for="bar in kid.bars"
                  :key="bar.ws"
                  :type="bar.total === null ? undefined : 'button'"
                  class="trend-col flex min-w-0 flex-1 flex-col items-center gap-1"
                  :class="bar.total === null ? '' : barButtonClass"
                  :role="bar.total === null ? 'img' : undefined"
                  :aria-label="bar.total === null ? bar.aria : bar.buttonAria"
                  :aria-haspopup="bar.total === null ? undefined : 'dialog'"
                  :aria-expanded="
                    bar.total === null ? undefined : barExpanded(kid.row.member.id, bar.ws)
                  "
                  data-testid="star-report-bar"
                  :data-week="bar.ws"
                  :data-total="bar.total === null ? 'none' : bar.total"
                  :data-open="bar.open ? 'true' : undefined"
                  @click="bar.total !== null && onBar(kid.row.member.id, bar.ws, $event)"
                >
                  <!-- The bar area is one fixed height, so every week's label lines up. -->
                  <span
                    class="trend-area flex w-full flex-col items-center justify-end gap-1"
                    aria-hidden="true"
                  >
                    <b class="font-outfit text-secondary-500 dark:text-ink text-xs font-bold">{{
                      bar.total === null ? '' : bar.total
                    }}</b>
                    <i v-if="bar.total === null" class="trend-gap block h-6 w-full rounded-md" />
                    <i
                      v-else
                      class="trend-bar from-primary-500 to-terracotta-400 block w-full rounded-md bg-gradient-to-t"
                      :class="{ 'trend-open': bar.open }"
                      :style="{ '--bar': bar.height / 100 }"
                    />
                  </span>
                  <span
                    class="trend-label text-secondary-400 dark:text-ink-faint text-center text-xs leading-tight whitespace-nowrap"
                    aria-hidden="true"
                    ><template v-for="(part, i) in bar.parts" :key="i"
                      ><span v-if="i" class="trend-label-gap">{{ ' ' }}</span
                      ><span class="trend-label-part">{{ part }}</span></template
                    ></span
                  >
                </component>
              </div>
            </div>
          </div>
          <p class="text-secondary-400 dark:text-ink-faint text-xs">
            {{ t('choreStars.report.trend.foot') }}
          </p>
        </section>

        <!-- Special Rewards Progress: each special reward as of that week; its row opens the
             drawer, then one line per kid with a record, a bar and the count, or Achieved. -->
        <section :class="cardClass" class="flex flex-col gap-2" data-testid="star-report-entries">
          <div class="flex flex-wrap items-center gap-2">
            <!-- Never wraps: the two actions go under the title, together, before it would. -->
            <h3
              class="font-outfit text-secondary-500 dark:text-ink flex-1 text-base font-bold whitespace-nowrap"
            >
              {{ t('choreStars.report.entries.title') }}
            </h3>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="font-outfit dark:bg-surface-overlay dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 rounded-2xl border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
                data-testid="star-report-rewards-settings"
                @click="openRewards"
              >
                {{ t('choreStars.report.rewardsSettings') }}
              </button>
              <button
                type="button"
                class="font-outfit from-primary-500 to-terracotta-400 focus-visible:ring-sky-silk-300 inline-flex items-center gap-1 rounded-2xl bg-gradient-to-r px-3 py-1.5 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none"
                data-testid="star-report-add-award"
                @click="openAward(null)"
              >
                <span aria-hidden="true">+</span> {{ t('choreStars.awards.add') }}
              </button>
            </div>
          </div>
          <p
            v-if="!specialProgress.length"
            class="text-secondary-500 dark:text-ink-soft text-sm"
            data-testid="star-report-entries-empty"
          >
            {{ t('choreStars.report.entries.empty') }}
          </p>

          <div
            v-for="group in specialProgress"
            :key="group.award.id"
            class="dark:border-line mt-1 flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3"
            data-testid="star-report-saved"
            :data-award-id="group.award.id"
            :data-kind="group.award.kind"
          >
            <button
              type="button"
              class="font-outfit text-secondary-500 dark:text-ink -mx-1.5 flex items-center gap-1.5 rounded-xl px-1.5 py-1 text-sm font-semibold"
              :class="rowButtonClass"
              :aria-label="
                fillTemplate(t('choreStars.awards.editAria'), { title: group.award.title })
              "
              data-testid="star-report-saved-edit"
              :data-award-id="group.award.id"
              @click="openAward(group.award)"
            >
              <span aria-hidden="true">{{ group.award.emoji }}</span>
              <span class="min-w-0 flex-1 truncate">{{ group.award.title }}</span>
              <span
                v-if="group.forKids"
                class="flex flex-none items-center -space-x-1"
                :title="group.forKids.label"
                data-testid="star-report-saved-for"
                :data-count="group.forKids.members.length"
              >
                <span class="sr-only">{{ group.forKids.label }}</span>
                <BeanieAvatar
                  v-for="m in group.forKids.members"
                  :key="m.id"
                  v-bind="memberAvatarBindings(m)"
                  size="xs"
                  aria-hidden="true"
                />
                <span
                  v-if="!group.forKids.members.length"
                  class="text-secondary-400 dark:text-ink-faint text-xs font-normal"
                  aria-hidden="true"
                  >{{ group.forKids.label }}</span
                >
              </span>
              <span
                class="text-secondary-500 dark:bg-surface-overlay dark:text-ink-soft flex-none rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-xs font-semibold"
                data-testid="star-report-saved-kind"
                >{{
                  t(
                    group.award.kind === 'week'
                      ? 'choreStars.awards.kind.week'
                      : 'choreStars.awards.kind.saved'
                  )
                }}</span
              >
              <span :class="chevronClass" aria-hidden="true">›</span>
            </button>
            <div
              v-for="line in group.lines"
              :key="line.member.id"
              class="text-secondary-500 dark:text-ink grid grid-cols-[auto_minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-x-2 text-sm"
              data-testid="star-report-award"
              :data-award-id="group.award.id"
              :data-member-id="line.member.id"
              :data-state="line.notYet ? 'not-yet' : line.achieved ? 'achieved' : 'progress'"
            >
              <BeanieAvatar v-bind="memberAvatarBindings(line.member)" size="xs" />
              <span class="font-outfit truncate font-semibold">{{ line.name }}</span>
              <span v-if="line.notYet" class="text-secondary-400 dark:text-ink-faint text-xs">{{
                t('choreStars.report.notYet')
              }}</span>
              <span v-else-if="line.achieved" class="flex min-w-0 items-center">
                <span :class="achievedTag" data-testid="star-report-award-achieved"
                  >✓ {{ line.achieved }}</span
                >
              </span>
              <AwardProgressCell
                v-else
                :label="line.label"
                :percent="line.percent"
                :aria="line.aria"
                fill-testid="star-report-award-bar"
              />
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Mounted always, never `v-if`-gated: the summary's shell handles its own enter and
         leave. The special reward drawer is the page's (`open-award`). -->
    <StarBonusPopover
      :open="!!openBonus"
      :member="openBonusRow?.member ?? null"
      :name="openBonusRow?.name ?? ''"
      :week-label="shown ? shortDate(shown) : ''"
      :entries="openBonusEntries"
      :removable="isOpenWeek"
      :anchor="openBonus?.anchor ?? null"
      @close="closeBonus"
      @remove="removeEntry"
    />
    <StarWeekPopover
      :open="!!openWeekBar"
      :member="openWeekRow?.member ?? null"
      :name="openWeekRow?.name ?? ''"
      :week-label="openWeekBar ? shortDate(openWeekBar.weekStart) : ''"
      :lines="weekLines"
      :anchor="openWeekBar?.anchor ?? null"
      @close="closeWeekBar"
    />
  </div>
</template>

<style scoped>
/* Layout, and two marks built from tints that carry their own dark values. */
@media (width >= 64rem) {
  .report-lower {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  }
}

/* Stars by Week: a column per kid across the card, stacked when the card is narrow. */
.trend-card {
  container: star-trend / inline-size;
}

.trend-grid {
  grid-template-columns: minmax(0, 1fr);
}

@container star-trend (width >= 26rem) {
  .trend-grid {
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    grid-template-columns: none;
  }
}

/* The bars stretch to the kid's column up to a cap; past it the group is centred. */
.trend-bars {
  justify-content: center;
}

.trend-col {
  max-width: 3.5rem;
}

/* A week's label: "Nov 9" on one line in a wide column; in a narrow one (three or four kids
   side by side) the month over the day, so nothing is cut off. */
.trend-kid {
  container: star-kid / inline-size;
}

@container star-kid (width < 15rem) {
  .trend-label-part {
    display: block;
  }

  .trend-label-gap {
    display: none;
  }
}

/* Geometry only: the bar area is one height, and a bar is its share of the tallest (6rem). */
.trend-area {
  height: 7.5rem;
}

.trend-bar {
  height: calc(6rem * var(--bar));
}

/* The open week: the gradient bar striped (the stripe colour reads on both themes' bars). */
.trend-open {
  background-image:
    repeating-linear-gradient(180deg, rgb(255 255 255 / 0%) 0 4px, rgb(255 255 255 / 45%) 4px 6px),
    linear-gradient(to top, var(--color-primary-500), var(--color-terracotta-400));
}

/* A week with no record: a dashed gap, never a zero-height bar. */
.trend-gap {
  background: var(--tint-slate-5);
  border: 1.5px dashed var(--color-border-strong);
}

html.dark .trend-gap {
  border-color: var(--color-line-strong);
}
</style>
