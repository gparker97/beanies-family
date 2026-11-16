/**
 * The grown-up write contract shared by the chore store and the star store (#146, #148): one
 * `log`, one `refuse`, one `adultActor` and one `write`, so the two stores cannot drift apart.
 *
 * Contract (unchanged from the chore store, where these four closures began):
 *   - `write` runs `fn` inside `wrapAsync(..., { action: '<store>:<action>', surface })`, whose
 *     toast is also the report. It resolves `fn`'s result, or `null` when it failed. Every `null`
 *     has been shown and logged, so callers branch on it and never toast again.
 *   - `refuse` is an info toast plus an `edit-refused` warn (nothing broke, so nothing is
 *     reported) and always answers `null`, so a caller can `return refuse(...)`. `vars` fill the
 *     message's `{tokens}` (`{name}`, `{count}`).
 *   - `adultActor` answers the actor's id when they are an adult member, and otherwise refuses
 *     with `notAdult`.
 *
 * Its own file, not `useStoreActions.ts`: `adultActor` needs `familyStore`, and `familyStore`
 * imports `useStoreActions.ts`, so putting it there would make an import cycle in the one module
 * every store loads. This file imports `wrapAsync` from there; nothing imports back.
 *
 * Telemetry: `action` and `detail` only (enums). A thrown error inside `fn` becomes the toast's
 * text and its report, so callers throw fixed wording only, never a title, a note or a name.
 */
import type { Ref } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { showToast } from '@/composables/useToast';
import { isAdultMember } from '@/composables/useMemberInfo';
import { logEvent } from '@/services/telemetry/logEvent';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';

export interface GuardedWritesOptions<R extends string> {
  /** The telemetry surface (`choreboard`, `chore-stars`). */
  surface: string;
  /** The store's name in a write's `action` context (`choreStore`, `starStore`). */
  store: string;
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
  /** One message per refusal reason, each saying what to do. */
  messages: Record<R, UIStringKey>;
  /** The reason `adultActor` refuses with. */
  notAdult: R;
}

export interface GuardedWrites<R extends string> {
  log(level: 'info' | 'warn', message: string, context?: Record<string, unknown>): void;
  refuse(detail: R, action: string, vars?: Record<string, string | number>): null;
  adultActor(actorId: string | null | undefined, action: string): string | null;
  write<T>(
    action: string,
    fn: () => Promise<T>,
    opts?: { errorToast?: boolean }
  ): Promise<T | null>;
}

export function createGuardedWrites<R extends string>(
  opts: GuardedWritesOptions<R>
): GuardedWrites<R> {
  const { surface, store, isLoading, error, messages, notAdult } = opts;

  function log(level: 'info' | 'warn', message: string, context?: Record<string, unknown>): void {
    logEvent({ level, surface, message, context });
  }

  function refuse(detail: R, action: string, vars?: Record<string, string | number>): null {
    const text = useTranslationStore().t(messages[detail]);
    showToast('info', vars ? fillTemplate(text, vars) : text);
    log('warn', 'edit-refused', { action, detail });
    return null;
  }

  function adultActor(actorId: string | null | undefined, action: string): string | null {
    const actor = actorId ? useFamilyStore().members.find((m) => m.id === actorId) : undefined;
    if (!actor || !isAdultMember(actor)) return refuse(notAdult, action);
    return actor.id;
  }

  async function write<T>(
    action: string,
    fn: () => Promise<T>,
    writeOpts: { errorToast?: boolean } = {}
  ): Promise<T | null> {
    const result = await wrapAsync(isLoading, error, fn, {
      action: `${store}:${action}`,
      surface,
      errorToast: writeOpts.errorToast ?? true,
    });
    return result === undefined ? null : result;
  }

  return { log, refuse, adultActor, write };
}
