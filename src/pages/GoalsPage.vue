<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCountUp } from '@/composables/useCountUp';
import CurrencyAmount from '@/components/common/CurrencyAmount.vue';

import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import SummaryStatCard from '@/components/dashboard/SummaryStatCard.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import GoalModal from '@/components/goals/GoalModal.vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useSounds } from '@/composables/useSounds';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useGoalsStore } from '@/stores/goalsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatDate } from '@/utils/date';
import type {
  Goal,
  GoalType,
  GoalPriority,
  CreateGoalInput,
  UpdateGoalInput,
} from '@/types/models';

const { isUnlocked } = usePrivacyMode();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();
const { playWhoosh } = useSounds();
const { formatInDisplayCurrency } = useCurrencyDisplay();

const route = useRoute();
const router = useRouter();

const progressMounted = ref(false);
onMounted(() => {
  nextTick(() => {
    progressMounted.value = true;
  });
  handleGoalQueryParam();
});

// Open goal from query param (e.g. from global search)
function handleGoalQueryParam() {
  const viewId = route.query.view as string | undefined;
  if (viewId) {
    const goal = goalsStore.goals.find((g) => g.id === viewId);
    if (goal) openEditModal(goal);
    router.replace({ query: {} });
  }
}
watch(
  () => route.query.view,
  (val) => {
    if (val) handleGoalQueryParam();
  }
);

const goalsStore = useGoalsStore();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();
const { getMemberName, getMemberColor } = useMemberInfo();

// Animated stat card counts
const { displayValue: animatedActiveCount } = useCountUp(
  computed(() => goalsStore.filteredActiveGoals.length)
);
const { displayValue: animatedCompletedCount } = useCountUp(
  computed(() => goalsStore.filteredCompletedGoals.length),
  100
);
const { displayValue: animatedOverdueCount } = useCountUp(
  computed(
    () =>
      goalsStore.filteredActiveGoals.filter((g) => g.deadline && new Date(g.deadline) < new Date())
        .length
  ),
  200
);

// Group by toggle
const groupBy = ref<'member' | 'priority'>('member');
const groupByOptions = computed(() => [
  { value: 'member', label: t('goals.groupByMember') },
  { value: 'priority', label: t('goals.groupByPriority') },
]);

// Subtitle text
const subtitleText = computed(() =>
  t('goals.subtitle')
    .replace('{members}', String(familyStore.members.length))
    .replace('{goals}', String(goalsStore.filteredActiveGoals.length))
);

// Type emoji map
const typeToEmoji: Record<GoalType, string> = {
  savings: '🐷',
  debt_payoff: '🎯',
  investment: '📈',
  vacation: '✈️',
  vehicle: '🚗',
  home: '🏠',
  education: '🎓',
  emergency: '🛟',
  purchase: '🛍️',
};

// Priority order and configs
const priorityOrder: GoalPriority[] = ['critical', 'high', 'medium', 'low'];
const priorityRank: Record<GoalPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function getPriorityConfig(priority: GoalPriority) {
  const configs: Record<GoalPriority, { icon: string; bgClass: string; textClass: string }> = {
    critical: {
      icon: '🔥',
      bgClass: 'bg-[var(--tint-orange-15)]',
      textClass: 'text-primary-500',
    },
    high: {
      icon: '⬆️',
      bgClass: 'bg-[rgba(230,126,34,0.1)]',
      textClass: 'text-terracotta-500',
    },
    medium: {
      icon: '➡️',
      bgClass: 'bg-[var(--tint-silk-20)]',
      textClass: 'text-[#5B9BD5]',
    },
    low: {
      icon: '⬇️',
      bgClass: 'bg-[var(--tint-slate-5)]',
      textClass: 'text-secondary-400',
    },
  };
  return configs[priority];
}

// Sections computed — follows AccountsPage pattern
interface GoalSection {
  key: string;
  label: string;
  goals: Goal[];
  addDefaults: { memberId?: string; priority?: GoalPriority };
  header:
    | { kind: 'member'; memberId: string | null }
    | { kind: 'priority'; priority: GoalPriority };
}

