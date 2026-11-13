<script setup lang="ts">
/**
 * The choreboard (#146): chores in their own place, by time of day. Two views:
 *
 *  - HOME (grown-ups): one card per bean with today's count, the block happening now open and
 *    tickable; Hours and ONE Add Chores (the sheet, for one chore or a whole set); the "No one's"
 *    group for chores whose people have left the family; the "Week so far" panel; an empty state.
 *  - A BEAN'S DAY (`?bean=<id>`): "Now" first and biggest, later blocks quieter, the all-done
 *    banner, the "This week" row. A child always lands on their own day. For a grown-up it is
 *    also where the bean's chores are edited (each row's pencil, the card's Edit Chores lands
 *    here): an "Other Days" list holds the chores not on today, and Select deletes several at once
 *    (`choreStore.removeChoresForMember`, one change, for this bean only).
 *
 * Every "add" (the header, the empty state, a bean's "+", a bean's day, Quick Add) opens the Add
 * Chores sheet, with that bean preselected when there is one. `ChoreFormModal` is the edit screen.
 *
 * MVO: everything read comes from `choreStore` (the one read model, `choreDayFor`); every
 * write is an intent to it, ticks through `useChoreTicks` (the page's in-flight guard). The
 * store toasts and reports every failure and refusal once, so this page never toasts again.
 *
 * §8 query guards (the page is the only reader of its query):
 *  - a non-adult's `?bean=` is forced to their own id;
 *  - a grown-up's unknown or pet `?bean=` falls back to home (and is stripped);
 *  - `?starter=<set>&for=<ids>` (the Beanie Lists redirect) opens Add Chores with that set added,
 *    for grown-ups only: the set must be a known key, `for` is filtered to living people, and
 *    both are stripped after reading (ignored and stripped for a non-adult).
 * Each guard that changes the URL logs `query-guarded` with its reason, so a report of "the
 * link opened the wrong thing" can be read from the firehose.
 *
 * Dark mode: the page sits on `surface-ground`; cards and the day's sections are
 * `surface-raised` (line edges), rows `surface-overlay`. Block colours come from
 * `.chore-block-*` in `src/style.css`; accent text pairs with its `-lift`.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ChoreBeanCard from '@/components/chores/ChoreBeanCard.vue';
import ChoreBlockSection from '@/components/chores/ChoreBlockSection.vue';
import ChoreRow from '@/components/chores/ChoreRow.vue';
import ChoreWeekRow from '@/components/chores/ChoreWeekRow.vue';
import ChoreWeekPanel from '@/components/chores/ChoreWeekPanel.vue';
import ChoreFormModal from '@/components/chores/ChoreFormModal.vue';
import ChoreAddSheet from '@/components/chores/ChoreAddSheet.vue';
import ChoreCopyModal from '@/components/chores/ChoreCopyModal.vue';
import ChoreHoursModal from '@/components/chores/ChoreHoursModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useChoreClock } from '@/composables/useChoreClock';
import { useChoreTicks } from '@/composables/useChoreTicks';
import { usePermissions } from '@/composables/usePermissions';
import { useChoreStore } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { choreStarterSet, type ChoreStarterSetKey } from '@/constants/choreStarterSets';
import {
  blocksInDisplayOrder,
  choreBlockRank,
  choreOccursOn,
  currentBlock,
  livingAssignees,
  type ChoreDayBlock,
} from '@/utils/chores';
import { firstName as firstWord } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatTime12 } from '@/utils/date';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const choreStore = useChoreStore();
const { choreClock } = useChoreClock();
const ticks = useChoreTicks();
const { memberAvatarBindings } = useMemberAvatarBindings();

onMounted(() => {
  // The boot sequence loads chores; this covers a page reached before that finished.
  if (!choreStore.isLoaded) void choreStore.loadChores();
});

const me = computed(() => familyStore.currentMember);
const { isAdult } = usePermissions();
const rosterReady = computed(() => familyStore.members.length > 0);

// ── §8 query guards ─────────────────────────────────────────────────────────

function logGuard(detail: string): void {
  logEvent({ level: 'info', surface: 'choreboard', message: 'query-guarded', context: { detail } });
}

const firstString = (v: LocationQuery[string]): string =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '';

/** `?for=a,b` or `?for=a&for=b`, kept to living people (never pets), deduped. */
function livingFor(v: LocationQuery[string]): string[] {
  const raw = (Array.isArray(v) ? v : [v]).flatMap((x) =>
    typeof x === 'string' ? x.split(',') : []
  );
  return [...new Set(raw.map((s) => s.trim()).filter((id) => choreStore.livingIds.has(id)))];
}

