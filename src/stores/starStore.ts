/**
 * Stars and rewards for chores (#148): the star store. Orchestration only (MVO): every rule
 * lives in the pure `utils/choreStars.ts`, every write in `starRepository.ts` (and the weekly
 * reward's once-only mark in `choreStore.writeCelebratedMark`, so marks keep one writer). The
 * store holds no arithmetic: each getter is one call into the rules.
 *
 * OFF MEANS ABSENT. Every getter answers nothing (`null` or an empty list) while the feature is
 * off or the stars are not loaded, so a surface needs one `v-if` and no rule of its own. The
 * week close and `afterTick` return at once, logging nothing, while it is off.
 *
 * Action contract (the chore store's, through the shared `createGuardedWrites`): a grown-up
 * action checks its `actorId` FIRST, before any other guard; a refusal is an info toast plus an
 * `edit-refused` warn and answers `null`; a write resolves its result or `null`, and every
 * `null` has already been shown and logged, so callers never toast again. An error thrown inside
 * a write uses fixed wording only (never a title, a note or a name), because the toast is also
 * the report. Telemetry is surface `chore-stars`, enums and counts only.
 *
 * DEPENDENCY DIRECTION (one-way): this store reads `choreStore`, `familyStore` and
 * `settingsStore`. `choreStore` never learns about stars.
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { createGuardedWrites } from '@/composables/useGuardedWrites';
import { celebrateReward } from '@/composables/useCelebration';
import { CHORE_TITLE_MAX } from '@/constants/choreBlocks';
import { isDocLoaded } from '@/services/automerge/docService';
import { registerLoadMaintenance, storesAuthoritative } from '@/services/automerge/loadMaintenance';
import * as choreRepo from '@/services/automerge/repositories/choreRepository';
import * as repo from '@/services/automerge/repositories/starRepository';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { takeAutoWrite } from '@/utils/autoWriteBudget';
import { firstName } from '@/utils/assignees';
import {
  CHORE_WEEK_CLOSE_ENABLED,
  applyRewardsPatch,
  arcFor as arcRule,
  awardIsFor,
  awardProgress,
  awardPriceStars,
  cleanAwardKids,
  closedRecords,
  closedWeek,
  coveredDays,
  giftRefusal,
  isStarEarner,
  isValidBar,
  isValidPrice,
  isWeekClosed,
  lookbackWeeks as lookbackRule,
  nearestSavedAward,
  openWeek,
  pathSteps,
  planWeekClose,
  rewardsOf,
  starsOf,
  weeklyAchieved,
  type AwardDraft,
  type AwardProgress,
  type ChoreRewardsPatch,
  type GiftInput,
  type StarArc,
  type StarPath,
  type StarRefusal,
  type WeekCloseInput,
  type WeekClosePlan,
  type WeekStars,
} from '@/utils/choreStars';
import {
  REWARD_MARK_REF,
  choreDayOfWeek,
  choreWeekStart,
  isChoreRefusal,
  marksOn,
  shiftChoreDay,
} from '@/utils/chores';
import { reportError } from '@/utils/errorReporter';
import { useChoreStore, type ToggleChoreOutcome } from '@/stores/choreStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Chore, ChoreAward, ChoreStarGift, ChoreWeek, FamilyMember } from '@/types/models';

const SURFACE = 'chore-stars';
/** The automatic-write budget's writer, and the load maintenance task's name. */
const CLOSE_WRITER = 'chore-week-close';
/** An emoji is one picked glyph; this only stops a pasted paragraph. */
const EMOJI_MAX = 16;

const REFUSAL_MESSAGE: Record<StarRefusal, UIStringKey> = {
  'not-adult': 'choreStars.error.notAdult',
  off: 'choreStars.error.off',
  'not-earner': 'choreStars.error.notEarner',
  'note-required': 'choreStars.error.noteRequired',
  'over-week': 'choreStars.error.overWeek',
  invalid: 'choreStars.error.invalid',
  'not-found': 'choreStars.error.notFound',
  'week-closed': 'choreStars.error.weekClosed',
};

/** The once-a-day problem events of the week close. */
type DailyProblem = 'late' | 'fewer-marks' | 'missed';

export type { ChoreRewardsPatch };

/** An award and one child's progress toward it. */
export interface AwardStanding {
  award: ChoreAward;
  progress: AwardProgress;
}

