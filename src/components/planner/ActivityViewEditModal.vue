<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { chooseScope } from '@/composables/useRecurringEditScope';
import { useSounds } from '@/composables/useSounds';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { getCurrencyInfo } from '@/constants/currencies';
import { getActivityCategoryName } from '@/constants/activityCategories';
import {
  formatDate,
  addHourToTime,
  toDateInputValue,
  addDays,
  parseLocalDate,
  formatTime12,
} from '@/utils/date';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
import type { FamilyActivity, DutyCompletion } from '@/types/models';

type EditableField =
  | 'title'
  | 'assignee'
  | 'date'
  | 'endDate'
  | 'startTime'
  | 'endTime'
  | 'dropoff'
  | 'pickup'
  | 'instructorName'
  | 'instructorContact'
  | 'notes';

const props = defineProps<{
  activity: FamilyActivity | null;
  occurrenceDate?: string;
}>();

const emit = defineEmits<{
  close: [];
  deleted: [id: string];
  'open-edit': [activity: FamilyActivity];
  'activity-swapped': [newId: string];
}>();

const { t, isBeanieMode } = useTranslation();
const router = useRouter();
const { playWhoosh } = useSounds();
const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const transactionsStore = useTransactionsStore();
const recurringStore = useRecurringStore();
const accountsStore = useAccountsStore();
const { getMemberName } = useMemberInfo();

/** Find the completion record for a given occurrence date. */
function findCompletion(
  completions: DutyCompletion[] | undefined,
  date: string | undefined
): DutyCompletion | undefined {
  if (!completions || !date) return undefined;
  return completions.find((c) => c.date === date);
}

/** Format a completion record as "Done by {name} at {time}". */
function formatCompletion(completion: DutyCompletion): string {
  const name = getMemberName(completion.completedBy);
  const time = formatTime12(
    new Date(completion.completedAt).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );
  return `${t('nook.dutyDone')} — ${name}, ${time}`;
}

/** Toggle duty completion for the current occurrence. */
async function toggleDuty(duty: 'dropoff' | 'pickup') {
  if (!activity.value || !props.occurrenceDate) return;
  const memberId = familyStore.currentMemberId;
  if (!memberId) return;
  const field = duty === 'dropoff' ? 'dropoffCompletions' : 'pickupCompletions';
  const completions = [...(activity.value[field] ?? [])];
  const idx = completions.findIndex((c) => c.date === props.occurrenceDate);
  if (idx >= 0) {
    completions.splice(idx, 1);
  } else {
    completions.push({
      date: props.occurrenceDate,
      completedBy: memberId,
      completedAt: new Date().toISOString(),
    });
  }
  await activityStore.updateActivity(activity.value.id, { [field]: completions });
}

// Live-lookup from store so display stays reactive after inline edits
const activity = computed(() =>
  props.activity
    ? (activityStore.activities.find((a) => a.id === props.activity!.id) ?? props.activity)
    : null
);

// Draft refs
const draftTitle = ref('');
const draftAssigneeIds = ref<string[]>([]);
const draftDate = ref('');
const draftEndDate = ref('');
const draftStartTime = ref('');
const draftEndTime = ref('');
const draftDropoffMemberId = ref('');
const draftPickupMemberId = ref('');
const draftInstructorName = ref('');
const draftInstructorContact = ref('');
const draftNotes = ref('');

// Reschedule state
const showReschedule = ref(false);
const rescheduleDate = ref('');
const rescheduleEndDate = ref('');
const rescheduleStartTime = ref('');
const rescheduleEndTime = ref('');

// Template refs for auto-focus
const titleInputRef = ref<HTMLInputElement | null>(null);
const instructorNameRef = ref<HTMLInputElement | null>(null);
const instructorContactRef = ref<HTMLInputElement | null>(null);
const notesRef = ref<HTMLTextAreaElement | null>(null);