function applyQueryGuards(): void {
  // Nothing can be validated until we know who is here and who the family is.
  if (!rosterReady.value || !me.value) return;
  const q = route.query;
  const next: LocationQuery = { ...q };
  let changed = false;

  if (q.starter !== undefined || q.for !== undefined) {
    if (isAdult.value) {
      const key = firstString(q.starter);
      const set = choreStarterSet(key);
      if (set) {
        const forIds = livingFor(q.for);
        openAddChores(forIds, set.key, forIds.length > 0);
      } else {
        logGuard('starter-invalid');
      }
    } else {
      logGuard('starter-not-adult');
    }
    delete next.starter;
    delete next.for;
    changed = true;
  }

  if (!isAdult.value) {
    if (q.bean !== me.value.id) {
      if (q.bean !== undefined) logGuard('child-own-day');
      next.bean = me.value.id;
      changed = true;
    }
  } else if (q.bean !== undefined && !choreStore.livingIds.has(firstString(q.bean))) {
    logGuard('unknown-bean');
    delete next.bean;
    changed = true;
  }

  if (changed) void router.replace({ query: next });
}

/** The bean whose day is showing, or `null` for home. Correct before the URL rewrite lands. */
const viewBeanId = computed<string | null>(() => {
  if (!isAdult.value) return me.value && !me.value.isPet ? me.value.id : null;
  const b = firstString(route.query.bean);
  return b && choreStore.livingIds.has(b) ? b : null;
});

// ── Modals (grown-ups only) ─────────────────────────────────────────────────

const formOpen = ref(false);
const formChoreId = ref<string | null>(null);
/** The bean whose card or day the edit was opened from (the form's "only for them" delete). */
const formBeanId = ref<string | null>(null);
const starterOpen = ref(false);
const starterKey = ref<ChoreStarterSetKey | null>(null);
const starterFor = ref<string[]>([]);
const starterCarried = ref(false);
/** ONE ref drives the copy modal; `:open` is derived from it. */
const copySourceId = ref<string | null>(null);
const hoursOpen = ref(false);

function openEditChore(choreId: string, beanId: string | null = null): void {
  if (!isAdult.value) return;
  formChoreId.value = choreId;
  formBeanId.value = beanId;
  formOpen.value = true;
}

/**
 * The ONE way to add chores: the Add Chores sheet. `forIds` preselects who (only them); `key`
 * puts a suggestion set straight on the list (the Beanie Lists redirect, `carried`).
 */
function openAddChores(
  forIds: string[] = [],
  key: ChoreStarterSetKey | null = null,
  carried = false
): void {
  if (!isAdult.value) return;
  starterKey.value = key;
  starterFor.value = forIds;
  starterCarried.value = carried;
  starterOpen.value = true;
}

function openCopy(memberId: string): void {
  if (isAdult.value) copySourceId.value = memberId;
}

// Declared after the modal refs on purpose: the immediate run can open the Add Chores sheet.
watch(
  () => [route.query, me.value?.id, isAdult.value, rosterReady.value] as const,
  applyQueryGuards,
  { immediate: true }
);

// Quick-Add deep link (`/choreboard?action=add-chore`), grown-ups only.
useQuickAddIntent((action) => {
  if (action === 'add-chore') openAddChores(viewBeanId.value ? [viewBeanId.value] : []);
});

// ── Ticking ─────────────────────────────────────────────────────────────────

