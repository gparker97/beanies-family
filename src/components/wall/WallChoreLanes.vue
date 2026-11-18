<script setup lang="ts">
/**
 * The wall's chore lanes (#146): the choreboard on the kitchen screen. One lane per bean, the
 * block happening now first and open, ticks big enough for a finger on the run.
 *
 * A NEW wall view (`chores`), offered only while the `choreboard` gate is on. The lists board
 * (`WallChoreBoard`, the `jobs` view) is untouched and still reached from the Lists card.
 *
 * Nothing here decides "done", "now" or "missed": every lane is the store's ONE read model
 * (`beanChoreDay`, through `buildWallJobs`), so the wall, the app page, the briefing and the
 * widget cannot disagree. Rows are the existing `WallJobRow` / `WallJobList`, which own the
 * optimistic tick, the burst, the strike and the glide; `useWallJobs.toggle` owns the in-flight
 * guard, the crediting and the failure report. There is no wall twin of the chore row.
 *
 * Per lane, per block (in the lane's order: now, Anytime, later, past):
 *   - done:  one slim line in the block's own colour (its emoji, "Morning all done", a green
 *            tick and the star count), so morning, afternoon, evening and anytime are told
 *            apart at a glance and four finished blocks cost four lines, not four banners.
 *            Tapping it reopens the chores, so a mis-tick of the last one can be undone at the
 *            wall. The orange `CelebrationBanner` appears only for the celebration itself, then
 *            folds to the line. Finished blocks sink to the bottom of the lane (in day order),
 *            so what is left to do is always at the top; while anything is left, they are
 *            pinned to the lane's foot under a "Done" rule, apart from the still-to-do lines;
 *   - open:  the block happening now and Anytime: a colour header (the Heritage Orange ring and
 *            "Now" tag on the current block) over its rows;
 *   - quiet: a later block (or one whose window has passed) is one line in its colour with a
 *            count. Tapping it opens the rows.
 * No star row: stars appear only on the done strip (plan §5). The celebration is the store's
 * (once per bean, block and day); a tick carries its anchor (this lane's block and the tick),
 * the block keeps its rows while the stars burst (`choreBlockHeld`), and the done strip takes
 * its celebrating form while the beanies' move plays on it (`choreBannerCelebration`); a block
 * never moves while it is celebrating. The lane
 * is the celebration's clip (`data-celebration-clip`), so nothing crosses into a sibling's lane.
 *
 * Stars (#148), on a child's lane only and only while `lane.stars` is set (the bundle leaves it
 * out while stars are off, for a grown-up or a pet, and when there is nothing to draw): a thin
 * arc around the avatar (`StarRingAvatar`, drawn in the header's padding so the header's height
 * never changes), filling toward the weekly reward (or the nearest saved-up award), with the
 * reward's emoji as a badge and a star on top of the ring once the weekly goal is reached (#154);
 * and a quiet `StarCount` at the end of the name row, spoken as this week's stars or the stars
 * saved up (the arc's `kind`). The header is a size container, so the count drops out before the
 * name truncates on a narrow lane. With `lane.stars` absent the avatar is drawn alone. Every lane
 * drawn is a banner host for its bean (`useRewardBannerHost`) while nothing covers it (`covered`),
 * so the weekly reward's achieved banner is claimed while the lane can be seen, whoever ticked
 * the week past the bar; while `rewardBannerFor(member)` is set, the existing
 * `CelebrationBanner` (compact) plays once at the top of the lane body ("Ice Cream earned!"),
 * nothing to press, and the reward's picture bursts up over the lane with a shower of stars
 * (`RewardBurst`, not under reduced motion). The green all-done ring is untouched.
 *
 * The head (#154): every bean's avatar is a button that opens their stars sheet, through the
 * page's existing `open` (`{ kind: 'stars', memberId }`), whatever the scrapbook setting.
 *
 * Editing is one thing only: while unlocked, each lane has an add row that adds a chore for
 * that bean in the block happening now (`WALL_EDIT.addChore`, bound by the page to the grown-up
 * who unlocked). Chore rows are `locked`, so they offer no rename or remove.
 *
 * Dark mode: the lane and its header are the bean's colour mixed into `surface-raised` (scoped
 * `html.dark` partners below), open blocks sit on `surface-overlay`, block colours come from
 * `.chore-block-*` (whose tokens carry their dark values, so the done line switches with
 * them), the done line's tick is a fixed Success Green disc with white ink in both themes
 * (a filled mark, like a filled button), and the celebration banner is the fixed brand
 * gradient with white ink in both themes. The ring, badge and star are `StarRingAvatar`'s; the
 * burst is emoji only; the count is `StarCount`'s (terracotta glyph with its lift, `ink-soft`
 * number).
 */