const { editingField, startEdit, saveField, cancelEdit, saveAndClose } =
  useInlineEdit<EditableField>({
    populateDraft(field) {
      if (!activity.value) return;
      switch (field) {
        case 'title':
          draftTitle.value = activity.value.title;
          break;
        case 'assignee':
          draftAssigneeIds.value = [...normalizeAssignees(activity.value)];
          break;
        case 'date':
          draftDate.value = activity.value.date?.split('T')[0] ?? '';
          break;
        case 'endDate':
          draftEndDate.value = activity.value.endDate?.split('T')[0] ?? '';
          break;
        case 'startTime':
          draftStartTime.value = activity.value.startTime ?? '';
          break;
        case 'endTime':
          draftEndTime.value = activity.value.endTime ?? '';
          break;
        case 'dropoff':
          draftDropoffMemberId.value = activity.value.dropoffMemberId ?? '';
          break;
        case 'pickup':
          draftPickupMemberId.value = activity.value.pickupMemberId ?? '';
          break;
        case 'instructorName':
          draftInstructorName.value = activity.value.instructorName ?? '';
          break;
        case 'instructorContact':
          draftInstructorContact.value = activity.value.instructorContact ?? '';
          break;
        case 'notes':
          draftNotes.value = activity.value.notes ?? '';
          break;
      }
      nextTick(() => {
        if (field === 'title') titleInputRef.value?.focus();
        if (field === 'instructorName') instructorNameRef.value?.focus();
        if (field === 'instructorContact') instructorContactRef.value?.focus();
        if (field === 'notes') notesRef.value?.focus();
      });
    },
    async saveDraft(field) {
      if (!activity.value) return;
      const update: Record<string, string | null> = {};
      let changed = false;

      switch (field) {
        case 'title': {
          const trimmed = draftTitle.value.trim();
          if (!trimmed) return;
          if (trimmed !== activity.value.title) {
            update.title = trimmed;
            changed = true;
          }
          break;
        }
        case 'assignee': {
          const current = normalizeAssignees(activity.value);
          const draft = draftAssigneeIds.value;
          // Activities require at least 1 assignee
          if (draft.length === 0) return;
          if (JSON.stringify(draft) !== JSON.stringify(current)) {
            const payload = toAssigneePayload(draft);
            update.assigneeIds = payload.assigneeIds as any;
            update.assigneeId = (payload.assigneeId ?? null) as any;
            changed = true;
          }
          break;
        }
        case 'date': {
          const val = draftDate.value || null;
          const cur = activity.value.date?.split('T')[0] ?? null;
          if (val !== cur) {
            update.date = val;
            changed = true;
          }
          break;
        }
        case 'endDate': {
          const val = draftEndDate.value || null;
          const cur = activity.value.endDate?.split('T')[0] ?? null;
          if (val !== cur) {
            update.endDate = val;
            changed = true;
          }
          break;
        }
        case 'startTime': {
          const val = draftStartTime.value || null;
          if (val !== (activity.value.startTime ?? null)) {
            update.startTime = val;
            changed = true;
            // Auto-update endTime to startTime + 1hr
            if (val) {
              update.endTime = addHourToTime(val);
            }
          }
          break;
        }
        case 'endTime': {
          let val = draftEndTime.value || null;
          // Clamp: endTime cannot be before startTime
          const currentStart = activity.value.startTime ?? null;
          if (val && currentStart && val < currentStart) {
            val = currentStart;
          }
          if (val !== (activity.value.endTime ?? null)) {
            update.endTime = val;
            changed = true;
          }
          break;
        }
        case 'dropoff': {
          const val = draftDropoffMemberId.value || null;
          if (val !== (activity.value.dropoffMemberId ?? null)) {
            update.dropoffMemberId = val;
            changed = true;
          }
          break;
        }
        case 'pickup': {
          const val = draftPickupMemberId.value || null;
          if (val !== (activity.value.pickupMemberId ?? null)) {
            update.pickupMemberId = val;
            changed = true;
          }
          break;
        }
        case 'instructorName': {
          const val = draftInstructorName.value.trim() || null;
          if (val !== (activity.value.instructorName ?? null)) {
            update.instructorName = val;
            changed = true;
          }
          break;
        }
        case 'instructorContact': {
          const val = draftInstructorContact.value.trim() || null;
          if (val !== (activity.value.instructorContact ?? null)) {
            update.instructorContact = val;
            changed = true;
          }
          break;
        }
        case 'notes': {
          const val = draftNotes.value.trim() || null;
          if (val !== (activity.value.notes ?? null)) {
            update.notes = val;
            changed = true;
          }
          break;
        }
      }

      if (changed) {
        // Scope-on-save for recurring activity inline edits
        if (isRecurring.value && props.occurrenceDate && !scopeResolved.value) {
          const scope = await chooseScope();
          if (!scope) return; // cancelled — discard edit

          if (scope === 'all') {
            await activityStore.updateActivity(activity.value.id, update);
            scopeResolved.value = true;
          } else if (scope === 'this-only') {
            const override = await activityStore.materializeOverride(
              activity.value.id,
              props.occurrenceDate,
              update
            );
            if (override) {
              effectiveTargetId.value = override.id;
              emit('activity-swapped', override.id);
            }
            // Override has recurrence:'none' so future edits skip scope naturally
          } else if (scope === 'this-and-future') {
            const newTemplate = await activityStore.splitActivity(
              activity.value.id,
              props.occurrenceDate
            );
            if (newTemplate) {
              await activityStore.updateActivity(newTemplate.id, update);
              effectiveTargetId.value = newTemplate.id;
              emit('activity-swapped', newTemplate.id);
            }
            scopeResolved.value = true;
          }
        } else {
          // Non-recurring, or scope already resolved — direct update
          const targetId = effectiveTargetId.value ?? activity.value.id;
          await activityStore.updateActivity(targetId, update);
        }
      }
    },
  });

// Scope-on-save state for inline edits on recurring occurrences.
// After the first scope choice, subsequent inline edits skip the modal.
const scopeResolved = ref(false);
// After "this-only" or "this-and-future", inline edits target the new entity
const effectiveTargetId = ref<string | null>(null);

