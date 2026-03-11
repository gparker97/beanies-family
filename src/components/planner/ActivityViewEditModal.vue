<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { chooseScope } from '@/composables/useRecurringEditScope';
import { useSounds } from '@/composables/useSounds';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getCurrencyInfo } from '@/constants/currencies';
import { formatDate, addHourToTime, toDateInputValue, addDays, parseLocalDate } from '@/utils/date';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import type { FamilyActivity } from '@/types/models';

type EditableField =
  | 'title'
  | 'assignee'
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'location'
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

const { t } = useTranslation();
const { playWhoosh } = useSounds();
const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const { getMemberName } = useMemberInfo();

// Live-lookup from store so display stays reactive after inline edits
const activity = computed(() =>
  props.activity
    ? (activityStore.activities.find((a) => a.id === props.activity!.id) ?? props.activity)
    : null
);

// Draft refs
const draftTitle = ref('');
const draftAssigneeId = ref('');
const draftDate = ref('');
const draftStartTime = ref('');
const draftEndTime = ref('');
const draftLocation = ref('');
const draftDropoffMemberId = ref('');
const draftPickupMemberId = ref('');
const draftInstructorName = ref('');
const draftInstructorContact = ref('');
const draftNotes = ref('');

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
          draftAssigneeId.value = activity.value.assigneeId ?? '';
          break;
        case 'date':
          draftDate.value = activity.value.date?.split('T')[0] ?? '';
          break;
        case 'startTime':
          draftStartTime.value = activity.value.startTime ?? '';
          break;
        case 'endTime':
          draftEndTime.value = activity.value.endTime ?? '';
          break;
        case 'location':
          draftLocation.value = activity.value.location ?? '';
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
          const val = draftAssigneeId.value || null;
          if (val !== (activity.value.assigneeId ?? null)) {
            update.assigneeId = val;
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
        case 'location': {
          const val = draftLocation.value.trim() || null;
          if (val !== (activity.value.location ?? null)) {
            update.location = val;
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

// Reset when activity changes
watch(
  () => props.activity,
  () => {
    editingField.value = null;
    scopeResolved.value = false;
    effectiveTargetId.value = null;
  }
);

// Computed display values
const activityColor = computed(() =>
  activity.value ? getActivityColor(activity.value) : '#95A5A6'
);

const viewAssignee = computed(() => {
  if (!activity.value?.assigneeId) return null;
  return familyStore.members.find((m) => m.id === activity.value!.assigneeId);
});

const viewFormattedDate = computed(() => {
  if (!activity.value?.date) return null;
  return formatDate(activity.value.date);
});

const isRecurring = computed(() => activity.value?.recurrence !== 'none');

const recurrenceLabel = computed(() => {
  if (!activity.value) return '';
  return t(`planner.recurrence.${activity.value.recurrence}`);
});

const DAY_KEYS: Record<number, string> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
};

const daysOfWeekLabel = computed(() => {
  if (!activity.value?.daysOfWeek?.length) return '';
  // Sort days starting from Monday (1,2,3,4,5,6,0)
  const sorted = [...activity.value.daysOfWeek].sort((a, b) => (a || 7) - (b || 7));
  return sorted
    .map((d) => {
      const key = DAY_KEYS[d] ?? 'sun';
      return t(`planner.day.${key}` as 'planner.day.sun');
    })
    .join(', ');
});

const endDateFormatted = computed(() => {
  if (!activity.value?.recurrenceEndDate) return null;
  return formatDate(activity.value.recurrenceEndDate);
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

// Auto-save handlers for pickers
function handleAssigneeChange(value: string | string[]) {
  draftAssigneeId.value = value as string;
  saveField('assignee');
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
</script>

<template>
  <BeanieFormModal
    v-if="activity"
    :open="true"
    :title="t('planner.viewActivity')"
    :icon="activity.icon || '📋'"
    :icon-bg="activityColor + '20'"
    size="narrow"
    :save-label="t('action.close')"
    save-gradient="orange"
    :show-delete="true"
    @close="handleClose"
    @save="handleDone"
    @delete="handleDelete"
  >
    <div class="space-y-3">
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
          {{ activity.icon }} {{ t(`planner.field.category`) }}:
          {{ activity.category }}
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

      <!-- Schedule & transport summary box -->
      <div
        v-if="isRecurring || activity.dropoffMemberId || activity.pickupMemberId"
        class="rounded-[14px] bg-[var(--tint-slate-5)] px-4 py-3 dark:bg-slate-700"
      >
        <div class="space-y-1.5">
          <!-- Recurrence details -->
          <div v-if="isRecurring" class="flex items-center gap-2">
            <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {{ t('planner.field.recurrence') }}
            </span>
            <span
              class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
            >
              {{ recurrenceLabel }}
            </span>
          </div>
          <div v-if="daysOfWeekLabel" class="flex items-center gap-2">
            <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
              {{ t('modal.whichDays') }}
            </span>
            <span
              class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
            >
              {{ daysOfWeekLabel }}
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

          <!-- Divider between schedule and transport -->
          <div
            v-if="isRecurring && (activity.dropoffMemberId || activity.pickupMemberId)"
            class="border-t border-gray-200/60 pt-1.5 dark:border-slate-600/60"
          />

          <!-- Transport: Drop-off / Pick-up — inline editable -->
          <div
            v-if="activity.dropoffMemberId || activity.pickupMemberId"
            class="grid grid-cols-2 gap-x-4"
          >
            <div v-if="activity.dropoffMemberId">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                🚗 {{ t('planner.field.dropoff') }}
              </span>
              <InlineEditField
                :editing="editingField === 'dropoff'"
                tint-color="orange"
                @start-edit="startEdit('dropoff')"
              >
                <template #view>
                  <span
                    class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
                  >
                    {{ getMemberName(activity.dropoffMemberId) }}
                  </span>
                </template>
                <template #edit>
                  <FamilyChipPicker
                    :model-value="draftDropoffMemberId"
                    mode="single"
                    compact
                    @update:model-value="handleDropoffChange"
                  />
                </template>
              </InlineEditField>
            </div>
            <div v-if="activity.pickupMemberId">
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase">
                🚗 {{ t('planner.field.pickup') }}
              </span>
              <InlineEditField
                :editing="editingField === 'pickup'"
                tint-color="orange"
                @start-edit="startEdit('pickup')"
              >
                <template #view>
                  <span
                    class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
                  >
                    {{ getMemberName(activity.pickupMemberId) }}
                  </span>
                </template>
                <template #edit>
                  <FamilyChipPicker
                    :model-value="draftPickupMemberId"
                    mode="single"
                    compact
                    @update:model-value="handlePickupChange"
                  />
                </template>
              </InlineEditField>
            </div>
          </div>
        </div>
      </div>

      <!-- Assignee — inline editable -->
      <FormFieldGroup :label="t('planner.field.assignee')">
        <InlineEditField
          :editing="editingField === 'assignee'"
          tint-color="orange"
          @start-edit="startEdit('assignee')"
        >
          <template #view>
            <span
              v-if="viewAssignee"
              class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white"
              :style="{
                background: `linear-gradient(135deg, ${viewAssignee.color}, ${viewAssignee.color}cc)`,
              }"
            >
              {{ viewAssignee.name }}
            </span>
            <span v-else class="text-sm text-[var(--color-text-muted)]">
              {{ t('todo.unassigned') }}
            </span>
          </template>
          <template #edit>
            <FamilyChipPicker
              :model-value="draftAssigneeId"
              mode="single"
              compact
              @update:model-value="handleAssigneeChange"
            />
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Date & Times — combined row -->
      <div :class="!isRecurring ? 'grid grid-cols-3 gap-4' : 'grid grid-cols-2 gap-4'">
        <!-- Date (only for one-off activities) -->
        <FormFieldGroup v-if="!isRecurring" :label="t('planner.field.date')">
          <InlineEditField
            :editing="editingField === 'date'"
            tint-color="orange"
            @start-edit="startEdit('date')"
          >
            <template #view>
              <span
                v-if="viewFormattedDate"
                class="font-outfit text-sm font-semibold text-[var(--color-text)]"
              >
                {{ viewFormattedDate }}
              </span>
              <span v-else class="text-sm text-[var(--color-text-muted)]">&mdash;</span>
            </template>
            <template #edit>
              <div class="flex items-center gap-2">
                <div class="flex-1">
                  <BaseInput
                    v-model="draftDate"
                    type="date"
                    class="rounded-[14px] ring-2 ring-orange-500/30"
                    @keydown="handleInputKeydown('date')($event)"
                  />
                </div>
                <button
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                  @click.stop="saveField('date')"
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

      <!-- Location — only shown when populated -->
      <FormFieldGroup v-if="activity.location" :label="t('planner.field.location')">
        <InlineEditField
          :editing="editingField === 'location'"
          tint-color="orange"
          @start-edit="startEdit('location')"
        >
          <template #view>
            <div class="flex items-center gap-1.5">
              <a
                :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location)}`"
                target="_blank"
                rel="noopener noreferrer"
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[#F15D22] transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                :title="t('planner.openInMaps')"
                @click.stop
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
              </a>
              <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
                {{ activity.location }}
              </span>
            </div>
          </template>
          <template #edit>
            <div class="flex items-center gap-2">
              <div class="flex-1">
                <BaseInput
                  v-model="draftLocation"
                  type="text"
                  :placeholder="t('planner.field.location')"
                  class="rounded-[14px] ring-2 ring-orange-500/30"
                  @keydown="handleInputKeydown('location')($event)"
                />
              </div>
              <button
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-orange-600 transition-colors hover:bg-orange-100 dark:hover:bg-orange-900/30"
                @click.stop="saveField('location')"
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

      <!-- Cost — read-only -->
      <FormFieldGroup v-if="feeLabel" :label="t('planner.cost')">
        <span class="font-outfit text-sm font-semibold text-[var(--color-text)]">
          {{ feeLabel }}
        </span>
      </FormFieldGroup>

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

      <!-- Created by — subtle footer -->
      <div class="border-t border-gray-100 pt-2 dark:border-slate-700">
        <span class="text-xs text-[var(--color-text-muted)]">
          {{ t('planner.createdBy') }}: {{ getMemberName(activity.createdBy) }}
        </span>
      </div>
    </div>

    <template #footer-start>
      <button
        type="button"
        class="font-outfit flex-1 rounded-[16px] border border-gray-200 py-3.5 text-sm font-bold text-[var(--color-text)] transition-all duration-200 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
        @click="handleOpenEdit"
      >
        ✏️ {{ t('action.edit') }}
      </button>
    </template>
  </BeanieFormModal>
</template>