function canTickFor(memberId: string): boolean {
  return isAdult.value || me.value?.id === memberId;
}

function onToggle(choreId: string, memberId: string): void {
  void ticks.toggle(choreId, memberId);
}

/**
 * A grown-up dragged a block's chores into a new order (the store refuses anyone else). Resolves
 * whether it landed, so the section can put its rows back when it did not.
 */
async function onReorder(choreIds: string[]): Promise<boolean> {
  const actorId = me.value?.id;
  if (!actorId) return false;
  return (await choreStore.reorderChores(choreIds, actorId)) === true;
}

const pendingFor = (memberId: string) => (choreId: string) => ticks.isPending(choreId, memberId);

// ── Shared reads ────────────────────────────────────────────────────────────

const starts = computed(() => choreStore.starts);
const nowBlock = computed(() => currentBlock(choreClock.value.hhmm, starts.value));
const nowMeta = computed(() => CHORE_BLOCK_META[nowBlock.value]);
const nowUntil = computed(() => {
  const end =
    nowBlock.value === 'morning'
      ? starts.value.afternoon
      : nowBlock.value === 'afternoon'
        ? starts.value.evening
        : '';
  return end ? fillTemplate(t('choreboard.now.until'), { time: formatTime12(end) }) : '';
});

/** Members with at least one chore on some day (a living assignee). */
const choreOwners = computed(() => {
  const ids = new Set<string>();
  for (const c of choreStore.chores) for (const id of c.assigneeIds ?? []) ids.add(id);
  return ids;
});

const firstName = (m: FamilyMember) => firstWord(m.name) || m.name;

// ── Home ────────────────────────────────────────────────────────────────────

const homeBeans = computed(() => {
  const humans = familyStore.sortedHumans;
  const withChores = humans.filter((m) => choreOwners.value.has(m.id));
  const without = humans.filter((m) => !choreOwners.value.has(m.id));
  return [...withChores, ...without].map((member) => ({
    member,
    day: choreStore.choreDayFor(member.id),
    hasAnyChores: choreOwners.value.has(member.id),
  }));
});

const isEmpty = computed(() => choreStore.isLoaded && choreStore.chores.length === 0);

const weekRows = computed(() =>
  familyStore.sortedHumans
    .map((member) => ({ member, week: choreStore.weekFor(member.id) }))
    .filter((r) => choreOwners.value.has(r.member.id) || r.week.total > 0)
);

function openDay(memberId: string): void {
  void router.push({ query: { ...route.query, bean: memberId } });
}

function backHome(): void {
  const next: LocationQuery = { ...route.query };
  delete next.bean;
  void router.push({ query: next });
}

// ── A bean's day ────────────────────────────────────────────────────────────

const dayMember = computed(() =>
  viewBeanId.value ? familyStore.members.find((m) => m.id === viewBeanId.value) : undefined
);
const day = computed(() => (viewBeanId.value ? choreStore.choreDayFor(viewBeanId.value) : null));
const dayTotal = computed(() => day.value?.blocks.reduce((n, b) => n + b.total, 0) ?? 0);
const dayDone = computed(() => dayTotal.value - (day.value?.left ?? 0));
const dayPct = computed(() =>
  dayTotal.value ? Math.round((dayDone.value / dayTotal.value) * 100) : 0
);
const dayHasAnyChores = computed(
  () => !!viewBeanId.value && choreOwners.value.has(viewBeanId.value)
);

interface DaySection {
  block: ChoreDayBlock;
  open: boolean;
  celebrate: boolean;
}

/**
 * The one display order (`blocksInDisplayOrder`): now first and biggest, then Anytime, both open;
 * then later blocks and the ones whose time has passed, quiet.
 */
const daySections = computed<DaySection[]>(() =>
  blocksInDisplayOrder((day.value?.blocks ?? []).filter((b) => b.total > 0)).map((block) => {
    const open = choreBlockRank(block) < 2;
    return { block, open, celebrate: open };
  })
);

