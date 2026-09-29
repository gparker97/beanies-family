<script setup lang="ts">
/**
 * Magic beans to-do review (#113, mockup layout A): the drawer a to-do read opens into.
 *
 * Two shapes from one component:
 *   - SHARED: the read found an activity AND to-dos. The activity is a read-only summary (it
 *     is edited in the activity form, which the page opens straight after); the to-dos are
 *     edited here. Saving writes the to-dos, then the page carries on to the activity.
 *   - TO-DO ONLY: just the to-do rows.
 *
 * The rules (who does it, when it is due, where the links go) are the pure
 * `buildTodoDrafts`; this view only edits the drafts it returns and saves them in ONE write
 * through `todoStore.createTodos`, under the ids minted with the drafts, so a retried save can
 * never duplicate. A failed save leaves the drawer open with the drafts (the store toasted).
 *
 * A draft-build failure toasts once and emits `buildFailed`: in the shared flow the page falls
 * through to the activity form, so a to-do bug never costs the user the activity.
 *
 * Rows that repeat a to-do the family already has (`markDuplicateDrafts`) start skipped with a
 * note and an "Add anyway". A failed duplicate check is reported and leaves the rows unflagged.
 */
import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import AssigneePickerButton from '@/components/ui/AssigneePickerButton.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import LinkList from '@/components/ui/LinkList.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import MagicMiscategorisedBanner from '@/components/ai/MagicMiscategorisedBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useTodoCreate } from '@/composables/useTodoCreate';
import { useCardDefaultHint } from '@/composables/useCardDefaultHint';
import { useFamilyStore } from '@/stores/familyStore';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useTodoStore } from '@/stores/todoStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { toCreateTodoInput } from '@/utils/todo';
import { reportError } from '@/utils/errorReporter';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate, formatTime12, toDateInputValue, toTimeInputValue } from '@/utils/date';
import {
  buildTodoDrafts,
  markDuplicateDrafts,
  type TodoDraft,
  type TodoReviewReady,
} from '@/utils/magicTodoDrafts';

const props = defineProps<{
  open: boolean;
  ready: TodoReviewReady | null;
}>();

const emit = defineEmits<{
  close: [];
  /** The to-dos were saved (ids in draft order); empty when every row was skipped (shared). */
  saved: [ids: string[]];
  /** The drafts could not be built (already toasted). The host carries on without them. */
  buildFailed: [];
}>();

const SURFACE = 'magic-todo-review';

const { t } = useTranslation();
const familyStore = useFamilyStore();
const responsibilityStore = useResponsibilityStore();
const todoStore = useTodoStore();
const { resolveTodoAuthor } = useTodoCreate();
const { holdsHint } = useCardDefaultHint();

const drafts = ref<TodoDraft[]>([]);
/** Each draft as it was built, so a reason or a derived-date label shows only while unchanged. */
const baseline = new Map<string, { assigneeId?: string; dueDate?: string; title: string }>();
const isSubmitting = ref(false);

const isShared = computed(() => !!props.ready?.eventSummary);
const stage = computed(() => (isShared.value ? 'shared' : 'todo_only'));

watch(
  () => props.ready,
  (ready) => {
    drafts.value = [];
    baseline.clear();
    if (!ready) return;
    try {
      // One clock read for both, so the date and the time can never straddle midnight.
      const now = new Date();
      const built = buildTodoDrafts(ready.result, {
        eventDate: ready.eventSummary?.date,
        roster: familyStore.sortedHumans,
        holderFor: (cardId) =>
          responsibilityStore.defaultHolderFor({ kind: 'card', cardId })?.memberId,
        // The `useAuthoringMember` rule, without its toast: nobody to credit is not an error
        // here, the to-do is simply left unassigned.
        submitterId: familyStore.currentMember?.id ?? familyStore.owner?.id ?? null,
        today: toDateInputValue(now),
        nowTime: toTimeInputValue(now),
      });
      const flagged = flagDuplicates(built, ready);
      for (const d of flagged) {
        baseline.set(d.id, { assigneeId: d.assigneeIds[0], dueDate: d.dueDate, title: d.title });
      }
      drafts.value = flagged;
      logOpened(ready, flagged);
    } catch (err) {
      showToast(
        'error',
        t(ready.eventSummary ? 'magicTodos.error.build' : 'magicTodos.error.buildTodoOnly'),
        undefined,
        {
          surface: SURFACE,
          context: { stage: 'build_drafts', kind: ready.primaryKind },
          error: err,
        }
      );
      emit('buildFailed');
    }
  },
  { immediate: true }
);

