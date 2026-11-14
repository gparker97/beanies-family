<script setup lang="ts">
/**
 * A bean's chore list, "Pip's Chores" (#146, owner decision 2026-11-13): ONE list per bean,
 * edited like a Beanie List. Every chore of the bean's, on every day of the week, under its
 * time-of-day heading; changes save as they are made, so there is no Save, only Done. The
 * bean is the list's owner: there is no people picker (several kids: Copy, or the page's Add
 * Chores sheet, which adds to several beans at once).
 *
 * It is the LIVE host of the shared chore list pieces the Add Chores sheet hosts as a draft
 * (`ChoreSetChips`, `ChoreEditList` of `ChoreEditRow`s, `ChoreDaysChooser`). Each row intent is
 * one store action, made with an explicit `actorId` and `via: 'bean-editor'` (the firehose's
 * `kind`), and answered by the store's re-read:
 *  - rename (Enter or blur; Escape cancels), time, picture, days: `updateChore`;
 *  - a new row: created when its title is committed (`createChore`, for this bean, with an
 *    automatic picture from its title until one is picked by hand); a row left empty is
 *    dropped; Enter opens the next row in its block. The row's key IS its chore's id, minted when
 *    the row is added, and the row is drawn from here until its create has fully settled, so it
 *    never remounts (an open chooser stays open, focus stays put); a change made while the
 *    create is in flight is saved right after it;
 *  - a previewed set: `addChores` for this bean, duplicates dimmed and skipped;
 *  - ✕: `removeChoresForMember`, at once (a chore shared with other beans keeps them);
 *  - Remove All: one ConfirmModal (danger), then the same action for every chore here;
 *  - drag within a block: `reorderChores`.
 * While a write is in flight its row shows the change (`pending`); when it settles the row shows
 * the store's value again, so a refused or failed write (already toasted and reported by the
 * store) leaves nothing behind. A new row whose create fails is dropped with it.
 *
 * A chore several beans share (an older chore, or one from demo data) shows here for each of
 * them with a quiet "Shared with Juno": renaming or moving it changes it for all of them, its ✕
 * takes it off this bean only.
 *
 * Keep Parents Posted is ONE switch for the whole list, for a child only, as lists and to-dos
 * have it, at the foot of the drawer (after the list: it is a setting, not the list). It is on when every chore here has the flag; switching writes the flag on all of them
 * in one change (`setNotifyParentsFor`). A new chore takes the bean's state wherever it is added
 * (the store decides, `notifyFor`), so adding never turns the switch off. The switch only changes
 * when it is touched: its last state is kept while the list is empty (Remove All, then a set,
 * keeps it), and a toggle made during a first create is applied once that create lands.
 *
 * Each new row remembers its bean, and the editor keeps the last bean while it closes (the page
 * clears its bean with `open`), so a title still being typed as it closes is still created or
 * saved. Opened with no bean, it shows nothing.
 *
 * Grown-ups only: the page opens it for adults, it renders nothing for anyone else, and the
 * store refuses a child. Stays mounted while closed; it re-seeds on every open.
 *
 * It is the right-hand drawer (`BeanieFormModal variant="drawer"`), as a Beanie List and a to-do
 * are: the panel's Escape token sits under a row's edit, chooser or set preview, which Escape
 * closes first; the drawer unmounts its body on close, so no chooser outlives it and a row's
 * unmount commit runs then.
 *
 * Dark mode: the drawer's raised panel and body (`BeanieFormModal`); the pieces carry their own
 * (see each); the hint is `ink-faint`, Remove All `accent-lift` on dark (its confirm is the danger
 * one), Done the drawer's brand gradient with white.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import NotifyParentsToggle from '@/components/ui/NotifyParentsToggle.vue';
import ChoreSetChips from '@/components/chores/ChoreSetChips.vue';
import ChoreEditList from '@/components/chores/ChoreEditList.vue';
import { confirm } from '@/composables/useConfirm';
import { showChoreBatchToast } from '@/composables/choreBatchToast';
import { isAdultMember, useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { useChoreStore, type ChoreEdit, type ChoreEditVia } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import {
  CHORE_STARTER_SETS,
  starterSetPreview,
  type ChoreStarterSetKey,
} from '@/constants/choreStarterSets';
import { DEFAULT_CHORE_EMOJI, choreEmoji, pictureForTitle } from '@/constants/choreBlocks';
import { canSetNotifyParents, isChildOnly } from '@/utils/audience';
import { firstName, formatNameList, membersByIds } from '@/utils/assignees';
import { choreBlockOf, choreDupKey, livingAssignees, normalizeChoreDays } from '@/utils/chores';
import { generateUUID } from '@/utils/id';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ChoreEditItem } from '@/components/chores/choreEditItem';
import type { ChoreBlock } from '@/types/models';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Whose chores (a living person; the page checks). */
    memberId?: string | null;
  }>(),
  { memberId: null }
);