import { computed, inject, nextTick, provide, ref } from 'vue';
import {
  choreBannerCelebration,
  choreBlockHeld,
  rewardBannerFor,
} from '@/composables/useCelebration';
import WallBackButton from '@/components/wall/WallBackButton.vue';
import WallJobList from '@/components/wall/WallJobList.vue';
import WallAddRow from '@/components/wall/WallAddRow.vue';
import CelebrationBanner from '@/components/ui/CelebrationBanner.vue';
import RewardBurst from '@/components/chores/RewardBurst.vue';
import StarCount from '@/components/chores/StarCount.vue';
import StarRingAvatar from '@/components/chores/StarRingAvatar.vue';
import { rewardBannerText } from '@/components/chores/starText';
import { useRewardBannerHost } from '@/composables/useRewardBannerHost';
import { useWallLock } from '@/components/wall/wallLockKey';
import { WALL_EDIT } from '@/components/wall/wallEditKey';
import { WALL_BURST } from '@/components/wall/wallBurstKey';
import { useFamilyStore } from '@/stores/familyStore';
import { useChoreStore } from '@/stores/choreStore';
import { useTranslation } from '@/composables/useTranslation';
import { CHORE_BLOCK_META, choreDoneBannerText } from '@/constants/choreBlocks';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatTime12 } from '@/utils/date';
import { choreProgress } from '@/utils/wallJobs';
import { wallChoreProgressText } from '@/components/wall/wallChoreText';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { CHORE_BLOCKS } from '@/utils/chores';
import type { ChoreBlock, FamilyMember } from '@/types/models';
import type {
  WallChoreBlock,
  WallChoreLane,
  WallJob,
  WallPeripheralData,
  WallSheetTarget,
} from '@/types/wall';
import { choreTickAnchor, type ChoreCelebrationAnchor } from '@/utils/choreCelebration';
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The page's bundle: `choreLaneFor` (present while the gate is on) and the person filter. */
  peripherals: WallPeripheralData;
  isPending: (job: WallJob) => boolean;
  backLabel: string;
  /**
   * Something covers the lanes (the night screen, an open sheet, the scrapbook viewer): they
   * stay mounted but cannot be seen, so they host no reward banner meanwhile.
   */
  covered?: boolean;
}>();
const emit = defineEmits<{
  toggle: [WallJob, ChoreCelebrationAnchor | null];
  back: [];
  /** A head: that bean's stars sheet (#154), through the page's existing `open`. */
  open: [WallSheetTarget];
}>();

type TimedBlock = Exclude<ChoreBlock, 'anytime'>;

const LANE_PROGRESS: Record<TimedBlock, UIStringKey> = {
  morning: 'wall.chores.lane.progress.morning',
  afternoon: 'wall.chores.lane.progress.afternoon',
  evening: 'wall.chores.lane.progress.evening',
};
const LANE_NOTHING: Record<TimedBlock, UIStringKey> = {
  morning: 'wall.chores.lane.nothing.morning',
  afternoon: 'wall.chores.lane.nothing.afternoon',
  evening: 'wall.chores.lane.nothing.evening',
};
const ADD_PLACEHOLDER: Record<TimedBlock, UIStringKey> = {
  morning: 'wall.chores.add.morning',
  afternoon: 'wall.chores.add.afternoon',
  evening: 'wall.chores.add.evening',
};

