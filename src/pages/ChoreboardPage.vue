<script setup lang="ts">
/**
 * The choreboard (#146): chores in their own place, by time of day. Two views:
 *
 *  - HOME (grown-ups): one card per bean with today's count, the block happening now open and
 *    tickable; Hours and ONE Add Chores (the sheet, for one chore or a whole set); the "No one's"
 *    group for chores whose people have left the family; the "Week so far" panel; an empty state.
 *  - A BEAN'S DAY (`?bean=<id>`): the tick view. "Now" first and biggest, later blocks quieter,
 *    the all-done banner, the "This week" row. A child always lands on their own day.
 *
 * Editing is per bean, like a Beanie List: the bean's chore list (`ChoreBeanEditor`, "Pip's
 * Chores") opens from the bean's card (Edit Chores, or "+" when it has none), the day's Edit
 * Chores, a chore's name, and Quick Add on a bean's day. The page header's Add Chores, the empty
 * state and the Beanie Lists redirect open the Add Chores sheet (`ChoreAddSheet`), which adds one
 * list to several beans at once. "No one's" chores (their people have left) have a ✕ each.
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
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import ChoreBeanCard from '@/components/chores/ChoreBeanCard.vue';
import ChoreBlockSection from '@/components/chores/ChoreBlockSection.vue';
import ChoreRow from '@/components/chores/ChoreRow.vue';
import ChoreWeekRow from '@/components/chores/ChoreWeekRow.vue';
import ChoreWeekPanel from '@/components/chores/ChoreWeekPanel.vue';
import ChoreBeanEditor from '@/components/chores/ChoreBeanEditor.vue';
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
  currentBlock,
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

/** The bean whose chore list is open, or `null`. ONE ref drives `ChoreBeanEditor`. */
const editorBeanId = ref<string | null>(null);
const starterOpen = ref(false);
const starterKey = ref<ChoreStarterSetKey | null>(null);
const starterFor = ref<string[]>([]);
const starterCarried = ref(false);
/** ONE ref drives the copy modal; `:open` is derived from it. */
const copySourceId = ref<string | null>(null);
const hoursOpen = ref(false);

/** Open a bean's chore list: grown-ups only, a living person only. */
function openBeanEditor(beanId: string): void {
  if (isAdult.value && choreStore.livingIds.has(beanId)) editorBeanId.value = beanId;
}

/**
 * The Add Chores sheet, for one list to several beans at once. `forIds` preselects who (only
 * them); `key` puts a suggestion set straight on the list (the Beanie Lists redirect, `carried`).
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

// Quick-Add deep link (`/choreboard?action=add-chore`), grown-ups only: on a bean's day, that
// bean's chore list; otherwise the Add Chores sheet.
useQuickAddIntent((action) => {
  if (action !== 'add-chore') return;
  if (viewBeanId.value) openBeanEditor(viewBeanId.value);
  else openAddChores();
});

// ── Ticking ─────────────────────────────────────────────────────────────────

function canTickFor(memberId: string): boolean {
  return isAdult.value || me.value?.id === memberId;
}

function onToggle(choreId: string, memberId: string): void {
  void ticks.toggle(choreId, memberId);
}

/** A "No one's" chore's ✕: it has nobody left, so it is deleted (the store toasts a failure). */
function removeOrphan(choreId: string): void {
  const actorId = me.value?.id;
  if (actorId && isAdult.value) void choreStore.deleteChore(choreId, actorId);
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
        <template v-if="isAdult">
          <button
            v-if="dayHasAnyChores"
            type="button"
            class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 rounded-2xl border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-day-copy"
            @click="openCopy(viewBeanId)"
          >
            <span aria-hidden="true">📋</span> {{ t('choreboard.day.copy') }}
          </button>
          <button
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 focus-visible:ring-sky-silk-300 inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-3.5 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-day-edit"
            @click="openBeanEditor(viewBeanId)"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M16.9 3.6a2.1 2.1 0 0 1 3 3L8.5 18 4 19.5 5.5 15 16.9 3.6Z" />
            </svg>
            {{ t('choreboard.day.edit') }}
          </button>
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
          :can-tick="canTickFor(viewBeanId)"
          :can-edit="isAdult"
          :is-pending="pendingFor(viewBeanId)"
          @toggle="onToggle($event, viewBeanId)"
          @edit="openBeanEditor(viewBeanId)"
        />
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
            @edit-chores="openBeanEditor(bean.member.id)"
            @open="openDay(bean.member.id)"
            @copy="openCopy(bean.member.id)"
          />
        </div>

        <!-- Chores whose people have all left the family: remove the ones not needed. -->
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
              removable
              @remove="removeOrphan(c.id)"
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
    <ChoreBeanEditor
      :open="!!editorBeanId"
      :member-id="editorBeanId"
      @close="editorBeanId = null"
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
