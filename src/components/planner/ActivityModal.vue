<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import DayOfWeekSelector from '@/components/ui/DayOfWeekSelector.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import AmountInput from '@/components/ui/AmountInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { CATEGORY_COLORS } from '@/stores/activityStore';
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
}>();

const emit = defineEmits<{
  close: [];
  save: [data: CreateFamilyActivityInput | { id: string; data: UpdateFamilyActivityInput }];
  delete: [];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

// Activity icon chip options — emoji→category mapping
const ACTIVITY_ICON_OPTIONS = [
  { value: '⚽', label: 'Sport', icon: '⚽', category: 'sport' as ActivityCategory },
  { value: '🎹', label: 'Music', icon: '🎹', category: 'lesson' as ActivityCategory },
  { value: '🏊', label: 'Swimming', icon: '🏊', category: 'sport' as ActivityCategory },
  { value: '🥋', label: 'Martial Arts', icon: '🥋', category: 'sport' as ActivityCategory },
  { value: '🤸', label: 'Gymnastics', icon: '🤸', category: 'sport' as ActivityCategory },
  { value: '📚', label: 'Tutoring', icon: '📚', category: 'lesson' as ActivityCategory },
  { value: '🎨', label: 'Art', icon: '🎨', category: 'lesson' as ActivityCategory },
  { value: '🏥', label: 'Medical', icon: '🏥', category: 'appointment' as ActivityCategory },
  { value: '🎓', label: 'Education', icon: '🎓', category: 'lesson' as ActivityCategory },
  { value: '🎸', label: 'Guitar', icon: '🎸', category: 'lesson' as ActivityCategory },
  { value: '🔬', label: 'Science', icon: '🔬', category: 'lesson' as ActivityCategory },
  { value: '✈️', label: 'Travel', icon: '✈️', category: 'other' as ActivityCategory },
  { value: '📦', label: 'Other', icon: '📦', category: 'other' as ActivityCategory },
];

// Form state
const icon = ref('');
const title = ref('');
const description = ref('');
const date = ref('');
const startTime = ref('');
const endTime = ref('');
const recurrenceMode = ref<'recurring' | 'one-off'>('recurring');
const recurrenceFrequency = ref<'weekly' | 'biweekly' | 'monthly'>('weekly');
const daysOfWeek = ref<number[]>([]);
const category = ref<ActivityCategory>('lesson');
const assigneeIds = ref<string[]>([]);
const dropoffMemberId = ref<string>('');
const pickupMemberId = ref<string>('');
const location = ref('');
const feeSchedule = ref<FeeSchedule>('none');
const feeAmount = ref<number | undefined>(undefined);
const feeCurrency = ref('');
const feePayerId = ref<string>('');
const instructorName = ref('');
const instructorContact = ref('');
const reminderMinutes = ref<ReminderMinutes>(0);
const notes = ref('');
const isActive = ref(true);
const color = ref('');

// Map recurrence mode + frequency to ActivityRecurrence
const effectiveRecurrence = computed<ActivityRecurrence>(() => {
  if (recurrenceMode.value === 'one-off') return 'none';
  return recurrenceFrequency.value === 'biweekly' ? 'weekly' : recurrenceFrequency.value;
});

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
      category.value = activity.category;
      assigneeIds.value = activity.assigneeId ? [activity.assigneeId] : [];
      dropoffMemberId.value = activity.dropoffMemberId ?? '';
      pickupMemberId.value = activity.pickupMemberId ?? '';
      location.value = activity.location ?? '';
      feeSchedule.value = activity.feeSchedule;
      feeAmount.value = activity.feeAmount;
      feeCurrency.value = activity.feeCurrency ?? settingsStore.baseCurrency;
      feePayerId.value = activity.feePayerId ?? '';
      instructorName.value = activity.instructorName ?? '';
      instructorContact.value = activity.instructorContact ?? '';
      reminderMinutes.value = activity.reminderMinutes;
      notes.value = activity.notes ?? '';
      isActive.value = activity.isActive;
      color.value = activity.color ?? CATEGORY_COLORS[activity.category];
    },
    onNew: () => {
      icon.value = '';
      title.value = '';
      description.value = '';
      date.value = props.defaultDate ?? todayStr();
      startTime.value = props.defaultStartTime ?? '09:00';
      endTime.value = '';
      recurrenceMode.value = 'recurring';
      recurrenceFrequency.value = 'weekly';
      daysOfWeek.value = [];
      category.value = 'lesson';
      assigneeIds.value = [];
      dropoffMemberId.value = '';
      pickupMemberId.value = '';
      location.value = '';
      feeSchedule.value = 'none';
      feeAmount.value = undefined;
      feeCurrency.value = settingsStore.baseCurrency;
      feePayerId.value = '';
      instructorName.value = '';
      instructorContact.value = '';
      reminderMinutes.value = 0;
      notes.value = '';
      isActive.value = true;
      color.value = '';
    },
  }
);

