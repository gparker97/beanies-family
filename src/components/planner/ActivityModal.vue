<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import AssigneePickerButton from '@/components/ui/AssigneePickerButton.vue';
import CurrencyAmountInput from '@/components/ui/CurrencyAmountInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ActivityCategoryPicker from '@/components/ui/ActivityCategoryPicker.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import RecurringPaymentPrompt from '@/components/ui/RecurringPaymentPrompt.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { calculateMonthlyFee } from '@/utils/finance';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { getActivityCategoryColor, getActivityFallbackEmoji } from '@/constants/activityCategories';
import { addHourToTime, formatNookDate } from '@/utils/date';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
import type {
  FamilyActivity,
  ActivityCategory,
  ActivityRecurrence,
  FeeSchedule,
  ReminderMinutes,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  activity?: FamilyActivity | null;
  defaultDate?: string;
  defaultStartTime?: string;
  readOnly?: boolean;
  occurrenceDate?: string;
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }];
  delete: [];
  'start-vacation-wizard': [defaults: { assigneeIds: string[]; date: string }];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

// Form state
const icon = ref('');
const title = ref('');
const description = ref('');
const date = ref('');
const endDate = ref('');
const isAllDay = ref(false);
const startTime = ref('');
const endTime = ref('');
const recurrenceMode = ref<'recurring' | 'one-off'>('recurring');
const recurrenceFrequency = ref<'weekly' | 'monthly'>('weekly');
const daysOfWeek = ref<number[]>([]);
const recurrenceEndDate = ref('');
const category = ref<ActivityCategory>('' as ActivityCategory);
const assigneeIds = ref<string[]>([]);
const dropoffMemberId = ref<string>('');
const pickupMemberId = ref<string>('');
const location = ref('');
const feeSchedule = ref<FeeSchedule>('none');
const feeAmount = ref<number | undefined>(undefined);
const feeCurrency = ref('');
const feeCustomPeriod = ref<number | undefined>(undefined);
const feeCustomPeriodUnit = ref<'weeks' | 'months'>('weeks');
const createRecurringPayment = ref(false);
const feePayFromAccountId = ref('');
const instructorName = ref('');
const instructorContact = ref('');
const reminderMinutes = ref<ReminderMinutes>(0);
const notes = ref('');
const isActive = ref(true);
const color = ref('');
const showMoreDetails = ref(false);
const showErrors = ref(false);

// Map recurrence mode + frequency to ActivityRecurrence
const effectiveRecurrence = computed<ActivityRecurrence>(() => {
  if (recurrenceMode.value === 'one-off') return 'none';
  return recurrenceFrequency.value;
});

// Check if any "more details" field has data (for auto-expand in edit mode)
function hasDetailData(activity: FamilyActivity): boolean {
  return !!(
    activity.notes ||
    activity.instructorName ||
    activity.instructorContact ||
    (activity.feeAmount && activity.feeAmount > 0) ||
    activity.reminderMinutes > 0 ||
    !activity.isActive
  );
}

