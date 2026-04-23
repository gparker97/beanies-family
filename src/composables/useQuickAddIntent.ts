/**
 * Per-page consumer of Quick-add intents.
 *
 * Reads `?action=<name>` (+ optional context ids) from the current
 * route on mount and on subsequent query changes, validates the
 * action against the known vocabulary, then dispatches a delegated
 * handler inside try/catch. Query keys are cleared BEFORE the handler
 * runs so a handler exception can't cause re-entry on the next watch
 * tick.
 *
 * Replaces the older `useAutoOpenOnQuery` — callers that just want
 * `?add=1 → ref.value = true` use `action: 'add-<entity>'` instead.
 *
 * No silent failures:
 * - Unknown action → error toast + console.error at the composable
 *   boundary, no handler call
 * - Handler throws → error toast + console.error with the failing
 *   action string tagged, query already cleared
 */
import { onMounted, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import {
  QUICK_ADD_CONTEXT_KEYS,
  VALID_ACTIONS,
  type QuickAddAction,
  type QuickAddContextKey,
} from '@/constants/quickAddItems';

export type QuickAddIntentContext = Partial<Record<QuickAddContextKey, string>>;
export type QuickAddIntentHandler = (
  action: QuickAddAction,
  context: QuickAddIntentContext
) => void | Promise<void>;

// --- Pure helpers ---------------------------------------------------------

/**
 * Extract action + context from a query dict.
 * Returns null if no action is present or the action key is empty.
 */
export function parseIntentFromQuery(
  query: LocationQuery
): { action: string; context: QuickAddIntentContext } | null {
  const action = query.action;
  if (typeof action !== 'string' || !action) return null;

  const context: QuickAddIntentContext = {};
  for (const key of QUICK_ADD_CONTEXT_KEYS) {
    const value = query[key];
    if (typeof value === 'string' && value) {
      context[key] = value;
    }
  }
  return { action, context };
}

/**
 * Return a shallow copy of the query with the quick-add intent keys
 * removed. Unrelated keys (e.g. `?goal=<id>`) are preserved.
 * Idempotent — calling this on a stripped query is a no-op.
 */
export function stripIntentKeys(query: LocationQuery): LocationQuery {
  const next: LocationQuery = { ...query };
  delete next.action;
  for (const key of QUICK_ADD_CONTEXT_KEYS) {
    delete next[key];
  }
  return next;
}

// --- Composable -----------------------------------------------------------

export function useQuickAddIntent(handler: QuickAddIntentHandler): void {
  const route = useRoute();
  const router = useRouter();
  const { t } = useTranslation();

  async function consume(): Promise<void> {
    const intent = parseIntentFromQuery(route.query);
    if (!intent) return;

    // Strip consumed keys BEFORE dispatch. If the handler throws, the
    // watcher on `route.query.action` would otherwise re-fire on the
    // next reactivity tick and call the broken handler again.
    await router.replace({ query: stripIntentKeys(route.query) });

    if (!VALID_ACTIONS.has(intent.action)) {
      console.error(`[useQuickAddIntent] unknown action: "${intent.action}"`);
      showToast('error', t('quickAdd.error.unknown.title'), t('quickAdd.error.unknown.message'));
      return;
    }

    try {
      await handler(intent.action as QuickAddAction, intent.context);
    } catch (err) {
      console.error(`[useQuickAddIntent] handler threw for action="${intent.action}":`, err);
      const message = err instanceof Error ? err.message : t('quickAdd.error.handler.message');
      showToast('error', t('quickAdd.error.handler.title'), message);
    }
  }

  onMounted(() => {
    void consume();
  });
  watch(
    () => route.query.action,
    () => {
      void consume();
    }
  );
}