const emit = defineEmits<{ close: [] }>();

const VIA: ChoreEditVia = 'bean-editor';

const { t } = useTranslation();
const choreStore = useChoreStore();
const familyStore = useFamilyStore();
const { getMemberById } = useMemberInfo();

const me = computed(() => familyStore.currentMember);
/**
 * The bean, kept while the editor closes: the page clears `memberId` together with `open`, and a
 * row's last edit (its unmount commit) must still find the bean. Cleared when the editor opens
 * with no bean, so it never shows the previous bean's list.
 */
const beanId = ref<string | null>(props.memberId);
const member = computed(() =>
  beanId.value && choreStore.livingIds.has(beanId.value)
    ? familyStore.members.find((m) => m.id === beanId.value)
    : undefined
);
/** Only a grown-up ever sees it, and only for a living person. */
const shown = computed(() => props.open && !!member.value && !!me.value && isAdultMember(me.value));
const beanName = computed(() =>
  member.value ? firstName(member.value.name) || member.value.name : ''
);
const title = computed(() => fillTemplate(t('choreboard.editor.title'), { name: beanName.value }));

/** Every chore of the bean's, on every day, in the family's one order. */
const mine = computed(() => {
  const id = member.value?.id;
  if (!id) return [];
  return choreStore.sortedChores.filter((c) =>
    livingAssignees(c, choreStore.livingIds).includes(id)
  );
});

// ── Local state: new rows, and writes in flight ──────────────────────────────

/** A row added here: drawn from here until its create has fully settled. */
interface NewRow {
  /** The row's key AND its chore's id, minted when the row is added. */
  key: string;
  /** Whose chore it will be (the bean the editor was open for when it was added). */
  beanId: string;
  block: ChoreBlock;
  title: string;
  emoji: string;
  illustration?: string;
  days?: number[];
  pictureByHand: boolean;
  /** Its create (and the follow-up patch) is in flight. */
  inFlight: boolean;
  /** Its ✕ was tapped while in flight: it is removed once the create lands. */
  removed?: boolean;
}
const newRows = ref<NewRow[]>([]);

/** What a row shows while its write is in flight; gone when the write settles. */
interface Pending {
  title?: string;
  emoji?: string;
  illustration?: string;
  block?: ChoreBlock;
  days?: number[];
  hidden?: boolean;
}
const pending = reactive(new Map<string, Pending>());
/** The latest write per chore: only it clears the row's pending display. */
const latest = new Map<string, number>();
let seq = 0;

const listRef = ref<InstanceType<typeof ChoreEditList> | null>(null);
const busy = ref(false);

/** Every chore of the bean's has Keep Parents Posted, or `null` while the list is empty. */
const storedNotify = computed(() =>
  mine.value.length ? mine.value.every((c) => c.notifyParents === true) : null
);
/**
 * The switch's last state: seeded from the stored chores on open, following them while there
 * are any, and kept as it was while the list is empty, for the chores about to be added.
 */
const notifyKept = ref(false);
/**
 * First creates in flight (a bean with no chores, the switch's choice sent with it). Until they
 * settle the switch shows the choice, not the half-written list, and a toggle made meanwhile is
 * not overwritten by the create landing; `createFrom` applies it afterwards.
 */
const firstCreates = ref(0);
watch(storedNotify, (v) => {
  if (v !== null && firstCreates.value === 0) notifyKept.value = v;
});

watch(
  () => [props.open, props.memberId] as const,
  ([open, id], prev) => {
    if (id) beanId.value = id;
    const opening = open && (!prev || !prev[0] || id !== prev[1]);
    if (!opening) return;
    if (!id) beanId.value = null;
    newRows.value = [];
    pending.clear();
    latest.clear();
    notifyKept.value = storedNotify.value ?? false;
  },
  { immediate: true }
);

const actor = () => me.value?.id ?? null;

/** Run one write for a stored chore, showing `show` on its row until it settles. */
async function withPending<T>(id: string, show: Pending, run: (actorId: string) => Promise<T>) {
  const actorId = actor();
  if (!actorId) return null;
  const token = ++seq;
  latest.set(id, token);
  pending.set(id, { ...pending.get(id), ...show });
  try {
    return await run(actorId);
  } finally {
    if (latest.get(id) === token) {
      pending.delete(id);
      latest.delete(id);
    }
  }
}

