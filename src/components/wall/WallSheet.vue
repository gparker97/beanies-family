<script setup lang="ts">
/**
 * The drill-in sheet — the wall's ONE answer to "what happens when I touch it".
 *
 * A day, an event, a card: everything opens this, with `target.kind` choosing
 * the body. One sheet rather than five modals because the wall is a shared
 * screen at arm's length: a single, predictable panel that always dismisses the
 * same way is worth more than bespoke chrome per content type.
 *
 * Read-only apart from ticking list items, which is the one edit a locked wall
 * allows anywhere (same rule as `WallJobRow`).
 */
import { computed, inject, onMounted, onBeforeUnmount, ref } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import SegmentWhenBand from '@/components/travel/SegmentWhenBand.vue';
import WallJobList from '@/components/wall/WallJobList.vue';
import { useWallPeripherals } from '@/composables/useWallPeripherals';
import { WALL_LOCK } from '@/components/wall/wallLockKey';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useActivityCategoryLabel } from '@/composables/useActivityCategoryLabel';
import { fillTemplate } from '@/utils/fillTemplate';
import { normalizeAssignees } from '@/utils/assignees';
import { isRecurring, listProgress } from '@/utils/listLifecycle';
import { wallActivityColour, wallEvents } from '@/utils/wallActivities';
import { activityDetailRows } from '@/utils/activityDetails';
import { useVacationStore } from '@/stores/vacationStore';
import {
  bookingProgress,
  computeAccommodationGaps,
  daysUntilTrip,
  tripCountdownKey,
  tripTypeEmoji,
} from '@/utils/vacation';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { FamilyList, FamilyMember } from '@/types/models';
import { UNASSIGNED } from '@/utils/wallJobs';
import type { WallJob, WallListGroup, WallSheetTarget, WallTodoBucket } from '@/types/wall';

const props = defineProps<{
  target: WallSheetTarget;
  isPending: (job: WallJob) => boolean;
  /** The wall's person filter — the sheet must agree with the view behind it. */
  visibleMemberIds: string[] | null;
  /** To-dos due today, by bean — the drawer half of the board/drawer split. */
  todosFor: (memberId: string) => WallJob[];
  /** EVERY to-do, bucketed — the drawer shows more than the lane does. */
  allTodos: WallJob[];
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  /** Adding — the edits an unlocked wall allows. */
  addListItem: (listId: string, title: string) => Promise<boolean>;
  addTodo: (title: string) => Promise<boolean>;
}>();
const emit = defineEmits<{
  close: [];
  toggle: [WallJob];
  open: [WallSheetTarget];
}>();

const { t } = useTranslation();
const lock = inject(WALL_LOCK, undefined);

/**
 * Adding is the only edit the padlock actually gates. Ticking is always allowed
 * (that is the wall's whole purpose) and activities are read-only here by
 * design — a wall is for display, and the app is where you edit an activity.
 */
const canAdd = computed(() => lock?.isLocked.value === false);
const draft = ref<Record<string, string>>({});
const adding = ref<string | null>(null);

const todoDraft = ref('');
const addingTodo = ref(false);

async function submitTodo() {
  if (!todoDraft.value.trim() || addingTodo.value) return;
  addingTodo.value = true;
  lock?.noteActivity();
  const ok = await props.addTodo(todoDraft.value);
  addingTodo.value = false;
  if (ok) todoDraft.value = '';
}

async function submitItem(listId: string) {
  const title = draft.value[listId] ?? '';
  // Guard on THIS list. A shared guard blocked every other list's add while one
  // was in flight, but their buttons stayed enabled — so the tap did nothing and
  // said nothing.
  if (!title.trim() || adding.value === listId) return;
  adding.value = listId;
  lock?.noteActivity();
  const ok = await props.addListItem(listId, title);
  adding.value = null;
  if (ok) draft.value = { ...draft.value, [listId]: '' };
}
const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const vacationStore = useVacationStore();
const { mealsToday, trip } = useWallPeripherals();
const { categoryLabel } = useActivityCategoryLabel();

/**
 * Read the discriminated union through a local first. Narrowing on
 * `props.target.kind` does not narrow `props.target` itself (it is a getter),
 * so every branch below has to go through this.
 */