/**
 * Mark the rows the family already has. A throw here must never cost the drafts (or, in the
 * shared flow, the activity): it is reported and the rows are left unflagged, as before.
 */
function flagDuplicates(built: TodoDraft[], ready: TodoReviewReady): TodoDraft[] {
  try {
    return markDuplicateDrafts(built, todoStore.todos, {
      probableActivityId: ready.probableActivityId,
    });
  } catch (error) {
    reportError({
      surface: SURFACE,
      severity: 'warning',
      message: 'todo duplicate check failed; rows left unflagged',
      context: { stage: 'duplicate_check' },
      error,
    });
    return built;
  }
}

function logOpened(ready: TodoReviewReady, built: readonly TodoDraft[]): void {
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'opened',
    context: { action: 'opened', kind: ready.primaryKind, count: built.length, stage: stage.value },
  });
  const duplicates = built.filter((d) => d.duplicateOf).length;
  if (duplicates > 0) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'duplicates_flagged',
      context: { action: 'duplicates_flagged', count: duplicates, stage: stage.value },
    });
  }
  // A stated time `resolveTodoDue` did not keep (no date to sit on, or already past on a date
  // that is today), and the assignee rule mix: once per reason per review, so each mix is
  // measurable without one event per row.
  const dropped = countBy(built, (d) => d.timeDropped);
  for (const [detail, count] of dropped) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'due_time_dropped',
      context: { action: 'due_time_dropped', detail, count, stage: stage.value },
    });
  }
  for (const [detail, count] of countBy(built, (d) => d.reason ?? 'none')) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'assignee_resolved',
      context: { action: 'assignee_resolved', detail, count, stage: stage.value },
    });
  }
}

