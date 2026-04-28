<script setup lang="ts">
import { ref, watch } from 'vue';
import OnboardingStepHeader from './OnboardingStepHeader.vue';
import OnboardingStepShell from './OnboardingStepShell.vue';
import OnboardingAddedRow from './OnboardingAddedRow.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import { showToast } from '@/composables/useToast';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useActivityStore } from '@/stores/activityStore';
import { toAssigneePayload } from '@/utils/assignees';
import { useTranslation } from '@/composables/useTranslation';
import { addHourToTime, formatTime12 } from '@/utils/date';
import { ACTIVITY_PRESETS, type ActivityPreset } from '@/constants/activityPresets';
import { getActivityCategoryName } from '@/constants/activityCategories';
import { ErrorSurfaces } from './errorSurfaces';
import type { CurrencyCode, ActivityCategory } from '@/types/models';

defineEmits<{
  next: [];
  back: [];
}>();

const { t, isBeanieMode } = useTranslation();
const settingsStore = useSettingsStore();
const familyStore = useFamilyStore();
const activityStore = useActivityStore();

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const selectedPreset = ref<ActivityPreset | null>(null);
const activityDays = ref<number[]>([]);
const startTime = ref('09:00');
const endTime = ref('10:00');
const activityFee = ref<number | undefined>(undefined);
const activityCurrency = ref<string>(settingsStore.baseCurrency);
const activityAdded = ref(false);
/** Multi-select assignees — uses FamilyChipPicker mode="multi" so an
 *  activity can be tagged for one or more humans. Defaults to the owner. */
const assigneeIds = ref<string[]>(familyStore.owner?.id ? [familyStore.owner.id] : []);

interface AddedActivity {
  id: string;
  title: string;
  icon: string;
  category: ActivityCategory;
  memberNames: string;
  days: number[];
  startTime: string;
  endTime: string;
  fee?: number;
}
const addedActivities = ref<AddedActivity[]>([]);

watch(startTime, (newStart) => {
  if (newStart) endTime.value = addHourToTime(newStart);
});

function defaultAssigneeIds(): string[] {
  return familyStore.owner?.id ? [familyStore.owner.id] : [];
}

function resolveMemberNames(ids: string[]): string {
  // Use the full name (not first-word-only) so compound first names like
  // "Mary Lynn" or "Anne Marie" render correctly in the added-row meta line.
  return ids
    .map((id) => familyStore.members.find((m) => m.id === id)?.name?.trim() ?? '')
    .filter(Boolean)
    .join(', ');
}

function selectPreset(preset: ActivityPreset) {
  selectedPreset.value = preset;
  activityAdded.value = false;
  activityDays.value = [];
  startTime.value = '09:00';
  endTime.value = '10:00';
  activityFee.value = undefined;
  assigneeIds.value = defaultAssigneeIds();
}

async function handleAddActivity() {
  if (!selectedPreset.value) return;
  const ids = assigneeIds.value.length > 0 ? assigneeIds.value : defaultAssigneeIds();
  const creatorId = familyStore.owner?.id ?? ids[0];
  if (!creatorId || ids.length === 0) return;

  const today = new Date().toISOString().split('T')[0] as string;
  try {
    const created = await activityStore.createActivity({
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
      createdBy: creatorId,
      ...toAssigneePayload(ids),
    });
    if (!created) throw new Error('createActivity returned null');

    addedActivities.value.push({
      id: created.id,
      title: selectedPreset.value.defaultTitle,
      icon: selectedPreset.value.icon,
      category: selectedPreset.value.category,
      memberNames: resolveMemberNames(ids),
      days: [...activityDays.value],
      startTime: startTime.value,
      endTime: endTime.value,
      fee: activityFee.value,
    });
    activityAdded.value = true;
  } catch (e) {
    showToast('error', t('onboarding.errors.addActivityFailed'), undefined, {
      surface: ErrorSurfaces.onboardingAddActivity,
      error: e,
      context: {
        category: selectedPreset.value?.category ?? 'unknown',
        currency: activityCurrency.value,
      },
    });
  }
}

