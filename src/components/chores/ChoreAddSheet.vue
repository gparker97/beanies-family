<script setup lang="ts">
/**
 * Add Chores on the choreboard (#146, owner decisions 2026-11-13): the ONE way to add chores, one
 * or a whole set (every add on the page opens it, a bean's "+" with only that bean picked). ONE
 * list of chores to add,
 * then "Add 6 Chores Each for Pip and Juno". Each chosen bean gets their OWN copy of every named
 * row (one `addChores` batch); a bean who already has a chore by that name in that block is
 * skipped and the toast says so. Grown-ups only: the page opens it for adults.
 *
 *  - "Add a Set of Chores": a chip per suggestion set. Tapping one opens a read-only preview
 *    under the chips (one at a time; the chip again, its close control or Escape collapses it).
 *    "Add N to List" appends the set's chores under their headings, skipping any the list
 *    already has (same title, same block; dimmed in the preview and left out of N). For a set
 *    already on the list the action is "Remove from List", which takes back only its UNEDITED
 *    rows. Several sets can be on the list. `?starter=<key>` adds a set straight in.
 *  - The list: rows under time-of-day headings in the block colours, in block order; a heading
 *    shows when it has rows. Each block has an always-visible add row (four compact rows, so any
 *    block can be started without first choosing a time). A row has its picture (the shared
 *    `ChorePicturePicker`), an inline title, a time-of-day control that opens the four block
 *    tiles (moving the row to that heading) and the list item row's ✕. Days come from the
 *    suggestion (School Morning is school days, shown as a quiet tag) and are edited after
 *    adding; a grown-up's own row is every day.
 *  - A title is edited inline: Enter or blur commits; Enter on a new row opens another blank row
 *    in the same block (list entry); Escape cancels an edit, or drops a new row. A new row
 *    committed empty is dropped; an existing row emptied and committed gets its title back.
 *  - A picture is automatic: a row of the grown-up's own takes one from its title each time the
 *    title is committed (`suggestChoreEmoji`, else the default), until its picture tile is used
 *    by hand. A suggested row keeps its set's picture.
 *  - Enter that confirms an IME composition is typing, never a commit.
 *  - Every chooser (the set preview, a row's time tiles or picture) closes when the sheet closes
 *    or its row leaves the list, so no Escape token outlives what it was for.
 *  - The list is the session's (`useChoreAddDraft`): memory only, kept across close and reopen,
 *    cleared after a successful Add, by "Clear List" and on sign-out.
 *
 * Stays mounted while closed; the people re-seed on every open, the list does not.
 *
 * Dark mode: chips, preview and rows are `surface-overlay`, an open or added chip the orange
 * tint with an `accent-lift` edge; the title field is `surface-raised` with a `line-strong` edge
 * when focused; headings, time controls and block tiles paint `--chore-tint` / `--chore-ink`
 * (`.chore-block-*`, dark partners in `src/style.css`), the header the same as
 * `ChoreBlockSection`. Links and notes are `accent-lift` / `ink-faint` on dark.
 */
import { computed, nextTick, ref, watch } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import ListPeoplePicker from '@/components/lists/ListPeoplePicker.vue';
import ChorePicturePicker from '@/components/chores/ChorePicturePicker.vue';
import { showChoreBatchToast } from '@/composables/choreBatchToast';
import { useTranslation } from '@/composables/useTranslation';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { isAdultMember } from '@/composables/useMemberInfo';
import {
  addBlankRow,
  addSet,
  clearChoreAddDraft,
  editCount,
  followTitlePicture,
  isSetOn,
  markPictureByHand,
  previewSet,
  removeRow,
  removeSet,
  useChoreAddDraft,
  type ChoreAddRow,
} from '@/composables/useChoreAddDraft';
import { useChoreStore } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import {
  CHORE_STARTER_SETS,
  choreStarterSet,
  type ChoreStarterSet,
  type ChoreStarterSetKey,
  type StarterChoreDraft,
} from '@/constants/choreStarterSets';
import { CHORE_BLOCK_META, CHORE_TITLE_MAX, choreArtSrc } from '@/constants/choreBlocks';
import { CHORE_BLOCKS, choreDaysKind } from '@/utils/chores';
import { formatNameList, membersByIds } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreBatchResult } from '@/stores/choreStore';
import type { ChoreBlock } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** A set to add straight to the list (the Beanie Lists redirect; validated by the page). */
    presetKey?: ChoreStarterSetKey | null;
    /** Who to start with (already filtered to living people by the page). */
    presetMemberIds?: string[];
    /** The people came over from the Beanie Lists sheet. */
    carried?: boolean;
  }>(),
  { presetKey: null, presetMemberIds: () => [], carried: false }
);

