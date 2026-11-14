/**
 * The choreboard (#146): the chore store. Orchestration only (MVO): views read it and emit
 * intents; every rule lives in the pure `utils/chores.ts`, every write in
 * `choreRepository.ts`.
 *
 * Action contract (one report per failure, never silent):
 *   - Writes run inside `wrapAsync(..., { action, surface: 'choreboard' })`, whose toast is
 *     also the report. Wall ticks pass `errorToast: false`, because `useWallJobs.write()`
 *     already reports a failed toggle (`reportJobToggleFailed`): one report on either surface.
 *   - An action resolves its result on success and `null` otherwise. Every `null` has already
 *     been shown and logged, so callers branch on `null` and NEVER toast again.
 *   - Refusals (a child, a deleted chore, not an assignee, not today, bad hours) are info
 *     toasts plus an `edit-refused` warn: nothing broke, so nothing is reported. The tick path
 *     answers a refusal with a tagged `{ action: 'refused' }` rather than `null`, so the wall
 *     (which reports a `null` tick as a failed write) can tell "refused and already told" from
 *     "failed" (`isChoreRefusal`).
 *   - The store writes and then re-reads the projection, so there is no optimistic state to
 *     roll back: a failed tick simply does not appear ticked.
 *
 * Grown-up actions take an explicit `actorId` (the session member on the page; the member who
 * unlocked on the wall) and check that member is an adult. The store never reads the wall
 * lock. Telemetry carries counts, blocks and enums only: a chore title never leaves the device.
 *
 * DEPENDENCY DIRECTION (one-way): this store imports only `familyStore`, `settingsStore`,
 * `translationStore` and its repository. Surfaces (the page, the wall, the briefing, the
 * widget) consume it, never the reverse.
 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { showToast } from '@/composables/useToast';
import { celebrateChore, holdChoreBlock, releaseChoreBlock } from '@/composables/useCelebration';
import { useChoreClock } from '@/composables/useChoreClock';
import { isAdultMember } from '@/composables/useMemberInfo';
import { isDocLoaded } from '@/services/automerge/docService';
import * as repo from '@/services/automerge/repositories/choreRepository';
import type { CreateChoreInput } from '@/services/automerge/repositories/choreRepository';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import { takeAutoWrite } from '@/utils/autoWriteBudget';
import { clockVerdict, createSweepClock, CHORE_MARK_SWEEP_KEY } from '@/utils/cycleSweepClock';
import { generateUUID } from '@/utils/id';
import {
  CHORE_MARK_SWEEP_ENABLED,
  beanChoreDay,
  blockStarts,
  choreBlockOf,
  choreMarkId,
  choreOccursOn,
  choreDupKey,
  completesBlock,
  expiredMarkIds,
  indexMarks,
  isChoreBlock,
  isValidBlockStarts,
  normalizeChoreDays,
  orphanChores,
  sameChoreMoment,
  sortChores,
  choreWeekRecord,
  type BeanChoreDay,
  type ChoreClock,
  type ChoreRefusal,
  type ChoreTickRefused,
  type ChoreWeekRecord,
} from '@/utils/chores';
import { choreStarterSet, type StarterChoreDraft } from '@/constants/choreStarterSets';
export type { StarterChoreDraft } from '@/constants/choreStarterSets';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ChoreCelebrationAnchor } from '@/utils/choreCelebration';
import { firstName } from '@/utils/assignees';
import type { Chore, ChoreBlock, ChoreBlockStarts, ChoreMark } from '@/types/models';

const SURFACE = 'choreboard';

export type { ChoreRefusal, ChoreTickRefused } from '@/utils/chores';

const REFUSAL_MESSAGE: Record<ChoreRefusal, UIStringKey> = {
  'not-adult': 'choreboard.error.notAdult',
  'not-yours': 'choreboard.error.notYours',
  'not-assigned': 'choreboard.error.notAssigned',
  'not-today': 'choreboard.error.notToday',
  'not-found': 'choreboard.error.notFound',
  'bad-hours': 'choreboard.error.badHours',
  invalid: 'choreboard.error.invalid',
  exists: 'choreboard.error.exists',
};

/** Where a tick came from. The wall passes who is credited; the page derives it from the session. */
export interface ToggleChoreOpts {
  surface: 'app' | 'wall';
  /** Wall only: who is credited (the lane's bean when locked). Ignored on `app`. */
  by?: string;
  /**
   * Where the all-done celebration plays if this tick finishes its block: the tick surface's
   * block and tick, measured at the tap (#146). Passed to `celebrateChore` untouched; absent,
   * the celebration plays centered.
   */
  anchor?: ChoreCelebrationAnchor | null;
}

/** A tick or an untick that landed. */
export interface ToggleChoreResult {
  action: 'tick' | 'untick';
  /** The block this tick finished, or `null`. */
  completed: ChoreBlock | null;
  /** This tick wrote the block's once-only `celebrated` mark (and played the celebration). */
  celebrated: boolean;
}

/** What `toggleChore` answers: a landed tick or untick, a refusal, or `null` for a failed write. */
export type ToggleChoreOutcome = ToggleChoreResult | ChoreTickRefused;

