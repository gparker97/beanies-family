/**
 * Card reminders (#123 Phase B): the reactive orchestrator (MVO orchestrator layer), modelled
 * on `useHelpfulHints`.
 *
 * Init ONCE from App.vue. Holds NO business rules. It guards, asks the pure engine
 * (`utils/cardReminders`) for the diff between what the cards want and the card to-dos that
 * exist, writes that diff through `todoStore`'s batch actions, and logs the outcome.
 *
 * Why here and not in `responsibilityStore`: that store must never import to-do code (see its
 * header). The card side owns the reminder; this composable is the one place the two meet.
 *
 * It never deep-watches card state. Its one data source is `cardRemindersKey`, a string built
 * from the same `CARD_MANAGED_FIELDS` table the diff uses, so it fires exactly when the diff
 * could change: a reminder or holder change on a card, or a card to-do deleted, completed or
 * edited elsewhere (self-heal). It does not watch `today`: the clock-driven roll belongs to
 * `todoStore.reconcileRepeatingTodos`. The reconcile is idempotent, so its own writes cause
 * one no-op rerun.
 *
 * Only adult sessions in a writable family write; a family with no card reminders and no card
 * to-dos gets zero store calls.
 */
import { computed, effectScope, watch, type EffectScope } from 'vue';
import { useToday } from '@/composables/useToday';
import { useFamilyStore } from '@/stores/familyStore';
import { useTodoStore } from '@/stores/todoStore';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { isDocLoaded } from '@/services/automerge/docService';
import { skipWhileReadOnly } from '@/services/automerge/worker/writeGate';
import { withAppInitiatedWrites } from '@/services/analytics/plausible';
import { createChangeGate, type ChangeGate } from '@/services/telemetry/emitPolicy';
import { logEvent } from '@/services/telemetry/logEvent';
import { createReconcileLoop, type ReconcileLoop } from '@/utils/reconcileLoop';
import { isCardTodo } from '@/utils/todoRecurrence';
import {
  cardRemindersKey,
  cardRemindersKind,
  computeDesiredCardTodos,
  reconcileCardTodos,
  type CardTodoDiff,
} from '@/utils/cardReminders';

const DEBOUNCE_MS = 1000;
const SURFACE = 'card-reminders';

type SkipReason = 'not-loaded' | 'no-member' | 'not-adult';

// Change + heartbeat: every genuine change of outcome is logged, identical reruns are not.
let reconcileGate: ChangeGate = createChangeGate();
let skipGate: ChangeGate = createChangeGate();
let loop: ReconcileLoop | null = null;
// The watcher's scope, so a test reset also stops the previous instance's watcher.
let scope: EffectScope | null = null;
let initialized = false;

/** Reset the module singleton: TEST ONLY. */
export function __resetCardRemindersForTesting(): void {
  scope?.stop();
  scope = null;
  loop?.reset();
  loop = null;
  initialized = false;
  reconcileGate = createChangeGate();
  skipGate = createChangeGate();
}

/** What one write pass achieved. `failed` = some store write returned null/false. */
interface WriteOutcome {
  created: number;
  patched: number;
  removed: number;
  failed: boolean;
}

/** The `reconcile` event's `detail`: a failure wins, then the first kind of write made. */
function outcomeDetail(o: WriteOutcome): string {
  if (o.failed) return 'partial';
  if (o.created) return 'created';
  if (o.patched) return 'patched';
  if (o.removed) return 'removed';
  return 'noop';
}

export function useCardReminders(): void {
  if (initialized) return;
  initialized = true;

  const { today } = useToday();
  const familyStore = useFamilyStore();
  const todoStore = useTodoStore();
  const responsibilityStore = useResponsibilityStore();

  const cardTodos = () => todoStore.todos.filter(isCardTodo);
  const desiredFor = (createdBy: string, todayYmd: string) =>
    computeDesiredCardTodos(responsibilityStore.resolved, todayYmd, createdBy);

  function skip(detail: SkipReason): void {
    if (skipGate(detail)) {
      logEvent({ level: 'warn', surface: SURFACE, message: 'skipped', context: { detail } });
    }
  }

  /**
   * Apply the diff. Each batch is skipped when empty; each is `wrapAsync`-guarded in the store
   * (one toast + one report on failure, null/false returned), so nothing here throws on a
   * failed write and a failure is recorded as `partial`, retried on the next trigger.
   */
  async function applyDiff({ toCreate, toPatch, toRemove }: CardTodoDiff): Promise<WriteOutcome> {
    const out: WriteOutcome = { created: 0, patched: 0, removed: 0, failed: false };
    if (toCreate.length) {
      // `ifAbsent`: never overwrite a card to-do the document holds but this store has not loaded.
      const created = await todoStore.createTodos(toCreate, { ifAbsent: true });
      if (created) out.created = created.length;
      else out.failed = true;
    }
    if (toPatch.length) {
      const patched = await todoStore.patchTodosEach(toPatch);
      if (patched) out.patched = patched.length;
      else out.failed = true;
    }
    if (toRemove.length) {
      if (await todoStore.deleteTodos(toRemove)) out.removed = toRemove.length;
      else out.failed = true;
    }
    return out;
  }

  async function reconcile(): Promise<void> {
    if (!isDocLoaded() || !responsibilityStore.isLoaded) return skip('not-loaded');
    const me = familyStore.currentMember;
    if (!me) return skip('no-member');
    // Only grown-ups write cards, so only grown-up sessions maintain their to-dos.
    if (!responsibilityStore.canDeal) return skip('not-adult');
    // Logs its own once-per-session event; the sync runs on the next writable load.
    if (skipWhileReadOnly(SURFACE)) return;

    const todayYmd = today.value;
    const desired = desiredFor(me.id, todayYmd);
    const diff = reconcileCardTodos(desired, cardTodos(), todayYmd);
    const kind = cardRemindersKind(desired);
    const empty = !diff.toCreate.length && !diff.toPatch.length && !diff.toRemove.length;
    const outcome: WriteOutcome = empty
      ? { created: 0, patched: 0, removed: 0, failed: false }
      : // App-made to-dos: never counted as a person's feature use.
        await withAppInitiatedWrites(() => applyDiff(diff));

    const detail = outcomeDetail(outcome);
    const count = outcome.created + outcome.patched + outcome.removed;
    if (reconcileGate(`${detail}|${count}|${kind}`)) {
      logEvent({
        level: outcome.failed ? 'warn' : 'info',
        surface: SURFACE,
        message: 'reconcile',
        context: { count, detail, kind },
      });
    }
  }

  const reconcileLoop = createReconcileLoop({
    debounceMs: DEBOUNCE_MS,
    run: reconcile,
    surface: SURFACE,
    failureMessage: 'Card reminder reconcile failed; card to-dos not synced this cycle',
  });
  loop = reconcileLoop;

  scope = effectScope();
  scope.run(() => {
    /** The ONE data watch source (a string, so an unchanged fingerprint never re-triggers). */
    const watchKey = computed(() =>
      cardRemindersKey(desiredFor(familyStore.currentMember?.id ?? '', today.value), cardTodos())
    );
    watch(
      [
        () => watchKey.value,
        () => familyStore.currentMember?.id,
        () => responsibilityStore.isLoaded,
      ],
      () => reconcileLoop.queue()
    );
  });
  // Not `immediate`: at boot nothing is loaded yet, and the load flips `isLoaded`, which
  // triggers the first run. Initialised after a load (tests, a remount), run once anyway.
  if (responsibilityStore.isLoaded) reconcileLoop.queue();
}