// Reset when activity changes; redirect vacation-linked activities to VacationViewModal
watch(
  () => props.activity,
  (newActivity) => {
    editingField.value = null;
    scopeResolved.value = false;
    effectiveTargetId.value = null;
    showReschedule.value = false;

    // Vacation guard: redirect to travel page instead
    if (newActivity?.vacationId) {
      router.push({ path: '/travel', query: { vacation: newActivity.vacationId } });
      emit('close');
    }
  }
);

// Computed display values
const activityColor = computed(() =>
  activity.value ? getActivityColor(activity.value) : '#95A5A6'
);

const viewAssigneeIds = computed(() => (activity.value ? normalizeAssignees(activity.value) : []));

const viewFormattedDate = computed(() => {
  if (!activity.value?.date) return null;
  return formatDate(activity.value.date);
});

const viewFormattedEndDate = computed(() => {
  if (!activity.value?.endDate) return null;
  return formatDate(activity.value.endDate);
});

const viewIsAllDay = computed(() => activity.value?.isAllDay ?? false);

const isRecurring = computed(() => activity.value?.recurrence !== 'none');

const recurrenceLabel = computed(() => {
  if (!activity.value) return '';
  return t(`planner.recurrence.${activity.value.recurrence}`);
});

const FULL_DAY_NAMES: Record<number, string> = {
  0: 'Sundays',
  1: 'Mondays',
  2: 'Tuesdays',
  3: 'Wednesdays',
  4: 'Thursdays',
  5: 'Fridays',
  6: 'Saturdays',
};

const scheduleSummary = computed(() => {
  if (!activity.value || activity.value.recurrence === 'none') return '';
  const freq = recurrenceLabel.value;
  const days = activity.value.daysOfWeek;
  if (activity.value.recurrence === 'monthly') {
    const day = new Date(activity.value.date + 'T00:00:00').getDate();
    const suffix =
      day === 1 || day === 21 || day === 31
        ? 'st'
        : day === 2 || day === 22
          ? 'nd'
          : day === 3 || day === 23
            ? 'rd'
            : 'th';
    return `${freq} on the ${day}${suffix}`;
  }
  if (!days?.length || activity.value.recurrence !== 'weekly') return freq;
  const sorted = [...days].sort((a, b) => (a || 7) - (b || 7));
  const dayNames = sorted.map((d) => FULL_DAY_NAMES[d] ?? 'Sundays');
  if (dayNames.length === 1) return `${freq} on ${dayNames[0]}`;
  const last = dayNames.pop();
  return `${freq} on ${dayNames.join(', ')} and ${last}`;
});

const endDateFormatted = computed(() => {
  if (!activity.value?.recurrenceEndDate) return null;
  return formatDate(activity.value.recurrenceEndDate);
});

const linkedRecurringItem = computed(() => {
  if (!activity.value?.linkedRecurringItemId) return null;
  return recurringStore.getRecurringItemById(activity.value.linkedRecurringItemId) ?? null;
});

const linkedPayFromAccount = computed(() => {
  if (!activity.value?.payFromAccountId) return null;
  return accountsStore.accounts.find((a) => a.id === activity.value!.payFromAccountId) ?? null;
});

const linkedTransactions = computed(() => {
  if (!activity.value) return [];
  const actId = activity.value.id;
  const riId = activity.value.linkedRecurringItemId;
  // Match by activityId OR by recurringItemId, sorted most recent first, limited to 3
  return transactionsStore.transactions
    .filter((tx) => tx.activityId === actId || (riId && tx.recurringItemId === riId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
});

const feeLabel = computed(() => {
  if (!activity.value || activity.value.feeSchedule === 'none' || !activity.value.feeAmount)
    return null;
  const symbol = getCurrencyInfo(activity.value.feeCurrency ?? 'USD')?.symbol ?? '$';
  const schedule = t(`planner.fee.${activity.value.feeSchedule}`);
  return `${symbol}${activity.value.feeAmount.toLocaleString()} / ${schedule.toLowerCase()}`;
});

// Keyboard handlers
function handleTitleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveField('title');
  } else if (e.key === 'Escape') cancelEdit();
}

function handleInputKeydown(field: EditableField) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveField(field);
    } else if (e.key === 'Escape') cancelEdit();
  };
}

function handleNotesKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveField('notes');
  } else if (e.key === 'Escape') cancelEdit();
}

// Assignee handler (multi-select — no auto-save, user confirms)
function handleAssigneeChange(value: string | string[]) {
  draftAssigneeIds.value = Array.isArray(value) ? value : value ? [value] : [];
}

function handleStartTimeChange(value: string) {
  draftStartTime.value = value;
  saveField('startTime');
}

function handleEndTimeChange(value: string) {
  draftEndTime.value = value;
  saveField('endTime');
}

function handleDropoffChange(value: string | string[]) {
  draftDropoffMemberId.value = value as string;
  saveField('dropoff');
}

function handlePickupChange(value: string | string[]) {
  draftPickupMemberId.value = value as string;
  saveField('pickup');
}

function handleClose() {
  saveAndClose();
  emit('close');
}

function handleDone() {
  saveAndClose();
  emit('close');
}

function handleOpenEdit() {
  if (activity.value) {
    saveAndClose();
    emit('open-edit', activity.value);
  }
}