function handleAddAnother() {
  selectedPreset.value = null;
  activityAdded.value = false;
  activityDays.value = [];
  startTime.value = '09:00';
  endTime.value = '10:00';
  activityFee.value = undefined;
  assigneeIds.value = defaultAssigneeIds();
}

async function handleRemoveActivity(activityId: string) {
  try {
    await activityStore.deleteActivity(activityId);
    addedActivities.value = addedActivities.value.filter((a) => a.id !== activityId);
  } catch (e) {
    showToast('error', t('onboarding.errors.addActivityFailed'), undefined, {
      surface: ErrorSurfaces.onboardingAddActivity,
      error: e,
      context: { action: 'remove' },
    });
  }
}

function formatDaysShort(days: number[]): string {
  if (!days.length) return '';
  return days
    .sort((a, b) => a - b)
    .map((d) => SHORT_DAYS[d] || '')
    .join(', ');
}

function formatActivityMeta(activity: AddedActivity): string {
  const parts: string[] = [activity.memberNames];
  if (activity.days.length) parts.push(formatDaysShort(activity.days));
  if (activity.startTime) parts.push(formatTime12(activity.startTime));
  if (activity.fee) parts.push(`$${activity.fee}/mo`);
  return parts.filter(Boolean).join(' · ');
}
</script>

<template>
  <OnboardingStepShell>
    <template #decorations>
      <div class="ob-float-emoji" style="font-size: 24px; right: 50px; top: 36px">📅</div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 0.8s; font-size: 22px; left: 50px; top: 130px"
      >
        ⚽
      </div>
      <div
        class="ob-float-emoji"
        style="animation-delay: 0.4s; bottom: 100px; font-size: 20px; right: 60px"
      >
        🎨
      </div>
    </template>

    <OnboardingStepHeader
      icon="🌳"
      title-prefix-key="onboarding.activity.titlePrefix"
      title-highlight-key="onboarding.activity.titleHighlight"
      :current-step="5"
      :total-steps="6"
    />

    <div class="ob-section">
      <!-- Already-added rows always visible above the entry form -->
      <div v-if="addedActivities.length > 0" class="ob-added-list mb-3">
        <OnboardingAddedRow
          v-for="activity in addedActivities"
          :key="activity.id"
          :icon="activity.icon"
          :title="activity.title"
          :meta="formatActivityMeta(activity)"
          :tag="
            isBeanieMode
              ? getActivityCategoryName(activity.category).toLowerCase()
              : getActivityCategoryName(activity.category)
          "
          removable
          @remove="handleRemoveActivity(activity.id)"
        />
      </div>

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
          {{ isBeanieMode ? preset.label.toLowerCase() : preset.label }}
        </button>
      </div>

      <!-- Activity card on chip-select -->
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
            <div class="font-heading text-sm font-bold">
              {{
                isBeanieMode
                  ? selectedPreset.defaultTitle.toLowerCase()
                  : selectedPreset.defaultTitle
              }}
            </div>
          </div>
        </div>

        <div class="ob-days-member-time-row">
          <div class="ob-days-col">
            <div class="ob-detail-label">{{ t('onboarding.days') }}</div>
            <DayOfWeekSelector v-model="activityDays" />
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

        <!-- Multi-select assignee chips — matches the rest of the app
             (todos, planner) which use FamilyChipPicker for assignees. -->
        <div class="mt-3">
          <div class="ob-detail-label">{{ t('onboarding.assignee') }}</div>
          <FamilyChipPicker v-model="assigneeIds" mode="multi" compact />
        </div>

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

      <div v-if="activityAdded" class="mt-2 flex justify-end">
        <button class="ob-add-pill" @click="handleAddAnother">
          {{ t('onboarding.addAnother') }}
        </button>
      </div>
    </div>
  </OnboardingStepShell>
</template>
