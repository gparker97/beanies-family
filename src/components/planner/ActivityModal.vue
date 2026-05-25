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
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import RecurringPaymentPrompt from '@/components/ui/RecurringPaymentPrompt.vue';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';
import PhotoAttachments from '@/components/media/PhotoAttachments.vue';
import { formatCurrencyWithCode } from '@/composables/useCurrencyDisplay';
import { calculateMonthlyFee } from '@/utils/finance';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useActivityStore } from '@/stores/activityStore';
import { usePhotoStore } from '@/stores/photoStore';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useEagerEntityCreate } from '@/composables/useEagerEntityCreate';
import { usePhotoEntityBinding } from '@/composables/usePhotoEntityBinding';
import { getActivityCategoryColor, getActivityFallbackEmoji } from '@/constants/activityCategories';
import { addHourToTime, formatNookDate } from '@/utils/date';
import { buildRecurrenceOptions } from '@/utils/format';
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
  defaultAssigneeIds?: string[];
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
const activityStore = useActivityStore();
const photoStore = usePhotoStore();

// Form state
const icon = ref('');
const title = ref('');
const description = ref('');
const date = ref('');
const endDate = ref('');
const isAllDay = ref(false);
const startTime = ref('');
const endTime = ref('');
// Single source of truth for the activity's recurrence rule. The pill row
// below presents all 5 options (One-time / Weekly / Every 2 weeks / Monthly
// on the Nth / Monthly on the Nth weekday) directly — no separate mode
// toggle. Auto-labelled via `buildRecurrenceOptions` so each pill spells
// out what it means using the current start date.
const recurrence = ref<ActivityRecurrence>('weekly');
const daysOfWeek = ref<number[]>([]);
const recurrenceEndDate = ref('');
const isRecurring = computed(() => recurrence.value !== 'none');
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

// Auto-labelled frequency chips shown inside the Schedule section when
// `recurrence !== 'none'`. The 'none' / one-off option is handled by the
// mode-toggle CARDS at the top of the modal (not by the chip row), so the
// chips here only enumerate the 4 recurring kinds.
//
// Labels are derived live from the activity's current `date` — so changing
// the start date updates "Monthly on the 14th" → "Monthly on the 15th"
// without an extra round-trip.
//
// Multi-day weekly (e.g. Mon + Wed + Fri) is weekly-only by design: biweekly
// anchors to a single weekday and monthly variants anchor to a single date.
// When the user has picked >1 day, the non-weekly chips are disabled with a
// hint explaining why — keeps them discoverable rather than silently hiding,
// and prevents silently losing extra day-of-week selections on a chip swap.
const hasMultipleDaysOfWeek = computed(() => daysOfWeek.value.length > 1);
const recurrenceOptions = computed(() => {
  const base = buildRecurrenceOptions({ date: date.value, daysOfWeek: daysOfWeek.value }, t).filter(
    (o) => o.value !== 'none'
  );
  if (!hasMultipleDaysOfWeek.value) return base;
  const hint = t('planner.recurrence.multiDayWeeklyOnlyHint');
  return base.map((o) => (o.value === 'weekly' ? o : { ...o, disabled: true, disabledHint: hint }));
});

/**
 * The top-of-modal cards split "one-time" vs "recurring" — the first-order
 * decision. The user's frequency choice is preserved across toggles so a
 * recurring → one-time → recurring round-trip doesn't silently lose their
 * previous selection. We remember the last non-'none' recurrence value in
 * `lastRecurringKind` (default: 'weekly') and restore it on toggle-back.
 */
const lastRecurringKind = ref<ActivityRecurrence>('weekly');
watch(recurrence, (next) => {
  if (next !== 'none') lastRecurringKind.value = next;
});

function setRecurrenceMode(mode: 'recurring' | 'one-off'): void {
  recurrence.value = mode === 'one-off' ? 'none' : lastRecurringKind.value;
}

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
      recurrence.value = activity.recurrence;
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
      recurrence.value = 'weekly';
      daysOfWeek.value = [];
      recurrenceEndDate.value = '';
      category.value = '' as ActivityCategory;
      assigneeIds.value = props.defaultAssigneeIds ?? [];
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

