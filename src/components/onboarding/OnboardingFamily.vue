<script setup lang="ts">
import { ref, computed } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingSectionLabel from './OnboardingSectionLabel.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { ACTIVITY_PRESETS, type ActivityPreset } from '@/constants/activityPresets';
import type { CurrencyCode } from '@/types/models';

defineEmits<{
  next: [];
  back: [];
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const activityStore = useActivityStore();

// ── Section A: Activity ─────────────────────────────────────────────────────

const selectedPreset = ref<ActivityPreset | null>(null);
const activityDays = ref<number[]>([]);
const activityTime = ref('');
const activityFee = ref<number | undefined>(undefined);
const activityCurrency = ref<string>(settingsStore.baseCurrency);
const activityAdded = ref(false);
const addedActivities = ref<{ title: string; icon: string }[]>([]);

const teasers = [
  { icon: '\u{1F3E0}', label: 'Assets', desc: 'Property, vehicles' },
  { icon: '\u{1F3AF}', label: 'Goals', desc: 'Save towards dreams' },
  { icon: '\u2705', label: 'To-Dos', desc: 'Shared family tasks' },
  { icon: '\u{1F510}', label: 'Vault', desc: 'Passwords & secrets' },
  { icon: '\u{1F4CA}', label: 'Budgets', desc: 'Category tracking' },
];

function selectPreset(preset: ActivityPreset) {
  selectedPreset.value = preset;
  activityAdded.value = false;
  activityDays.value = [];
  activityTime.value = '';
  activityFee.value = undefined;
}

async function handleAddActivity() {
  if (!selectedPreset.value) return;
  const memberId = familyStore.owner?.id;
  if (!memberId) return;

  const today = new Date().toISOString().split('T')[0] as string;
  await activityStore.createActivity({
    title: selectedPreset.value.defaultTitle,
    icon: selectedPreset.value.icon,
    category: selectedPreset.value.category,
    date: today,
    startTime: activityTime.value || undefined,
    daysOfWeek: activityDays.value.length > 0 ? activityDays.value : undefined,
    recurrence: activityDays.value.length > 0 ? 'weekly' : 'none',
    feeAmount: activityFee.value,
    feeCurrency: activityCurrency.value as CurrencyCode,
    feeSchedule: 'monthly',
    reminderMinutes: 0,
    isActive: true,
    createdBy: memberId,
    assigneeId: memberId,
  });

  addedActivities.value.push({
    title: selectedPreset.value.defaultTitle,
    icon: selectedPreset.value.icon,
  });
  activityAdded.value = true;
}

function handleAddAnother() {
  selectedPreset.value = null;
  activityAdded.value = false;
  activityDays.value = [];
  activityTime.value = '';
  activityFee.value = undefined;
}

const feeDisplay = computed(() => {
  if (!activityFee.value) return '';
  return `$${activityFee.value.toLocaleString()}/mo`;
});
</script>

<template>
  <div class="ob-form">
    <OnboardingStepHeader
      icon="\u{1F333}"
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
          <div v-if="activityFee" class="font-heading text-heritage-orange text-sm font-bold">
            {{ feeDisplay }}
          </div>
        </div>

        <!-- Day of week -->
        <div class="mb-3.5">
          <div class="ob-detail-label">{{ t('onboarding.days') }}</div>
          <DayOfWeekSelector v-model="activityDays" />
        </div>

        <!-- Time + Fee row -->
        <div class="mb-3 grid grid-cols-2 gap-2">
          <div>
            <div class="ob-detail-label">{{ t('onboarding.time') }}</div>
            <BaseInput v-model="activityTime" type="time" />
          </div>
          <div>
            <div class="ob-detail-label">{{ t('onboarding.costPerMonth') }}</div>
            <CurrencyAmountInput
              :amount="activityFee"
              :currency="activityCurrency"
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

      <!-- Added confirmation card -->
      <div v-if="activityAdded && selectedPreset" class="ob-activity-card ob-activity-filled">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-lg"
            style="background: rgb(174 214 241 / 20%)"
          >
            {{ selectedPreset.icon }}
          </div>
          <div class="flex-1">
            <div class="font-heading text-sm font-bold">{{ selectedPreset.defaultTitle }}</div>
          </div>
          <span v-if="activityFee" class="font-heading text-heritage-orange text-sm font-bold">{{
            feeDisplay
          }}</span>
        </div>
        <div class="mt-3 flex items-center justify-between">
          <span class="font-heading text-xs font-semibold" style="color: #27ae60">
            {'\u2713'} {{ t('onboarding.addedToPlanner') }}
          </span>
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
      <div class="text-xl sm:text-2xl">{'\u{1F96B}'}</div>
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

.ob-activity-filled {
  background: rgb(39 174 96 / 6%);
  border-color: #27ae60;
}

.dark .ob-activity-filled {
  background: rgb(39 174 96 / 10%);
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
