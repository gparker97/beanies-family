<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingSectionLabel from './OnboardingSectionLabel.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useActivityStore } from '@/stores/activityStore';
import { toAssigneePayload } from '@/utils/assignees';
import { useTranslation } from '@/composables/useTranslation';
import { addHourToTime, formatTime12 } from '@/utils/date';
import { ACTIVITY_PRESETS, type ActivityPreset } from '@/constants/activityPresets';
import type { CurrencyCode, ActivityCategory } from '@/types/models';

defineEmits<{
  next: [];
  back: [];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const activityStore = useActivityStore();

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Section A: Activity ─────────────────────────────────────────────────────

const selectedPreset = ref<ActivityPreset | null>(null);
const activityDays = ref<number[]>([]);
const startTime = ref('09:00');
const endTime = ref('10:00');
const activityFee = ref<number | undefined>(undefined);
const activityCurrency = ref<string>(settingsStore.baseCurrency);
const activityAdded = ref(false);
const assigneeId = ref(familyStore.owner?.id || '');

interface AddedActivity {
  title: string;
  icon: string;
  category: ActivityCategory;
  memberName: string;
  days: number[];
  startTime: string;
  endTime: string;
  fee?: number;
}
const addedActivities = ref<AddedActivity[]>([]);

const memberOptions = computed(() =>
  familyStore.members.map((m) => ({
    value: m.id,
    label: m.name,
  }))
);

const teasers = [
  { icon: '\u{1F3E0}', label: 'Assets', desc: 'Property, vehicles' },
  { icon: '\u{1F3AF}', label: 'Goals', desc: 'Save towards dreams' },
  { icon: '\u2705', label: 'To-Dos', desc: 'Shared family tasks' },
  { icon: '\u{1F510}', label: 'Vault', desc: 'Passwords & secrets' },
  { icon: '\u{1F4CA}', label: 'Budgets', desc: 'Category tracking' },
];

// Auto-update endTime when startTime changes
watch(startTime, (newStart) => {
  if (newStart) {
    endTime.value = addHourToTime(newStart);
  }
});

function selectPreset(preset: ActivityPreset) {
  selectedPreset.value = preset;
  activityAdded.value = false;
  activityDays.value = [];
  startTime.value = '09:00';
  endTime.value = '10:00';
  activityFee.value = undefined;
  assigneeId.value = familyStore.owner?.id || '';
}

async function handleAddActivity() {
  if (!selectedPreset.value) return;
  const memberId = assigneeId.value || familyStore.owner?.id;
  if (!memberId) return;

  const today = new Date().toISOString().split('T')[0] as string;
  await activityStore.createActivity({
    title: selectedPreset.value.defaultTitle,
    icon: selectedPreset.value.icon,
    category: selectedPreset.value.category,
    date: today,
    startTime: startTime.value || undefined,
    endTime: endTime.value || undefined,
    daysOfWeek: activityDays.value.length > 0 ? activityDays.value : undefined,
    recurrence: activityDays.value.length > 0 ? 'weekly' : 'none',
    feeAmount: activityFee.value,
    feeCurrency: activityCurrency.value as CurrencyCode,
    feeSchedule: 'monthly',
    reminderMinutes: 0,
    isActive: true,
    createdBy: memberId,
    ...toAssigneePayload([memberId]),
  });

  const memberName = familyStore.members.find((m) => m.id === memberId)?.name?.split(' ')[0] || '';

  addedActivities.value.push({
    title: selectedPreset.value.defaultTitle,
    icon: selectedPreset.value.icon,
    category: selectedPreset.value.category,
    memberName,
    days: [...activityDays.value],
    startTime: startTime.value,
    endTime: endTime.value,
    fee: activityFee.value,
  });
  activityAdded.value = true;
}

function handleAddAnother() {
  selectedPreset.value = null;
  activityAdded.value = false;
  activityDays.value = [];
  startTime.value = '09:00';
  endTime.value = '10:00';
  activityFee.value = undefined;
}

function formatDaysShort(days: number[]): string {
  if (!days.length) return '';
  return days
    .sort((a, b) => a - b)
    .map((d) => SHORT_DAYS[d] || '')
    .join(', ');
}
</script>

<template>
  <div class="ob-form">
    <OnboardingStepHeader
      icon="🌳"
      icon-bg="rgba(110,231,183,0.15)"
      step-label="Step 3 of 3 — last one!"
      title-prefix="Your "
      title-highlight="family life"
      :current-step="3"
      :total-steps="3"
    />

    <!-- Section A: Activity -->
    <div class="ob-section">
      <OnboardingSectionLabel
        letter="A"
        :label="t('onboarding.sectionActivity')"
        :subtitle="t('onboarding.sectionActivitySub')"
        color="#27AE60"
        badge-gradient="linear-gradient(135deg, #6EE7B7, #27AE60)"
      />

      <!-- Preset chips -->
      <div class="mb-3 flex flex-wrap gap-1.5">
        <button
          v-for="preset in ACTIVITY_PRESETS"
          :key="preset.label"
          class="ob-chip"
          :class="{ 'ob-chip-selected': selectedPreset?.label === preset.label }"
          @click="selectPreset(preset)"
        >
          <span class="text-sm">{{ preset.icon }}</span>
          {{ preset.label }}
        </button>
      </div>

      <!-- Activity card (when preset selected) -->
      <div
        v-if="selectedPreset && !activityAdded"
        class="ob-activity-card"
        data-testid="onboarding-activity-card"
      >
        <!-- Header: icon + title -->
        <div class="mb-3.5 flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-lg"
            style="background: rgb(174 214 241 / 20%)"
          >
            {{ selectedPreset.icon }}
          </div>
          <div class="flex-1">
            <div class="font-heading text-sm font-bold">{{ selectedPreset.defaultTitle }}</div>
          </div>
        </div>

        <!-- Days + Member + Time row -->
        <div class="ob-days-member-time-row">
          <div class="ob-days-col">
            <div class="ob-detail-label">{{ t('onboarding.days') }}</div>
            <DayOfWeekSelector v-model="activityDays" />
          </div>
          <div v-if="memberOptions.length > 1" class="ob-member-col">
            <div class="ob-detail-label">{{ t('onboarding.assignee') }}</div>
            <select v-model="assigneeId" class="ob-member-select">
              <option v-for="opt in memberOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div class="ob-time-col">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <div class="ob-detail-label">{{ t('onboarding.startTime') }}</div>
                <TimePresetPicker v-model="startTime" />
              </div>
              <div>
                <div class="ob-detail-label">{{ t('onboarding.endTime') }}</div>
                <TimePresetPicker v-model="endTime" />
              </div>
            </div>
          </div>
        </div>

        <!-- Cost row -->
        <div class="mt-3 mb-3">
          <div class="ob-detail-label">{{ t('onboarding.costPerMonth') }}</div>
          <div class="max-w-[240px]">
            <CurrencyAmountInput
              :amount="activityFee"
              :currency="activityCurrency"
              font-size="0.85rem"
              @update:amount="activityFee = $event"
              @update:currency="activityCurrency = $event"
            />
          </div>
        </div>

        <button
          class="ob-add-pill w-full"
          data-testid="onboarding-add-activity"
          @click="handleAddActivity"
        >
          {{ t('onboarding.addActivity') }}
        </button>
      </div>

      <!-- Added activities list -->
      <div v-if="addedActivities.length > 0" class="ob-added-list">
        <div v-for="(activity, idx) in addedActivities" :key="idx" class="ob-added-row">
          <span class="text-base">{{ activity.icon }}</span>
          <div class="min-w-0 flex-1">
            <div class="font-heading truncate text-xs font-bold">
              {{ activity.title }}
            </div>
            <div class="truncate text-xs opacity-45">
              {{ activity.memberName }}
              <span v-if="activity.days.length"> · {{ formatDaysShort(activity.days) }}</span>
              <span v-if="activity.startTime"> · {{ formatTime12(activity.startTime) }}</span>
              <span v-if="activity.fee"> · {{ `$${activity.fee}/mo` }}</span>
            </div>
          </div>
          <span class="ob-added-category">{{ activity.category }}</span>
          <span class="text-xs font-bold" style="color: #27ae60">✓</span>
        </div>

        <!-- Add another button -->
        <div v-if="activityAdded" class="mt-2 flex justify-end">
          <button class="ob-add-pill" @click="handleAddAnother">
            {{ t('onboarding.addAnother') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div class="ob-divider" />

    <!-- Section B: Discover teasers -->
    <div class="ob-section" style="margin-bottom: 12px">
      <OnboardingSectionLabel
        letter="B"
        :label="t('onboarding.sectionDiscover')"
        :subtitle="t('onboarding.sectionDiscoverSub')"
        color="#3A7BAD"
        badge-gradient="linear-gradient(135deg, var(--sky-silk, #AED6F1), #7FB8E0)"
      />

      <div class="ob-teaser-grid">
        <div v-for="teaser in teasers" :key="teaser.label" class="ob-teaser-card">
          <div class="mb-1.5 text-2xl sm:text-3xl">{{ teaser.icon }}</div>
          <div class="font-heading text-xs font-bold sm:text-sm">{{ teaser.label }}</div>
          <div class="mt-0.5 hidden text-xs opacity-40 sm:block" style="line-height: 1.4">
            {{ teaser.desc }}
          </div>
        </div>
      </div>
    </div>

    <!-- Closing message -->
    <div class="ob-closing-strip">
      <div class="text-xl sm:text-2xl">🥫</div>
      <div>
        <div class="font-heading text-xs font-bold sm:text-sm">
          {{ t('onboarding.closingTitle') }}
        </div>
        <div class="mt-0.5 text-xs opacity-50">{{ t('onboarding.closingSubtitle') }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ob-form {
  background: linear-gradient(180deg, var(--cloud-white, #f8f9fa) 0%, #edf6fc 100%);
  min-height: 100%;
  overflow: hidden;
  padding: 20px 16px;
  position: relative;
}

.dark .ob-form {
  background: linear-gradient(180deg, #1a252f 0%, #1e3040 100%);
}

.ob-form::before {
  background: radial-gradient(circle, rgb(174 214 241 / 20%), transparent 70%);
  border-radius: 50%;
  bottom: -80px;
  content: '';
  height: 300px;
  position: absolute;
  right: -80px;
  width: 300px;
}

.ob-form::after {
  background: radial-gradient(circle, rgb(241 93 34 / 6%), transparent 70%);
  border-radius: 50%;
  content: '';
  height: 200px;
  left: -40px;
  position: absolute;
  top: -40px;
  width: 200px;
}

.ob-section {
  margin-bottom: 20px;
  position: relative;
  z-index: 1;
}

.ob-divider {
  background: rgb(44 62 80 / 5%);
  height: 1px;
  margin: 4px 0 20px;
  position: relative;
  z-index: 1;
}

.dark .ob-divider {
  background: rgb(255 255 255 / 6%);
}

.ob-detail-label {
  font-family: Outfit, sans-serif;
  font-size: 0.52rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  opacity: 0.4;
  text-transform: uppercase;
}

.ob-chip {
  align-items: center;
  background: white;
  border: 2px solid rgb(44 62 80 / 5%);
  border-radius: 12px;
  color: var(--deep-slate, #2c3e50);
  cursor: pointer;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  gap: 5px;
  padding: 6px 12px;
  transition: all 0.2s;
}

.dark .ob-chip {
  background: #243342;
  border-color: rgb(255 255 255 / 6%);
  color: #e2e8f0;
}

.ob-chip:hover {
  background: rgb(174 214 241 / 10%);
  border-color: var(--sky-silk, #aed6f1);
}

.ob-chip-selected {
  background: rgb(241 93 34 / 8%);
  border-color: var(--heritage-orange, #f15d22);
  color: var(--heritage-orange, #f15d22);
}

.ob-activity-card {
  background: white;
  border: 2px solid rgb(44 62 80 / 5%);
  border-radius: 16px;
  padding: 18px;
  position: relative;
  z-index: 1;
}

.dark .ob-activity-card {
  background: #243342;
  border-color: rgb(255 255 255 / 6%);
}

.ob-member-select {
  appearance: none;
  background: rgb(174 214 241 / 12%);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%232c3e50' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-position: right 8px center;
  background-repeat: no-repeat;
  border: 1.5px solid rgb(44 62 80 / 8%);
  border-radius: 10px;
  color: var(--deep-slate, #2c3e50);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 6px 28px 6px 10px;
  width: 100%;
}

.dark .ob-member-select {
  background-color: rgb(255 255 255 / 6%);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23e2e8f0' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  border-color: rgb(255 255 255 / 10%);
  color: #e2e8f0;
}

.ob-days-member-time-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 0;
}

@media (width >= 640px) {
  .ob-days-member-time-row {
    align-items: start;
    flex-direction: row;
    gap: 10px;
  }
}

.ob-days-col {
  flex: 1;
  min-width: 0;
}

.ob-member-col {
  flex-shrink: 0;
}

@media (width >= 640px) {
  .ob-member-col {
    width: 110px;
  }
}

.ob-time-col {
  flex-shrink: 0;
}

@media (width >= 640px) {
  .ob-time-col {
    width: 200px;
  }
}

.ob-add-pill {
  background: rgb(241 93 34 / 8%);
  border: none;
  border-radius: 12px;
  color: var(--heritage-orange, #f15d22);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  padding: 8px 16px;
  transition: opacity 0.2s;
}

/* ── Added activities list ──────────────────────────────────────────────── */

.ob-added-list {
  margin-top: 10px;
}

.ob-added-row {
  align-items: center;
  background: rgb(39 174 96 / 6%);
  border: 1.5px solid rgb(39 174 96 / 20%);
  border-radius: 12px;
  display: flex;
  gap: 10px;
  margin-bottom: 6px;
  padding: 8px 12px;
}

.dark .ob-added-row {
  background: rgb(39 174 96 / 10%);
}

.ob-added-category {
  background: rgb(44 62 80 / 6%);
  border-radius: 6px;
  font-family: Outfit, sans-serif;
  font-size: 0.55rem;
  font-weight: 600;
  padding: 2px 6px;
  text-transform: capitalize;
  white-space: nowrap;
}

.dark .ob-added-category {
  background: rgb(255 255 255 / 8%);
}

/* ── Teaser & closing styles ────────────────────────────────────────────── */

.ob-teaser-grid {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(3, 1fr);
}

@media (width >= 640px) {
  .ob-teaser-grid {
    gap: 10px;
    grid-template-columns: repeat(5, 1fr);
  }
}

.ob-teaser-card {
  background: white;
  border: 1px solid rgb(44 62 80 / 5%);
  border-radius: 14px;
  padding: 10px;
  text-align: center;
  transition: all 0.2s;
}

.dark .ob-teaser-card {
  background: #243342;
  border-color: rgb(255 255 255 / 6%);
}

.ob-teaser-card:hover {
  border-color: var(--sky-silk, #aed6f1);
  box-shadow: 0 4px 16px rgb(44 62 80 / 6%);
  transform: scale(1.02);
}

@media (width >= 640px) {
  .ob-teaser-card {
    border-radius: 16px;
    padding: 14px;
  }
}

.ob-closing-strip {
  align-items: center;
  background: linear-gradient(135deg, var(--deep-slate, #2c3e50), #3d5368);
  border-radius: 14px;
  color: white;
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  position: relative;
  z-index: 1;
}

@media (width >= 640px) {
  .ob-closing-strip {
    border-radius: 16px;
    gap: 14px;
    padding: 16px 24px;
  }
}
</style>
