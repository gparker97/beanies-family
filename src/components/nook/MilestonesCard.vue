<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { useGoalsStore } from '@/stores/goalsStore';
import type { GoalType } from '@/types/models';

const { t } = useTranslation();
const familyStore = useFamilyStore();
const goalsStore = useGoalsStore();

interface Milestone {
  type: 'birthday' | 'goal' | 'completed';
  name: string;
  date?: string;
  icon: string;
  daysAway: number;
}

function getGoalIcon(goalType: GoalType): string {
  switch (goalType) {
    case 'savings':
      return '\u{1F3E0}';
    case 'debt_payoff':
      return '\u{1F4B3}';
    case 'investment':
      return '\u{1F4C8}';
    case 'purchase':
      return '\u{1F6D2}';
    default:
      return '\u{1F3AF}';
  }
}

function getNextBirthday(month: number, day: number): { date: Date; daysAway: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisYear = today.getFullYear();
  let nextBirthday = new Date(thisYear, month - 1, day);
  nextBirthday.setHours(0, 0, 0, 0);

  if (nextBirthday < today) {
    nextBirthday = new Date(thisYear + 1, month - 1, day);
    nextBirthday.setHours(0, 0, 0, 0);
  }

  const diffMs = nextBirthday.getTime() - today.getTime();
  const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return { date: nextBirthday, daysAway };
}

const milestones = computed<Milestone[]>(() => {
  const items: Milestone[] = [];

  // 1. Birthdays from family members with dateOfBirth (within 90 days)
  for (const member of familyStore.members) {
    if (!member.dateOfBirth) continue;
    const { date, daysAway } = getNextBirthday(member.dateOfBirth.month, member.dateOfBirth.day);
    if (daysAway <= 90) {
      items.push({
        type: 'birthday',
        name: t('nook.birthday').replace('{name}', member.name),
        date: date.toISOString(),
        icon: '\u{1F382}',
        daysAway,
      });
    }
  }

  // 2. Goal deadlines from active goals
  for (const goal of goalsStore.filteredActiveGoals) {
    if (!goal.deadline) continue;
    const deadlineDate = new Date(goal.deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = deadlineDate.getTime() - today.getTime();
    const daysAway = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (daysAway >= 0) {
      items.push({
        type: 'goal',
        name: goal.name,
        date: goal.deadline,
        icon: getGoalIcon(goal.type),
        daysAway,
      });
    }
  }

  // 3. Recently completed goals (up to 2)
  for (const goal of goalsStore.filteredCompletedGoals.slice(0, 2)) {
    items.push({
      type: 'completed',
      name: goal.name,
      icon: '\u{2705}',
      daysAway: -1,
    });
  }

  // Sort: nearest first, completed at the end
  items.sort((a, b) => {
    if (a.type === 'completed' && b.type !== 'completed') return 1;
    if (a.type !== 'completed' && b.type === 'completed') return -1;
    return a.daysAway - b.daysAway;
  });

  return items.slice(0, 4);
});

const upcomingCount = computed(() => milestones.value.filter((m) => m.type !== 'completed').length);
</script>

<template>
  <div
    class="nook-milestones-card rounded-[var(--sq)] border-l-4 border-[#E67E22] p-6 shadow-[var(--card-shadow)]"
  >
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-base">{{ '🏆' }}</span>
        <span
          class="font-outfit text-secondary-500/45 text-[0.75rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
        >
          {{ t('nook.milestones') }}
        </span>
      </div>
      <span
        v-if="upcomingCount > 0"
        class="rounded-full bg-[var(--tint-orange-8)] px-2 py-0.5 text-[0.65rem] font-semibold text-[#F15D22]"
      >
        {{ upcomingCount }} {{ t('nook.upcoming') }}
      </span>
    </div>

    <!-- Items list -->
    <div v-if="milestones.length > 0" class="space-y-0">
      <div
        v-for="(milestone, index) in milestones"
        :key="index"
        class="flex items-center gap-3 border-b border-[var(--tint-slate-5)] py-3.5 last:border-b-0"
      >
        <!-- Icon container -->
        <div
          class="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] text-lg"
          :class="{
            'bg-[var(--tint-orange-8)]': milestone.type === 'birthday',
            'bg-[var(--tint-silk-20)]': milestone.type === 'goal',
            'bg-[var(--tint-success-10)]': milestone.type === 'completed',
          }"
        >
          {{ milestone.icon }}
        </div>

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <div
            class="font-outfit text-secondary-500 text-[0.85rem] font-semibold dark:text-gray-100"
          >
            {{ milestone.name }}
          </div>
          <div v-if="milestone.type === 'completed'" class="text-[0.7rem] text-[#27AE60]">
            {{ t('nook.completedRecently') }}
          </div>
          <div v-else class="text-[0.7rem] opacity-40 dark:text-gray-500">
            {{ t('nook.daysAway').replace('{days}', String(milestone.daysAway)) }}
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="text-secondary-500/40 py-6 text-center text-[0.8rem] dark:text-gray-500">
      {{ '🏆' }} {{ t('nook.noMilestones') }}
    </div>
  </div>
</template>

<style scoped>
.nook-milestones-card {
  background: linear-gradient(135deg, white 85%, rgb(230 126 34 / 5%));
}

:global(.dark) .nook-milestones-card {
  background: rgb(30 41 59);
}
</style>
