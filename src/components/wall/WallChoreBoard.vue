<script setup lang="ts">
/**
 * The Lists board: one card per list, after one card for the family's due to-dos.
 *
 * A PEER of the calendar, not a drawer. This is the reason a family hangs a
 * screen in the kitchen, so it gets the whole screen.
 *
 * ALL lists are treated equally. The board used to show only repeating lists in
 * the columns and park one-off lists in a thin strip along the bottom, which
 * made half of them easy to miss and drew a lifecycle distinction no family
 * thinks in — "leo's jobs" and "swim bag" are both Leo's list.
 *
 * ONE CARD PER LIST. The board then drew a column per bean and stacked that bean's lists in
 * it, so a second list started below the first, often off the bottom of the card, and was
 * missed. Each list now has its own card, its title the headline and its people under it. A
 * shared list is one card with everyone on it, placed under its first visible assignee, so a
 * bean's cards still sit together, in the family's order.
 *
 * TO-DOS ARE ONE FAMILY LIST, not one per bean. When anything is late or due today for the
 * beans on show, the first card is the family's to-dos (the Today card's selection,
 * `dueTodoJobs`), with a face on every row. It is absent when nothing is due; the to-do sheet
 * its head opens holds everything else.
 *
 * NOTHING IS HIDDEN. The column used to stop at seven rows and offer "+N more",
 * which opened the ALL-lists drawer rather than the list being read, while the
 * column body already scrolled. Every card body scrolls instead, uncapped.
 *
 * Lists whose owner is not a member the wall knows about get their own labelled
 * card instead of being dropped. That is rare (a deleted member, an unsynced
 * one), but a list nobody can find is worse than an odd-looking one.
 */
import { computed, inject } from 'vue';
import WallBackButton from '@/components/wall/WallBackButton.vue';
import WallBoardCard from '@/components/wall/WallBoardCard.vue';
import WallJobList from '@/components/wall/WallJobList.vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import { useWallLock } from '@/components/wall/wallLockKey';
import { WALL_EDIT } from '@/components/wall/wallEditKey';
import WallAddRow from '@/components/wall/WallAddRow.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { useListPeople } from '@/composables/useListPeople';
import { useWallTodoRows } from '@/composables/useWallTodoRows';
import { fillTemplate } from '@/utils/fillTemplate';
import { dueTodoJobs, jobsProgress, sortJobs, uniqueListGroups } from '@/utils/wallJobs';
import { isRecurring } from '@/utils/listLifecycle';
import type { WallJob, WallListGroup, WallPeripheralData, WallSheetTarget } from '@/types/wall';
import type { FamilyMember } from '@/types/models';

defineOptions({ inheritAttrs: false });

/** One list's card, every value the template reads already worked out. */
interface ListCard {
  group: WallListGroup;
  /** The first visible assignee's colour: the bean whose lane the card is placed in. */
  color: string;
  owners: FamilyMember[];
  names: string;
  recurring: boolean;
  tally: string;
  done: number;
  total: number;
  allDone: boolean;
}

/** A list nobody the wall knows owns. */
interface OrphanCard {
  group: WallListGroup;
  tally: string;
}