/** How many drafts fall under each key; drafts with no key are not counted. */
function countBy(
  list: readonly TodoDraft[],
  keyOf: (d: TodoDraft) => string | undefined
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of list) {
    const key = keyOf(d);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const kept = computed(() => drafts.value.filter((d) => !d.skipped));

const saveLabel = computed(() => {
  const count = kept.value.length;
  if (isShared.value) {
    if (count === 0) return t('magicTodos.save.activityOnly');
    if (count === 1) return t('magicTodos.save.shared.one');
    return fillTemplate(t('magicTodos.save.shared.other'), { count });
  }
  if (count === 1) return t('magicTodos.save.todoOnly.one');
  return fillTemplate(t('magicTodos.save.todoOnly.other'), { count });
});

/** To-do only with every row skipped: there is genuinely nothing to save. */
const saveDisabled = computed(() => !isShared.value && kept.value.length === 0);

// ── Row helpers ─────────────────────────────────────────────────────────────

function assigneeOf(d: TodoDraft): string {
  return d.assigneeIds[0] ?? '';
}

function setAssignee(d: TodoDraft, value: string | string[]): void {
  const id = Array.isArray(value) ? value[0] : value;
  d.assigneeIds = id ? [id] : [];
}

/** Why beanies picked this person, only while the pick is unchanged. */
function reasonText(d: TodoDraft): string {
  const current = d.assigneeIds[0];
  if (!current || current !== baseline.get(d.id)?.assigneeId) return '';
  switch (d.reason) {
    case 'owner':
      return d.ownerCardId ? holdsHint({ kind: 'card', cardId: d.ownerCardId }, current) : '';
    case 'named':
      return t('magicTodos.reason.named');
    case 'submitter':
      return t('magicTodos.reason.submitter');
    default:
      return '';
  }
}

/** A new date keeps the time; clearing the date clears it (the `TodoViewEditModal` rule). */
function setDueDate(d: TodoDraft, value: string): void {
  d.dueDate = value || undefined;
  if (!d.dueDate) d.dueTime = undefined;
}

/** Why a skipped row was skipped for the user: it is already on the list (or done). */
function skipNote(d: TodoDraft): string {
  if (!d.duplicateOf) return '';
  return t(d.duplicateOf.done ? 'magicTodos.duplicate.done' : 'magicTodos.duplicate.open');
}

/** A duplicate row comes back with "Add anyway"; a row the user skipped with "Undo skip". */
function undoLabel(d: TodoDraft): string {
  return t(d.duplicateOf ? 'magicTodos.duplicate.addAnyway' : 'magicTodos.undoSkip');
}

/** "activity day" / "day before", only while the derived date is unchanged. */
function dueSuffix(d: TodoDraft): string {
  if (!d.dueDerived || d.dueDate !== baseline.get(d.id)?.dueDate) return '';
  return t(d.dueDerived === 'event_day' ? 'magicTodos.due.eventDay' : 'magicTodos.due.dayBefore');
}

/** Where the read came from, so the subtitle names its source. */
const sourceLine = computed(() => {
  const env = props.ready?.env;
  if (!env) return '';
  if (env.link) return t('magicTodos.source.link');
  const type = env.sourceFile?.type ?? '';
  if (type.startsWith('image/')) return t('magicTodos.source.photo');
  if (type) return t('magicTodos.source.document');
  return t('magicTodos.source.text');
});

/** A cleared title goes back to what was read, rather than saving an empty to-do. */
function restoreEmptyTitle(d: TodoDraft): void {
  d.title = cleanTitle(d.title) || (baseline.get(d.id)?.title ?? '');
}

/**
 * A title is one line. The textarea (it only exists so a long title wraps) blocks a typed
 * Enter, but pasted or dictated text can still carry line breaks: fold them into spaces.
 */
function cleanTitle(title: string): string {
  return title.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** Enter never adds a line, except while an IME is composing (Enter commits the text there). */
function onTitleEnter(e: KeyboardEvent): void {
  if (!e.isComposing) e.preventDefault();
}

// ── Activity summary (shared only) ──────────────────────────────────────────

const summaryWhen = computed(() => {
  const s = props.ready?.eventSummary;
  if (!s?.date) return '';
  const date = formatNookDate(s.date);
  if (!s.startTime) return date;
  const time = s.endTime
    ? `${formatTime12(s.startTime)} – ${formatTime12(s.endTime)}`
    : formatTime12(s.startTime);
  return `${date}, ${time}`;
});

// ── Save / close ────────────────────────────────────────────────────────────

async function onSave(): Promise<void> {
  if (!props.ready || isSubmitting.value) return;
  const rows = kept.value;
  if (rows.length === 0) {
    if (!isShared.value) return;
    // Every to-do skipped: nothing to write, carry on to the activity.
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'confirmed',
      context: { action: 'confirmed', count: 0, stage: stage.value },
    });
    emit('saved', []);
    return;
  }

  const author = resolveTodoAuthor('MagicTodoReviewDrawer', {
    titleKey: 'magicTodos.error.noAuthor',
    helpKey: 'magicTodos.error.noAuthorHelp',
  });
  if (!author) return;

  // The capture this save belongs to. The drawer is one instance reused for every capture, so a
  // newer capture can replace `ready` while the write is in flight (the share sheet reaches the
  // page behind the drawer). Checked after the await: a save for a superseded capture must never
  // reach the host as that NEWER capture's save (it would link these to-dos to its activity).
  const savingFor = props.ready;
  isSubmitting.value = true;
  try {
    const created = await todoStore.createTodos(
      rows.map((d) => ({
        id: d.id,
        ...toCreateTodoInput(
          { ...d, title: cleanTitle(d.title) || baseline.get(d.id)?.title || d.title },
          author
        ),
      }))
    );
    // null: the store has already toasted and reported. Stay open with the drafts to retry.
    if (!created) return;
    if (props.ready !== savingFor) {
      // Superseded mid-save: the to-dos exist, unlinked, and the newer capture is untouched.
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'link_skipped',
        context: { action: 'link_skipped', count: rows.length, stage: 'superseded' },
      });
      return;
    }
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'confirmed',
      context: { action: 'confirmed', count: rows.length, stage: stage.value },
    });
    const addedAnyway = rows.filter((d) => d.duplicateOf).length;
    if (addedAnyway > 0) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'duplicate_added_anyway',
        context: { action: 'duplicate_added_anyway', count: addedAnyway, stage: stage.value },
      });
    }
    emit(
      'saved',
      rows.map((d) => d.id)
    );
  } catch (err) {
    // `createTodos` reports its own failures; this is only for a throw around it.
    showToast('error', t('magicTodos.error.save'), undefined, {
      surface: SURFACE,
      context: { stage: 'save', count: rows.length },
      error: err,
    });
  } finally {
    isSubmitting.value = false;
  }
}

function onClose(): void {
  logClosed('dismissed');
}

/** "Not right?" closes the drawer to re-read: a correction, not an abandoned review. */
function onCorrect(): void {
  logClosed('corrected');
}