// Reset form when modal opens
const { isEditing, isSubmitting } = useFormModal(
  () => props.activity,
  () => props.open,
  {
    onEdit: (activity) => {
      icon.value = activity.icon ?? '';
      title.value = activity.title;
      description.value = activity.description ?? '';
      date.value = activity.date;
      endDate.value = activity.endDate ?? '';
      isAllDay.value = activity.isAllDay ?? false;
      startTime.value = activity.startTime ?? '';
      endTime.value = activity.endTime ?? '';
      recurrenceMode.value = activity.recurrence === 'none' ? 'one-off' : 'recurring';
      recurrenceFrequency.value =
        activity.recurrence === 'monthly'
          ? 'monthly'
          : activity.recurrence === 'weekly'
            ? 'weekly'
            : 'weekly';
      daysOfWeek.value = activity.daysOfWeek ?? [];
      recurrenceEndDate.value = activity.recurrenceEndDate ?? '';
      category.value = activity.category;
      assigneeIds.value = normalizeAssignees(activity);
      dropoffMemberId.value = activity.dropoffMemberId ?? '';
      pickupMemberId.value = activity.pickupMemberId ?? '';
      location.value = activity.location ?? '';
      feeSchedule.value = activity.feeSchedule === 'none' ? 'per_session' : activity.feeSchedule;
      feeAmount.value = activity.feeAmount ?? 0;
      feeCurrency.value = activity.feeCurrency ?? settingsStore.displayCurrency;
      createRecurringPayment.value = !!activity.linkedRecurringItemId;
      feePayFromAccountId.value = activity.payFromAccountId ?? '';
      feeCustomPeriod.value = activity.feeCustomPeriod;
      feeCustomPeriodUnit.value = activity.feeCustomPeriodUnit ?? 'weeks';
      instructorName.value = activity.instructorName ?? '';
      instructorContact.value = activity.instructorContact ?? '';
      reminderMinutes.value = activity.reminderMinutes;
      notes.value = activity.notes ?? '';
      isActive.value = activity.isActive;
      color.value = activity.color ?? getActivityCategoryColor(activity.category);
      showMoreDetails.value = hasDetailData(activity);
      showErrors.value = false;
    },
    onNew: () => {
      icon.value = '';
      title.value = '';
      description.value = '';
      date.value = props.defaultDate ?? todayStr();
      endDate.value = '';
      isAllDay.value = false;
      startTime.value = props.defaultStartTime ?? '09:00';
      endTime.value = addHourToTime(startTime.value);
      recurrenceMode.value = 'recurring';
      recurrenceFrequency.value = 'weekly';
      daysOfWeek.value = [];
      recurrenceEndDate.value = '';
      category.value = '' as ActivityCategory;
      assigneeIds.value = [];
      dropoffMemberId.value = '';
      pickupMemberId.value = '';
      location.value = '';
      feeSchedule.value = 'per_session';
      feeAmount.value = 0;
      feeCurrency.value = settingsStore.displayCurrency;
      createRecurringPayment.value = false;
      feePayFromAccountId.value = '';
      feeCustomPeriod.value = undefined;
      feeCustomPeriodUnit.value = 'weeks';
      instructorName.value = '';
      instructorContact.value = '';
      reminderMinutes.value = 0;
      notes.value = '';
      isActive.value = true;
      color.value = '';
      showMoreDetails.value = false;
      showErrors.value = false;
    },
  }
);

// When category changes, auto-set icon and color
watch(category, (newCategory) => {
  if (!newCategory) return;
  icon.value = getActivityFallbackEmoji(newCategory);
  color.value = getActivityCategoryColor(newCategory);
});

// Auto-set daysOfWeek from date if empty
watch(date, (newDate) => {
  if (newDate && daysOfWeek.value.length === 0 && recurrenceMode.value === 'recurring') {
    const d = new Date(newDate + 'T00:00:00');
    daysOfWeek.value = [d.getDay()];
  }
});

