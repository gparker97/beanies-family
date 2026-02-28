<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
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
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const settingsStore = useSettingsStore();

const showMoreDetails = ref(false);
const isEditing = computed(() => !!props.activity);

// Form state
const title = ref('');
const description = ref('');
const date = ref('');
const startTime = ref('');
const endTime = ref('');
const recurrence = ref<ActivityRecurrence>('weekly');
const dayOfWeek = ref<number | undefined>(undefined);
const category = ref<ActivityCategory>('lesson');
const assigneeId = ref<string>('');
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
const colorManuallySet = ref(false);

/** Available color swatches: category defaults + extras */
const COLOR_SWATCHES = [
  ...Object.values(CATEGORY_COLORS),
  '#3498DB', // Bright blue
  '#1ABC9C', // Teal
  '#E74C3C', // Red
  '#F39C12', // Amber
];

// Reset form when modal opens
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    if (props.activity) {
      // Edit mode — populate from existing activity
      const a = props.activity;
      title.value = a.title;
      description.value = a.description ?? '';
      date.value = a.date;
      startTime.value = a.startTime ?? '';
      endTime.value = a.endTime ?? '';
      recurrence.value = a.recurrence;
      dayOfWeek.value = a.dayOfWeek;
      category.value = a.category;
      assigneeId.value = a.assigneeId ?? '';
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
      colorManuallySet.value = !!a.color;
      // Auto-expand if any advanced fields are populated
      showMoreDetails.value = !!(
        a.location ||
        a.feeSchedule !== 'none' ||
        a.instructorName ||
        a.reminderMinutes > 0 ||
        a.notes
      );
    } else {
      // Create mode — reset to defaults
      title.value = '';
      description.value = '';
      date.value = props.defaultDate ?? todayStr();
      startTime.value = props.defaultStartTime ?? '';
      endTime.value = '';
      recurrence.value = 'weekly';
      dayOfWeek.value = undefined;
      category.value = 'lesson';
      assigneeId.value = '';
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
      color.value = CATEGORY_COLORS['lesson'];
      colorManuallySet.value = false;
      showMoreDetails.value = false;
    }
  }
);

// Auto-update color when category changes (unless user manually picked a color)
watch(category, (newCat) => {
  if (!colorManuallySet.value) {
    color.value = CATEGORY_COLORS[newCat];
  }
});

