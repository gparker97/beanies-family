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

// ── localStorage helpers ─────────────────────────────────────────────────────

interface TipState {
  dismissedTips: string[];
  tipsEnabled: boolean;
  lastTipShownDate: string;
}

function storageKey(memberId: string): string {
  return `bean-tips-${memberId}`;
}

function loadState(memberId: string): TipState {
  try {
    const raw = localStorage.getItem(storageKey(memberId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        dismissedTips: Array.isArray(parsed.dismissedTips) ? parsed.dismissedTips : [],
        tipsEnabled: typeof parsed.tipsEnabled === 'boolean' ? parsed.tipsEnabled : true,
        lastTipShownDate:
          typeof parsed.lastTipShownDate === 'string' ? parsed.lastTipShownDate : '',
      };
    }
  } catch {
    // ignore parse errors
  }
  return { dismissedTips: [], tipsEnabled: true, lastTipShownDate: '' };
}

function saveState(memberId: string, state: TipState): void {
  try {
    localStorage.setItem(storageKey(memberId), JSON.stringify(state));
  } catch {
    // storage full or unavailable
  }
}

// ── Module state ─────────────────────────────────────────────────────────────

const state = ref<TipState>({ dismissedTips: [], tipsEnabled: true, lastTipShownDate: '' });
const isDismissing = ref(false);
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

  // Reload state when member changes
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

  const currentTip = computed<BeanTip | null>(() => {
    if (!state.value.tipsEnabled) return null;
    if (!settingsStore.onboardingCompleted) return null;
    if (!currentMemberId) return null;

    // Already shown a tip today
    if (state.value.lastTipShownDate === today.value) {
      // Return the tip that was shown today (the one just dismissed)
      // so the card can finish its dismiss animation
      return null;
    }

    // Find first unseen, eligible tip
    const dismissed = new Set(state.value.dismissedTips);
    const ctx = tipContext.value;
    for (const tip of ALL_TIPS) {
      if (dismissed.has(tip.id)) continue;
      if (tip.condition && !tip.condition(ctx)) continue;
      return tip;
    }
    return null; // all tips seen
  });

  function dismissTip(tipId: string): void {
    if (!currentMemberId) return;
    isDismissing.value = true;

    // Delay state mutation so the CSS animation can play
    setTimeout(() => {
      state.value = {
        ...state.value,
        dismissedTips: [...state.value.dismissedTips, tipId],
        lastTipShownDate: today.value,
      };
      saveState(currentMemberId, state.value);
      isDismissing.value = false;
    }, 350);
  }

  function muteAllTips(): void {
    if (!currentMemberId) return;
    state.value = { ...state.value, tipsEnabled: false };
    saveState(currentMemberId, state.value);
  }

  function enableTips(): void {
    if (!currentMemberId) return;
    state.value = { ...state.value, tipsEnabled: true };
    saveState(currentMemberId, state.value);
  }

  return {
    currentTip,
    isDismissing,
    tipsEnabled: computed(() => state.value.tipsEnabled),
    dismissTip,
    muteAllTips,
    enableTips,
  };
}
