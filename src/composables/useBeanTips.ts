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
import { ref, computed, watch } from 'vue';
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

// ── localStorage helpers ─────────────────────────────────────────────────────

function storageKey(memberId: string): string {
  return `bean-tips-${memberId}`;
}

/** Load and migrate the per-member tip state. Idempotent — re-reading a v2
 *  payload is a no-op; reading v1 produces the same v2 output every time and
 *  persists it immediately so the next session is already on v2. */
function loadState(memberId: string): TipStateV2 {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey(memberId));
  } catch (err) {
    console.warn('[useBeanTips] localStorage read failed — using empty state', err);
    return emptyState();
  }
  if (!raw) return emptyState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('[useBeanTips] localStorage parse failed — resetting to empty state', err);
    const fresh = emptyState();
    saveState(memberId, fresh); // overwrite the corrupted blob
    return fresh;
  }

  // Hard shape gate before any field access — defends against null / scalar /
  // array payloads that would throw on `parsed.dismissedTips`.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.warn('[useBeanTips] storage corrupted (non-object), resetting', parsed);
    const fresh = emptyState();
    saveState(memberId, fresh);
    return fresh;
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
      schemaVersion: CURRENT_SCHEMA_VERSION,
      issuedTips,
      mutedTipIds: [...mutedSet],
      tipsEnabled: typeof obj.tipsEnabled === 'boolean' ? obj.tipsEnabled : true,
      lastTipShownDate: typeof obj.lastTipShownDate === 'string' ? obj.lastTipShownDate : '',
    };
  }

  // v1 (or unversioned): migrate dismissedTips → mutedTipIds, init issuedTips.
  const migrated: TipStateV2 = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    issuedTips: [],
    mutedTipIds: Array.isArray(obj.dismissedTips)
      ? (obj.dismissedTips.filter((s): s is string => typeof s === 'string') as string[])
      : [],
    tipsEnabled: typeof obj.tipsEnabled === 'boolean' ? obj.tipsEnabled : true,
    lastTipShownDate: typeof obj.lastTipShownDate === 'string' ? obj.lastTipShownDate : '',
  };
  // Persist v2 immediately so the next session reads v2.
  saveState(memberId, migrated);
  return migrated;
}

/** Persist the v2 shape WITH a `dismissedTips` mirror for downgrade safety.
 *  Throws are caught + warned + reported (severity 'warning', no toast — writes
 *  happen on background issuance ticks, not user actions). */
function saveState(memberId: string, state: TipStateV2): void {
  try {
    const persisted = {
      ...state,
      // Mirror — an older app version reading this still sees the muted set.
      dismissedTips: state.mutedTipIds,
    };
    localStorage.setItem(storageKey(memberId), JSON.stringify(persisted));
  } catch (err) {
    console.warn('[useBeanTips] localStorage write failed', err);
    reportError({
      surface: 'bean-tips-save',
      message: 'localStorage write failed for bean-tips',
      error: err,
      severity: 'warning',
    });
  }
}

// ── Module state (single source of truth per session) ────────────────────────

const state = ref<TipStateV2>(emptyState());
let currentMemberId = '';

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
  watch(
    () => familyStore.currentMemberId,
    (id) => {
      if (id && id !== currentMemberId) {
        currentMemberId = id;
        state.value = loadState(id);
      }
    },
    { immediate: true }
  );

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
      if (!currentMemberId) return;
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
      saveState(currentMemberId, next);
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

  /** Mute future tips. Existing `issuedTips` are preserved (history stays in
   *  the bell). User-initiated — persistence failures surface a toast. */
  function muteAllTips(): void {
    if (!currentMemberId) return;
    const prev = state.value;
    try {
      const next: TipStateV2 = { ...prev, tipsEnabled: false };
      state.value = next;
      saveState(currentMemberId, next);
    } catch (err) {
      // saveState catches its own throws — but belt-and-braces in case the
      // ref assignment or shape build throws (it shouldn't).
      state.value = prev;
      showToast('error', "Couldn't mute tips", err instanceof Error ? err.message : String(err), {
        surface: 'bean-tips-toggle',
        error: err,
      });
    }
  }

  /** Re-enable tip issuance. User-initiated — persistence failures surface a toast. */
  function enableTips(): void {
    if (!currentMemberId) return;
    const prev = state.value;
    try {
      const next: TipStateV2 = { ...prev, tipsEnabled: true };
      state.value = next;
      saveState(currentMemberId, next);
    } catch (err) {
      state.value = prev;
      showToast('error', "Couldn't enable tips", err instanceof Error ? err.message : String(err), {
        surface: 'bean-tips-toggle',
        error: err,
      });
    }
  }

  return {
    issuedTips: computed<readonly IssuedTip[]>(() => state.value.issuedTips),
    tipsEnabled: computed<boolean>(() => state.value.tipsEnabled),
    ensureTodayTipIssued,
    muteAllTips,
    enableTips,
  };
}
