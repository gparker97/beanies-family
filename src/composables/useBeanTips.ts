/**
 * Per-member daily-tip issuance state. Tips appear in the notification bell
 * (one per local day, derived from `issuedTips`); read-state lives on the
 * synced `FamilyDocument`. This composable owns the per-device localStorage
 * issuance log and the `ensureTodayTipIssued()` action driven by
 * `useNotifications()`.
 *
 * Persistence shape (v2, written on every save):
 *
 *   {
 *     schemaVersion: 2,
 *     issuedTips: [{ tipId, issuedAt }, ...],   // bell history (newest-last)
 *     mutedTipIds: ['tip-a', ...],              // never re-issued, never shown
 *     tipsEnabled: true,
 *     lastTipShownDate: '2026-05-29',           // YYYY-MM-DD; blocks same-day reissue
 *     dismissedTips: ['tip-a', ...],            // legacy mirror of mutedTipIds
 *   }
 *
 * The `dismissedTips` mirror is the downgrade-safety net: an older app version
 * (e.g. a stale PWA cache) reading this storage still honours the user's muted
 * set instead of resurfacing tips. v2 reads union any `dismissedTips` entries
 * not in `mutedTipIds` (defends against in-flight downgrade writes).
 *
 * Failure contract — no silent failures:
 *   - parse/read/write errors → `console.warn('[useBeanTips] …')`.
 *   - `saveState` write errors additionally `reportError` (severity 'warning')
 *     — silent disk-full / write-blocked storage is a class of bug we want
 *     visibility on, but writes happen on issuance ticks so no toast.
 *   - `ensureTodayTipIssued` is wrapped in try/catch with `reportError`
 *     (severity 'error') so a bad tip `condition` callback can never break
 *     the `useNotifications` daemon.
 *   - User-initiated `muteAllTips()` / `enableTips()` failures surface an
 *     error toast (which auto-reports via `useToast`).
 */
import { computed } from 'vue';
import { ALL_TIPS, type BeanTip, type TipContext } from '@/content/tips';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useToday } from '@/composables/useToday';
import { reportError } from '@/utils/errorReporter';
import { showToast } from '@/composables/useToast';
import { createPerMemberStore } from '@/composables/perMemberStore';

// ── Persistence types ────────────────────────────────────────────────────────

export interface IssuedTip {
  tipId: string;
  issuedAt: string;
}

interface TipStateV2 {
  schemaVersion: 2;
  issuedTips: IssuedTip[];
  mutedTipIds: string[];
  tipsEnabled: boolean;
  lastTipShownDate: string;
}

const CURRENT_SCHEMA_VERSION = 2;

function emptyState(): TipStateV2 {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    issuedTips: [],
    mutedTipIds: [],
    tipsEnabled: true,
    lastTipShownDate: '',
  };
}

// ── State validation / migration ─────────────────────────────────────────────

/** Validate + migrate a parsed-JSON blob into a `TipStateV2` (+ persist hint).
 *  Idempotent — re-reading a v2 payload is a no-op; reading v1 produces the same
 *  v2 output every time and asks to persist so the next session is on v2. */
function fromParsed(parsed: unknown): { state: TipStateV2; persist?: boolean } {
  // Hard shape gate before any field access — defends against null / scalar /
  // array payloads that would throw on `parsed.dismissedTips`.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('[useBeanTips] storage corrupted (non-object), resetting', parsed);
    return { state: emptyState(), persist: true };
  }

  const obj = parsed as Record<string, unknown>;

  // v2 payload — validate fields and union the legacy `dismissedTips` mirror.
  if (obj.schemaVersion === CURRENT_SCHEMA_VERSION) {
    const issuedTips = Array.isArray(obj.issuedTips)
      ? (obj.issuedTips.filter(
          (e): e is IssuedTip =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as IssuedTip).tipId === 'string' &&
            typeof (e as IssuedTip).issuedAt === 'string'
        ) as IssuedTip[])
      : [];
    const baseMuted = Array.isArray(obj.mutedTipIds)
      ? (obj.mutedTipIds.filter((s): s is string => typeof s === 'string') as string[])
      : [];
    // Union in any `dismissedTips` entries not already in `mutedTipIds` — this
    // defends against an in-flight downgrade-era write that added a mute via
    // the legacy field.
    const legacyMuted = Array.isArray(obj.dismissedTips)
      ? (obj.dismissedTips.filter((s): s is string => typeof s === 'string') as string[])
      : [];
    const mutedSet = new Set(baseMuted);
    for (const id of legacyMuted) mutedSet.add(id);

    return {
      state: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        issuedTips,
        mutedTipIds: [...mutedSet],
        tipsEnabled: typeof obj.tipsEnabled === 'boolean' ? obj.tipsEnabled : true,
        lastTipShownDate: typeof obj.lastTipShownDate === 'string' ? obj.lastTipShownDate : '',
      },
    };
  }

  // v1 (or unversioned): migrate dismissedTips → mutedTipIds, init issuedTips.
  return {
    state: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      issuedTips: [],
      mutedTipIds: Array.isArray(obj.dismissedTips)
        ? (obj.dismissedTips.filter((s): s is string => typeof s === 'string') as string[])
        : [],
      tipsEnabled: typeof obj.tipsEnabled === 'boolean' ? obj.tipsEnabled : true,
      lastTipShownDate: typeof obj.lastTipShownDate === 'string' ? obj.lastTipShownDate : '',
    },
    // Persist v2 immediately so the next session reads v2.
    persist: true,
  };
}

