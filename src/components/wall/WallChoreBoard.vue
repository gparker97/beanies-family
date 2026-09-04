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
 * stacks that bean's lists under their own titles, and overflow opens the
 * drawer rather than being clipped.
 *
 * Lists whose owner is not a member the wall knows about get their own labelled
 * block instead of being dropped. That is rare (a deleted member, an unsynced
 * one), but a list nobody can find is worse than an odd-looking one.
 */
import { computed, inject } from 'vue';
import WallJobList from '@/components/wall/WallJobList.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { WALL_LOCK } from '@/components/wall/wallLockKey';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { jobsProgress } from '@/utils/wallJobs';
import { isRecurring } from '@/utils/listLifecycle';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

defineOptions({ inheritAttrs: false });

/** Rows a column can show before the rest moves into the drawer. */
const COLUMN_ROWS = 7;

const props = defineProps<{
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  isPending: (job: WallJob) => boolean;
  visibleMemberIds: string[] | null;
  backLabel: string;
}>();
const emit = defineEmits<{ toggle: [WallJob]; back: []; open: [WallSheetTarget] }>();

const familyStore = useFamilyStore();
const { t } = useTranslation();
const lock = inject(WALL_LOCK, undefined);

/**
 * When unlocked, every list on the board offers a way to add to it — including
 * the repeating chore lists, which previously had none: their titles were plain
 * text, so the only add affordance in the product sat on the one-off lists in
 * the drawer. The board is tight for space, so the "+" opens that list in the
 * drawer where the input lives rather than inlining a field per column.
 */
const canAdd = computed(() => lock?.isLocked.value === false);

const members = computed(() => {
  const humans = familyStore.sortedHumans;
  if (!props.visibleMemberIds) return humans;
  const allowed = new Set(props.visibleMemberIds);
  return humans.filter((m) => allowed.has(m.id));
});

/**
 * A column's lists, trimmed to what fits. Trimming happens across the WHOLE
 * column rather than per list, so one long shopping list cannot push every
 * other list of that bean's off the board.
 */
function buildColumn(memberId: string) {
  const groups = props.listsFor(memberId);
  const shown: WallListGroup[] = [];
  let rows = 0;
  let hidden = 0;
  for (const group of groups) {
    // A list every one of whose items is deduped away (they are all to-dos due
    // today) would otherwise render as a heading with nothing under it.
    if (!group.jobs.length) continue;

    // Charge for the title BEFORE allocating item rows. Adding it afterwards
    // let a column overrun its budget and then drop the next list wholesale for
    // being "full" of rows that had been added retroactively.
    const room = COLUMN_ROWS - rows - 1;
    if (room <= 0) {
      hidden += group.jobs.length;
      continue;
    }
    const jobs = group.jobs.slice(0, room);
    hidden += group.jobs.length - jobs.length;
    rows += jobs.length + 1;
    shown.push({ list: group.list, jobs });
  }
  // `jobsProgress` already supplies `total`; spelling it again just invited the
  // two to drift.
  const all = groups.flatMap((g) => g.jobs);
  return { shown, hidden, ...jobsProgress(all) };
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

function columnFor(memberId: string) {
  return columnByMember.value.get(memberId) ?? buildColumn(memberId);
}

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
      <button
        type="button"
        class="font-outfit text-secondary-500 wall-back dark:bg-surface-raised dark:text-ink shrink-0 rounded-2xl bg-white px-4 py-2.5 font-bold shadow-[var(--card-shadow)]"
        @click="emit('back')"
      >
        ‹ {{ fillTemplate(t('wall.jobsBoard.back'), { view: backLabel }) }}
      </button>
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

    <div
      class="grid min-h-0 flex-1 gap-2.5"
      style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr))"
    >
      <div
        v-for="member in members"
        :key="member.id"
        class="dark:bg-surface-raised flex min-h-0 flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)]"
        :class="
          columnFor(member.id).total && columnFor(member.id).done === columnFor(member.id).total
            ? 'ring-[2.5px] ring-[#27AE60]'
            : ''
        "
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
              {{
                columnFor(member.id).total
                  ? `${columnFor(member.id).done} / ${columnFor(member.id).total}`
                  : t('wall.jobs.none')
              }}
            </p>
          </div>
        </div>

        <div
          class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2"
          :style="{ background: `${member.color}0d` }"
        >
          <div v-for="group in columnFor(member.id).shown" :key="group.list.id">
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
              <span
                v-if="canAdd"
                class="font-outfit text-primary-500 ml-auto shrink-0 rounded-lg bg-[var(--tint-orange-15)] px-1.5 font-extrabold"
                :aria-label="t('wall.list.addItem')"
                >+</span
              >
            </button>
            <WallJobList
              :jobs="group.jobs"
              :is-pending="isPending"
              @toggle="emit('toggle', $event)"
            />
          </div>

          <button
            v-if="columnFor(member.id).hidden"
            type="button"
            class="font-outfit text-primary-500 wall-more shrink-0 rounded-xl bg-[var(--tint-orange-8)] px-2 py-1 font-bold"
            @click="emit('open', { kind: 'lists' })"
          >
            {{ fillTemplate(t('wall.card.more'), { count: columnFor(member.id).hidden }) }}
            <span aria-hidden="true">›</span>
          </button>

          <p
            v-if="!columnFor(member.id).total"
            class="font-caveat m-auto text-[var(--muted-text,#4d5d6c)] opacity-70"
          >
            {{ t('wall.jobs.none') }}
          </p>
        </div>

        <p
          v-if="columnFor(member.id).total"
          class="wall-stars shrink-0 px-3 pt-1 pb-3 tracking-[2px]"
          aria-hidden="true"
        >
          <span v-for="n in columnFor(member.id).done" :key="`s${n}`">⭐</span>
          <span
            v-for="n in columnFor(member.id).total - columnFor(member.id).done"
            :key="`d${n}`"
            class="text-[#d7dee5]"
            >·</span
          >
        </p>
      </div>

      <!-- lists whose owner the wall cannot resolve — labelled, not hidden -->
      <div
        v-if="orphanLists.length"
        class="ring-dashed dark:bg-surface-raised flex min-h-0 flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)] ring-1 ring-[rgba(44,62,80,0.18)]"
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
          <div v-for="group in orphanLists" :key="group.list.id">
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
  </div>
</template>