// Sync endTime when startTime changes (skip during edit population)
let suppressEndTimeSync = false;
watch(
  () => props.open,
  (open) => {
    if (open && props.activity) {
      // Suppress the startTime watcher during edit population
      suppressEndTimeSync = true;
      nextTick(() => {
        suppressEndTimeSync = false;
      });
    }
  }
);
watch(startTime, (newStart) => {
  if (suppressEndTimeSync || !newStart) return;
  endTime.value = addHourToTime(newStart);
});
// Clamp endTime to not be before startTime
watch(endTime, (newEnd) => {
  if (!newEnd || !startTime.value) return;
  if (newEnd < startTime.value) {
    endTime.value = startTime.value;
  }
});

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const feeScheduleChipOptions = computed(() =>
  (['per_session', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'] as FeeSchedule[]).map(
    (f) => ({
      value: f,
      label: t(`planner.fee.${f}` as const),
    })
  )
);

const reminderChipOptions = [
  { value: '0', label: 'None' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '1440', label: '1 day' },
];

const frequencyOptions = [
  { value: 'weekly', label: t('planner.recurrence.weekly') },
  { value: 'monthly', label: t('planner.recurrence.monthly') },
];

const hasCost = computed(() => (feeAmount.value ?? 0) > 0);

const calculatedMonthly = computed(() => {
  if (!hasCost.value || feeSchedule.value === 'none') return 0;
  return calculateMonthlyFee({
    feeSchedule: feeSchedule.value,
    feeAmount: feeAmount.value ?? 0,
    sessionsPerWeek: daysOfWeek.value.length || 1,
    feeCustomPeriod: feeCustomPeriod.value,
    feeCustomPeriodUnit: feeCustomPeriodUnit.value,
  });
});

const canSave = computed(() => {
  if (!title.value.trim() || !date.value) return false;
  if (assigneeIds.value.length === 0) return false;
  if (hasCost.value && feeSchedule.value === 'none') return false;
  if (
    hasCost.value &&
    feeSchedule.value === 'custom' &&
    (!feeCustomPeriod.value || feeCustomPeriod.value <= 0)
  )
    return false;
  return true;
});

// Per-field error flags (only visible after attempted save)
const errorAssignees = computed(() => showErrors.value && assigneeIds.value.length === 0);
const errorTitle = computed(() => showErrors.value && !title.value.trim());
const errorDate = computed(() => showErrors.value && !date.value);

const modalTitle = computed(() =>
  isEditing.value ? t('planner.editActivity') : t('planner.newActivity')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveActivity') : t('modal.addActivity')
);

function handleSave() {
  if (!canSave.value) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;

  const currentMember = familyStore.currentMember ?? familyStore.owner;
  const assigneePayload = toAssigneePayload(assigneeIds.value);

  const baseData = {
    title: title.value.trim(),
    icon: icon.value || undefined,
    description: description.value.trim() || undefined,
    date: date.value,
    endDate: isAllDay.value && endDate.value ? endDate.value : undefined,
    isAllDay: isAllDay.value || undefined,
    startTime: isAllDay.value ? undefined : startTime.value || undefined,
    endTime: isAllDay.value ? undefined : endTime.value || undefined,
    recurrence: effectiveRecurrence.value,
    daysOfWeek:
      recurrenceMode.value === 'recurring' && effectiveRecurrence.value === 'weekly'
        ? [...daysOfWeek.value]
        : undefined,
    recurrenceEndDate:
      recurrenceMode.value === 'recurring' && recurrenceEndDate.value
        ? recurrenceEndDate.value
        : undefined,
    category: category.value,
    ...assigneePayload,
    dropoffMemberId: dropoffMemberId.value || undefined,
    pickupMemberId: pickupMemberId.value || undefined,
    location: location.value.trim() || undefined,
    feeSchedule: hasCost.value ? feeSchedule.value : ('none' as FeeSchedule),
    feeAmount: hasCost.value ? feeAmount.value : undefined,
    feeCurrency: hasCost.value ? feeCurrency.value : undefined,
    ...(hasCost.value && feeSchedule.value === 'custom' && feeCustomPeriod.value
      ? { feeCustomPeriod: feeCustomPeriod.value, feeCustomPeriodUnit: feeCustomPeriodUnit.value }
      : {}),
    ...(hasCost.value && createRecurringPayment.value && feePayFromAccountId.value
      ? { payFromAccountId: feePayFromAccountId.value }
      : { payFromAccountId: '' }),
    instructorName: instructorName.value.trim() || undefined,
    instructorContact: instructorContact.value.trim() || undefined,
    reminderMinutes: reminderMinutes.value,
    notes: notes.value.trim() || undefined,
    isActive: isActive.value,
    color: color.value || undefined,
  };

  if (isEditing.value && props.activity) {
    emit('save', { id: props.activity.id, data: baseData as UpdateFamilyActivityInput });
  } else {
    emit('save', {
      ...baseData,
      createdBy: currentMember?.id ?? '',
    } as CreateFamilyActivityInput);
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    :icon="icon || '📋'"
    icon-bg="var(--tint-orange-8)"
    :save-label="readOnly ? t('action.close') : saveLabel"
    :save-disabled="false"
    :is-submitting="isSubmitting"
    :show-delete="isEditing && !readOnly"
    @close="emit('close')"
    @save="readOnly ? emit('close') : handleSave()"
    @delete="emit('delete')"
  >
    <div class="space-y-5" :class="readOnly ? 'pointer-events-none opacity-60' : ''">
      <!-- Occurrence date banner for recurring activity edits -->
      <div
        v-if="occurrenceDate"
        class="mb-4 rounded-[14px] bg-[var(--tint-silk-20)] px-4 py-3 dark:bg-sky-900/20"
      >
        <div class="flex items-center gap-2">
          <span class="text-base">📅</span>
          <span
            class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
          >
            {{ t('planner.editingOccurrence').replace('{date}', formatNookDate(occurrenceDate)) }}
          </span>
        </div>
      </div>

      <!-- Vacation toggle bar -->
      <div
        v-if="!isEditing"
        class="cursor-pointer rounded-2xl border px-4 py-3 transition-all duration-200 hover:shadow-sm"
        style="
          background: linear-gradient(135deg, rgb(0 180 216 / 12%), rgb(255 217 61 / 10%));
          border-color: rgb(0 180 216 / 18%);
        "
        @click="
          emit('start-vacation-wizard', {
            assigneeIds: [...assigneeIds],
            date: date,
          });
          emit('close');
        "
      >
        <div class="flex items-center gap-3">
          <span class="text-xl" style="animation: sway 3s ease-in-out infinite">🏖️</span>
          <div class="min-w-0 flex-1">
            <span
              class="font-outfit block text-xs font-semibold"
              style="color: var(--vacation-teal)"
            >
              {{ t('vacation.planningATrip') }}
            </span>
            <span class="block text-[10px] text-[var(--color-text-muted)] opacity-60">
              {{ t('vacation.planningSubtitle') }}
            </span>
          </div>
          <span class="text-sm font-semibold" style="color: var(--vacation-teal)">›</span>
        </div>
      </div>

      <!-- 1. Who? -->
      <FormFieldGroup :label="t('modal.whosGoing')" required :error="errorAssignees">
        <FamilyChipPicker v-model="assigneeIds" mode="multi" />
      </FormFieldGroup>

      <!-- 1b. Schedule mode tab bar (recurring / one-time) -->
      <div class="rounded-2xl bg-[var(--tint-slate-5)] p-1.5 dark:bg-slate-700/50">
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="opt in [
              {
                value: 'recurring',
                icon: '🔁',
                label: t('vacation.scheduleRecurring'),
                desc: t('vacation.scheduleRecurringDesc'),
              },
              {
                value: 'one-off',
                icon: '📌',
                label: t('vacation.scheduleOneTime'),
                desc: t('vacation.scheduleOneTimeDesc'),
              },
            ]"
            :key="opt.value"
            type="button"
            class="relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-2.5 transition-all duration-200"
            :class="
              recurrenceMode === opt.value
                ? 'border-primary-500 border-2 bg-white shadow-sm dark:bg-slate-600'
                : 'border-2 border-transparent hover:bg-white/60 dark:hover:bg-slate-600/40'
            "
            @click="recurrenceMode = opt.value as 'recurring' | 'one-off'"
          >
            <span class="text-lg leading-none">{{ opt.icon }}</span>
            <span
              class="font-outfit text-xs font-bold"
              :class="
                recurrenceMode === opt.value
                  ? 'text-[var(--color-text)] dark:text-gray-100'
                  : 'text-[var(--color-text)] opacity-35 dark:text-gray-400'
              "
            >
              {{ opt.label }}
            </span>
            <span
              class="text-[10px]"
              :class="
                recurrenceMode === opt.value
                  ? 'text-[var(--color-text-muted)]'
                  : 'opacity-25 dark:text-gray-500'
              "
            >
              {{ opt.desc }}
            </span>
            <span
              v-if="recurrenceMode === opt.value"
              class="bg-primary-500 absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
            />
          </button>
        </div>
      </div>

      <!-- 2. Category picker (grouped) -->
      <FormFieldGroup :label="t('modal.selectCategory')">
        <ActivityCategoryPicker v-model="category" />
      </FormFieldGroup>

      <!-- 3. Activity title (styled wrapper) -->
      <FormFieldGroup :label="t('modal.whatsTheActivity')" required :error="errorTitle">
        <div
          class="focus-within:border-primary-500 rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] dark:bg-slate-700"
        >
          <input
            v-model="title"
            type="text"
            class="font-outfit w-full border-none bg-transparent text-xl font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
            :placeholder="t('modal.whatsTheActivity')"
          />
        </div>
      </FormFieldGroup>

      <!-- 3b. Cost + Fee Schedule -->
      <FormFieldGroup :label="t('modal.costPerSession')">
        <CurrencyAmountInput
          v-model:amount="feeAmount"
          v-model:currency="feeCurrency"
          font-size="1.1rem"
        />
      </FormFieldGroup>
      <FormFieldGroup :label="t('planner.field.feeSchedule')">
        <FrequencyChips v-model="feeSchedule" :options="feeScheduleChipOptions" />
      </FormFieldGroup>

      <!-- Custom period inputs -->
      <div v-if="feeSchedule === 'custom'" class="flex items-center gap-2">
        <span class="font-outfit text-xs font-semibold text-[var(--color-text)]">{{
          t('planner.fee.customPeriod')
        }}</span>
        <BaseInput v-model.number="feeCustomPeriod" type="number" min="1" class="w-20" />
        <TogglePillGroup
          v-model="feeCustomPeriodUnit"
          :options="[
            { value: 'weeks', label: t('planner.fee.weeks') },
            { value: 'months', label: t('planner.fee.months') },
          ]"
        />
      </div>

      <!-- Calculated monthly display -->
      <div
        v-if="
          hasCost && feeSchedule !== 'none' && feeSchedule !== 'monthly' && calculatedMonthly > 0
        "
        class="flex items-center gap-2"
      >
        <span
          class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
        >
          {{ t('planner.fee.calculatedMonthly') }}
        </span>
        <span class="font-outfit text-sm font-bold text-[var(--color-text)]">
          {{ formatCurrencyWithCode(calculatedMonthly, (feeCurrency || 'USD') as any) }}/mo
        </span>
        <InfoHintBadge :text="t('planner.fee.monthlyCalcHint')" />
      </div>

      <!-- Recurring payment prompt -->
      <RecurringPaymentPrompt
        v-if="hasCost && feeSchedule !== 'none'"
        v-model="createRecurringPayment"
        :pay-from-account-id="feePayFromAccountId"
        :payment-amount="calculatedMonthly"
        :currency="feeCurrency || 'USD'"
        :start-date="date"
        frequency="monthly"
        @update:pay-from-account-id="feePayFromAccountId = $event"
      />

      <!-- 4. Recurring frequency + day-of-week (shown only for recurring mode) -->
      <template v-if="recurrenceMode === 'recurring'">
        <FormFieldGroup :label="t('modal.schedule')">
          <div class="space-y-3">
            <FrequencyChips v-model="recurrenceFrequency" :options="frequencyOptions" />
            <DayOfWeekSelector v-if="recurrenceFrequency === 'weekly'" v-model="daysOfWeek" />
          </div>
        </FormFieldGroup>
      </template>

      <!-- 5b. All-day toggle -->
      <FormFieldGroup :label="t('planner.allDay')">
        <label class="inline-flex cursor-pointer items-center gap-2.5">
          <input
            v-model="isAllDay"
            type="checkbox"
            class="text-primary-500 focus:ring-primary-500/30 h-5 w-5 rounded-lg border-gray-300 transition dark:border-slate-600 dark:bg-slate-700"
          />
          <span class="text-sm text-[var(--color-text-muted)]">
            {{ t('planner.allDayHint') }}
          </span>
        </label>
      </FormFieldGroup>

      <!-- 6. Date + Times -->
      <!-- Recurring: Start Date / End Date row, then Start Time / End Time row -->
      <template v-if="recurrenceMode === 'recurring'">
        <div class="grid grid-cols-2 gap-4">
          <FormFieldGroup :label="t('planner.field.date')" required :error="errorDate">
            <BaseInput v-model="date" type="date" required />
          </FormFieldGroup>
          <FormFieldGroup :label="t('planner.field.endDate')" optional>
            <BaseInput v-model="recurrenceEndDate" type="date" :min="date" />
          </FormFieldGroup>
        </div>
        <div v-if="!isAllDay" class="grid grid-cols-2 gap-4">
          <FormFieldGroup :label="t('modal.startTime')">
            <TimePresetPicker v-model="startTime" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('modal.endTime')">
            <TimePresetPicker v-model="endTime" />
          </FormFieldGroup>
        </div>
      </template>
      <!-- One-off: Date (+ optional end date if all-day), or Date + times -->
      <template v-else>
        <div v-if="isAllDay" class="grid grid-cols-2 gap-4">
          <FormFieldGroup :label="t('planner.field.dateOnly')" required :error="errorDate">
            <BaseInput v-model="date" type="date" required />
          </FormFieldGroup>
          <FormFieldGroup :label="t('planner.field.endDate')" optional>
            <BaseInput v-model="endDate" type="date" :min="date" />
          </FormFieldGroup>
        </div>
        <div v-else class="grid grid-cols-3 gap-3">
          <FormFieldGroup :label="t('planner.field.dateOnly')" required :error="errorDate">
            <BaseInput v-model="date" type="date" required />
          </FormFieldGroup>
          <FormFieldGroup :label="t('modal.startTime')">
            <TimePresetPicker v-model="startTime" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('modal.endTime')">
            <TimePresetPicker v-model="endTime" />
          </FormFieldGroup>
        </div>
      </template>

      <!-- 7. Location -->
      <FormFieldGroup :label="t('planner.field.location')" optional>
        <BaseInput v-model="location" :placeholder="t('planner.field.location')" />
      </FormFieldGroup>

      <!-- 8. Drop Off Duty / Pick Up Duty -->
      <div class="grid grid-cols-2 gap-4">
        <FormFieldGroup :label="t('planner.field.dropoff')" optional>
          <AssigneePickerButton v-model="dropoffMemberId" mode="single" size="sm" align="left" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('planner.field.pickup')" optional>
          <AssigneePickerButton v-model="pickupMemberId" mode="single" size="sm" align="right" />
        </FormFieldGroup>
      </div>

      <!-- 9. "Add more details" collapsible -->
      <div>
        <button
          type="button"
          class="font-outfit text-primary-500 text-sm font-semibold transition-colors hover:underline"
          @click="showMoreDetails = !showMoreDetails"
        >
          {{ t('planner.field.moreDetails') }}
          <span
            class="ml-1 inline-block transition-transform"
            :class="{ 'rotate-180': showMoreDetails }"
            >&#9662;</span
          >
        </button>

        <div v-if="showMoreDetails" class="mt-3 space-y-4">
          <!-- Instructor -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormFieldGroup :label="t('planner.field.instructor')" optional>
              <BaseInput v-model="instructorName" :placeholder="t('planner.field.instructor')" />
            </FormFieldGroup>
            <FormFieldGroup :label="t('planner.field.instructorContact')" optional>
              <BaseInput
                v-model="instructorContact"
                :placeholder="t('planner.field.instructorContact')"
              />
            </FormFieldGroup>
          </div>

          <!-- Notes -->
          <FormFieldGroup :label="t('planner.field.notes')" optional>
            <textarea
              v-model="notes"
              rows="2"
              class="focus:border-primary-500 w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm text-[var(--color-text)] transition-all focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
              :placeholder="t('planner.field.notes')"
            />
          </FormFieldGroup>

          <!-- Reminder chips -->
          <FormFieldGroup :label="t('planner.field.reminder')" optional>
            <FrequencyChips
              :model-value="String(reminderMinutes)"
              :options="reminderChipOptions"
              @update:model-value="reminderMinutes = Number($event) as ReminderMinutes"
            />
          </FormFieldGroup>

          <!-- Active toggle -->
          <div
            class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
          >
            <span
              class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-200"
            >
              {{ t('planner.field.active') }}
            </span>
            <ToggleSwitch v-model="isActive" size="sm" />
          </div>
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