const sections = computed<GoalSection[]>(() => {
  const activeGoals = goalsStore.filteredActiveGoals;

  if (groupBy.value === 'member') {
    const memberSections: GoalSection[] = [];
    const isFamilyGoal = (g: Goal) => !g.memberId || g.memberId === '__shared__';

    // Family goals first (null/undefined/shared memberId)
    const familyGoals = activeGoals
      .filter(isFamilyGoal)
      .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
    if (familyGoals.length > 0) {
      memberSections.push({
        key: 'family',
        label: 'Family',
        goals: familyGoals,
        addDefaults: { memberId: '__shared__' },
        header: { kind: 'member', memberId: null },
      });
    }

    // Individual members
    for (const m of familyStore.members) {
      const memberGoals = activeGoals
        .filter((g) => g.memberId === m.id)
        .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
      if (memberGoals.length > 0) {
        memberSections.push({
          key: m.id,
          label: m.name,
          goals: memberGoals,
          addDefaults: { memberId: m.id },
          header: { kind: 'member', memberId: m.id },
        });
      }
    }

    return memberSections;
  }

  // Group by priority
  return priorityOrder
    .filter((p) => activeGoals.some((g) => g.priority === p))
    .map((p) => ({
      key: p,
      label: t(`goals.priority.${p}`),
      goals: activeGoals.filter((g) => g.priority === p),
      addDefaults: { priority: p },
      header: { kind: 'priority' as const, priority: p },
    }));
});

// Get encouragement for a goal
function getEncouragement(goal: Goal): { emoji: string; text: string; tone: string } {
  const progress = goalsStore.getGoalProgress(goal);
  const isOverdue = goal.deadline && new Date(goal.deadline) < new Date();

  if (isOverdue && !goal.isCompleted) {
    return { emoji: '💪', text: t('goals.encourage.overdue'), tone: 'warm' };
  }
  if (progress < 25) {
    return { emoji: '🌱', text: t('goals.encourage.planted'), tone: 'planted' };
  }
  if (progress < 50) {
    return { emoji: '🌱', text: t('goals.encourage.growing'), tone: 'growing' };
  }
  if (progress < 75) {
    return { emoji: '🌿', text: t('goals.encourage.pastHalf'), tone: 'growing' };
  }
  // > 75%
  const remaining = goal.targetAmount - goal.currentAmount;
  const remainingFormatted = formatInDisplayCurrency(remaining, goal.currency);
  return {
    emoji: '🔥',
    text: t('goals.encourage.almostThere').replace('{remaining}', remainingFormatted),
    tone: 'hot',
  };
}

function getGoalTypeLabel(type: GoalType): string {
  return t(`goals.type.${type}`);
}

const typeToClass: Record<GoalType, string> = {
  savings: 'goal-type-icon-savings',
  debt_payoff: 'goal-type-icon-debt-payoff',
  investment: 'goal-type-icon-investment',
  vacation: 'goal-type-icon-vacation',
  vehicle: 'goal-type-icon-vehicle',
  home: 'goal-type-icon-home',
  education: 'goal-type-icon-education',
  emergency: 'goal-type-icon-emergency',
  purchase: 'goal-type-icon-purchase',
};

function getMemberForGoal(memberId: string | undefined) {
  if (!memberId) return null;
  return familyStore.members.find((m) => m.id === memberId);
}

// Dual modal pattern
const showAddModal = ref(false);
const showEditModal = ref(false);
const editingGoal = ref<Goal | null>(null);
const addModalDefaults = ref<{ memberId?: string; priority?: GoalPriority } | undefined>();

function openAddWithDefaults(defaults?: { memberId?: string; priority?: GoalPriority }) {
  addModalDefaults.value = defaults;
  editingGoal.value = null;
  showAddModal.value = true;
}

function openEditModal(goal: Goal) {
  editingGoal.value = goal;
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingGoal.value = null;
}

