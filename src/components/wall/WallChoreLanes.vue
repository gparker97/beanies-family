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
 *   - done:  a compact `CelebrationBanner` strip with one star per chore. Its action reopens
 *            the chores, so a mis-tick of the last one can be undone at the wall;
 *   - open:  the block happening now and Anytime: a colour header (the Heritage Orange ring and
 *            "Now" tag on the current block) over its rows;
 *   - quiet: a later block (or one whose window has passed) is one line in its colour with a
 *            count. Tapping it opens the rows.
 * No star row: stars appear only on the done strip (plan §5). The celebration is the store's
 * (once per bean, block and day); a tick carries its anchor (this lane's block and the tick),
 * the block keeps its rows while the stars burst (`choreBlockHeld`), and the done strip takes
 * its celebrating form while the beanies' move plays on it (`choreBannerCelebration`). The lane
 * is the celebration's clip (`data-celebration-clip`), so nothing crosses into a sibling's lane.
 *
 * Editing is one thing only: while unlocked, each lane has an add row that adds a chore for
 * that bean in the block happening now (`WALL_EDIT.addChore`, bound by the page to the grown-up
 * who unlocked). Chore rows are `locked`, so they offer no rename or remove.
 *
 * Dark mode: the lane and its header are the bean's colour mixed into `surface-raised` (scoped
 * `html.dark` partners below), open blocks sit on `surface-overlay`, block colours come from
 * `.chore-block-*` (whose tokens carry their dark values), and the done strip is the fixed
 * brand gradient with white ink in both themes.
 */
import { computed, inject, provide, ref } from 'vue';
import { choreBannerCelebration, choreBlockHeld } from '@/composables/useCelebration';
import WallBackButton from '@/components/wall/WallBackButton.vue';
import WallJobList from '@/components/wall/WallJobList.vue';
import WallAddRow from '@/components/wall/WallAddRow.vue';
import WallFaceButton from '@/components/wall/WallFaceButton.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import CelebrationBanner from '@/components/ui/CelebrationBanner.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
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
import type { ChoreBlock, FamilyMember } from '@/types/models';
import type { WallChoreBlock, WallChoreLane, WallJob, WallPeripheralData } from '@/types/wall';
import { choreTickAnchor, type ChoreCelebrationAnchor } from '@/utils/choreCelebration';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The page's bundle: `choreLaneFor` (present while the gate is on) and the person filter. */
  peripherals: WallPeripheralData;
  isPending: (job: WallJob) => boolean;
  backLabel: string;
}>();
const emit = defineEmits<{ toggle: [WallJob, ChoreCelebrationAnchor | null]; back: [] }>();

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
const { memberAvatarBindings } = useMemberAvatarBindings();

const members = computed(() => {
  const humans = familyStore.sortedHumans;
  if (!props.peripherals.visibleMemberIds) return humans;
  const allowed = new Set(props.peripherals.visibleMemberIds);
  return humans.filter((m) => allowed.has(m.id));
});

/**
 * Every visible bean, partitioned once per render: a lane when they have chores today (or the
 * wall is unlocked, so a grown-up can add their first), else the slim "no chores today" strip.
 * Every bean lands in exactly one of the two, as on the lists board.
 */
const partitioned = computed(() => {
  const active: { member: FamilyMember; lane: WallChoreLane }[] = [];
  const idle: FamilyMember[] = [];
  for (const member of members.value) {
    const lane = props.peripherals.choreLaneFor?.(member.id) ?? null;
    if (lane && (lane.total > 0 || canAdd.value)) active.push({ member, lane });
    else idle.push(member);
  }
  return { active, idle };
});

const progress = computed(() => choreProgress(partitioned.value.active.map((a) => a.lane)));
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

/** A tick, with this lane's block and the tick as the celebration's anchor (compact sizing). */
function onToggle(job: WallJob, memberId: string, block: ChoreBlock): void {
  const lane = root.value?.querySelector<HTMLElement>(
    `[data-testid="wall-chore-lane"][data-member="${CSS.escape(memberId)}"]`
  );
  const section = lane?.querySelector<HTMLElement>(
    `[data-testid="wall-chore-block"][data-block="${block}"]`
  );
  emit(
    'toggle',
    job,
    choreTickAnchor(section, `[data-job-key="${CSS.escape(job.key)}"] .wall-tick`, true)
  );
}