// ── Module state (single source of truth per session) ────────────────────────

/** Persisted shape carries a `dismissedTips` mirror for downgrade safety — an
 *  older app version reading this still sees the muted set. */
const store = createPerMemberStore<TipStateV2, TipStateV2 & { dismissedTips: string[] }>({
  prefix: 'bean-tips',
  label: 'useBeanTips',
  saveSurface: 'bean-tips-save',
  saveMessage: 'localStorage write failed for bean-tips',
  empty: emptyState,
  fromParsed,
  toPersisted: (s) => ({ ...s, dismissedTips: s.mutedTipIds }),
  persistOnCorrupt: true,
});

const state = store.state;

// ── Composable ───────────────────────────────────────────────────────────────

export function useBeanTips() {
  const { today } = useToday();
  const familyStore = useFamilyStore();
  const settingsStore = useSettingsStore();
  const transactionsStore = useTransactionsStore();
  const activityStore = useActivityStore();
  const todoStore = useTodoStore();
  const goalsStore = useGoalsStore();
  const vacationStore = useVacationStore();
  const accountsStore = useAccountsStore();

  // Reload state when member changes — the module-level ref is atomically
  // swapped so any later call (issuance, mute, presentation) reads the new
  // member's state.
  store.useMemberSync();

  const tipContext = computed<TipContext>(() => ({
    transactionCount: transactionsStore.transactions.length,
    activityCount: activityStore.activities.length,
    todoCount: todoStore.todos.length,
    goalCount: goalsStore.goals.length,
    vacationCount: vacationStore.vacations.length,
    memberCount: familyStore.members.length,
    accountCount: accountsStore.accounts.length,
  }));

  /** Issue today's tip if the gates allow. Idempotent — same-day calls no-op.
   *  Called by `useNotifications()` on session-ready and on every `today` change. */
  function ensureTodayTipIssued(): void {
    try {
      if (!state.value.tipsEnabled) return;
      if (!store.memberId()) return;
      if (!settingsStore.onboardingCompleted) return;
      if (state.value.lastTipShownDate === today.value) return;

      const ctx = tipContext.value;
      const issuedSet = new Set(state.value.issuedTips.map((e) => e.tipId));
      const mutedSet = new Set(state.value.mutedTipIds);

      let chosen: BeanTip | null = null;
      for (const tip of ALL_TIPS) {
        if (mutedSet.has(tip.id)) continue;
        if (issuedSet.has(tip.id)) continue;
        if (tip.condition && !tip.condition(ctx)) continue;
        chosen = tip;
        break;
      }

      const next: TipStateV2 = {
        ...state.value,
        lastTipShownDate: today.value, // always advance — breaks retry loop on exhaustion
        issuedTips: chosen
          ? [...state.value.issuedTips, { tipId: chosen.id, issuedAt: new Date().toISOString() }]
          : state.value.issuedTips,
      };
      state.value = next;
      store.save(next);
    } catch (err) {
      // A bad tip `condition` callback should never break the notifications
      // daemon — caught here, reported, daemon stays clean.
      reportError({
        surface: 'bean-tips-issuance',
        message: 'ensureTodayTipIssued threw',
        error: err,
        severity: 'error',
      });
    }
  }

  /**
   * Persist a USER-INITIATED tip-state change, rolling back + toasting on the (rare)
   * write failure. `store.save` returns `false` on a caught write failure (it never
   * throws), so we surface it here rather than letting the UI show a phantom success.
   * The single foreground failure path for this composable — mute/enable both route
   * through it.
   */
  function commitTipState(next: TipStateV2, errTitle: string): void {
    const prev = state.value;
    state.value = next;
    if (!store.save(next)) {
      state.value = prev;
      showToast(
        'error',
        errTitle,
        'Your change could not be saved on this device. Check that storage is available (private mode / low disk can block it) and try again.',
        { surface: 'bean-tips-toggle' }
      );
    }
  }

  /** Mute future tips. Existing `issuedTips` are preserved (history stays in
   *  the bell). User-initiated — persistence failures surface a toast. */
  function muteAllTips(): void {
    if (!store.memberId()) return;
    commitTipState({ ...state.value, tipsEnabled: false }, "Couldn't mute tips");
  }

  /** Re-enable tip issuance. User-initiated — persistence failures surface a toast. */
  function enableTips(): void {
    if (!store.memberId()) return;
    commitTipState({ ...state.value, tipsEnabled: true }, "Couldn't enable tips");
  }

  return {
    issuedTips: computed<readonly IssuedTip[]>(() => state.value.issuedTips),
    tipsEnabled: computed<boolean>(() => state.value.tipsEnabled),
    ensureTodayTipIssued,
    muteAllTips,
    enableTips,
  };
}
