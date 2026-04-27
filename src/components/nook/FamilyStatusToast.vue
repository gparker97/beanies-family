<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useCriticalItems, type CriticalItem } from '@/composables/useCriticalItems';
import { useToday } from '@/composables/useToday';

const { t } = useTranslation();
const todoStore = useTodoStore();
const activityStore = useActivityStore();
const { criticalItems, overflowCount } = useCriticalItems();

const emit = defineEmits<{
  'open-todo': [id: string];
  'open-activity': [id: string, date: string];
  'complete-duty': [id: string, dutyType: string, occurrenceDate: string];
  'complete-todo': [id: string];
  'show-full-schedule': [];
}>();

function handleComplete(item: CriticalItem) {
  if (item.dutyType) {
    emit('complete-duty', item.id, item.dutyType, item.occurrenceDate ?? '');
  } else if (item.type === 'todo') {
    emit('complete-todo', item.id);
  }
}

const { today } = useToday();
const todayActivitiesCount = computed(() => {
  return activityStore.upcomingActivities.filter(({ date }) => date === today.value).length;
});

const openTodosCount = computed(() => todoStore.filteredOpenTodos.length);

const subtitle = computed(() => {
  return t('nook.statusSummary')
    .replace('{activities}', String(todayActivitiesCount.value))
    .replace('{tasks}', String(openTodosCount.value));
});

// Cycle through motivational messages based on day of year
const motivationalKeys = [
  'nook.motto0',
  'nook.motto1',
  'nook.motto2',
  'nook.motto3',
  'nook.motto4',
  'nook.motto5',
  'nook.motto6',
  'nook.motto7',
  'nook.motto8',
  'nook.motto9',
  'nook.motto10',
  'nook.motto11',
  'nook.motto12',
  'nook.motto13',
  'nook.motto14',
  'nook.motto15',
  'nook.motto16',
  'nook.motto17',
  'nook.motto18',
  'nook.motto19',
  'nook.motto20',
  'nook.motto21',
  'nook.motto22',
  'nook.motto23',
  'nook.motto24',
  'nook.motto25',
  'nook.motto26',
  'nook.motto27',
  'nook.motto28',
  'nook.motto29',
  'nook.motto30',
  'nook.motto31',
  'nook.motto32',
  'nook.motto33',
  'nook.motto34',
  'nook.motto35',
  'nook.motto36',
  'nook.motto37',
] as const;

const title = computed(() => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  const key = motivationalKeys[dayOfYear % motivationalKeys.length] ?? 'nook.motto0';
  return t(key);
});

function handleItemClick(item: CriticalItem) {
  if (item.type === 'todo') emit('open-todo', item.id);
  else emit('open-activity', item.id, item.occurrenceDate ?? '');
}
</script>

<template>
  <div class="status-toast">
    <!-- Decorative background grain -->
    <div class="toast-grain" />

    <!-- Header row: icon + quote -->
    <div class="relative flex items-center gap-4">
      <div class="toast-icon-box">
        <span class="text-xl">🌳</span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-outfit text-sm leading-snug font-semibold text-white">
          {{ title }}
        </p>
        <p class="mt-0.5 text-xs text-white/65">
          {{ subtitle }}
        </p>
      </div>
    </div>

    <!-- Critical items for today -->
    <div v-if="criticalItems.length" class="relative mt-3 pt-3">
      <!-- Separator line with warm glow -->
      <div class="toast-separator" />

      <div class="space-y-1.5">
        <button
          v-for="(item, index) in criticalItems"
          :key="item.id + item.type + item.time"
          class="critical-item"
          :class="{ 'opacity-50': item.completed }"
          :style="{ animationDelay: `${index * 60}ms` }"
          @click="handleItemClick(item)"
        >
          <!-- Completion circle for completable items (todos + duties) -->
          <button
            v-if="item.completable"
            type="button"
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
            :class="
              item.completed ? 'border-white/50 bg-white/25' : 'border-white/40 hover:bg-white/15'
            "
            @click.stop="handleComplete(item)"
          >
            <svg v-if="item.completed" class="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.5 6l2.5 2.5 4.5-5"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <!-- Icon with subtle glow ring -->
          <span class="critical-icon">
            {{ item.icon }}
          </span>

          <!-- Message text -->
          <span
            class="line-clamp-2 flex-1 text-xs leading-snug font-medium text-white/90"
            :class="{ 'line-through': item.completed }"
          >
            {{ item.message }}
          </span>

          <!-- Tap chevron -->
          <svg
            class="h-3.5 w-3.5 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M6 3l5 5-5 5"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <!-- Overflow indicator — tappable to scroll to full schedule -->
      <button
        v-if="overflowCount > 0"
        class="mt-2 px-1 text-xs text-white/45 transition-colors hover:text-white/70"
        @click="emit('show-full-schedule')"
      >
        +{{ overflowCount }} {{ t('nook.criticalMore') }} ↓
      </button>
    </div>
  </div>
</template>

<style scoped>
.status-toast {
  background: linear-gradient(135deg, #f15d22 0%, #e67e22 55%, #d4701e 100%);
  border-radius: 18px;
  box-shadow:
    0 8px 32px rgb(241 93 34 / 18%),
    0 2px 8px rgb(241 93 34 / 10%),
    inset 0 1px 0 rgb(255 255 255 / 12%);
  color: white;
  overflow: hidden;
  padding: 18px 22px;
  position: relative;
}

/* Subtle noise texture for warmth/depth */
.toast-grain {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 128px 128px;
  border-radius: inherit;
  inset: 0;
  opacity: 0.04;
  pointer-events: none;
  position: absolute;
}

.toast-icon-box {
  align-items: center;
  backdrop-filter: blur(4px);
  background: rgb(255 255 255 / 18%);
  border-radius: 14px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 15%),
    0 2px 8px rgb(0 0 0 / 8%);
  display: flex;
  flex-shrink: 0;
  height: 42px;
  justify-content: center;
  width: 42px;
}

.toast-separator {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgb(255 255 255 / 25%) 20%,
    rgb(255 255 255 / 25%) 80%,
    transparent 100%
  );
  height: 1px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

/* Critical item rows */
.critical-item {
  align-items: center;
  animation: critical-slide-in 300ms ease both;
  background: rgb(255 255 255 / 10%);
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 14px;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%);
  display: flex;
  gap: 10px;
  padding: 9px 12px;
  text-align: left;
  transition:
    background-color 150ms ease,
    transform 150ms ease,
    box-shadow 150ms ease;
  width: 100%;
}

.critical-item:hover {
  background: rgb(255 255 255 / 18%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 10%),
    0 2px 8px rgb(0 0 0 / 6%);
}

.critical-item:active {
  background: rgb(255 255 255 / 22%);
  transform: scale(0.985);
}

/* Icon with soft backing glow */
.critical-icon {
  align-items: center;
  background: rgb(255 255 255 / 12%);
  border-radius: 10px;
  box-shadow: 0 0 12px rgb(255 255 255 / 6%);
  display: flex;
  flex-shrink: 0;
  font-size: 15px;
  height: 30px;
  justify-content: center;
  width: 30px;
}

/* Staggered entrance */
@keyframes critical-slide-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .critical-item {
    animation: none;
  }

  .critical-item:active {
    transform: none;
  }
}
</style>