const emit = defineEmits<{ close: []; added: [result: ChoreBatchResult] }>();

const { t } = useTranslation();
const choreStore = useChoreStore();
const familyStore = useFamilyStore();
const list = useChoreAddDraft();

const memberIds = ref<string[]>([]);
const isSubmitting = ref(false);
/** The set whose preview is open, or `null`. */
const previewKey = ref<ChoreStarterSetKey | null>(null);
/** The row whose picture picker, or time chooser, is open. */
const pictureRowId = ref<number | null>(null);
const timeRowId = ref<number | null>(null);
/** The row whose title is being edited, and its title when the edit began. */
const editing = ref<{ id: number; before: string } | null>(null);

function seed(): void {
  isSubmitting.value = false;
  closeChoosers();
  const preset = props.presetMemberIds.filter((id) => choreStore.livingIds.has(id));
  memberIds.value = preset.length
    ? preset
    : familyStore.sortedHumans.filter((m) => !isAdultMember(m)).map((m) => m.id);
  // The redirect's set goes straight onto the list (no preview step), once.
  if (props.presetKey && choreStarterSet(props.presetKey) && !isSetOn(props.presetKey)) {
    addSet(props.presetKey, t);
  }
}

/**
 * Close every chooser. Each open one (the set preview, a row's time tiles) holds a token on the
 * app-wide Escape stack, and this sheet stays mounted while closed, so one left open would keep
 * swallowing the next Escape and block the PWA update reload and keyboard shortcuts.
 */
function closeChoosers(): void {
  previewKey.value = null;
  pictureRowId.value = null;
  timeRowId.value = null;
  editing.value = null;
}

watch(
  () => props.open,
  (open) => {
    if (open) seed();
    else closeChoosers();
  },
  { immediate: true }
);

// ── Suggestion sets and their preview ───────────────────────────────────────

const choresCount = (s: ChoreStarterSet) =>
  fillTemplate(
    t(s.chores.length === 1 ? 'choreboard.block.chores.one' : 'choreboard.block.chores.other'),
    { count: s.chores.length }
  );

function togglePreview(key: ChoreStarterSetKey): void {
  previewKey.value = previewKey.value === key ? null : key;
}

const preview = computed(() => {
  const key = previewKey.value;
  const set = key ? choreStarterSet(key) : undefined;
  if (!key || !set) return null;
  // `previewSet` reads the list, so the duplicate marks follow its edits.
  const rows = previewSet(key, t);
  const count = rows.filter((r) => !r.dup).length;
  return { key, set, rows, count, on: list.sets.includes(key) };
});

const previewAddLabel = computed(() =>
  preview.value
    ? fillTemplate(
        t(
          preview.value.count === 1
            ? 'choreboard.add.previewAdd.one'
            : 'choreboard.add.previewAdd.other'
        ),
        { count: preview.value.count }
      )
    : ''
);

function addPreviewed(): void {
  const p = preview.value;
  if (!p || p.on) return;
  addSet(p.key, t);
  previewKey.value = null;
}

function removePreviewed(): void {
  const p = preview.value;
  if (!p || !p.on) return;
  removeSet(p.key);
  previewKey.value = null;
}

useEscapeClose(
  computed(() => previewKey.value !== null),
  () => (previewKey.value = null)
);

// ── The list ─────────────────────────────────────────────────────────────────

