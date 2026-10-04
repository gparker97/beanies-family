<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useRoute } from 'vue-router';
import { parseIntentFromQuery, useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { usePermissions } from '@/composables/usePermissions';
import { useSounds } from '@/composables/useSounds';
import { TODO_CREATE_SURFACE } from '@/composables/useTodoCreate';
import { useAttentionPulse } from '@/composables/useAttentionPulse';
import { matchesAssigneeFilter } from '@/utils/assignees';
import { waitForElement } from '@/utils/waitForElement';
import { logEvent } from '@/services/telemetry/logEvent';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import TodoFormModal from '@/components/todo/TodoFormModal.vue';
import MagicBeansDoor from '@/components/ai/MagicBeansDoor.vue';
import MagicReaderPill from '@/components/ai/MagicReaderPill.vue';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import MagicTodoReviewDrawer from '@/components/ai/MagicTodoReviewDrawer.vue';
import { useMagicReader, useMagicReaderConsumer } from '@/composables/useMagicReader';
import type { TodoReviewReady } from '@/utils/magicTodoDrafts';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import TodoSection from '@/components/todo/TodoSection.vue';
import SortMenu from '@/components/ui/SortMenu.vue';
import TodoMemberFilter from '@/components/todo/TodoMemberFilter.vue';
import type { TodoItem } from '@/types/models';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useTodoSort, SORT_OPTIONS } from '@/composables/useTodoSort';
import { useDeepLinkParam } from '@/composables/useDeepLinkParam';
import { sortTodos } from '@/utils/todo';

const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const { playWhoosh } = useSounds();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

/**
 * Arrived from the quick-add sheet's To-do tile: `useQuickAddIntent` opens the sidebar, but only
 * after an awaited `router.replace`, so the sidebar is not open yet when this page mounts. The
 * query is the real signal, read before that replace strips it.
 */
const arrivedToAddTodo = parseIntentFromQuery(useRoute().query)?.action === 'add-todo';

/** The page root, which scopes the just-created reveal to this page (and says it is still here). */
const pageRoot = ref<HTMLElement | null>(null);

// The "Add To-do" sidebar (header button + the quick-add sheet's To-do tile). Always mounted, so
// `useFormModal` sees the open transition.
const showCreate = ref(false);

// A to-do-only magic beans read (#113) arrives here and opens the review drawer. Closing, or a
// draft that cannot be built (already toasted), simply closes it; saving closes it and shows
// the topmost new to-do. The handler stays synchronous (the consumer drops a returned promise), so
// the async part is named.
const { canReadTodo } = useMagicReader();
const todoReview = ref<TodoReviewReady | null>(null);
useMagicReaderConsumer(
  'todo',
  (payload) => {
    if (payload)
      void openTodoReview({ result: payload.data, env: payload.env, primaryKind: 'todo' });
  },
  canReadTodo
);

/**
 * Never a drawer over a drawer: a result from the sidebar's own quick card (or the header ✨
 * while it is open) closes the sidebar first. Its typed draft is dropped, as on the planner.
 */
async function openTodoReview(ready: TodoReviewReady): Promise<void> {
  if (showCreate.value) {
    showCreate.value = false;
    await nextTick();
  }
  todoReview.value = ready;
}

const currentMemberId = computed(() => authStore.currentUser?.memberId ?? '');

const REVEAL_WAIT_MS = 800;
/**
 * Bumped by every reveal. Two creates in quick succession (a second quick add while the first
 * row is still rendering) each wait for their row; only the latest may scroll and pulse, so an
 * older one that finishes its wait late returns quietly instead of yanking the view back.
 */
let revealGeneration = 0;

// Local filter state — sort is a persisted, device-local preference (default
// 'dueDate'); member filter is page-local.
const { sortBy } = useTodoSort();
const memberFilter = ref('all');
const completedCollapsed = ref(true);

const { isDesktop } = useBreakpoint();

// Ref to QuickAddBar for auto-focus
const quickAddBar = ref<InstanceType<typeof QuickAddBar> | null>(null);

