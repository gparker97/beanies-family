<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import draggable from 'vuedraggable';
import { useTranslation } from '@/composables/useTranslation';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useReducedMotion } from '@/composables/useReducedMotion';
import { useListStore } from '@/stores/listStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useActivityStore } from '@/stores/activityStore';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { getListCategory } from '@/constants/listCategories';
import { isRecurring } from '@/utils/listLifecycle';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatDateShort, extractDatePart } from '@/utils/date';
import { resolveListRule, listShadowFromCadence } from '@/services/recurrence/adapters';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import RecurrencePicker from '@/components/ui/RecurrencePicker.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import ListItemRow from './ListItemRow.vue';
import ListCategoryPills from './ListCategoryPills.vue';
import type { FamilyListItem, ListCategory, ListLifecycle } from '@/types/models';
import type { RecurrenceRule, Cadence } from '@/types/recurrence';

const props = withDefaults(
  defineProps<{
    listId: string | null;
    /** Stack above another open drawer (e.g. when opened from the activity drawer). */
    stacked?: boolean;
  }>(),
  { stacked: false }
);
const emit = defineEmits<{ close: []; deleted: [id: string] }>();

const { t } = useTranslation();
const { describe } = useRecurrenceLabel();
const listStore = useListStore();
const familyStore = useFamilyStore();
const vacationStore = useVacationStore();
const activityStore = useActivityStore();
const { categoryLabel } = useListCategoryLabel();
const { getMemberName } = useMemberInfo();

const list = computed(() =>
  props.listId ? (listStore.lists.find((l) => l.id === props.listId) ?? null) : null
);
const meId = computed(() => familyStore.currentMember?.id ?? '');
const { prefersReducedMotion } = useReducedMotion();

// ── Inline edit: list title + item text ───────────────────────────────────
// One useInlineEdit instance drives both (single-active-field + auto-save-
// previous). The TITLE draft lives here; ITEM drafts live in each ListItemRow
// (the row owns the <input>), so saveDraft only persists the title — item saves
// dispatch from onItemEditSave. `editingListId` is captured at edit-start so a
// save lands on the list that WAS being edited even if `list` (a computed off
// props.listId) has re-projected.
const editingListId = ref<string | null>(null);
const draftTitle = ref('');
const titleInputRef = ref<HTMLInputElement | null>(null);

const inline = useInlineEdit<'title' | `item:${string}`>({
  populateDraft: (field) => {
    if (!list.value) return;
    editingListId.value = list.value.id;
    if (field === 'title') draftTitle.value = list.value.title;
    // item drafts are seeded inside the row from `item.title`.
  },
  saveDraft: (field) => {
    const id = editingListId.value;
    if (id && field === 'title') void listStore.renameList(id, draftTitle.value);
    // item saves are dispatched from onItemEditSave, not here.
  },
});

function startTitleEdit(): void {
  inline.startEdit('title');
  void nextTick(() => titleInputRef.value?.focus());
}
// Guarded so the blur fired by an Esc/Enter-driven unmount can't re-commit
// (after either, isEditing('title') is already false).
function onTitleBlur(): void {
  if (inline.isEditing('title')) void inline.saveField('title');
}
function onItemEditSave(itemId: string, text: string): void {
  const id = editingListId.value ?? list.value?.id;
  if (id) void listStore.updateItemText(id, itemId, text);
  inline.cancelEdit();
}
// vuedraggable mutates its bound array IN PLACE — so bind a LOCAL clone (not the
// Automerge projection `list.items`, which a direct bind would double-mutate →
// the off-by-one). The clone is the optimistic visual order; the authoritative
// move is persisted via `reorderItems`, which flows back through this watcher.
const itemsDraft = ref<FamilyListItem[]>([]);
watch(
  () => list.value?.items,
  (items) => {
    itemsDraft.value = items ? [...items] : [];
  },
  { immediate: true }
);
function onItemMove(evt: { moved?: { oldIndex: number; newIndex: number } }): void {
  if (!list.value || !evt.moved) return;
  void listStore.reorderItems(list.value.id, evt.moved.oldIndex, evt.moved.newIndex);
}
function onClose(): void {
  void inline.saveAndClose(); // commit an in-flight TITLE edit (items self-commit on unmount)
  emit('close');
}

