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
 * Beans with chores, and beans without — computed once, in one pass.
 *
 * ⚠️ Every bean lands in exactly one of the two. An earlier attempt excluded
 * beans who had outstanding to-dos from BOTH, on the reasoning that calling
 * them clear was a false claim — and that was true, but the cure was worse: it
 * created a third state nothing renders, so a family who keeps to-dos but has
 * never made a list saw a completely blank board, and any bean in that state
 * simply vanished from the wall, indistinguishable from having been removed
 * from the family.
 *
 * The false claim was in the WORD, not the partition. This board knows about
 * chores and nothing else, so it now says "no chores today" — true of the
 * column it is standing in — rather than "all clear", which is a claim about a
 * whole person that this screen has no standing to make.
 *
 * ⚠️ This also fixes a performance regression the old `columnFor()` helper
 * reintroduced at the call site: the template asked it for each member THIRTEEN
 * times per render (the ring, the count, the lists, the overflow, the total and
 * the stars), on a screen that re-renders every 20s forever, on a tablet. That
 * is the exact cost `columnByMember`'s docblock above exists to prevent. The
 * template now reads `entry.column` and never calls a function.
 *
 * `total === 0` is the ONLY definition of idle. A bean who has FINISHED their
 * jobs is `done === total` with `total > 0`, keeps a full column, and keeps the
 * green ring and the row of stars — that is the reward, and collapsing it would
 * punish the one bean who did everything asked.
 */
const partitioned = computed(() => {
  const active: { member: FamilyMember; column: ReturnType<typeof buildColumn> }[] = [];
  const idle: FamilyMember[] = [];
  for (const member of members.value) {
    // `members` and `columnByMember` are built from the same filtered list in the
    // same tick, so a miss is impossible today. `continue` rather than `!` so a
    // future edit that breaks that invariant drops one chip from a kitchen wall
    // instead of throwing the whole board away.
    const column = columnByMember.value.get(member.id);
    if (!column) {
      // Impossible today — both maps are built from the same list in the same
      // tick — but silently dropping a bean off a family's wall is exactly the
      // kind of failure that must not be quiet. Treated as having no chores, so
      // they stay visible and named.
      idle.push(member);
      continue;
    }
    if (column.total > 0) active.push({ member, column });
    else idle.push(member);
  }
  return { active, idle };
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
  () => partitioned.value.active.length > 0 || props.peripherals.orphanLists.length > 0
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
        {{ t('wall.jobsBoard.title') }}
      </h2>
      <p class="font-inter wall-board-sum text-[var(--muted-text,#4d5d6c)]">
        {{
          fillTemplate(t('wall.jobsBoard.progress'), {
            done: boardProgress.done,
            total: boardProgress.total,
          })
        }}
      </p>
      <span
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
      class="grid min-h-0 flex-1 justify-center justify-items-center gap-2.5"
      style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))"
    >
      <div
        v-for="{ member, column } in partitioned.active"
        :key="member.id"
        data-test="board-column"
        class="dark:bg-surface-raised flex min-h-0 w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)]"
        :class="column.total && column.done === column.total ? 'ring-[2.5px] ring-[#27AE60]' : ''"
      >
        <div
          class="dark:border-line flex flex-col items-center gap-1 border-b border-[rgba(44,62,80,0.06)] px-2.5 py-2 text-center"
          :style="{ background: `${member.color}2e` }"
        >
          <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="lg" />
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
      ⚠️ No beans at all. Reachable without anyone doing anything odd: the wall's
      person filter is never reconciled when the roster changes underneath a
      mounted wall, so a cross-device merge that removes a member — or re-tags a
      human as a pet — leaves `visibleMemberIds` pointing at nobody, with no
      filter chip lit to explain it. Without this the board rendered a title, a
      0 / 0 bar and an empty void.
    -->
    <p
      v-if="!hasBoard && !partitioned.idle.length"
      data-test="board-empty"
      class="font-caveat m-auto text-[var(--muted-text)]"
    >
      {{ t('wall.jobs.none') }}
    </p>

    <!--
      Beans with nothing on. A collapsed column would still cost a full track of
      visual weight while saying nothing, and a grey sliver per child every day
      reads as an absence on a family's kitchen wall. One row, everyone still
      named, and phrased as a state rather than a lack.

      When no bean has jobs this IS the board (`flex-1`), rather than a strip
      under an empty grid.
    -->
    <div
      v-if="partitioned.idle.length"
      data-test="idle-strip"
      class="dark:bg-surface-raised flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[22px] bg-white px-4 py-3 shadow-[var(--card-shadow)]"
      :class="hasBoard ? 'shrink-0' : 'min-h-0 flex-1 justify-center'"
    >
      <p class="font-outfit text-secondary-500 wall-list-title dark:text-ink font-bold uppercase">
        {{ t('wall.jobs.allClear') }}
      </p>
      <div
        v-for="member in partitioned.idle"
        :key="member.id"
        class="flex shrink-0 items-center gap-1.5"
      >
        <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="sm" />
        <span
          class="font-inter wall-bean-count dark:text-ink-soft text-[var(--muted-text,#4d5d6c)]"
        >
          {{ member.name }}
        </span>
      </div>
    </div>
  </div>
</template>