/** Blocks opened by hand (a quiet line, or a done strip reopened): `${memberId}:${block}`. */
const expanded = ref<Set<string>>(new Set());
const expandKey = (memberId: string, block: ChoreBlock) => `${memberId}:${block}`;
function isExpanded(memberId: string, block: ChoreBlock): boolean {
  return expanded.value.has(expandKey(memberId, block));
}
function toggleExpanded(memberId: string, block: ChoreBlock): void {
  const next = new Set(expanded.value);
  const key = expandKey(memberId, block);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
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
function expandLabel(memberId: string, b: WallChoreBlock): string {
  return fillTemplate(
    t(isExpanded(memberId, b.block) ? 'choreboard.block.collapse' : 'choreboard.block.expand'),
    { block: label(b.block) }
  );
}

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
      v-if="partitioned.active.length"
      class="wall-chore-lane-grid grid min-h-0 flex-1 justify-center justify-items-center gap-2.5"
      style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))"
      data-testid="wall-chore-lanes"
    >
      <section
        v-for="{ member, lane } in partitioned.active"
        :key="member.id"
        class="wall-chore-lane dark:border-line flex min-h-0 w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] shadow-[var(--card-shadow)] dark:border"
        :class="laneAllDone(lane) ? 'ring-[2.5px] ring-[#27AE60]' : ''"
        :style="{ '--bean': member.color }"
        data-testid="wall-chore-lane"
        :data-member="member.id"
        data-celebration-clip
      >
        <header
          class="wall-chore-lane-head flex shrink-0 items-center gap-2.5 px-3 py-2"
          data-testid="wall-chore-lane-header"
        >
          <WallFaceButton :name="member.name" source="face-chore" class="inline-flex shrink-0">
            <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="lg" />
          </WallFaceButton>
          <span class="min-w-0">
            <span
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

        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          <p
            v-if="laneClear(lane)"
            class="font-outfit dark:text-ink-soft py-1 text-center text-sm font-bold text-[var(--muted-text,#4d5d6c)]"
            data-testid="wall-chore-lane-clear"
          >
            {{ t('wall.chores.lane.clear') }}
          </p>

          <section
            v-for="b in lane.blocks"
            :key="b.block"
            class="flex flex-col gap-1"
            data-testid="wall-chore-block"
            :data-block="b.block"
            :data-state="blockState(b, member.id)"
            :data-now="b.isNow ? 'true' : 'false'"
          >
            <!-- Done: the strip with its stars, reopenable so a mis-tick can be undone. -->
            <template v-if="blockState(b, member.id) === 'done'">
              <CelebrationBanner
                compact
                :title="bannerText(b, member).title"
                :body="bannerText(b, member).body"
                :image-alt="t('choreboard.done.imageAlt')"
                :action-label="
                  t(
                    isExpanded(member.id, b.block)
                      ? 'choreboard.block.hideChores'
                      : 'choreboard.block.showChores'
                  )
                "
                :stars="b.total"
                :celebration="choreBannerCelebration(member.id, b.block)"
                data-testid="wall-chore-done-strip"
                @action="toggleExpanded(member.id, b.block)"
              />
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
          <div v-if="canAdd" class="mt-auto" data-testid="wall-chore-add">
            <WallAddRow
              :placeholder="t(ADD_PLACEHOLDER[timed(lane.current)])"
              :submit="(title: string) => addChore(member.id, title)"
            />
          </div>
        </div>
      </section>
    </div>

    <p
      v-if="!partitioned.active.length && !partitioned.idle.length"
      class="font-caveat dark:text-ink-soft m-auto text-[var(--muted-text)]"
      data-testid="wall-chores-empty"
    >
      {{ t('wall.jobs.none') }}
    </p>

    <!-- Beans with no chores today: one slim row, everyone still named. -->
    <div
      v-if="partitioned.idle.length"
      class="dark:bg-surface-raised flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] bg-white px-4 py-3 shadow-[var(--card-shadow)]"
      :class="partitioned.active.length ? 'shrink-0' : 'min-h-0 flex-1 justify-center'"
      data-testid="wall-chores-idle"
    >
      <p class="font-outfit text-secondary-500 dark:text-ink text-sm font-bold uppercase">
        {{ t('wall.jobs.allClear') }}
      </p>
      <WallFaceButton
        v-for="member in partitioned.idle"
        :key="member.id"
        :name="member.name"
        source="face-chore"
        class="flex shrink-0 items-center gap-1.5"
      >
        <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="sm" />
        <span
          class="font-inter wall-bean-count dark:text-ink-soft text-[var(--muted-text,#4d5d6c)]"
        >
          {{ member.name }}
        </span>
      </WallFaceButton>
    </div>
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
 * Rows share the grid's height instead of sizing to their content. An `auto` row grew to fit a
 * long lane and ran past the bottom of the grid, so a lane with six chores at 1280x800 had its
 * last row painted under the "No chores today" strip. Bounded, the lane's own body
 * (`overflow-y-auto`) scrolls, every row stays reachable, and the strip stays in view.
 */
.wall-chore-lane-grid {
  grid-auto-rows: minmax(0, 1fr);
}

.wall-chore-block-head,
.wall-chore-quiet {
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