const target = computed(() => props.target);

/**
 * Escape closes the sheet. A wall is a touch surface, but the same build runs on
 * a desktop browser during setup, and a dialog with no keyboard dismissal is a
 * dead end there.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

const membersById = computed(() => new Map(familyStore.members.map((m) => [m.id, m])));

const dayEvents = computed(() => {
  const value = target.value;
  return value.kind === 'day'
    ? wallEvents(activityStore.activitiesForDate(value.ymd), props.visibleMemberIds)
    : [];
});

const activity = computed(() => {
  const value = target.value;
  if (value.kind !== 'activity') return null;
  return activityStore.activities.find((a) => a.id === value.activityId) ?? null;
});

/**
 * Wall-safe only: the sheet is a bigger surface than the card, not a laxer one.
 * `list` narrows to one; `lists` shows every list the wall knows, orphans
 * included, so the drawer is a complete answer to "where is that list?".
 */
const sheetLists = computed<WallListGroup[]>(() => {
  const value = target.value;
  const allowed = props.visibleMemberIds ? new Set(props.visibleMemberIds) : null;
  const all = [
    ...familyStore.sortedHumans
      .filter((m) => !allowed || allowed.has(m.id))
      .flatMap((m) => props.listsFor(m.id)),
    // Orphans always show: filtering by a member cannot exclude a list that has
    // no resolvable member in the first place, and hiding it would put it back
    // out of reach.
    ...props.orphanLists,
  ];
  if (value.kind === 'list') return all.filter((g) => g.list.id === value.listId);
  return all;
});

/**
 * The trip's numbers come from `utils/vacation.ts` — the same pure helpers the
 * app's own `VacationSidebarCard` reads. The wall renders them at wall scale; it
 * does not re-derive "how booked is this trip", which is exactly the kind of
 * second opinion that ends up disagreeing with the trip page.
 */
const tripDetail = computed(() => {
  const summary = trip.value;
  if (!summary) return null;
  const vacation = vacationStore.vacations.find((v) => v.id === summary.id);
  if (!vacation) return null;
  const booking = bookingProgress(vacation);
  return {
    emoji: tripTypeEmoji(vacation.tripType, vacation.tripPurpose),
    booking,
    unbooked: booking.total - booking.booked,
    gaps: computeAccommodationGaps(vacation).length,
    countdownKey: tripCountdownKey(vacation.tripType, vacation.tripPurpose) as UIStringKey,
    daysAway: vacation.startDate ? daysUntilTrip(vacation.startDate) : null,
  };
});

const sheetTitle = computed(() => {
  const value = target.value;
  switch (value.kind) {
    case 'day':
      return dateLabel(value.ymd);
    case 'activity':
      return activity.value?.title ?? t('wall.sheet.activity');
    case 'lists':
      return t('wall.sharedLists');
    case 'list':
      return sheetLists.value[0]?.list.title ?? t('wall.sharedLists');
    case 'todos':
      return t('wall.sheet.todos');
    case 'meals':
      return t('wall.sheet.meals');
    case 'trip':
      return trip.value?.name ?? t('wall.trip');
    default:
      return '';
  }
});

/**
 * Today's to-dos, grouped by the bean who owes them. A drawer rather than a
 * board: to-dos are a shorter, more personal list than the chore board, and
 * giving both the whole screen was what blurred the two.
 */
/**
 * To-dos grouped by WHEN, not by who.
 *
 * The drawer used to show only what was due today, so a family with eight
 * to-dos saw one and reasonably concluded the wall was broken. Late and today
 * lead and carry the emphasis; what is coming and what has no date still
 * appear, quieter, below. Unassigned work gets a group of its own rather than
 * being dropped for having nobody's name on it.
 */
const TODO_ORDER: WallTodoBucket[] = ['overdue', 'today', 'upcoming', 'undated'];
const TODO_LABEL: Record<WallTodoBucket, UIStringKey> = {
  overdue: 'wall.todo.overdue',
  today: 'wall.todo.today',
  upcoming: 'wall.todo.upcoming',
  undated: 'wall.todo.undated',
};