// Meta-band pills are display by default; tapping one reveals an inline editor.
const editingCategory = ref(false);
const editingOwner = ref(false);
const editingLink = ref<'trip' | 'activity' | null>(null);
watch(
  () => props.listId,
  () => {
    editingCategory.value = false;
    editingOwner.value = false;
    editingLink.value = null;
    // Commit an in-flight title edit to the OLD list (via editingListId) before
    // it re-projects; item rows self-commit on unmount. Don't clear
    // editingListId here — it's re-set on the next edit and read by the row's
    // unmount-commit, which runs AFTER this pre-flush watcher.
    void inline.saveAndClose();
  }
);

const category = computed(() => (list.value ? getListCategory(list.value.category) : undefined));

function setCategory(value: ListCategory): void {
  if (list.value) void listStore.updateList(list.value.id, { category: value });
  editingCategory.value = false;
}
function setOwner(value: string | string[]): void {
  const id = Array.isArray(value) ? value[0] : value;
  if (list.value && id) void listStore.updateList(list.value.id, { ownerId: id });
  editingOwner.value = false;
}

// Repeats / frequency / due date
const lifecycleOptions = computed(() => [
  { value: 'oneoff', label: t('lists.detail.oneoff') },
  { value: 'recurring', label: t('lists.detail.recurring') },
]);
function setLifecycle(value: string): void {
  // The store owns the full lifecycle patch (clears the completion triple +
  // sets/clears recurrence fields) — see listStore.setLifecycle.
  if (list.value) void listStore.setLifecycle(list.value.id, value as ListLifecycle);
}
/**
 * The reset cadence the picker is bound to (#70). Reads the canonical `cadence`
 * when present, else the legacy `frequency`, via the one shared resolver — and
 * anchors on the SAME date the reset engine uses, so the control and the
 * behaviour can never derive from different days.
 */
const resetAnchor = computed(() => (list.value ? extractDatePart(list.value.createdAt) : ''));
/**
 * Locally-owned picker model.
 *
 * The picker must be driven by a ref it also writes back to (real `v-model`),
 * NOT by a computed reading straight from the store. Two reasons, both bugs
 * found in review:
 *
 *  - Its echo guard compares `JSON.stringify`, and a store round-trip
 *    reconstructs the object with a different KEY ORDER (`{...cadence, end}`
 *    vs the picker's `{unit, interval, end, weekdays}`). The guard never fired,
 *    so `syncFromModel` re-ran on every write and snapped the UI out of Custom
 *    mode under the user's finger.
 *  - The picker emits on every keystroke of the interval stepper. Writing
 *    straight through made walking 2 -> 12 weeks ten Automerge mutations, each
 *    re-encrypting and re-queuing the `.beanpod` for Drive.
 *
 * So: hold the rule locally, and persist only when the CADENCE actually changed.
 */
const resetRule = ref<RecurrenceRule | null>(null);
// Track the list's OWN cadence, not just its id: the id does not change when
// `setLifecycle` flips one-off -> recurring, so keying on the id alone left
// `resetRule` null at the moment the picker mounted. The picker then published
// its monthly DEFAULT through `setCadence` with no user input, overwriting the
// `frequency: 'weekly'` that `setLifecycle` had just written — and clearing the
// legacy shadow, which `automergeRepository.update` treats as a key DELETE. A
// list the family asked to reset weekly silently began resetting monthly, and
// pre-#70 clients stopped resetting it at all. Reset is destructive and has no
// undo, so this must never happen without an explicit user choice.
watch(
  () =>
    [list.value?.id, list.value?.lifecycle, list.value?.frequency, list.value?.cadence] as const,
  () => {
    resetRule.value = list.value ? (resolveListRule(list.value)?.rule ?? null) : null;
  },
  { immediate: true, deep: true }
);

function cadenceOf(rule: RecurrenceRule): Cadence {
  const cadence: Cadence = { ...rule };
  delete (cadence as { end?: unknown }).end;
  return cadence;
}