function saveChore(id: string, patch: ChoreEdit): Promise<unknown> {
  const show: Pending = { ...patch } as Pending;
  return withPending(id, show, (actorId) =>
    choreStore.updateChore(id, patch, actorId, { via: VIA })
  );
}

// ── The rows ─────────────────────────────────────────────────────────────────

const sharedNote = (assignees: string[]) => {
  const others = assignees.filter((id) => id !== member.value?.id);
  if (!others.length) return undefined;
  const names = membersByIds(familyStore.members, others).map((m) => firstName(m.name) || m.name);
  return fillTemplate(t('choreboard.editor.sharedWith'), { names: formatNameList(names) });
};

const items = computed<ChoreEditItem[]>(() => {
  // A row being created is drawn from `newRows` until it settles, never twice.
  const drawnHere = new Set(newRows.value.map((r) => r.key));
  const stored = mine.value.flatMap((c): ChoreEditItem[] => {
    const p = pending.get(c.id) ?? {};
    if (p.hidden || drawnHere.has(c.id)) return [];
    return [
      {
        key: c.id,
        title: p.title ?? c.title,
        emoji: p.emoji ?? choreEmoji(c),
        illustration: 'illustration' in p ? p.illustration : c.illustration,
        block: p.block ?? choreBlockOf(c),
        days: p.days ?? c.days,
        note: sharedNote(livingAssignees(c, choreStore.livingIds)),
        draggable: true,
        attrs: { 'data-chore-id': c.id },
      },
    ];
  });
  const added = newRows.value
    .filter((r) => !r.removed)
    .map((r): ChoreEditItem => ({
      key: r.key,
      title: r.title,
      emoji: r.emoji,
      illustration: r.illustration,
      block: r.block,
      days: r.days,
      attrs: { 'data-chore-id': 'new' },
    }));
  return [...stored, ...added];
});

const newRowOf = (key: string) => newRows.value.find((r) => r.key === key);
function dropNewRow(key: string): void {
  newRows.value = newRows.value.filter((r) => r.key !== key);
}

async function addRow(block: ChoreBlock): Promise<void> {
  const bean = beanId.value;
  if (!bean) return;
  const key = generateUUID();
  newRows.value.push({
    key,
    beanId: bean,
    block,
    title: '',
    emoji: DEFAULT_CHORE_EMOJI,
    pictureByHand: false,
    inFlight: false,
  });
  await nextTick();
  listRef.value?.focusRow(key);
}

/** What a new row sends: compared after the create, to save what changed during it. */
const rowFields = (r: NewRow) => ({
  title: r.title,
  emoji: r.emoji,
  illustration: r.illustration,
  block: r.block,
  days: r.days,
});

/**
 * Create a new row's chore under the row's key. While it is in flight the row keeps taking
 * changes locally; once it lands, what changed is saved in one follow-up write, and a parents
 * toggle made meanwhile (a bean with no chores yet) is applied. Only then does the row give way
 * to the stored chore, which has the same key. Refused or failed: the store has toasted and the
 * row goes, so nothing stays that looks saved.
 */
async function createFrom(row: NewRow, title: string, enter: boolean): Promise<void> {
  const actorId = actor();
  if (!actorId || row.inFlight) return;
  row.title = title;
  if (!row.pictureByHand) row.emoji = pictureForTitle(title);
  row.inFlight = true;
  const sent = rowFields(row);
  // A bean with no chores yet takes the switch's choice; otherwise the store decides.
  const sentNotify = mine.value.length ? undefined : notifyKept.value;
  if (sentNotify !== undefined) firstCreates.value++;
  try {
    const created = await choreStore.createChore(
      { ...sent, assigneeIds: [row.beanId], notifyParents: sentNotify },
      actorId,
      { via: VIA, id: row.key }
    );
    if (!created) return;
    if (row.removed) {
      removeChore(row.key, row.beanId);
      return;
    }
    const now = rowFields(row);
    const patch: ChoreEdit = {};
    if (now.title !== sent.title) patch.title = now.title;
    if (now.emoji !== sent.emoji || now.illustration !== sent.illustration) {
      patch.emoji = now.emoji;
      patch.illustration = now.illustration;
    }
    if (now.block !== sent.block) patch.block = now.block;
    if ((now.days ?? []).join() !== (sent.days ?? []).join()) patch.days = now.days ?? [];
    if (Object.keys(patch).length) {
      await choreStore.updateChore(row.key, patch, actorId, { via: VIA });
    }
    if (sentNotify !== undefined && notifyKept.value !== sentNotify) {
      await choreStore.setNotifyParentsFor(row.beanId, notifyKept.value, actorId, { via: VIA });
    }
    if (enter && props.open && beanId.value === row.beanId) void addRow(row.block);
  } finally {
    dropNewRow(row.key);
    if (sentNotify !== undefined) {
      firstCreates.value--;
      // The stored flags are the truth again (a failed follow-up shows as off).
      if (firstCreates.value === 0 && storedNotify.value !== null) {
        notifyKept.value = storedNotify.value;
      }
    }
  }
}