const todoGroups = computed(() => {
  const allowed = props.visibleMemberIds ? new Set(props.visibleMemberIds) : null;
  const visible = props.allTodos.filter(
    (job) => !allowed || job.ownerId === UNASSIGNED || allowed.has(job.ownerId)
  );
  return TODO_ORDER.map((bucket) => ({
    bucket,
    labelKey: TODO_LABEL[bucket],
    jobs: visible.filter((job) => job.bucket === bucket),
  })).filter((group) => group.jobs.length);
});

/** Who owes this to-do — "Anyone" when nobody has claimed it. */
function todoOwnerName(job: WallJob): string {
  if (job.ownerId === UNASSIGNED) return t('wall.todo.anyone');
  return familyStore.members.find((m) => m.id === job.ownerId)?.name ?? t('wall.todo.anyone');
}

function dateLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}
/**
 * The shared definition of an activity's key details — the same rows the app
 * would show, so the wall cannot quietly drift into its own idea of what
 * matters. See `activityDetails.ts` for why finance is not among them.
 */
const detailRows = computed(() => {
  const value = activity.value;
  if (!value) return [];
  return activityDetailRows({
    activity: value,
    nameFor: (id) => familyStore.members.find((m) => m.id === id)?.name,
  });
});

function membersFor(ids: string[]): FamilyMember[] {
  return ids
    .map((id) => familyStore.members.find((m) => m.id === id))
    .filter((m): m is FamilyMember => !!m);
}
/** Whose list this is — blank when the owner is not a member we know. */
function listOwnerName(list: FamilyList): string {
  return familyStore.members.find((m) => m.id === list.ownerId)?.name ?? '';
}
</script>