/** What a grown-up types or picks for a new chore. */
export interface ChoreDraft {
  title: string;
  emoji: string;
  illustration?: string;
  assigneeIds: string[];
  block: ChoreBlock;
  /** Weekdays 0-6; empty or absent = every day. */
  days?: number[];
  /**
   * Keep Parents Posted. Leave it out and the store decides from the beans' lists
   * (`notifyFor`); only the bean editor passes it, for a bean with no chores yet.
   */
  notifyParents?: boolean;
}

/** What a row edit can change on a chore (the bean's chore list). */
export type ChoreEdit = Partial<
  Pick<ChoreDraft, 'title' | 'emoji' | 'illustration' | 'block' | 'days'>
>;

/**
 * Which grown-up surface made an edit, for the firehose (logged as `kind`, an allowlisted key).
 * Absent for the other surfaces (the Add Chores sheet, Copy, the wall).
 */
export type ChoreEditVia = 'bean-editor';

/** The optional tail of a grown-up action: where it came from. */
export interface ChoreEditOpts {
  via?: ChoreEditVia;
}

/** `createChore`'s tail: also the new chore's id, when the caller minted it (a row's key). */
export interface CreateChoreOpts extends ChoreEditOpts {
  id?: string;
}

/** `{ kind: via }` for a log context, or nothing. */
const viaContext = (via: ChoreEditVia | undefined) => (via ? { kind: via } : {});

/** What a batch action added and skipped as a duplicate (same title in the same block). */
export interface ChoreBatchResult {
  added: number;
  skipped: number;
}