function logClosed(action: 'dismissed' | 'corrected'): void {
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: action,
    context: { action, stage: stage.value },
  });
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    variant="drawer"
    :title="t('magicTodos.title')"
    :icon="isShared ? '✨' : '✅'"
    :icon-bg="isShared ? undefined : 'var(--tint-purple-12)'"
    :save-label="saveLabel"
    :save-gradient="isShared ? 'orange' : 'purple'"
    :save-disabled="saveDisabled"
    :is-submitting="isSubmitting"
    @close="onClose"
    @save="onSave"
  >
    <template v-if="ready">
      <p class="dark:text-ink-soft -mt-1 text-xs text-[var(--color-text-muted)]">
        {{ sourceLine }}
        {{ t(isShared ? 'magicTodos.subtitle.shared' : 'magicTodos.subtitle.todoOnly') }}
      </p>

      <!-- The activity (shared only): read-only, edited in the activity form next. -->
      <section v-if="ready.eventSummary" data-testid="magic-todo-activity">
        <h3 class="review-label">{{ t('magicTodos.section.activity') }}</h3>
        <div
          class="dark:bg-surface-overlay dark:border-line rounded-[20px] border border-[var(--tint-slate-10)] bg-white p-3.5 shadow-sm"
        >
          <div class="flex items-start gap-3">
            <div
              class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-[var(--tint-orange-15)] text-lg"
              aria-hidden="true"
            >
              {{ ready.eventSummary.icon || '📅' }}
            </div>
            <div class="min-w-0 flex-1">
              <p
                class="font-outfit dark:text-ink text-base leading-snug font-semibold text-[var(--color-text)]"
              >
                {{ ready.eventSummary.title }}
              </p>
              <p
                v-if="summaryWhen"
                class="dark:text-ink-soft mt-0.5 text-sm text-[var(--color-text-muted)]"
              >
                {{ summaryWhen }}
              </p>
              <p
                v-if="ready.eventSummary.location"
                class="dark:text-ink-soft text-sm text-[var(--color-text-muted)]"
              >
                {{ ready.eventSummary.location }}
              </p>
            </div>
            <span
              class="font-outfit text-primary-600 dark:text-accent-lift flex-shrink-0 rounded-full bg-[var(--tint-orange-15)] px-2.5 py-0.5 text-xs font-semibold"
            >
              {{ t('magicTodos.next') }}
            </span>
          </div>
          <LinkList
            v-if="ready.eventSummary.link"
            :urls="[ready.eventSummary.link]"
            :favicons="false"
            class="mt-2.5"
          />
          <p
            class="dark:border-line dark:text-ink-faint mt-2.5 border-t border-dashed border-[var(--tint-slate-10)] pt-2.5 text-xs text-[var(--color-text-muted)]"
          >
            {{ t('magicTodos.activityHelper') }}
          </p>
        </div>
      </section>

      <!-- The to-dos: edited here. -->
      <section>
        <h3 class="review-label flex items-baseline justify-between gap-2">
          <span>{{ t('magicTodos.section.todos') }}</span>
          <span v-if="isShared" class="review-aside">{{ t('magicTodos.linkedToActivity') }}</span>
        </h3>
        <ul class="flex flex-col gap-2.5" :class="{ 'review-rail': isShared }">
          <li
            v-for="d in drafts"
            :key="d.id"
            class="review-row relative rounded-[18px] border"
            :class="
              d.skipped
                ? 'dark:border-line is-skipped border-dashed border-[var(--tint-slate-10)] px-3.5 py-2'
                : 'dark:bg-surface-overlay dark:border-line border-[var(--tint-slate-10)] bg-white p-3 shadow-sm'
            "
            data-testid="magic-todo-row"
          >
            <!-- Skipped: a struck-through title, why (when beanies skipped it), and the way back. -->
            <template v-if="d.skipped">
              <div class="flex items-center gap-2">
                <p
                  class="dark:text-ink-faint min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text-muted)] line-through"
                >
                  {{ d.title }}
                </p>
                <button
                  type="button"
                  class="font-outfit text-primary-600 dark:text-accent-lift flex-shrink-0 text-xs font-semibold underline underline-offset-2"
                  data-testid="magic-todo-undo"
                  @click="d.skipped = false"
                >
                  {{ undoLabel(d) }}
                </button>
              </div>
              <p
                v-if="skipNote(d)"
                class="dark:text-ink-soft mt-0.5 text-xs text-[var(--color-text-muted)]"
                data-testid="magic-todo-duplicate-note"
              >
                {{ skipNote(d) }}
              </p>
            </template>

            <template v-else>
              <div class="flex items-start gap-2">
                <!-- The grid mirror grows the textarea to its content, so a long title wraps
                     instead of being cut off at phone width. -->
                <div
                  class="title-grow font-outfit min-w-0 flex-1 text-sm font-semibold"
                  :data-value="`${d.title} `"
                >
                  <textarea
                    v-model="d.title"
                    rows="1"
                    :aria-label="t('magicTodos.titlePlaceholder')"
                    :placeholder="t('magicTodos.titlePlaceholder')"
                    class="dark:text-ink dark:border-line-strong resize-none overflow-hidden rounded-md border-b border-dotted border-[rgb(44_62_80/22%)] bg-transparent text-[var(--color-text)] focus:border-transparent focus:ring-2 focus:ring-purple-400 focus:outline-none"
                    data-testid="magic-todo-title"
                    @keydown.enter="onTitleEnter"
                    @blur="restoreEmptyTitle(d)"
                  />
                </div>
                <button
                  type="button"
                  class="font-outfit dark:bg-surface-hover dark:text-ink-soft flex flex-shrink-0 items-center gap-1 rounded-[10px] bg-[var(--tint-slate-5)] px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)]"
                  data-testid="magic-todo-skip"
                  @click="d.skipped = true"
                >
                  <span aria-hidden="true">✕</span>
                  {{ t('magicTodos.skip') }}
                </button>
              </div>

              <div class="mt-2.5 flex flex-wrap items-center gap-2">
                <AssigneePickerButton
                  :model-value="assigneeOf(d)"
                  mode="single"
                  size="sm"
                  align="left"
                  @update:model-value="setAssignee(d, $event)"
                />
                <div class="flex items-center gap-1.5">
                  <BeanieDatePicker
                    :model-value="d.dueDate ?? ''"
                    @update:model-value="setDueDate(d, $event)"
                  />
                  <span
                    v-if="dueSuffix(d)"
                    class="dark:text-ink-faint text-xs whitespace-nowrap text-[var(--color-text-muted)]"
                    data-testid="magic-todo-due-suffix"
                  >
                    {{ dueSuffix(d) }}
                  </span>
                </div>
                <TimePresetPicker
                  v-if="d.dueDate"
                  :model-value="d.dueTime ?? ''"
                  clearable
                  data-testid="magic-todo-time"
                  @update:model-value="d.dueTime = $event || undefined"
                />
              </div>
              <InferredHint :text="reasonText(d)" />
              <LinkList v-if="d.links.length" :urls="d.links" :favicons="false" class="mt-2" />
            </template>
          </li>
        </ul>
      </section>

      <!-- "not right?" at the foot, where someone ends up after scanning the result. -->
      <MagicMiscategorisedBanner :env="ready.env" :from="ready.primaryKind" @close="onCorrect" />
    </template>
  </BeanieFormModal>
