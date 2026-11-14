<script setup lang="ts">
/**
 * Add Chores on the choreboard (#146, owner decisions 2026-11-13): adds ONE list of chores to
 * one or several beans at once ("Add 6 Chores Each for Pip and Juno"). The page header's Add
 * Chores, the empty state and the Beanie Lists redirect open it; a single bean's chores are
 * edited in that bean's own list (`ChoreBeanEditor`). Each chosen bean gets their OWN copy of
 * every named row (one `addChores` batch); a bean who already has a chore by that name in that
 * block is skipped and the toast says so. Grown-ups only: the page opens it for adults.
 *
 * It is the DRAFT host of the shared chore list pieces, which the bean editor hosts live:
 *  - "Add a Set of Chores" (`ChoreSetChips`): a set's preview adds its chores under their
 *    headings, skipping any the list already has; a set on the list can be taken back ("Remove
 *    from List" takes only its UNEDITED rows). `?starter=<key>` adds a set straight in.
 *  - The list (`ChoreEditList` of `ChoreEditRow`s): rows under time-of-day headings, an add row
 *    per block; a row's picture, title, days (`ChoreDaysChooser`), time of day and ✕. Days come
 *    from the suggestion (School Morning is school days) and can be changed on the row.
 *  - A title is committed on Enter or blur; Enter on a new row opens another blank row in the
 *    same block (list entry); Escape cancels an edit, or drops a new row; a new row committed
 *    empty is dropped. A title still being typed already counts (`typing`): the button names it
 *    and Add sends it, so nothing typed is lost to a tap that did not blur the field first.
 *  - A picture is automatic: a row of the grown-up's own takes one from its title each time the
 *    title is committed (`pictureForTitle`), until its picture is picked by
 *    hand. A suggested row keeps its set's picture.
 *  - Every chooser closes when the sheet closes (the drawer unmounts its body) or its row
 *    leaves the list; the pieces own their Escape tokens, above the drawer's own, so Escape
 *    closes a row edit, chooser or preview first and the drawer after.
 *  - The list is the session's (`useChoreAddDraft`): memory only, kept across close and reopen,
 *    cleared after a successful Add, by "Clear List" and on sign-out.
 *
 * It is the right-hand drawer (`BeanieFormModal variant="drawer"`), as a Beanie List and a to-do
 * are; its primary action is the Add button (disabled with nothing to add, the spinner while the
 * batch is written, when the drawer cannot be closed). Stays mounted while closed; the people
 * re-seed on every open, the list does not.
 *
 * Dark mode: the drawer's raised panel and body (`BeanieFormModal`); the pieces carry their own
 * (see each); the carried hint and the Clear List link are `ink-faint` / `accent-lift` on dark,
 * the footer CTA the brand gradient or `surface-overlay` (`BeanieFormModal`'s not-ready look).
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import ListPeoplePicker from '@/components/lists/ListPeoplePicker.vue';
import ChoreSetChips from '@/components/chores/ChoreSetChips.vue';
import ChoreEditList from '@/components/chores/ChoreEditList.vue';
import { showChoreBatchToast } from '@/composables/choreBatchToast';
import { useTranslation } from '@/composables/useTranslation';
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
import { choreStarterSet, type ChoreStarterSetKey } from '@/constants/choreStarterSets';
import { CHORE_BLOCKS, normalizeChoreDays } from '@/utils/chores';
import { formatNameList, membersByIds } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreEditItem } from '@/components/chores/choreEditItem';
import type { ChoreBlock } from '@/types/models';

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

const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const choreStore = useChoreStore();
const familyStore = useFamilyStore();
const list = useChoreAddDraft();

const memberIds = ref<string[]>([]);
const isSubmitting = ref(false);
const listRef = ref<InstanceType<typeof ChoreEditList> | null>(null);

function seed(): void {
  isSubmitting.value = false;
  const preset = props.presetMemberIds.filter((id) => choreStore.livingIds.has(id));
  memberIds.value = preset.length
    ? preset
    : familyStore.sortedHumans.filter((m) => !isAdultMember(m)).map((m) => m.id);
  // The redirect's set goes straight onto the list (no preview step), once.
  if (props.presetKey && choreStarterSet(props.presetKey) && !isSetOn(props.presetKey)) {
    addSet(props.presetKey, t);
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) seed();
  },
  { immediate: true }
);

// ── Sets ─────────────────────────────────────────────────────────────────────

const previewOf = (key: ChoreStarterSetKey) => previewSet(key, t);

// ── The list ─────────────────────────────────────────────────────────────────

/** In block order: what the button counts and what is sent. */
const ordered = computed(() =>
  CHORE_BLOCKS.flatMap((block) => list.rows.filter((r) => r.draft.block === block))
);

