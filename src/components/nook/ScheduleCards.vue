<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { toDateInputValue, formatNookDate, formatTime12 } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import NookSectionCard from './NookSectionCard.vue';

const { t } = useTranslation();
const todoStore = useTodoStore();
const activityStore = useActivityStore();

const emit = defineEmits<{
  'open-todo': [id: string];
  'open-activity': [id: string, date: string];
}>();

interface ScheduleItem {
  id: string;
  type: 'todo' | 'activity';
  title: string;
  date: string; // YYYY-MM-DD for sorting
  time: string; // HH:mm or '' for untimed
  endTime: string; // HH:mm or '' for no end time
  displayDate: string; // Formatted for display
  icon: string;
}

const { today: todayStr } = useToday();

const todayFormatted = computed(() => formatNookDate(todayStr.value));

// ── Today's items (todos + activities merged) ────────────────────────────────
const todayItems = computed<ScheduleItem[]>(() => {
  const items: ScheduleItem[] = [];

  // Todos due today
  for (const todo of todoStore.filteredOpenTodos) {
    const dateStr = todo.dueDate?.split('T')[0] ?? '';
    if (dateStr === todayStr.value) {
      items.push({
        id: todo.id,
        type: 'todo',
        title: todo.title,
        date: dateStr,
        time: todo.dueTime ?? '',
        endTime: '',
        displayDate: formatNookDate(dateStr),
        icon: '✅',
      });
    }
  }

  // Activities today (from upcomingActivities which already expands recurring)
  for (const { activity, date } of activityStore.upcomingActivities) {
    if (date === todayStr.value) {
      items.push({
        id: activity.id,
        type: 'activity',
        title: activity.title,
        date,
        time: activity.startTime ?? '',
        endTime: activity.endTime ?? '',
        displayDate: formatNookDate(date),
        icon: activity.icon ?? getActivityFallbackEmoji(activity.category),
      });
    }
  }

  // Sort: timed items first (by time), then untimed
  items.sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    return 0;
  });
  return items;
});

// ── This week's items (todos + activities merged) ────────────────────────────
const weekItems = computed<ScheduleItem[]>(() => {
  const items: ScheduleItem[] = [];
  const start = todayStr.value;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 7);
  const endStr = toDateInputValue(endDate);

  // Todos this week
  for (const todo of todoStore.filteredOpenTodos) {
    if (!todo.dueDate) continue;
    const dateStr = todo.dueDate.split('T')[0] ?? '';
    if (dateStr >= start && dateStr <= endStr) {
      items.push({
        id: todo.id,
        type: 'todo',
        title: todo.title,
        date: dateStr,
        time: todo.dueTime ?? '',
        endTime: '',
        displayDate: formatNookDate(dateStr),
        icon: '📋',
      });
    }
  }

  // Activities this week
  for (const { activity, date } of activityStore.upcomingActivities) {
    if (date >= start && date <= endStr) {
      items.push({
        id: activity.id,
        type: 'activity',
        title: activity.title,
        date,
        time: activity.startTime ?? '',
        endTime: activity.endTime ?? '',
        displayDate: formatNookDate(date),
        icon: activity.icon ?? getActivityFallbackEmoji(activity.category),
      });
    }
  }

  // Sort by date (earliest first), then by time within same day
  items.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    return 0;
  });
  return items;
});

const MAX_WEEK_VISIBLE = 6;
const hasMoreWeekItems = computed(() => weekItems.value.length > MAX_WEEK_VISIBLE);
const hiddenWeekCount = computed(() => weekItems.value.length - MAX_WEEK_VISIBLE);

function formatGroupDate(dateStr: string): string {
  if (dateStr === todayStr.value) return t('date.today');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateStr === toDateInputValue(tomorrow)) return t('date.tomorrow');
  return formatNookDate(dateStr);
}

interface WeekGroup {
  date: string;
  label: string;
  items: ScheduleItem[];
}

const groupedWeekItems = computed<WeekGroup[]>(() => {
  const visible = weekItems.value.slice(0, MAX_WEEK_VISIBLE);
  const groups: WeekGroup[] = [];
  let currentDate = '';

  for (const item of visible) {
    if (item.date !== currentDate) {
      currentDate = item.date;
      groups.push({ date: item.date, label: formatGroupDate(item.date), items: [] });
    }
    groups[groups.length - 1]!.items.push(item);
  }

  return groups;
});