async function handleDelete() {
  if (!activity.value) return;
  const act = activity.value;
  emit('close');

  // Recurring activity with occurrence date — scope-aware delete
  if (act.recurrence !== 'none' && props.occurrenceDate) {
    const scope = await chooseScope();
    if (!scope) return;

    if (scope === 'this-only') {
      await activityStore.materializeOverride(act.id, props.occurrenceDate, {
        isActive: false,
      });
      playWhoosh();
      emit('deleted', act.id);
      return;
    }

    if (scope === 'this-and-future') {
      const dayBefore = toDateInputValue(addDays(parseLocalDate(props.occurrenceDate), -1));
      await activityStore.updateActivity(act.id, {
        recurrenceEndDate: dayBefore,
      });
      playWhoosh();
      emit('deleted', act.id);
      return;
    }

    // 'all' — fall through to standard delete with confirm
  }

  if (
    await showConfirm({
      title: 'planner.deleteActivity',
      message: 'planner.deleteConfirm',
      variant: 'danger',
    })
  ) {
    await activityStore.deleteActivity(act.id);
    playWhoosh();
    emit('deleted', act.id);
  }
}

// ── Reschedule ──────────────────────────────────────────────────────────────

const canReschedule = computed(() => !!activity.value);

function toggleReschedule() {
  showReschedule.value = !showReschedule.value;
  if (showReschedule.value && activity.value) {
    rescheduleDate.value = props.occurrenceDate ?? activity.value.date?.split('T')[0] ?? '';
    rescheduleEndDate.value = activity.value.endDate?.split('T')[0] ?? '';
    rescheduleStartTime.value = activity.value.startTime ?? '';
    rescheduleEndTime.value = activity.value.endTime ?? '';
  }
}

function handleRescheduleEndDate(value: string) {
  if (value && rescheduleDate.value && value < rescheduleDate.value) {
    rescheduleEndDate.value = rescheduleDate.value;
  } else {
    rescheduleEndDate.value = value;
  }
}

function handleRescheduleStartTime(value: string) {
  rescheduleStartTime.value = value;
  if (value) rescheduleEndTime.value = addHourToTime(value);
}

function handleRescheduleEndTime(value: string) {
  if (value && rescheduleStartTime.value && value < rescheduleStartTime.value) {
    rescheduleEndTime.value = rescheduleStartTime.value;
  } else {
    rescheduleEndTime.value = value;
  }
}

async function confirmReschedule() {
  if (!activity.value || !rescheduleDate.value) return;

  if (isRecurring.value && props.occurrenceDate) {
    // Recurring: materialize an override for this occurrence
    const overrides: Record<string, string | null> = { date: rescheduleDate.value };
    if (viewIsAllDay.value) {
      overrides.endDate = rescheduleEndDate.value || null;
    } else {
      if (rescheduleStartTime.value !== (activity.value.startTime ?? ''))
        overrides.startTime = rescheduleStartTime.value || null;
      if (rescheduleEndTime.value !== (activity.value.endTime ?? ''))
        overrides.endTime = rescheduleEndTime.value || null;
    }

    const override = await activityStore.materializeOverride(
      activity.value.id,
      props.occurrenceDate,
      overrides
    );
    if (override) {
      showReschedule.value = false;
      emit('activity-swapped', override.id);
      emit('close');
    }
  } else {
    // One-time: directly update the activity
    const update: Record<string, string | null> = { date: rescheduleDate.value };
    if (viewIsAllDay.value) {
      update.endDate = rescheduleEndDate.value || null;
    } else {
      if (rescheduleStartTime.value !== (activity.value.startTime ?? ''))
        update.startTime = rescheduleStartTime.value || null;
      if (rescheduleEndTime.value !== (activity.value.endTime ?? ''))
        update.endTime = rescheduleEndTime.value || null;
    }

    await activityStore.updateActivity(activity.value.id, update);
    showReschedule.value = false;
    emit('close');
  }
}
</script>