const greeting = computed(() => {
  const m = dayMember.value;
  if (!m) return '';
  const key =
    nowBlock.value === 'morning'
      ? 'choreboard.day.greeting.morning'
      : nowBlock.value === 'afternoon'
        ? 'choreboard.day.greeting.afternoon'
        : 'choreboard.day.greeting.evening';
  return fillTemplate(t(key), { name: firstName(m) });
});

const dayEmptyText = computed(() => {
  const m = dayMember.value;
  if (!m) return '';
  if (!isAdult.value) {
    return t(dayHasAnyChores.value ? 'choreboard.empty.childToday' : 'choreboard.empty.child');
  }
  return fillTemplate(
    t(dayHasAnyChores.value ? 'choreboard.empty.forBeanToday' : 'choreboard.empty.forBean'),
    { name: firstName(m) }
  );
});

const dayWeek = computed(() => (viewBeanId.value ? choreStore.weekFor(viewBeanId.value) : null));

/** The bean's chores that are not on today (other weekdays): grown-ups edit them from here. */
const otherDayChores = computed(() => {
  const id = viewBeanId.value;
  if (!id || !isAdult.value) return [];
  return choreStore.sortedChores.filter(
    (c) =>
      livingAssignees(c, choreStore.livingIds).includes(id) &&
      !choreOccursOn(c, choreClock.value.ymd)
  );
});

// ── Select and delete (grown-ups, a bean's day) ─────────────────────────────

const selecting = ref(false);
const selectedIds = ref<string[]>([]);
const deleting = ref(false);

/** Every chore on the bean's day a grown-up can select: today's, then Other Days. */
const selectableIds = computed(() => [
  ...daySections.value.flatMap((s) => s.block.chores.map((i) => i.chore.id)),
  ...otherDayChores.value.map((c) => c.id),
]);
const allSelected = computed(
  () =>
    selectableIds.value.length > 0 &&
    selectableIds.value.every((id) => selectedIds.value.includes(id))
);

function startSelecting(): void {
  if (!isAdult.value) return;
  selectedIds.value = [];
  selecting.value = true;
}

function stopSelecting(): void {
  selecting.value = false;
  selectedIds.value = [];
}

function toggleSelected(choreId: string): void {
  selectedIds.value = selectedIds.value.includes(choreId)
    ? selectedIds.value.filter((id) => id !== choreId)
    : [...selectedIds.value, choreId];
}

function toggleSelectAll(): void {
  selectedIds.value = allSelected.value ? [] : [...selectableIds.value];
}

// Leaving the day (or the roster moving under it) ends select mode; a chore that left the day
// (deleted on another device) leaves the selection, so the count never names a ghost.
watch(viewBeanId, stopSelecting);
watch(selectableIds, (ids) => {
  if (selectedIds.value.some((id) => !ids.includes(id))) {
    selectedIds.value = selectedIds.value.filter((id) => ids.includes(id));
  }
});

const deleteSelectedLabel = computed(() =>
  fillTemplate(
    t(
      selectedIds.value.length === 1
        ? 'choreboard.day.deleteSelected.one'
        : 'choreboard.day.deleteSelected.other'
    ),
    { count: selectedIds.value.length }
  )
);