async function handleGoalSave(data: CreateGoalInput | { id: string; data: UpdateGoalInput }) {
  if ('id' in data) {
    await goalsStore.updateGoal(data.id, data.data);
    closeEditModal();
  } else {
    await goalsStore.createGoal(data);
    showAddModal.value = false;
  }
}

async function handleGoalDelete(id: string) {
  closeEditModal();
  if (await showConfirm({ title: 'confirm.deleteGoalTitle', message: 'goals.deleteConfirm' })) {
    await goalsStore.deleteGoal(id);
    playWhoosh();
  }
}

// Completed goals section
const showCompletedGoals = ref(false);

const filteredCompletedGoalsSorted = computed(() =>
  [...goalsStore.filteredCompletedGoals].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
);

async function reopenGoal(id: string) {
  await goalsStore.updateGoal(id, { isCompleted: false });
}

async function deleteCompletedGoal(id: string) {
  if (
    await showConfirm({
      title: 'confirm.deleteGoalTitle',
      message: 'goals.deleteCompletedConfirm',
    })
  ) {
    await goalsStore.deleteGoal(id);
    playWhoosh();
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page Header -->
    <div class="flex items-center justify-between">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ subtitleText }}
      </p>
      <button
        type="button"
        class="font-outfit from-primary-500 to-terracotta-400 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
        @click="openAddWithDefaults()"
      >
        {{ t('goals.addGoal') }}
      </button>
    </div>

    <!-- Hero Summary Cards (3 cards with rawValue) -->
    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <SummaryStatCard
        :label="t('goals.activeGoals')"
        :amount="0"
        :currency="settingsStore.baseCurrency"
        :raw-value="String(Math.round(animatedActiveCount))"
        tint="slate"
        dark
      >
        <template #icon>
          <span class="text-lg">🎯</span>
        </template>
      </SummaryStatCard>

      <SummaryStatCard
        :label="t('goals.completedGoals')"
        :amount="0"
        :currency="settingsStore.baseCurrency"
        :raw-value="String(Math.round(animatedCompletedCount))"
        tint="green"
      >
        <template #icon>
          <span class="text-lg">✅</span>
        </template>
      </SummaryStatCard>

      <SummaryStatCard
        :label="t('goals.needsAttention')"
        :amount="0"
        :currency="settingsStore.baseCurrency"
        :raw-value="String(Math.round(animatedOverdueCount))"
        tint="orange"
      >
        <template #icon>
          <span class="text-lg">⏰</span>
        </template>
      </SummaryStatCard>
    </div>

    <!-- Group By Toggle -->
    <div class="flex items-center gap-3">
      <TogglePillGroup v-model="groupBy" :options="groupByOptions" />
    </div>

    <!-- Empty State -->
    <div v-if="goalsStore.filteredActiveGoals.length === 0" class="py-16 text-center">
      <EmptyStateIllustration variant="goals" class="mb-6" />
      <h3 class="text-lg font-medium text-gray-900 dark:text-gray-100">
        {{ t('goals.noGoals') }}
      </h3>
      <p class="mt-1 mb-4 text-gray-500 dark:text-gray-400">{{ t('goals.getStarted') }}</p>
      <button
        type="button"
        class="font-outfit from-primary-500 to-terracotta-400 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
        @click="openAddWithDefaults()"
      >
        {{ t('goals.addGoal') }}
      </button>
    </div>

    <!-- Sections Loop -->
    <div v-else class="space-y-8">
      <div v-for="section in sections" :key="section.key">
        <!-- Section Header: Member view -->
        <div v-if="section.header.kind === 'member'" class="mb-4 flex items-center gap-3">
          <template v-if="section.header.memberId">
            <BeanieAvatar
              v-if="getMemberForGoal(section.header.memberId)"
              :variant="getMemberAvatarVariant(getMemberForGoal(section.header.memberId)!)"
              :color="getMemberColor(section.header.memberId)"
              size="sm"
            />
          </template>
          <template v-else>
            <!-- Family section avatar -->
            <div
              class="bg-secondary-500 flex h-8 w-8 items-center justify-center rounded-full text-sm"
            >
              🏠
            </div>
          </template>
          <h2 class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ section.label }}
          </h2>
          <span class="text-sm text-gray-500 dark:text-gray-400">({{ section.goals.length }})</span>
        </div>

        <!-- Section Header: Priority view -->
        <div v-else class="mb-4 flex items-center gap-3">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg"
            :class="getPriorityConfig(section.header.priority).bgClass"
          >
            <span class="text-sm">{{ getPriorityConfig(section.header.priority).icon }}</span>
          </div>
          <h2 class="nook-section-label text-secondary-500 dark:text-gray-400">
            {{ section.label }}
          </h2>
          <span class="text-sm text-gray-500 dark:text-gray-400">({{ section.goals.length }})</span>
        </div>

        <!-- Goal Cards Grid -->
        <div class="cards-grid grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="(goal, goalIndex) in section.goals"
            :key="goal.id"
            class="goal-card cursor-pointer rounded-[var(--sq)] bg-white p-5 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
            :class="[
              syncHighlightClass(goal.id),
              {
                'goal-card-almost-there':
                  goalsStore.getGoalProgress(goal) >= 75 && !goal.isCompleted,
              },
            ]"
            :style="{ animationDelay: `${goalIndex * 0.07}s` }"
            @click="openEditModal(goal)"
          >
            <!-- Card Header -->
            <div class="mb-3 flex items-start justify-between">
              <div class="flex items-center gap-3">
                <!-- Type emoji squircle -->
                <div
                  class="goal-type-icon flex h-[42px] w-[42px] items-center justify-center rounded-[14px]"
                  :class="typeToClass[goal.type]"
                >
                  <span class="emoji text-xl">{{ typeToEmoji[goal.type] || '🎯' }}</span>
                </div>
                <div>
                  <h3 class="font-outfit text-base font-semibold text-gray-900 dark:text-gray-100">
                    {{ goal.name }}
                  </h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    {{ getGoalTypeLabel(goal.type) }}
                  </p>
                </div>
              </div>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-[var(--tint-slate-5)]"
                @click.stop="openEditModal(goal)"
              >
                ⋯
              </button>
            </div>

            <!-- Encouragement text -->
            <div
              class="goal-encouragement mb-3 text-sm font-medium"
              :class="`goal-encouragement-${getEncouragement(goal).tone}`"
            >
              {{ getEncouragement(goal).emoji }} {{ getEncouragement(goal).text }}
            </div>

            <!-- Progress Section -->
            <div class="mb-3">
              <div class="mb-1.5 flex items-center justify-between">
                <span
                  class="font-outfit text-xs font-semibold tracking-[0.08em] text-gray-500 uppercase dark:text-gray-400"
                >
                  {{ t('goals.progress') }}
                </span>
                <span
                  class="font-outfit text-sm font-semibold text-gray-900 dark:text-gray-100"
                  :class="{ 'blur-sm': !isUnlocked }"
                >
                  <CurrencyAmount
                    :amount="goal.currentAmount"
                    :currency="goal.currency"
                    size="sm"
                  />
                  <span class="mx-0.5 text-gray-400">/</span>
                  <CurrencyAmount :amount="goal.targetAmount" :currency="goal.currency" size="sm" />
                </span>
              </div>

              <!-- Progress bar with milestone dots -->
              <div
                class="progress-track relative h-2.5 w-full overflow-visible rounded-full bg-[#E8ECF0] dark:bg-slate-700"
                :class="{ 'blur-sm': !isUnlocked }"
              >
                <div
                  class="progress-fill from-primary-500 to-terracotta-500 h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out"
                  :class="{
                    'progress-fill-green': goal.isCompleted,
                    'progress-fill-glowing':
                      goalsStore.getGoalProgress(goal) >= 75 && !goal.isCompleted,
                  }"
                  :style="{
                    width: progressMounted ? `${goalsStore.getGoalProgress(goal)}%` : '0%',
                  }"
                />
                <!-- Milestone dots -->
                <div class="absolute inset-0">
                  <div
                    v-for="pos in [25, 50, 75, 100]"
                    :key="pos"
                    class="milestone-dot absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white/60"
                    :class="{
                      'milestone-dot-reached': goalsStore.getGoalProgress(goal) >= pos,
                    }"
                    :style="{
                      left: pos === 100 ? 'calc(100% - 3px)' : `${pos}%`,
                    }"
                  />
                </div>
              </div>
            </div>

            <!-- Card Footer -->
            <div
              class="flex items-center justify-between border-t border-gray-100 pt-3 dark:border-slate-700"
            >
              <!-- Priority badge or Almost There badge -->
              <template v-if="goalsStore.getGoalProgress(goal) >= 75 && !goal.isCompleted">
                <span
                  class="almost-there-badge font-outfit inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                >
                  🔥 {{ t('goals.almostThere') }}
                </span>
              </template>
              <template v-else>
                <span
                  class="font-outfit inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  :class="[
                    getPriorityConfig(goal.priority).bgClass,
                    getPriorityConfig(goal.priority).textClass,
                  ]"
                >
                  {{ t(`goals.priority.${goal.priority}`) }}
                </span>
              </template>

              <!-- Deadline -->
              <span
                v-if="goal.deadline"
                class="text-xs text-gray-500 dark:text-gray-400"
                :class="{
                  'goal-deadline-overdue font-medium':
                    goal.deadline && new Date(goal.deadline) < new Date(),
                }"
              >
                <template v-if="goal.deadline && new Date(goal.deadline) < new Date()">
                  {{ t('goals.letsCatchUp') }} ·
                </template>
                {{
                  new Date(goal.deadline).toLocaleDateString('en-US', {
                    month: 'short',
                    year: 'numeric',
                  })
                }}
              </span>
            </div>
          </div>

          <!-- Dashed Add Card -->
          <button
            type="button"
            class="add-card-dashed hover:border-primary-300 hover:text-primary-500 dark:hover:border-primary-500 dark:hover:text-primary-400 flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-[var(--sq)] border-2 border-dashed border-gray-200 bg-transparent p-5 text-gray-400 transition-colors dark:border-slate-600 dark:text-gray-500"
            @click="openAddWithDefaults(section.addDefaults)"
          >
            <BeanieIcon name="plus" size="lg" />
            <span class="font-outfit text-sm font-semibold">
              {{ t('goals.addAGoal') }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Completed / Achieved Goals Section -->
    <div v-if="goalsStore.filteredCompletedGoals.length > 0" class="sparkle-container relative">
      <!-- Sparkle particles -->
      <div v-for="n in 6" :key="`sparkle-${n}`" class="sparkle" />

      <button
        class="flex w-full items-center gap-2.5 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--tint-slate-5)]"
        @click="showCompletedGoals = !showCompletedGoals"
      >
        <span class="text-lg">🎉</span>
        <span class="font-outfit text-secondary-400 text-base font-semibold dark:text-gray-400">
          {{ t('goals.achievedGoals') }}
        </span>
        <span
          class="font-outfit rounded-full bg-[var(--tint-success-10)] px-2.5 py-0.5 text-xs font-semibold text-[#27AE60]"
        >
          {{ goalsStore.filteredCompletedGoals.length }}
        </span>
        <span
          class="ml-auto text-xs text-gray-400 transition-transform"
          :class="{ 'rotate-180': !showCompletedGoals }"
        >
          ▲
        </span>
      </button>

      <!-- Completed cards grid -->
      <div
        v-if="showCompletedGoals"
        class="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        <div
          v-for="(goal, i) in filteredCompletedGoalsSorted"
          :key="goal.id"
          class="celebration-card from-primary-500 to-terracotta-500 relative overflow-hidden rounded-[var(--sq)] bg-gradient-to-br p-5 text-white"
          :class="syncHighlightClass(goal.id)"
          :style="{ animationDelay: `${i * 0.07}s` }"
        >
          <!-- Decorative circles -->
          <div
            class="pointer-events-none absolute -top-5 -right-5 h-[100px] w-[100px] rounded-full bg-white/[0.08]"
          />
          <div
            class="pointer-events-none absolute -bottom-[30px] -left-2.5 h-20 w-20 rounded-full bg-white/[0.05]"
          />

          <!-- Header -->
          <div class="relative z-[1] mb-3 flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-white/20"
              >
                <span class="text-xl">{{ typeToEmoji[goal.type] || '🎯' }}</span>
              </div>
              <div>
                <h3 class="font-outfit text-base font-semibold">{{ goal.name }}</h3>
                <p class="text-sm text-white/70">
                  {{ t('goals.achieved') }}
                  {{ formatDate(goal.updatedAt) }}
                </p>
              </div>
            </div>
            <div class="flex gap-1">
              <button
                class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm transition-colors hover:bg-white/25"
                :title="t('goals.reopenGoal')"
                @click="reopenGoal(goal.id)"
              >
                ↩️
              </button>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm transition-colors hover:bg-white/25"
                :title="t('goals.deleteGoal')"
                @click="deleteCompletedGoal(goal.id)"
              >
                🗑️
              </button>
            </div>
          </div>

          <!-- Progress -->
          <div class="relative z-[1]">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-xs text-white/60">{{ t('goals.progress') }}</span>
              <span class="font-outfit text-sm font-semibold" :class="{ 'blur-sm': !isUnlocked }">
                <CurrencyAmount :amount="goal.currentAmount" :currency="goal.currency" size="sm" />
                <span class="mx-0.5 text-white/60">/</span>
                <CurrencyAmount :amount="goal.targetAmount" :currency="goal.currency" size="sm" />
              </span>
            </div>
            <div class="h-2 w-full rounded-full bg-white/20">
              <div class="h-full w-full rounded-full bg-white" />
            </div>
          </div>

          <!-- Footer -->
          <div
            class="relative z-[1] mt-3 flex items-center justify-between border-t border-white/15 pt-3"
          >
            <div class="flex items-center gap-2">
              <div
                class="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white/30 text-[10px] font-bold text-white"
                :style="{
                  backgroundColor: getMemberColor(goal.memberId, '#2C3E50'),
                }"
              >
                <template v-if="goal.memberId">
                  {{ getMemberName(goal.memberId, 'F').charAt(0) }}
                </template>
                <template v-else>🏠</template>
              </div>
              <span class="text-sm text-white/70">
                {{ getMemberName(goal.memberId, 'Family') }}
              </span>
            </div>
            <span
              class="font-outfit inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-0.5 text-xs font-bold text-white"
            >
              🎉 {{ t('goals.achieved') }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Goal Modal -->
    <GoalModal
      :open="showAddModal"
      :defaults="addModalDefaults"
      @close="showAddModal = false"
      @save="handleGoalSave"
      @delete="handleGoalDelete"
    />

    <!-- Edit Goal Modal -->
    <GoalModal
      :open="showEditModal"
      :goal="editingGoal"
      @close="closeEditModal"
      @save="handleGoalSave"
      @delete="handleGoalDelete"
    />
  </div>
</template>

<style scoped>
/* ───── Goal Type Icon Tints ───── */
.goal-type-icon-savings {
  background: var(--tint-success-10);
}

.goal-type-icon-debt-payoff {
  background: var(--tint-orange-8);
}

.goal-type-icon-investment {
  background: rgb(147 51 234 / 8%);
}

.goal-type-icon-vacation {
  background: rgb(59 130 246 / 8%);
}

.goal-type-icon-vehicle {
  background: rgb(147 51 234 / 8%);
}

.goal-type-icon-home {
  background: var(--tint-silk-20);
}

.goal-type-icon-education {
  background: rgb(20 184 166 / 8%);
}

.goal-type-icon-emergency {
  background: var(--tint-orange-8);
}

.goal-type-icon-purchase {
  background: rgb(245 158 11 / 8%);
}

/* ───── Encouragement Text ───── */
.goal-encouragement-planted {
  color: #27ae60;
}

.goal-encouragement-growing {
  color: #27ae60;
}

.goal-encouragement-hot {
  color: var(--heritage-orange);
  font-weight: 600;
}

.goal-encouragement-warm {
  color: var(--heritage-orange);
  font-weight: 600;
}

/* ───── Milestone Dots ───── */
.milestone-dot-reached {
  background: white;
  box-shadow: 0 0 0 2px var(--heritage-orange);
}

/* ───── Almost There Badge ───── */
.almost-there-badge {
  animation: badge-pulse 2s ease-in-out infinite;
  background: var(--tint-orange-15);
  color: var(--heritage-orange);
}

/* ───── Overdue Deadline ───── */
.goal-deadline-overdue {
  color: var(--heritage-orange);
}

/* ───── Progress Glow ───── */
.progress-fill-green {
  background: linear-gradient(90deg, #27ae60, #2ecc71) !important;
}

.progress-fill-glowing {
  position: relative;
}

.progress-fill-glowing::after {
  animation: progress-glow 2s ease-in-out infinite;
  background: var(--heritage-orange);
  border-radius: 50%;
  box-shadow: 0 0 12px rgb(241 93 34 / 50%);
  content: '';
  height: 16px;
  position: absolute;
  right: 0;
  top: -3px;
  width: 16px;
}

/* ───── Almost-there card soft glow ───── */
.goal-card-almost-there {
  box-shadow:
    0 4px 20px rgb(241 93 34 / 8%),
    0 0 0 1px rgb(241 93 34 / 6%);
}

/* ───── Card Entry Animation ───── */
.goal-card,
.celebration-card,
.add-card-dashed {
  animation: fade-slide-up 0.5s ease-out both;
}

/* ───── Emoji bounce on hover ───── */
.goal-card:hover .emoji {
  animation: emoji-bounce 0.5s ease-out;
}

/* ───── Sparkle Particles ───── */
.sparkle {
  animation: sparkle 3s ease-in-out infinite;
  background: var(--heritage-orange);
  border-radius: 50%;
  height: 4px;
  opacity: 0;
  position: absolute;
  width: 4px;
}

.sparkle:nth-child(1) {
  animation-delay: 0s;
  left: 5%;
  top: 10%;
}

.sparkle:nth-child(2) {
  animation-delay: 0.7s;
  left: 95%;
  top: 30%;
}

.sparkle:nth-child(3) {
  animation-delay: 1.4s;
  left: 15%;
  top: 80%;
}

.sparkle:nth-child(4) {
  animation-delay: 2.1s;
  left: 85%;
  top: 60%;
}

.sparkle:nth-child(5) {
  animation-delay: 0.5s;
  background: var(--terracotta);
  left: 50%;
  top: 5%;
}

.sparkle:nth-child(6) {
  animation-delay: 1.8s;
  background: #27ae60;
  left: 60%;
  top: 90%;
}

/* ───── Keyframe Animations ───── */

/* fade-slide-up is in global style.css */

@keyframes emoji-bounce {
  0% {
    transform: scale(1);
  }

  30% {
    transform: scale(1.25) rotate(-5deg);
  }

  50% {
    transform: scale(0.95) rotate(3deg);
  }

  70% {
    transform: scale(1.1);
  }

  100% {
    transform: scale(1);
  }
}

@keyframes progress-glow {
  0%,
  100% {
    opacity: 0.6;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@keyframes badge-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgb(241 93 34 / 30%);
  }

  50% {
    box-shadow: 0 0 0 6px rgb(241 93 34 / 0%);
  }
}

@keyframes sparkle {
  0%,
  100% {
    opacity: 0;
    transform: scale(0);
  }

  50% {
    opacity: 0.7;
    transform: scale(1);
  }
}

/* ───── Stagger delays ───── */
.cards-grid .goal-card:nth-child(1) {
  animation-delay: 0.05s;
}

.cards-grid .goal-card:nth-child(2) {
  animation-delay: 0.12s;
}

.cards-grid .goal-card:nth-child(3) {
  animation-delay: 0.19s;
}

.cards-grid .goal-card:nth-child(4),
.cards-grid .add-card-dashed {
  animation-delay: 0.26s;
}
</style>