<template>
  <BeanieFormModal
    v-if="activity"
    variant="drawer"
    :open="true"
    :title="t('planner.viewActivity')"
    :icon="activity.icon || '📋'"
    :icon-bg="activityColor + '20'"
    :save-label="t('action.close')"
    save-gradient="orange"
    :save-disabled="showReschedule"
    :show-delete="!showReschedule"
    @close="handleClose"
    @save="handleDone"
    @delete="handleDelete"
  >
    <div class="space-y-4">
      <!-- Title — inline editable -->
      <InlineEditField
        :editing="editingField === 'title'"
        tint-color="orange"
        @start-edit="startEdit('title')"
      >
        <template #view>
          <span class="font-outfit text-xl font-bold text-[var(--color-text)] dark:text-gray-100">
            {{ activity.title }}
          </span>
        </template>
        <template #edit>
          <div class="flex items-center gap-2">
            <input
              ref="titleInputRef"
              v-model="draftTitle"
              type="text"
              class="font-outfit w-full rounded-md border-none bg-transparent px-1 text-xl font-bold text-[var(--color-text)] ring-2 ring-orange-500/30 outline-none dark:text-gray-100"
              @keydown="handleTitleKeydown"
            />
            <button
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
              @click.stop="saveField('title')"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </template>
      </InlineEditField>

      <!-- Category + Recurrence badges -->
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
          :style="{ background: activityColor }"
        >
          {{ activity.icon }}
          {{
            isBeanieMode
              ? getActivityCategoryName(activity.category).toLowerCase()
              : getActivityCategoryName(activity.category)
          }}
        </span>
        <span
          class="font-outfit inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
          :class="
            activity.recurrence === 'none'
              ? 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
              : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
          "
        >
          {{ recurrenceLabel }}
        </span>
      </div>

      <!-- Schedule summary box -->
      <div class="rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700">
        <div class="space-y-1.5">
          <!-- Recurring: show recurrence pattern -->
          <template v-if="isRecurring">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('planner.field.recurrence') }}
              </span>
              <span
                class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
              >
                {{ scheduleSummary }}
              </span>
            </div>
            <div v-if="endDateFormatted" class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('planner.field.endDate') }}
              </span>
              <span
                class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
              >
                {{ endDateFormatted }}
              </span>
            </div>
          </template>
          <!-- One-time: show date -->
          <template v-else>
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('planner.field.date') }}
              </span>
              <span
                class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
              >
                {{ viewFormattedDate }}
              </span>
            </div>
            <div v-if="viewFormattedEndDate" class="flex items-center gap-2">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                {{ t('planner.field.endDate') }}
              </span>
              <span
                class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
              >
                {{ viewFormattedEndDate }}
              </span>
            </div>
          </template>
          <!-- Time row (shown for both recurring and one-time) -->
          <div v-if="viewIsAllDay" class="flex items-center gap-2">
            <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {{ t('modal.time') }}
            </span>
            <span class="font-outfit text-primary-500 text-sm font-semibold">
              ☀️ {{ t('planner.allDay') }}
            </span>
          </div>
          <div v-else-if="activity.startTime" class="flex items-center gap-2">
            <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {{ t('modal.time') }}
            </span>
            <span
              class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
            >
              {{ formatTime12(activity.startTime)
              }}{{ activity.endTime ? ` – ${formatTime12(activity.endTime)}` : '' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Reschedule action -->
      <div v-if="canReschedule">
        <button
          type="button"
          class="font-outfit flex w-full items-center justify-center gap-2 rounded-[14px] border px-4 py-3 text-sm font-bold transition-colors"
          :class="
            showReschedule
              ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-400'
              : 'border-orange-200 bg-orange-50/60 text-orange-600 hover:border-orange-300 hover:bg-orange-50 dark:border-orange-800/40 dark:bg-orange-900/10 dark:text-orange-400 dark:hover:border-orange-700 dark:hover:bg-orange-900/20'
          "
          @click="toggleReschedule"
        >
          <span>📅</span>
          {{ t('planner.reschedule') }}
        </button>

        <div
          v-if="showReschedule"
          class="mt-2 space-y-3 rounded-[14px] border border-orange-200/60 bg-orange-50/50 p-4 dark:border-orange-800/30 dark:bg-orange-900/10"
        >
          <p class="text-xs text-[var(--color-text-muted)]">
            {{ t('planner.rescheduleHint') }}
          </p>

          <div class="grid grid-cols-2 gap-3" :class="{ 'grid-cols-3': !viewIsAllDay }">
            <FormFieldGroup :label="t('planner.rescheduleTo')">
              <BaseInput v-model="rescheduleDate" type="date" />
            </FormFieldGroup>
            <template v-if="viewIsAllDay">
              <FormFieldGroup :label="t('planner.field.endDate')">
                <BaseInput
                  :model-value="rescheduleEndDate"
                  type="date"
                  :min="rescheduleDate"
                  @update:model-value="handleRescheduleEndDate($event as string)"
                />
              </FormFieldGroup>
            </template>
            <template v-else>
              <FormFieldGroup :label="t('modal.startTime')">
                <TimePresetPicker
                  :model-value="rescheduleStartTime"
                  @update:model-value="handleRescheduleStartTime"
                />
              </FormFieldGroup>
              <FormFieldGroup :label="t('modal.endTime')">
                <TimePresetPicker
                  :model-value="rescheduleEndTime"
                  @update:model-value="handleRescheduleEndTime"
                />
              </FormFieldGroup>
            </template>
          </div>

          <div class="flex gap-2">
            <button
              type="button"
              class="font-outfit flex-1 rounded-[14px] bg-gradient-to-r from-[#F15D22] to-[#E67E22] py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:shadow-md"
              :disabled="!rescheduleDate"
              :class="{ 'cursor-not-allowed opacity-40': !rescheduleDate }"
              @click="confirmReschedule"
            >
              {{ t('planner.rescheduleConfirm') }}
            </button>
            <button
              type="button"
              class="font-outfit rounded-[14px] border border-gray-200 px-4 py-2.5 text-sm font-bold text-[var(--color-text)] transition-colors hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
              @click="showReschedule = false"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- Hint: use Edit for recurring schedule changes -->
        <p
          v-if="isRecurring && !showReschedule"
          class="mt-2 text-center text-xs text-[var(--color-text-muted)] opacity-50"
        >
          {{ t('planner.rescheduleEditHint') }}
        </p>
      </div>

      <!-- Everything below reschedule dims when rescheduling -->
      <div
        class="space-y-4 transition-all duration-300"
        :class="showReschedule ? 'pointer-events-none opacity-25 select-none' : 'opacity-100'"
      >
        <!-- Assignee — inline editable -->
        <FormFieldGroup :label="t('planner.field.assignee')">
          <InlineEditField
            :editing="editingField === 'assignee'"
            tint-color="orange"
            @start-edit="startEdit('assignee')"
          >
            <template #view>
              <div v-if="viewAssigneeIds.length" class="flex flex-wrap gap-1">
                <MemberChip v-for="mid in viewAssigneeIds" :key="mid" :member-id="mid" size="md" />
              </div>
              <span v-else class="text-sm text-[var(--color-text-muted)]">
                {{ t('todo.unassigned') }}
              </span>
            </template>
            <template #edit>
              <FamilyChipPicker
                :model-value="draftAssigneeIds"
                mode="multi"
                compact
                @update:model-value="handleAssigneeChange"
              />
              <div class="mt-1.5 flex gap-1.5">
                <button
                  class="rounded-lg bg-[var(--color-primary-500)] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--color-primary-600)]"
                  :disabled="draftAssigneeIds.length === 0"
                  :class="{ 'cursor-not-allowed opacity-40': draftAssigneeIds.length === 0 }"
                  @click="saveField('assignee')"
                >
                  ✓
                </button>
                <button
                  class="rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300 dark:hover:bg-gray-500"
                  @click="cancelEdit"
                >
                  ✕
                </button>
              </div>
            </template>
          </InlineEditField>
        </FormFieldGroup>

        <!-- Start / End time — inline editable (recurring only, not all-day) -->
        <div v-if="isRecurring && !viewIsAllDay" class="grid grid-cols-2 gap-4">
          <FormFieldGroup :label="t('modal.startTime')">
            <InlineEditField
              :editing="editingField === 'startTime'"
              tint-color="orange"
              @start-edit="startEdit('startTime')"
            >
              <template #view>
                <span
                  v-if="activity.startTime"
                  class="font-outfit text-sm font-semibold text-[var(--color-text)]"
                >
                  {{ activity.startTime }}
                </span>
                <span v-else class="text-sm text-[var(--color-text-muted)]">
                  {{ t('modal.selectTime') }}
                </span>
              </template>
              <template #edit>
                <TimePresetPicker
                  :model-value="draftStartTime"
                  @update:model-value="handleStartTimeChange"
                />
              </template>
            </InlineEditField>
          </FormFieldGroup>

          <FormFieldGroup :label="t('modal.endTime')">
            <InlineEditField
              :editing="editingField === 'endTime'"
              tint-color="orange"
              @start-edit="startEdit('endTime')"
            >
              <template #view>
                <span
                  v-if="activity.endTime"
                  class="font-outfit text-sm font-semibold text-[var(--color-text)]"
                >
                  {{ activity.endTime }}
                </span>
                <span v-else class="text-sm text-[var(--color-text-muted)]">
                  {{ t('modal.selectTime') }}
                </span>
              </template>
              <template #edit>
                <TimePresetPicker
                  :model-value="draftEndTime"
                  @update:model-value="handleEndTimeChange"
                />
              </template>
            </InlineEditField>
          </FormFieldGroup>
        </div>

        <!-- Location — whole field opens Google Maps. Editing lives on the
             footer ✏️ Edit button (full form) to keep the common tap path
             (viewing where the activity is) a single frictionless action. -->
        <FormFieldGroup v-if="activity.location" :label="t('planner.field.location')">
          <a
            :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location)}`"
            target="_blank"
            rel="noopener noreferrer"
            class="group/loc -mx-1.5 flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-orange-50 focus:bg-orange-50 focus:outline-none dark:hover:bg-orange-900/20 dark:focus:bg-orange-900/20"
            :title="t('planner.openInMaps')"
          >
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#F15D22] transition-colors group-hover/loc:bg-orange-100 dark:group-hover/loc:bg-orange-900/30"
              aria-hidden="true"
            >
              <svg
                class="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </span>
            <span
              class="text-sm text-[var(--color-text)] group-hover/loc:underline dark:text-gray-300"
            >
              {{ activity.location }}
            </span>
          </a>
        </FormFieldGroup>

        <!-- Drop-off / Pick-up — inline editable -->
        <div
          v-if="activity.dropoffMemberId || activity.pickupMemberId"
          class="grid grid-cols-2 gap-x-4"
        >
          <div v-if="activity.dropoffMemberId">
            <FormFieldGroup :label="'🚗 ' + t('planner.field.dropoff')">
              <InlineEditField
                :editing="editingField === 'dropoff'"
                tint-color="orange"
                @start-edit="startEdit('dropoff')"
              >
                <template #view>
                  <div>
                    <span
                      class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
                    >
                      {{ getMemberName(activity.dropoffMemberId) }}
                    </span>
                    <button
                      v-if="findCompletion(activity.dropoffCompletions, occurrenceDate)"
                      class="mt-1 flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 text-[11px] font-medium text-green-700 transition-colors hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                      @click.stop="toggleDuty('dropoff')"
                    >
                      <span>✓</span>
                      {{
                        formatCompletion(
                          findCompletion(activity.dropoffCompletions, occurrenceDate)!
                        )
                      }}
                    </button>
                    <button
                      v-else-if="occurrenceDate"
                      class="mt-1 flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-orange-50 hover:text-[var(--color-primary-500)] dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-orange-900/20 dark:hover:text-orange-400"
                      @click.stop="toggleDuty('dropoff')"
                    >
                      <span class="h-3 w-3 rounded-sm border-[1.5px] border-current" />
                      {{ t('nook.dutyMarkDone') }}
                    </button>
                  </div>
                </template>
                <template #edit>
                  <FamilyChipPicker
                    :model-value="draftDropoffMemberId"
                    mode="single"
                    compact
                    @update:model-value="handleDropoffChange"
                  />
                  <button
                    class="mt-1.5 rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300 dark:hover:bg-gray-500"
                    @click="cancelEdit"
                  >
                    ✕
                  </button>
                </template>
              </InlineEditField>
            </FormFieldGroup>
          </div>
          <div v-if="activity.pickupMemberId">
            <FormFieldGroup :label="'🚗 ' + t('planner.field.pickup')">
              <InlineEditField
                :editing="editingField === 'pickup'"
                tint-color="orange"
                @start-edit="startEdit('pickup')"
              >
                <template #view>
                  <div>
                    <span
                      class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
                    >
                      {{ getMemberName(activity.pickupMemberId) }}
                    </span>
                    <button
                      v-if="findCompletion(activity.pickupCompletions, occurrenceDate)"
                      class="mt-1 flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 text-[11px] font-medium text-green-700 transition-colors hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
                      @click.stop="toggleDuty('pickup')"
                    >
                      <span>✓</span>
                      {{
                        formatCompletion(
                          findCompletion(activity.pickupCompletions, occurrenceDate)!
                        )
                      }}
                    </button>
                    <button
                      v-else-if="occurrenceDate"
                      class="mt-1 flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:bg-orange-50 hover:text-[var(--color-primary-500)] dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-orange-900/20 dark:hover:text-orange-400"
                      @click.stop="toggleDuty('pickup')"
                    >
                      <span class="h-3 w-3 rounded-sm border-[1.5px] border-current" />
                      {{ t('nook.dutyMarkDone') }}
                    </button>
                  </div>
                </template>
                <template #edit>
                  <FamilyChipPicker
                    :model-value="draftPickupMemberId"
                    mode="single"
                    compact
                    @update:model-value="handlePickupChange"
                  />
                  <button
                    class="mt-1.5 rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300 dark:hover:bg-gray-500"
                    @click="cancelEdit"
                  >
                    ✕
                  </button>
                </template>
              </InlineEditField>
            </FormFieldGroup>
          </div>
        </div>

        <!-- Instructor — only shown when populated -->
        <div
          v-if="activity.instructorName || activity.instructorContact"
          class="grid grid-cols-2 gap-4"
        >
          <FormFieldGroup v-if="activity.instructorName" :label="t('planner.field.instructor')">
            <InlineEditField
              :editing="editingField === 'instructorName'"
              tint-color="orange"
              @start-edit="startEdit('instructorName')"
            >
              <template #view>
                <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
                  {{ activity.instructorName }}
                </span>
              </template>
              <template #edit>
                <div class="flex items-center gap-2">
                  <div class="flex-1">
                    <BaseInput
                      ref="instructorNameRef"
                      v-model="draftInstructorName"
                      type="text"
                      :placeholder="t('planner.field.instructor')"
                      class="rounded-[14px] ring-2 ring-orange-500/30"
                      @keydown="handleInputKeydown('instructorName')($event)"
                    />
                  </div>
                  <button
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                    @click.stop="saveField('instructorName')"
                  >
                    <svg
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      viewBox="0 0 24 24"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </div>
              </template>
            </InlineEditField>
          </FormFieldGroup>
          <FormFieldGroup
            v-if="activity.instructorContact"
            :label="t('planner.field.instructorContact')"
          >
            <InlineEditField
              :editing="editingField === 'instructorContact'"
              tint-color="orange"
              @start-edit="startEdit('instructorContact')"
            >
              <template #view>
                <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
                  {{ activity.instructorContact }}
                </span>
              </template>
              <template #edit>
                <div class="flex items-center gap-2">
                  <div class="flex-1">
                    <BaseInput
                      ref="instructorContactRef"
                      v-model="draftInstructorContact"
                      type="text"
                      :placeholder="t('planner.field.instructorContact')"
                      class="rounded-[14px] ring-2 ring-orange-500/30"
                      @keydown="handleInputKeydown('instructorContact')($event)"
                    />
                  </div>
                  <button
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                    @click.stop="saveField('instructorContact')"
                  >
                    <svg
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      viewBox="0 0 24 24"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </div>
              </template>
            </InlineEditField>
          </FormFieldGroup>
        </div>

        <!-- Cost — read-only -->
        <FormFieldGroup v-if="feeLabel" :label="t('planner.cost')">
          <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">
            {{ feeLabel }}
          </span>
        </FormFieldGroup>

        <!-- Notes — only shown when populated -->
        <FormFieldGroup v-if="activity.notes" :label="t('planner.field.notes')">
          <InlineEditField
            :editing="editingField === 'notes'"
            tint-color="orange"
            align-items="start"
            @start-edit="startEdit('notes')"
          >
            <template #view>
              <p
                class="text-sm leading-relaxed whitespace-pre-line text-[var(--color-text)] dark:text-gray-300"
              >
                {{ activity.notes }}
              </p>
            </template>
            <template #edit>
              <div class="space-y-2">
                <textarea
                  ref="notesRef"
                  v-model="draftNotes"
                  rows="3"
                  class="w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm text-[var(--color-text)] ring-2 ring-orange-500/30 transition-all focus:border-orange-500 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
                  :placeholder="t('planner.field.notes')"
                  @keydown="handleNotesKeydown"
                />
                <div class="flex items-center justify-between">
                  <span class="text-xs text-[var(--color-text-muted)]">
                    Ctrl+Enter {{ t('modal.toSave') }}
                  </span>
                  <button
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                    @click.stop="saveField('notes')"
                  >
                    <svg
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      viewBox="0 0 24 24"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </template>
          </InlineEditField>
        </FormFieldGroup>

        <!-- Linked Recurring Payment -->
        <FormFieldGroup v-if="linkedRecurringItem" :label="t('txLink.monthlyTransaction')">
          <div class="space-y-1">
            <div
              class="flex items-center justify-between rounded-xl bg-[var(--tint-orange-8)] px-3 py-2"
            >
              <div class="text-sm text-[var(--color-text)]">
                <span class="font-outfit font-bold"
                  >{{ linkedRecurringItem.currency }}
                  {{
                    linkedRecurringItem.amount.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })
                  }}/{{ linkedRecurringItem.frequency === 'yearly' ? 'yr' : 'mo' }}</span
                >
                <span v-if="linkedPayFromAccount" class="text-[var(--color-text-muted)]">
                  &middot; from {{ linkedPayFromAccount.name }}
                </span>
              </div>
              <button
                type="button"
                class="hover:text-primary-500 text-xs font-semibold text-[var(--color-text-muted)] transition-colors"
                @click="
                  emit('close');
                  router.push({
                    path: '/transactions',
                    query: { recurringItem: linkedRecurringItem.id },
                  });
                "
              >
                {{ t('action.view') }} &rarr;
              </button>
            </div>
          </div>
        </FormFieldGroup>

        <!-- Recent Transactions -->
        <div v-if="linkedTransactions.length > 0" class="space-y-2">
          <div
            class="font-outfit text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
          >
            {{ t('txLink.recentTransactions') }}
          </div>
          <button
            v-for="tx in linkedTransactions"
            :key="tx.id"
            type="button"
            class="group flex w-full items-center justify-between rounded-xl bg-[var(--tint-slate-5)] px-3 py-2 text-left transition-colors hover:bg-[var(--tint-slate-8)] dark:bg-slate-700 dark:hover:bg-slate-600"
            @click="
              emit('close');
              router.push({ path: '/transactions', query: { view: tx.id } });
            "
          >
            <div class="text-sm text-[var(--color-text)]">
              <span class="text-[var(--color-text-muted)]">{{ tx.date.slice(0, 10) }}</span>
              &middot; {{ tx.description || tx.category }}
            </div>
            <div class="flex items-center gap-2">
              <span class="font-outfit text-sm font-bold text-[var(--color-text)]">
                {{ tx.currency }}
                {{ tx.amount.toLocaleString('en-US', { minimumFractionDigits: 2 }) }}
              </span>
              <span
                class="text-xs text-[var(--color-text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
                >&rarr;</span
              >
            </div>
          </button>
        </div>

        <!-- Created by — subtle footer -->
        <div class="border-t border-gray-100 pt-2 dark:border-slate-700">
          <span class="text-xs text-[var(--color-text-muted)]">
            {{ t('planner.createdBy') }}: {{ getMemberName(activity.createdBy) }}
          </span>
        </div>
      </div>
      <!-- /reschedule dim wrapper -->
    </div>

    <template #footer-start>
      <button
        type="button"
        class="font-outfit flex-1 rounded-[16px] border border-gray-200 py-3.5 text-sm font-bold transition-all duration-300"
        :class="
          showReschedule
            ? 'pointer-events-none cursor-not-allowed text-[var(--color-text)] opacity-25 dark:text-gray-200'
            : 'text-[var(--color-text)] hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700'
        "
        :disabled="showReschedule"
        @click="handleOpenEdit"
      >
        ✏️ {{ t('action.edit') }}
      </button>
    </template>
  </BeanieFormModal>
</template>