/**
 * Each row intent: a new row (not created yet, or its create in flight) changes locally, and
 * `createFrom` sends or follows up; a stored chore is one store write. A row's key is its
 * chore's id either way.
 */
function onCommit(key: string, title: string, enter: boolean): void {
  const row = newRowOf(key);
  if (row) {
    if (row.inFlight) row.title = title;
    else void createFrom(row, title, enter);
    return;
  }
  const chore = choreStore.choreById(key);
  if (chore && chore.title !== title) void saveChore(key, { title });
}

/** Committed empty, or Escape: a new row is dropped; a stored row shows its title again. */
function onDropIfNew(key: string): void {
  const row = newRowOf(key);
  if (row && !row.inFlight) dropNewRow(key);
}

function onTime(key: string, block: ChoreBlock): void {
  const row = newRowOf(key);
  if (row) row.block = block;
  else if (choreStore.choreById(key)?.block !== block) void saveChore(key, { block });
}

function onPicture(key: string, picture: { emoji: string; illustration: string }): void {
  const illustration = picture.illustration || undefined;
  const row = newRowOf(key);
  if (row) {
    row.emoji = picture.emoji;
    row.illustration = illustration;
    row.pictureByHand = true;
  } else {
    void saveChore(key, { emoji: picture.emoji, illustration });
  }
}

function onDays(key: string, days: number[]): void {
  const row = newRowOf(key);
  if (row) row.days = normalizeChoreDays(days);
  else void saveChore(key, { days });
}

function onRemove(key: string): void {
  const row = newRowOf(key);
  if (row) {
    // In flight: hidden now, taken off once it lands (`createFrom`); otherwise just dropped.
    if (row.inFlight) row.removed = true;
    else dropNewRow(key);
    return;
  }
  const memberId = member.value?.id;
  if (memberId) removeChore(key, memberId);
}

/** ✕ on a stored chore: off this bean's list at once; back if the write fails. */
function removeChore(id: string, memberId: string): void {
  void withPending(id, { hidden: true }, (actorId) =>
    choreStore.removeChoresForMember([id], memberId, actorId, { via: VIA })
  );
}

async function onReorder(_block: ChoreBlock, keys: string[]): Promise<boolean> {
  const actorId = actor();
  if (!actorId) return false;
  return (await choreStore.reorderChores(keys, actorId, { via: VIA })) === true;
}

// ── Sets ─────────────────────────────────────────────────────────────────────

const mineKeys = computed(
  () => new Set(mine.value.map((c) => choreDupKey(c.title, choreBlockOf(c))))
);

const previewOf = (key: ChoreStarterSetKey) => starterSetPreview(key, t, mineKeys.value);

/** Sets the bean already has every chore of (nothing left to add). */
const fullSets = computed(() =>
  CHORE_STARTER_SETS.filter((s) => previewOf(s.key).every((p) => p.dup)).map((s) => s.key)
);

async function addSetHere(key: ChoreStarterSetKey): Promise<void> {
  const memberId = member.value?.id;
  const actorId = actor();
  const drafts = previewOf(key)
    .filter((p) => !p.dup)
    .map((p) => p.draft);
  if (!memberId || !actorId || !drafts.length || busy.value) return;
  busy.value = true;
  try {
    const result = await choreStore.addChores([memberId], drafts, actorId, {
      sets: [key],
      // A bean with no chores yet takes the switch's choice; otherwise the store decides.
      ...(mine.value.length ? {} : { notifyParents: notifyKept.value }),
      via: VIA,
    });
    // null: the store has already toasted the refusal or the failed write.
    if (result) {
      showChoreBatchToast(
        result,
        { one: 'choreboard.starter.added.one', other: 'choreboard.starter.added.other' },
        t
      );
    }
  } finally {
    busy.value = false;
  }
}