// View/edit modal — store ID, derive live object from store for reactivity
const selectedTodoId = ref<string | null>(null);
const selectedTodo = computed(() =>
  selectedTodoId.value ? (todoStore.todos.find((t) => t.id === selectedTodoId.value) ?? null) : null
);

// Todo member filter — humans only (pets can't be assignees).
const sortedMembers = computed(() => familyStore.sortedHumans);

// Apply the page-local member filter (by assignee) + the chosen sort. Shared
// by the Open and Someday sections — the Completed list has its own filter
// (it also matches `completedBy`).
function withMemberFilterAndSort(items: TodoItem[]): TodoItem[] {
  // `matchesAssigneeFilter`, not `.includes()`: an UNASSIGNED to-do is the family's work
  // and belongs to whoever you lens on, and `.includes()` on an empty array is false, so
  // the plain form hid every wall quick-add (which creates to-dos unassigned by design)
  // the moment you tapped a bean. Every other surface routes through this predicate.
  const filtered =
    memberFilter.value === 'all'
      ? items
      : items.filter((t) => matchesAssigneeFilter(t, (id) => id === memberFilter.value));
  return sortTodos(filtered, sortBy.value);
}

const displayedOpenTodos = computed(() => withMemberFilterAndSort(todoStore.filteredActiveTodos));
const displayedSomedayTodos = computed(() =>
  withMemberFilterAndSort(todoStore.filteredSomedayTodos)
);

// #40: Helpful Hints visible to the current member (audience-hidden hints — e.g.
// a birthday person's own present hint — are filtered out in the store), then the
// page's own member-lens + sort applied like the other lanes.
const displayedHintTodos = computed(() => {
  const me = familyStore.currentMember;
  if (!me) return [];
  const resolve = (id: string) => familyStore.members.find((m) => m.id === id);
  return withMemberFilterAndSort(todoStore.visibleHintTodos(me, resolve));
});

const displayedCompletedTodos = computed(() => {
  let items = todoStore.filteredCompletedTodos;

  // Apply page-local member filter
  if (memberFilter.value !== 'all') {
    items = items.filter(
      (t) =>
        matchesAssigneeFilter(t, (id) => id === memberFilter.value) ||
        t.completedBy === memberFilter.value
    );
  }

  return items;
});

// #40: count only what the viewer can actually SEE — audience-hidden hints (e.g.
// a birthday person's own present hint) must not suppress the empty state. Hints
// live in their own section, so the family's own lanes exclude them.
const hasAnyTodos = computed(
  () =>
    todoStore.manualActiveTodos.length > 0 ||
    todoStore.somedayTodos.length > 0 ||
    todoStore.completedTodos.length > 0 ||
    displayedHintTodos.value.length > 0
);

// Actions
// Every create below is already counted: `createTodoFrom` logs the single creates (the quick-add
// bar and the sidebar both go through it), the review drawer its own confirm events. The page
// only shows the new to-do.
function handleCreated(id: string) {
  showCreate.value = false;
  void revealTodo(id);
}

/**
 * The review drawer saved (ids in draft order): close it and show the new to-do nearest the top
 * of the Open list as drawn (sort + member filter), which is not necessarily the first drafted.
 * Falls back to the first id when none of them is drawn (filtered out); the reveal then misses
 * and says so.
 */
function handleMagicSaved(ids: string[]) {
  todoReview.value = null;
  const saved = new Set(ids);
  const topmost = displayedOpenTodos.value.find((t) => saved.has(t.id))?.id ?? ids[0];
  if (topmost) void revealTodo(topmost);
}

/** Show a just-created to-do: scroll to it and pulse it. Only the latest reveal does. */
async function revealTodo(id: string): Promise<void> {
  const gen = ++revealGeneration;
  const selector = `[data-todo-id="${CSS.escape(id)}"]`;
  const el = await waitForElement(
    () => pageRoot.value?.querySelector<HTMLElement>(selector),
    REVEAL_WAIT_MS
  );
  // A newer reveal took over while this one waited: it owns the scroll and the pulse.
  if (gen !== revealGeneration) return;
  if (el) {
    useAttentionPulse().reveal(el, 'attention-ring');
    return;
  }
  // The page was left while waiting: nothing to show, nothing went wrong.
  if (!pageRoot.value) return;
  // A new to-do is always open, so it is either hidden by a member filter (this page's lens or
  // the global one) or it did not render in time.
  logEvent({
    level: 'info',
    surface: TODO_CREATE_SURFACE,
    message: 'reveal_missed',
    context: {
      action: 'reveal_missed',
      detail: displayedOpenTodos.value.some((t) => t.id === id) ? 'not_rendered' : 'filtered',
    },
  });
}

