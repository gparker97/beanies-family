<script setup lang="ts">
/**
 * The chore board — every list, under the person whose list it is.
 *
 * A PEER of the calendar, not a drawer. This is the reason a family hangs a
 * screen in the kitchen, so it gets the whole screen.
 *
 * ALL lists are treated equally. The board used to show only repeating lists in
 * the columns and park one-off lists in a thin strip along the bottom, which
 * made half of them easy to miss and drew a lifecycle distinction no family
 * thinks in — "leo's jobs" and "swim bag" are both Leo's list. Each column now
 * stacks that bean's lists under their own titles.
 *
 * NOTHING IS HIDDEN. The column used to stop at seven rows and offer "+N more",
 * which opened the drawer — while the column body already scrolled, so the cap
 * was trimming a list that had somewhere to go. Worse, that button opened the
 * ALL-lists drawer rather than the list being read, so a child who tapped "+4
 * more" under Leo's swim bag landed in a grid of everybody's lists and lost
 * their place. The orphan column below has always rendered uncapped and simply
 * scrolled; the columns now do the same.
 *
 * Lists whose owner is not a member the wall knows about get their own labelled
 * block instead of being dropped. That is rare (a deleted member, an unsynced
 * one), but a list nobody can find is worse than an odd-looking one.
 */
import { computed, inject } from 'vue';
import WallBackButton from '@/components/wall/WallBackButton.vue';
import WallJobList from '@/components/wall/WallJobList.vue';
import WallFaceButton from '@/components/wall/WallFaceButton.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useWallLock } from '@/components/wall/wallLockKey';
import { WALL_EDIT } from '@/components/wall/wallEditKey';
import WallAddRow from '@/components/wall/WallAddRow.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { jobsProgress } from '@/utils/wallJobs';
import { isRecurring } from '@/utils/listLifecycle';
import type { WallJob, WallListGroup, WallPeripheralData, WallSheetTarget } from '@/types/wall';
import type { FamilyMember } from '@/types/models';

defineOptions({ inheritAttrs: false });

/** One bean's board column: their lists, whole, plus their tally. */
interface BoardColumn {
  groups: WallListGroup[];
  done: number;
  total: number;
}

const props = defineProps<{
  /**
   * The job/list bundle, the same object the calendar views forward to their
   * shell. The board reads `listsFor`, `orphanLists` and `visibleMemberIds` from
   * it — one shape for the wall's job data, rather than a second spelling here.
   */
  peripherals: WallPeripheralData;
  isPending: (job: WallJob) => boolean;
  backLabel: string;
  /**
   * The board's heading. Absent: "The chore board", as always. The page passes "Lists" while
   * the `choreboard` gate is on (#146), where this board shows lists and chores have their own.
   */
  boardTitle?: string;
}>();
const emit = defineEmits<{ toggle: [WallJob]; back: []; open: [WallSheetTarget] }>();

const familyStore = useFamilyStore();
const { t } = useTranslation();
const { canEdit } = useWallLock();

/**
 * The write channel. Optional: a board mounted without it renders read-plus-tick
 * rather than showing controls that would swallow every write.
 */
const edit = inject(WALL_EDIT, undefined);

const members = computed(() => {
  const humans = familyStore.sortedHumans;
  if (!props.peripherals.visibleMemberIds) return humans;
  const allowed = new Set(props.peripherals.visibleMemberIds);
  return humans.filter((m) => allowed.has(m.id));
});

/**
 * A column's lists, whole. Groups with no jobs are dropped: a list every one of
 * whose items is deduped away (they are all to-dos due today) would otherwise
 * render as a heading with nothing under it.
 */
function buildColumn(memberId: string): BoardColumn {
  const groups = props.peripherals.listsFor(memberId).filter((group) => group.jobs.length);
  // `jobsProgress` already supplies `total`; spelling it again just invited the
  // two to drift.
  return { groups, ...jobsProgress(groups.flatMap((g) => g.jobs)) };
}