function setCadence(rule: RecurrenceRule): void {
  // `RecurrencePicker` emits its DEFAULT on mount when it starts from nothing,
  // so a form saved without touching the control still carries a rule (#70).
  // For a list that is the wrong thing to persist: a reset is destructive and
  // has no undo, so a schedule must only ever change on a real user choice.
  // An emit arriving while our model is still null IS that mount default —
  // seed the local ref from it so the control renders, but write nothing. Any
  // subsequent emit has a seeded model behind it and is a genuine change.
  const wasSeeded = resetRule.value !== null;
  resetRule.value = rule;
  if (!list.value || !wasSeeded) return;
  const cadence = cadenceOf(rule);
  const current = resolveListRule(list.value)?.rule;
  // Compare the CADENCE, field by field via a stable key order, so an
  // equivalent object with different key order is not a write.
  if (current && stableCadenceKey(cadenceOf(current)) === stableCadenceKey(cadence)) return;
  void listStore.updateList(list.value.id, {
    cadence,
    // Legacy shadow for pre-#70 clients — deliberately `undefined` for any
    // cadence the three-value enum can't express exactly, so an old client
    // never resets (safe) rather than over-resetting (destroys ticks).
    frequency: listShadowFromCadence(cadence),
  });
}

/** Order-independent identity for a cadence. */
function stableCadenceKey(c: Cadence): string {
  return JSON.stringify([
    c.unit,
    c.interval,
    [...(c.weekdays ?? [])].sort((a, b) => a - b),
    c.monthlyAnchor ?? null,
    c.monthlyDay ?? null,
  ]);
}
function setDueDate(value: string): void {
  if (list.value) void listStore.updateList(list.value.id, { dueDate: value || undefined });
}

// Meta-band due / recurrence pill text
const recurrenceText = computed(() => {
  const l = list.value;
  if (!l || !isRecurring(l)) return '';
  // #70: regenerate from the canonical cadence so "every 2 weeks" reads
  // correctly instead of collapsing to the nearest legacy word.
  const resolved = resolveListRule(l);
  return resolved ? describe(resolved.rule, resolved.anchor) : '';
});
const dueText = computed(() => {
  const l = list.value;
  if (!l || isRecurring(l) || !l.dueDate) return '';
  return fillTemplate(t('lists.status.due'), { date: formatDateShort(l.dueDate) });
});

// Items
function toggleItem(itemId: string): void {
  if (list.value) void listStore.toggleItem(list.value.id, itemId, meId.value);
}
function removeItem(itemId: string): void {
  if (list.value) void listStore.removeItem(list.value.id, itemId);
}
const newItem = ref('');
function addItem(): void {
  const title = newItem.value.trim();
  if (list.value && title) {
    void listStore.addItem(list.value.id, title);
    newItem.value = '';
  }
}

// ── Linking to a trip / activity ──────────────────────────────────────────
// Both lists keep their soonest date (for the row label) and are searchable.
const linkSearch = ref('');
const upcomingTrips = computed(() =>
  vacationStore.upcomingVacations.map((v) => ({ id: v.id, name: v.name, date: v.startDate }))
);
// Each linkable activity once, by its next occurrence ≥ today (indefinite
// future for one-offs) — distinct by construction in the store, so no de-dupe.
const linkableActivityOptions = computed(() =>
  activityStore.linkableActivities.map(({ activity, date }) => ({
    id: activity.id,
    title: activity.title,
    date,
  }))
);
const matches = (text: string) =>
  text.toLowerCase().includes(linkSearch.value.trim().toLowerCase());