async function handleToggle(id: string) {
  await todoStore.toggleComplete(id, currentMemberId.value);
}

async function handleSetSomeday(id: string, value: boolean) {
  await todoStore.setSomeday(id, value);
}

function openModal(todo: { id: string }) {
  selectedTodoId.value = todo.id;
}

// Open view modal from a deep link (?view=<id> — from Family Nook, global search,
// or an external link). Robust to cold-start: only clears the param once the todo
// is found, and retries when the store hydrates.
useDeepLinkParam({
  param: 'view',
  open: (id) => {
    const todo = todoStore.todos.find((t) => t.id === id);
    if (!todo) return false;
    openModal(todo);
    return true;
  },
  ready: () => todoStore.todos.length,
});
// Quick-add sheet's To-do tile → open the "Add To-do" sidebar (the tile itself already
// requires edit permission). Never a drawer over a drawer: a magic beans review still open wins.
useQuickAddIntent((action) => {
  if (action !== 'add-todo' || !canEditActivities.value) return;
  if (todoReview.value !== null) {
    logEvent({
      level: 'info',
      surface: TODO_CREATE_SURFACE,
      message: 'intent_ignored',
      context: { action: 'intent_ignored', detail: 'magic_review_open' },
    });
    return;
  }
  showCreate.value = true;
});

onMounted(async () => {
  // Auto-focus the quick add bar (skip on mobile/tablet to avoid keyboard popup), unless the
  // page was opened by the quick-add sheet's To-do tile: its sidebar opens a moment later and
  // takes the focus instead.
  if (isDesktop.value && canEditActivities.value && !arrivedToAddTodo) {
    await nextTick();
    quickAddBar.value?.focus();
  }
});

async function handleDelete(id: string) {
  if (
    await showConfirm({
      title: 'confirm.deleteTodoTitle',
      message: 'todo.deleteConfirm',
      variant: 'danger',
    })
  ) {
    // `discardTodo`: a kept hint deleted here must not be regenerated either.
    if (await todoStore.discardTodo(id)) playWhoosh();
  }
}

// #40: hints dismiss in ONE tap (no confirm — they're suggestions, not the
// family's own data), and "keep" promotes a hint to a permanent normal to-do.
async function handleHintDismiss(id: string) {
  if (await todoStore.discardTodo(id)) playWhoosh();
}

async function handleAcknowledge(id: string) {
  await todoStore.acknowledgeHint(id);
}
</script>

