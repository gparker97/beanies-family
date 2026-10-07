/**
 * Gentle "your passphrase came from the old, shorter list" nudge (#81, ADR-041).
 *
 * Before #81 the suggested recovery passphrase was 4 words from a 256-word list (~32 bits).
 * A family still using one is nudged, never forced: one toast after sign-in with a button
 * to Settings → Security & Recovery, and an `InferredHint` in the passphrase editor until
 * they choose a new phrase (`resolve`) or wave it away (`dismiss`).
 *
 * The signal is the TYPED phrase, so it exists only at unlock time, when no member is yet
 * signed in (a passphrase unlock routes to the prove screen). Hence two halves:
 *   - `armLegacyPassphraseSignal()`, called by `authStore.afterPassphraseUnlock`, sets a
 *     module flag;
 *   - the composable's member watch, once a member id arrives, persists `pending` for that
 *     member, shows the toast once, and CLEARS the flag, so a second member signing in on
 *     the same process is not nudged for the first member's unlock. Sign-out clears it too.
 *
 * Reuses the shared per-member localStorage spine (`createPerMemberStore`), like
 * `useCalendarNudge`. Mounted once in `App.vue` (the trigger); `RecoverySettings` reads
 * `isPending` and calls `resolve` (a second mount is harmless: the flag is consumed once).
 *
 * State (per member, per device): status 'none' | 'pending' (show the hint) | 'dismissed'.
 */
import { computed, watch } from 'vue';
import { createPerMemberStore } from '@/composables/perMemberStore';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { SECURITY_OPEN } from '@/constants/settingsDeepLinks';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import {
  armLegacyPassphraseSignal,
  clearLegacyPassphraseSignal,
  isLegacyPassphraseSignalArmed,
} from '@/services/auth/legacyPassphraseSignal';

type PassphraseNudgeStatus = 'none' | 'pending' | 'dismissed';

interface PassphraseNudgeState {
  schemaVersion: 1;
  status: PassphraseNudgeStatus;
}

const SCHEMA_VERSION = 1 as const;
const SURFACE = 'passphrase-nudge';

function emptyState(): PassphraseNudgeState {
  return { schemaVersion: SCHEMA_VERSION, status: 'none' };
}

const store = createPerMemberStore<PassphraseNudgeState>({
  prefix: 'bean-passphrase-nudge',
  label: 'usePassphraseNudge',
  saveSurface: 'passphrase-nudge-save',
  saveMessage: 'localStorage write failed for passphrase-nudge',
  empty: emptyState,
  clearOnSignOut: true,
  fromParsed: (parsed) => {
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION
    ) {
      const status = (parsed as Record<string, unknown>).status;
      return {
        state: {
          schemaVersion: SCHEMA_VERSION,
          status: status === 'pending' || status === 'dismissed' ? status : 'none',
        },
      };
    }
    return { state: emptyState() };
  },
});

const state = store.state;

function logNudge(action: 'shown' | 'dismissed' | 'resolved'): void {
  logEvent({ level: 'info', surface: SURFACE, message: 'legacy_shape', context: { action } });
}

/** Re-exported for callers and tests; the flag itself lives in `legacyPassphraseSignal`. */
export { armLegacyPassphraseSignal };

/** Test seam only: forget a pending arm so each case starts clean. */
export function __resetPassphraseNudgeForTesting(): void {
  clearLegacyPassphraseSignal();
}

function setStatus(status: PassphraseNudgeStatus): void {
  const next: PassphraseNudgeState = { ...state.value, status };
  state.value = next;
  // A write failure is warn'd + reportError'd inside the store; the only consequence is the
  // hint's state not surviving a reload, so no rollback or toast.
  store.save(next);
}

export function usePassphraseNudge() {
  // Order matters: the store's own watch (registered first) loads this member's state
  // before the trigger below reads `status`.
  store.useMemberSync();
  const familyStore = useFamilyStore();
  const { t } = useTranslation();

  function openSecuritySettings(): void {
    // The router is imported on the tap, not at module load (same reason as
    // `useExtractionErrorToast`): App.vue's import graph should not pull in every route here.
    import('@/router')
      .then(({ default: router }) =>
        router.push({ path: '/settings', query: { open: SECURITY_OPEN } })
      )
      .catch((err: unknown) =>
        reportError({
          surface: SURFACE,
          message: 'passphrase-nudge Settings navigation failed',
          error: err,
          severity: 'warning',
        })
      );
  }

  watch(
    () => familyStore.currentMemberId,
    (id) => {
      if (!id) {
        // Sign-out, beside the store's `clearOnSignOut`: an arm never outlives a session.
        clearLegacyPassphraseSignal();
        return;
      }
      if (!isLegacyPassphraseSignalArmed()) return;
      clearLegacyPassphraseSignal();
      if (state.value.status === 'dismissed') return;
      setStatus('pending');
      showToast('info', t('recovery.passphraseLegacyNudge'), undefined, {
        actionLabel: t('recovery.passphraseLegacyNudgeAction'),
        actionFn: openSecuritySettings,
      });
      logNudge('shown');
    },
    { immediate: true }
  );

  const isPending = computed(() => state.value.status === 'pending');

  /** The member waved the hint away; it does not come back for this member on this device. */
  function dismiss(): void {
    setStatus('dismissed');
    logNudge('dismissed');
  }

  /** A new passphrase was saved; the hint has nothing left to say. No-op unless pending. */
  function resolve(): void {
    if (state.value.status !== 'pending') return;
    setStatus('none');
    logNudge('resolved');
  }

  return { isPending, dismiss, resolve };
}