const filteredTrips = computed(() => upcomingTrips.value.filter((tr) => matches(tr.name)));
// Trips (filteredTrips) are naturally few and stay uncapped; activities can be
// many, so we bound the rendered rows — but AFTER the search filter, so search
// always reaches the full list (never re-creating a milder version of the bug
// this picker was fixed for).
const LINK_PICKER_MAX_ACTIVITIES = 50;
const filteredActivities = computed(() =>
  linkableActivityOptions.value.filter((a) => matches(a.title)).slice(0, LINK_PICKER_MAX_ACTIVITIES)
);
// Resolve the linked entity's name from the FULL store collections (not the
// windowed `upcoming*` pickers), so a link to a past / far-future / filtered
// trip or activity still shows its name instead of a blank chip.
const linkedTripName = computed(() => {
  const id = list.value?.linkedVacationId;
  return id ? (vacationStore.vacations.find((v) => v.id === id)?.name ?? '') : '';
});
const linkedActivityName = computed(() => {
  const id = list.value?.linkedActivityId;
  return id ? (activityStore.activities.find((a) => a.id === id)?.title ?? '') : '';
});
function openLinkPicker(kind: 'trip' | 'activity'): void {
  linkSearch.value = '';
  editingLink.value = editingLink.value === kind ? null : kind;
}
function linkTrip(id: string): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedVacationId: id });
  editingLink.value = null;
}
function linkActivity(id: string): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedActivityId: id });
  editingLink.value = null;
}
const shortDate = (d?: string): string => (d ? formatDateShort(d) : '');
function unlinkTrip(): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedVacationId: undefined });
}
function unlinkActivity(): void {
  if (list.value) void listStore.updateList(list.value.id, { linkedActivityId: undefined });
}