const items = computed<ChoreEditItem[]>(() =>
  ordered.value.map((r) => ({
    key: String(r.id),
    title: r.draft.title,
    emoji: r.draft.emoji,
    illustration: r.draft.illustration,
    block: r.draft.block,
    days: r.draft.days,
    attrs: {
      'data-set': r.draft.setKey ?? 'own',
      'data-chore': r.draft.starterChoreKey ?? 'added',
    },
  }))
);
const isEmpty = computed(() => list.rows.length === 0);

/** Titles being typed right now, by row key (`typing`); gone when the edit ends. */
const typing = reactive(new Map<string, string>());

/** A row's title as of now: the text being typed, else its committed title. */
function titleNow(r: ChoreAddRow): string {
  const live = typing.get(String(r.id));
  if (live === undefined) return r.draft.title.trim();
  // An existing row being emptied keeps its title (a commit would give it back).
  return live.trim() || (r.fresh ? '' : r.draft.title.trim());
}

/** Give a row its title: a new row is named, and its picture follows (`followTitlePicture`). */
function applyTitle(row: ChoreAddRow, title: string): void {
  row.draft.title = title;
  row.fresh = false;
  followTitlePicture(row);
}

function clearList(): void {
  clearChoreAddDraft();
  typing.clear();
}

const rowOf = (key: string): ChoreAddRow | undefined => list.rows.find((r) => String(r.id) === key);

async function addRow(block: ChoreBlock): Promise<void> {
  const row = addBlankRow(block);
  await nextTick();
  listRef.value?.focusRow(String(row.id));
}

/** A title committed: a new row is named (and Enter opens the next one). */
function onCommit(key: string, title: string, enter: boolean): void {
  typing.delete(key);
  const row = rowOf(key);
  if (!row) return;
  const named = !!row.fresh;
  applyTitle(row, title);
  if (named && enter) void addRow(row.draft.block);
}

/** Committed empty, or Escape: a new row is dropped; an existing row keeps its title. */
function onDropIfFresh(key: string): void {
  typing.delete(key);
  const row = rowOf(key);
  if (row?.fresh) removeRow(row.id);
}

function onTime(key: string, block: ChoreBlock): void {
  const row = rowOf(key);
  if (row) row.draft.block = block;
}

/** A picture picked by hand: the row's title stops choosing it (`followTitlePicture`). */
function onPicture(key: string, picture: { emoji: string; illustration: string }): void {
  const row = rowOf(key);
  if (!row) return;
  row.draft.emoji = picture.emoji;
  row.draft.illustration = picture.illustration || undefined;
  markPictureByHand(row);
}

function onDays(key: string, days: number[]): void {
  const row = rowOf(key);
  if (row) row.draft.days = normalizeChoreDays(days);
}

function onRemove(key: string): void {
  typing.delete(key);
  const row = rowOf(key);
  if (row) removeRow(row.id);
}

// ── Submitting ───────────────────────────────────────────────────────────────

const people = computed(() => membersByIds(familyStore.members, memberIds.value));
const names = computed(() => formatNameList(people.value.map((m) => m.name)));
/** Rows with a title: what will be created for each bean, in block order. */
const ready = computed(() => ordered.value.filter((r) => titleNow(r)));
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
    // A title still being typed is the row's title now (as its commit would make it).
    for (const r of ready.value) {
      if (typing.has(String(r.id))) applyTitle(r, titleNow(r));
    }
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
    clearList();
    showChoreBatchToast(
      result,
      { one: 'choreboard.starter.added.one', other: 'choreboard.starter.added.other' },
      t
    );
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="t('choreboard.addChores')"
    icon="🎒"
    icon-bg="var(--tint-orange-12)"
    size="narrow"
    :save-label="ctaLabel"
    :save-ready="canSubmit"
    :save-disabled="!canSubmit"
    :is-submitting="isSubmitting"
    save-testid="chore-starter-add"
    @close="emit('close')"
    @save="submit"
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

      <ChoreSetChips
        :preview="previewOf"
        :on-keys="list.sets"
        removable
        @add="addSet($event, t)"
        @remove="removeSet"
      />

      <FormFieldGroup :label="t('choreboard.add.list')">
        <template #label-extra>
          <button
            v-if="!isEmpty"
            type="button"
            class="font-outfit text-primary-700 dark:text-accent-lift ml-auto text-xs font-semibold underline underline-offset-2"
            data-testid="chore-add-clear"
            @click="clearList"
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
        <ChoreEditList
          ref="listRef"
          :items="items"
          @commit="onCommit"
          @typing="(key, text) => typing.set(key, text)"
          @empty="onDropIfFresh"
          @cancel="onDropIfFresh"
          @time="onTime"
          @picture="onPicture"
          @days="onDays"
          @remove="onRemove"
          @add-row="addRow"
        />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
