<script setup lang="ts">
/**
 * An activity's To-dos section in Activity Details (#114): the to-dos linked to the session
 * being viewed, open first then done, and an add row that links the new to-do to it.
 *
 * Which to-dos belong here, and in what order, is `todoStore.todosForActivitySession` (the
 * shared link matcher in `utils/activityLinks.ts`); the link a new one gets is `linkForSession`.
 * On a repeating activity an item linked to the WHOLE activity shows on every session with the
 * "Every Session" tag.
 *
 * Rows never show the chip back to this activity (it is the one on screen), and the to-do opens
 * in its own stacked drawer with the linked-activity row hidden, so the host drawer holds no
 * to-do state. The host keys this component by activity + session, so moving to another one
 * starts a fresh draft and due default.
 */
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import type { TodoDraftDefaults } from '@/composables/useTodoDraft';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { linkForSession } from '@/utils/activityLinks';
import { defaultDueBeforeEvent, formatNookDate, localToday } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import SectionEyebrow from '@/components/ui/SectionEyebrow.vue';
import TodoItemRow from '@/components/todo/TodoItemRow.vue';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import type { FamilyActivity } from '@/types/models';

const props = defineProps<{
  activity: FamilyActivity;
  /** The session being viewed (`YYYY-MM-DD`): its real date, for the due default and hint. */
  sessionYmd: string;
}>();

const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();

const todos = computed(() => todoStore.todosForActivitySession(props.activity, props.sessionYmd));
const openCount = computed(() => todos.value.open.length);
// A viewer who cannot add sees the section only when something is linked (as ActivityLists).
const showSection = computed(
  () => canEditActivities.value || todos.value.open.length > 0 || todos.value.done.length > 0
);

const link = computed(() => linkForSession(props.activity, props.sessionYmd));
/** Linked to one session of a repeating activity, not the whole of it. */
const linksToSession = computed(() => !!link.value.activityDate);
const placeholder = computed(() =>
  t(linksToSession.value ? 'activityTodos.addSessionPlaceholder' : 'activityTodos.addPlaceholder')
);
const hint = computed(() =>
  linksToSession.value
    ? fillTemplate(t('activityTodos.linksToSession'), { date: formatNookDate(props.sessionYmd) })
    : undefined
);

/** Given to whoever adds it, due the day before the session (never in the past). */
function draftDefaults(): TodoDraftDefaults {
  const me = familyStore.currentMember?.id;
  return {
    assigneeIds: me ? [me] : [],
    dueDate: defaultDueBeforeEvent(props.sessionYmd, localToday()),
  };
}

function toggle(id: string): void {
  void todoStore.toggleComplete(id, familyStore.currentMember?.id || '');
}

// ── The to-do drawer, stacked over the activity's ────────────────────────────
const selectedTodoId = ref<string | null>(null);
const selectedTodo = computed(() =>
  selectedTodoId.value
    ? (todoStore.todos.find((td) => td.id === selectedTodoId.value) ?? null)
    : null
);
</script>

<template>
  <section v-if="showSection" data-testid="activity-todos">
    <SectionEyebrow icon="✅" :label="t('activityTodos.title')">
      <!-- A conditional slot, so the eyebrow draws no empty count span when nothing is open. -->
      <template v-if="openCount" #default>
        {{ fillTemplate(t('activityTodos.openCount'), { count: openCount }) }}
      </template>
    </SectionEyebrow>

    <div v-if="todos.open.length || todos.done.length" class="mb-2 flex flex-col gap-2">
      <TodoItemRow
        v-for="entry in todos.open"
        :key="entry.item.id"
        :todo="entry.item"
        :activity-scope="entry.scope"
        compact
        @toggle="toggle"
        @view="selectedTodoId = $event.id"
      />
      <template v-if="todos.done.length">
        <p
          class="font-outfit dark:text-ink-faint mx-0.5 mt-1 text-xs font-semibold text-[var(--color-text-muted)]"
          data-testid="activity-todos-done"
        >
          {{ t('activityTodos.done') }}
        </p>
        <TodoItemRow
          v-for="entry in todos.done"
          :key="entry.item.id"
          :todo="entry.item"
          :activity-scope="entry.scope"
          compact
          @toggle="toggle"
          @view="selectedTodoId = $event.id"
        />
      </template>
    </div>

    <QuickAddBar
      v-if="canEditActivities"
      source="activity"
      caller-tag="ActivityTodos"
      variant="inline"
      :defaults="draftDefaults"
      :link="link"
      :placeholder="placeholder"
      :hint="hint"
    />

    <TodoViewEditModal
      stacked
      hide-activity-link
      :todo="selectedTodo"
      @close="selectedTodoId = null"
    />
  </section>
</template>
