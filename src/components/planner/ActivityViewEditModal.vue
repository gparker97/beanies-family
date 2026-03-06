<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useActivityStore, getActivityColor } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { getCurrencyInfo } from '@/constants/currencies';
import { formatDate, addHourToTime } from '@/utils/date';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import type { FamilyActivity } from '@/types/models';

type EditableField = 'title' | 'assignee' | 'date' | 'startTime' | 'endTime' | 'location' | 'notes';

const props = defineProps<{
  activity: FamilyActivity | null;
}>();

const emit = defineEmits<{
  close: [];
  deleted: [id: string];
  'open-edit': [activity: FamilyActivity];
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
const draftNotes = ref('');

// Template refs for auto-focus
const titleInputRef = ref<HTMLInputElement | null>(null);
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
        case 'notes':
          draftNotes.value = activity.value.notes ?? '';
          break;
      }
      nextTick(() => {
        if (field === 'title') titleInputRef.value?.focus();
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
        await activityStore.updateActivity(activity.value.id, update);
      }
    },
  });

// Reset when activity changes
watch(
  () => props.activity,
  () => {
    editingField.value = null;
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

const recurrenceLabel = computed(() => {
  if (!activity.value) return '';
  return t(`planner.recurrence.${activity.value.recurrence}`);
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
  const id = activity.value.id;
  emit('close');
  if (
    await showConfirm({
      title: 'planner.deleteActivity',
      message: 'planner.deleteConfirm',
      variant: 'danger',
    })
  ) {
    await activityStore.deleteActivity(id);
    playWhoosh();
    emit('deleted', id);
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
    :save-label="t('action.done')"
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

      <!-- Date — inline editable -->
      <FormFieldGroup :label="t('planner.field.date')">
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

      <!-- Times — inline editable -->
      <div class="grid grid-cols-2 gap-4">
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

      <!-- Location — inline editable -->
      <FormFieldGroup :label="t('planner.field.location')">
        <InlineEditField
          :editing="editingField === 'location'"
          tint-color="orange"
          @start-edit="startEdit('location')"
        >
          <template #view>
            <span
              v-if="activity.location"
              class="text-sm text-[var(--color-text)] dark:text-gray-300"
            >
              {{ activity.location }}
            </span>
            <span v-else class="text-sm text-[var(--color-text-muted)] italic">
              {{ t('planner.noLocation') }}
            </span>
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

      <!-- Transport — read-only -->
      <div
        v-if="activity.dropoffMemberId || activity.pickupMemberId"
        class="grid grid-cols-2 gap-4"
      >
        <FormFieldGroup v-if="activity.dropoffMemberId" :label="t('planner.field.dropoff')">
          <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
            {{ getMemberName(activity.dropoffMemberId) }}
          </span>
        </FormFieldGroup>
        <FormFieldGroup v-if="activity.pickupMemberId" :label="t('planner.field.pickup')">
          <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
            {{ getMemberName(activity.pickupMemberId) }}
          </span>
        </FormFieldGroup>
      </div>

      <!-- Instructor — read-only -->
      <FormFieldGroup v-if="activity.instructorName" :label="t('planner.field.instructor')">
        <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
          {{ activity.instructorName }}
          <span v-if="activity.instructorContact" class="text-[var(--color-text-muted)]">
            &middot; {{ activity.instructorContact }}
          </span>
        </span>
      </FormFieldGroup>

      <!-- Notes — inline editable -->
      <FormFieldGroup :label="t('planner.field.notes')">
        <InlineEditField
          :editing="editingField === 'notes'"
          tint-color="orange"
          align-items="start"
          @start-edit="startEdit('notes')"
        >
          <template #view>
            <p
              v-if="activity.notes"
              class="text-sm leading-relaxed whitespace-pre-line text-[var(--color-text)] dark:text-gray-300"
            >
              {{ activity.notes }}
            </p>
            <p v-else class="text-sm text-[var(--color-text-muted)] italic">
              {{ t('planner.noNotes') }}
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

      <!-- Created by — read-only -->
      <FormFieldGroup :label="t('planner.createdBy')">
        <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
          {{ getMemberName(activity.createdBy) }}
        </span>
      </FormFieldGroup>

      <!-- Edit button -->
      <button
        type="button"
        class="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-[var(--color-text)] transition-colors hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-700"
        @click="handleOpenEdit"
      >
        {{ t('action.edit') }}
      </button>
    </div>
  </BeanieFormModal>
</template>