const familyStore = useFamilyStore();
const choreStore = useChoreStore();
const { t } = useTranslation();
const { canEdit } = useWallLock();
/** The write channel. A lane mounted without it (or without `addChore`) offers no add row. */
const edit = inject(WALL_EDIT, undefined);
const canAdd = computed(() => canEdit.value && !!edit?.addChore);

const members = computed(() => {
  const humans = familyStore.sortedHumans;
  if (!props.peripherals.visibleMemberIds) return humans;
  const allowed = new Set(props.peripherals.visibleMemberIds);
  return humans.filter((m) => allowed.has(m.id));
});

/**
 * The lanes, built once per render: a bean has one when they have chores today (or the wall is
 * unlocked, so a grown-up can add their first).
 *
 * A bean with no chores today gets nothing here. They used to be named on a "no chores today"
 * strip under the lanes, which spent a row of a kitchen screen on an absence; the footer's
 * chips name every bean on every view, so nobody goes missing from the wall without it. When
 * NO bean has a lane the board says so in one line (the empty state below).
 */
const lanes = computed(() => {
  const built: { member: FamilyMember; lane: WallChoreLane }[] = [];
  for (const member of members.value) {
    const lane = props.peripherals.choreLaneFor?.(member.id) ?? null;
    if (lane && (lane.total > 0 || canAdd.value)) built.push({ member, lane });
  }
  return built;
});

/**
 * Every lane drawn hosts its bean's achieved banner while it can be seen (the store ignores a
 * grown-up or a pet). Covered, it hosts none, so the once-only claim is never spent unseen; it
 * hosts again once uncovered, which re-triggers a claim still owed.
 */
useRewardBannerHost(() => (props.covered ? [] : lanes.value.map((l) => l.member.id)), 'wall');

const progress = computed(() => choreProgress(lanes.value.map((a) => a.lane)));
const progressText = computed(() => wallChoreProgressText(progress.value, t));
const percent = computed(() =>
  progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0
);

function timed(block: ChoreBlock): TimedBlock {
  return block === 'anytime' ? 'morning' : block;
}

function nowBlock(lane: WallChoreLane): WallChoreBlock | undefined {
  return lane.blocks.find((b) => b.block === lane.current);
}

/** "2 of 4 this morning", "Morning all done", or "Nothing this morning". */
function laneSubtitle(lane: WallChoreLane): string {
  const now = nowBlock(lane);
  const current = timed(lane.current);
  if (!now) return t(LANE_NOTHING[current]);
  if (now.allDone) {
    return fillTemplate(t('wall.chores.lane.allDone'), { block: label(now.block) });
  }
  return fillTemplate(t(LANE_PROGRESS[current]), { done: now.done, total: now.total });
}

/** A lane whose every chore today is done gets the green ring, as on the lists board. */
function laneAllDone(lane: WallChoreLane): boolean {
  return lane.total > 0 && lane.done === lane.total;
}

/** Nothing open to tick right now (no current block, no Anytime): say so, plainly. */
function laneClear(lane: WallChoreLane): boolean {
  return !lane.blocks.some((b) => b.isNow || b.block === 'anytime');
}

type BlockState = 'done' | 'open' | 'quiet';
function blockState(b: WallChoreBlock, memberId: string): BlockState {
  // The last tick just finished it: the rows stay a moment while the stars burst out.
  if (b.allDone && !choreBlockHeld(memberId, b.block)) return 'done';
  return b.isNow || b.block === 'anytime' || b.allDone ? 'open' : 'quiet';
}

const root = ref<HTMLElement | null>(null);

/**
 * The wall's routine tick burst ("One down!" and the beans), except on the tick that finishes a
 * block: there the celebration plays, and the burst under it was two effects at once.
 */
const pageBurst = inject(WALL_BURST, undefined);
provide(WALL_BURST, (x, y, job) => {
  // The store's own finishing-tick decision (counting this bean's ticks still in flight), asked
  // at the tap: the burst is optimistic, so it cannot wait for the write's answer.
  const choreId = job?.source === 'chore' && !job.done ? job.choreId : undefined;
  if (job && choreId && choreStore.tickWillCelebrate(job.ownerId, choreId)) return;
  pageBurst?.(x, y, job);
});

