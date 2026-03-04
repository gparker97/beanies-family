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
import GroupedChipPicker from '@/components/ui/GroupedChipPicker.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { CATEGORY_COLORS } from '@/stores/activityStore';
import type { ChipGroup } from '@/components/ui/GroupedChipPicker.vue';
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

// Activity icon chip options — emoji→category mapping (flat for lookups)
const ACTIVITY_ICON_OPTIONS = [
  { value: '⚽', label: 'Soccer', icon: '⚽', category: 'sport' as ActivityCategory },
  { value: '🏈', label: 'Football', icon: '🏈', category: 'sport' as ActivityCategory },
  { value: '⚾', label: 'Baseball', icon: '⚾', category: 'sport' as ActivityCategory },
  { value: '🏊', label: 'Swimming', icon: '🏊', category: 'sport' as ActivityCategory },
  { value: '🥋', label: 'Martial Arts', icon: '🥋', category: 'sport' as ActivityCategory },
  { value: '🤸', label: 'Gymnastics', icon: '🤸', category: 'sport' as ActivityCategory },
  { value: '🏃', label: 'Other', icon: '🏃', category: 'sport' as ActivityCategory },
  { value: '🎹', label: 'Piano', icon: '🎹', category: 'lesson' as ActivityCategory },
  { value: '📚', label: 'Tutoring', icon: '📚', category: 'lesson' as ActivityCategory },
  { value: '🎨', label: 'Art', icon: '🎨', category: 'lesson' as ActivityCategory },
  { value: '🧮', label: 'Math', icon: '🧮', category: 'lesson' as ActivityCategory },
  { value: '🌐', label: 'Language', icon: '🌐', category: 'lesson' as ActivityCategory },
  { value: '🎸', label: 'Guitar', icon: '🎸', category: 'lesson' as ActivityCategory },
  { value: '🔬', label: 'Science', icon: '🔬', category: 'lesson' as ActivityCategory },
  { value: '📓', label: 'Other', icon: '📓', category: 'lesson' as ActivityCategory },
  { value: '🏥', label: 'Medical', icon: '🏥', category: 'appointment' as ActivityCategory },
  { value: '🦷', label: 'Dental', icon: '🦷', category: 'appointment' as ActivityCategory },
  { value: '📝', label: 'Other', icon: '📝', category: 'appointment' as ActivityCategory },
  { value: '✈️', label: 'Travel', icon: '✈️', category: 'other' as ActivityCategory },
  { value: '📦', label: 'Other', icon: '📦', category: 'other' as ActivityCategory },
];