/** A parent's path strip for one child's week (`StarPathStrip`). */
export interface StarStrip {
  week: WeekStars;
  path: StarPath;
  /** The saved-up award this child is nearest to: the strip's one quiet line. */
  nearest: AwardStanding | null;
  /** The "This Week" award whose marker the strip draws (the cheapest one not yet reached). */
  thisWeek: ChoreAward | null;
}

/** What the wall's chore lane reads for one child (`useWallJobs`). */
export interface WallStars {
  /** The lane header's arc and count, or `null` (nothing to draw). */
  lane: StarArc | null;
  /** A chore's star value (the row shows it only above 1). */
  valueOf: (chore: Pick<Chore, 'stars'>) => number;
}

/** What a tick path hands `afterTick` once `choreStore.toggleChore` resolved. */
export interface AfterTickInput {
  memberId: string;
  outcome: ToggleChoreOutcome | null;
  surface: 'app' | 'wall';
  /**
   * Does the surface that ticked draw the achieved banner for THIS child (the wall's lane: yes;
   * a child's day: yes; the Chores view's home cards: no)? Only a surface that shows it may
   * claim the once-a-week celebration; with `false` nothing is written or played, so the child's
   * next tick on their lane or day plays it.
   */
  showsBanner: boolean;
}

export const useStarStore = defineStore('stars', () => {
  const choreStore = useChoreStore();
  const familyStore = useFamilyStore();
  const settingsStore = useSettingsStore();

  const awards = ref<ChoreAward[]>([]);
  const gifts = ref<ChoreStarGift[]>([]);
  const weeks = ref<ChoreWeek[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  /** True once `loadStars()` has read the document. */
  const isLoaded = ref(false);

  const { log, refuse, adultActor, write } = createGuardedWrites<StarRefusal>({
    surface: SURFACE,
    store: 'starStore',
    isLoading,
    error,
    messages: REFUSAL_MESSAGE,
    notAdult: 'not-adult',
  });

  // ========== GETTERS ==========

  /** The family's rewards settings, defaults filled (`rewardsOf` is the only reader). */
  const rewards = computed(() => rewardsOf(settingsStore.settings));
  const isOn = computed(() => rewards.value.on);
  /** On, and everything the rules read is loaded: the one condition every getter checks. */
  const active = computed(() => isOn.value && isLoaded.value && choreStore.isLoaded);
  /** Living kids, in family order: the only members who earn stars. Every surface's kid list. */
  const earnerMembers = computed<FamilyMember[]>(() =>
    familyStore.sortedHumans.filter(isStarEarner)
  );
  const earners = computed(() => earnerMembers.value.map((m) => m.id));
  const earnerSet = computed(() => new Set(earners.value));
  const todayYmd = computed(() => choreStore.todayYmd);

  /** The frozen weeks this device's clock calls closed, by child (an early record is ignored). */
  const recordsByMember = computed(() => {
    const by = new Map<string, ChoreWeek[]>();
    for (const w of closedRecords(weeks.value, todayYmd.value)) {
      const list = by.get(w.memberId);
      if (list) list.push(w);
      else by.set(w.memberId, [w]);
    }
    return by;
  });

  const giftsByMember = computed(() => {
    const by = new Map<string, ChoreStarGift[]>();
    for (const g of gifts.value) {
      const list = by.get(g.memberId);
      if (list) list.push(g);
      else by.set(g.memberId, [g]);
    }
    return by;
  });

  /** Awards in the order they were made: every surface's award order. */
  const sortedAwards = computed(() =>
    [...awards.value].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  );

  /** The open week's first day, by the family's week start. */
  const currentWeekStart = computed(
    () => choreWeekStart(todayYmd.value, settingsStore.weekStartDay) ?? todayYmd.value
  );

  const recordsOf = (memberId: string) => recordsByMember.value.get(memberId) ?? [];

  /** The open week LIVE: the chores as they are now, the marks, the gifts, covered days out. */
  function liveWeek(memberId: string, weekStart: string): WeekStars {
    const covered = coveredDays(
      weekStart,
      recordsOf(memberId).map((w) => w.weekStart)
    );
    const record = choreStore.weekFor(memberId, weekStart, choreDayOfWeek(weekStart));
    return openWeek(
      record,
      giftsByMember.value.get(memberId) ?? [],
      rewards.value,
      covered,
      todayYmd.value
    );
  }

  /**
   * One child's week holding `ymd` (today by default): LIVE while this device's clock calls it
   * open (even if an early record exists for it), the frozen record for a closed week, and
   * `null` for a closed week with no record (every reader draws "No record for this week",
   * never a zero). `null` too while the feature is off or not loaded, or for a non-earner.
   *
   * A week frozen before a week-start change is found by its OWN first day (as `lookbackWeeks`
   * offers it); any other day resolves on the current week start. Never by "a record holding
   * this day", because after a change two weeks can share days and the short one must read as
   * itself.
   */
  function weekFor(memberId: string, ymd: string = todayYmd.value): WeekStars | null {
    if (!active.value || !earnerSet.value.has(memberId)) return null;
    const mine = recordsOf(memberId);
    const own = mine.find((w) => w.weekStart === ymd);
    if (own) return closedWeek(own);
    const start = choreWeekStart(ymd, settingsStore.weekStartDay);
    if (start === null) return null;
    if (isWeekClosed(start, todayYmd.value)) {
      const record = mine.find((w) => w.weekStart === start);
      return record ? closedWeek(record) : null;
    }
    return liveWeek(memberId, start);
  }

  /**
   * Each award and the child's progress toward it as of `target`, over the closed records and
   * `open` (the child's open week, already built by the caller, so a getter builds the live week
   * once). A missing week adds nothing.
   */
  function standingsOf(memberId: string, target: string, open: WeekStars | null): AwardStanding[] {
    const history = recordsOf(memberId).map(closedWeek);
    if (open && !history.some((w) => w.weekStart === open.weekStart)) history.push(open);
    const upTo = history.filter((w) => w.weekStart <= target);
    const thatWeek = upTo.filter((w) => w.weekStart === target);
    // Only the special rewards this child is for (`awardIsFor`, the one rule).
    return sortedAwards.value
      .filter((award) => awardIsFor(award, memberId))
      .map((award) => ({
        award,
        progress: awardProgress(award, award.kind === 'week' ? thatWeek : upTo),
      }));
  }

  /**
   * Each award FOR this child (`awardIsFor`) and their progress toward it, as of the week
   * starting `asOfWeekStart` (this week by default; the report's "as of" figure leaves the later
   * weeks out). A "This Week" award counts that one week only.
   */
  function awardsFor(memberId: string, asOfWeekStart?: string): AwardStanding[] {
    if (!active.value || !earnerSet.value.has(memberId)) return [];
    return standingsOf(memberId, asOfWeekStart ?? currentWeekStart.value, weekFor(memberId));
  }

  /** `week` if it is the child's open week (already built), else the open week built now. */
  const openOf = (memberId: string, week: WeekStars) =>
    week.weekStart === currentWeekStart.value ? week : weekFor(memberId);

  /** The saved-up award the child is nearest to, with its progress, or `null`. */
  function nearestFor(standings: readonly AwardStanding[]): AwardStanding | null {
    const byId = new Map(standings.map((s) => [s.award.id, s.progress]));
    const award = nearestSavedAward(
      standings.map((s) => s.award),
      byId
    );
    return award ? { award, progress: byId.get(award.id)! } : null;
  }

  /** The lane header's / day head's arc and count for a child this week, or `null`. */
  function arcFor(memberId: string): StarArc | null {
    const week = weekFor(memberId);
    if (!week) return null;
    // The saved-up awards are read only when the weekly reward does not draw the arc.
    const weeklyDraws = rewards.value.weeklyOn && week.bar > 0;
    const nearest = weeklyDraws
      ? null
      : nearestFor(standingsOf(memberId, currentWeekStart.value, week));
    return arcRule(week, rewards.value, nearest?.progress ?? null);
  }

  /** A parent's path strip for a child's week (this week by default), or `null`. */
  function stripFor(memberId: string, weekStart?: string): StarStrip | null {
    const week = weekFor(memberId, weekStart ?? todayYmd.value);
    if (!week) return null;
    const standings = standingsOf(memberId, week.weekStart, openOf(memberId, week));
    // The strip's "This Week" marker: the cheapest one not yet achieved this week.
    const thisWeek = standings
      .filter((s) => s.award.kind === 'week' && !s.progress.achievedOn)
      .sort((a, b) => awardPriceStars(a.award, week.full) - awardPriceStars(b.award, week.full))[0];
    return {
      week,
      path: pathSteps(week, thisWeek?.award ?? null),
      nearest: nearestFor(standings),
      thisWeek: thisWeek?.award ?? null,
    };
  }

  /** A child's bonus and take-back notes from today and yesterday, newest first. */
  function notesFor(memberId: string): ChoreStarGift[] {
    if (!active.value || !earnerSet.value.has(memberId)) return [];
    const yesterday = shiftChoreDay(todayYmd.value, -1);
    return (giftsByMember.value.get(memberId) ?? [])
      .filter((g) => g.date === todayYmd.value || g.date === yesterday)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      );
  }

  /** The week starts a grown-up's week stepper offers, newest first (this week + up to 4). */
  const lookbackWeeks = computed<string[]>(() => {
    if (!active.value) return [];
    const starts = [...recordsByMember.value.values()].flatMap((list) =>
      list.map((w) => w.weekStart)
    );
    return lookbackRule(todayYmd.value, settingsStore.weekStartDay, starts);
  });

  /** What a child's chores are worth, or `null` (off, not loaded, or not a kid): the app's rows. */
  function valueFor(memberId: string): ((chore: Pick<Chore, 'stars'>) => number) | null {
    return active.value && earnerSet.value.has(memberId) ? starsOf : null;
  }

  /** The wall's stars for one child's lane, or `null` (off, not loaded, or not a kid). */
  function wallStarsFor(memberId: string): WallStars | null {
    const valueOf = valueFor(memberId);
    return valueOf ? { lane: arcFor(memberId), valueOf } : null;
  }

  // ========== LOAD ==========

  async function refresh(): Promise<void> {
    const [a, g, w] = await Promise.all([
      repo.getAllAwards(),
      repo.getAllGifts(),
      repo.getAllChoreWeeks(),
    ]);
    awards.value = a;
    gifts.value = g;
    weeks.value = w;
  }

  /** READ-ONLY. No-op until the Automerge doc is loaded; the central load sequence re-runs it. */
  async function loadStars(): Promise<void> {
    if (!isDocLoaded()) return;
    await wrapAsync(
      isLoading,
      error,
      async () => {
        await refresh();
        isLoaded.value = true;
      },
      { action: 'starStore:loadStars', surface: SURFACE }
    );
  }

  // ========== GROWN-UP ACTIONS ==========

  const REWARDS_KEYS = new Set(['on', 'weeklyOn', 'title', 'emoji', 'barPct']);
  const isBool = (v: unknown) => v === undefined || typeof v === 'boolean';
  const isText = (v: unknown, max: number) =>
    v === undefined || (typeof v === 'string' && v.trim().length <= max);

  function validRewardsPatch(patch: ChoreRewardsPatch): boolean {
    const keys = Object.keys(patch);
    if (!keys.length || keys.some((k) => !REWARDS_KEYS.has(k))) return false;
    return (
      isBool(patch.on) &&
      isBool(patch.weeklyOn) &&
      isText(patch.title, CHORE_TITLE_MAX) &&
      isText(patch.emoji, EMOJI_MAX) &&
      (patch.barPct === undefined || isValidBar(patch.barPct))
    );
  }

  /** Which settings a patch changed, for `rewards-set`'s `detail` (never their text). */
  function rewardsDetail(patch: ChoreRewardsPatch): string {
    const parts: string[] = [];
    if (patch.on !== undefined) parts.push('on');
    if (patch.weeklyOn !== undefined) parts.push('weekly');
    if (patch.barPct !== undefined) parts.push('bar');
    if (patch.title !== undefined || patch.emoji !== undefined) parts.push('reward');
    return parts.join('+');
  }

  /**
   * Change the family's stars and rewards settings (on/off, the weekly reward, its name and emoji,
   * the bar). The next object is built from the PROJECTION's stored object at write time
   * (`settingsStore.setChoreRewards` hands it in), never this store's copy, which can lag: only
   * the patched keys change, and the worker merges per key. `applyRewardsPatch` stamps
   * `startedOn` on every turn-on from off. Turning it OFF (from on) first records every kid's
   * open week as it stands (`recordAtTurnOff`), so the week a pause starts in keeps its stars.
   */
  async function setRewards(patch: ChoreRewardsPatch, actorId: string): Promise<true | null> {
    const action = 'setRewards';
    if (!adultActor(actorId, action)) return null;
    if (!validRewardsPatch(patch)) return refuse('invalid', action);
    // Turning it off records the books as they stand, BEFORE the setting is written.
    if (patch.on === false && rewards.value.on) await recordAtTurnOff();
    const today = todayYmd.value;
    const ok = await write(action, async () => {
      await settingsStore.setChoreRewards((current) => applyRewardsPatch(current, patch, today));
      return true as const;
    });
    if (!ok) return null;
    log('info', 'rewards-set', {
      action: patch.on === true ? 'on' : patch.on === false ? 'off' : 'update',
      detail: rewardsDetail(patch),
    });
    return true;
  }

  /** An award draft as stored, or `null` when any field is out of bounds. */
  function cleanAward(
    draft: AwardDraft
  ): Omit<repo.CreateAwardInput, 'weekStart' | 'createdBy'> | null {
    const title = typeof draft.title === 'string' ? draft.title.trim() : '';
    const emoji = typeof draft.emoji === 'string' ? draft.emoji.trim() : '';
    if (!title || title.length > CHORE_TITLE_MAX || !emoji || emoji.length > EMOJI_MAX) return null;
    if (draft.kind !== 'week' && draft.kind !== 'saved') return null;
    if (draft.unit !== 'weeks' && draft.unit !== 'stars') return null;
    if (!isValidPrice(draft.price, draft.unit)) return null;
    // Absent = every kid (also when every kid is chosen); `null` = none of them earns stars.
    const memberIds = cleanAwardKids(draft.memberIds, earners.value);
    if (memberIds === null) return null;
    return {
      title,
      emoji,
      kind: draft.kind,
      unit: draft.unit,
      price: draft.price,
      // Saved only; absent = one time.
      repeats: draft.kind === 'saved' && draft.repeats === true ? true : undefined,
      memberIds,
    };
  }

  /**
   * Create an award (no `id`) or edit one (`id`). A new award counts from this week; an edit
   * keeps the week it counts from. Edited with a based patch, so a peer's edit to another field
   * is kept; `memberIds` travels whole (absent deletes it: every kid).
   */
  async function saveAward(
    draft: AwardDraft & { id?: string },
    actorId: string
  ): Promise<ChoreAward | null> {
    const action = 'saveAward';
    const actor = adultActor(actorId, action);
    if (!actor) return null;
    if (!rewards.value.on) return refuse('off', action);
    const clean = cleanAward(draft);
    if (!clean) return refuse('invalid', action);
    // `count`: how many kids it is for when chosen (0 = every kid). Never names.
    const logSaved = (verb: 'create' | 'update', a: ChoreAward) =>
      log('info', 'award-saved', {
        action: verb,
        kind: a.kind,
        detail: a.unit,
        count: a.memberIds?.length ?? 0,
      });
    if (draft.id) {
      const id = draft.id;
      if (!awards.value.some((a) => a.id === id)) return refuse('not-found', action);
      const updated = await write(action, async () => {
        const result = await repo.updateAward(id, clean);
        await refresh();
        // Gone: deleted on another device after this store last read it. A refusal, not a failure.
        return result ?? ('gone' as const);
      });
      if (!updated) return null;
      if (updated === 'gone') return refuse('not-found', action);
      logSaved('update', updated);
      return updated;
    }
    const created = await write(action, async () => {
      const award = await repo.createAward({
        ...clean,
        weekStart: currentWeekStart.value,
        createdBy: actor,
      });
      await refresh();
      return award;
    });
    if (!created) return null;
    logSaved('create', created);
    return created;
  }

  async function deleteAward(id: string, actorId: string): Promise<true | null> {
    const action = 'deleteAward';
    if (!adultActor(actorId, action)) return null;
    const current = awards.value.find((a) => a.id === id);
    if (!current) return refuse('not-found', action);
    const removed = await write(action, async () => {
      const ok = await repo.deleteAward(id);
      await refresh();
      return ok ? (true as const) : ('gone' as const);
    });
    if (!removed) return null;
    if (removed === 'gone') return refuse('not-found', action);
    log('info', 'award-saved', { action: 'delete', kind: current.kind, detail: current.unit });
    return true;
  }

  /**
   * Give a child bonus stars, or move some back (`kind: 'take'`, always open to a grown-up, with a
   * reason, and never more than the child has this week). Dated today.
   */
  async function giveStars(
    input: GiftInput & { memberId: string },
    actorId: string
  ): Promise<ChoreStarGift | null> {
    const action = 'giveStars';
    const actor = adultActor(actorId, action);
    if (!actor) return null;
    if (!rewards.value.on) return refuse('off', action);
    if (!earnerSet.value.has(input.memberId)) return refuse('not-earner', action);
    const week = weekFor(input.memberId);
    const why = giftRefusal(input, week, rewards.value);
    if (why === 'over-week') {
      const child = familyStore.members.find((m) => m.id === input.memberId);
      return refuse(why, action, { name: firstName(child?.name), count: week?.total ?? 0 });
    }
    if (why) return refuse(why, action);
    const note = input.note?.trim() || undefined;
    const gift = await write(action, async () => {
      const created = await repo.createGift({
        memberId: input.memberId,
        date: todayYmd.value,
        stars: input.kind === 'take' ? -input.count : input.count,
        by: actor,
        note,
      });
      await refresh();
      return created;
    });
    if (!gift) return null;
    log('info', 'stars-given', {
      action: input.kind === 'take' ? 'take' : 'give',
      count: input.count,
    });
    return gift;
  }

  /** Is this gift's day in its child's open week (a closed week is never changed)? */
  function inOpenWeek(gift: ChoreStarGift): boolean {
    const start = currentWeekStart.value;
    if (gift.date < start || gift.date > shiftChoreDay(start, 6)) return false;
    const covered = coveredDays(
      start,
      recordsOf(gift.memberId).map((w) => w.weekStart)
    );
    return !covered.has(gift.date);
  }

  /** Remove a bonus or take-back while its week is still open. */
  async function removeGift(id: string, actorId: string): Promise<true | null> {
    const action = 'removeGift';
    if (!adultActor(actorId, action)) return null;
    const gift = gifts.value.find((g) => g.id === id);
    if (!gift) return refuse('not-found', action);
    if (!inOpenWeek(gift)) return refuse('week-closed', action);
    const removed = await write(action, async () => {
      const ok = await repo.removeGift(id);
      await refresh();
      return ok ? (true as const) : ('gone' as const);
    });
    if (!removed) return null;
    if (removed === 'gone') return refuse('not-found', action);
    log('info', 'gift-removed', { action: gift.stars < 0 ? 'take' : 'give' });
    return true;
  }

  // ========== THE ACHIEVED MOMENT ==========

  /** `member:weekStart` whose reward mark this device is writing now (two ticks at once). */
  const rewarding = new Set<string>();
  /**
   * `member:weekStart` whose banner THIS device showed although its mark write failed: the
   * on-device latch, so it plays once here; the next tick retries the mark without a banner.
   */
  const shownUnmarked = new Set<string>();

  const isMarked = (memberId: string, weekStart: string) =>
    marksOn(choreStore.markIndex, memberId, weekStart).celebrated.has(REWARD_MARK_REF);

  /**
   * Called by EVERY tick path once `choreStore.toggleChore` resolved (`useChoreTicks.toggle` and
   * the chore writer in `useWallJobs`), not awaited. Decides by itself whether the outcome is a
   * landed tick, so the call sites hold no condition beyond `showsBanner`.
   *
   * The rule: after a kid's landed tick on a surface that draws the banner for that kid
   * (`showsBanner`), if their week has reached the weekly reward's bar NOW and the week has no
   * `reward` mark yet, the celebration is claimed and shown, in this order:
   *  1. wait for that kid's block celebration to end (`celebrateReward`);
   *  2. ask again whether the week is still at or above the bar (an untick meanwhile ends it
   *     quietly and writes nothing, so the re-tick plays it);
   *  3. write the once-only mark (`ifAbsent`) and show the banner only if THIS write created it.
   *     A failed write still shows the banner on this device (the `shownUnmarked` latch keeps it
   *     once here; the failure is reported by the chore store) and the next tick retries the
   *     mark silently. A mark another device wrote first shows nothing.
   * "Achieved now, not yet marked", never "this tick crossed the bar": two ticks that land
   * together across the bar both see a total already past it. A tick from a surface with no
   * banner (a grown-up on the Chores view's cards) claims nothing, and a bonus past the bar
   * plays nothing (no tick); in both cases the kid's next tick on their lane or day plays it.
   * Never throws; silent while the feature is off.
   */
  async function afterTick(input: AfterTickInput): Promise<void> {
    if (!rewards.value.on) return;
    const { memberId, outcome, surface, showsBanner } = input;
    const latch = { key: '' };
    try {
      if (!outcome || isChoreRefusal(outcome) || outcome.action !== 'tick') return;
      if (!showsBanner) return;
      if (!active.value || !rewards.value.weeklyOn || !earnerSet.value.has(memberId)) return;
      const week = weekFor(memberId);
      if (!week || !weeklyAchieved(week)) return;
      const weekStart = week.weekStart;
      const key = `${memberId}:${weekStart}`;
      // Another tick on this device is claiming it, or the week is already celebrated (the
      // normal state for every tick after the bar): nothing to do, nothing to log.
      if (rewarding.has(key) || isMarked(memberId, weekStart)) return;
      rewarding.add(key);
      latch.key = key;
      const writeMark = () =>
        choreStore.writeCelebratedMark(memberId, weekStart, REWARD_MARK_REF, memberId);
      if (shownUnmarked.has(key)) {
        // Shown here already; only the mark is owed. A failure was reported by the chore store.
        if ((await writeMark()) !== 'failed') shownUnmarked.delete(key);
        return;
      }
      let mark: Awaited<ReturnType<typeof writeMark>> | null = null;
      const child = familyStore.members.find((m) => m.id === memberId);
      const result = await celebrateReward({
        memberId,
        beanName: firstName(child?.name),
        title: rewards.value.title ?? '',
        emoji: rewards.value.emoji ?? '',
        stillAchieved: () => {
          const now = weekFor(memberId);
          return !!now && now.weekStart === weekStart && weeklyAchieved(now);
        },
        claim: async () => {
          mark = await writeMark();
          // `failed` (reported by the chore store, `celebrate-mark-failed`, slot `reward`) still
          // shows here, once; `exists` was another device's.
          if (mark === 'failed') shownUnmarked.add(key);
          return mark !== 'exists';
        },
      });
      if (result === 'claimed-elsewhere') {
        log('info', 'achieved-banner', { detail: 'skipped-exists' });
        return;
      }
      if (result !== 'dropped') {
        log('info', 'reward-achieved', {
          kind: 'weekly',
          detail: surface,
          stage: mark === 'failed' ? 'unmarked' : 'marked',
        });
      }
      log('info', 'achieved-banner', { detail: result });
    } catch (e) {
      reportError({
        surface: SURFACE,
        message:
          'the weekly reward check after a tick failed; the tick landed and no banner played',
        error: e,
        severity: 'warning',
        context: { action: 'achieved-check-failed' },
      });
    } finally {
      if (latch.key) rewarding.delete(latch.key);
    }
  }

  // ========== CLOSING A WEEK ==========

  /** The day each problem event was last logged: at most once per day per session each. */
  const loggedOn = new Map<DailyProblem, string>();

  function logDaily(problem: DailyProblem, count: number, today: string): void {
    if (count <= 0 || loggedOn.get(problem) === today) return;
    loggedOn.set(problem, today);
    if (problem === 'missed') log('warn', 'week-close-missed', { count });
    else
      log(problem === 'late' ? 'info' : 'warn', 'week-close-skipped', { detail: problem, count });
  }

  function logProblems(plan: WeekClosePlan, today: string): void {
    logDaily('late', plan.late, today);
    logDaily('fewer-marks', plan.fewer, today);
    logDaily('missed', plan.missed, today);
  }

  /** The plan's inputs other than the data arrays: the clock, settings and roster. */
  function planContext(): Omit<WeekCloseInput, 'chores' | 'marks' | 'gifts' | 'weeks'> {
    return {
      todayYmd: choreStore.todayYmd,
      weekStartDay: settingsStore.weekStartDay,
      rewards: rewards.value,
      earners: earners.value,
      living: choreStore.livingIds,
    };
  }

  let closing: Promise<void> | null = null;

  /**
   * Freeze every closed week that needs it (plan Approach 3, "Closing a week"). Never throws.
   * The store does the guards, the budget, ONE write and the logs; every decision is
   * `planWeekClose`. Cheap first: a plan over the store's own arrays, and with nothing to write
   * it stops there (no projection read, no budget). Otherwise the PROJECTION is read and planned
   * again, and only that second plan is written: a stale store can delay a close, never shape a
   * write. Single-flight: a call while one runs shares it.
   */
  function closeWeeks(): Promise<void> {
    if (!closing) {
      closing = runClose().finally(() => {
        closing = null;
      });
    }
    return closing;
  }

  async function runClose(): Promise<void> {
    if (!CHORE_WEEK_CLOSE_ENABLED) return;
    // Off is the normal state for most families (and unloaded settings read as off): silent.
    if (!rewards.value.on) return;
    if (!isDocLoaded() || !choreStore.isLoaded || !isLoaded.value) {
      log('warn', 'week-close-skipped', { detail: 'not-loaded' });
      return;
    }
    const ctx = planContext();
    try {
      const cheap = planWeekClose({
        ...ctx,
        chores: choreStore.chores,
        marks: choreStore.choreMarks,
        gifts: gifts.value,
        weeks: weeks.value,
      });
      if (!cheap.write.length) {
        logProblems(cheap, ctx.todayYmd);
        return;
      }
      const [chores, marks, storedGifts, stored] = await Promise.all([
        choreRepo.getAllChores(),
        choreRepo.getAllChoreMarks(),
        repo.getAllGifts(),
        repo.getAllChoreWeeks(),
      ]);
      const plan = planWeekClose({ ...ctx, chores, marks, gifts: storedGifts, weeks: stored });
      logProblems(plan, ctx.todayYmd);
      if (!plan.write.length) return;
      // An automatic write, bounded; a refusal reports itself and a later run retries.
      if (!takeAutoWrite(CLOSE_WRITER)) return;
      await repo.setChoreWeeks(plan.write);
      weeks.value = await repo.getAllChoreWeeks();
      log('info', 'week-closed', {
        count: plan.write.length,
        detail: `created:${plan.created}+resettled:${plan.resettled}`,
      });
    } catch (e) {
      reportError({
        surface: SURFACE,
        message:
          'the chore week close failed; nothing was written and it retries on the next app load or day change',
        error: e,
        severity: 'warning',
        context: { action: 'week-close-failed' },
      });
    }
  }

  /**
   * The turn-off (`setRewards`, on to off): record the books as they stand, before the setting
   * is written. One plan over the PROJECTION through `planWeekClose` with `includeOpen` (each
   * kid's open week as of now, plus any closed week the close would still write), one
   * `setChoreWeeks` batch. A grown-up's action, so no automatic-write budget. If it fails the
   * turn-off still goes ahead: the failure is reported (a warning, never silent) and nothing
   * else is lost, because the close still freezes the closed weeks after a later turn-on.
   */
  async function recordAtTurnOff(): Promise<void> {
    if (!CHORE_WEEK_CLOSE_ENABLED) return;
    if (!isDocLoaded()) {
      log('warn', 'week-recorded-at-off', { detail: 'not-loaded', count: 0 });
      return;
    }
    try {
      // A close already running writes the same deterministic records; let it finish first.
      if (closing) await closing;
      const [chores, marks, storedGifts, stored] = await Promise.all([
        choreRepo.getAllChores(),
        choreRepo.getAllChoreMarks(),
        repo.getAllGifts(),
        repo.getAllChoreWeeks(),
      ]);
      const plan = planWeekClose({
        ...planContext(),
        chores,
        marks,
        gifts: storedGifts,
        weeks: stored,
        includeOpen: true,
      });
      if (plan.write.length) {
        await repo.setChoreWeeks(plan.write);
        weeks.value = await repo.getAllChoreWeeks();
      }
      log('info', 'week-recorded-at-off', {
        count: plan.write.length,
        detail: `created:${plan.created}+resettled:${plan.resettled}`,
      });
    } catch (e) {
      reportError({
        surface: SURFACE,
        message:
          "turning stars off could not record this week's stars first; the feature was still turned off",
        error: e,
        severity: 'warning',
        context: { action: 'off-record-failed' },
      });
    }
  }

  watch(
    () => choreStore.todayYmd,
    () => {
      // Not on snapshot copies; the maintenance run after the authoritative reload covers it.
      if (!storesAuthoritative.value) return;
      void closeWeeks();
    }
  );
  registerLoadMaintenance(CLOSE_WRITER, closeWeeks);

  function resetState(): void {
    awards.value = [];
    gifts.value = [];
    weeks.value = [];
    isLoading.value = false;
    error.value = null;
    isLoaded.value = false;
    loggedOn.clear();
    rewarding.clear();
    shownUnmarked.clear();
  }

  return {
    // State
    awards,
    gifts,
    weeks,
    isLoading,
    error,
    isLoaded,
    // Getters
    rewards,
    isOn,
    earners,
    earnerMembers,
    sortedAwards,
    weekFor,
    awardsFor,
    arcFor,
    stripFor,
    notesFor,
    lookbackWeeks,
    valueFor,
    wallStarsFor,
    // Actions
    loadStars,
    setRewards,
    saveAward,
    deleteAward,
    giveStars,
    removeGift,
    afterTick,
    closeWeeks,
    resetState,
  };
});