/** Each block in order: its rows, and whether its heading shows (it has rows). */
const groups = computed(() =>
  CHORE_BLOCKS.map((block) => ({
    block,
    meta: CHORE_BLOCK_META[block],
    rows: list.rows.filter((r) => r.draft.block === block),
  }))
);
const isEmpty = computed(() => list.rows.length === 0);

const DAYS_TAG: Record<ReturnType<typeof choreDaysKind>, UIStringKey | null> = {
  every: null,
  school: 'choreboard.form.days.school',
  weekends: 'choreboard.form.days.weekends',
  some: 'choreboard.add.someDays',
};

/** A quiet tag for a row that does not repeat every day. */
function daysTag(d: StarterChoreDraft): string {
  const key = DAYS_TAG[choreDaysKind(d.days)];
  return key ? t(key) : '';
}

// A chooser follows its row: when the row leaves the list (its ✕, Clear List, Remove from List,
// sign-out), the chooser closes with it, so no Escape token outlives what it was for.
watch(
  () => list.rows.map((r) => r.id),
  (ids) => {
    if (pictureRowId.value !== null && !ids.includes(pictureRowId.value)) {
      pictureRowId.value = null;
    }
    if (timeRowId.value !== null && !ids.includes(timeRowId.value)) timeRowId.value = null;
    if (editing.value && !ids.includes(editing.value.id)) editing.value = null;
  }
);

const titleInputs = new Map<number, HTMLInputElement>();
function setTitleRef(id: number, el: unknown): void {
  if (el instanceof HTMLInputElement) titleInputs.set(id, el);
  else titleInputs.delete(id);
}

async function addRow(block: ChoreBlock): Promise<void> {
  const row = addBlankRow(block);
  await nextTick();
  titleInputs.get(row.id)?.focus();
}

/** Its choosers close with it (the row watcher above). */
function dropRow(id: number): void {
  removeRow(id);
}

function togglePicture(id: number): void {
  pictureRowId.value = pictureRowId.value === id ? null : id;
}

/** A picture picked by hand: the row's title stops choosing it (`followTitlePicture`). */
function pickEmoji(row: ChoreAddRow, emoji: string): void {
  row.draft.emoji = emoji;
  markPictureByHand(row);
}

function pickArt(row: ChoreAddRow, key: string): void {
  row.draft.illustration = key || undefined;
  markPictureByHand(row);
}

function toggleTime(id: number): void {
  timeRowId.value = timeRowId.value === id ? null : id;
}

/** Move a row to another time of day (its heading). */
function setTime(row: ChoreAddRow, block: ChoreBlock): void {
  row.draft.block = block;
  timeRowId.value = null;
}

useEscapeClose(
  computed(() => timeRowId.value !== null),
  () => (timeRowId.value = null)
);

// ── Inline title editing (the list-entry convention) ────────────────────────

function startEdit(row: ChoreAddRow): void {
  if (editing.value?.id !== row.id) editing.value = { id: row.id, before: row.draft.title };
}

/**
 * End an edit, keeping the text. A new row committed empty is dropped silently; an existing
 * row committed empty gets its title from before the edit back. Idempotent, so the blur that
 * follows an Enter is harmless. Answers whether this commit named a new row.
 */
function commit(row: ChoreAddRow): boolean {
  const before = editing.value?.id === row.id ? editing.value.before : row.draft.title;
  if (editing.value?.id === row.id) editing.value = null;
  const title = row.draft.title.trim();
  if (!title) {
    if (row.fresh) dropRow(row.id);
    else row.draft.title = before;
    return false;
  }
  row.draft.title = title;
  followTitlePicture(row);
  const named = !!row.fresh;
  row.fresh = false;
  return named;
}

function onEnter(row: ChoreAddRow, e: KeyboardEvent): void {
  // Enter that confirms an IME composition (pinyin, kana) is part of typing, not a commit.
  if (e.isComposing) return;
  e.preventDefault();
  if (commit(row)) void addRow(row.draft.block);
  else titleInputs.get(row.id)?.blur();
}

/** Escape while editing: an existing row's edit is cancelled; a new row is dropped. */
function cancelEdit(): void {
  const current = editing.value;
  if (!current) return;
  const row = list.rows.find((r) => r.id === current.id);
  editing.value = null;
  if (!row) return;
  if (row.fresh) {
    dropRow(row.id);
    return;
  }
  row.draft.title = current.before;
  titleInputs.get(row.id)?.blur();
}

