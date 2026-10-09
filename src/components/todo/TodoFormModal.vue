<script setup lang="ts">
/**
 * The To-Dos page's "Add To-do" sidebar: a new to-do with its details (who, when, notes).
 *
 * CREATE ONLY. Editing stays per-field inline in `TodoViewEditModal`; this drawer never takes
 * an existing to-do. Opened by the page header's "+ Add To-do" and the quick-add sheet's
 * To-do tile.
 *
 * The create itself (author, payload rules, write) is `useTodoCreate().createTodoFrom`, shared
 * with the quick-add bar and the Nook widget, so this view only holds the draft. A `null` create
 * keeps the drawer open with the draft (the missing author or the failed write is already
 * toasted). It emits `created(id)` and never logs: `createTodoFrom` counts the create and the page
 * owns the reveal.
 *
 * A save still in flight when the drawer is closed and reopened belongs to the OLD draft: the
 * to-do exists, but it must not report `created` (the page would close the new draft), so each
 * open is a generation and a stale save does nothing more.
 *
 * The magic beans quick card at the top routes its result through the page's `todo` consumer,
 * which closes this drawer before the review drawer opens.
 *
 * Repeat (#123): a quiet switch row under the date and time. On, it reads "Create a Repeating
 * Family Reminder" and reveals the `RecurrencePicker`, anchored on the due date. A repeat needs
 * a date: turning it on with none sets today, and clearing the date turns it off (visibly, never
 * a silent drop). The picker emits its default rule on mount; that is the initial value here,
 * because this form saves explicitly.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import ToggleRow from '@/components/ui/ToggleRow.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import RecurrencePicker from '@/components/ui/RecurrencePicker.vue';
import RepeatGlyph from '@/components/todo/RepeatGlyph.vue';
import MagicBeansQuickCard from '@/components/ai/MagicBeansQuickCard.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useFormValidation } from '@/composables/useFormValidation';
import { useTodoCreate } from '@/composables/useTodoCreate';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useToday } from '@/composables/useToday';
import type { RecurrenceRule } from '@/types/models';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  created: [id: string];
}>();

const { t } = useTranslation();
const { createTodoFrom } = useTodoCreate();
const { isDesktop } = useBreakpoint();
const { today } = useToday();

const title = ref('');
const description = ref('');
const assigneeIds = ref<string[]>([]);
const dueDate = ref('');
const dueTime = ref('');
const repeatOn = ref(false);
const repeatRule = ref<RecurrenceRule | null>(null);
const titleField = ref<InstanceType<typeof BaseInput> | null>(null);

/** Bumped on every open, so a save from an earlier open never reports into this one. */
let generation = 0;

// A cleared date takes its time with it, so an old time never comes back with a new date. It
// takes the repeat too: a series is anchored on its date, so the switch visibly turns off.
watch(dueDate, (date) => {
  if (date) return;
  dueTime.value = '';
  repeatOn.value = false;
});

const repeatTitle = computed(() =>
  repeatOn.value ? t('todo.repeat.createTitle') : t('todo.repeat.toggle')
);
const repeatHint = computed(() =>
  repeatOn.value ? t('todo.repeat.createHint') : t('todo.repeat.toggleHintOff')
);

function onRepeatToggle(on: boolean): void {
  // A repeat starts from a date; with none yet, it starts today.
  if (on && !dueDate.value) dueDate.value = today.value;
  repeatOn.value = on;
  if (!on) repeatRule.value = null;
}

const { isSubmitting } = useFormModal(
  () => null,
  () => props.open,
  { onEdit: () => {}, onNew: reset }
);

const v = useFormValidation('todo', () => ({ title: () => title.value.trim().length > 0 }), {
  open: () => props.open,
});

function reset(): void {
  generation++;
  // A save from the previous open may still be in flight; it must not lock this one's Save.
  isSubmitting.value = false;
  title.value = '';
  description.value = '';
  assigneeIds.value = [];
  dueDate.value = '';
  dueTime.value = '';
  repeatOn.value = false;
  repeatRule.value = null;
  // Desktop only: on a phone the keyboard would cover the drawer as it slides in.
  if (isDesktop.value) void focusTitle();
}

async function focusTitle(): Promise<void> {
  await nextTick();
  (titleField.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus();
}

function onAssigneesChange(value: string | string[]): void {
  assigneeIds.value = Array.isArray(value) ? value : [value];
}

async function handleSave(): Promise<void> {
  if (isSubmitting.value) return;
  const session = generation;
  isSubmitting.value = true;
  try {
    const created = await createTodoFrom(
      {
        title: title.value,
        description: description.value,
        dueDate: dueDate.value,
        dueTime: dueTime.value,
        assigneeIds: assigneeIds.value,
        ...(repeatOn.value && repeatRule.value ? { repeat: repeatRule.value } : {}),
      },
      'TodoFormModal',
      'sidebar'
    );
    // null: already toasted. Stay open with the draft so it can be retried.
    // A newer open: the to-do exists, and this drawer now holds someone else's draft.
    if (!created || session !== generation) return;
    emit('created', created.id);
  } finally {
    if (session === generation) isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    size="narrow"
    :open="open"
    :title="t('todo.newTask')"
    icon="✅"
    icon-bg="var(--tint-purple-12)"
    :save-label="t('todo.addTodo')"
    save-gradient="purple"
    :save-ready="v.canSave.value"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="v.attemptSave(handleSave)"
  >
    <MagicBeansQuickCard hint="todo" :subtitle="t('todo.magicHint')" />

    <FormFieldGroup :label="t('todo.field.title')" v-bind="v.bind('title')">
      <BaseInput ref="titleField" v-model="title" :placeholder="t('todo.quickAddPlaceholder')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('todo.description')" optional>
      <BaseTextarea v-model="description" :rows="3" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('todo.who')" optional>
      <FamilyChipPicker
        :model-value="assigneeIds"
        mode="multi"
        @update:model-value="onAssigneesChange"
      />
    </FormFieldGroup>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormFieldGroup :label="t('todo.dueDate')" optional>
        <BeanieDatePicker v-model="dueDate" />
      </FormFieldGroup>
      <!-- A time only means something with a date; `toCreateTodoInput` also drops an orphan. -->
      <FormFieldGroup v-if="dueDate" :label="t('todo.dueTime')" optional>
        <TimePresetPicker v-model="dueTime" clearable />
      </FormFieldGroup>
    </div>

    <FormFieldGroup :label="t('todo.repeat.label')" optional>
      <div
        class="dark:border-line dark:bg-surface-overlay flex items-center gap-3 rounded-[14px] border border-[var(--tint-slate-10)] bg-white px-3 py-2.5"
      >
        <RepeatGlyph />
        <ToggleRow
          class="min-w-0 flex-1"
          :model-value="repeatOn"
          :title="repeatTitle"
          :hint="repeatHint"
          testid="todo-repeat-toggle"
          @update:model-value="onRepeatToggle"
        />
      </div>
    </FormFieldGroup>
    <ConditionalSection :show="repeatOn">
      <RecurrencePicker
        v-if="repeatOn"
        v-model="repeatRule"
        accent="purple"
        default-cadence="weekly"
        :start-date="dueDate"
        :time="dueTime || undefined"
      />
    </ConditionalSection>
  </BeanieFormModal>
</template>