/** One bean's block section in this board, or nothing while it is not drawn. */
function blockSection(memberId: string, block: ChoreBlock): HTMLElement | null {
  const lane = root.value?.querySelector<HTMLElement>(
    `[data-testid="wall-chore-lane"][data-member="${CSS.escape(memberId)}"]`
  );
  return (
    lane?.querySelector<HTMLElement>(`[data-testid="wall-chore-block"][data-block="${block}"]`) ??
    null
  );
}

/** A tick, with this lane's block and the tick as the celebration's anchor (compact sizing). */
function onToggle(job: WallJob, memberId: string, block: ChoreBlock): void {
  emit(
    'toggle',
    job,
    choreTickAnchor(
      blockSection(memberId, block),
      `[data-job-key="${CSS.escape(job.key)}"] .wall-tick`,
      true
    )
  );
}

/**
 * A finished block that has stopped celebrating: it folds to its slim line and sinks to the
 * bottom. While the celebration still plays on it, it stays where the bean ticked it.
 */
function settledDone(b: WallChoreBlock, memberId: string): boolean {
  return blockState(b, memberId) === 'done' && !choreBannerCelebration(memberId, b.block);
}

/**
 * A lane's blocks as drawn: what is left to do first, in lane order (now, Anytime, later), then
 * the finished lines in the order of the day (`CHORE_BLOCKS`: morning, afternoon, evening,
 * Anytime). The lane order ranks by the clock, which says nothing useful about finished work
 * and read as a shuffle (Anytime, Morning, Afternoon under an open Evening).
 */
function laneBlocks(lane: WallChoreLane, memberId: string): WallChoreBlock[] {
  const settled = lane.blocks.filter((b) => settledDone(b, memberId));
  if (!settled.length) return lane.blocks;
  settled.sort((a, b) => CHORE_BLOCKS.indexOf(a.block) - CHORE_BLOCKS.indexOf(b.block));
  return [...lane.blocks.filter((b) => !settledDone(b, memberId)), ...settled];
}

/**
 * The first finished line of a lane that still has something left to do, or null. That block
 * carries the "Done" rule and the auto margin that pins the finished group to the lane's foot,
 * so finished and still-to-do read as two groups (both are one tinted line otherwise). A lane
 * with nothing left has one group, so it gets no rule and stays at the top.
 */
function doneStart(lane: WallChoreLane, memberId: string): ChoreBlock | null {
  const drawn = laneBlocks(lane, memberId);
  const first = drawn.findIndex((b) => settledDone(b, memberId));
  return first > 0 ? drawn[first]!.block : null;
}

/** Blocks opened by hand (a quiet line, or a done line reopened): `${memberId}:${block}`. */
const expanded = ref<Set<string>>(new Set());
const expandKey = (memberId: string, block: ChoreBlock) => `${memberId}:${block}`;
function isExpanded(memberId: string, block: ChoreBlock): boolean {
  return expanded.value.has(expandKey(memberId, block));
}
function toggleExpanded(memberId: string, block: ChoreBlock): void {
  const next = new Set(expanded.value);
  const key = expandKey(memberId, block);
  const opening = !next.has(key);
  if (opening) next.add(key);
  else next.delete(key);
  expanded.value = next;
  if (opening) void nextTick(() => revealBlock(memberId, block));
}

/** Breathing room under a block brought into view, so its last row is not flush to the edge. */
const REVEAL_MARGIN_PX = 8;

/**
 * Bring a block opened by hand into view inside its lane.
 *
 * The lane's body scrolls, and the last block of a lane (usually Evening) sits at its bottom
 * edge, so its rows opened BELOW the fold: the tap looked like it did nothing. Scrolls the lane
 * body only (never `scrollIntoView`, which also moves the wall's clipped ancestors), by just
 * enough to show the whole block, and never so far that the block's own header leaves the top.
 */