// Registered on focus, so it sits above the sheet (and an open preview) on the Escape stack.
useEscapeClose(
  computed(() => editing.value !== null),
  cancelEdit
);

const rowName = (row: ChoreAddRow) =>
  row.draft.title.trim() || t('choreboard.starter.newPlaceholder');
const blockLabel = (b: ChoreBlock) => t(CHORE_BLOCK_META[b].labelKey);

// ── Submitting ───────────────────────────────────────────────────────────────

const people = computed(() => membersByIds(familyStore.members, memberIds.value));
const names = computed(() => formatNameList(people.value.map((m) => m.name)));
/** Rows with a title: what will be created for each bean, in block order. */
const ready = computed(() =>
  groups.value.flatMap((g) => g.rows).filter((r) => r.draft.title.trim())
);
const count = computed(() => ready.value.length);
const canSubmit = computed(() => count.value > 0 && people.value.length > 0);

const ctaLabel = computed(() => {
  if (!canSubmit.value) return t('choreboard.starter.ctaNone');
  const each = people.value.length > 1;
  const key =
    count.value === 1
      ? each
        ? 'choreboard.starter.ctaEach.one'
        : 'choreboard.starter.cta.one'
      : each
        ? 'choreboard.starter.ctaEach.other'
        : 'choreboard.starter.cta.other';
  return fillTemplate(t(key), { count: count.value, names: names.value });
});

const carriedHint = computed(() =>
  props.carried && people.value.length
    ? fillTemplate(t('choreboard.starter.carried'), { names: names.value })
    : ''
);