export const useChoreStore = defineStore('chores', () => {
  const familyStore = useFamilyStore();
  const settingsStore = useSettingsStore();
  const { choreClock } = useChoreClock();

  const chores = ref<Chore[]>([]);
  const choreMarks = ref<ChoreMark[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  /** True once `loadChores()` has read the document. */
  const isLoaded = ref(false);

  // ========== GETTERS ==========

  /** Members a chore can be for: living, non-pet people. Pets are never assignees. */
  const livingIds = computed(() => new Set(familyStore.humans.map((m) => m.id)));
  /** THE mark index; `indexMarks` is the only reader of the raw marks. */
  const markIndex = computed(() => indexMarks(choreMarks.value));
  const starts = computed<ChoreBlockStarts>(() => blockStarts(settingsStore.settings));
  const sortedChores = computed(() => sortChores(chores.value));
  /** Chores with no living assignee: the grown-ups' "No one's" group. */
  const orphans = computed(() => orphanChores(chores.value, livingIds.value));

  /**
   * The clock as chore STATE sees it. `beanChoreDay` reads the minute only through
   * `currentBlock` (`isNow`, and `ended`, which is "the current block is later than this one"),
   * so while the day and the current block are unchanged this keeps the SAME object and every
   * reader (the wall's job build, the whole briefing) is not re-run by the one-minute clock.
   * It moves at a block boundary, at midnight, and when the hours change.
   */
  const dayClock = computed<ChoreClock>((prev) => {
    const next = choreClock.value;
    return prev && sameChoreMoment(prev, next, starts.value) ? prev : { ...next };
  });

  /** Today's date as chore state sees it: moves at midnight, never with the minute. */
  const todayYmd = computed(() => dayClock.value.ymd);

  function choreById(id: string): Chore | undefined {
    return chores.value.find((c) => c.id === id);
  }

  /** A bean's chore day NOW: the getter every surface reads. */
  function choreDayFor(memberId: string): BeanChoreDay {
    return beanChoreDay(
      chores.value,
      markIndex.value,
      memberId,
      dayClock.value,
      starts.value,
      livingIds.value
    );
  }

  /**
   * A bean's week (the Chores Done board): one `choreDayRecord` per day for the week holding
   * `weekOfYmd`, today by default. Reads the day clock, never the minute clock, so a board built
   * on it is not rebuilt every minute.
   */
  function weekFor(memberId: string, weekOfYmd: string = todayYmd.value): ChoreWeekRecord {
    return choreWeekRecord(
      chores.value,
      markIndex.value,
      memberId,
      weekOfYmd,
      settingsStore.weekStartDay,
      livingIds.value
    );
  }

  // ========== TELEMETRY + REFUSALS ==========

  function log(level: 'info' | 'warn', message: string, context?: Record<string, unknown>): void {
    logEvent({ level, surface: SURFACE, message, context });
  }

  function t(key: UIStringKey): string {
    return useTranslationStore().t(key);
  }

  /** A toast and a log, never a throw. Always `null`, so a caller can `return refuse(...)`. */
  function refuse(detail: ChoreRefusal, action: string): null {
    showToast('info', t(REFUSAL_MESSAGE[detail]));
    log('warn', 'edit-refused', { action, detail });
    return null;
  }

  /** `refuse` for the tick path: the same toast and log, answered as a tagged refusal. */
  function refuseTick(detail: ChoreRefusal): ChoreTickRefused {
    refuse(detail, 'toggleChore');
    return { action: 'refused', detail };
  }

  /** The actor, when they are an adult member; otherwise the refusal has been shown. */
  function adultActor(actorId: string | null | undefined, action: string): string | null {
    const actor = actorId ? familyStore.members.find((m) => m.id === actorId) : undefined;
    if (!actor || !isAdultMember(actor)) return refuse('not-adult', action);
    return actor.id;
  }

  /** `ids` kept to living people (no pets), deduped. An unloaded roster prunes nothing. */
  function keepLiving(ids: readonly string[]): string[] {
    const wanted = [...new Set(ids.filter(Boolean))];
    return livingIds.value.size > 0 ? wanted.filter((id) => livingIds.value.has(id)) : wanted;
  }

  function nextSortOrder(): number {
    return chores.value.reduce((max, c) => Math.max(max, c.sortOrder ?? 0), -1) + 1;
  }

  /**
   * Keep Parents Posted for a NEW chore of `memberId`'s, decided here once for every create path
   * (the bean editor, the Add Chores sheet, Copy, the wall): on when the bean is a child and every
   * chore of theirs has it, which is exactly when the bean editor's one switch reads as on, so
   * adding a chore anywhere never turns that switch off. A bean with no chores takes `fallback`
   * (off, or the copied chore's own flag). A grown-up's chores never get it.
   */
  function notifyFor(memberId: string, fallback = false): boolean {
    const bean = familyStore.members.find((m) => m.id === memberId);
    if (!bean || isAdultMember(bean)) return false;
    const theirs = chores.value.filter((c) => (c.assigneeIds ?? []).includes(memberId));
    return theirs.length ? theirs.every((c) => c.notifyParents === true) : fallback;
  }

  /** Run a write under the one error contract. `undefined` from `wrapAsync` becomes `null`. */
  async function write<T>(
    action: string,
    fn: () => Promise<T>,
    opts: { errorToast?: boolean } = {}
  ): Promise<T | null> {
    const result = await wrapAsync(isLoading, error, fn, {
      action: `choreStore:${action}`,
      surface: SURFACE,
      errorToast: opts.errorToast ?? true,
    });
    return result === undefined ? null : result;
  }

  // ========== LOAD ==========

  async function refresh(): Promise<void> {
    const [c, m] = await Promise.all([repo.getAllChores(), repo.getAllChoreMarks()]);
    chores.value = c;
    choreMarks.value = m;
  }

  async function loadChores(): Promise<void> {
    // No-op until the Automerge doc is loaded; the central load sequence re-runs it.
    if (!isDocLoaded()) return;
    await wrapAsync(
      isLoading,
      error,
      async () => {
        await refresh();
        isLoaded.value = true;
      },
      { action: 'choreStore:loadChores', surface: SURFACE }
    );
    // Where the list cycle sweep runs: on open and after each remote merge (both reload the
    // stores). The day cursor makes it at most once per device per day.
    await sweepExpiredMarks();
  }

  // ========== TICKING ==========

  /**
   * Blocks whose `celebrated` mark this device is writing right now, keyed
   * `member:day:block`. Two ticks that finish the same block at once on one device (two
   * different chores in flight together) both see it complete after their writes land; only
   * the first to claim the key writes the mark and celebrates. Across devices the deterministic
   * id plus `ifAbsent` does the same job.
   */
  const celebrating = new Set<string>();

  /**
   * THE one tick path, for the page and the wall. Every guard runs before any write:
   * the chore exists, `memberId` is one of its (living) assignees, it occurs TODAY (the date
   * is always the chore clock's, never a parameter), and on the page a non-adult may only
   * tick their own chores, credited to themselves. Only the wall passes `by`.
   *
   * A tick that finishes a block writes the `done` mark and, when the block has not
   * celebrated today, its `celebrated` mark, in ONE `ifAbsent` batch; the celebration plays
   * only when THIS write created that mark, so it plays once per bean, block and day on every
   * device. Completion is decided before the write from the marks this store has read, and
   * checked again AFTER it from the refreshed marks: when another tick of the same block
   * landed between the two (two different chores ticked in quick succession), the block is
   * found complete only afterwards, and its `celebrated` mark is written then (`finishLate`).
   *
   * Resolves the landed tick or untick, a `ChoreTickRefused` when a guard refused (already
   * toasted and logged), or `null` for a failed write (`useWallJobs` reports that one).
   */
  async function toggleChore(
    choreId: string,
    memberId: string,
    opts: ToggleChoreOpts
  ): Promise<ToggleChoreOutcome | null> {
    const action = 'toggleChore';
    const chore = choreById(choreId);
    if (!chore) return refuseTick('not-found');
    if (!(chore.assigneeIds ?? []).includes(memberId) || !livingIds.value.has(memberId)) {
      return refuseTick('not-assigned');
    }
    const clock = choreClock.value;
    if (!choreOccursOn(chore, clock.ymd)) return refuseTick('not-today');

    let by: string;
    if (opts.surface === 'app') {
      const me = familyStore.currentMember;
      if (!me || (!isAdultMember(me) && me.id !== memberId)) return refuseTick('not-yours');
      by = me.id;
    } else {
      by = opts.by ?? memberId;
    }

    const day = choreDayFor(memberId);
    const block = choreBlockOf(chore);
    const doneId = choreMarkId('done', memberId, clock.ymd, choreId);
    const wasDone = markIndex.value.get(memberId)?.get(clock.ymd)?.done.has(choreId) ?? false;
    const errorToast = opts.surface !== 'wall';

    if (wasDone) {
      const ok = await write(
        action,
        async () => {
          await repo.removeChoreMark(doneId);
          choreMarks.value = await repo.getAllChoreMarks();
          return true as const;
        },
        { errorToast }
      );
      if (!ok) return null;
      log('info', 'chore-ticked', { action: 'untick', slot: block, kind: opts.surface });
      return { action: 'untick', completed: null, celebrated: false };
    }

    const completed = completesBlock(day, choreId);
    const completedBlock = completed ? day.blocks.find((b) => b.block === completed) : undefined;
    const base = { memberId, date: clock.ymd, by };
    const items: { id: string; input: repo.ChoreMarkInput }[] = [
      { id: doneId, input: { ...base, kind: 'done', ref: choreId } },
    ];
    const latch = `${memberId}:${clock.ymd}:${block}`;
    // Another tick of this block is writing its celebrated mark right now: that tick owns the
    // completion (its log, its celebration), so this one is a plain tick.
    const latchHeld = celebrating.has(latch);
    const celebratedId =
      completed && !completedBlock?.celebrated && !latchHeld
        ? choreMarkId('celebrated', memberId, clock.ymd, completed)
        : null;
    if (celebratedId && completed) {
      items.push({ id: celebratedId, input: { ...base, kind: 'celebrated', ref: completed } });
      celebrating.add(latch);
    }
    // This tick should celebrate, from a surface on screen: hold the block's rows BEFORE the
    // refreshed marks make it "done", so the surface never tears down the tick the celebration
    // starts from. Released by the celebration, or below when it will not play.
    const holding = !!celebratedId && !!completed && !!opts.anchor;
    if (holding) holdChoreBlock(memberId, block);
    let created: ChoreMark[] | null = null;
    try {
      created = await write(
        action,
        async () => {
          const written = await repo.setChoreMarks(items, { ifAbsent: true });
          choreMarks.value = await repo.getAllChoreMarks();
          return written;
        },
        { errorToast }
      );
    } finally {
      if (celebratedId) celebrating.delete(latch);
      if (holding && !created) releaseChoreBlock(memberId, block);
    }
    if (!created) return null;
    log('info', 'chore-ticked', { action: 'tick', slot: block, kind: opts.surface });

    if (completed) {
      if (latchHeld) return { action: 'tick', completed, celebrated: false };
      // Another device may have written the celebrated mark meanwhile (`ifAbsent` then skipped
      // it): banner only, never a second celebration.
      const celebrated = !!celebratedId && created.some((m) => m.id === celebratedId);
      log('info', 'block-complete', {
        slot: completed,
        count: completedBlock?.total ?? 0,
        detail: celebrated ? 'celebrated' : 'banner-only',
      });
      if (celebrated) celebrateBlock(memberId, completed, completedBlock?.total ?? 0, opts.anchor);
      else if (holding) releaseChoreBlock(memberId, block);
      return { action: 'tick', completed, celebrated };
    }

    const late = await finishLate(memberId, clock.ymd, block, by, latch, opts.anchor);
    return { action: 'tick', completed: late.completed, celebrated: late.celebrated };
  }

  /** Play the all-done celebration for the bean's block: their first name, one star per chore. */
  function celebrateBlock(
    memberId: string,
    block: ChoreBlock,
    count: number,
    anchor: ChoreCelebrationAnchor | null | undefined
  ): void {
    const member = familyStore.members.find((m) => m.id === memberId);
    celebrateChore({
      memberId,
      block,
      beanName: firstName(member?.name),
      count,
      anchor,
      stillDone: () =>
        choreDayFor(memberId).blocks.find((b) => b.block === block)?.allDone ?? false,
    });
  }

  /**
   * After a tick that did NOT look like it finished its block: is the block complete now that
   * the refreshed marks are in (another tick of it landed in between)? If so, and nobody has
   * celebrated it, write the `celebrated` mark (`ifAbsent`) under the per-device latch and
   * celebrate when THIS write created it. A block that is complete but already celebrated was
   * finished and logged by the tick that celebrated it, so nothing is logged twice.
   *
   * The tick itself has landed, so a failure here does not fail the tick: it is reported as a
   * warning (no toast, no page) and the banner still shows from the `done` marks.
   */
  async function finishLate(
    memberId: string,
    ymd: string,
    block: ChoreBlock,
    by: string,
    latch: string,
    anchor?: ChoreCelebrationAnchor | null
  ): Promise<{ completed: ChoreBlock | null; celebrated: boolean }> {
    const after = choreDayFor(memberId).blocks.find((b) => b.block === block);
    if (!after?.allDone) return { completed: null, celebrated: false };
    if (after.celebrated || celebrating.has(latch)) return { completed: block, celebrated: false };
    celebrating.add(latch);
    try {
      const id = choreMarkId('celebrated', memberId, ymd, block);
      const created = await write(
        'celebrateBlock',
        async () => {
          const written = await repo.setChoreMarks(
            [{ id, input: { memberId, date: ymd, by, kind: 'celebrated', ref: block } }],
            { ifAbsent: true }
          );
          choreMarks.value = await repo.getAllChoreMarks();
          return written;
        },
        { errorToast: false }
      );
      if (!created) {
        reportError({
          surface: SURFACE,
          message:
            'the celebrated mark for a block finished by two quick ticks could not be written; the ticks landed and the banner shows',
          severity: 'warning',
          context: { action: 'celebrate-late-failed', slot: block },
        });
        return { completed: block, celebrated: false };
      }
      const celebrated = created.some((m) => m.id === id);
      if (celebrated) {
        log('info', 'block-complete', { slot: block, count: after.total, detail: 'celebrated' });
        celebrateBlock(memberId, block, after.total, anchor);
      }
      return { completed: block, celebrated };
    } finally {
      celebrating.delete(latch);
    }
  }

  // ========== GROWN-UP ACTIONS ==========

  /** A draft as stored, or `null` when it has no title or no living assignee. */
  function cleanDraft(draft: ChoreDraft): Omit<CreateChoreInput, 'sortOrder' | 'createdBy'> | null {
    const title = draft.title.trim();
    const assigneeIds = keepLiving(draft.assigneeIds);
    if (!title || assigneeIds.length === 0 || !isChoreBlock(draft.block)) return null;
    return {
      title,
      emoji: draft.emoji,
      illustration: draft.illustration || undefined,
      assigneeIds,
      block: draft.block,
      days: normalizeChoreDays(draft.days),
      notifyParents: (draft.notifyParents ?? assigneeIds.every((id) => notifyFor(id))) || undefined,
    };
  }

  /**
   * Create one chore: the wall's add and a new row in the bean editor, ONE write path. Keep
   * Parents Posted follows the beans' lists unless the draft says (`notifyFor`). The id is
   * `opts.id` when the caller minted it (the bean editor's row key), else a fresh one; the write
   * is `ifAbsent`, so an id that already exists is the `exists` refusal, never an overwrite.
   */
  async function createChore(
    draft: ChoreDraft,
    actorId: string,
    opts: CreateChoreOpts = {}
  ): Promise<Chore | null> {
    const action = 'createChore';
    const actor = adultActor(actorId, action);
    if (!actor) return null;
    const clean = cleanDraft(draft);
    if (!clean) return refuse('invalid', action);
    const id = opts.id ?? generateUUID();
    if (choreById(id)) return refuse('exists', action);
    const created = await write(action, async () => {
      const input = { ...clean, sortOrder: nextSortOrder(), createdBy: actor };
      const written = await repo.createChores([{ id, input }], { ifAbsent: true });
      await refresh();
      if (!written.length) return 'exists' as const;
      const chore = choreById(id);
      // Written but not read back: a real failure, so `write` toasts and reports it.
      if (!chore) throw new Error('created chore missing from the projection');
      return chore;
    });
    if (!created) return null;
    // Already in the document though not yet in this store's last read (another device).
    if (created === 'exists') return refuse('exists', action);
    log('info', 'chore-saved', {
      action: 'create',
      slot: created.block,
      count: created.assigneeIds.length,
      ...viaContext(opts.via),
    });
    return created;
  }

  /**
   * Edit a chore (a row in a bean's chore list). Dead assignee ids are pruned on the way (as
   * `listStore.setAssignees` does); a chore left with no living assignee is refused. `days: []`
   * clears the days (every day); a cleared `illustration` is removed. Who a chore is for is
   * never edited here, and Keep Parents Posted has its own action (`setNotifyParentsFor`).
   */
  async function updateChore(
    id: string,
    patch: ChoreEdit,
    actorId: string,
    opts: ChoreEditOpts = {}
  ): Promise<Chore | null> {
    const action = 'updateChore';
    const actor = adultActor(actorId, action);
    if (!actor) return null;
    const current = choreById(id);
    if (!current) return refuse('not-found', action);
    const input: repo.UpdateChoreInput = {};
    if (patch.title !== undefined) {
      if (!patch.title.trim()) return refuse('invalid', action);
      input.title = patch.title.trim();
    }
    if (patch.emoji !== undefined) input.emoji = patch.emoji;
    if ('illustration' in patch) input.illustration = patch.illustration || undefined;
    if (patch.block !== undefined) {
      if (!isChoreBlock(patch.block)) return refuse('invalid', action);
      input.block = patch.block;
    }
    if ('days' in patch) {
      input.days = normalizeChoreDays(patch.days);
      // Stamp a REAL change only, so the board knows earlier days ran on other weekdays.
      const before = (normalizeChoreDays(current.days) ?? []).join(',');
      if ((input.days ?? []).join(',') !== before) input.daysChangedAt = new Date().toISOString();
    }
    const kept = keepLiving(current.assigneeIds ?? []);
    if (kept.length === 0) return refuse('invalid', action);
    if (kept.length !== (current.assigneeIds ?? []).length) input.assigneeIds = kept;
    const updated = await write(action, async () => {
      const result = await repo.updateChore(id, input);
      await refresh();
      // The repository answers `undefined` when the chore is gone: deleted on another device
      // after this store last read it. That is a refusal to tell the family, not a failure.
      return result ?? ('gone' as const);
    });
    if (!updated) return null;
    if (updated === 'gone') return refuse('not-found', action);
    log('info', 'chore-saved', {
      action: 'update',
      slot: updated.block,
      count: updated.assigneeIds.length,
      ...viaContext(opts.via),
    });
    return updated;
  }

  /** Delete a chore. Its old `done` marks stay (readers ignore them; weekly counts keep them). */
  async function deleteChore(id: string, actorId: string): Promise<true | null> {
    const action = 'deleteChore';
    if (!adultActor(actorId, action)) return null;
    const current = choreById(id);
    if (!current) return refuse('not-found', action);
    const ok = await write(action, async () => {
      await repo.deleteChore(id);
      await refresh();
      return true as const;
    });
    if (!ok) return null;
    log('info', 'chore-saved', {
      action: 'delete',
      slot: choreBlockOf(current),
      count: (current.assigneeIds ?? []).length,
    });
    return true;
  }

  /**
   * Put `orderedIds` (a block's chores in a bean's chore list, as a grown-up dragged them) in that
   * order, in ONE change. The ids keep the positions they already hold in the family's one chore
   * order (`sortChores`) and only swap among themselves, then the whole collection is renumbered
   * 0..n-1, so no two chores can end up sharing a `sortOrder` and every other chore keeps its
   * place, a chore hidden today (another weekday) included. Only chores whose number changes are
   * patched. Unknown ids are skipped.
   */
  async function reorderChores(
    orderedIds: readonly string[],
    actorId: string,
    opts: ChoreEditOpts = {}
  ): Promise<true | null> {
    const action = 'reorderChores';
    if (!adultActor(actorId, action)) return null;
    const known = [...new Set(orderedIds)].filter((id) => choreById(id));
    if (known.length < 2) return true;
    const moving = new Set(known);
    let next = 0;
    const order = sortedChores.value.map((c) => (moving.has(c.id) ? known[next++]! : c.id));
    const patches = order.flatMap((id, i) =>
      choreById(id)?.sortOrder === i ? [] : [{ id, patch: { sortOrder: i } }]
    );
    if (!patches.length) return true;
    const ok = await write(action, async () => {
      await repo.updateChores(patches);
      await refresh();
      return true as const;
    });
    if (!ok) return null;
    log('info', 'chore-saved', {
      action: 'update',
      detail: 'reorder',
      count: known.length,
      ...viaContext(opts.via),
    });
    return true;
  }

  /**
   * Take chores off ONE bean's board, in ONE change (a row's ✕ and Remove All in the bean's chore
   * list). A chore that has no other living bean is deleted; a chore
   * shared with others keeps them and loses only `memberId` (dead ids pruned on the way, as
   * `updateChore` does). Ids that are gone or not this bean's are skipped. Old marks stay; the
   * retention sweep ages them out and every reader ignores a mark for an unknown chore.
   *
   * Telemetry (no titles): `chores-removed` with `count` = chores touched and `detail` =
   * `deleted:<n>+unassigned:<n>`.
   */
  async function removeChoresForMember(
    choreIds: readonly string[],
    memberId: string,
    actorId: string,
    opts: ChoreEditOpts = {}
  ): Promise<{ deleted: number; unassigned: number } | null> {
    const action = 'removeChoresForMember';
    if (!adultActor(actorId, action)) return null;
    const mine = [...new Set(choreIds)]
      .map((id) => choreById(id))
      .filter((c): c is Chore => !!c && (c.assigneeIds ?? []).includes(memberId));
    if (mine.length === 0) return refuse('not-found', action);
    const deleteIds: string[] = [];
    const reassign: { id: string; assigneeIds: string[] }[] = [];
    for (const c of mine) {
      const rest = keepLiving((c.assigneeIds ?? []).filter((id) => id !== memberId));
      if (rest.length === 0) deleteIds.push(c.id);
      else reassign.push({ id: c.id, assigneeIds: rest });
    }
    const ok = await write(action, async () => {
      await repo.removeChores(deleteIds, reassign);
      await refresh();
      return true as const;
    });
    if (!ok) return null;
    log('info', 'chores-removed', {
      count: mine.length,
      detail: `deleted:${deleteIds.length}+unassigned:${reassign.length}`,
      ...viaContext(opts.via),
    });
    return { deleted: deleteIds.length, unassigned: reassign.length };
  }

  /**
   * Keep Parents Posted for a bean's WHOLE chore list (the bean editor's one switch): write
   * `notifyParents = on` on every chore of `memberId`'s that does not already have it, in ONE
   * change. There is no per-list flag in the data: the switch reads as on when every chore of the
   * bean has it, so a chore shared with another bean carries the flag for both. Nothing to change
   * is a success that writes nothing.
   *
   * Telemetry: `notify-parents-set` with `action` on/off and `count` = chores changed.
   */
  async function setNotifyParentsFor(
    memberId: string,
    on: boolean,
    actorId: string,
    opts: ChoreEditOpts = {}
  ): Promise<{ count: number } | null> {
    const action = 'setNotifyParentsFor';
    if (!adultActor(actorId, action)) return null;
    if (!livingIds.value.has(memberId)) return refuse('invalid', action);
    const patches = chores.value
      .filter((c) => (c.assigneeIds ?? []).includes(memberId) && (c.notifyParents === true) !== on)
      .map((c) => ({ id: c.id, patch: { notifyParents: on } }));
    if (patches.length) {
      const ok = await write(action, async () => {
        await repo.updateChores(patches);
        await refresh();
        return true as const;
      });
      if (!ok) return null;
    }
    log('info', 'notify-parents-set', {
      action: on ? 'on' : 'off',
      count: patches.length,
      ...viaContext(opts.via),
    });
    return { count: patches.length };
  }

  /** The family's block start hours. Refused unless morning < afternoon < evening. */
  async function setBlockStarts(next: ChoreBlockStarts, actorId: string): Promise<true | null> {
    const action = 'setBlockStarts';
    if (!adultActor(actorId, action)) return null;
    if (!isValidBlockStarts(next)) return refuse('bad-hours', action);
    const ok = await write(action, async () => {
      await settingsStore.setChoreBlockStarts(next);
      return true as const;
    });
    if (!ok) return null;
    log('info', 'hours-set');
    return true;
  }

  /** Does `memberId` already have a chore with this title in this block? */
  function hasSameChore(
    memberId: string,
    title: string,
    block: ChoreBlock,
    pending: readonly CreateChoreInput[]
  ): boolean {
    const key = choreDupKey(title, block);
    return [...chores.value, ...pending].some(
      (c) =>
        (c.assigneeIds ?? []).includes(memberId) && choreDupKey(c.title, choreBlockOf(c)) === key
    );
  }

  /**
   * Add the Add Chores sheet's list (or a set added in a bean's chore list) for `memberIds`, in
   * ONE change: one chore PER BEAN per draft ("Add 6 Chores Each for Pip and Juno"), so each
   * copy is that bean's own to edit, like `copyChores`. Nothing here makes a shared chore. A bean
   * who already has a chore of that title in that block is skipped for it and counted in
   * `skipped`.
   *
   * The drafts are plain text: the sheet resolved the suggested titles into the family's
   * language when it put them on its list, and no set definition is ever changed. A created
   * chore's `starterKey` is the suggestion set its row came from (`draft.setKey`, when that is a
   * known set; analytics and dedupe), absent for a row the grown-up added. A draft with no title
   * or an unknown block refuses the whole batch.
   *
   * Keep Parents Posted follows each bean's list (`notifyFor`); `opts.notifyParents` overrides it
   * (the bean editor, for a bean with no chores yet).
   *
   * Telemetry (no titles): `chores-added` (`count` = chores created, `detail` = the suggestion
   * sets used, joined by `+`, or `none`), `chores-add-skipped` when any bean already had one, and
   * `chores-add-edited` (`count` = rows the grown-up renamed, re-timed, re-pictured, added or
   * removed) when above zero.
   */
  async function addChores(
    memberIds: readonly string[],
    drafts: readonly StarterChoreDraft[],
    actorId: string,
    opts: {
      sets?: readonly string[];
      edited?: number;
      notifyParents?: boolean;
      via?: ChoreEditVia;
    } = {}
  ): Promise<ChoreBatchResult | null> {
    const action = 'addChores';
    const actor = adultActor(actorId, action);
    if (!actor) return null;
    const targets = keepLiving(memberIds);
    if (targets.length === 0 || drafts.length === 0) return refuse('invalid', action);
    if (drafts.some((d) => !d.title.trim() || !isChoreBlock(d.block))) {
      return refuse('invalid', action);
    }
    const setOf = (d: StarterChoreDraft) => (d.setKey ? choreStarterSet(d.setKey)?.key : undefined);
    const pending: CreateChoreInput[] = [];
    let skipped = 0;
    let order = nextSortOrder();
    for (const target of targets) {
      const notify = (opts.notifyParents ?? notifyFor(target)) || undefined;
      for (const draft of drafts) {
        const title = draft.title.trim();
        if (hasSameChore(target, title, draft.block, pending)) {
          skipped++;
          continue;
        }
        pending.push({
          title,
          emoji: draft.emoji,
          illustration: draft.illustration || undefined,
          assigneeIds: [target],
          block: draft.block,
          days: normalizeChoreDays(draft.days),
          notifyParents: notify,
          sortOrder: order++,
          starterKey: setOf(draft),
          createdBy: actor,
        });
      }
    }
    const result = await writeBatch(action, pending);
    if (!result) return null;
    const sets = [
      ...new Set(
        (opts.sets ?? drafts.map(setOf)).filter((k): k is string => !!k && !!choreStarterSet(k))
      ),
    ];
    log('info', 'chores-added', {
      count: pending.length,
      detail: sets.length ? sets.join('+') : 'none',
      ...viaContext(opts.via),
    });
    if (skipped > 0) log('info', 'chores-add-skipped', { count: skipped });
    if ((opts.edited ?? 0) > 0) log('info', 'chores-add-edited', { count: opts.edited });
    return { added: pending.length, skipped };
  }

  /**
   * Copy `fromMemberId`'s chores in `blocks` to each of `toMemberIds`, in ONE change: a new
   * chore per target per source chore, so each copy is the target's own to edit. A chore the
   * target already has by the same title in the same block is skipped. Keep Parents Posted
   * follows the TARGET's list (`notifyFor`); a target with no chores keeps each copied chore's.
   */
  async function copyChores(
    fromMemberId: string,
    toMemberIds: readonly string[],
    blocks: readonly ChoreBlock[],
    actorId: string
  ): Promise<ChoreBatchResult | null> {
    const action = 'copyChores';
    const actor = adultActor(actorId, action);
    if (!actor) return null;
    const targets = keepLiving(toMemberIds).filter((id) => id !== fromMemberId);
    if (targets.length === 0) return refuse('invalid', action);
    const source = sortedChores.value.filter(
      (c) => (c.assigneeIds ?? []).includes(fromMemberId) && blocks.includes(choreBlockOf(c))
    );
    const pending: CreateChoreInput[] = [];
    let skipped = 0;
    let order = nextSortOrder();
    for (const target of targets) {
      // The target's list decides; a target with no chores keeps each copied chore's flag.
      const theirs = chores.value.some((c) => (c.assigneeIds ?? []).includes(target));
      const notify = theirs ? notifyFor(target) : undefined;
      for (const c of source) {
        const block = choreBlockOf(c);
        if (hasSameChore(target, c.title, block, pending)) {
          skipped++;
          continue;
        }
        pending.push({
          title: c.title,
          emoji: c.emoji,
          illustration: c.illustration,
          assigneeIds: [target],
          block,
          days: normalizeChoreDays(c.days),
          notifyParents: (notify ?? notifyFor(target, c.notifyParents === true)) || undefined,
          sortOrder: order++,
          starterKey: c.starterKey,
          createdBy: actor,
        });
      }
    }
    const result = await writeBatch(action, pending);
    if (!result) return null;
    log('info', 'chores-copied', { count: pending.length });
    if (skipped > 0) log('info', 'chores-copy-skipped', { count: skipped });
    return { added: pending.length, skipped };
  }

  /** ONE `createManyWithIds` for a batch action; nothing to write is a success. */
  async function writeBatch(action: string, pending: CreateChoreInput[]): Promise<true | null> {
    if (pending.length === 0) return true;
    return write(action, async () => {
      await repo.createChores(pending.map((input) => ({ id: generateUUID(), input })));
      await refresh();
      return true as const;
    });
  }

  // ========== RETENTION SWEEP ==========

  const sweepClock = createSweepClock(CHORE_MARK_SWEEP_KEY, SURFACE, {
    action: 'marks-sweep-cursor-write-failed',
  });

  function logSweepSkip(detail: string): void {
    log('warn', 'marks-sweep-skipped', { detail });
  }

  /**
   * Delete marks past `CHORE_MARK_KEEP_DAYS`. Never throws. Modelled on the list cycle sweep:
   * a kill switch, the doc-loaded guard, the device clock guard (a wrong clock can only DELAY a
   * deletion), the projection as the only input, a per-run cap (`MAX_MARK_SWEEP_DELETES`, in
   * `expiredMarkIds`), and the automatic-write budget.
   */
  async function sweepExpiredMarks(): Promise<void> {
    if (!CHORE_MARK_SWEEP_ENABLED) return;
    if (!isDocLoaded() || !isLoaded.value) {
      logSweepSkip('not-loaded');
      return;
    }
    const sweepDay = choreClock.value.ymd;
    const verdict = clockVerdict(sweepDay, sweepClock.read());
    if (verdict !== 'sweep') {
      // Same cursor rules as the list cycle sweep: advance on everything except a regressed
      // clock (moving the cursor back is what would let a wrong clock accelerate a deletion)
      // and the silent same-day repeat.
      if (verdict !== 'skip-regressed' && verdict !== 'skip-same-day') sweepClock.record(sweepDay);
      if (verdict !== 'skip-same-day') logSweepSkip(verdict.replace('skip-', ''));
      return;
    }
    try {
      // The PROJECTION, not the reactive array: a stale array must never widen a deletion.
      const stored = await repo.getAllChoreMarks();
      const ids = expiredMarkIds(stored, sweepDay);
      if (!ids.length) {
        sweepClock.record(sweepDay);
        return;
      }
      // An automatic write: bounded so two devices or builds cannot fight forever. A refusal
      // is reported by the budget itself; the cursor stays, so a later run retries.
      if (!takeAutoWrite('chore-marks-sweep')) return;
      // Reserve the day BEFORE deleting, so the cap is per day, not per invocation.
      if (!sweepClock.record(sweepDay)) {
        logSweepSkip('cursor-write-failed');
        return;
      }
      await repo.removeChoreMarks(ids);
      choreMarks.value = await repo.getAllChoreMarks();
      log('info', 'marks-swept', { count: ids.length });
    } catch (e) {
      reportError({
        surface: SURFACE,
        message:
          'chore mark retention sweep failed; nothing was deleted and it retries on the next app load or day advance',
        error: e,
        severity: 'warning',
        context: { action: 'marks-sweep-failed' },
      });
    }
  }

  watch(
    () => choreClock.value.ymd,
    () => {
      void sweepExpiredMarks();
    }
  );

  function resetState(): void {
    chores.value = [];
    choreMarks.value = [];
    isLoading.value = false;
    error.value = null;
    isLoaded.value = false;
  }

  return {
    // State
    chores,
    choreMarks,
    isLoading,
    error,
    isLoaded,
    // Getters
    livingIds,
    markIndex,
    starts,
    sortedChores,
    orphans,
    todayYmd,
    choreById,
    choreDayFor,
    weekFor,
    // Actions
    loadChores,
    toggleChore,
    createChore,
    updateChore,
    deleteChore,
    removeChoresForMember,
    setNotifyParentsFor,
    reorderChores,
    setBlockStarts,
    addChores,
    copyChores,
    sweepExpiredMarks,
    resetState,
  };
});