/** One confirm, one store change: the selected chores come off THIS bean's board. */
async function deleteSelected(): Promise<void> {
  const beanId = viewBeanId.value;
  const actorId = me.value?.id;
  const ids = [...selectedIds.value];
  if (!beanId || !actorId || !ids.length || deleting.value || !isAdult.value) return;
  const ok = await confirm({
    title: 'choreboard.day.deleteConfirm.title',
    message: 'choreboard.day.deleteConfirm.message',
    detail: fillTemplate(
      t(
        ids.length === 1
          ? 'choreboard.day.deleteConfirm.detail.one'
          : 'choreboard.day.deleteConfirm.detail.other'
      ),
      { count: ids.length, name: dayMember.value ? firstName(dayMember.value) : '' }
    ),
    variant: 'danger',
  });
  if (!ok) return;
  deleting.value = true;
  try {
    const result = await choreStore.removeChoresForMember(ids, beanId, actorId);
    // null: the store has already toasted the refusal or the failed write. Stay in select mode.
    if (!result) return;
    const n = result.deleted + result.unassigned;
    showToast(
      'success',
      fillTemplate(t(n === 1 ? 'choreboard.day.deleted.one' : 'choreboard.day.deleted.other'), {
        count: n,
      })
    );
    stopSelecting();
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6" data-testid="choreboard-page">
    <!-- ═══ A bean's day ═══ -->
    <template v-if="viewBeanId && dayMember && day">
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="isAdult"
          type="button"
          class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 inline-flex items-center gap-1.5 rounded-2xl border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          data-testid="chore-day-back"
          @click="backHome"
        >
          <span aria-hidden="true">←</span>
          {{ t('choreboard.day.back') }}
        </button>
        <span class="flex-1" />
        <template v-if="isAdult && !selecting">
          <button
            v-if="selectableIds.length"
            type="button"
            class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 rounded-2xl border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-day-select"
            @click="startSelecting"
          >
            {{ t('choreboard.day.select') }}
          </button>
          <button
            v-if="dayHasAnyChores"
            type="button"
            class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 rounded-2xl border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-day-copy"
            @click="openCopy(viewBeanId)"
          >
            <span aria-hidden="true">📋</span> {{ t('choreboard.day.copy') }}
          </button>
          <AddEntityButton
            :label="t('choreboard.addChores')"
            data-testid="chore-day-add"
            @click="openAddChores([viewBeanId])"
          />
        </template>
      </div>

      <div
        class="flex items-center gap-3"
        data-testid="chore-day-head"
        :data-member-id="viewBeanId"
      >
        <BeanieAvatar v-bind="memberAvatarBindings(dayMember)" size="xl" />
        <div class="min-w-0 flex-1">
          <h2 class="font-outfit dark:text-ink text-secondary-500 text-2xl leading-tight font-bold">
            {{ greeting }}
          </h2>
          <div v-if="dayTotal > 0" class="mt-2 flex items-center gap-2">
            <span
              class="dark:bg-surface-hover block h-2 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
              role="progressbar"
              :aria-valuenow="dayDone"
              aria-valuemin="0"
              :aria-valuemax="dayTotal"
              :aria-label="
                fillTemplate(t('choreboard.day.progressAria'), { done: dayDone, total: dayTotal })
              "
            >
              <span
                class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r transition-[width] duration-300"
                :style="{ width: `${dayPct}%` }"
              />
            </span>
            <span
              class="font-outfit dark:text-ink-soft text-secondary-400 text-sm font-semibold"
              data-testid="chore-day-count"
              >{{
                fillTemplate(t('choreboard.block.count'), { done: dayDone, total: dayTotal })
              }}</span
            >
          </div>
        </div>
      </div>

      <div
        v-if="daySections.length === 0"
        class="dark:bg-surface-raised dark:border-line rounded-3xl bg-white px-5 py-10 text-center shadow-[var(--card-shadow)] dark:border"
        data-testid="chore-day-empty"
      >
        <img
          src="/brand/beanies_celebrating_line_transparent_560x225.png"
          :alt="t('choreboard.done.imageAlt')"
          class="mx-auto mb-4 w-44"
        />
        <p class="font-outfit dark:text-ink text-secondary-500 text-base font-semibold">
          {{ dayEmptyText }}
        </p>
      </div>

      <div v-else class="flex flex-col gap-3" data-testid="chore-day-sections">
        <ChoreBlockSection
          v-for="s in daySections"
          :key="s.block.block"
          :block="s.block"
          :member-id="viewBeanId"
          :bean-name="firstName(dayMember)"
          variant="day"
          :open="s.open"
          :celebrate="s.celebrate"
          :starts="starts"
          :can-tick="canTickFor(viewBeanId) && !selecting"
          :can-edit="isAdult"
          :is-pending="pendingFor(viewBeanId)"
          :reorderable="isAdult"
          :reorder="onReorder"
          :selecting="selecting"
          :selected-ids="selectedIds"
          @toggle="onToggle($event, viewBeanId)"
          @edit="openEditChore($event, viewBeanId)"
          @select="toggleSelected"
        />
      </div>

      <!-- Chores on other weekdays: not today's to tick, but a grown-up edits them from here. -->
      <section
        v-if="otherDayChores.length"
        class="dark:bg-surface-raised dark:border-line rounded-3xl bg-white p-4 shadow-[var(--card-shadow)] dark:border"
        data-testid="chore-day-other-days"
      >
        <h3 class="font-outfit dark:text-ink text-secondary-500 text-base font-bold">
          {{ t('choreboard.day.otherDays') }}
        </h3>
        <p class="dark:text-ink-soft text-secondary-400 mt-1 mb-3 text-sm">
          {{ t('choreboard.day.otherDaysHint') }}
        </p>
        <div class="flex flex-col gap-1.5">
          <ChoreRow
            v-for="c in otherDayChores"
            :key="c.id"
            :chore="c"
            :member-id="viewBeanId"
            :done="false"
            compact
            :can-tick="false"
            :show-tick="false"
            can-edit
            :selecting="selecting"
            :selected="selectedIds.includes(c.id)"
            @edit="openEditChore(c.id, viewBeanId)"
            @select="toggleSelected(c.id)"
          />
        </div>
      </section>

      <!-- Select mode's bar: Select All, Delete N Chores, Cancel. Clear of the mobile tab bar. -->
      <div
        v-if="selecting"
        class="dark:bg-surface-overlay dark:border-line-strong sticky bottom-24 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border-strong)] bg-white p-3 shadow-[var(--card-shadow)] md:bottom-4"
        data-testid="chore-day-select-bar"
      >
        <button
          type="button"
          class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-sky-silk-300 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          :aria-pressed="allSelected ? 'true' : 'false'"
          data-testid="chore-day-select-all"
          @click="toggleSelectAll"
        >
          {{ t(allSelected ? 'choreboard.day.selectNone' : 'choreboard.day.selectAll') }}
        </button>
        <span class="flex-1" />
        <button
          type="button"
          class="font-outfit dark:text-ink-soft text-secondary-500 focus-visible:ring-sky-silk-300 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          data-testid="chore-day-select-cancel"
          @click="stopSelecting"
        >
          {{ t('action.cancel') }}
        </button>
        <button
          type="button"
          class="font-outfit focus-visible:ring-sky-silk-300 rounded-xl px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:outline-none"
          :class="
            selectedIds.length
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white'
              : 'dark:bg-surface-hover dark:text-ink-soft text-secondary-500 cursor-not-allowed bg-[var(--tint-slate-10)]'
          "
          :disabled="!selectedIds.length || deleting"
          :aria-busy="deleting ? 'true' : undefined"
          data-testid="chore-day-delete-selected"
          @click="deleteSelected"
        >
          {{ deleteSelectedLabel }}
        </button>
      </div>

      <ChoreWeekRow v-if="dayWeek && dayHasAnyChores" :week="dayWeek" :today-ymd="choreClock.ymd" />
    </template>

    <!-- ═══ Home ═══ -->
    <template v-else>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <PageWelcomeSubtitle :text="t('choreboard.welcomeSubtitle')" />
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="font-outfit inline-flex items-center gap-1.5 rounded-full bg-[var(--chore-tint)] px-3 py-1.5 text-sm font-bold text-[var(--chore-ink)]"
            :class="nowMeta.colorClass"
            data-testid="chore-now-pill"
            :data-block="nowBlock"
          >
            <span aria-hidden="true">{{ nowMeta.emoji }}</span>
            {{ fillTemplate(t('choreboard.now.pill'), { block: t(nowMeta.labelKey) }) }}
            <span v-if="nowUntil" class="font-inter text-xs font-medium">{{ nowUntil }}</span>
          </span>
          <template v-if="isAdult">
            <button
              type="button"
              class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 rounded-2xl border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
              data-testid="chore-open-hours"
              @click="hoursOpen = true"
            >
              <span aria-hidden="true">🕐</span> {{ t('choreboard.hours') }}
            </button>
            <AddEntityButton
              :label="t('choreboard.addChores')"
              data-testid="chore-open-add"
              @click="openAddChores()"
            />
          </template>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="isEmpty"
        class="dark:bg-surface-raised dark:border-line rounded-3xl bg-white px-5 py-10 text-center shadow-[var(--card-shadow)] dark:border"
        data-testid="chore-home-empty"
      >
        <img
          src="/brand/beanies_celebrating_line_transparent_560x225.png"
          :alt="t('choreboard.done.imageAlt')"
          class="mx-auto mb-4 w-44"
        />
        <p class="font-outfit dark:text-ink text-secondary-500 text-lg font-bold">
          {{ t('choreboard.empty.title') }}
        </p>
        <p class="dark:text-ink-soft text-secondary-400 mt-1 text-sm">
          {{ isAdult ? t('choreboard.empty.body') : t('choreboard.empty.child') }}
        </p>
        <div v-if="isAdult" class="mt-5 flex justify-center">
          <AddEntityButton
            :label="t('choreboard.addChores')"
            data-testid="chore-empty-starters"
            @click="openAddChores()"
          />
        </div>
      </div>

      <template v-else>
        <div class="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <ChoreBeanCard
            v-for="bean in homeBeans"
            :key="bean.member.id"
            :member="bean.member"
            :day="bean.day"
            :has-any-chores="bean.hasAnyChores"
            :starts="starts"
            :can-tick="canTickFor(bean.member.id)"
            :can-edit="isAdult"
            :is-pending="pendingFor(bean.member.id)"
            @toggle="onToggle($event, bean.member.id)"
            @edit="openEditChore($event, bean.member.id)"
            @open="openDay(bean.member.id)"
            @copy="openCopy(bean.member.id)"
            @add="openAddChores([bean.member.id])"
          />
        </div>

        <!-- Chores whose people have all left the family: re-assign or delete them. -->
        <section
          v-if="isAdult && choreStore.orphans.length"
          class="dark:bg-surface-raised dark:border-line rounded-3xl bg-white p-4 shadow-[var(--card-shadow)] dark:border"
          data-testid="chore-orphans"
        >
          <h2 class="font-outfit dark:text-ink text-secondary-500 text-base font-bold">
            {{ t('choreboard.orphans.title') }}
          </h2>
          <p class="dark:text-ink-soft text-secondary-400 mt-1 mb-3 text-sm">
            {{ t('choreboard.orphans.hint') }}
          </p>
          <div class="flex flex-col gap-1.5">
            <ChoreRow
              v-for="c in choreStore.orphans"
              :key="c.id"
              :chore="c"
              member-id=""
              :done="false"
              compact
              :can-tick="false"
              can-edit
              @edit="openEditChore(c.id)"
            />
          </div>
        </section>

        <ChoreWeekPanel
          v-if="isAdult && weekRows.length"
          :rows="weekRows"
          :today-ymd="choreClock.ymd"
        />
      </template>
    </template>

    <!-- Modals: mounted unconditionally, never `v-if`-gated (they seed on the open transition).
         Only grown-ups can open them (every opener checks), and the store refuses a child. -->
    <ChoreFormModal
      :open="formOpen"
      :chore-id="formChoreId"
      :bean-id="formBeanId"
      @close="formOpen = false"
    />
    <ChoreAddSheet
      :open="starterOpen"
      :preset-key="starterKey"
      :preset-member-ids="starterFor"
      :carried="starterCarried"
      @close="starterOpen = false"
    />
    <ChoreCopyModal
      :open="!!copySourceId"
      :source-member-id="copySourceId"
      @close="copySourceId = null"
    />
    <ChoreHoursModal :open="hoursOpen" @close="hoursOpen = false" />
  </div>
</template>