/**
 * Computed once per render, not per call. The template asks about each column
 * ten times (the ring, the count, the lists, the overflow, the stars), and every
 * call re-flattened and re-counted that bean's lists from scratch — on a screen
 * that re-renders every 20s, forever, on a tablet. Same fix as the board this
 * replaced; it must not regress with the rewrite.
 */
const columnByMember = computed(() => {
  const map = new Map<string, ReturnType<typeof buildColumn>>();
  for (const member of members.value) map.set(member.id, buildColumn(member.id));
  return map;
});

/**
 * The beans with lists today, each with their column, computed once per render.
 *
 * The template reads `entry.column` and never calls a function: it asks about each column a
 * dozen times (the ring, the count, the lists, the stars), on a screen that re-renders every
 * 20s, forever, on a tablet.
 *
 * `total === 0` is the ONLY definition of "nothing today", and such a bean gets no column. They
 * used to be named on a strip under the board, which spent a row of a kitchen screen on an
 * absence; the footer's chips name every bean on every view, so nobody goes missing from the
 * wall without it. A bean who has FINISHED their jobs is `done === total` with `total > 0`,
 * keeps a full column, and keeps the green ring and the row of stars.
 */
const columns = computed(() => {
  const built: { member: FamilyMember; column: BoardColumn }[] = [];
  for (const member of members.value) {
    const column = columnByMember.value.get(member.id);
    if (column && column.total > 0) built.push({ member, column });
  }
  return built;
});

/**
 * Is there a grid to draw at all?
 *
 * ⚠️ Orphan lists count. They live in the grid but are NOT a member, so a board
 * where every bean is clear but an unowned list exists must still render the
 * grid — otherwise that list vanishes, which is the exact failure the orphan
 * column was built to prevent.
 */
const hasBoard = computed(
  () => columns.value.length > 0 || props.peripherals.orphanLists.length > 0
);

/**
 * What an empty board says. The page passes `boardTitle` exactly while this board shows lists
 * only (#146), and there "no chores" would be the wrong word: chores have their own board.
 */
const emptyText = computed(() =>
  props.boardTitle ? t('wall.lists.allClear') : t('wall.jobs.allClear')
);

const boardProgress = computed(() => {
  let done = 0;
  let total = 0;
  for (const column of columnByMember.value.values()) {
    done += column.done;
    total += column.total;
  }
  return { done, total };
});
const percent = computed(() =>
  boardProgress.value.total
    ? Math.round((boardProgress.value.done / boardProgress.value.total) * 100)
    : 0
);

