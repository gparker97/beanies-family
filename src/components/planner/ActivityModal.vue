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
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from '@/composables/useTranslation';
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

const showMoreDetails = ref(false);
const isEditing = computed(() => !!props.activity);

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
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (props.activity) {
      const a = props.activity;
      icon.value = a.icon ?? '';
      title.value = a.title;
      description.value = a.description ?? '';
      date.value = a.date;
      startTime.value = a.startTime ?? '';
      endTime.value = a.endTime ?? '';
      recurrenceMode.value = a.recurrence === 'none' ? 'one-off' : 'recurring';
      recurrenceFrequency.value =
        a.recurrence === 'monthly' ? 'monthly' : a.recurrence === 'weekly' ? 'weekly' : 'weekly';
      daysOfWeek.value = a.daysOfWeek ?? [];
      category.value = a.category;
      assigneeIds.value = a.assigneeId ? [a.assigneeId] : [];
      dropoffMemberId.value = a.dropoffMemberId ?? '';
      pickupMemberId.value = a.pickupMemberId ?? '';
      location.value = a.location ?? '';
      feeSchedule.value = a.feeSchedule;
      feeAmount.value = a.feeAmount;
      feeCurrency.value = a.feeCurrency ?? settingsStore.baseCurrency;
      feePayerId.value = a.feePayerId ?? '';
      instructorName.value = a.instructorName ?? '';
      instructorContact.value = a.instructorContact ?? '';
      reminderMinutes.value = a.reminderMinutes;
      notes.value = a.notes ?? '';
      isActive.value = a.isActive;
      color.value = a.color ?? CATEGORY_COLORS[a.category];
      showMoreDetails.value = !!(
        a.dropoffMemberId ||
        a.pickupMemberId ||
        a.instructorName ||
        a.reminderMinutes > 0 ||
        (a.feeSchedule !== 'none' && a.feeSchedule !== 'per_session')
      );
    } else {
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
      showMoreDetails.value = false;
    }
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

const memberOptions = computed(() => [
  { value: '', label: '—' },
  ...familyStore.members.map((m) => ({ value: m.id, label: m.name })),
]);

const feeScheduleOptions = computed(() =>
  (['none', 'per_session', 'weekly', 'monthly', 'termly', 'yearly'] as FeeSchedule[]).map((f) => ({
    value: f,
    label: t(`planner.fee.${f}` as const),
  }))
);

const reminderOptions: { value: ReminderMinutes; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 1440, label: '1 day' },
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

    <!-- 5. Date + Start time -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormFieldGroup :label="t('planner.field.date')">
        <BaseInput v-model="date" type="date" required />
      </FormFieldGroup>

      <FormFieldGroup :label="t('modal.startTime')">
        <TimePresetPicker v-model="startTime" />
      </FormFieldGroup>
    </div>

    <!-- 6. End time (after start time is set) -->
    <ConditionalSection :show="!!startTime">
      <FormFieldGroup :label="t('modal.endTime')">
        <TimePresetPicker v-model="endTime" />
      </FormFieldGroup>
    </ConditionalSection>

    <!-- 7. Location (optional) -->
    <FormFieldGroup :label="t('planner.field.location')" optional>
      <BaseInput v-model="location" :placeholder="t('planner.field.location')" />
    </FormFieldGroup>

    <!-- 8. Who's going? -->
    <FormFieldGroup :label="t('modal.whosGoing')">
      <FamilyChipPicker v-model="assigneeIds" mode="multi" />
    </FormFieldGroup>

    <!-- 9. Cost per session (optional) -->
    <AmountInput
      v-model="feeAmount"
      :currency-symbol="settingsStore.baseCurrency"
      font-size="1.1rem"
      :label="t('modal.costPerSession')"
    />

    <!-- 10. Notes (optional) -->
    <FormFieldGroup :label="t('planner.field.notes')" optional>
      <textarea
        v-model="notes"
        rows="2"
        class="focus:border-primary-500 w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm text-[var(--color-text)] transition-all focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
        :placeholder="t('planner.field.notes')"
      />
    </FormFieldGroup>

    <!-- More details toggle -->
    <button
      type="button"
      class="font-outfit text-primary-500 hover:text-terracotta-400 flex w-full cursor-pointer items-center gap-2 rounded-xl py-2 text-sm font-semibold transition-colors"
      @click="showMoreDetails = !showMoreDetails"
    >
      <svg
        class="h-4 w-4 transition-transform"
        :class="{ 'rotate-180': showMoreDetails }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        stroke-width="2"
      >
        <path d="M19 9l-7 7-7-7" />
      </svg>
      {{ t('modal.moreDetails') }}
    </button>

    <!-- Expandable "More details" -->
    <ConditionalSection :show="showMoreDetails">
      <div class="space-y-4">
        <!-- Dropoff / Pickup members -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseSelect
            v-model="dropoffMemberId"
            :label="t('planner.field.dropoff')"
            :options="memberOptions"
          />
          <BaseSelect
            v-model="pickupMemberId"
            :label="t('planner.field.pickup')"
            :options="memberOptions"
          />
        </div>

        <!-- Instructor -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseInput
            v-model="instructorName"
            :label="t('planner.field.instructor')"
            :placeholder="t('planner.field.instructor')"
          />
          <BaseInput
            v-model="instructorContact"
            :label="t('planner.field.instructorContact')"
            :placeholder="t('planner.field.instructorContact')"
          />
        </div>

        <!-- Fee schedule -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BaseSelect
            v-model="feeSchedule"
            :label="t('planner.field.feeSchedule')"
            :options="feeScheduleOptions"
          />
          <BaseSelect
            v-if="feeSchedule !== 'none'"
            v-model="feePayerId"
            :label="t('planner.field.feePayer')"
            :options="memberOptions"
          />
        </div>

        <!-- Reminder -->
        <BaseSelect
          :model-value="String(reminderMinutes)"
          :label="t('planner.field.reminder')"
          :options="reminderOptions.map((r) => ({ value: String(r.value), label: r.label }))"
          @update:model-value="reminderMinutes = Number($event) as ReminderMinutes"
        />

        <!-- Active toggle -->
        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="isActive" type="checkbox" class="accent-primary-500 h-4 w-4 rounded" />
          <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
            {{ t('planner.field.active') }}
          </span>
        </label>
      </div>
    </ConditionalSection>
  </BeanieFormModal>
</template>