const props = defineProps<{
  /**
   * The job/list bundle, the same object the calendar views forward to their
   * shell. The board reads `listsFor`, `orphanLists`, `todosFor`, `unassignedTodos` and
   * `visibleMemberIds` from it: one shape for the wall's job data, rather than a second
   * spelling here.
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
const { peopleOf, namesOf } = useListPeople();
const { todoOwners, todoNote } = useWallTodoRows();

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

const tallyText = (progress: { done: number; total: number }) =>
  fillTemplate(t('wall.list.progress'), progress);

/**
 * Every list's card, computed once per render, not per call: the template reads each card
 * a dozen times (the ring, the tint, the faces, the names, the tally, the rows), on a screen
 * that re-renders every 20s, forever, on a tablet. It must not regress to calling functions
 * from the template.
 *
 * Groups with no jobs are dropped BEFORE the dedupe: a list every one of whose items is
 * deduped away in one bean's lane (they are all that bean's to-dos due today) would otherwise
 * render as a heading with nothing under it, or hide the same list's rows in another lane.
 *
 * `total === 0` is the ONLY definition of "nothing today", and such a list gets no card. A
 * FINISHED list is `done === total` with `total > 0`, keeps its card, and gets the green ring.
 */
const listCards = computed<ListCard[]>(() => {
  const laneOf = new Map<string, FamilyMember>();
  const groups: WallListGroup[] = [];
  for (const member of members.value) {
    for (const group of props.peripherals.listsFor(member.id)) {
      if (!group.jobs.length) continue;
      if (!laneOf.has(group.list.id)) laneOf.set(group.list.id, member);
      groups.push(group);
    }
  }
  return uniqueListGroups(groups).map((group) => {
    const progress = jobsProgress(group.jobs);
    return {
      group,
      color: laneOf.get(group.list.id)?.color ?? '',
      owners: peopleOf(group.list),
      names: namesOf(group.list),
      recurring: isRecurring(group.list),
      tally: tallyText(progress),
      ...progress,
      allDone: progress.total > 0 && progress.done === progress.total,
    };
  });
});

const orphanCards = computed<OrphanCard[]>(() =>
  props.peripherals.orphanLists.map((group) => ({
    group,
    tally: tallyText(jobsProgress(group.jobs)),
  }))
);

/**
 * The family's to-dos that are late or due today, for the beans on show, outstanding first.
 * A done one stays (struck through, last) until it leaves the due set, so a tick never makes
 * a row vanish under the finger.
 */
const todoJobs = computed(() =>
  sortJobs(
    dueTodoJobs(
      props.peripherals,
      members.value.map((m) => m.id)
    )
  )
);
const todoProgress = computed(() => jobsProgress(todoJobs.value));
const todoTally = computed(() => tallyText(todoProgress.value));
const todosAllDone = computed(
  () => todoProgress.value.total > 0 && todoProgress.value.done === todoProgress.value.total
);

/**
 * Is there a grid to draw at all?
 *
 * ⚠️ Orphan lists count. They live in the grid but are NOT a member, so a board
 * where every bean is clear but an unowned list exists must still render the
 * grid — otherwise that list vanishes, which is the exact failure the orphan
 * card was built to prevent. Due to-dos count too: they are a card of their own.
 */
const hasBoard = computed(
  () =>
    todoJobs.value.length > 0 ||
    listCards.value.length > 0 ||
    props.peripherals.orphanLists.length > 0
);

/**
 * What an empty board says. The page passes `boardTitle` exactly while this board shows lists
 * only (#146), and there "no chores" would be the wrong word: chores have their own board.
 */
const emptyText = computed(() =>
  props.boardTitle ? t('wall.lists.allClear') : t('wall.jobs.allClear')
);

/**
 * Lists only: the to-dos card is not counted, and orphans never were. Summed over the cards,
 * so a list shared by two beans counts once.
 */
const boardProgress = computed(() => {
  let done = 0;
  let total = 0;
  for (const card of listCards.value) {
    done += card.done;
    total += card.total;
  }
  return { done, total };
});
const percent = computed(() =>
  boardProgress.value.total
    ? Math.round((boardProgress.value.done / boardProgress.value.total) * 100)
    : 0
);
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
      like the obvious way to stop one list becoming a billboard, but
      auto-fit computes its repetition count from the track's MAX when that max
      is definite — so 420px HALVED the column count at every size: five columns
      became two at 1280px, three became one at 800px, and the surplus cards
      wrapped onto rows this grid had no room to show and no overflow to scroll.
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
      <!-- the family's due to-dos: first, and only while something is due -->
      <WallBoardCard
        v-if="todoJobs.length"
        key="todos"
        data-test="todos-card"
        class="wall-todos-card"
        emoji="✅"
        :title="t('wall.card.todos')"
        :subtitle="t('wall.todos.dueNow')"
        :tally="todoTally"
        :ring="todosAllDone ? 'done' : undefined"
        @open="emit('open', { kind: 'todos' })"
      >
        <WallJobList
          :jobs="todoJobs"
          :is-pending="isPending"
          :owners="todoOwners"
          :note="todoNote"
          owner-size="xs"
          @toggle="emit('toggle', $event)"
        />
      </WallBoardCard>

      <WallBoardCard
        v-for="card in listCards"
        :key="card.group.list.id"
        data-test="board-card"
        :emoji="card.group.list.emoji"
        :title="card.group.list.title"
        :subtitle="card.names"
        :tally="card.tally"
        :color="card.color"
        :ring="card.allDone ? 'done' : undefined"
        @open="emit('open', { kind: 'list', listId: card.group.list.id })"
      >
        <template v-if="card.recurring" #pill>
          <span
            class="font-outfit wall-pill text-primary-500 dark:text-accent-lift shrink-0 rounded-full bg-[var(--tint-orange-15)] px-1.5 font-extrabold"
          >
            {{ t('wall.list.repeats') }}
          </span>
        </template>
        <!-- The stack labels itself with the names, which follow as text: hidden here so a
             screen reader hears each name once. -->
        <template v-if="card.owners.length" #who>
          <span class="shrink-0" aria-hidden="true">
            <ActivityOwnerStack :members="card.owners" size="xs" />
          </span>
        </template>
        <WallJobList
          :jobs="card.group.jobs"
          :is-pending="isPending"
          hide-list-emoji
          @toggle="emit('toggle', $event)"
        />
        <!--
          Add straight to THIS list, rather than sending a child to the
          drawer to find it again. Only while the wall is unlocked.
        -->
        <WallAddRow
          v-if="canEdit && edit"
          :placeholder="t('wall.list.addItem')"
          :submit="(title: string) => edit!.addListItem(card.group.list.id, title)"
        />
      </WallBoardCard>

      <!-- lists whose owner the wall cannot resolve: labelled, not hidden, and nobody's to add to -->
      <WallBoardCard
        v-for="card in orphanCards"
        :key="card.group.list.id"
        data-test="orphan-card"
        :emoji="card.group.list.emoji"
        :title="card.group.list.title"
        :subtitle="t('wall.orphanLists')"
        :tally="card.tally"
        ring="neutral"
        display-only
      >
        <!-- a neutral disc where a list's faces would be -->
        <template #who>
          <span
            class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#95a5a6] text-xs text-white"
            aria-hidden="true"
            >📦</span
          >
        </template>
        <WallJobList
          :jobs="card.group.jobs"
          :is-pending="isPending"
          hide-list-emoji
          @toggle="emit('toggle', $event)"
        />
      </WallBoardCard>
    </div>

    <!--
      Nothing to draw: nothing is due and nobody has a list today (or there are no beans yet, as
      in the first frames before the family loads). One line that names what is empty, never a
      title over a blank board.
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
 * A SHORT wall puts every card on ONE row.
 *
 * `auto-fit minmax(210px, 1fr)` fits three cards across an 853px wall, so a
 * fourth wrapped to a second row and the grid's height split between them:
 * ~130px per card, which after the header left a clipped title and not one
 * visible row. One row gives every card the full height instead, and a board
 * too wide for the wall scrolls sideways, the same answer the footer
 * chips already use, and a far better one than showing nobody anything.
 */

/*
 * Both layouts make the grid a scroll box, which clips at its padding edge. The padding keeps
 * a finished card's ring (drawn 2.5px outside the card) and the card shadow inside it.
 */
.wall-chore-grid {
  /* The margin gives the width back, so the column count and the cards' left edge are
     what they were without the padding. */
  margin: -4px;
  padding: 4px;
}

@media (height <= 699px) {
  .wall-chore-grid {
    /* The floor lives on the cards (`min-width` below), so one card can ask for more: the
       to-dos card carries a face and a chip on every row, and at 11rem its titles broke
       mid-word. `auto`, not `min-content`: the cards clip their overflow, so `auto` resolves
       to their `min-width`, where `min-content` grew each track to its longest title. */
    grid-auto-columns: minmax(auto, 1fr);
    grid-auto-flow: column;
    grid-template-columns: none !important;

    /* Not centred: a centred row that overflows spills off BOTH edges, and the left spill
       cannot be scrolled to, which hid the first cards. The `1fr` tracks already fill the
       row when it fits. (An unlayered scoped rule beats the `justify-center` utility.) */
    justify-content: start;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .wall-chore-grid > * {
    min-width: 11rem;
  }

  .wall-chore-grid > .wall-todos-card {
    min-width: 15rem;
  }
}

/*
 * A TALL wall wraps cards onto rows, and the rows share the grid's height until each would
 * fall under 14rem; past that the board scrolls. With no row rule an `auto` row grew to its
 * longest list and ran off the bottom with nothing to scroll (the bug `WallChoreLanes` hit).
 *
 * `height > 699px`, the exact complement of the short rule: with `>= 700px` a fractional
 * viewport height (699.4px on a scaled tablet) matched neither and got no row rule at all.
 */
@media (height > 699px) {
  .wall-chore-grid {
    grid-auto-rows: minmax(14rem, 1fr);
    overflow-y: auto;
    scrollbar-width: none;
  }
}
</style>