const { memberAvatarBindings } = useMemberAvatarBindings();
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5">
    <div class="flex shrink-0 items-center gap-4">
      <WallBackButton :back-label="backLabel" @back="emit('back')" />
      <h2 class="font-outfit text-secondary-500 wall-board-title dark:text-ink font-extrabold">
        {{ boardTitle ?? t('wall.jobsBoard.title') }}
      </h2>
      <p
        v-if="boardProgress.total"
        class="font-inter wall-board-sum dark:text-ink-soft text-[var(--muted-text,#4d5d6c)]"
      >
        {{
          fillTemplate(t('wall.jobsBoard.progress'), {
            done: boardProgress.done,
            total: boardProgress.total,
          })
        }}
      </p>
      <span
        v-if="boardProgress.total"
        class="h-2.5 max-w-[340px] flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
      >
        <span
          class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r"
          :style="{ width: `${percent}%` }"
        />
      </span>
    </div>

    <!--
      ⚠️ The track max stays `1fr`. A definite max (`minmax(210px, 420px)`) looks
      like the obvious way to stop one bean's list becoming a billboard, but
      auto-fit computes its repetition count from the track's MAX when that max
      is definite — so 420px HALVED the column count at every size: five columns
      became two at 1280px, three became one at 800px, and the surplus beans
      wrapped onto rows this grid has no room to show and no overflow to scroll.
      jsdom has no layout engine, so no unit test here can catch it.

      The cap belongs on the CARD instead, inside a `1fr` track that still counts
      correctly. BOTH justifications are load-bearing and do different jobs:
      `justify-items` centres a capped card inside its own track (without it,
      `w-full` makes the box non-auto and it sits hard left), while
      `justify-content` keeps the group of tracks together rather than letting
      two capped cards drift to opposite edges of a 1920px wall.
    -->
    <div
      v-if="hasBoard"
      class="wall-chore-grid grid min-h-0 flex-1 justify-center justify-items-center gap-2.5"
      style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))"
    >
      <div
        v-for="{ member, column } in columns"
        :key="member.id"
        data-test="board-column"
        class="dark:bg-surface-raised flex min-h-0 w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)]"
        :class="column.total && column.done === column.total ? 'ring-[2.5px] ring-[#27AE60]' : ''"
      >
        <!--
          The column's bean header. Stacked by default; on a short wall it turns
          into a single row (see the scoped rule below), because at 533px of
          height this block was ~170px of the ~370px a column gets, which left
          room for exactly ONE chore.
        -->
        <div
          class="wall-chore-head dark:border-line flex flex-col items-center gap-1 border-b border-[rgba(44,62,80,0.06)] px-2.5 py-2 text-center"
          :style="{ background: `${member.color}2e` }"
        >
          <WallFaceButton :name="member.name" source="face-chore" class="inline-flex">
            <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="lg" />
          </WallFaceButton>
          <div>
            <p class="font-outfit text-secondary-500 wall-bean-name dark:text-ink font-bold">
              {{ member.name }}
            </p>
            <p class="font-inter wall-bean-count text-[var(--muted-text,#4d5d6c)]">
              {{ `${column.done} / ${column.total}` }}
            </p>
          </div>
        </div>

        <div
          class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2"
          :style="{ background: `${member.color}0d` }"
        >
          <div v-for="group in column.groups" :key="group.list.id">
            <button
              type="button"
              class="font-outfit wall-list-title mb-0.5 flex w-full items-center gap-1.5 text-left font-bold tracking-[0.06em] text-[var(--muted-text,#4d5d6c)] uppercase"
              @click="emit('open', { kind: 'list', listId: group.list.id })"
            >
              <span aria-hidden="true">{{ group.list.emoji }}</span>
              <span class="truncate">{{ group.list.title }}</span>
              <span
                v-if="isRecurring(group.list)"
                class="font-outfit wall-pill text-primary-500 rounded-full bg-[var(--tint-orange-15)] px-1.5 font-extrabold"
              >
                {{ t('wall.list.repeats') }}
              </span>
            </button>
            <WallJobList
              :jobs="group.jobs"
              :is-pending="isPending"
              @toggle="emit('toggle', $event)"
            />
            <!--
              Add straight to THIS list, rather than sending a child to the
              drawer to find it again. Only while the wall is unlocked.
            -->
            <WallAddRow
              v-if="canEdit && edit"
              :placeholder="t('wall.list.addItem')"
              :submit="(title: string) => edit!.addListItem(group.list.id, title)"
            />
          </div>
        </div>

        <p class="wall-stars shrink-0 px-3 pt-1 pb-3 tracking-[2px]" aria-hidden="true">
          <span v-for="n in column.done" :key="`s${n}`">⭐</span>
          <span v-for="n in column.total - column.done" :key="`d${n}`" class="text-[#d7dee5]"
            >·</span
          >
        </p>
      </div>

      <!-- lists whose owner the wall cannot resolve — labelled, not hidden -->
      <div
        v-if="peripherals.orphanLists.length"
        data-test="orphan-column"
        class="ring-dashed dark:bg-surface-raised dark:ring-line-strong flex min-h-0 w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)] ring-1 ring-[rgba(44,62,80,0.18)]"
      >
        <div
          class="dark:border-line flex flex-col items-center gap-1 border-b border-[rgba(44,62,80,0.06)] px-2.5 py-2 text-center"
        >
          <!-- a neutral disc, to match the initials the real columns now use -->
          <span
            class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#95a5a6] text-lg text-white"
            aria-hidden="true"
            >📦</span
          >
          <p class="font-outfit text-secondary-500 wall-bean-name dark:text-ink font-bold">
            {{ t('wall.orphanLists') }}
          </p>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
          <div v-for="group in peripherals.orphanLists" :key="group.list.id">
            <p
              class="font-outfit wall-list-title mb-0.5 flex items-center gap-1.5 font-bold tracking-[0.06em] text-[var(--muted-text,#4d5d6c)] uppercase"
            >
              <span aria-hidden="true">{{ group.list.emoji }}</span>
              <span class="truncate">{{ group.list.title }}</span>
            </p>
            <WallJobList
              :jobs="group.jobs"
              :is-pending="isPending"
              @toggle="emit('toggle', $event)"
            />
          </div>
        </div>
      </div>
    </div>

    <!--
      Nothing to draw: nobody has a list today (or there are no beans yet, as in the first
      frames before the family loads). One line that names what is empty, never a title over
      a blank board.
    -->
    <p
      v-else
      data-test="board-empty"
      class="font-caveat dark:text-ink-soft m-auto text-2xl text-[var(--muted-text)]"
    >
      {{ emptyText }}
    </p>
  </div>