// Grouped icon options for the GroupedChipPicker
const ACTIVITY_ICON_GROUPS: ChipGroup[] = [
  {
    name: 'Sport',
    icon: '🏅',
    items: [
      { value: '⚽', label: 'Soccer', icon: '⚽' },
      { value: '🏈', label: 'Football', icon: '🏈' },
      { value: '⚾', label: 'Baseball', icon: '⚾' },
      { value: '🏊', label: 'Swimming', icon: '🏊' },
      { value: '🥋', label: 'Martial Arts', icon: '🥋' },
      { value: '🤸', label: 'Gymnastics', icon: '🤸' },
      { value: '🏃', label: 'Other', icon: '🏃' },
    ],
  },
  {
    name: 'Lesson',
    icon: '📖',
    items: [
      { value: '🎹', label: 'Piano', icon: '🎹' },
      { value: '📚', label: 'Tutoring', icon: '📚' },
      { value: '🎨', label: 'Art', icon: '🎨' },
      { value: '🧮', label: 'Math', icon: '🧮' },
      { value: '🌐', label: 'Language', icon: '🌐' },
      { value: '🎸', label: 'Guitar', icon: '🎸' },
      { value: '🔬', label: 'Science', icon: '🔬' },
      { value: '📓', label: 'Other', icon: '📓' },
    ],
  },
  {
    name: 'Appointment',
    icon: '📋',
    items: [
      { value: '🏥', label: 'Medical', icon: '🏥' },
      { value: '🦷', label: 'Dental', icon: '🦷' },
      { value: '📝', label: 'Other', icon: '📝' },
    ],
  },
  {
    name: 'Other',
    icon: '📦',
    items: [
      { value: '✈️', label: 'Travel', icon: '✈️' },
      { value: '📦', label: 'Other', icon: '📦' },
    ],
  },
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
const assigneeId = ref('');
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
const showMoreDetails = ref(false);

// Map recurrence mode + frequency to ActivityRecurrence
const effectiveRecurrence = computed<ActivityRecurrence>(() => {
  if (recurrenceMode.value === 'one-off') return 'none';
  return recurrenceFrequency.value === 'biweekly' ? 'weekly' : recurrenceFrequency.value;
});

// Check if any "more details" field has data (for auto-expand in edit mode)
function hasDetailData(activity: FamilyActivity): boolean {
  return !!(
    activity.notes ||
    activity.dropoffMemberId ||
    activity.pickupMemberId ||
    activity.instructorName ||
    activity.instructorContact ||
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
      assigneeId.value = activity.assigneeId ?? '';
      dropoffMemberId.value = activity.dropoffMemberId ?? '';
      pickupMemberId.value = activity.pickupMemberId ?? '';
      location.value = activity.location ?? '';
      feeSchedule.value = activity.feeSchedule === 'none' ? 'per_session' : activity.feeSchedule;
      feeAmount.value = activity.feeAmount ?? 0;
      feeCurrency.value = activity.feeCurrency ?? settingsStore.baseCurrency;
      feePayerId.value = activity.feePayerId ?? '';
      instructorName.value = activity.instructorName ?? '';
      instructorContact.value = activity.instructorContact ?? '';
      reminderMinutes.value = activity.reminderMinutes;
      notes.value = activity.notes ?? '';
      isActive.value = activity.isActive;
      color.value = activity.color ?? CATEGORY_COLORS[activity.category];
      showMoreDetails.value = hasDetailData(activity);
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
      assigneeId.value = '';
      dropoffMemberId.value = '';
      pickupMemberId.value = '';
      location.value = '';
      feeSchedule.value = 'per_session';
      feeAmount.value = 0;
      feeCurrency.value = settingsStore.baseCurrency;
      feePayerId.value = '';
      instructorName.value = '';
      instructorContact.value = '';
      reminderMinutes.value = 0;
      notes.value = '';
      isActive.value = true;
      color.value = '';
      showMoreDetails.value = false;
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
  (['per_session', 'weekly', 'monthly', 'termly', 'yearly'] as FeeSchedule[]).map((f) => ({
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
  { value: 'biweekly', label: t('planner.recurrence.biweekly') },
  { value: 'monthly', label: t('planner.recurrence.monthly') },
];

const hasCost = computed(() => (feeAmount.value ?? 0) > 0);

const canSave = computed(() => {
  if (!title.value.trim() || !date.value) return false;
  if (hasCost.value && feeSchedule.value === 'none') return false;
  if (hasCost.value && !feePayerId.value) return false;
  return true;
});

const modalTitle = computed(() =>
  isEditing.value ? t('planner.editActivity') : t('planner.newActivity')
);

const saveLabel = computed(() =>
  isEditing.value ? t('modal.saveActivity') : t('modal.addActivity')
);

function handleSave() {
  if (!canSave.value) return;

  const currentMember = familyStore.currentMember ?? familyStore.owner;
  const primaryAssignee = assigneeId.value || undefined;

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
    feeSchedule: hasCost.value ? feeSchedule.value : ('none' as FeeSchedule),
    feeAmount: hasCost.value ? feeAmount.value : undefined,
    feeCurrency: hasCost.value ? feeCurrency.value : undefined,
    feePayerId: hasCost.value ? feePayerId.value || undefined : undefined,
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
    <!-- 1. Who? -->
    <FormFieldGroup :label="t('modal.whosGoing')">
      <FamilyChipPicker v-model="assigneeId" mode="single" />
    </FormFieldGroup>

    <!-- 2. Category picker (grouped) -->
    <FormFieldGroup :label="t('modal.selectCategory')">
      <GroupedChipPicker v-model="icon" :groups="ACTIVITY_ICON_GROUPS" />
    </FormFieldGroup>

    <!-- 3. Activity title (styled wrapper) -->
    <FormFieldGroup :label="t('modal.whatsTheActivity')" required>
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

    <!-- 4. Cost + Fee Schedule -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <AmountInput
        v-model="feeAmount"
        :currency-symbol="settingsStore.baseCurrency"
        font-size="1.1rem"
        :label="t('modal.costPerSession')"
      />
      <FormFieldGroup :label="t('planner.field.feeSchedule')">
        <FrequencyChips v-model="feeSchedule" :options="feeScheduleChipOptions" />
      </FormFieldGroup>
    </div>

    <!-- 5. Who Pays? (required if cost > 0) -->
    <FormFieldGroup v-if="hasCost" :label="t('planner.field.feePayer')" required>
      <FamilyChipPicker v-model="feePayerId" mode="single" compact />
    </FormFieldGroup>

    <!-- 6. Recurring / One-off toggle -->
    <FormFieldGroup :label="t('modal.schedule')">
      <TogglePillGroup
        v-model="recurrenceMode"
        :options="[
          { value: 'recurring', label: t('modal.recurring') },
          { value: 'one-off', label: t('modal.oneOff') },
        ]"
      />
    </FormFieldGroup>

    <!-- 7. Recurring details -->
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

    <!-- 8. Date + Start / End time -->
    <div class="grid grid-cols-3 gap-4">
      <FormFieldGroup :label="t('planner.field.date')" required>
        <BaseInput v-model="date" type="date" required />
      </FormFieldGroup>

      <FormFieldGroup :label="t('modal.startTime')">
        <TimePresetPicker v-model="startTime" />
      </FormFieldGroup>

      <FormFieldGroup :label="t('modal.endTime')">
        <TimePresetPicker v-model="endTime" />
      </FormFieldGroup>
    </div>

    <!-- 9. Location -->
    <FormFieldGroup :label="t('planner.field.location')" optional>
      <BaseInput v-model="location" :placeholder="t('planner.field.location')" />
    </FormFieldGroup>

    <!-- 10. "Add more details" collapsible -->
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
        <!-- Notes -->
        <FormFieldGroup :label="t('planner.field.notes')" optional>
          <textarea
            v-model="notes"
            rows="2"
            class="focus:border-primary-500 w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm text-[var(--color-text)] transition-all focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
            :placeholder="t('planner.field.notes')"
          />
        </FormFieldGroup>

        <!-- Drop Off Duty / Pick Up Duty -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormFieldGroup :label="t('planner.field.dropoff')" optional>
            <FamilyChipPicker v-model="dropoffMemberId" mode="single" compact />
          </FormFieldGroup>
          <FormFieldGroup :label="t('planner.field.pickup')" optional>
            <FamilyChipPicker v-model="pickupMemberId" mode="single" compact />
          </FormFieldGroup>
        </div>

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
  </BeanieFormModal>
</template>