// Auto-set dayOfWeek when date changes
watch(date, (newDate) => {
  if (newDate && recurrence.value === 'weekly') {
    const d = new Date(newDate + 'T00:00:00');
    dayOfWeek.value = d.getDay();
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

const categoryOptions = computed(() =>
  (['lesson', 'sport', 'appointment', 'social', 'pickup', 'other'] as ActivityCategory[]).map(
    (c) => ({ value: c, label: t(`planner.category.${c}` as const) })
  )
);

const recurrenceOptions = computed(() =>
  (['weekly', 'daily', 'monthly', 'yearly', 'none'] as ActivityRecurrence[]).map((r) => ({
    value: r,
    label: t(`planner.recurrence.${r}` as const),
  }))
);

const feeScheduleOptions = computed(() =>
  (['none', 'per_session', 'weekly', 'monthly', 'termly', 'yearly'] as FeeSchedule[]).map((f) => ({
    value: f,
    label: t(`planner.fee.${f}` as const),
  }))
);

const dayOfWeekOptions = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

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

const canSave = computed(() => title.value.trim().length > 0 && date.value.length > 0);

function handleSave() {
  if (!canSave.value) return;

  const currentMember = familyStore.currentMember ?? familyStore.owner;

  const baseData = {
    title: title.value.trim(),
    description: description.value.trim() || undefined,
    date: date.value,
    startTime: startTime.value || undefined,
    endTime: endTime.value || undefined,
    recurrence: recurrence.value,
    dayOfWeek: recurrence.value === 'weekly' ? dayOfWeek.value : undefined,
    category: category.value,
    assigneeId: assigneeId.value || undefined,
    dropoffMemberId: dropoffMemberId.value || undefined,
    pickupMemberId: pickupMemberId.value || undefined,
    location: location.value.trim() || undefined,
    feeSchedule: feeSchedule.value,
    feeAmount: feeSchedule.value !== 'none' ? feeAmount.value : undefined,
    feeCurrency: feeSchedule.value !== 'none' ? feeCurrency.value : undefined,
    feePayerId: feeSchedule.value !== 'none' ? feePayerId.value || undefined : undefined,
    instructorName: instructorName.value.trim() || undefined,
    instructorContact: instructorContact.value.trim() || undefined,
    reminderMinutes: reminderMinutes.value,
    notes: notes.value.trim() || undefined,
    isActive: isActive.value,
    color: color.value !== CATEGORY_COLORS[category.value] ? color.value : undefined,
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
  <BaseModal
    :open="open"
    :title="isEditing ? t('planner.editActivity') : t('planner.newActivity')"
    size="lg"
    @close="emit('close')"
  >
    <form class="space-y-4" @submit.prevent="handleSave">
      <!-- Title -->
      <BaseInput
        v-model="title"
        :label="t('planner.field.title')"
        :placeholder="t('planner.field.title')"
        required
      />

      <!-- Date + Time row -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BaseInput v-model="date" :label="t('planner.field.date')" type="date" required />
        <BaseInput v-model="startTime" :label="t('planner.field.startTime')" type="time" />
        <BaseInput v-model="endTime" :label="t('planner.field.endTime')" type="time" />
      </div>

      <!-- Category + Recurrence row -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BaseSelect
          v-model="category"
          :label="t('planner.field.category')"
          :options="categoryOptions"
        />
        <BaseSelect
          v-model="recurrence"
          :label="t('planner.field.recurrence')"
          :options="recurrenceOptions"
        />
      </div>

      <!-- Highlight color -->
      <div>
        <label class="mb-1 block text-sm font-medium text-[#2C3E50] dark:text-gray-300">
          {{ t('planner.field.color') }}
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="swatch in COLOR_SWATCHES"
            :key="swatch"
            type="button"
            class="h-7 w-7 cursor-pointer rounded-full border-2 transition-all"
            :class="
              color === swatch
                ? 'scale-110 border-gray-900 dark:border-white'
                : 'border-transparent'
            "
            :style="{ backgroundColor: swatch }"
            @click="
              color = swatch;
              colorManuallySet = true;
            "
          />
        </div>
      </div>

      <!-- Day of week (only for weekly recurrence) -->
      <div v-if="recurrence === 'weekly'">
        <BaseSelect
          :model-value="String(dayOfWeek ?? '')"
          :label="t('planner.field.dayOfWeek')"
          :options="dayOfWeekOptions.map((d) => ({ value: String(d.value), label: d.label }))"
          @update:model-value="dayOfWeek = Number($event)"
        />
      </div>

      <!-- People row -->
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BaseSelect
          v-model="assigneeId"
          :label="t('planner.field.assignee')"
          :options="memberOptions"
        />
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

      <!-- More details toggle -->
      <button
        type="button"
        class="font-outfit flex w-full cursor-pointer items-center gap-2 rounded-xl py-2 text-sm font-semibold text-[#F15D22] transition-colors hover:text-[#E67E22]"
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
        {{ t('planner.field.moreDetails') }}
      </button>

      <!-- Collapsible advanced fields -->
      <div v-if="showMoreDetails" class="space-y-4">
        <!-- Location -->
        <BaseInput
          v-model="location"
          :label="t('planner.field.location')"
          :placeholder="t('planner.field.location')"
        />

        <!-- Fees row -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BaseSelect
            v-model="feeSchedule"
            :label="t('planner.field.feeSchedule')"
            :options="feeScheduleOptions"
          />
          <BaseInput
            v-if="feeSchedule !== 'none'"
            :model-value="feeAmount !== undefined ? String(feeAmount) : ''"
            :label="t('planner.field.feeAmount')"
            type="number"
            @update:model-value="feeAmount = $event ? Number($event) : undefined"
          />
          <BaseSelect
            v-if="feeSchedule !== 'none'"
            v-model="feePayerId"
            :label="t('planner.field.feePayer')"
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

        <!-- Reminder -->
        <BaseSelect
          :model-value="String(reminderMinutes)"
          :label="t('planner.field.reminder')"
          :options="reminderOptions.map((r) => ({ value: String(r.value), label: r.label }))"
          @update:model-value="reminderMinutes = Number($event) as ReminderMinutes"
        />

        <!-- Notes -->
        <div>
          <label class="mb-1 block text-sm font-medium text-[#2C3E50] dark:text-gray-300">
            {{ t('planner.field.notes') }}
          </label>
          <textarea
            v-model="notes"
            rows="3"
            class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#2C3E50] transition-colors focus:border-[#F15D22] focus:ring-1 focus:ring-[#F15D22] focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-gray-200"
            :placeholder="t('planner.field.notes')"
          />
        </div>

        <!-- Active toggle -->
        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="isActive" type="checkbox" class="h-4 w-4 rounded accent-[#F15D22]" />
          <span class="text-sm text-[#2C3E50] dark:text-gray-300">
            {{ t('planner.field.active') }}
          </span>
        </label>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2 pt-2">
        <BaseButton variant="secondary" type="button" @click="emit('close')">
          {{ t('common.cancel') }}
        </BaseButton>
        <BaseButton variant="primary" type="submit" :disabled="!canSave">
          {{ t('common.save') }}
        </BaseButton>
      </div>
    </form>
  </BaseModal>
</template>