async function submit(): Promise<void> {
  if (isSubmitting.value || !canSubmit.value) return;
  const actorId = familyStore.currentMemberId;
  if (!actorId) return;
  isSubmitting.value = true;
  try {
    const drafts = ready.value.map((r) => ({ ...r.draft, title: r.draft.title.trim() }));
    const sets = [...new Set(drafts.flatMap((d) => (d.setKey ? [d.setKey] : [])))];
    const result = await choreStore.addChores(
      people.value.map((m) => m.id),
      drafts,
      actorId,
      { sets, edited: editCount() }
    );
    // null: the store has already toasted (a refusal or a failed write). Stay open to retry.
    if (!result) return;
    clearChoreAddDraft();
    showChoreBatchToast(
      result,
      { one: 'choreboard.starter.added.one', other: 'choreboard.starter.added.other' },
      t
    );
    emit('added', result);
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="t('choreboard.addChores')"
    icon="🎒"
    size="lg"
    fullscreen-mobile
    @close="emit('close')"
  >
    <div class="space-y-5" data-testid="chore-starter-sheet">
      <FormFieldGroup :label="t('choreboard.form.who')">
        <ListPeoplePicker v-model="memberIds" hint-testid="chore-starter-who-refused">
          <template #hint>
            <p
              v-if="carriedHint"
              class="dark:text-ink-faint text-secondary-400 mt-1.5 text-xs"
              data-testid="chore-starter-carried"
            >
              {{ carriedHint }}
            </p>
          </template>
        </ListPeoplePicker>
      </FormFieldGroup>

      <FormFieldGroup :label="t('choreboard.add.sets')">
        <div class="flex flex-wrap gap-2" role="group">
          <button
            v-for="s in CHORE_STARTER_SETS"
            :key="s.key"
            type="button"
            class="font-outfit focus-visible:ring-sky-silk-300 flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none"
            :class="
              list.sets.includes(s.key) || previewKey === s.key
                ? 'border-primary-500 dark:border-accent-lift text-secondary-500 dark:text-ink bg-[var(--tint-orange-8)]'
                : 'dark:bg-surface-overlay dark:text-ink text-secondary-500 border-transparent bg-[var(--tint-slate-5)]'
            "
            :aria-expanded="previewKey === s.key ? 'true' : 'false'"
            data-testid="chore-suggest-chip"
            :data-set="s.key"
            :data-on="list.sets.includes(s.key) ? 'true' : 'false'"
            @click="togglePreview(s.key)"
          >
            <span aria-hidden="true">{{ list.sets.includes(s.key) ? '✓' : s.emoji }}</span>
            {{ t(s.nameKey) }}
            <span class="dark:text-ink-faint text-secondary-400 font-inter text-xs font-medium">{{
              choresCount(s)
            }}</span>
          </button>
        </div>

        <!-- The open set's preview: read-only, one primary action. -->
        <section
          v-if="preview"
          class="dark:bg-surface-overlay mt-2 rounded-2xl bg-[var(--tint-slate-5)] p-3"
          data-testid="chore-set-preview"
          :data-set="preview.key"
        >
          <div class="mb-2 flex items-center gap-2">
            <span class="text-xl" aria-hidden="true">{{ preview.set.emoji }}</span>
            <h3
              class="font-outfit dark:text-ink text-secondary-500 min-w-0 flex-1 text-sm font-bold"
            >
              {{ t(preview.set.nameKey) }}
            </h3>
            <button
              type="button"
              class="flex h-8 w-8 flex-none items-center justify-center text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary-500)]"
              :aria-label="t('choreboard.add.previewClose')"
              :title="t('choreboard.add.previewClose')"
              data-testid="chore-set-preview-close"
              @click="previewKey = null"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <ul class="flex flex-col gap-1">
            <li
              v-for="(p, i) in preview.rows"
              :key="i"
              class="flex items-center gap-2 text-sm"
              data-testid="chore-set-preview-row"
              :data-dup="p.dup ? 'true' : 'false'"
            >
              <span class="w-6 flex-none text-center text-lg" aria-hidden="true">{{
                p.draft.emoji
              }}</span>
              <span
                class="min-w-0 flex-1 truncate"
                :class="
                  p.dup
                    ? 'dark:text-ink-faint text-secondary-400'
                    : 'dark:text-ink text-secondary-500'
                "
                >{{ p.draft.title }}</span
              >
              <span v-if="p.dup" class="dark:text-ink-faint text-secondary-400 text-xs italic">{{
                t('choreboard.add.previewDup')
              }}</span>
              <span v-if="daysTag(p.draft)" class="dark:text-ink-soft text-secondary-400 text-xs">{{
                daysTag(p.draft)
              }}</span>
              <span
                class="font-outfit flex-none rounded-full bg-[var(--chore-tint)] px-2 py-0.5 text-xs font-semibold text-[var(--chore-ink)]"
                :class="CHORE_BLOCK_META[p.draft.block].colorClass"
              >
                <span aria-hidden="true">{{ CHORE_BLOCK_META[p.draft.block].emoji }}</span>
                {{ blockLabel(p.draft.block) }}
              </span>
            </li>
          </ul>
          <button
            v-if="preview.on"
            type="button"
            class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 mt-3 w-full rounded-xl border border-[var(--color-border-strong)] bg-white py-2 text-sm font-bold focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-set-preview-remove"
            @click="removePreviewed"
          >
            {{ t('choreboard.add.previewRemove') }}
          </button>
          <button
            v-else
            type="button"
            class="font-outfit focus-visible:ring-sky-silk-300 mt-3 w-full rounded-xl py-2 text-sm font-bold focus-visible:ring-2 focus-visible:outline-none"
            :class="
              preview.count > 0
                ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white'
                : 'dark:bg-surface-hover dark:text-ink-soft text-secondary-500 cursor-not-allowed bg-[var(--tint-slate-10)]'
            "
            :disabled="preview.count === 0"
            data-testid="chore-set-preview-add"
            @click="addPreviewed"
          >
            {{ previewAddLabel }}
          </button>
        </section>
      </FormFieldGroup>

      <FormFieldGroup :label="t('choreboard.add.list')">
        <template #label-extra>
          <button
            v-if="!isEmpty"
            type="button"
            class="font-outfit text-primary-700 dark:text-accent-lift ml-auto text-xs font-semibold underline underline-offset-2"
            data-testid="chore-add-clear"
            @click="clearChoreAddDraft()"
          >
            {{ t('choreboard.add.clear') }}
          </button>
        </template>
        <p
          v-if="isEmpty"
          class="dark:text-ink-faint text-secondary-400 mb-2 text-xs"
          data-testid="chore-add-hint"
        >
          {{ t('choreboard.add.hint') }}
        </p>
        <div class="flex flex-col gap-3">
          <section
            v-for="g in groups"
            :key="g.block"
            class="flex flex-col gap-1.5"
            data-testid="chore-add-block"
            :data-block="g.block"
          >
            <!-- The block heading: the same header as `ChoreBlockSection` (card size). -->
            <h3
              v-if="g.rows.length"
              class="font-outfit flex items-center gap-2 rounded-xl bg-[var(--chore-tint)] px-2.5 py-1.5 text-xs font-bold text-[var(--chore-ink)]"
              :class="g.meta.colorClass"
            >
              <span class="text-sm" aria-hidden="true">{{ g.meta.emoji }}</span>
              <span class="min-w-0 flex-1 truncate">{{ t(g.meta.labelKey) }}</span>
            </h3>
            <ul v-if="g.rows.length" class="flex flex-col gap-1.5">
              <li
                v-for="row in g.rows"
                :key="row.id"
                data-testid="chore-draft-row"
                :data-block="g.block"
                :data-set="row.draft.setKey ?? 'own'"
                :data-chore="row.draft.starterChoreKey ?? 'added'"
              >
                <div
                  class="dark:bg-surface-overlay flex items-center gap-2 rounded-xl bg-[var(--tint-slate-5)] px-2.5 py-1.5 text-sm"
                >
                  <button
                    type="button"
                    class="dark:bg-surface-hover focus-visible:ring-sky-silk-300 flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-lg bg-white text-xl focus-visible:ring-2 focus-visible:outline-none"
                    :aria-label="
                      fillTemplate(t('choreboard.starter.pictureAria'), { chore: rowName(row) })
                    "
                    :aria-expanded="pictureRowId === row.id ? 'true' : 'false'"
                    data-testid="chore-draft-picture"
                    @click="togglePicture(row.id)"
                  >
                    <CardArt
                      :card="{
                        emoji: row.draft.emoji,
                        illustration: choreArtSrc(row.draft.illustration),
                      }"
                      img-class="h-full w-full object-contain"
                    />
                  </button>
                  <div class="min-w-0 flex-1">
                    <input
                      :ref="(el) => setTitleRef(row.id, el)"
                      v-model="row.draft.title"
                      type="text"
                      enterkeyhint="done"
                      :maxlength="CHORE_TITLE_MAX"
                      :placeholder="t('choreboard.starter.newPlaceholder')"
                      :aria-label="
                        fillTemplate(t('choreboard.starter.renameAria'), { chore: rowName(row) })
                      "
                      class="dark:text-ink dark:placeholder:text-ink-faint text-secondary-500 placeholder:text-secondary-400 dark:focus:border-line-strong dark:focus:bg-surface-raised w-full rounded-lg border border-transparent bg-transparent px-1.5 py-1 focus:border-[var(--color-border-strong)] focus:bg-white focus:outline-none"
                      data-testid="chore-draft-title"
                      @focus="startEdit(row)"
                      @keydown.enter="onEnter(row, $event)"
                      @blur="commit(row)"
                    />
                    <span
                      v-if="daysTag(row.draft)"
                      class="dark:text-ink-faint text-secondary-400 block px-1.5 text-xs"
                      data-testid="chore-draft-days"
                      >{{ daysTag(row.draft) }}</span
                    >
                  </div>
                  <button
                    type="button"
                    class="font-outfit focus-visible:ring-sky-silk-300 flex h-8 flex-none items-center gap-1 rounded-full bg-[var(--chore-tint)] px-2.5 text-xs font-semibold text-[var(--chore-ink)] focus-visible:ring-2 focus-visible:outline-none"
                    :class="CHORE_BLOCK_META[row.draft.block].colorClass"
                    :aria-label="
                      fillTemplate(t('choreboard.add.timeAria'), {
                        chore: rowName(row),
                        block: blockLabel(row.draft.block),
                      })
                    "
                    :aria-expanded="timeRowId === row.id ? 'true' : 'false'"
                    data-testid="chore-draft-time"
                    :data-block="row.draft.block"
                    @click="toggleTime(row.id)"
                  >
                    <span aria-hidden="true">{{ CHORE_BLOCK_META[row.draft.block].emoji }}</span>
                    <span class="hidden sm:inline">{{ blockLabel(row.draft.block) }}</span>
                  </button>
                  <!-- The list item row's remove control (`ListItemRow`), with the chore's name. -->
                  <button
                    type="button"
                    class="flex h-8 w-8 flex-none items-center justify-center text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary-500)]"
                    :aria-label="
                      fillTemplate(t('choreboard.starter.removeAria'), { chore: rowName(row) })
                    "
                    :title="
                      fillTemplate(t('choreboard.starter.removeAria'), { chore: rowName(row) })
                    "
                    data-testid="chore-draft-remove"
                    @click="dropRow(row.id)"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
                <!-- The time chooser: the chore form's block tiles, compact. -->
                <div
                  v-if="timeRowId === row.id"
                  class="mt-1.5 grid grid-cols-4 gap-1.5"
                  role="group"
                  :aria-label="
                    fillTemplate(t('choreboard.add.timeAria'), {
                      chore: rowName(row),
                      block: blockLabel(row.draft.block),
                    })
                  "
                  data-testid="chore-draft-time-choices"
                >
                  <button
                    v-for="b in CHORE_BLOCKS"
                    :key="b"
                    type="button"
                    class="font-outfit focus-visible:ring-sky-silk-300 flex flex-col items-center rounded-xl border-2 bg-[var(--chore-tint)] px-1 py-1.5 text-xs font-bold text-[var(--chore-ink)] transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none"
                    :class="[
                      CHORE_BLOCK_META[b].colorClass,
                      row.draft.block === b ? 'border-primary-500' : 'border-transparent',
                    ]"
                    :aria-pressed="row.draft.block === b ? 'true' : 'false'"
                    :data-block="b"
                    @click="setTime(row, b)"
                  >
                    <span class="text-lg leading-tight" aria-hidden="true">{{
                      CHORE_BLOCK_META[b].emoji
                    }}</span>
                    {{ blockLabel(b) }}
                  </button>
                </div>
                <div
                  v-if="pictureRowId === row.id"
                  class="dark:bg-surface-overlay mt-1.5 rounded-xl bg-[var(--tint-slate-5)] p-2.5"
                >
                  <ChorePicturePicker
                    :emoji="row.draft.emoji"
                    :illustration="row.draft.illustration ?? ''"
                    @update:emoji="pickEmoji(row, $event)"
                    @update:illustration="pickArt(row, $event)"
                  />
                </div>
              </li>
            </ul>
            <button
              type="button"
              class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 flex w-full items-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--tint-orange-15)] px-3 py-1.5 text-left text-sm font-bold focus-visible:ring-2 focus-visible:outline-none"
              data-testid="chore-add-row"
              :data-block="g.block"
              @click="addRow(g.block)"
            >
              <span aria-hidden="true">+ {{ g.meta.emoji }}</span>
              {{ fillTemplate(t('choreboard.starter.addInBlock'), { block: t(g.meta.labelKey) }) }}
            </button>
          </section>
        </div>
      </FormFieldGroup>
    </div>

    <template #footer>
      <button
        type="button"
        class="font-outfit w-full rounded-2xl py-3.5 text-sm font-bold transition-all duration-150"
        :class="
          canSubmit
            ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)]'
            : 'dark:bg-surface-overlay dark:text-ink-soft text-secondary-500 cursor-not-allowed bg-[var(--tint-slate-10)]'
        "
        :disabled="!canSubmit || isSubmitting"
        :aria-busy="isSubmitting ? 'true' : undefined"
        data-testid="chore-starter-add"
        @click="submit"
      >
        {{ isSubmitting ? t('common.saving') : ctaLabel }}
      </button>
    </template>
  </BaseModal>
</template>