</template>

<style scoped>
/*
 * ─── A short wall gets a one-row bean header ─────────────────────────────────
 *
 * The stacked avatar-over-name-over-count block is right on a mounted 10" wall
 * and wrong on an 8" one: at 533px of height it took ~170px of the ~370px each
 * column has, so a bean with 44 chores showed one of them.
 *
 * Laid out as a row it costs roughly a third of that, which is three or four
 * chores visible instead of one. Same information, same order, far less height.
 * `WallLanesView` already does exactly this for its own lanes through
 * `WallBeanHeader`'s `inline` mode; this is the same idea for the board.
 *
 * Keyed on HEIGHT, not on the tier or the orientation: the board's problem is
 * vertical, and a 961x601 landscape wall needs this as much as a 853x533 one.
 */

/*
 * A SHORT wall puts every column on ONE row.
 *
 * `auto-fit minmax(210px, 1fr)` fits three columns across an 853px wall, so a
 * fourth bean wrapped to a second row and the grid's height split between them:
 * ~130px per card, which after the header left a clipped list title and not one
 * visible chore. One row gives every column the full height instead, and a
 * family too wide for the wall scrolls sideways — the same answer the footer
 * chips already use, and a far better one than showing nobody anything.
 */

@media (height <= 699px) {
  .wall-chore-grid {
    grid-auto-columns: minmax(11rem, 1fr);
    grid-auto-flow: column;
    grid-template-columns: none !important;
    overflow-x: auto;
    scrollbar-width: none;
  }
}

/*
 * The one-row bean header applies on a NARROW wall as well as a short one. In
 * portrait the board gets two columns and two rows, so each card is ~300px, and
 * a ~170px stacked header still leaves room for barely one chore.
 */
@media (width <= 700px) {
  .wall-chore-head {
    flex-direction: row;
    gap: 0.5rem;
    justify-content: center;
    padding-bottom: 0.375rem;
    padding-top: 0.375rem;
    text-align: left;
  }

  /* The face's wrapper (`WallFaceButton`) and the avatar inside it, which is what has the
     size: capping only the wrapper would leave a 3rem face spilling out of a 2.25rem box. */
  .wall-chore-head > :first-child {
    flex-shrink: 0;
  }

  .wall-chore-head > :first-child :deep([data-testid='beanie-avatar']) {
    height: 2.25rem;
    width: 2.25rem;
  }
}

@media (height <= 699px) {
  .wall-chore-head {
    flex-direction: row;
    gap: 0.5rem;
    justify-content: center;
    padding-bottom: 0.375rem;
    padding-top: 0.375rem;
    text-align: left;
  }

  /* The avatar is the tall part, and its size is a prop, so it is capped here (inside its
     `WallFaceButton` wrapper, as above). */
  .wall-chore-head > :first-child {
    flex-shrink: 0;
  }

  .wall-chore-head > :first-child :deep([data-testid='beanie-avatar']) {
    height: 2.25rem;
    width: 2.25rem;
  }
}
</style>