// ── Keep Parents Posted, for the whole list ──────────────────────────────────

const notifyShown = computed(
  () =>
    !!member.value && isChildOnly([member.value.id], getMemberById) && canSetNotifyParents(me.value)
);
const notifyOn = computed(() =>
  firstCreates.value > 0 ? notifyKept.value : (storedNotify.value ?? notifyKept.value)
);
const notifyBusy = ref(false);

/** The switch, touched: it is kept as the list's choice, and written to every chore there is. */
async function setNotify(on: boolean): Promise<void> {
  const memberId = member.value?.id;
  const actorId = actor();
  if (!memberId || !actorId || notifyBusy.value) return;
  notifyKept.value = on;
  if (!mine.value.length) return;
  notifyBusy.value = true;
  try {
    const done = await choreStore.setNotifyParentsFor(memberId, on, actorId, { via: VIA });
    // Refused or failed (already toasted): the switch reads the stored flags again.
    if (!done) notifyKept.value = storedNotify.value ?? notifyKept.value;
  } finally {
    notifyBusy.value = false;
  }
}

// ── Remove All ───────────────────────────────────────────────────────────────

async function removeAll(): Promise<void> {
  const memberId = member.value?.id;
  const ids = mine.value.map((c) => c.id);
  if (!memberId || !ids.length || busy.value) return;
  const ok = await confirm({
    title: 'choreboard.editor.removeAll.title',
    message: 'choreboard.editor.removeAll.message',
    detail: fillTemplate(
      t(
        ids.length === 1
          ? 'choreboard.editor.removeAll.detail.one'
          : 'choreboard.editor.removeAll.detail.other'
      ),
      { count: ids.length, name: beanName.value }
    ),
    variant: 'danger',
  });
  const actorId = actor();
  if (!ok || !actorId) return;
  busy.value = true;
  try {
    // null: already toasted by the store; the rows are still there to retry.
    await choreStore.removeChoresForMember(ids, memberId, actorId, { via: VIA });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <!-- The right-hand drawer, as a Beanie List and a to-do edit in. Changes save as they are made,
       so the primary action only closes ("Done"), the way ListDetailModal's "Close" does. -->
  <BeanieFormModal
    variant="drawer"
    :open="shown"
    :title="title"
    icon="🧹"
    icon-bg="var(--tint-orange-12)"
    size="narrow"
    :save-label="t('action.done')"
    save-testid="chore-bean-editor-done"
    @close="emit('close')"
    @save="emit('close')"
  >
    <div class="space-y-5" data-testid="chore-bean-editor" :data-member-id="member?.id">
      <p
        class="dark:text-ink-faint text-secondary-400 -mt-1 text-xs"
        data-testid="chore-bean-editor-hint"
      >
        {{ t('choreboard.editor.hint') }}
      </p>

      <ChoreSetChips :preview="previewOf" :on-keys="fullSets" :busy="busy" @add="addSetHere" />

      <FormFieldGroup :label="t('choreboard.editor.list')">
        <template #label-extra>
          <button
            v-if="mine.length"
            type="button"
            class="font-outfit text-primary-700 dark:text-accent-lift ml-auto text-xs font-semibold underline underline-offset-2"
            data-testid="chore-bean-editor-remove-all"
            @click="removeAll"
          >
            {{ t('choreboard.editor.removeAll') }}
          </button>
        </template>
        <p
          v-if="!items.length"
          class="dark:text-ink-faint text-secondary-400 mb-2 text-xs"
          data-testid="chore-add-hint"
        >
          {{ t('choreboard.add.hint') }}
        </p>
        <ChoreEditList
          ref="listRef"
          :items="items"
          :reorder="onReorder"
          @commit="onCommit"
          @empty="onDropIfNew"
          @cancel="onDropIfNew"
          @time="onTime"
          @picture="onPicture"
          @days="onDays"
          @remove="onRemove"
          @add-row="addRow"
        />
      </FormFieldGroup>

      <!-- Last on purpose: a setting for the whole list, not the list itself. -->
      <NotifyParentsToggle
        v-if="notifyShown"
        :model-value="notifyOn"
        testid="chore-bean-editor-notify-parents"
        :hint-keys="{
          on: 'choreboard.editor.notifyHintOn',
          off: 'choreboard.editor.notifyHintOff',
        }"
        @update:model-value="setNotify"
      />
    </div>
  </BeanieFormModal>
</template>