</template>

<style scoped>
.review-label {
  color: var(--color-text-muted);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}

/* Auto-growing title: the hidden ::after mirror and the textarea share one grid cell, so the
   cell (and the textarea) is as tall as the wrapped text. */
.title-grow {
  display: grid;
}

.title-grow::after {
  content: attr(data-value);
  visibility: hidden;
  white-space: pre-wrap;
}

.title-grow > textarea,
.title-grow::after {
  border-bottom-width: 1px;
  font: inherit;
  grid-area: 1 / 1 / 2 / 2;
  overflow-wrap: anywhere;
  padding: 0.125rem 0.25rem;
}

.review-aside {
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}

/* The purple rail: every to-do hangs off the activity above it (shared only). */
.review-rail {
  padding-left: 1.125rem;
  position: relative;
}

.review-rail::before {
  background: var(--tint-purple-12);
  border-radius: 2px;
  bottom: 1.375rem;
  content: '';
  left: 0.375rem;
  position: absolute;
  top: -0.5rem;
  width: 2px;
}

.review-rail .review-row::before {
  background: #fff;
  border: 2px solid #9b59b6;
  border-radius: 50%;
  content: '';
  height: 0.625rem;
  left: -1rem;
  position: absolute;
  top: 1.25rem;
  width: 0.625rem;
}

.review-rail .review-row.is-skipped::before {
  border-color: rgb(44 62 80 / 22%);
}

html.dark .review-label {
  color: var(--color-ink-faint);
}

html.dark .review-rail .review-row::before {
  background: #1e2a36;
  border-color: #cb95dd;
}

html.dark .review-rail .review-row.is-skipped::before {
  border-color: #7a8a97;
}
</style>
