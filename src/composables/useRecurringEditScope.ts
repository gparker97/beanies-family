import { ref } from 'vue';

export type RecurringEditScope = 'this-only' | 'all' | 'this-and-future';

interface ScopeState {
  open: boolean;
  resolve: ((value: RecurringEditScope | null) => void) | null;
}

// Module-level state — shared across all callers (same pattern as useConfirm)
const state = ref<ScopeState>({
  open: false,
  resolve: null,
});

/**
 * Show the recurring edit scope picker.
 * Returns a promise that resolves to the chosen scope, or null if cancelled.
 */
export function chooseScope(): Promise<RecurringEditScope | null> {
  return new Promise<RecurringEditScope | null>((resolve) => {
    state.value = { open: true, resolve };
  });
}

/**
 * Composable for the RecurringEditScopeModal renderer component.
 */
export function useRecurringEditScope() {
  function select(scope: RecurringEditScope) {
    state.value.resolve?.(scope);
    state.value.open = false;
    state.value.resolve = null;
  }

  function cancel() {
    state.value.resolve?.(null);
    state.value.open = false;
    state.value.resolve = null;
  }

  return { state, select, cancel };
}
