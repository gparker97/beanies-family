<script setup lang="ts">
/**
 * The one-line "add a to-do" composer: title, then when, then who. Used by the To-Dos page and
 * an activity's To-dos section (#114).
 *
 * It creates the to-do itself (through `useTodoDraft`: double-Enter guard, the draft kept on a
 * failed create, reset to `defaults()` on success) and emits `created` with the new to-do, so a
 * host only decides what to show next.
 *
 * It lays itself out by its OWN width (a container query, `@lg` = 32rem), not the viewport's:
 * one row on the To-Dos page, title then pickers on a second row in a narrow drawer.
 *
 * `variant`: `composer` (the To-Dos page's filled slate bar) or `inline` (the activity drawer's
 * dashed row that turns solid with an orange ring when focused; its pickers and hint appear once
 * the row is engaged, so the resting state stays one slim line).
 */
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoDraft, type TodoDraftDefaults } from '@/composables/useTodoDraft';
import type { TodoCreateSource } from '@/composables/useTodoCreate';
import type { ActivityLink } from '@/utils/activityLinks';
import type { TodoItem } from '@/types/models';
import AssigneePickerButton from '@/components/ui/AssigneePickerButton.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';

const props = withDefaults(
  defineProps<{
    source: TodoCreateSource;
    /** Who is creating, for the no-author diagnostics. */
    callerTag: string;
    /**
     * The due date and assignees a fresh draft starts with. A function, read at setup and after
     * each add, so a date derived from "today" is never stale.
     */
    defaults?: () => TodoDraftDefaults;
    /** The activity (and session) new to-dos link to. Read at submit. */
    link?: ActivityLink | null;
    /** Already-translated placeholder; the generic quick-add one by default. */
    placeholder?: string;
    /** Already-translated line under the row (e.g. which session it links to). */
    hint?: string;
    variant?: 'composer' | 'inline';
  }>(),
  {
    defaults: undefined,
    link: null,
    placeholder: undefined,
    hint: undefined,
    variant: 'composer',
  }
);

const emit = defineEmits<{
  created: [todo: TodoItem];
}>();

const { t } = useTranslation();

const { title, dueDate, assigneeIds, add } = useTodoDraft({
  source: props.source,
  callerTag: props.callerTag,
  defaults: props.defaults,
  link: () => props.link,
});

const titleInput = ref<HTMLInputElement>();
/** The inline row has been focused once: its pickers stay out from then on. */
const engaged = ref(false);

const isInline = computed(() => props.variant === 'inline');
const showPickers = computed(() => !isInline.value || engaged.value || !!title.value.trim());

function focus() {
  titleInput.value?.focus();
}

defineExpose({ focus });

async function handleAdd() {
  const created = await add();
  if (created) emit('created', created);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void handleAdd();
  }
}
</script>

<template>
  <div class="@container" @focusin="engaged = true">
    <div class="space-y-2">
      <!-- Row 1: title (+ date and assignee when the bar is wide). In the composer all three
           share the same 52px height, squircle corner and slate-5 fill so the row reads as one
           connected composer: what needs doing, when, who. -->
      <div class="flex items-stretch gap-2">
        <div
          v-if="isInline"
          class="focus-within:border-primary-500 dark:focus-within:bg-surface-overlay flex min-h-11 flex-1 items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[var(--color-border-strong)] py-1.5 ps-3.5 pe-1.5 transition-colors focus-within:border-solid focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.12)]"
        >
          <span
            class="font-outfit text-primary-600 dark:text-accent-lift text-base font-bold"
            aria-hidden="true"
            >+</span
          >
          <input
            ref="titleInput"
            v-model="title"
            type="text"
            :placeholder="placeholder ?? t('todo.quickAddPlaceholder')"
            :aria-label="placeholder ?? t('todo.quickAddPlaceholder')"
            class="dark:text-ink dark:placeholder:text-ink-faint min-w-0 flex-1 bg-transparent py-1.5 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
            @keydown="handleKeydown"
          />
          <button
            v-if="title.trim()"
            type="button"
            class="font-outfit bg-primary-500 hover:bg-primary-600 shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold text-white transition-colors"
            @click="handleAdd"
          >
            {{ t('action.add') }}
          </button>
        </div>
        <div
          v-else
          class="flex h-[3.25rem] flex-1 items-center gap-2.5 rounded-2xl px-4"
          style="background: var(--tint-slate-5)"
        >
          <span class="text-lg opacity-40" aria-hidden="true">✏️</span>
          <input
            ref="titleInput"
            v-model="title"
            type="text"
            :placeholder="placeholder ?? t('todo.quickAddPlaceholder')"
            :aria-label="placeholder ?? t('todo.quickAddPlaceholder')"
            class="font-outfit dark:text-ink dark:placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-base font-medium text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]"
            @keydown="handleKeydown"
          />
          <button
            v-if="title.trim()"
            type="button"
            class="font-outfit shrink-0 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90"
            style="background: linear-gradient(135deg, #9b59b6, #8e44ad)"
            @click="handleAdd"
          >
            {{ t('action.add') }}
          </button>
        </div>

        <!-- Date picker (wide bar) -->
        <div v-if="showPickers" class="hidden shrink-0 @lg:block">
          <BeanieDatePicker
            v-model="dueDate"
            variant="composer"
            :placeholder="t('todo.selectDueDate')"
          />
        </div>

        <!-- Assignee (wide bar) -->
        <div v-if="showPickers" class="hidden @lg:flex">
          <AssigneePickerButton v-model="assigneeIds" variant="composer" />
        </div>
      </div>

      <!-- Row 2: date + assignee on one line (narrow bar only) -->
      <div v-if="showPickers" class="grid grid-cols-2 gap-2 @lg:hidden">
        <BeanieDatePicker v-model="dueDate" :placeholder="t('todo.selectDueDate')" />
        <div class="flex items-center gap-1.5">
          <span
            class="font-outfit dark:text-ink-faint text-xs font-semibold text-[var(--color-text-muted)]"
          >
            {{ t('todo.who') }}
          </span>
          <AssigneePickerButton v-model="assigneeIds" size="sm" class="flex-1" />
        </div>
      </div>

      <p
        v-if="hint && showPickers"
        class="dark:text-ink-faint px-0.5 text-xs text-[var(--color-text-muted)]"
        data-testid="quick-add-hint"
      >
        {{ hint }}
      </p>
    </div>
  </div>
</template>
