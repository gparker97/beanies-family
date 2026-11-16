<script setup lang="ts">
/**
 * The choreboard (#146): chores in their own place, by time of day. Two views:
 *
 *  - HOME (grown-ups): one card per bean with chores ("four segments": a summary row per time
 *    of day, the block happening now open and tickable) in ONE regular grid, in family order (1
 *    column, 2 from 768px, and from 1280px as many as fit, up to five, cards in a row stretched
 *    to its height); beans with no
 *    chores as chips in one "No Chores Yet" strip below; Hours and ONE Add Chores (the sheet, for
 *    one chore or a whole set); the "No one's" group for chores whose people have left the
 *    family; below them, on the same grid, the "Chores Done" board (days across) and the
 *    "This Week" card (`ChoreWeekSummary`): side by side from 1280px (This Week in the last
 *    column, the board across the rest), stacked below; an empty state.
 *  - A BEAN'S DAY (`?bean=<id>`): the tick view. Every block open with its chores ("Now" first
 *    and biggest, each folding by its header for this visit), the all-done banner (a short
 *    horizontal strip from 768px); beside it (from 1280px) or above and below it, the "Today" summary
 *    (`ChoreBlockSummary`, rows, or the tile strip on a phone; a tap opens and scrolls to that
 *    block) and the bean's own Chores Done week. A child always lands on their own day.
 *
 * Editing is per bean, like a Beanie List: the bean's chore list (`ChoreBeanEditor`, "Pip's
 * Chores") opens from the bean's card (Edit Chores, or "+" when it has none), the day's Edit
 * Chores, a chore's name, and Quick Add on a bean's day. A bean with no chores at all has
 * nothing to edit, so the day's action reads Add Chores and its empty card has Add Chores too; a
 * bean whose chores are all on other days gets a plain "nothing today" card with Edit Chores.
 * The page header's Add Chores, the empty state and the Beanie Lists redirect open the Add Chores
 * sheet (`ChoreAddSheet`), which adds one list to several beans at once. "No one's" chores
 * (their people have left) have a ✕ each.
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
 * Performance: the board reads `choreStore.weekFor`, which reads the store's day clock (it moves
 * at a block boundary or midnight, never every minute) and the marks; there are no per-cell
 * watchers.
 *
 * Stars and rewards (#148), each drawn only from a `starStore` getter that answers nothing while
 * the feature is off (so off means absent, with no "is it on" test here):
 *  - a kid's day head: a thin arc around the avatar toward the weekly reward (the reward's emoji
 *    as a badge once achieved) and a quiet star count beside the day's count; while
 *    `rewardBannerFor` is set, the existing celebration banner under the head ("Max earned Ice
 *    Cream this week"), nothing to press;
 *  - every chore of a kid shows its value (`starStore.valueFor`);
 *  - a grown-up viewing a kid's day with the feature on: a small "Give Stars" button on the head;
 *  - a kid's own day: their bonus and take-back notes from today and yesterday, newest first,
 *    under the head (`StarNote`, from `starStore.notesFor`);
 *  - a grown-up's home cards: each kid's path strip (`StarPathStrip` in the card's `strip` slot).
 *
 * "Give Stars" (on Stars and Rewards, on Star Report, and on a kid's day) opens ONE gift modal
 * (`StarGiftModal`), with that kid picked when opened from their day. Add Special Reward and a
 * special reward's row (on Stars and Rewards and on Star Report) open ONE special reward drawer
 * (`ChoreAwardModal`), owned here: each view only emits `open-award`.
 *
 * The weekly reward's banner is claimed only while a surface that draws it is mounted: the day
 * head is a banner host for its bean (`useRewardBannerHost`), so the banner plays when that
 * bean's week is achieved and not yet celebrated, whichever surface or device ticked it (a
 * grown-up's tick on a home card plays it when the bean's day is next open). Ticks claim nothing.
 *
 * Looking back (grown-ups, whether or not stars are on): the Chores Done board carries the week
 * stepper in its header (`ChoreWeekPanel`'s `weeks`), over this week and up to four back: while
 * stars are on, `starStore.lookbackWeeks` (a week frozen before a week-start change is offered by
 * its own first day); while off, the `lookbackWeeks` rule with no frozen weeks (the weeks that fit
 * inside chore-mark retention). Stepped back, only the board changes: it is fed that week's rows
 * (`choreStore.weekFor(memberId, weekStart, choreDayOfWeek(weekStart))`) and says it is looking
 * back. Today's cards above it stay live and tickable, and This Week keeps showing this week.
 * The board itself has nothing to tick. The Star Report shows the same board and stepper over
 * the same week. The week is page state (a `ref`), never a URL parameter: a reload returns to
 * this week.
 *
 * The home's view switch (grown-ups only, Who Owns What's pattern, greg 2026-11-16): a
 * `TogglePillGroup` above the home, in this order: "Chores" (the home as it always was, the
 * default), "Star Report" (`StarReportView`), offered only while the feature is on, and
 * "Rewards" (`ChoreRewardsView`, headed "Stars and Rewards": the turn-on panel while the feature
 * is off, the setup while it is on), always offered. The Star Report's Rewards Settings (and its
 * weekly reward row) ask for the Rewards view (`open-rewards`); the page owns the view state. The active view's actions sit at the right
 * of the switch's row ("Give Stars" on Rewards and on Star Report while on). Not remembered per
 * device: the page always opens on Chores.
 * `?view=chores|rewards|report` is honoured once for a grown-up, then stripped; for a non-adult
 * it is ignored, stripped and logged (`query-guarded`, `view-not-adult`), and `?view=report` with
 * the feature off is stripped and logged too (`view-feature-off`). If the feature is turned off
 * while the report shows, the page falls back to Chores.
 * A kid never sees the switch, and nothing on a kid's screen changes.
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
import ChoreBlockSummary from '@/components/chores/ChoreBlockSummary.vue';
import ChoreRow from '@/components/chores/ChoreRow.vue';
import ChoreWeekPanel from '@/components/chores/ChoreWeekPanel.vue';
import ChoreWeekSummary from '@/components/chores/ChoreWeekSummary.vue';
import ChoreBeanEditor from '@/components/chores/ChoreBeanEditor.vue';
import ChoreAddSheet from '@/components/chores/ChoreAddSheet.vue';
import ChoreCopyModal from '@/components/chores/ChoreCopyModal.vue';
import ChoreHoursModal from '@/components/chores/ChoreHoursModal.vue';
import StarCount from '@/components/chores/StarCount.vue';
import ChoreRewardsView from '@/components/chores/ChoreRewardsView.vue';
import StarReportView from '@/components/chores/StarReportView.vue';
import StarGiftModal from '@/components/chores/StarGiftModal.vue';
import StarNote from '@/components/chores/StarNote.vue';
import StarPathStrip from '@/components/chores/StarPathStrip.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import ProgressRing from '@/components/ui/ProgressRing.vue';
import ProgressBar from '@/components/ui/ProgressBar.vue';
import ChoreAwardModal from '@/components/chores/ChoreAwardModal.vue';
import CelebrationBanner from '@/components/ui/CelebrationBanner.vue';
import { rewardBannerText } from '@/components/chores/starText';
import { rewardBannerFor } from '@/composables/useCelebration';
import { useTranslation } from '@/composables/useTranslation';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useChoreClock } from '@/composables/useChoreClock';
import { useChoreTicks } from '@/composables/useChoreTicks';
import { useRewardBannerHost } from '@/composables/useRewardBannerHost';
import { usePermissions } from '@/composables/usePermissions';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useMediaQuery } from '@/composables/useMediaQuery';
import { useChoreStore } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useStarStore } from '@/stores/starStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { preloadChoreCelebrationWhenIdle } from '@/components/ui/choreCelebrationLoader';
import { CHORE_BLOCK_META, choreBlockHint } from '@/constants/choreBlocks';
import { DEFAULT_REWARD_EMOJI } from '@/constants/choreStars';
import { lookbackWeeks } from '@/utils/choreStars';
import type { ChoreCelebrationAnchor } from '@/utils/choreCelebration';
import { choreStarterSet, type ChoreStarterSetKey } from '@/constants/choreStarterSets';
import {
  blocksInDisplayOrder,
  choreDayOfWeek,
  currentBlock,
  type BeanChoreDay,
  type ChoreDayBlock,
} from '@/utils/chores';
import { firstName as firstNameOf } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreAward, ChoreBlock, FamilyMember } from '@/types/models';

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const choreStore = useChoreStore();
const starStore = useStarStore();
const settingsStore = useSettingsStore();
const { choreClock } = useChoreClock();
const ticks = useChoreTicks();
const { memberAvatarBindings } = useMemberAvatarBindings();
const { isMobile } = useBreakpoint();
/** Tailwind's `xl`: the bean's day rail (its Today summary and its own week). */
const isWide = useMediaQuery('(min-width: 80rem)');

