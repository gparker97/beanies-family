<script setup lang="ts">
/**
 * The grown-ups' "Week so far" panel on the choreboard home (#146): one row per bean, plain
 * counts of chores done each day, today's column tinted, and the week's total. Counts include
 * chores since deleted (what was done stays done), straight from `weekCounts`.
 *
 * Dark mode: the panel is `surface-raised`, cells `surface-overlay`, counts `ink`, heads and
 * zeros `ink-faint`; today's column is the orange tint with `primary-700` / `accent-lift` ink.
 *
 * Phone width: a fixed layout that always fits its card (no minimum width, so all nine columns,
 * Saturday, Sunday and the total included, show at ~400px). On a phone the bean column is the
 * avatar alone (the name is kept for screen readers); from `sm` the first name shows beside it.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useTranslation } from '@/composables/useTranslation';
import { choreDayOfWeek, type ChoreWeekCounts } from '@/utils/chores';
import { firstName } from '@/utils/assignees';
import { CHORE_DAY_LABEL_KEYS } from '@/constants/choreBlocks';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  rows: { member: FamilyMember; week: ChoreWeekCounts }[];
  todayYmd: string;
}>();

const { t } = useTranslation();
const { memberAvatarBindings } = useMemberAvatarBindings();

/** The week's seven dates, from the first row (every row shares the family's week). */
const heads = computed(() =>
  (props.rows[0]?.week.days ?? []).map((d) => ({
    ymd: d.ymd,
    label: t(CHORE_DAY_LABEL_KEYS[choreDayOfWeek(d.ymd)] ?? 'planner.day.mon'),
  }))
);

function cellClass(ymd: string, count: number): string {
  if (ymd === props.todayYmd) {
    return 'bg-[var(--tint-orange-15)] text-primary-700 dark:text-accent-lift';
  }
  if (ymd > props.todayYmd || count === 0) {
    return 'dark:bg-surface-overlay bg-[var(--tint-slate-5)] dark:text-ink-faint text-secondary-400 font-medium';
  }
  return 'dark:bg-surface-overlay bg-[var(--tint-slate-5)] dark:text-ink text-secondary-500';
}
</script>

<template>
  <section
    class="dark:bg-surface-raised dark:border-line rounded-3xl bg-white p-4 shadow-[var(--card-shadow)] dark:border"
    data-testid="chore-week-panel"
  >
    <div class="mb-3 flex items-baseline gap-2">
      <h2 class="font-outfit dark:text-ink text-secondary-500 text-base font-bold">
        {{ t('choreboard.week.panelTitle') }}
      </h2>
      <span class="flex-1" />
      <span class="dark:text-ink-faint text-secondary-400 text-xs">{{
        t('choreboard.week.panelHint')
      }}</span>
    </div>
    <div>
      <table
        class="font-outfit w-full table-fixed border-separate border-spacing-0.5 text-xs sm:text-sm"
      >
        <colgroup>
          <col class="w-9 sm:w-28" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="sr-only">{{ t('choreboard.week.bean') }}</th>
            <th
              v-for="h in heads"
              :key="h.ymd"
              scope="col"
              class="py-1 text-xs font-semibold"
              :class="
                h.ymd === todayYmd
                  ? 'text-primary-700 dark:text-accent-lift'
                  : 'dark:text-ink-faint text-secondary-400'
              "
            >
              {{ h.label }}
            </th>
            <th
              scope="col"
              class="dark:text-ink-faint text-secondary-400 py-1 text-xs font-semibold"
            >
              <span aria-hidden="true">⭐</span>
              <span class="sr-only">{{ t('choreboard.week.total') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.member.id"
            data-testid="chore-week-panel-row"
            :data-member-id="row.member.id"
          >
            <th scope="row" class="py-1 pr-1 text-left font-semibold sm:pr-2">
              <span class="flex min-w-0 items-center gap-1.5">
                <BeanieAvatar
                  class="flex-none"
                  v-bind="memberAvatarBindings(row.member)"
                  size="xs"
                />
                <span
                  class="dark:text-ink text-secondary-500 sr-only min-w-0 truncate sm:not-sr-only"
                  >{{ firstName(row.member.name) }}</span
                >
              </span>
            </th>
            <td
              v-for="d in row.week.days"
              :key="d.ymd"
              class="rounded-lg py-1.5 text-center font-bold"
              :class="cellClass(d.ymd, d.count)"
            >
              {{ d.ymd > todayYmd ? '' : d.count }}
            </td>
            <td class="text-primary-700 dark:text-accent-lift py-1.5 text-center font-extrabold">
              {{ row.week.total }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