async function handleDelete(): Promise<void> {
  const l = list.value;
  if (!l) return;
  const ok = await showConfirm({
    title: 'lists.detail.deleteConfirm.title',
    message: 'lists.detail.deleteConfirm.message',
    variant: 'danger',
  });
  if (!ok) return;
  await listStore.deleteList(l.id);
  emit('deleted', l.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    v-if="list"
    variant="drawer"
    :layer="stacked ? 'overlay' : 'base'"
    :open="true"
    :title="list.title"
    :icon="list.emoji"
    icon-bg="var(--tint-orange-12)"
    size="narrow"
    :save-label="t('action.close')"
    save-gradient="orange"
    :show-delete="true"
    @close="onClose"
    @save="onClose"
    @delete="handleDelete"
  >
    <!-- Inline-editable list title (additive slot; fallback is the static title). -->
    <template #title-content>
      <!-- EDITING: input + explicit save/cancel (pointerdown.prevent so a ✕
           cancel isn't pre-empted by the input's blur-to-save). -->
      <div v-if="inline.isEditing('title')" class="flex items-center gap-2">
        <input
          ref="titleInputRef"
          v-model="draftTitle"
          type="text"
          class="font-outfit dark:text-ink min-w-0 flex-1 border-b border-[var(--color-primary-500)] bg-transparent text-lg font-bold text-[var(--color-text)] outline-none"
          :placeholder="t('lists.detail.titlePlaceholder')"
          :aria-label="t('lists.detail.editTitle')"
          @keyup.enter="inline.saveField('title')"
          @keyup.esc="inline.cancelEdit"
          @blur="onTitleBlur"
        />
        <!-- Save only (✓). No ✕ here — it would sit right beside the drawer's
             close ✕ and read as two cancels. Cancel a title edit with Esc (or
             tap away, which saves, consistent with the item rows). -->
        <button
          type="button"
          class="flex-shrink-0 text-base text-[var(--color-primary-500)] transition-opacity hover:opacity-80"
          :aria-label="t('action.save')"
          @pointerdown.prevent
          @click="inline.saveField('title')"
        >
          <span aria-hidden="true">✓</span>
        </button>
      </div>
      <!-- DISPLAY: tappable title + a faint pencil hint that it can be edited. -->
      <button
        v-else
        type="button"
        class="group/title flex w-full items-center gap-2 text-left"
        :aria-label="t('lists.detail.editTitle')"
        @click="startTitleEdit"
      >
        <span class="min-w-0 truncate">{{ list.title }}</span>
        <span
          class="flex-shrink-0 text-sm font-normal text-[var(--color-text-muted)] opacity-40 transition-opacity group-hover/title:opacity-100"
          aria-hidden="true"
          >✎</span
        >
      </button>
    </template>

    <div class="space-y-4">
      <!-- Meta band: category · owner · due/recurrence (pills, never a dropdown) -->
      <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3.5">
        <button type="button" class="mb-pill" @click="editingCategory = !editingCategory">
          <span class="h-2 w-2 rounded-full" :style="{ backgroundColor: category?.color }" />
          {{ categoryLabel(list.category) }}
        </button>
        <button type="button" class="mb-pill" @click="editingOwner = !editingOwner">
          <MemberChip :member-id="list.ownerId" size="dot" />
          {{ getMemberName(list.ownerId, '') }}
        </button>
        <span v-if="dueText" class="mb-pill mb-due"
          ><span aria-hidden="true">📅</span> {{ dueText }}</span
        >
        <span v-else-if="recurrenceText" class="mb-pill mb-recur"
          ><span aria-hidden="true">🔁</span> {{ recurrenceText }}</span
        >
      </div>

      <!-- Inline category picker (pills) -->
      <ListCategoryPills
        v-if="editingCategory"
        :model-value="list.category"
        @update:model-value="(id) => id && setCategory(id)"
      />
      <!-- Inline owner picker -->
      <FamilyChipPicker
        v-if="editingOwner"
        :model-value="list.ownerId"
        mode="single"
        compact
        @update:model-value="setOwner"
      />

      <!-- Items — draggable to reorder. One-way bound (`:list` + `@change`):
           vuedraggable does the visual drag; the move routes through the store
           (`reorderItems`) which re-renders authoritatively. NEVER mutate
           `list.items` in place (it's the Automerge projection). -->
      <div>
        <draggable
          v-model="itemsDraft"
          item-key="id"
          handle=".drag-handle"
          :animation="prefersReducedMotion ? 0 : 160"
          ghost-class="list-row-ghost"
          @change="onItemMove"
        >
          <template #item="{ element: item }">
            <ListItemRow
              :item="item"
              removable
              editable
              draggable
              :editing="inline.isEditing(`item:${item.id}`)"
              @toggle="toggleItem"
              @remove="removeItem"
              @edit-start="inline.startEdit(`item:${item.id}`)"
              @edit-save="(text: string) => onItemEditSave(item.id, text)"
              @edit-cancel="inline.cancelEdit"
            />
          </template>
        </draggable>
        <div class="mt-2">
          <BaseInput
            v-model="newItem"
            :placeholder="t('lists.detail.addItem')"
            @keyup.enter="addItem"
          />
        </div>
      </div>

      <!-- Repeats? -->
      <div class="setsec">
        <p class="lbl">{{ t('lists.detail.repeatsLabel') }}</p>
        <TogglePillGroup
          :model-value="isRecurring(list) ? 'recurring' : 'oneoff'"
          :options="lifecycleOptions"
          @update:model-value="setLifecycle"
        />
        <!-- (#70) The same control money and the planner use, in reset mode:
             it says "Resets", hides the "ends" selector (a reset has no end),
             and carries its own live summary — so the old static hint below it
             is gone. The one-off/recurring toggle above is the LIFECYCLE and is
             deliberately untouched. -->
        <template v-if="isRecurring(list)">
          <div class="mt-2">
            <RecurrencePicker
              :model-value="resetRule"
              :start-date="resetAnchor"
              mode="reset"
              accent="purple"
              @update:model-value="setCadence"
            />
          </div>
        </template>
      </div>

      <!-- Due date (one-off only) -->
      <div v-if="!isRecurring(list)" class="setsec">
        <p class="lbl">{{ t('lists.detail.dueDateLabel') }}</p>
        <BeanieDatePicker :model-value="list.dueDate ?? ''" @update:model-value="setDueDate" />
      </div>

      <!-- Link -->
      <div class="setsec">
        <p class="lbl">{{ t('lists.detail.linkLabel') }}</p>
        <div class="flex flex-wrap gap-2">
          <span v-if="list.linkedVacationId" class="link-chip">
            <span aria-hidden="true">✈️</span>
            {{ fillTemplate(t('lists.detail.linkedToTrip'), { name: linkedTripName }) }}
            <button
              type="button"
              class="unlink"
              :aria-label="t('lists.detail.unlink')"
              @click="unlinkTrip"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </span>
          <button v-else type="button" class="linkpill" @click="openLinkPicker('trip')">
            <span aria-hidden="true">✈️</span> {{ t('lists.detail.linkTrip') }}
          </button>

          <span v-if="list.linkedActivityId" class="link-chip">
            <span aria-hidden="true">📅</span>
            {{ fillTemplate(t('lists.detail.linkedToActivity'), { name: linkedActivityName }) }}
            <button
              type="button"
              class="unlink"
              :aria-label="t('lists.detail.unlink')"
              @click="unlinkActivity"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </span>
          <button v-else type="button" class="linkpill" @click="openLinkPicker('activity')">
            <span aria-hidden="true">📅</span> {{ t('lists.detail.linkActivity') }}
          </button>
        </div>

        <!-- Trip picker: search + scrollable list with dates -->
        <div v-if="editingLink === 'trip'" class="mt-2">
          <BaseInput
            v-model="linkSearch"
            :placeholder="t('lists.detail.linkSearch')"
            class="mb-1.5"
          />
          <p v-if="!upcomingTrips.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noUpcomingTrips') }}
          </p>
          <p v-else-if="!filteredTrips.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noMatches') }}
          </p>
          <div class="max-h-44 space-y-1 overflow-y-auto">
            <button
              v-for="trip in filteredTrips"
              :key="trip.id"
              type="button"
              class="picker-row"
              @click="linkTrip(trip.id)"
            >
              <span aria-hidden="true">✈️</span>
              <span class="flex-1 truncate">{{ trip.name }}</span>
              <span v-if="trip.date" class="text-xs text-[var(--color-text-muted)]">{{
                shortDate(trip.date)
              }}</span>
            </button>
          </div>
        </div>
        <!-- Activity picker: search + scrollable list with dates -->
        <div v-else-if="editingLink === 'activity'" class="mt-2">
          <BaseInput
            v-model="linkSearch"
            :placeholder="t('lists.detail.linkSearch')"
            class="mb-1.5"
          />
          <p v-if="!linkableActivityOptions.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noUpcomingActivities') }}
          </p>
          <p v-else-if="!filteredActivities.length" class="text-xs text-[var(--color-text-muted)]">
            {{ t('lists.detail.noMatches') }}
          </p>
          <div class="max-h-44 space-y-1 overflow-y-auto">
            <button
              v-for="act in filteredActivities"
              :key="act.id"
              type="button"
              class="picker-row"
              @click="linkActivity(act.id)"
            >
              <span aria-hidden="true">📅</span>
              <span class="flex-1 truncate">{{ act.title }}</span>
              <span class="text-xs text-[var(--color-text-muted)]">{{ shortDate(act.date) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>

<style scoped>
.mb-pill {
  align-items: center;
  background: #fff;
  border-radius: 999px;
  box-shadow: var(--card-shadow, 0 4px 20px rgb(44 62 80 / 5%));
  color: var(--color-text);
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 0.375rem;
  padding: 0.375rem 0.6875rem;
}

html.dark .mb-pill {
  /* surface-overlay: --color-surface now equals the modal panel's own
     surface-raised, so these would vanish into it. */
  background: #26343f;
}

.mb-due {
  background: linear-gradient(135deg, var(--color-primary-500), #e67e22);
  color: #fff;
  font-weight: 700;
}

.mb-recur {
  background: var(--tint-purple-12, rgb(155 89 182 / 12%));
  color: #7c3aed;
}

.setsec {
  background: #fff;
  border-radius: 1rem;
  box-shadow: var(--card-shadow, 0 4px 20px rgb(44 62 80 / 5%));
  padding: 0.75rem 0.875rem;
}

html.dark .setsec {
  /* surface-overlay: --color-surface now equals the modal panel's own
     surface-raised, so these would vanish into it. */
  background: #26343f;
}

.lbl {
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  margin-bottom: 0.5625rem;
  text-transform: uppercase;
}

.linkpill,
.link-chip {
  align-items: center;
  background: var(--tint-slate-5, rgb(44 62 80 / 5%));
  border-radius: 999px;
  color: var(--color-text-muted);
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
}

.link-chip {
  background: rgb(42 157 143 / 12%);
  color: #2a9d8f;
}

.unlink {
  margin-left: 0.25rem;
  opacity: 0.7;
}

.picker-row {
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  color: var(--color-text);
  display: flex;
  font-size: 0.82rem;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
  width: 100%;
}

/* Drag placeholder while reordering an item (heritage-orange ring + lift). */
.list-row-ghost {
  background: var(--tint-orange-12);
  border-radius: 0.5rem;
  box-shadow: 0 0 0 2px var(--color-primary-500);
  opacity: 0.9;
}
</style>
