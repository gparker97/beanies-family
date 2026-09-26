/**
 * Who Owns What (#109) — the responsibility deck store. Orchestration only.
 *
 * Every mutating action is: `guarded` (adult → card exists → holders valid) → one pure
 * builder from `utils/responsibilityOps.ts` → `responsibilityRepository.applyDeckOps` (one
 * Automerge change) → verify with a projection read → refresh → log. All reads of the
 * deck go through `utils/responsibilityDeck.ts` (`resolveDeck` and friends).
 *
 * Action contract (one report per failure, never silent):
 *   - Writes run inside `wrapAsync(..., { action, surface: 'responsibilities' })`, whose
 *     toast is also the report. A failed verification throws the translated
 *     `whoOwnsWhat.error.saveFailed` inside it, so exactly one toast and one report fire.
 *   - An action returns its result on success and `null` otherwise. Every `null` has
 *     already been shown and logged, so callers branch on falsy and NEVER toast again.
 *   - Refusals (child, card gone, invalid holder, stale undo) are info toasts plus a
 *     `logEvent` warn: nothing broke, so nothing is reported.
 *   - `restoreDefaults` reports its own failure once, at critical.
 *
 * DEPENDENCY DIRECTION (one-way, no cycles): this store imports only `familyStore`,
 * `settingsStore`, `translationStore` and its repository. It must NEVER import
 * `mealPlanStore`, `listStore`, `todoStore`, `notificationsStore`, `useCriticalItems` or
 * `useHelpfulHints`: those consume it, never the reverse. Briefing read-state is passed
 * INTO `buildCardBriefingRows` by its caller.
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { showToast } from '@/composables/useToast';
import { useToday } from '@/composables/useToday';
import { celebrate } from '@/composables/useCelebration';
import { isAdultMember } from '@/composables/useMemberInfo';
import { isDocLoaded } from '@/services/automerge/docService';
import * as repo from '@/services/automerge/repositories/responsibilityRepository';
import { logEvent } from '@/services/telemetry/logEvent';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import { RESPONSIBILITY_CARDS, type CardDefaultTarget } from '@/constants/responsibilityCards';
import { toISODateString } from '@/utils/date';
import type { UIStringKey } from '@/services/translation/uiStrings';
import {
  categoryCoverage,
  deckStats,
  defaultHolderFor as pureDefaultHolderFor,
  firstDealtAt,
  isCheckInDue,
  latestCheckIn,
  nextCheckInDate,
  resolveDeck,
  type ResolvedCard,
} from '@/utils/responsibilityDeck';
import {
  buildBringBack,
  buildCheckIn,
  buildCreateCustom,
  buildDeal,
  buildDeleteCustom,
  buildKeep,
  buildRestoreDefaults,
  buildSaveCard,
  buildSkip,
  buildUndo,
  type BuildResult,
  type CardDraft,
  type CheckInOutcomes,
  type CustomCardInput,
  type DeckTelemetry,
  type UndoToken,
} from '@/utils/responsibilityOps';
import type {
  ResponsibilityCardState,
  ResponsibilityCheckIn,
  ResponsibilityMove,
} from '@/types/models';

const SURFACE = 'responsibilities';

/** What the four undoable actions resolve to. `undo` is null when nothing changed. */
export interface UndoableResult<T> {
  result: T;
  undo: UndoToken | null;
}