function revealBlock(memberId: string, block: ChoreBlock): void {
  const section = blockSection(memberId, block);
  const body = section?.parentElement;
  if (!section || !body) return;
  const sectionBox = section.getBoundingClientRect();
  const bodyBox = body.getBoundingClientRect();
  const below = sectionBox.bottom + REVEAL_MARGIN_PX - bodyBox.bottom;
  const room = sectionBox.top - bodyBox.top;
  const top = Math.min(below, room);
  if (top <= 0) return;
  body.scrollBy({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function label(block: ChoreBlock): string {
  return t(CHORE_BLOCK_META[block].labelKey);
}

/** A quiet line's detail: "from 5:00 PM" for a block still to come; nothing once it is past. */
function quietDetail(b: WallChoreBlock): string {
  if (b.ended || b.block === 'anytime') return '';
  return fillTemplate(t('choreboard.block.from'), {
    time: formatTime12(choreStore.starts[b.block]),
  });
}

/** "3 chores" for a block still to come; "2 of 4" for one whose window has passed. */
function quietCount(b: WallChoreBlock): string {
  if (b.ended) return fillTemplate(t('choreboard.block.count'), { done: b.done, total: b.total });
  return fillTemplate(
    t(b.total === 1 ? 'choreboard.block.chores.one' : 'choreboard.block.chores.other'),
    { count: b.total }
  );
}

function bannerText(b: WallChoreBlock, member: FamilyMember): { title: string; body: string } {
  return choreDoneBannerText(b.block, b.total, member.name, t);
}
/** "Morning all done. Show Morning chores": the done line says its state, then what a tap does. */
function doneLabel(memberId: string, b: WallChoreBlock): string {
  const done = fillTemplate(t('wall.chores.lane.allDone'), { block: label(b.block) });
  return `${done}. ${expandLabel(memberId, b)}`;
}
function expandLabel(memberId: string, b: WallChoreBlock): string {
  return fillTemplate(
    t(isExpanded(memberId, b.block) ? 'choreboard.block.collapse' : 'choreboard.block.expand'),
    { block: label(b.block) }
  );
}

/**
 * The reward banner's words per lane, while one is up: worked out ONCE per lane per render
 * (the template reads the map), never once per binding.
 */
const rewardBanners = computed(() => {
  const by = new Map<string, { title: string; body: string }>();
  for (const { member, lane } of lanes.value) {
    const banner = rewardBannerFor(member.id);
    if (banner) by.set(member.id, rewardBannerText(banner, lane.stars?.count ?? 0, t));
  }
  return by;
});

function addChore(memberId: string, title: string): Promise<boolean> {
  return edit?.addChore ? edit.addChore(memberId, title) : Promise.resolve(false);
}
</script>

<template>
  <div
    ref="root"
    class="wall-chore-lanes flex min-h-0 flex-1 flex-col gap-2.5"
    data-testid="wall-chores-view"
  >
    <div class="flex shrink-0 items-center gap-4">
      <WallBackButton :back-label="backLabel" @back="emit('back')" />
      <h2 class="font-outfit text-secondary-500 wall-board-title dark:text-ink font-extrabold">
        {{ t('nav.choreboard') }}
      </h2>
      <p
        v-if="progress.total"
        class="font-inter wall-board-sum dark:text-ink-soft text-[var(--muted-text,#4d5d6c)]"
        data-testid="wall-chores-progress"
      >
        {{ progressText }}
      </p>
      <span
        v-if="progress.total"
        class="h-2.5 max-w-[340px] flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
      >
        <span
          class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r"
          :style="{ width: `${percent}%` }"
        />
      </span>
    </div>

    <!-- The track max stays `1fr`: see `WallChoreBoard`, whose grid this mirrors. -->
    <div
      v-if="lanes.length"
      class="wall-chore-lane-grid grid min-h-0 flex-1 justify-center justify-items-center gap-2.5"
      style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))"
      data-testid="wall-chore-lanes"
    >
      <section
        v-for="{ member, lane } in lanes"
        :key="member.id"
        class="wall-chore-lane dark:border-line relative flex min-h-0 w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] shadow-[var(--card-shadow)] dark:border"
        :class="laneAllDone(lane) ? 'ring-[2.5px] ring-[#27AE60]' : ''"
        :style="{ '--bean': member.color }"
        data-testid="wall-chore-lane"
        :data-member="member.id"
        data-celebration-clip
      >
        <header
          class="wall-chore-lane-head flex shrink-0 items-center gap-2.5 px-3 py-2"
          :class="lane.stars ? 'has-stars' : ''"
          data-testid="wall-chore-lane-header"
        >
          <!-- The head opens this bean's stars (#154), a grown-up's or a pet's too (they get an
               explanation there). Always a button, whatever the scrapbook setting. -->
          <button
            type="button"
            class="inline-flex shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AED6F1]"
            :aria-label="fillTemplate(t('choreStars.wall.headAria'), { name: member.name })"
            aria-haspopup="dialog"
            data-testid="wall-chore-lane-head-button"
            @click="emit('open', { kind: 'stars', memberId: member.id })"
          >
            <StarRingAvatar
              :member="member"
              :arc="lane.stars"
              size="lane"
              fallback="initials"
              ring-testid="wall-chore-lane-ring"
              badge-testid="wall-chore-lane-badge"
            />
          </button>
          <span class="min-w-0" :class="lane.stars ? 'flex-1' : ''">
            <span v-if="lane.stars" class="flex min-w-0 items-center gap-2">
              <span
                class="font-outfit text-secondary-500 wall-bean-name dark:text-ink block min-w-0 flex-1 truncate font-bold"
              >
                {{ member.name }}
              </span>
              <StarCount
                class="wall-star-count"
                :count="lane.stars.count"
                :kind="lane.stars.kind"
                data-testid="wall-chore-lane-stars"
              />
            </span>
            <span
              v-else
              class="font-outfit text-secondary-500 wall-bean-name dark:text-ink block truncate font-bold"
            >
              {{ member.name }}
            </span>
            <span
              class="font-inter wall-bean-count dark:text-ink-soft block truncate text-[var(--muted-text,#4d5d6c)]"
              data-testid="wall-chore-lane-count"
            >
              {{ laneSubtitle(lane) }}
            </span>
          </span>
        </header>

        <!-- #154: the weekly reward's burst, over the whole lane (which clips it), once. -->
        <RewardBurst
          v-if="rewardBannerFor(member.id)"
          :key="rewardBannerFor(member.id)!.id"
          :banner="rewardBannerFor(member.id)!"
        />

        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          <!-- Stars (#148): the weekly reward's achieved moment, once, nothing to press. -->
          <CelebrationBanner
            v-if="rewardBanners.get(member.id)"
            compact
            class="flex-none"
            :title="rewardBanners.get(member.id)!.title"
            :body="rewardBanners.get(member.id)!.body"
            :image-alt="t('choreboard.done.imageAlt')"
            data-testid="wall-chore-reward-banner"
          />
          <p
            v-if="laneClear(lane)"
            class="font-outfit dark:text-ink-soft py-1 text-center text-sm font-bold text-[var(--muted-text,#4d5d6c)]"
            data-testid="wall-chore-lane-clear"
          >
            {{ t('wall.chores.lane.clear') }}
          </p>

          <section
            v-for="b in laneBlocks(lane, member.id)"
            :key="b.block"
            class="flex flex-col gap-1"
            :class="doneStart(lane, member.id) === b.block ? 'mt-auto' : ''"
            data-testid="wall-chore-block"
            :data-block="b.block"
            :data-state="blockState(b, member.id)"
            :data-now="b.isNow ? 'true' : 'false'"
          >
            <!-- Where the finished group starts: a hairline with its caption. The section's
                 auto margin opens the gap above it; on a full lane only the rule remains. -->
            <p
              v-if="doneStart(lane, member.id) === b.block"
              class="font-inter dark:text-ink-soft flex items-center gap-2 px-1 pt-1 text-xs font-semibold text-[var(--muted-text,#4d5d6c)]"
              data-testid="wall-chore-done-rule"
            >
              {{ t('wall.chores.lane.doneRule') }}
              <span class="dark:bg-line h-px flex-1 bg-[rgba(44,62,80,0.12)]" aria-hidden="true" />
            </p>

            <!-- Done. The banner is the celebration only; settled, the block is one slim line
                 in its own colour, reopenable so a mis-tick can be undone. -->
            <template v-if="blockState(b, member.id) === 'done'">
              <CelebrationBanner
                v-if="choreBannerCelebration(member.id, b.block)"
                compact
                :title="bannerText(b, member).title"
                :body="bannerText(b, member).body"
                :image-alt="t('choreboard.done.imageAlt')"
                :stars="b.total"
                :celebration="choreBannerCelebration(member.id, b.block)"
                data-testid="wall-chore-done-banner"
              />
              <button
                v-else
                type="button"
                class="font-outfit wall-chore-done flex w-full items-center gap-2 rounded-2xl bg-[var(--chore-tint)] px-3 py-2 text-left text-sm font-semibold text-[var(--chore-ink)]"
                :class="CHORE_BLOCK_META[b.block].colorClass"
                :aria-expanded="isExpanded(member.id, b.block) ? 'true' : 'false'"
                :aria-label="doneLabel(member.id, b)"
                data-testid="wall-chore-done-strip"
                @click="toggleExpanded(member.id, b.block)"
              >
                <span aria-hidden="true">{{ CHORE_BLOCK_META[b.block].emoji }}</span>
                <span class="min-w-0 flex-1 truncate">{{
                  fillTemplate(t('wall.chores.lane.allDone'), { block: label(b.block) })
                }}</span>
                <span
                  class="grid h-5 w-5 flex-none place-items-center rounded-full bg-[#27AE60] text-white"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none">
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <span class="font-inter text-xs font-medium whitespace-nowrap" aria-hidden="true"
                  >⭐ {{ b.total }}</span
                >
              </button>
            </template>

            <!-- Open: the block happening now (ringed, tagged) and Anytime. -->
            <div
              v-else-if="blockState(b, member.id) === 'open'"
              class="dark:bg-surface-overlay overflow-hidden rounded-2xl bg-white"
              :class="b.isNow ? 'ring-primary-500 ring-2' : ''"
            >
              <header
                class="font-outfit wall-chore-block-head flex items-center gap-2 bg-[var(--chore-tint)] px-3 py-1.5 font-bold text-[var(--chore-ink)]"
                :class="CHORE_BLOCK_META[b.block].colorClass"
              >
                <span aria-hidden="true">{{ CHORE_BLOCK_META[b.block].emoji }}</span>
                <span class="min-w-0 flex-1 truncate">{{ label(b.block) }}</span>
                <span class="font-inter text-xs font-medium whitespace-nowrap">{{
                  fillTemplate(t('choreboard.block.count'), { done: b.done, total: b.total })
                }}</span>
                <span
                  v-if="b.isNow"
                  class="from-primary-500 to-terracotta-400 rounded-full bg-gradient-to-br px-2 py-0.5 text-xs font-bold text-white"
                  data-testid="wall-chore-now-tag"
                  >{{ t('choreboard.now.tag') }}</span
                >
              </header>
              <div class="px-2" data-testid="wall-chore-rows">
                <WallJobList
                  :jobs="b.jobs"
                  :is-pending="isPending"
                  @toggle="onToggle($event, member.id, b.block)"
                />
              </div>
            </div>

            <!-- Quiet: one line in the block's colour; tap to see the chores. -->
            <button
              v-else
              type="button"
              class="font-outfit wall-chore-quiet flex w-full items-center gap-2 rounded-2xl bg-[var(--chore-tint)] px-3 py-2 text-left text-sm font-semibold text-[var(--chore-ink)]"
              :class="CHORE_BLOCK_META[b.block].colorClass"
              :aria-expanded="isExpanded(member.id, b.block) ? 'true' : 'false'"
              :aria-label="expandLabel(member.id, b)"
              data-testid="wall-chore-quiet"
              @click="toggleExpanded(member.id, b.block)"
            >
              <span aria-hidden="true">{{ CHORE_BLOCK_META[b.block].emoji }}</span>
              <span class="min-w-0 flex-1 truncate">
                {{ label(b.block) }}
                <span v-if="quietDetail(b)" class="font-inter text-xs font-medium">{{
                  quietDetail(b)
                }}</span>
              </span>
              <span class="font-inter text-xs font-medium whitespace-nowrap">{{
                quietCount(b)
              }}</span>
            </button>

            <!-- A quiet line or a done strip, opened by hand. -->
            <div
              v-if="blockState(b, member.id) !== 'open' && isExpanded(member.id, b.block)"
              class="dark:bg-surface-overlay rounded-2xl bg-white px-2"
              data-testid="wall-chore-rows"
            >
              <WallJobList
                :jobs="b.jobs"
                :is-pending="isPending"
                @toggle="onToggle($event, member.id, b.block)"
              />
            </div>
          </section>

          <!-- The wall's one chore edit: add for THIS bean, in the block happening now. -->
          <div
            v-if="canAdd"
            :class="doneStart(lane, member.id) ? '' : 'mt-auto'"
            data-testid="wall-chore-add"
          >
            <WallAddRow
              :placeholder="t(ADD_PLACEHOLDER[timed(lane.current)])"
              :submit="(title: string) => addChore(member.id, title)"
            />
          </div>
        </div>
      </section>
    </div>

    <!-- Nobody has a chore today: one line, and it says which board is empty. -->
    <p
      v-else
      class="font-caveat dark:text-ink-soft m-auto text-2xl text-[var(--muted-text)]"
      data-testid="wall-chores-empty"
    >
      {{ t('wall.jobs.allClear') }}
    </p>
  </div>
</template>

<style scoped>
/*
 * The lane and its header carry the bean's colour, mixed into the surface they sit on. A
 * scoped background outranks any `dark:bg-*` utility, so each has an explicit `html.dark`
 * partner mixing into `surface-raised` instead of white.
 */
.wall-chore-lane {
  background: color-mix(in srgb, var(--bean, transparent) 5%, white);
}

.wall-chore-lane-head {
  background: color-mix(in srgb, var(--bean, transparent) 18%, white);
}

html.dark .wall-chore-lane {
  background: color-mix(in srgb, var(--bean, transparent) 5%, var(--color-surface-raised));
}

html.dark .wall-chore-lane-head {
  background: color-mix(in srgb, var(--bean, transparent) 16%, var(--color-surface-raised));
}

/*
 * Stars (#148). The ring is `StarRingAvatar`'s, drawn AROUND the avatar's own footprint, so a
 * child's header with stars is the same height as without them and as a grown-up's, and the name
 * starts where it always did. The header is a size container while it carries stars, so the count
 * drops out below about 13.5rem, before the name has to truncate. Geometry only, nothing painted
 * here.
 */
.wall-chore-lane-head.has-stars {
  container-type: inline-size;
}

/* The query measures the header's content box (the lane less its 1.5rem of padding): 12rem here
   is a lane of about 13.5rem. */
@container (width < 12rem) {
  .wall-star-count {
    display: none;
  }
}

/*
 * Rows share the grid's height instead of sizing to their content. An `auto` row grew to fit a
 * long lane and ran past the bottom of the grid, so a lane with six chores at 1280x800 had its
 * last row painted below the board. Bounded, the lane's own body (`overflow-y-auto`) scrolls
 * and every row stays reachable.
 */
.wall-chore-lane-grid {
  grid-auto-rows: minmax(0, 1fr);
}

.wall-chore-block-head,
.wall-chore-quiet,
.wall-chore-done {
  font-size: 0.95rem;
  min-height: 2.75rem;
}

/*
 * Bigger ticks than the lists board: the mockup's thumb-sized target for a child on the run.
 * Three classes deep so it outranks the page's `.wall-root .wall-tick` scale.
 */
.wall-chore-lanes .wall-chore-lane :deep(.wall-tick) {
  height: 2.5rem;
  width: 2.5rem;
}

.wall-chore-lanes .wall-chore-lane :deep(.wall-tick-hit) {
  min-height: 3.25rem;
  min-width: 3.25rem;
}

/* A short wall puts every lane on ONE row and scrolls sideways (as the lists board does). */
@media (height <= 699px) {
  .wall-chore-lane-grid {
    grid-auto-columns: minmax(11rem, 1fr);
    grid-auto-flow: column;
    grid-template-columns: none !important;
    overflow-x: auto;
    scrollbar-width: none;
  }
}
</style>