function handleClick(item: ScheduleItem) {
  if (item.type === 'todo') emit('open-todo', item.id);
  else emit('open-activity', item.id, item.date);
}
</script>

<template>
  <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
    <!-- Left — Today's Schedule -->
    <NookSectionCard
      class="nook-schedule-today"
      :title="t('nook.todaySchedule')"
      border-color="#AED6F1"
    >
      <template #header-right>
        <span
          class="rounded-full bg-[var(--tint-silk-20)] px-2 py-0.5 text-xs font-semibold text-[#3A7BAD]"
        >
          {{ todayFormatted }}
        </span>
      </template>

      <!-- Content -->
      <div v-if="todayItems.length > 0" class="flex flex-col gap-3">
        <div
          v-for="item in todayItems"
          :key="`${item.type}-${item.id}`"
          class="flex cursor-pointer items-center gap-3 rounded-xl transition-colors hover:bg-[var(--tint-silk-20)]"
          @click="handleClick(item)"
        >
          <div
            class="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[12px] bg-[var(--tint-silk-20)]"
          >
            <span class="text-sm">{{ item.icon }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div
              class="text-secondary-500 truncate text-sm leading-tight font-semibold dark:text-gray-200"
            >
              {{ item.title }}
            </div>
            <div class="font-outfit mt-0.5 text-xs font-medium opacity-45">
              {{
                item.time
                  ? formatTime12(item.time) +
                    (item.endTime ? ' - ' + formatTime12(item.endTime) : '') +
                    ' · '
                  : ''
              }}{{ item.displayDate }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="text-secondary-500/40 py-4 text-center text-sm dark:text-gray-500">
        {{ t('nook.noEvents') }}
      </div>
    </NookSectionCard>

    <!-- Right — This Week -->
    <NookSectionCard class="nook-schedule-week" :title="t('nook.thisWeek')" border-color="#F15D22">
      <template #header-right>
        <router-link
          to="/activities"
          class="text-primary-500 text-xs font-semibold hover:underline"
        >
          {{ t('nook.fullCalendar') }} &rarr;
        </router-link>
      </template>

      <!-- Content -->
      <div v-if="weekItems.length > 0" class="flex flex-col gap-4">
        <div v-for="group in groupedWeekItems" :key="group.date">
          <p
            class="font-outfit text-secondary-500/50 mb-1.5 text-xs font-semibold tracking-wide uppercase dark:text-gray-500"
          >
            {{ group.label }}
          </p>
          <div class="flex flex-col gap-2">
            <div
              v-for="item in group.items"
              :key="`${item.type}-${item.id}`"
              class="flex cursor-pointer items-center gap-3 rounded-xl transition-colors hover:bg-[rgba(241,93,34,0.08)]"
              @click="handleClick(item)"
            >
              <div
                class="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[12px] bg-[rgba(241,93,34,0.08)]"
              >
                <span class="text-sm">{{ item.icon }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div
                  class="text-secondary-500 truncate text-sm leading-tight font-semibold dark:text-gray-200"
                >
                  {{ item.title }}
                </div>
                <div class="font-outfit mt-0.5 text-xs font-medium opacity-45">
                  {{
                    item.time
                      ? formatTime12(item.time) +
                        (item.endTime ? ' - ' + formatTime12(item.endTime) : '')
                      : ''
                  }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <router-link
          v-if="hasMoreWeekItems"
          to="/activities"
          class="text-primary-500 font-outfit mt-1 block text-center text-xs font-semibold hover:underline"
        >
          +{{ hiddenWeekCount }} {{ t('nook.moreItems') }} &rarr;
        </router-link>
      </div>
      <div v-else class="text-secondary-500/40 py-4 text-center text-sm dark:text-gray-500">
        {{ t('nook.comingSoon') }}
      </div>
    </NookSectionCard>
  </div>
</template>

<style scoped>
.nook-schedule-today {
  background: linear-gradient(135deg, white 85%, rgb(174 214 241 / 12%));
}

.nook-schedule-week {
  background: linear-gradient(135deg, white 85%, rgb(241 93 34 / 4%));
}
</style>