<template>
  <div
    class="absolute inset-0 z-30 flex items-end bg-[rgba(44,62,80,0.42)]"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
  >
    <div
      class="flex h-[84%] w-full flex-col overflow-hidden rounded-t-[30px] bg-[var(--cloud-white,#F8F9FA)] px-7 pt-6 pb-6 dark:bg-slate-900"
    >
      <div class="mb-4 flex shrink-0 items-center gap-3.5">
        <h2
          class="font-outfit text-secondary-500 wall-sheet-title font-extrabold dark:text-gray-100"
        >
          {{ sheetTitle }}
        </h2>
        <button
          type="button"
          class="wall-sheet-close ml-auto grid shrink-0 place-items-center rounded-2xl bg-white shadow-[var(--card-shadow)] dark:bg-slate-800"
          :aria-label="t('action.close')"
          @click="emit('close')"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div class="wall-sheet-body min-h-0 flex-1 overflow-y-auto">
        <!-- a day's events -->
        <template v-if="target.kind === 'day'">
          <button
            v-for="entry in dayEvents"
            :key="entry.activity.id + entry.date"
            type="button"
            class="flex w-full items-center gap-4 border-b border-[rgba(44,62,80,0.06)] py-3 text-left last:border-b-0 dark:border-slate-700"
            @click="
              emit('open', { kind: 'activity', activityId: entry.activity.id, ymd: entry.date })
            "
          >
            <span class="font-outfit wall-slot-time w-24 shrink-0 font-extrabold">
              {{ entry.activity.startTime || t('planner.allDay') }}
            </span>
            <span class="min-w-0 flex-1">
              <span
                class="font-outfit wall-slot-title text-secondary-500 block font-bold dark:text-gray-100"
              >
                {{ entry.activity.title }}
              </span>
            </span>
            <span class="flex shrink-0">
              <BeanieAvatar
                v-for="person in membersFor(normalizeAssignees(entry.activity))"
                :key="person.id"
                :variant="getMemberAvatarVariant(person)"
                :color="person.color"
                size="sm"
                class="-ml-2 first:ml-0"
                :aria-label="person.name"
              />
            </span>
          </button>
          <p v-if="!dayEvents.length" class="font-caveat wall-sheet-empty py-8 text-center">
            {{ t('wall.day.nothingOn') }}
          </p>
        </template>

        <!-- one activity, read only -->
        <template v-else-if="target.kind === 'activity'">
          <div
            v-if="activity"
            class="rounded-[26px] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800"
          >
            <!--
              Time and place are the hero. They are the only two things anybody
              walks up to a wall to check about an activity, so they get a band
              of their own at wall scale — mirroring the treatment a travel
              segment gets — and the supporting logistics sit under it.
            -->
            <div class="wall-hero mb-4 flex flex-wrap items-stretch gap-3">
              <div class="wall-hero-cell">
                <p class="wall-hero-cap font-outfit">{{ t('wall.hero.when') }}</p>
                <p class="font-outfit wall-hero-value font-extrabold">
                  <template v-if="activity.startTime">
                    {{ activity.startTime
                    }}<template v-if="activity.endTime">–{{ activity.endTime }}</template>
                  </template>
                  <template v-else>{{ t('planner.allDay') }}</template>
                </p>
                <p class="font-inter wall-hero-sub">{{ dateLabel(target.ymd) }}</p>
              </div>
              <div v-if="activity.location" class="wall-hero-cell wall-hero-grow">
                <p class="wall-hero-cap font-outfit">{{ t('planner.field.location') }}</p>
                <p class="font-outfit wall-hero-value font-extrabold">{{ activity.location }}</p>
                <p v-if="activity.category" class="font-inter wall-hero-sub">
                  {{ categoryLabel(activity.category) }}
                </p>
              </div>
              <div v-else-if="activity.category" class="wall-hero-cell">
                <p class="wall-hero-cap font-outfit">{{ t('form.category') }}</p>
                <p class="font-outfit wall-hero-value font-extrabold">
                  {{ categoryLabel(activity.category) }}
                </p>
              </div>
            </div>
            <!--
              Labelled rows, not a stack of bare values. "Sofia" on its own tells
              you nothing; "Pickup · Sofia" is the answer to the question
              somebody actually walked over to ask.
            -->
            <dl v-if="detailRows.length" class="mt-3 grid gap-1.5">
              <div v-for="row in detailRows" :key="row.labelKey" class="flex gap-3">
                <dt
                  class="font-outfit wall-sheet-label w-28 shrink-0 font-bold tracking-[0.08em] text-[var(--muted-text,#4d5d6c)] uppercase"
                >
                  {{ t(row.labelKey) }}
                </dt>
                <dd class="font-inter wall-sheet-line text-secondary-500 dark:text-gray-200">
                  {{ row.value }}
                </dd>
              </div>
            </dl>
            <!--
              Notes can carry the thing that actually matters ("bring the green
              kit"), so they are labelled and given room rather than trailing
              off the bottom as unlabelled prose.
            -->
            <div v-if="activity.description" class="mt-4">
              <p
                class="font-outfit wall-sheet-label font-bold tracking-[0.08em] text-[var(--muted-text,#4d5d6c)] uppercase"
              >
                {{ t('wall.notes') }}
              </p>
              <p
                class="font-inter wall-sheet-line text-secondary-500 mt-1 whitespace-pre-line dark:text-gray-200"
              >
                {{ activity.description }}
              </p>
            </div>
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <span
                v-for="person in membersFor(normalizeAssignees(activity))"
                :key="person.id"
                class="flex items-center gap-2 rounded-full bg-[var(--tint-slate-5)] px-3 py-1"
              >
                <BeanieAvatar
                  :variant="getMemberAvatarVariant(person)"
                  :color="person.color"
                  size="sm"
                  :aria-label="person.name"
                />
                <span class="font-inter wall-sheet-line">{{ person.name }}</span>
              </span>
            </div>
            <span
              class="mt-4 block h-1.5 w-16 rounded-full"
              :style="{ background: wallActivityColour(activity, membersById) }"
              aria-hidden="true"
            />
          </div>
        </template>

        <!-- to-dos, grouped by when they are due -->
        <template v-else-if="target.kind === 'todos'">
          <div
            v-for="group in todoGroups"
            :key="group.bucket"
            class="mb-3 overflow-hidden rounded-[20px] shadow-[var(--card-shadow)]"
            :class="
              group.bucket === 'overdue' || group.bucket === 'today'
                ? 'bg-white ring-2 ring-[var(--heritage-orange)] dark:bg-slate-800'
                : 'bg-white dark:bg-slate-800'
            "
          >
            <!--
              Late and today wear the Heritage Orange band the app's own to-do
              screen uses for the same states. Everything else is present but
              quiet — visible without competing.
            -->
            <p
              class="font-outfit wall-list-title flex items-center gap-2 px-4 py-2 font-bold tracking-[0.08em] uppercase"
              :class="
                group.bucket === 'overdue' || group.bucket === 'today'
                  ? 'from-primary-500 to-terracotta-400 bg-gradient-to-r text-white'
                  : 'text-[var(--muted-text,#4d5d6c)]'
              "
            >
              {{ t(group.labelKey) }}
              <span class="opacity-70">{{ group.jobs.length }}</span>
            </p>
            <!--
              ONE list per bucket, not one per row. A `TransitionGroup` around a
              single child can never animate a move, which defeated the whole
              reason `WallJobList` exists — and it allocated a fresh array per
              job per render. The owner rides on the row instead.
            -->
            <div class="px-4 py-1">
              <WallJobList
                :jobs="group.jobs"
                :is-pending="isPending"
                :owner-label="todoOwnerName"
                @toggle="emit('toggle', $event)"
              />
            </div>
          </div>
          <p v-if="!todoGroups.length" class="font-caveat wall-sheet-empty py-8 text-center">
            {{ t('wall.sheet.noTodos') }}
          </p>
          <!--
            Quick capture for to-dos as well as lists — otherwise "unlock
            editing" is only half true. Added unassigned and due today, which is
            what someone standing at the wall means by "remember this".
          -->
          <form v-if="canAdd" class="mt-2 flex gap-2" @submit.prevent="submitTodo">
            <input
              v-model="todoDraft"
              :placeholder="t('wall.todo.add')"
              :aria-label="t('wall.todo.add')"
              :disabled="addingTodo"
              class="font-inter wall-sheet-line min-w-0 flex-1 rounded-xl border border-[rgba(44,62,80,0.15)] bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
            />
            <button
              type="submit"
              class="font-outfit text-primary-500 wall-sheet-line shrink-0 rounded-xl bg-[var(--tint-orange-15)] px-3 py-2 font-bold disabled:opacity-50"
              :disabled="addingTodo || !todoDraft.trim()"
            >
              <span aria-hidden="true">+</span>
            </button>
          </form>
        </template>

        <!-- every list, or just one, tickable -->
        <template v-else-if="target.kind === 'lists' || target.kind === 'list'">
          <div
            class="grid gap-3"
            style="grid-template-columns: repeat(auto-fit, minmax(230px, 1fr))"
          >
            <div
              v-for="{ list, jobs } in sheetLists"
              :key="list.id"
              class="rounded-[20px] bg-white p-4 shadow-[var(--card-shadow)] dark:bg-slate-800"
            >
              <p
                class="font-outfit text-secondary-500 wall-sheet-line font-bold dark:text-gray-100"
              >
                <span aria-hidden="true">{{ list.emoji }}</span>
                {{ list.title }}
                <span
                  v-if="isRecurring(list)"
                  class="font-outfit wall-pill text-primary-500 ml-1 rounded-full bg-[var(--tint-orange-15)] px-1.5 py-0.5 font-extrabold tracking-[0.08em] uppercase"
                >
                  {{ t('wall.list.repeats') }}
                </span>
              </p>
              <p class="font-inter wall-card-sub mb-2 text-[var(--muted-text,#4d5d6c)]">
                {{ fillTemplate(t('wall.list.ownerList'), { name: listOwnerName(list) }) }}
              </p>
              <WallJobList :jobs="jobs" :is-pending="isPending" @toggle="emit('toggle', $event)" />
              <!--
                Quick capture, only when unlocked. "Put bread on the shopping
                list" is the natural thing to do standing at a kitchen screen,
                and it is the payload that makes unlocking mean something.
              -->
              <form v-if="canAdd" class="mt-2 flex gap-2" @submit.prevent="submitItem(list.id)">
                <input
                  :value="draft[list.id] ?? ''"
                  :placeholder="t('wall.list.addItem')"
                  :aria-label="t('wall.list.addItem')"
                  :disabled="adding === list.id"
                  class="font-inter wall-sheet-line min-w-0 flex-1 rounded-xl border border-[rgba(44,62,80,0.15)] bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                  @input="
                    draft = { ...draft, [list.id]: ($event.target as HTMLInputElement).value }
                  "
                />
                <button
                  type="submit"
                  class="font-outfit text-primary-500 wall-sheet-line shrink-0 rounded-xl bg-[var(--tint-orange-15)] px-3 py-2 font-bold disabled:opacity-50"
                  :disabled="adding === list.id || !(draft[list.id] ?? '').trim()"
                >
                  <span aria-hidden="true">+</span>
                </button>
              </form>
              <p class="font-inter wall-card-sub mt-2 text-[var(--muted-text,#4d5d6c)]">
                {{
                  fillTemplate(t('wall.list.progress'), {
                    done: listProgress(list).done,
                    total: listProgress(list).total,
                  })
                }}
              </p>
            </div>
          </div>
        </template>

        <!-- today's meals, led by the slot -->
        <template v-else-if="target.kind === 'meals'">
          <div
            v-for="meal in mealsToday"
            :key="meal.id"
            class="mb-2.5 flex items-center gap-4 overflow-hidden rounded-[20px] bg-white shadow-[var(--card-shadow)] dark:bg-slate-800"
          >
            <!--
              The slot is the label people scan for — "what's for dinner?" — so
              it leads in its own tinted rail rather than being implied by an
              emoji. Ordered breakfast → snack by the composable.
            -->
            <span
              class="flex w-28 shrink-0 flex-col items-center justify-center gap-1 self-stretch bg-[var(--tint-orange-8)] px-3 py-3"
            >
              <span class="wall-card-emoji leading-none" aria-hidden="true">{{ meal.emoji }}</span>
              <span
                class="font-outfit wall-card-sub text-primary-500 font-bold tracking-[0.09em] uppercase"
              >
                {{ t(meal.slotKey) }}
              </span>
            </span>
            <span class="min-w-0 flex-1 py-3 pr-4">
              <span
                class="font-outfit wall-slot-title text-secondary-500 block font-bold dark:text-gray-100"
              >
                {{ meal.name }}
              </span>
              <span
                v-if="meal.cook"
                class="font-inter wall-card-sub block text-[var(--muted-text,#4d5d6c)]"
              >
                {{ fillTemplate(t('wall.card.cooking'), { name: meal.cook.name }) }}
              </span>
            </span>
          </div>
          <p v-if="!mealsToday.length" class="font-caveat wall-sheet-empty py-8 text-center">
            {{ t('wall.sheet.noMeals') }}
          </p>
        </template>

        <!-- the trip -->
        <template v-else-if="target.kind === 'trip'">
          <div
            v-if="trip"
            class="rounded-[26px] bg-white p-5 shadow-[var(--card-shadow)] dark:bg-slate-800"
          >
            <!--
              The countdown is the headline. On a wall the trip card is not a
              booking manager; it is the thing a child checks every morning to
              work out how many more sleeps.
            -->
            <p
              v-if="tripDetail && tripDetail.daysAway !== null && tripDetail.daysAway > 0"
              class="font-outfit wall-sheet-title text-primary-500 mb-3 font-extrabold"
            >
              <span aria-hidden="true">{{ tripDetail.emoji }}</span>
              <!--
                The `travel.countdown.*` strings are SUFFIXES ("days until
                takeoff") with the number prepended by the caller — the same
                shape `CalendarTripRibbon` uses. Running them through
                `fillTemplate` found no token and silently dropped the count.
              -->
              {{ tripDetail.daysAway }} {{ t(tripDetail.countdownKey) }}
            </p>
            <div v-if="tripDetail" class="mb-3 flex flex-wrap items-center gap-3">
              <span class="font-inter wall-sheet-line text-[var(--muted-text,#4d5d6c)]">
                {{
                  fillTemplate(t('wall.trip.booked'), {
                    booked: tripDetail.booking.booked,
                    total: tripDetail.booking.total,
                  })
                }}
              </span>
              <!--
                Same alert vocabulary as `VacationSidebarCard`: ⏳ + gold for
                things still to book, 🏨 + orange for nights with no bed. A
                fully-booked trip earns a green "all booked" instead of silence,
                because "nothing is wrong" is worth saying on a display nobody
                is going to interrogate.
              -->
              <span
                v-if="tripDetail.unbooked"
                class="font-outfit wall-card-sub rounded-lg bg-[var(--vacation-gold-tint,rgba(255,217,61,0.18))] px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300"
              >
                <span aria-hidden="true">⏳</span>
                {{
                  fillTemplate(
                    tripDetail.unbooked === 1
                      ? t('vacation.itemsNeedBooking.one')
                      : t('vacation.itemsNeedBooking.other'),
                    { n: tripDetail.unbooked }
                  )
                }}
              </span>
              <span
                v-else-if="tripDetail.booking.total"
                class="font-outfit wall-card-sub rounded-lg bg-[rgba(39,174,96,0.12)] px-2 py-0.5 font-semibold text-[#1e8449] dark:text-[#6fcf97]"
              >
                <span aria-hidden="true">✓</span> {{ t('wall.trip.allBooked') }}
              </span>
              <span
                v-if="tripDetail.gaps"
                class="font-outfit text-primary-500 wall-card-sub rounded-lg bg-[var(--tint-orange-8)] px-2 py-0.5 font-semibold"
              >
                <span aria-hidden="true">🏨</span>
                {{
                  fillTemplate(
                    tripDetail.gaps === 1
                      ? t('vacation.nightsUnaccommodated.one')
                      : t('vacation.nightsUnaccommodated.other'),
                    { n: tripDetail.gaps }
                  )
                }}
              </span>
            </div>
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <span
                v-for="person in trip.travellers"
                :key="person.id"
                class="flex items-center gap-2 rounded-full bg-[var(--tint-slate-5)] px-3 py-1"
              >
                <BeanieAvatar
                  :variant="getMemberAvatarVariant(person)"
                  :color="person.color"
                  size="sm"
                  :aria-label="person.name"
                />
                <span class="font-inter wall-sheet-line">{{ person.name }}</span>
              </span>
            </div>
            <!--
              Leaving and arriving are the only things anybody walks up to a
              wall to check about a trip, so each leg leads with the app's own
              "departs → arrives" band rather than a squashed one-line summary.
              `SegmentWhenBand` is reused verbatim — same component, same
              formatting, same ocean-teal travel identity as the trip page.
            -->
            <div v-for="leg in trip.legs" :key="leg.id" class="wall-leg mt-3 first:mt-0">
              <p class="font-outfit wall-sheet-line mb-1 flex items-center gap-2 font-bold">
                <template v-if="leg.from && leg.to">
                  {{ leg.from }}
                  <span class="text-[#00b4d8]" aria-hidden="true">→</span>
                  {{ leg.to }}
                </template>
                <template v-else>{{ leg.title }}</template>
                <span
                  v-if="leg.reference"
                  class="font-inter wall-card-sub text-[var(--muted-text,#4d5d6c)]"
                >
                  {{ leg.reference }}
                </span>
                <span
                  v-if="!leg.booked"
                  class="font-outfit wall-card-sub ml-auto rounded-lg bg-[var(--vacation-gold-tint,rgba(255,217,61,0.18))] px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300"
                >
                  <span aria-hidden="true">⏳</span> {{ t('wall.trip.unbookedLeg') }}
                </span>
              </p>
              <SegmentWhenBand v-if="leg.band" :band="leg.band" />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * The hero band. Deliberately echoes the travel segment's "when" band — same
 * caption/value/sub rhythm — so an activity and a flight read the same way on
 * the same screen, in the wall's own palette rather than travel's teal.
 */
.wall-hero-cell {
  background: var(--tint-slate-5);
  border-radius: 1rem;
  min-width: 0;
  padding: 0.6rem 0.9rem;
}

.wall-hero-grow {
  flex: 1 1 12rem;
}

.wall-hero-cap {
  color: var(--muted-text, #4d5d6c);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  margin-bottom: 0.1rem;
  text-transform: uppercase;
}

.wall-hero-value {
  font-size: 1.6rem;
  line-height: 1.1;
}

.wall-hero-sub {
  color: var(--muted-text, #4d5d6c);
  font-size: 0.85rem;
  margin-top: 0.1rem;
}

:global(.dark) .wall-hero-cell {
  background: rgb(255 255 255 / 6%);
}
</style>