onMounted(() => {
  // The boot sequence loads chores; this covers a page reached before that finished.
  if (!choreStore.isLoaded) void choreStore.loadChores();
  // The all-done celebration is code-split; warm it (and its art) while the page is idle.
  preloadChoreCelebrationWhenIdle();
});

const me = computed(() => familyStore.currentMember);
const { isAdult } = usePermissions();
const rosterReady = computed(() => familyStore.members.length > 0);

// ── The home's views (grown-ups) ────────────────────────────────────────────

/** In the switch's order. 'report' (Star Report) is offered only while the feature is on. */
const HOME_VIEWS = ['chores', 'report', 'rewards'] as const;
type HomeView = (typeof HOME_VIEWS)[number];
const HOME_VIEW_LABELS: Record<HomeView, UIStringKey> = {
  chores: 'choreStars.view.chores',
  report: 'choreStars.view.report',
  rewards: 'choreStars.view.rewards',
};
const isHomeView = (v: string): v is HomeView => (HOME_VIEWS as readonly string[]).includes(v);

/** Page state, never remembered: every visit opens on Chores unless `?view=` says otherwise. */
const homeView = ref<HomeView>('chores');
/** A view needs the feature on (the report); the others are always offered. */
const viewOffered = (v: HomeView) => v !== 'report' || starStore.isOn;
/** The view drawn: the report falls back to Chores if the feature is turned off meanwhile. */
const activeView = computed<HomeView>(() =>
  viewOffered(homeView.value) ? homeView.value : 'chores'
);
const homeViewOptions = computed(() =>
  HOME_VIEWS.filter(viewOffered).map((v) => ({
    value: v,
    label: t(HOME_VIEW_LABELS[v]),
    variant: 'orange' as const,
  }))
);
function setHomeView(value: string): void {
  if (isHomeView(value) && viewOffered(value)) homeView.value = value;
}

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

  // `?view=` (the home's view switch): honoured once for a grown-up, then consumed; a non-adult
  // has no switch, so it is ignored, stripped and logged.
  if (q.view !== undefined) {
    const v = firstString(q.view);
    if (!isAdult.value) logGuard('view-not-adult');
    else if (!isHomeView(v)) logGuard('view-unknown');
    else if (!viewOffered(v)) logGuard('view-feature-off');
    else homeView.value = v;
    delete next.view;
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
/** The gift modal (Give Stars): ONE ref pair; `giftFor` is the kid picked on open, or null. */
const giftOpen = ref(false);
const giftFor = ref<string | null>(null);
/**
 * The special reward drawer (`ChoreAwardModal`): ONE, owned here, opened by an `open-award`
 * intent from the Rewards view or the Star Report. `null` adds one, a special reward edits it.
 */
const awardOpen = ref(false);
const editingAward = ref<ChoreAward | null>(null);

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

/** A tick, with where its celebration plays if it finishes the block (#146). */
function onToggle(choreId: string, memberId: string, anchor: ChoreCelebrationAnchor | null): void {
  void ticks.toggle(choreId, memberId, { anchor });
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
const nowUntil = computed(() =>
  choreBlockHint({ block: nowBlock.value, isNow: true, ended: false }, starts.value, t)
);

/** Members with at least one chore on some day (a living assignee). */
const choreOwners = computed(() => {
  const ids = new Set<string>();
  for (const c of choreStore.chores) for (const id of c.assigneeIds ?? []) ids.add(id);
  return ids;
});

const firstName = (m: FamilyMember) => firstNameOf(m.name);

// ── Home ────────────────────────────────────────────────────────────────────

interface HomeBean {
  member: FamilyMember;
  day: BeanChoreDay;
}

/** Beans with a chore on some day: one card each, in family order. */
const cardBeans = computed<HomeBean[]>(() =>
  familyStore.sortedHumans
    .filter((m) => choreOwners.value.has(m.id))
    .map((member) => ({ member, day: choreStore.choreDayFor(member.id) }))
);
/** Beans with no chores at all: the "No Chores Yet" strip under the cards (grown-ups). */
const noChoreBeans = computed(() =>
  familyStore.sortedHumans.filter((m) => !choreOwners.value.has(m.id))
);

const isEmpty = computed(() => choreStore.isLoaded && choreStore.chores.length === 0);

/** Today as the board reads it: the store's day clock, not the minute clock. */
const todayYmd = computed(() => choreStore.todayYmd);

// ── Looking back (grown-ups) ────────────────────────────────────────────────

/**
 * The weeks the board's stepper offers, newest first: the stars' frozen-aware list while it
 * answers (feature on), else the rule over chore marks alone. Chores done do not need stars.
 */
const lookback = computed<readonly string[]>(() => {
  if (!isAdult.value) return [];
  const withStars = starStore.lookbackWeeks;
  return withStars.length
    ? withStars
    : lookbackWeeks(todayYmd.value, settingsStore.weekStartDay, []);
});
/** The stepped-back week start, or null for this week. Page state, never a URL parameter. */
const pastWeek = ref<string | null>(null);
/** Stepped back to a week the stepper still offers (else the board is on this week). */
const lookingBack = computed(
  () => pastWeek.value !== null && lookback.value.slice(1).includes(pastWeek.value)
);
/** The week the board (and the Star Report) shows. */
const boardWeek = computed(() => (lookingBack.value ? pastWeek.value! : (lookback.value[0] ?? '')));
function stepTo(weekStart: string): void {
  pastWeek.value = weekStart === lookback.value[0] ? null : weekStart;
}

const owners = computed(() => familyStore.sortedHumans.filter((m) => choreOwners.value.has(m.id)));
/** This week, for This Week (and the board while not looking back). */
const weekRows = computed(() =>
  owners.value.map((member) => ({ member, week: choreStore.weekFor(member.id) }))
);
/** The board's rows: a past week by its own first day, so it draws the seven days it had. */
const boardRows = computed(() => {
  if (!lookingBack.value) return weekRows.value;
  const past = pastWeek.value!;
  return owners.value.map((member) => ({
    member,
    week: choreStore.weekFor(member.id, past, choreDayOfWeek(past)),
  }));
});
const showBoard = computed(() => isAdult.value && weekRows.value.length > 0);

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

/**
 * The one display order (`blocksInDisplayOrder`): now first and biggest, then Anytime, then later
 * blocks and the ones whose time has passed. Every block opens with its chores and a finished one
 * shows its banner (each section folds by its header, for this visit only).
 */
const daySections = computed<ChoreDayBlock[]>(() =>
  blocksInDisplayOrder((day.value?.blocks ?? []).filter((b) => b.total > 0))
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

/** The day's top-right action: Edit Chores, or Add Chores when the bean has none at all. */
const dayEditLabel = computed(() =>
  t(dayHasAnyChores.value ? 'choreboard.day.edit' : 'choreboard.addChores')
);

/** The "Today" summary: the bean's blocks with chores today, in day order. */
const summaryBlocks = computed(() => (day.value?.blocks ?? []).filter((b) => b.total > 0));

const dayWeekRows = computed(() =>
  dayMember.value && dayHasAnyChores.value
    ? [{ member: dayMember.value, week: choreStore.weekFor(dayMember.value.id) }]
    : []
);
/** The day page's rail: only when there is something to put in it. */
const dayRail = computed(
  () => isWide.value && (summaryBlocks.value.length > 0 || dayWeekRows.value.length > 0)
);

// ── Stars (#148) ────────────────────────────────────────────────────────────

/** The day head's arc and count, or null (stars off, a grown-up's day, nothing to draw). */
const dayArc = computed(() => (viewBeanId.value ? starStore.arcFor(viewBeanId.value) : null));
const dayArcSegments = computed(() =>
  dayArc.value ? [{ value: dayArc.value.percent / 100, tone: 'fill' as const }] : []
);
/**
 * The day head is a banner host for its bean while it is drawn (the store ignores a grown-up):
 * the same condition as the day's template, so a host is registered only where the banner can
 * show.
 */
useRewardBannerHost(
  () => (viewBeanId.value && dayMember.value && day.value ? [viewBeanId.value] : []),
  'app'
);
/** The achieved moment's banner on this kid's day, while it is up. */
const dayRewardBanner = computed(() => {
  const banner = viewBeanId.value ? rewardBannerFor(viewBeanId.value) : null;
  return banner ? rewardBannerText(banner, dayArc.value?.count ?? 0, t) : null;
});

/** The special reward drawer, empty (`null`) or on that special reward (grown-ups only). */
function openAward(award: ChoreAward | null): void {
  if (!isAdult.value) return;
  editingAward.value = award;
  awardOpen.value = true;
}

/** "Give Stars": the bonus / take-back modal, with `memberId` picked when opened from their day. */
function openGiveStars(memberId: string | null = null): void {
  if (!isAdult.value) return;
  giftFor.value = memberId;
  giftOpen.value = true;
}

/** A kid's bonus and take-back notes from today and yesterday (empty while off). */
const dayNotes = computed(() =>
  viewBeanId.value
    ? starStore.notesFor(viewBeanId.value).map((gift) => ({
        gift,
        byName: firstNameOf(familyStore.members.find((m) => m.id === gift.by)?.name),
      }))
    : []
);

/** Each kid's path strip on their home card, for a grown-up (none while off, or not a kid). */
const cardStrips = computed(() => {
  const out = new Map<string, NonNullable<ReturnType<typeof starStore.stripFor>>>();
  if (!isAdult.value) return out;
  for (const { member } of cardBeans.value) {
    const strip = starStore.stripFor(member.id);
    if (strip) out.set(member.id, strip);
  }
  return out;
});
const rewardEmoji = computed(() => starStore.rewards.emoji || DEFAULT_REWARD_EMOJI);

/** May a grown-up give this kid stars here (the feature on, a kid's day, a grown-up looking)? */
const canGiveOnDay = computed(
  () => isAdult.value && !!viewBeanId.value && starStore.valueFor(viewBeanId.value) !== null
);

/** The day's sections, by block, so a summary row can open and scroll to its section. */
const sectionRefs = new Map<ChoreBlock, { reveal: () => void }>();
function setSectionRef(block: ChoreBlock, el: unknown): void {
  if (el) sectionRefs.set(block, el as { reveal: () => void });
  else sectionRefs.delete(block);
}
function revealBlock(block: ChoreBlock): void {
  sectionRefs.get(block)?.reveal();
}
</script>

<template>
  <div class="space-y-6" data-testid="choreboard-page" data-celebration-clip>
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
          <!-- A phone has room for one row: "Back" there, the full label from 640px. -->
          <span class="hidden sm:inline">{{ t('choreboard.day.back') }}</span>
          <span class="sm:hidden">{{ t('action.back') }}</span>
        </button>
        <span class="flex-1" />
        <template v-if="isAdult">
          <button
            v-if="dayHasAnyChores"
            type="button"
            class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 rounded-2xl border border-[var(--color-border-strong)] bg-white px-3.5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
            :aria-label="t('choreboard.day.copy')"
            data-testid="chore-day-copy"
            @click="openCopy(viewBeanId)"
          >
            <span aria-hidden="true">📋</span>
            <span class="hidden sm:inline" aria-hidden="true">{{ t('choreboard.day.copy') }}</span>
          </button>
          <!-- With no chores at all there is nothing to edit: it reads Add Chores. -->
          <button
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 focus-visible:ring-sky-silk-300 inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-3.5 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-day-edit"
            :data-empty="dayHasAnyChores ? undefined : 'true'"
            @click="openBeanEditor(viewBeanId)"
          >
            <span v-if="!dayHasAnyChores" aria-hidden="true">+</span>
            <svg
              v-else
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
            {{ dayEditLabel }}
          </button>
        </template>
      </div>

      <div
        class="flex items-center gap-3"
        data-testid="chore-day-head"
        :data-member-id="viewBeanId"
      >
        <ProgressRing
          v-if="dayArc"
          class="h-20 w-20 flex-none"
          :segments="dayArcSegments"
          :stroke-width="6"
          data-testid="chore-day-ring"
          :data-percent="dayArc.percent"
        >
          <BeanieAvatar v-bind="memberAvatarBindings(dayMember)" size="xl" />
          <template v-if="dayArc.badgeEmoji" #badge>
            <span
              class="dark:bg-surface-raised dark:border-line grid h-7 w-7 place-items-center rounded-full border border-[var(--color-border-strong)] bg-white text-sm leading-none"
              data-testid="chore-day-badge"
              >{{ dayArc.badgeEmoji }}</span
            >
          </template>
        </ProgressRing>
        <BeanieAvatar v-else v-bind="memberAvatarBindings(dayMember)" size="xl" />
        <div class="min-w-0 flex-1">
          <h2 class="font-outfit dark:text-ink text-secondary-500 text-2xl leading-tight font-bold">
            {{ greeting }}
          </h2>
          <div v-if="dayTotal > 0" class="mt-2 flex items-center gap-2">
            <ProgressBar
              class="flex-1"
              size="md"
              :percent="dayPct"
              role="progressbar"
              :aria-valuenow="dayDone"
              aria-valuemin="0"
              :aria-valuemax="dayTotal"
              :aria-label="
                fillTemplate(t('choreboard.day.progressAria'), { done: dayDone, total: dayTotal })
              "
              data-testid="chore-day-progress"
            />
            <span
              class="font-outfit dark:text-ink-soft text-secondary-400 text-sm font-semibold"
              data-testid="chore-day-count"
              >{{
                fillTemplate(t('choreboard.block.count'), { done: dayDone, total: dayTotal })
              }}</span
            >
            <StarCount
              v-if="dayArc"
              :count="dayArc.count"
              :kind="dayArc.kind"
              data-testid="chore-day-stars"
            />
          </div>
          <StarCount
            v-else-if="dayArc"
            class="mt-2"
            :count="dayArc.count"
            :kind="dayArc.kind"
            data-testid="chore-day-stars"
          />
        </div>
        <button
          v-if="canGiveOnDay"
          type="button"
          class="font-outfit dark:bg-surface-raised dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 inline-flex flex-none items-center gap-1 self-start rounded-2xl border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          :aria-label="fillTemplate(t('choreStars.giveFor'), { name: firstName(dayMember) })"
          data-testid="chore-day-give-stars"
          @click="openGiveStars(viewBeanId)"
        >
          <span aria-hidden="true">⭐</span>
          <span aria-hidden="true">{{ t('choreStars.give') }}</span>
        </button>
      </div>

      <!-- Stars (#148): today's and yesterday's bonus and take-back notes, newest first. -->
      <div v-if="dayNotes.length" class="flex flex-col gap-2" data-testid="chore-day-notes">
        <StarNote v-for="n in dayNotes" :key="n.gift.id" :gift="n.gift" :by-name="n.byName" />
      </div>

      <!-- Stars (#148): the weekly reward's achieved moment, once, nothing to press. -->
      <CelebrationBanner
        v-if="dayRewardBanner"
        compact
        :title="dayRewardBanner.title"
        :body="dayRewardBanner.body"
        :image-alt="t('choreboard.done.imageAlt')"
        data-testid="chore-day-reward-banner"
      />

      <!-- One DOM for both layouts: from 1280px the blocks fill the main column and the summary
           and the week sit in the rail beside them; below, they stack (summary, blocks, week). -->
      <div class="grid grid-cols-1 items-start gap-4" :class="{ 'day-grid-rail': dayRail }">
        <section
          v-if="summaryBlocks.length"
          class="dark:bg-surface-raised dark:border-line flex min-w-0 flex-col gap-1 rounded-3xl bg-white px-3.5 pt-3.5 pb-3 shadow-[var(--card-shadow)] dark:border"
          data-area="sum"
          data-testid="chore-day-summary"
        >
          <div class="mb-1 flex items-baseline gap-2">
            <h2 class="font-outfit dark:text-ink text-secondary-500 text-base font-bold">
              {{ t('choreboard.summary.title') }}
            </h2>
            <span class="dark:text-ink-faint text-secondary-400 text-xs">{{
              t('choreboard.summary.hint')
            }}</span>
          </div>
          <div
            :class="
              isMobile ? 'grid auto-cols-fr grid-flow-col gap-1.5 pt-2.5' : 'flex flex-col gap-1.5'
            "
          >
            <ChoreBlockSummary
              v-for="b in summaryBlocks"
              :key="b.block"
              :block="b"
              :starts="starts"
              :bean-name="firstName(dayMember)"
              :variant="isMobile ? 'tile' : 'row'"
              mode="jump"
              @activate="revealBlock(b.block)"
            />
          </div>
        </section>

        <div class="min-w-0" data-area="main">
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
            <!-- Grown-ups only: no chores at all, Add Chores; chores on other days, Edit Chores.
                 Both open this bean's chore list. A child sees the card alone. -->
            <div v-if="isAdult" class="mt-5 flex justify-center">
              <AddEntityButton
                v-if="!dayHasAnyChores"
                :label="t('choreboard.addChores')"
                data-testid="chore-day-empty-add"
                @click="openBeanEditor(viewBeanId)"
              />
              <button
                v-else
                type="button"
                class="font-outfit dark:bg-surface-overlay dark:border-line-strong dark:text-ink text-secondary-500 focus-visible:ring-sky-silk-300 rounded-2xl border border-[var(--color-border-strong)] bg-white px-4 py-2.5 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
                data-testid="chore-day-empty-edit"
                @click="openBeanEditor(viewBeanId)"
              >
                {{ t('choreboard.day.edit') }}
              </button>
            </div>
          </div>

          <div v-else class="flex flex-col gap-3" data-testid="chore-day-sections">
            <ChoreBlockSection
              v-for="b in daySections"
              :key="b.block"
              :ref="(el) => setSectionRef(b.block, el)"
              :block="b"
              :member-id="viewBeanId"
              :bean-name="firstName(dayMember)"
              open
              celebrate
              :starts="starts"
              :can-tick="canTickFor(viewBeanId)"
              :can-edit="isAdult"
              :is-pending="pendingFor(viewBeanId)"
              :star-value="starStore.valueFor(viewBeanId)"
              @toggle="(choreId, anchor) => onToggle(choreId, viewBeanId!, anchor)"
              @edit="openBeanEditor(viewBeanId)"
            />
          </div>
        </div>

        <!-- Under 768px the margin lets the week clear the floating quick-add button. -->
        <ChoreWeekPanel
          v-if="dayWeekRows.length"
          class="max-md:mb-20"
          data-area="week"
          :rows="dayWeekRows"
          :today-ymd="todayYmd"
          single
        />
      </div>
    </template>

    <!-- ═══ Home ═══ -->
    <template v-else>
      <!-- The view switch (grown-ups only) and, at its right, the active view's actions. -->
      <div
        v-if="isAdult"
        class="flex flex-wrap items-center justify-between gap-3"
        data-testid="chore-home-views"
      >
        <TogglePillGroup
          :model-value="activeView"
          :options="homeViewOptions"
          :aria-label="t('choreStars.view.label')"
          data-testid="chore-home-view-switch"
          @update:model-value="setHomeView"
        />
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="activeView !== 'chores' && starStore.isOn"
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 focus-visible:ring-sky-silk-300 inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-3.5 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:outline-none"
            data-testid="chore-give-stars"
            @click="openGiveStars()"
          >
            <span aria-hidden="true">⭐</span> {{ t('choreStars.give') }}
          </button>
        </div>
      </div>

      <!-- Rewards (grown-ups): the turn-on panel while off, the setup while on. -->
      <ChoreRewardsView v-if="isAdult && activeView === 'rewards'" @open-award="openAward" />

      <!-- Star Report (grown-ups, feature on): the board's week, shared with Chores. -->
      <StarReportView
        v-else-if="isAdult && activeView === 'report'"
        :weeks="lookback"
        :week="boardWeek"
        @update:week="stepTo"
        @open-rewards="setHomeView('rewards')"
        @open-award="openAward"
      />

      <!-- Chores: the home exactly as it always was. -->
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
          <div class="flex flex-col gap-3.5">
            <div class="min-w-0">
              <!--
              The cards in ONE regular grid, in family order: one column on a phone, two from
              768px (each capped so one or two beans never stretch), and from 1280px as many as
              fit, three to five. Cards in a row share its height (stretch), their content at
              the top.
            -->
              <div class="chore-home-grid grid gap-3.5" data-testid="chore-card-grid">
                <ChoreBeanCard
                  v-for="bean in cardBeans"
                  :key="bean.member.id"
                  class="h-full"
                  :member="bean.member"
                  :day="bean.day"
                  has-any-chores
                  :starts="starts"
                  :can-tick="canTickFor(bean.member.id)"
                  :can-edit="isAdult"
                  :is-pending="pendingFor(bean.member.id)"
                  :star-value="starStore.valueFor(bean.member.id)"
                  @toggle="(choreId, anchor) => onToggle(choreId, bean.member.id, anchor)"
                  @edit-chores="openBeanEditor(bean.member.id)"
                  @open="openDay(bean.member.id)"
                  @copy="openCopy(bean.member.id)"
                >
                  <template v-if="cardStrips.get(bean.member.id)" #strip>
                    <StarPathStrip
                      v-bind="cardStrips.get(bean.member.id)!"
                      :reward-title="starStore.rewards.title"
                      :reward-emoji="rewardEmoji"
                      :bar-pct="starStore.rewards.barPct"
                      :member="bean.member"
                    />
                  </template>
                </ChoreBeanCard>
              </div>

              <!-- Beans with no chores yet: one tidy strip of chips, for grown-ups. -->
              <section
                v-if="isAdult && noChoreBeans.length"
                class="dark:bg-surface-raised dark:border-line rounded-3xl bg-white px-4 py-3.5 shadow-[var(--card-shadow)] dark:border"
                :class="cardBeans.length ? 'mt-3.5' : ''"
                data-testid="chore-no-chores"
              >
                <h2 class="font-outfit dark:text-ink text-secondary-500 mb-2.5 text-base font-bold">
                  {{ t('choreboard.noChores.title') }}
                </h2>
                <div class="flex flex-wrap gap-2">
                  <ChoreBeanCard
                    v-for="m in noChoreBeans"
                    :key="m.id"
                    :member="m"
                    :has-any-chores="false"
                    :starts="starts"
                    :can-edit="isAdult"
                    @edit-chores="openBeanEditor(m.id)"
                  />
                </div>
              </section>

              <!-- Chores whose people have all left the family: remove the ones not needed. -->
              <section
                v-if="isAdult && choreStore.orphans.length"
                class="dark:bg-surface-raised dark:border-line mt-3.5 rounded-3xl bg-white p-4 shadow-[var(--card-shadow)] dark:border"
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
            </div>

            <!--
            The lower row, on the SAME grid as the cards so the edges line up: from 1280px This
            Week takes the last column and Chores Done spans the rest; from 768px Chores Done
            spans both columns with This Week under it; on a phone they stack. Under 768px the
            quick-add button floats over the page's last rows: the padding lets the last card
            scroll clear of it.
          -->
            <div
              v-if="showBoard"
              class="chore-home-grid chore-home-lower grid items-stretch gap-3.5 max-md:pb-20"
              data-testid="chore-home-lower"
            >
              <ChoreWeekPanel
                class="chore-home-board"
                :rows="boardRows"
                :today-ymd="todayYmd"
                open-day-action
                :weeks="lookback"
                :week="boardWeek"
                @open-day="openDay"
                @update:week="stepTo"
              />
              <ChoreWeekSummary
                class="chore-home-summary"
                :rows="weekRows"
                :today-ymd="todayYmd"
                @open-day="openDay"
              />
            </div>
          </div>
        </template>
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
    <StarGiftModal :open="giftOpen" :member-id="giftFor" @close="giftOpen = false" />
    <ChoreAwardModal :open="awardOpen" :award="editingAward" @close="awardOpen = false" />
  </div>
</template>

<style scoped>
/* The home's ONE grid, shared by the bean cards and the lower row (Chores Done, This Week) so
   their edges line up: 1 column, 2 from 768px (each capped, never a slab), and from 1280px as
   many as fit. */
.chore-home-grid {
  grid-template-columns: minmax(0, 1fr);
}

@media (width >= 48rem) {
  .chore-home-grid {
    grid-template-columns: repeat(2, minmax(0, 34rem));
  }

  /* Seven days need both columns; This Week goes under the board. */
  .chore-home-lower > .chore-home-board,
  .chore-home-lower > .chore-home-summary {
    grid-column: 1 / -1;
  }
}

/* From 1280px: columns of about 20rem, as many as fit, never fewer than three or more than
   five (the clamp's ends; the gap is gap-3.5), sharing the width so no band is left at the
   right. Both grids get the same columns, so This Week takes the last and the board the rest. */
@media (width >= 80rem) {
  .chore-home-grid {
    --chore-home-gap: 0.875rem;

    grid-template-columns: repeat(
      auto-fill,
      minmax(
        clamp(
          calc((100% - 4 * var(--chore-home-gap)) / 5),
          20rem,
          calc((100% - 2 * var(--chore-home-gap)) / 3 - 1px)
        ),
        1fr
      )
    );
  }

  .chore-home-lower > .chore-home-board {
    grid-column: 1 / -2;
  }

  .chore-home-lower > .chore-home-summary {
    grid-column: -2 / -1;
  }
}

/* From 1280px: the blocks in the main column; the summary and the week in a 22rem rail. */
.day-grid-rail {
  column-gap: 1.25rem;
  grid-template:
    'main sum' auto
    'main week' 1fr
    / minmax(0, 1fr) 22rem;
}

.day-grid-rail > [data-area='sum'] {
  grid-area: sum;
}

.day-grid-rail > [data-area='main'] {
  grid-area: main;
}

.day-grid-rail > [data-area='week'] {
  grid-area: week;
}
</style>
