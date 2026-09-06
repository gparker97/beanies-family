/**
 * Ask people on iOS and Android to update the app.
 *
 * ⚠️ NATIVE ONLY, and the exact mirror of `usePwaUpdater`, which returns early
 * on native. Between them there is exactly one updater live per platform and
 * neither has to know about the other: the web self-updates through the service
 * worker, and native cannot, because no service worker is registered there
 * (ADR-029). If you are here wondering why the browser never sees this, that is
 * why, and `usePwaUpdater` is the file you want.
 *
 * ⚠️ THIS FILE CAN ONLY EVER PROMPT. The floor it reads is a static file we
 * deploy by hand, so the worst case of getting it wrong has to be a dismissible
 * nag. Blocking somebody belongs to `UnsupportedBeanpodVersionError`, which is a
 * fact about the file in front of this device rather than something we typed,
 * and it is attached in `payloadFailureSurface.ts`. There is deliberately no
 * `mustUpdate` and no `requireUpdate()` here: on the day they were written they
 * would have had no callers, and an unreachable force path reads as covered
 * when it is not.
 *
 * ⚠️ NONE OF THIS HELPS ANYONE WHO IS STALE TODAY. They are running a build
 * that contains none of this code. It is insurance for the next format change
 * and for a device drifting a few releases behind; today's stragglers still
 * have to be told by their family.
 */
import { effectScope, onScopeDispose, readonly, ref, watch } from 'vue';
import { App } from '@capacitor/app';
import { APP_VERSION } from '@/constants/appVersion';
import { getPlatform, isNative } from '@/services/sync/capabilities';
import { compareAppVersions } from '@/utils/compareAppVersions';
import { isAppQuiet } from '@/utils/appQuiet';
import { docVersion, isLoaded } from '@/services/automerge/projection';
import { useOnline } from '@/composables/useOnline';
import { confirm } from '@/composables/useConfirm';
import { claimInterruption } from '@/composables/useSessionInterruption';
import { useFatalErrorStore } from '@/stores/fatalErrorStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { fetchUpdateFloor, reportCheckFailure } from '@/services/appUpdate/versionPolicy';
import { storeUrlFor } from '@/services/appUpdate/storeUrl';

let initialized = false;
let scope: ReturnType<typeof effectScope> | null = null;
/**
 * Dismissed for THIS PROCESS. A module boolean is exactly the lifetime wanted:
 * it dies with the app. `createPerMemberStore` would persist it to localStorage,
 * which is both the wrong lifetime and a write-failure surface for a nag.
 */
let dismissedThisSession = false;
const updateAvailable = ref(false);

/** Test seam: forget the singleton so each case starts clean. */
export function __resetAppUpdateForTesting(): void {
  scope?.stop();
  scope = null;
  initialized = false;
  dismissedThisSession = false;
  suppressionsReported.clear();
  updateAvailable.value = false;
}

/**
 * Read the floor once and decide whether this build is behind it.
 *
 * `compareAppVersions` returns `null` when it cannot decide, which is treated
 * as "no prompt": a typo in a hand-edited static file must never nag a whole
 * fleet, and it must never throw here either.
 */
async function checkForUpdate(): Promise<void> {
  const floor = await fetchUpdateFloor();
  // ⚠️ ASKED ONCE. The undecidable case and the behind case are two answers to
  // one question, and calling the comparison twice invites them to disagree.
  const order = floor === null ? null : compareAppVersions(APP_VERSION, floor);
  const behind = order === -1;
  if (floor !== null && order === null) {
    // ⚠️ NOT the floor file's `unparseable-version`. `versionPolicy` already
    // screened the floor with the same grammar, so reaching here means
    // `APP_VERSION` ITSELF does not parse: a bad constant in a shipped build,
    // which silences the prompt for the whole fleet and is fixed in an entirely
    // different file. The two must not share a bucket.
    reportCheckFailure('app-version-unparseable');
  }
  updateAvailable.value = behind;
  // ⚠️ ONCE PER LAUNCH, and it fires whether or not there is anything to say.
  // It is the denominator for the whole funnel AND the only proof the floor is
  // alive: because the floor fails open, `floor=none` across the fleet is what
  // a permanently unreachable file looks like, and without this row it would be
  // indistinguishable from everyone already being up to date.
  logEvent({
    level: 'info',
    surface: 'app-update',
    message: 'update check',
    context: {
      action: 'checked',
      os: getPlatform(),
      detail: `floor=${floor ?? 'none'},behind=${behind}`,
    },
  });
}

/** Why now is not the moment, or `null` when it is. */
type PromptBlocker = 'offline' | 'busy' | 'booting' | 'fatal' | 'yielded';