<template>
  <div ref="pageRoot" class="space-y-6">
    <!-- Page header: view controls (filter + sort, only with to-dos), then the page's ✨ magic
         beans and "+ Add To-do", the same pair as Activities (CalendarCommandBar).

         Two arrangements from one markup, split at `md` (the app's phone width, as
         `useBreakpoint`'s isMobile):
           · phone: the subtitle and ✨ + share the first row, the view controls take the row
             below. The page's actions sit at the top, as on Activities and Who Owns What.
           · md+: the two wrappers are `display: contents`, so the filter, sort, ✨ and + are
             flex items of ONE right-aligned group, beside the subtitle. -->
    <div class="flex flex-wrap items-start justify-between gap-3 md:items-center">
      <PageWelcomeSubtitle
        :text="t('todo.subtitle')"
        class="min-w-0 flex-1 md:min-w-auto md:flex-initial"
      />
      <div class="contents md:ml-auto md:flex md:flex-wrap md:items-center md:justify-end md:gap-2">
        <!-- `order-last w-full`: its own row under the subtitle and actions on a phone. -->
        <div
          v-if="hasAnyTodos"
          class="order-last flex w-full items-center justify-end gap-2 md:contents"
        >
          <!-- Member view-filter (desktop/tablet only): a lens, not an assignee control -->
          <TodoMemberFilter
            v-if="sortedMembers.length > 1"
            v-model="memberFilter"
            :members="sortedMembers"
            class="hidden min-w-0 sm:flex"
          />
          <SortMenu v-model="sortBy" :options="SORT_OPTIONS" trigger-label-key="todo.sortLabel" />
        </div>

        <div class="flex shrink-0 items-center gap-2 md:contents">
          <!-- The door owns the sheet, consent and its own `canReadAny` gate. -->
          <MagicBeansDoor hint="todo">
            <template #trigger="{ open }">
              <MagicReaderPill :label="t('ai.magic.perform')" @click="open" />
            </template>
          </MagicBeansDoor>

          <AddEntityButton
            v-if="canEditActivities"
            :label="t('todo.addTodo')"
            compact
            @click="showCreate = true"
          />
        </div>
      </div>
    </div>

    <!-- Quick add bar -->
    <QuickAddBar
      v-if="canEditActivities"
      ref="quickAddBar"
      source="quick_bar"
      caller-tag="FamilyTodoPage"
      @created="revealTodo($event.id)"
    />

    <!-- #40: Helpful Hints — gentle auto-suggested prep to-dos, shown above the
         family's own tasks. One-tap Keep (acknowledge) or Dismiss on each row. -->
    <TodoSection
      v-if="displayedHintTodos.length > 0"
      :label="t('todo.hint.section')"
      emoji="💡"
      label-class="text-[var(--color-primary-500)]"
      :todos="displayedHintTodos"
      @toggle="handleToggle"
      @view="openModal"
      @edit="openModal"
      @delete="handleHintDismiss"
      @acknowledge="handleAcknowledge"
    >
      <template #hint>{{ t('todo.hint.sectionHint') }}</template>
    </TodoSection>

    <!-- Empty state -->
    <div v-if="!hasAnyTodos" class="py-12 text-center">
      <EmptyStateIllustration variant="goals" class="mb-4" />
      <p class="text-lg font-medium text-[var(--color-text)]">{{ t('todo.noTodos') }}</p>
      <p class="mt-1 text-sm text-[var(--color-text-muted)]">{{ t('todo.getStarted') }}</p>
    </div>

    <!-- Sections (only show when there are todos) -->
    <template v-if="hasAnyTodos">
      <!-- Open to-dos -->
      <TodoSection
        :label="t('todo.section.open')"
        label-class="text-purple-500 dark:text-purple-lift"
        :todos="displayedOpenTodos"
        :empty-text="t('todo.noTodos')"
        @toggle="handleToggle"
        @view="openModal"
        @edit="openModal"
        @delete="handleDelete"
        @set-someday="handleSetSomeday"
      />

      <!-- Someday · Maybe — always visible (these aren't completed), hidden only when empty -->
      <TodoSection
        v-if="displayedSomedayTodos.length > 0"
        :label="t('todo.someday')"
        emoji="💭"
        label-class="text-sky-600 dark:text-sky-400"
        :todos="displayedSomedayTodos"
        @toggle="handleToggle"
        @view="openModal"
        @edit="openModal"
        @delete="handleDelete"
        @set-someday="handleSetSomeday"
      >
        <template #hint>{{ t('todo.somedayHint') }}</template>
      </TodoSection>

      <!-- Completed (collapsible) -->
      <TodoSection
        v-if="displayedCompletedTodos.length > 0"
        v-model:collapsed="completedCollapsed"
        :label="t('todo.section.completed')"
        label-class="text-green-600 dark:text-success-lift"
        :todos="displayedCompletedTodos"
        collapsible
        @toggle="handleToggle"
        @view="openModal"
        @edit="openModal"
        @delete="handleDelete"
      />
    </template>

    <TodoViewEditModal :todo="selectedTodo" @close="selectedTodoId = null" />

    <TodoFormModal :open="showCreate" @close="showCreate = false" @created="handleCreated" />

    <MagicTodoReviewDrawer
      :open="todoReview !== null"
      :ready="todoReview"
      @close="todoReview = null"
      @saved="handleMagicSaved"
      @build-failed="todoReview = null"
    />
  </div>
</template>