// Keep the weekly day-of-week anchored to the start date's weekday while the
// user hasn't customized the selection. Without this, opening the modal on a
// Monday auto-fills `[Mon]`, and then picking a Tuesday start date would leave
// the recurrence on Mondays — so the chosen start date (and every occurrence
// before the next Monday) never renders on the calendar.
//
// "Untouched" = empty (initial), or still exactly the previous start date's
// single weekday. A multi-day pick, or a single day the user switched to a
// different weekday, counts as customized and is preserved across date edits.
watch(date, (newDate, oldDate) => {
  if (!newDate || !isRecurring.value) return;
  const newWeekday = new Date(newDate + 'T00:00:00').getDay();
  const oldWeekday = oldDate ? new Date(oldDate + 'T00:00:00').getDay() : null;
  const untouched =
    daysOfWeek.value.length === 0 ||
    (daysOfWeek.value.length === 1 && oldWeekday !== null && daysOfWeek.value[0] === oldWeekday);
  if (untouched) {
    daysOfWeek.value = [newWeekday];
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

const allScheduleEnabled = computed(() => isRecurring.value && !!recurrenceEndDate.value);

const feeScheduleChipOptions = computed(() => {
  const allChip = {
    value: 'all',
    label: t('planner.fee.all'),
    ...(allScheduleEnabled.value
      ? {}
      : { disabled: true, disabledHint: t('planner.fee.allDisabledHint') }),
  };
  // Order: Per Session, All Sessions, then periodic options
  const periodic: FeeSchedule[] = ['weekly', 'monthly', 'yearly', 'custom'];
  return [
    { value: 'per_session', label: t('planner.fee.per_session') },
    allChip,
    ...periodic.map((f) => ({ value: f, label: t(`planner.fee.${f}` as const) })),
  ];
});

// Reset feeSchedule away from 'all' if end date is cleared
watch(
  () => allScheduleEnabled.value,
  (enabled) => {
    if (!enabled && feeSchedule.value === 'all') {
      feeSchedule.value = 'per_session';
    }
  }
);

const reminderChipOptions = [
  { value: '0', label: 'None' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '1440', label: '1 day' },
];

const hasCost = computed(() => (feeAmount.value ?? 0) > 0);

const isAllSchedule = computed(() => feeSchedule.value === 'all');

const calculatedMonthly = computed(() => {
  if (!hasCost.value || feeSchedule.value === 'none' || isAllSchedule.value) return 0;
  return calculateMonthlyFee({
    feeSchedule: feeSchedule.value,
    feeAmount: feeAmount.value ?? 0,
    sessionsPerWeek: daysOfWeek.value.length || 1,
    feeCustomPeriod: feeCustomPeriod.value,
    feeCustomPeriodUnit: feeCustomPeriodUnit.value,
  });
});

// Estimated session count for 'all' schedule breakdown
const totalSessions = computed(() => {
  if (!isAllSchedule.value || !date.value || !recurrenceEndDate.value) return 0;
  const start = new Date(date.value + 'T00:00:00');
  const end = new Date(recurrenceEndDate.value + 'T00:00:00');
  if (end < start) return 1;

  if (recurrence.value === 'weekly') {
    // Count exact matching days-of-week between start and end (inclusive)
    const targetDays = daysOfWeek.value.length > 0 ? daysOfWeek.value : [start.getDay()];
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      if (targetDays.includes(cursor.getDay())) count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return Math.max(count, 1);
  }
  // Monthly: count months from start to end (inclusive of both)
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  return Math.max(months, 1);
});

const perSessionCost = computed(() => {
  if (!isAllSchedule.value || !hasCost.value || totalSessions.value <= 0) return 0;
  return Math.round((Math.abs(feeAmount.value ?? 0) / totalSessions.value) * 100) / 100;
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

/**
 * Build the activity payload from current form state. Used by both
 * the eager-create path (photos require an entity id before save) and
 * the final emit('save') handler. Includes `photoIds` from the binding
 * composable so eager-uploaded photos persist on first save.
 */
function buildPayload(): CreateFamilyActivityInput {
  const currentMember = familyStore.currentMember ?? familyStore.owner;
  const assigneePayload = toAssigneePayload(assigneeIds.value);

  return {
    title: title.value.trim(),
    icon: icon.value || undefined,
    description: description.value.trim() || undefined,
    date: date.value,
    endDate: isAllDay.value && endDate.value ? endDate.value : undefined,
    isAllDay: isAllDay.value || undefined,
    startTime: isAllDay.value ? undefined : startTime.value || undefined,
    endTime: isAllDay.value ? undefined : endTime.value || undefined,
    recurrence: recurrence.value,
    // `daysOfWeek` only persisted for weekly (multi-day picker). Other
    // kinds (biweekly anchored single-day, monthly variants) derive their
    // anchor from the activity's `date` per the recurrence-rule contract.
    daysOfWeek: recurrence.value === 'weekly' ? [...daysOfWeek.value] : undefined,
    recurrenceEndDate:
      isRecurring.value && recurrenceEndDate.value ? recurrenceEndDate.value : undefined,
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
    ...(binding.photoIds.value.length ? { photoIds: [...binding.photoIds.value] } : {}),
    isActive: isActive.value,
    color: color.value || undefined,
    createdBy: currentMember?.id ?? '',
  };
}

/**
 * Eager-create + photo-binding wiring.
 *
 * Eager-create gates on the same `canSave` predicate as the final Save
 * (title + date + at least one assignee). The "Add photos" placeholder
 * stays disabled until those minimums are met so the user can't end up
 * with an orphan, ill-formed activity record.
 *
 * The composable's `commit()` is intentionally NOT used here — the
 * parent `FamilyPlannerPage` owns the create-vs-update branching for
 * the final Save (recurring-occurrence scoped save, "Activity Created"
 * confirmation, fee-cascade to recurring transactions). We only use
 * `ensureId()` to mint the entity on first photo tap; the final Save
 * path is unchanged below — it just emits, with `eager.entityId`
 * choosing the update vs create emit shape.
 */
const photoAttachmentsRef = ref<{ openPicker: () => void } | null>(null);

/**
 * Reactive gate predicate. Same fields as `canSave` — keeps the photo
 * placeholder's disabled state and the inline hint visibility in lock-
 * step with the form-level Save button.
 */
const firstMissingFieldKey = computed<string | null>(() => {
  if (!title.value.trim()) return 'title';
  if (!date.value) return 'date';
  if (assigneeIds.value.length === 0) return 'assignees';
  return null;
});

const addPhotosHint = computed(() =>
  firstMissingFieldKey.value !== null ? t('activities.photoGate.fillFirst') : null
);

const eager = useEagerEntityCreate<FamilyActivity, CreateFamilyActivityInput>({
  resolveExistingId: () => props.activity?.id ?? null,
  firstMissingField: () => firstMissingFieldKey.value,
  buildPayload,
  create: (payload) => activityStore.createActivity(payload),
  update: (id, payload) => activityStore.updateActivity(id, payload),
});

const binding = usePhotoEntityBinding({
  entityId: eager.entityId,
  // Read photoIds from the live Automerge doc rather than the prop snapshot.
  // The parent (FamilyPlannerPage) captures `editingActivity.value = target`
  // at click-time — a plain object reference that doesn't reactively update
  // when the doc changes. Reading via `photoStore.photoIdsFor` subscribes
  // to docVersion so background uploads (e.g. one that completes after the
  // user closes the drawer) get picked up on reopen via the deep watch
  // inside the binding. See `photoIdsFor`'s JSDoc for the full chain.
  initialPhotoIds: () => photoStore.photoIdsFor('activities', eager.entityId.value),
  watchSource: () => props.activity?.id,
  update: (id, patch) => activityStore.updateActivity(id, patch),
  surface: 'ActivityModal',
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !props.activity) eager.reset();
  }
);

async function handleAddFirstPhoto(): Promise<void> {
  const id = await eager.ensureId();
  if (!id) return;
  await nextTick();
  photoAttachmentsRef.value?.openPicker();
}

function handleSave() {
  if (!canSave.value) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;

  const payload = buildPayload();
  const existingId = eager.entityId.value;

  if (existingId) {
    // Edit-mode OR we eager-created the activity to attach a photo.
    // Either way, the entity already exists — emit as an update so the
    // parent's update path (scoped save for recurring, fee cascade)
    // runs normally. This skips the "Activity Created" confirmation
    // even on the eager-created path; the user already has visible
    // feedback (the photo tile they attached) so the modal is fine.
    const { createdBy: _omit, ...updateData } = payload;
    void _omit;
    emit('save', { id: existingId, data: updateData as UpdateFamilyActivityInput });
  } else {
    emit('save', payload);
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    size="wide"
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
            <span class="block text-[0.625rem] text-[var(--color-text-muted)] opacity-60">
              {{ t('vacation.planningSubtitle') }}
            </span>
          </div>
          <span class="text-sm font-semibold" style="color: var(--vacation-teal)">›</span>
        </div>
      </div>

      <!-- 1. Schedule mode tab bar (recurring / one-time) — the first-order
           decision. Frequency chips (weekly / biweekly / monthly variants)
           live inside the Schedule field group below, only visible when
           recurring is selected. -->
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
              (opt.value === 'recurring' ? isRecurring : !isRecurring)
                ? 'border-primary-500 border-2 bg-white shadow-sm dark:bg-slate-600'
                : 'border-2 border-transparent hover:bg-white/60 dark:hover:bg-slate-600/40'
            "
            @click="setRecurrenceMode(opt.value as 'recurring' | 'one-off')"
          >
            <span class="text-lg leading-none">{{ opt.icon }}</span>
            <span
              class="font-outfit text-xs font-bold"
              :class="
                (opt.value === 'recurring' ? isRecurring : !isRecurring)
                  ? 'text-[var(--color-text)] dark:text-gray-100'
                  : 'text-[var(--color-text)] opacity-35 dark:text-gray-400'
              "
            >
              {{ opt.label }}
            </span>
            <span
              class="text-[0.625rem]"
              :class="
                (opt.value === 'recurring' ? isRecurring : !isRecurring)
                  ? 'text-[var(--color-text-muted)]'
                  : 'opacity-25 dark:text-gray-500'
              "
            >
              {{ opt.desc }}
            </span>
            <span
              v-if="opt.value === 'recurring' ? isRecurring : !isRecurring"
              class="bg-primary-500 absolute bottom-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
            />
          </button>
        </div>
      </div>

      <!-- 2. Activity title -->
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

      <!-- 3. Schedule: frequency chips + (weekly only) day-of-week selector.
           Chips are auto-labelled from the activity's `date` so each option
           spells out what it means in the user's context — picking start
           date 13 May 2026 renders "Monthly on the 13th" and "Monthly on
           the 2nd Wed" so the difference between the two monthly variants
           is self-evident. -->
      <template v-if="isRecurring">
        <FormFieldGroup :label="t('modal.schedule')">
          <div class="space-y-3">
            <FrequencyChips v-model="recurrence" :options="recurrenceOptions" />
            <DayOfWeekSelector v-if="recurrence === 'weekly'" v-model="daysOfWeek" />
          </div>
        </FormFieldGroup>
      </template>

      <!-- 4. All-day toggle -->
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

      <!-- 5. Date + Times -->
      <!-- Recurring: Start Date / End Date row, then Start Time / End Time row -->
      <template v-if="isRecurring">
        <div class="grid grid-cols-2 gap-4">
          <FormFieldGroup :label="t('planner.field.date')" required :error="errorDate">
            <BeanieDatePicker v-model="date" required />
          </FormFieldGroup>
          <FormFieldGroup :label="t('planner.field.endDate')" optional>
            <BeanieDatePicker v-model="recurrenceEndDate" :min="date" />
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
            <BeanieDatePicker v-model="date" required />
          </FormFieldGroup>
          <FormFieldGroup :label="t('planner.field.endDate')" optional>
            <BeanieDatePicker v-model="endDate" :min="date" />
          </FormFieldGroup>
        </div>
        <div v-else class="space-y-3">
          <FormFieldGroup :label="t('planner.field.dateOnly')" required :error="errorDate">
            <BeanieDatePicker v-model="date" required />
          </FormFieldGroup>
          <div class="grid grid-cols-2 gap-3">
            <FormFieldGroup :label="t('modal.startTime')">
              <TimePresetPicker v-model="startTime" />
            </FormFieldGroup>
            <FormFieldGroup :label="t('modal.endTime')">
              <TimePresetPicker v-model="endTime" />
            </FormFieldGroup>
          </div>
        </div>
      </template>

      <!-- 6. Who? -->
      <FormFieldGroup :label="t('modal.whosGoing')" required :error="errorAssignees">
        <FamilyChipPicker v-model="assigneeIds" mode="multi" include-pets />
      </FormFieldGroup>

      <!-- 7. Category picker -->
      <FormFieldGroup :label="t('modal.selectCategory')">
        <ActivityCategoryPicker v-model="category" />
      </FormFieldGroup>

      <!-- 8. Location -->
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

      <!-- 9. Cost + Fee Schedule -->
      <FormFieldGroup
        :label="
          !isRecurring
            ? t('planner.fee.totalCost')
            : isAllSchedule
              ? t('planner.fee.totalCost')
              : t('modal.costPerSession')
        "
      >
        <CurrencyAmountInput
          v-model:amount="feeAmount"
          v-model:currency="feeCurrency"
          font-size="1.1rem"
        />
      </FormFieldGroup>
      <!-- Fee schedule chips (recurring only — one-off activities just have a flat cost) -->
      <template v-if="isRecurring">
        <FormFieldGroup :label="t('planner.field.feeSchedule')">
          <template #label-extra>
            <InfoHintBadge
              :text="t('planner.fee.scheduleHintIntro')"
              :items="[
                t('planner.fee.scheduleHintPerSession'),
                t('planner.fee.scheduleHintAll'),
                t('planner.fee.scheduleHintWeekly'),
                t('planner.fee.scheduleHintMonthly'),
                t('planner.fee.scheduleHintYearly'),
                t('planner.fee.scheduleHintCustom'),
              ]"
            />
          </template>
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

        <!-- Per-session breakdown for 'all' schedule -->
        <div v-if="isAllSchedule && hasCost && totalSessions > 0" class="flex items-center gap-2">
          <span
            class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
          >
            {{ t('planner.fee.perSessionBreakdown') }}
          </span>
          <span class="font-outfit text-sm font-bold text-[var(--color-text)]">
            {{ formatCurrencyWithCode(perSessionCost, (feeCurrency || 'USD') as any) }}
            <span class="font-normal opacity-50"> ({{ totalSessions }} sessions) </span>
          </span>
        </div>

        <!-- Calculated monthly display (non-all schedules) -->
        <div
          v-if="
            !isAllSchedule &&
            hasCost &&
            feeSchedule !== 'none' &&
            feeSchedule !== 'monthly' &&
            calculatedMonthly > 0
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
      </template>

      <!-- Linked payment prompt -->
      <RecurringPaymentPrompt
        v-if="hasCost && (isRecurring ? feeSchedule !== 'none' : true)"
        v-model="createRecurringPayment"
        :pay-from-account-id="feePayFromAccountId"
        :payment-amount="
          !isRecurring ? (feeAmount ?? 0) : isAllSchedule ? (feeAmount ?? 0) : calculatedMonthly
        "
        :currency="feeCurrency || 'USD'"
        :start-date="date"
        :frequency="!isRecurring || isAllSchedule ? 'one-time' : 'monthly'"
        @update:pay-from-account-id="feePayFromAccountId = $event"
      />

      <!-- Photos — birthday invites, items-to-bring screenshots, location maps,
           anything visual the user wants pinned to this activity. Eager-creates
           the activity on first photo tap once the gate (title + date + at least
           one assignee) is met; otherwise the placeholder button stays disabled
           and the inline hint names the missing field. -->
      <FormFieldGroup :label="t('photos.label')" optional>
        <PhotoAttachments
          v-if="eager.entityId.value"
          ref="photoAttachmentsRef"
          collection="activities"
          :entity-id="eager.entityId.value"
          :photo-ids="binding.photoIds.value"
          :max="4"
          @update:photo-ids="binding.updatePhotoIds"
        />
        <button
          v-else
          type="button"
          :disabled="firstMissingFieldKey !== null || eager.isCreating.value"
          class="hover:border-primary-500 hover:text-primary-500 flex w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--tint-slate-10)] py-5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-orange-4)] disabled:cursor-not-allowed disabled:opacity-40"
          @click="handleAddFirstPhoto"
        >
          <span class="text-2xl" aria-hidden="true">📷</span>
          <span class="font-outfit text-xs font-semibold">{{ t('activities.addPhotos') }}</span>
        </button>
        <p
          v-if="addPhotosHint"
          class="font-outfit mt-1 text-[0.6875rem] text-[var(--color-text-muted)] italic dark:text-gray-400"
        >
          {{ addPhotosHint }}
        </p>
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