export const useResponsibilityStore = defineStore('responsibilities', () => {
  const familyStore = useFamilyStore();
  const settingsStore = useSettingsStore();
  const { today } = useToday();

  // Raw projection reads. `states` is `unknown[]` on purpose: any client may have written
  // a record, and only `resolveDeck` decides whether one is well-formed.
  const states = ref<unknown[]>([]);
  const moves = ref<ResponsibilityMove[]>([]);
  const checkIns = ref<ResponsibilityCheckIn[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  /** True once `load()` has read the document; integrations get `null` defaults until then. */
  const isLoaded = ref(false);

  // ========== GETTERS ==========

  const resolvedDeck = computed(() =>
    resolveDeck(RESPONSIBILITY_CARDS, states.value, moves.value, familyStore.members)
  );
  const resolved = computed<ResolvedCard[]>(() => resolvedDeck.value.cards);
  const stats = computed(() => deckStats(resolved.value));
  const coverage = computed(() => categoryCoverage(resolved.value));
  const waiting = computed(() => resolved.value.filter((c) => c.status === 'waiting'));
  const customCount = computed(() => resolved.value.filter((c) => c.isCustom).length);
  /** First-deal state: no built-in card has been kept or skipped yet. */
  const isFirstDeal = computed(() =>
    resolved.value.every((c) => c.isCustom || c.status === 'unsorted')
  );

  function cardById(id: string): ResolvedCard | undefined {
    return resolved.value.find((c) => c.id === id);
  }

  /** Kept cards where the member holds at least one part. */
  function myCards(memberId: string): ResolvedCard[] {
    return resolved.value.filter(
      (c) =>
        (c.status === 'held' || c.status === 'waiting') &&
        c.parts.some((p) => p.holderId === memberId)
    );
  }

  const rhythmWeeks = computed(() => settingsStore.responsibilityCheckInWeeks);
  const lastCheckIn = computed(() => latestCheckIn(checkIns.value));
  const dealtAt = computed(() => firstDealtAt(moves.value));
  const nextCheckIn = computed(() =>
    nextCheckInDate(rhythmWeeks.value, checkIns.value, dealtAt.value)
  );
  const checkInDue = computed(() =>
    isCheckInDue(rhythmWeeks.value, checkIns.value, dealtAt.value, today.value)
  );

  /** Only grown-ups deal; children see the page read-only. */
  const canDeal = computed(() => {
    const me = familyStore.currentMember;
    return !!me && isAdultMember(me);
  });

  /** Who beanies should default to for a meal slot / list template / hint, and why. */
  function defaultHolderFor(
    target: CardDefaultTarget
  ): { memberId: string; cardId: string } | null {
    if (!isLoaded.value) return null;
    return pureDefaultHolderFor(resolved.value, target);
  }

  // ========== TELEMETRY ==========

  function log(level: 'info' | 'warn', message: string, context?: Record<string, unknown>): void {
    logEvent({ level, surface: SURFACE, message, context });
  }
  function logAll(events: readonly DeckTelemetry[], action: string): void {
    for (const e of events) log('info', e.message, { action, ...e.context });
  }

  // Once per id per session. The ids come from the document, so they are never sent.
  const loggedBadIds = new Set<string>();
  function logBadRecords(): void {
    const { unknownIds, invalidIds } = resolvedDeck.value;
    for (const [message, ids] of [
      ['unknown_card', unknownIds],
      ['invalid_card_state', invalidIds],
    ] as const) {
      for (const id of ids) {
        const key = `${message}:${id}`;
        if (loggedBadIds.has(key)) continue;
        loggedBadIds.add(key);
        log('warn', message);
      }
    }
  }

  let lastLoadedSignature = '';
  function logLoaded(): void {
    const s = stats.value;
    const detail = s.deck === 0 ? 'unsorted' : s.waiting + s.unsorted === 0 ? 'dealt' : 'dealing';
    const signature = `${s.deck}:${detail}`;
    if (signature === lastLoadedSignature) return;
    lastLoadedSignature = signature;
    log('info', 'deck_loaded', { count: s.deck, detail });
  }

  // ========== LOAD ==========

  async function refresh(): Promise<void> {
    const [s, m, c] = await Promise.all([
      repo.getAllCardStates(),
      repo.getAllMoves(),
      repo.getAllCheckIns(),
    ]);
    states.value = s;
    moves.value = m;
    checkIns.value = c;
  }

  async function load(): Promise<void> {
    // No-op until the Automerge doc is loaded; the central load sequence re-runs it.
    if (!isDocLoaded()) return;
    await wrapAsync(
      isLoading,
      error,
      async () => {
        await refresh();
        isLoaded.value = true;
        logBadRecords();
        logLoaded();
      },
      { action: 'responsibilityStore:load', surface: SURFACE }
    );
  }

  // ========== GUARD + WRITE ==========

  function t(key: UIStringKey): string {
    return useTranslationStore().t(key);
  }

  function refuse(
    message: 'write_refused' | 'card_missing' | 'invalid_holder',
    action: string
  ): null {
    if (message === 'write_refused') {
      showToast('info', t('whoOwnsWhat.error.readOnly'), t('whoOwnsWhat.error.readOnlyHelp'));
    } else {
      showToast('info', t('whoOwnsWhat.error.cardGone'), t('whoOwnsWhat.error.cardGoneHelp'));
    }
    log('warn', message, { action, detail: action });
    return null;
  }

  /**
   * The ONE guard, identical for every write: adult → every card exists → every holder is
   * a current non-pet member. Refusal and missing-card paths live only here.
   */
  async function guarded<T>(
    action: string,
    check: { cardIds?: readonly string[]; holderIds?: readonly (string | null | undefined)[] },
    fn: (actorId: string, cards: ResolvedCard[]) => Promise<T | null>
  ): Promise<T | null> {
    const actorId = familyStore.currentMemberId;
    if (!canDeal.value || !actorId) return refuse('write_refused', action);
    const cards: ResolvedCard[] = [];
    for (const id of check.cardIds ?? []) {
      const c = cardById(id);
      if (!c) return refuse('card_missing', action);
      cards.push(c);
    }
    const eligible = new Set(familyStore.members.filter((m) => !m.isPet).map((m) => m.id));
    for (const h of check.holderIds ?? []) {
      if (h && !eligible.has(h)) return refuse('invalid_holder', action);
    }
    return fn(actorId, cards);
  }

  /**
   * Write a builder's ops, verify every op landed, refresh, and fire the deck-dealt
   * celebration on the transition. Resolves `true` on success (including a no-op) and
   * `null` after `wrapAsync` has shown and reported a failure.
   */
  async function write(
    action: string,
    build: BuildResult,
    opts: { celebrateDealt?: boolean } = {}
  ): Promise<true | null> {
    if (!build.ops.length) return true;
    const pendingBefore = stats.value.waiting + stats.value.unsorted;
    const ok = await wrapAsync(
      isLoading,
      error,
      async () => {
        await repo.applyDeckOps(build.ops);
        if (!build.ops.every(repo.isDeckOpApplied)) {
          throw new Error(t('whoOwnsWhat.error.saveFailed'));
        }
        await refresh();
        return true as const;
      },
      { action: `responsibilityStore:${action}`, surface: SURFACE }
    );
    if (!ok) return null;
    logAll(build.telemetry, action);
    if (opts.celebrateDealt !== false) {
      const pendingAfter = stats.value.waiting + stats.value.unsorted;
      // "Every card has a holder" needs a card to hold: a deck skipped whole is not dealt.
      if (pendingBefore > 0 && pendingAfter === 0 && stats.value.deck > 0) {
        celebrate('deck-dealt');
        log('info', 'deck_dealt', { action, count: stats.value.deck });
      }
    }
    logLoaded();
    return true;
  }

  const nowIso = () => toISODateString(new Date());

  async function undoable<T>(
    action: string,
    build: BuildResult,
    result: () => T
  ): Promise<UndoableResult<T> | null> {
    const ok = await write(action, build);
    if (!ok) return null;
    return { result: result(), undo: build.ops.length ? (build.undo ?? null) : null };
  }

  // ========== ACTIONS ==========

  /** Deal one part to a member, or clear it with `null`. Also keeps an unsorted card. */
  function deal(
    cardId: string,
    partKey: string,
    memberId: string | null
  ): Promise<UndoableResult<ResolvedCard> | null> {
    return guarded('deal', { cardIds: [cardId], holderIds: [memberId] }, (actor, [card]) => {
      if (!card!.parts.some((p) => p.key === partKey))
        return Promise.resolve(refuse('card_missing', 'deal'));
      return undoable('deal', buildDeal(card!, partKey, memberId, actor, nowIso()), () =>
        cardById(cardId)!
      );
    });
  }

  /** "Decide later": keep the card waiting. */
  function keep(cardId: string): Promise<UndoableResult<ResolvedCard> | null> {
    return guarded('keep', { cardIds: [cardId] }, (actor, [card]) =>
      undoable('keep', buildKeep(card!, actor, nowIso()), () => cardById(cardId)!)
    );
  }

  /** Skip one card, or a whole group (one write, one undo). */
  function skip(cardIds: readonly string[]): Promise<UndoableResult<string[]> | null> {
    return guarded('skip', { cardIds }, (actor, cards) =>
      undoable('skip', buildSkip(cards, actor, nowIso()), () => [...cardIds])
    );
  }

  function bringBack(cardId: string): Promise<UndoableResult<ResolvedCard> | null> {
    return guarded('bringBack', { cardIds: [cardId] }, (actor, [card]) =>
      undoable('bringBack', buildBringBack(card!, actor, nowIso()), () => cardById(cardId)!)
    );
  }

  /** The edit drawer's single save: holders, split, done line and skip toggle in ONE batch. */
  function saveCard(cardId: string, draft: CardDraft): Promise<ResolvedCard | null> {
    return guarded(
      'saveCard',
      { cardIds: [cardId], holderIds: draft.parts.map((p) => p.holderId) },
      async (actor, [card]) => {
        let build: BuildResult;
        try {
          build = buildSaveCard(card!, draft, actor, nowIso());
        } catch (e) {
          // An invalid draft is a programming error in the editor: report it once.
          return failBuild('saveCard', e);
        }
        return (await write('saveCard', build)) ? cardById(cardId)! : null;
      }
    );
  }

  function createCustom(input: CustomCardInput): Promise<ResolvedCard | null> {
    return guarded('createCustom', { holderIds: [input.holderId] }, async (actor) => {
      let build: BuildResult & { id: string };
      try {
        build = buildCreateCustom(input, actor, nowIso());
      } catch (e) {
        return failBuild('createCustom', e);
      }
      return (await write('createCustom', build)) ? cardById(build.id)! : null;
    });
  }

  function deleteCustom(cardId: string): Promise<true | null> {
    return guarded('deleteCustom', { cardIds: [cardId] }, async (_actor, [card]) => {
      let build: BuildResult;
      try {
        build = buildDeleteCustom(card!, moves.value);
      } catch (e) {
        return failBuild('deleteCustom', e);
      }
      return write('deleteCustom', build);
    });
  }

  /**
   * Surface a builder throw: ONE translated toast and ONE report. A builder's message is a
   * developer string ("buildSaveCard: ..."), so it goes to the report (as the error, with
   * its stack) and never into the toast a family reads.
   */
  function failBuild(action: string, e: unknown): null {
    const err = e instanceof Error ? e : new Error(String(e));
    error.value = err.message;
    showToast('error', t('whoOwnsWhat.error.saveFailed'), undefined, {
      error: err,
      surface: SURFACE,
      context: { action: `responsibilityStore:${action}` },
    });
    return null;
  }

  /** Restore every built-in card and start the deal over (Requirement 15). */
  function restoreDefaults(opts: { keepCustom: boolean }): Promise<true | null> {
    return guarded('restoreDefaults', {}, async () => {
      let stage: 'build' | 'write' | 'verify' = 'build';
      let failure: unknown = null;
      const build = await wrapAsync(
        isLoading,
        error,
        async () => {
          try {
            const b = buildRestoreDefaults(states.value, moves.value, opts.keepCustom, nowIso());
            stage = 'write';
            await repo.applyDeckOps(b.ops);
            stage = 'verify';
            if (!b.ops.every(repo.isDeckOpApplied)) {
              throw new Error(t('whoOwnsWhat.error.saveFailed'));
            }
            await refresh();
            return b;
          } catch (e) {
            failure = e;
            throw e;
          }
        },
        { action: 'responsibilityStore:restoreDefaults', surface: SURFACE, errorToast: false }
      );
      if (!build) {
        // The ONE report for this failure, at critical: the family asked to wipe the deck
        // and may now be looking at a state they can't trust.
        showToast('error', t('whoOwnsWhat.restore.failed'), t('whoOwnsWhat.restore.failedHelp'), {
          surface: SURFACE,
          critical: true,
          error: failure,
          context: { action: 'restore_defaults', stage },
        });
        return null;
      }
      logAll(build.telemetry, 'restoreDefaults');
      logLoaded();
      showToast('success', t('whoOwnsWhat.restore.done'));
      return true as const;
    });
  }

  /** Log that a check-in was opened (the rate of started vs completed is the signal). */
  function startCheckIn(): Promise<true | null> {
    return guarded('startCheckIn', {}, async () => {
      log('info', 'checkin_started', { action: 'startCheckIn' });
      return true as const;
    });
  }

  function completeCheckIn(outcomes: CheckInOutcomes): Promise<ResponsibilityCheckIn | null> {
    return guarded('completeCheckIn', {}, async (actor) => {
      const build = buildCheckIn(outcomes, actor, nowIso(), today.value);
      if (!(await write('completeCheckIn', build, { celebrateDealt: false }))) return null;
      celebrate('check-in-done');
      return build.checkIn;
    });
  }

  function setRhythm(weeks: 0 | 2 | 4 | 8): Promise<true | null> {
    return guarded('setRhythm', {}, async () => {
      try {
        await settingsStore.setResponsibilityCheckInWeeks(weeks);
      } catch {
        // settingsStore already toasted and reported this failure; never a second toast.
        return null;
      }
      log('info', 'rhythm_set', { action: 'setRhythm', detail: String(weeks) });
      return true as const;
    });
  }

  /**
   * Undo a toast action. Refused as a whole, with nothing written, when any card in the
   * token changed since (another device); resolves `true` on success.
   */
  function undo(token: UndoToken): Promise<true | null> {
    return guarded('undo', {}, async () => {
      const live = new Map<string, ResponsibilityCardState>();
      for (const c of resolved.value) if (c.state) live.set(c.id, c.state);
      const build = buildUndo(token, live);
      if (build.stale) {
        showToast('info', t('whoOwnsWhat.undo.stale'), t('whoOwnsWhat.undo.staleHelp'));
        log('warn', 'undo_stale', { action: 'undo', detail: token.action });
        return null;
      }
      return write('undo', build, { celebrateDealt: false });
    });
  }

  function resetState(): void {
    states.value = [];
    moves.value = [];
    checkIns.value = [];
    isLoading.value = false;
    error.value = null;
    isLoaded.value = false;
    loggedBadIds.clear();
    lastLoadedSignature = '';
  }

  return {
    // State
    states,
    moves,
    checkIns,
    isLoading,
    error,
    isLoaded,
    // Getters
    resolved,
    stats,
    coverage,
    waiting,
    customCount,
    isFirstDeal,
    rhythmWeeks,
    lastCheckIn,
    nextCheckIn,
    checkInDue,
    canDeal,
    cardById,
    myCards,
    defaultHolderFor,
    // Actions
    load,
    deal,
    keep,
    skip,
    bringBack,
    saveCard,
    createCustom,
    deleteCustom,
    restoreDefaults,
    startCheckIn,
    completeCheckIn,
    setRhythm,
    undo,
    resetState,
  };
});