// When icon changes, derive category
watch(icon, (newIcon) => {
  if (!newIcon) return;
  const match = ACTIVITY_ICON_OPTIONS.find((e) => e.value === newIcon);
  if (match) {
    category.value = match.category;
    color.value = CATEGORY_COLORS[match.category];
  }
});

// Auto-set daysOfWeek from date if empty
watch(date, (newDate) => {
  if (newDate && daysOfWeek.value.length === 0 && recurrenceMode.value === 'recurring') {
    const d = new Date(newDate + 'T00:00:00');
    daysOfWeek.value = [d.getDay()];
  }
});

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const feeScheduleChipOptions = computed(() =>
  (['none', 'per_session', 'weekly', 'monthly', 'termly', 'yearly'] as FeeSchedule[]).map((f) => ({
    value: f,
    label: t(`planner.fee.${f}` as const),
  }))
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
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: t('planner.recurrence.monthly') },
];

const canSave = computed(() => title.value.trim().length > 0 && date.value.length > 0);

const modalTitle = computed(() =>
  isEditing.value ? t('planner.editActivity') : t('planner.newActivity')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveActivity') : t('modal.addActivity')
);

function handleSave() {
  if (!canSave.value) return;

  const currentMember = familyStore.currentMember ?? familyStore.owner;
  const primaryAssignee = assigneeIds.value[0] || undefined;

  const baseData = {
    title: title.value.trim(),
    icon: icon.value || undefined,
    description: description.value.trim() || undefined,
    date: date.value,
    startTime: startTime.value || undefined,
    endTime: endTime.value || undefined,
    recurrence: effectiveRecurrence.value,
    daysOfWeek:
      recurrenceMode.value === 'recurring' && effectiveRecurrence.value === 'weekly'
        ? [...daysOfWeek.value]
        : undefined,
    category: category.value,
    assigneeId: primaryAssignee,
    dropoffMemberId: dropoffMemberId.value || undefined,
    pickupMemberId: pickupMemberId.value || undefined,
    location: location.value.trim() || undefined,
    feeSchedule: feeAmount.value ? ('per_session' as FeeSchedule) : feeSchedule.value,
    feeAmount: feeAmount.value || (feeSchedule.value !== 'none' ? feeAmount.value : undefined),
    feeCurrency: feeAmount.value || feeSchedule.value !== 'none' ? feeCurrency.value : undefined,
    feePayerId: feeSchedule.value !== 'none' ? feePayerId.value || undefined : undefined,
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
    :save-label="saveLabel"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="emit('delete')"
  >
    <!-- 1. Icon Picker -->
    <FormFieldGroup :label="t('modal.selectCategory')">
      <FrequencyChips v-model="icon" :options="ACTIVITY_ICON_OPTIONS" />
    </FormFieldGroup>

    <!-- 2. Title -->
    <div>
      <input
        v-model="title"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-[1.2rem] font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('modal.whatsTheActivity')"
      />
    </div>

    <!-- 3. Recurring / One-off toggle -->
    <FormFieldGroup :label="t('modal.schedule')">
      <TogglePillGroup
        v-model="recurrenceMode"
        :options="[
          { value: 'recurring', label: t('modal.recurring') },
          { value: 'one-off', label: t('modal.oneOff') },
        ]"
      />
    </FormFieldGroup>

    <!-- 4. Recurring details -->
    <ConditionalSection :show="recurrenceMode === 'recurring'">
      <div class="space-y-4">
        <FormFieldGroup :label="t('modal.whichDays')">
          <DayOfWeekSelector v-model="daysOfWeek" />
        </FormFieldGroup>

        <FormFieldGroup :label="t('modal.howOften')">
          <FrequencyChips v-model="recurrenceFrequency" :options="frequencyOptions" />
        </FormFieldGroup>
      </div>
    </ConditionalSection>

    <!-- 5. Date + Start / End time -->
    <div class="grid grid-cols-3 gap-4">
      <FormFieldGroup :label="t('planner.field.date')">
        <BaseInput v-model="date" type="date" required />
      </FormFieldGroup>

      <FormFieldGroup :label="t('modal.startTime')">
        <TimePresetPicker v-model="startTime" />
      </FormFieldGroup>

      <FormFieldGroup :label="t('modal.endTime')">
        <TimePresetPicker v-model="endTime" />
      </FormFieldGroup>
    </div>

    <!-- 7. Location (optional) -->
    <FormFieldGroup :label="t('planner.field.location')" optional>
      <BaseInput v-model="location" :placeholder="t('planner.field.location')" />
    </FormFieldGroup>

    <!-- 8. Who's going? -->
    <FormFieldGroup :label="t('modal.whosGoing')">
      <FamilyChipPicker v-model="assigneeIds" mode="multi" />
    </FormFieldGroup>

    <!-- 9. Dropoff / Pickup -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormFieldGroup :label="t('planner.field.dropoff')" optional>
        <FamilyChipPicker v-model="dropoffMemberId" mode="single" compact />
      </FormFieldGroup>
      <FormFieldGroup :label="t('planner.field.pickup')" optional>
        <FamilyChipPicker v-model="pickupMemberId" mode="single" compact />
      </FormFieldGroup>
    </div>

    <!-- 10. Instructor -->
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

    <!-- 11. Cost per session -->
    <AmountInput
      v-model="feeAmount"
      :currency-symbol="settingsStore.baseCurrency"
      font-size="1.1rem"
      :label="t('modal.costPerSession')"
    />

    <!-- 12. Fee schedule chips -->
    <FormFieldGroup :label="t('planner.field.feeSchedule')" optional>
      <FrequencyChips v-model="feeSchedule" :options="feeScheduleChipOptions" />
    </FormFieldGroup>

    <!-- 13. Fee payer (when fee is set) -->
    <ConditionalSection :show="feeSchedule !== 'none'">
      <FormFieldGroup :label="t('planner.field.feePayer')" optional>
        <FamilyChipPicker v-model="feePayerId" mode="single" compact />
      </FormFieldGroup>
    </ConditionalSection>

    <!-- 14. Reminder chips -->
    <FormFieldGroup :label="t('planner.field.reminder')" optional>
      <FrequencyChips
        :model-value="String(reminderMinutes)"
        :options="reminderChipOptions"
        @update:model-value="reminderMinutes = Number($event) as ReminderMinutes"
      />
    </FormFieldGroup>

    <!-- 15. Notes (optional) -->
    <FormFieldGroup :label="t('planner.field.notes')" optional>
      <textarea
        v-model="notes"
        rows="2"
        class="focus:border-primary-500 w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm text-[var(--color-text)] transition-all focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
        :placeholder="t('planner.field.notes')"
      />
    </FormFieldGroup>

    <!-- 16. Active toggle -->
    <div
      class="flex items-center justify-between rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
    >
      <span
        class="font-outfit text-[0.8rem] font-semibold text-[var(--color-text)] dark:text-gray-200"
      >
        {{ t('planner.field.active') }}
      </span>
      <ToggleSwitch v-model="isActive" size="sm" />
    </div>
  </BeanieFormModal>
</template>
