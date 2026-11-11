/**
 * May the web updater force a reload into the deployed build right now?
 *
 * Requirement 5 of the web stale-build plan, as ONE pure function so every gate can
 * be table-tested without router mocks or fake timers. It only ever runs once the
 * build is proven behind (`buildFreshness.ts`). The runner (`webUpdate.ts`) gathers
 * the inputs and logs the blocker; this file imports nothing at runtime.
 *
 * The three screens:
 *  - `shell`: a family is open (`shouldShowAppLayout`). Today's rule stands (the
 *    waiting service worker applies at a quiet moment); forcing is the backstop once
 *    the build has been behind for `FORCE_CAP_MS`, or at once for a newer-version
 *    file or a person's tap. Always needs a quiet app and no focused text field.
 *  - `landing`: the login page reports itself idle on its landing view. Force.
 *  - `other`: any other login view, resume-setup, the create wizard. These hold typed
 *    state with no navigation between them, so they are never reloaded by the
 *    periodic check; only a newer-version file (that screen is already a dead end)
 *    or a person's tap waives that.
 *
 * NEVER waived, for anyone: a service-worker apply already in flight (the two reload
 * paths must not race), a URL fragment (`hardReload()` drops it, and it can carry a
 * recovery kit, an approval or a shared recipe), a pending interactive OAuth, and an
 * auth store that has not finished initialising.
 */
import type { QuietBlocker } from '@/utils/appQuiet';

/** Post-auth: how long a known-behind build waits for the SW route before forcing. */
export const FORCE_CAP_MS = 10 * 60_000;

export type UpdateTrigger = 'visible' | 'newer-file' | 'nav';
export type UpdateScreen = 'landing' | 'shell' | 'other';

export type ForceBlocker =
  | 'auth-init'
  | 'not-idle'
  | 'editing'
  | 'hash'
  | 'oauth'
  | 'sw-applying'
  | QuietBlocker
  | 'cap-not-reached';

export interface ForceInput {
  authInitialized: boolean;
  screen: UpdateScreen;
  /** A text field (input / textarea / contenteditable) has focus. */
  editing: boolean;
  hasHash: boolean;
  oauthPending: boolean;
  /** The service-worker apply path is already reloading the page. */
  swApplying: boolean;
  quietBlocker: QuietBlocker | null;
  trigger: UpdateTrigger;
  /** Time since this remote sha was first seen as behind (persisted across loads). */
  behindForMs: number;
  userRequested: boolean;
}

export type ForceDecision = { force: true } | { force: false; blocker: ForceBlocker };

export function decideForce(input: ForceInput): ForceDecision {
  // Never waived. `auth-init`: a reload mid-init could cut off the session restore or
  // the redirect exchange that init is running, whoever asked, on any screen.
  if (input.swApplying) return { force: false, blocker: 'sw-applying' };
  if (!input.authInitialized) return { force: false, blocker: 'auth-init' };
  if (input.hasHash) return { force: false, blocker: 'hash' };
  if (input.oauthPending) return { force: false, blocker: 'oauth' };

  const urgent = input.trigger === 'newer-file' || input.userRequested;

  if (input.screen === 'shell') {
    if (input.quietBlocker !== null) return { force: false, blocker: input.quietBlocker };
    // A tap on "Update beanies" is the person's answer to "may I reload": focus left
    // behind on a select or a checkbox must not turn their own request into a failure.
    if (input.editing && !input.userRequested) return { force: false, blocker: 'editing' };
    if (!urgent && input.behindForMs < FORCE_CAP_MS) {
      return { force: false, blocker: 'cap-not-reached' };
    }
    return { force: true };
  }

  // No family open.
  // A newer-version file or a person's tap waives the idle and focus gates: the
  // screen is already a dead end, and whatever was typed cannot be used.
  if (urgent) return { force: true };
  if (input.screen === 'other') return { force: false, blocker: 'not-idle' };
  // The general rule, not a list of known dialogs: any overlay, popover or sync on the
  // landing (paste-link panel, language sheet, a future dialog) defers the reload.
  if (input.quietBlocker !== null) return { force: false, blocker: input.quietBlocker };
  if (input.editing) return { force: false, blocker: 'editing' };
  return { force: true };
}