function promptBlocker(isOnline: boolean): PromptBlocker | null {
  if (!isOnline) return 'offline';
  if (!isAppQuiet()) return 'busy';
  // ⚠️ NOT BEFORE THE APP IS PAST BOOT. `ConfirmModal` renders at z-250 and the
  // boot spinner is z-300, so a prompt raised during boot is a modal nobody can
  // see or dismiss, holding `hasOpenOverlays()` true for the rest of the
  // session.
  if (!isLoaded()) return 'booting';
  // ⚠️ AND NOT UNDER THE RECOVERY OVERLAY, which `isLoaded()` does NOT cover and
  // `isAppQuiet()` cannot see. The fatal overlay is a bare `<div>` at z-300, not
  // a `BaseModal`, so it never enters the overlay stack — and the 35-second init
  // watchdog can raise it with the document already loaded, opening every gate
  // above. The prompt would then be a modal underneath it: invisible,
  // untappable, and it would burn the one prompt this session gets while
  // logging that somebody was asked.
  if (useFatalErrorStore().message !== null) return 'fatal';
  // ⚠️ ONE UNSOLICITED SURFACE PER LOAD (#45). Claimed HERE, at the true show
  // site, and only once every other gate is open, so a prompt that was going to
  // be deferred anyway does not consume the slot the PIN modal needs.
  if (!claimInterruption('app-update')) return 'yielded';
  return null;
}

/**
 * Reasons already reported this session.
 *
 * ⚠️ REPORTED, BUT ONCE EACH. Every gate is re-evaluated on resume and on every
 * document change, so an unbounded event here would be a flood from exactly the
 * devices that have something to say. Three rows per session is the whole
 * budget, and it is enough: a fleet showing `behind=true` with no `prompted`
 * becomes attributable instead of a mystery.
 */
const suppressionsReported = new Set<PromptBlocker>();

async function maybePrompt(isOnline: boolean): Promise<void> {
  if (!updateAvailable.value || dismissedThisSession) return;

  const blocker = promptBlocker(isOnline);
  if (blocker) {
    if (!suppressionsReported.has(blocker)) {
      suppressionsReported.add(blocker);
      logEvent({
        level: 'info',
        surface: 'app-update',
        message: 'update prompt deferred',
        context: { action: 'prompt-deferred', os: getPlatform(), detail: blocker },
      });
    }
    return;
  }

  // Unreachable in practice: this composable is native-only and `storeUrlFor`
  // answers `null` only for `'web'`. It is here because the TYPE says
  // `string | null`, and it reports rather than returning quietly, because an
  // impossible branch that is also silent is how a wrong assumption survives.
  const url = storeUrlFor(getPlatform());
  if (!url) {
    reportCheckFailure('no-store-url');
    return;
  }

  // Dismissed on the FIRST show, not on the answer: whichever way they go, they
  // have now been asked once this session. A nag on every launch teaches people
  // to dismiss without reading, which is the reflex the block needs them not to
  // have.
  dismissedThisSession = true;
  logEvent({
    level: 'info',
    surface: 'app-update',
    message: 'update prompted',
    context: { action: 'prompted', os: getPlatform() },
  });

  // ⚠️ `confirmHref`, NOT `openExternal` after the await. `confirm()` resolves a
  // promise, so acting on its result happens outside the originating gesture
  // and the popup blocker treats the navigation as programmatic. The anchor
  // makes the browser's own default action do the work.
  const accepted = await confirm({
    title: 'appUpdate.prompt.title',
    message: 'appUpdate.prompt.message',
    confirmLabel: 'appUpdate.prompt.confirm',
    cancelLabel: 'appUpdate.prompt.notNow',
    variant: 'info',
    confirmHref: url,
  });

  if (!accepted) {
    logEvent({
      level: 'info',
      surface: 'app-update',
      message: 'update prompt dismissed',
      context: { action: 'prompt-dismissed', os: getPlatform() },
    });
  }
}

/**
 * Start the native update check. Call ONCE from `App.vue` setup, beside
 * `usePwaUpdater()`. Idempotent, and inert on web.
 */
export function useAppUpdate(): { updateAvailable: Readonly<typeof updateAvailable> } {
  if (isNative() && !initialized) {
    initialized = true;
    scope = effectScope(true);
    scope.run(() => {
      const { isOnline } = useOnline();

      void checkForUpdate().then(() => maybePrompt(isOnline.value));

      // ⚠️ THE LAUNCH CHECK ALONE WOULD ALMOST NEVER PROMPT, and it took a
      // review to see it. The floor resolves in a couple of hundred
      // milliseconds while the family document is still loading, so `isLoaded()`
      // is false, the prompt is deferred, and the only other trigger is a
      // `resume` the person may never produce. A launch that is never
      // backgrounded would have asked nobody.
      //
      // `docVersion` is the app's single reactivity source and is bumped by the
      // same hook that flips `loaded` true, so the first bump IS "the document
      // is here". Watching it costs one boolean read per document change and
      // stops mattering the moment `dismissedThisSession` is set. `isOnline` is
      // in the same watcher because coming back online is the other gate that
      // opens on its own.
      watch([docVersion, isOnline], () => void maybePrompt(isOnline.value));

      // Resume re-evaluates the GATES, it does not re-fetch: the floor is
      // memoised for the process, but the device may have come back online, the
      // save may have finished, or the overlay may have closed while away.
      const listener = App.addListener('resume', () => {
        void maybePrompt(isOnline.value);
      });
      onScopeDispose(() => {
        // `addListener` resolves a handle rather than returning one; a leaked
        // native listener is a silent failure with a long fuse.
        void listener.then((l) => l.remove()).catch(() => undefined);
      });
    });
  }

  return { updateAvailable: readonly(updateAvailable) };
}
