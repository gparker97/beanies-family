<script setup lang="ts">
/**
 * The peripheral cards, in priority order: CHORES first and widest, then
 * to-dos, then tonight's meal and the trip.
 *
 * That order is the argument the whole surface makes. A family hangs a screen
 * in the kitchen for the chore board; the meal and the trip are things you
 * glance at, so they sit right and small. The previous order led with a to-do
 * card and gave chores no card at all, which inverted it.
 *
 * Rendered as a BAND under the calendar in views A and B, and as a RAIL beside
 * it in view C. Same component, same content, two containers: the mockup shows
 * the identical four cards in both places, and forking them was how the band
 * and the rail would have drifted.
 *
 * Every card is a button. A card that looks tappable and isn't was the single
 * loudest complaint about the first cut of this screen.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import WallCard from '@/components/wall/WallCard.vue';
import { useWallPeripherals } from '@/composables/useWallPeripherals';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { isRecurring } from '@/utils/listLifecycle';
import { jobsProgress } from '@/utils/wallJobs';
import type { FamilyList, FamilyMember } from '@/types/models';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

const props = defineProps<{
  /**
   * `band` under the calendar, `rail` beside it — and `strip` when the time grid
   * needs the height back on a busy day. The strip is the SAME content in one
   * row, not a different set of cards: the decision of when to use it is made by
   * `wallPeripheralVariant` from the day's event count, never from the layout
   * result (that would oscillate).
   */
  variant: 'band' | 'rail' | 'strip';
  /** A portrait band gets two columns; four across 800px truncates every label. */
  portrait?: boolean;
  /**
   * The day the MEALS card opens. Named for its one job, not for "today": the today view
   * lets the family page through the week strip, and this rail must open the day they are
   * looking at rather than always the current one. Nothing else here is date-bound — the
   * chore and list cards are today's work by construction and carry no date label.
   */
  mealsYmd: string;
  todosFor: (memberId: string) => WallJob[];
  /** Due-now work nobody has claimed — counted and shown like anyone else's. */
  unassignedTodos: WallJob[];
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  /** The wall's person filter, so the card agrees with the view above it. */
  visibleMemberIds: string[] | null;
}>();
const emit = defineEmits<{ open: [WallSheetTarget]; openChores: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();
const { tonight, trip } = useWallPeripherals();

/** The rail is one column wide, so it shows fewer rows than the band. */
const rows = computed(() => (props.variant === 'band' ? 3 : props.variant === 'rail' ? 2 : 1));

const beans = computed(() => {
  const humans = familyStore.sortedHumans;
  if (!props.visibleMemberIds) return humans;
  const allowed = new Set(props.visibleMemberIds);
  return humans.filter((m) => allowed.has(m.id));
});

/**
 * Progress over the beans the wall is currently showing. Derived here rather
 * than taken from the page so the card cannot contradict the board it links to
 * once a person filter is applied.
 */
const todoProgress = computed(() =>
  jobsProgress([...beans.value.flatMap((m) => props.todosFor(m.id)), ...props.unassignedTodos])
);

/** Only beans who still owe something — a finished bean is not news. */
function outstandingFor(source: (id: string) => WallJob[]) {
  return beans.value
    .map((member) => ({
      member: member as FamilyMember | null,
      jobs: source(member.id).filter((j) => !j.done),
    }))
    .filter((entry) => entry.jobs.length)
    .slice(0, rows.value);
}
const outstandingTodos = computed(() => {
  // Named `entries`, not `rows`: a local `rows` shadowed the `rows` computed
  // above, so the cap that limits this list silently became `slice(0, its own
  // length)` — a no-op.
  const entries = outstandingFor(props.todosFor);
  const loose = props.unassignedTodos.filter((j) => !j.done);
  // Unclaimed work still needs a way in: the card is what opens the drawer, and
  // gating it on assigned counts alone left a family whose only to-do was added
  // at the wall (which creates them unassigned) with no route back to it.
  if (loose.length) entries.push({ member: null, jobs: loose });
  return entries.slice(0, rows.value);
});

/**
 * The rail is a single narrow column carrying all four cards in one screen
 * height, so the lists card gets one row there against four in the band. The
 * mockup's rail dropped the lists card entirely for this reason; one row plus
 * the drill-in keeps it without pushing the card off the bottom.
 */
/**
 * Which cards are on, in priority order, and how much width each earns.
 *
 * Derived rather than hard-coded, because every card is conditional: a fixed
 * four-column template left a hole the day a family had no meal planned, and
 * silently mis-sized everything the day they had five cards.
 */
const CARD_WEIGHTS: Record<string, number> = {
  lists: 1.55,
  todos: 1,
  meals: 0.95,
  trip: 1.2,
};

const visibleCards = computed(() => {
  const on: string[] = [];
  if (visibleLists.value.length) on.push('lists');
  if (todoProgress.value.total) on.push('todos');
  if (tonight.value) on.push('meals');
  if (trip.value) on.push('trip');
  return on;
});

const bandColumns = computed(() =>
  visibleCards.value.map((id) => `${CARD_WEIGHTS[id] ?? 1}fr`).join(' ')
);

/**
 * The SAME list groups the board renders, not the raw store lists.
 *
 * Reading `listStore` directly meant the card and the board could disagree: a
 * list whose only item is also a to-do due today is deduped away on the board,
 * but the card still counted the raw item and showed "0/1" for a list with
 * nothing under it.
 */
const allGroups = computed(() => [
  ...beans.value.flatMap((m) => props.listsFor(m.id)),
  ...props.orphanLists,
]);
const visibleLists = computed(() =>
  allGroups.value.filter((g) => g.jobs.length).slice(0, props.variant === 'rail' ? 1 : 4)
);

/** Whose list this is. A list whose owner we cannot resolve says so, rather
 *  than rendering "'s list" with a hole where the name should be. */
function ownerLabel(list: FamilyList): string {
  const name = familyStore.members.find((m) => m.id === list.ownerId)?.name;
  return name ? fillTemplate(t('wall.list.ownerList'), { name }) : t('wall.orphanLists');
}
function ownerColour(list: FamilyList): string {
  return familyStore.members.find((m) => m.id === list.ownerId)?.color ?? 'transparent';
}
function percent(jobs: WallJob[]): number {
  const { done, total } = jobsProgress(jobs);
  return total ? Math.round((done / total) * 100) : 0;
}

/** "31 Aug – 2 Sep", or a single date when the trip is one day. */
const tripDates = computed(() => {
  const value = trip.value;
  if (!value?.startDate) return '';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const start = new Date(`${value.startDate.slice(0, 10)}T00:00:00`).toLocaleDateString(
    undefined,
    opts
  );
  if (!value.endDate || value.endDate.slice(0, 10) === value.startDate.slice(0, 10)) return start;
  const end = new Date(`${value.endDate.slice(0, 10)}T00:00:00`).toLocaleDateString(
    undefined,
    opts
  );
  return `${start} – ${end}`;
});

const { memberAvatarBindings } = useMemberAvatarBindings();
</script>

<template>
  <!--
    The slim strip. Same four things, one row — shown when the grid needs the
    height. Deliberately a separate branch rather than four more ternaries
    through the card markup below: the cards only ever see 'band' or 'rail',
    so no read site can be missed.
  -->
  <div
    v-if="variant === 'strip'"
    class="flex shrink-0 items-center rounded-[18px] bg-white p-1.5 shadow-[var(--card-shadow)] dark:bg-slate-800"
  >
    <button
      v-if="tonight"
      type="button"
      class="wall-card-line font-outfit flex flex-1 items-center justify-center gap-2 border-r border-[rgba(44,62,80,0.08)] font-semibold last:border-r-0 dark:border-slate-700"
      @click="emit('open', { kind: 'meals', ymd: mealsYmd })"
    >
      <span aria-hidden="true">{{ tonight.emoji }}</span>
      <span class="truncate">{{ tonight.name }}</span>
    </button>
    <button
      type="button"
      class="wall-card-line font-outfit flex flex-1 items-center justify-center gap-2 border-r border-[rgba(44,62,80,0.08)] font-semibold last:border-r-0 dark:border-slate-700"
      :aria-label="t('wall.card.todos')"
      @click="emit('open', { kind: 'todos' })"
    >
      <span aria-hidden="true">✅</span>
      <span>{{ todoProgress.done }} / {{ todoProgress.total }}</span>
    </button>
    <button
      v-if="visibleLists.length"
      type="button"
      class="wall-card-line font-outfit flex flex-1 items-center justify-center gap-2 border-r border-[rgba(44,62,80,0.08)] font-semibold last:border-r-0 dark:border-slate-700"
      @click="emit('openChores')"
    >
      <span aria-hidden="true">📝</span>
      <span class="truncate">{{ visibleLists[0]?.list.title }}</span>
    </button>
    <button
      v-if="trip"
      type="button"
      class="wall-card-line font-outfit flex flex-1 items-center justify-center gap-2 font-semibold"
      @click="emit('open', { kind: 'trip' })"
    >
      <span aria-hidden="true">✈️</span>
      <span class="truncate">{{ trip.name }}</span>
    </button>
  </div>

  <div
    v-else
    class="min-h-0 gap-2.5"
    :class="
      variant === 'rail'
        ? 'flex flex-col'
        : portrait
          ? 'grid shrink-0 grid-cols-2'
          : 'grid shrink-0'
    "
    :style="variant === 'band' && !portrait ? { gridTemplateColumns: bandColumns } : undefined"
  >
    <!--
      CHORES AND LISTS lead: widest cell, its own Sky Silk identity so the
      anchor of the band is not one white card among five.
      This replaced a separate "Chores" card that showed one or two rows and
      earned none of the space it took. Every active list is here instead —
      the repeating chore lists among them — which is both more useful and one
      card fewer.
    -->
    <WallCard
      v-if="visibleLists.length"
      :title="t('wall.card.choresAndLists')"
      tone="chores"
      class="wall-card-chores"
      @open="emit('openChores')"
    >
      <span
        v-for="{ list, jobs } in visibleLists"
        :key="list.id"
        class="flex items-center gap-2.5 border-b border-[rgba(44,62,80,0.06)] py-1.5 last:border-b-0 dark:border-slate-700"
      >
        <span class="wall-card-list-emoji leading-none" aria-hidden="true">{{ list.emoji }}</span>
        <span class="min-w-0 flex-1">
          <span
            class="font-outfit wall-card-line text-secondary-500 block truncate font-semibold dark:text-gray-100"
          >
            {{ list.title }}
            <span
              v-if="isRecurring(list)"
              class="font-outfit wall-pill text-primary-500 ml-1 rounded-full bg-[var(--tint-orange-15)] px-1.5 py-0.5 font-extrabold tracking-[0.08em] uppercase"
            >
              {{ t('wall.list.repeats') }}
            </span>
          </span>
          <span class="font-inter wall-card-sub block truncate text-[var(--muted-text,#4d5d6c)]">
            <i
              class="mr-1 inline-block h-2 w-2 rounded-full align-middle"
              :style="{ background: ownerColour(list) }"
              aria-hidden="true"
            />
            {{ ownerLabel(list) }}
          </span>
        </span>
        <span class="shrink-0 text-right">
          <b class="font-outfit wall-card-line">
            {{ jobsProgress(jobs).done }}/{{ jobsProgress(jobs).total }}
          </b>
          <span
            class="mt-1 block h-1.5 w-16 overflow-hidden rounded-full bg-[var(--tint-slate-10)]"
          >
            <span
              class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r"
              :style="{ width: `${percent(jobs)}%` }"
            />
          </span>
        </span>
      </span>
    </WallCard>
    <!-- to-dos: a smaller card, and a drawer rather than a board -->
    <WallCard
      v-if="todoProgress.total"
      :title="t('wall.card.todos')"
      tone="todos"
      @open="emit('open', { kind: 'todos' })"
    >
      <span
        v-for="entry in outstandingTodos"
        :key="entry.member?.id ?? 'unassigned'"
        class="flex items-center gap-2.5 border-b border-[rgba(44,62,80,0.06)] py-1.5 last:border-b-0 dark:border-slate-700"
      >
        <BeanieAvatar
          v-if="entry.member"
          v-bind="memberAvatarBindings(entry.member)"
          fallback="initials"
          size="sm"
        />
        <span
          v-else
          class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#95a5a6] text-xs font-bold text-white"
          aria-hidden="true"
          >?</span
        >
        <span class="min-w-0 flex-1">
          <span
            class="font-inter wall-card-line text-secondary-500 block truncate dark:text-gray-100"
          >
            {{ entry.jobs[0].title }}
          </span>
          <span class="font-inter wall-card-sub block text-[var(--muted-text,#4d5d6c)]">
            {{ entry.member?.name ?? t('wall.todo.anyone')
            }}<template v-if="entry.jobs.length > 1">
              ·
              {{ fillTemplate(t('wall.card.more'), { count: entry.jobs.length - 1 }) }}
            </template>
          </span>
        </span>
      </span>
      <span class="font-inter wall-card-sub mt-2 block text-[var(--muted-text,#4d5d6c)]">
        {{
          fillTemplate(t('wall.card.todosProgress'), {
            done: todoProgress.done,
            total: todoProgress.total,
          })
        }}
      </span>
    </WallCard>

    <!-- tonight -->
    <WallCard
      v-if="tonight"
      :title="t('wall.tonight')"
      @open="emit('open', { kind: 'meals', ymd: mealsYmd })"
    >
      <span class="flex items-center gap-3">
        <span class="wall-card-emoji leading-none" aria-hidden="true">{{ tonight.emoji }}</span>
        <span class="min-w-0">
          <!-- name the slot: an emoji alone does not say breakfast from supper -->
          <span
            class="font-outfit wall-card-sub text-primary-500 block font-bold tracking-[0.09em] uppercase"
          >
            {{ t(tonight.slotKey) }}
          </span>
          <span
            class="font-outfit wall-card-meal text-secondary-500 block truncate font-bold dark:text-gray-100"
          >
            {{ tonight.name }}
          </span>
          <span
            v-if="tonight.cook"
            class="font-inter wall-card-sub block text-[var(--muted-text,#4d5d6c)]"
          >
            {{ fillTemplate(t('wall.card.cooking'), { name: tonight.cook.name }) }}
          </span>
        </span>
      </span>
    </WallCard>

    <!-- the trip -->
    <WallCard v-if="trip" :title="t('wall.trip')" dark @open="emit('open', { kind: 'trip' })">
      <span class="mb-2 flex items-center gap-2.5">
        <span class="wall-card-emoji leading-none" aria-hidden="true">🛫</span>
        <span class="min-w-0">
          <span class="font-outfit wall-card-meal block truncate font-bold">{{ trip.name }}</span>
          <span class="font-inter wall-card-sub block text-[#bdc3c7]">
            <template v-for="(person, i) in trip.travellers" :key="person.id"
              >{{ i ? ', ' : '' }}{{ person.name }}</template
            >
            <template v-if="trip.travellers.length && tripDates"> · </template>{{ tripDates }}
          </span>
        </span>
      </span>
      <span
        v-for="leg in trip.legs.slice(0, 2)"
        :key="leg.id"
        class="font-inter wall-card-sub flex items-center gap-2 py-0.5 text-[#dfe6ec]"
      >
        <template v-if="leg.from && leg.to">
          <b class="font-outfit">{{ leg.from }}</b>
          <span class="text-[var(--sky-silk,#AED6F1)] opacity-80" aria-hidden="true">→</span>
          <b class="font-outfit">{{ leg.to }}</b>
        </template>
        <span v-else class="truncate">{{ leg.title }}</span>
        <!-- the card shows the departure only; the sheet shows the full band -->
        <span v-if="leg.band?.start.time">{{ leg.band.start.time }}</span>
        <span v-if="leg.reference" class="ml-auto text-[#9fb3c4]">{{ leg.reference }}</span>
      </span>
      <span
        v-if="trip.percent > 0"
        class="mt-2 block h-2.5 overflow-hidden rounded-full bg-white/20"
      >
        <span
          class="from-primary-500 to-terracotta-400 block h-full rounded-full bg-gradient-to-r"
          :style="{ width: `${trip.percent}%` }"
        />
      </span>
    </WallCard>
  </div>
</template>
