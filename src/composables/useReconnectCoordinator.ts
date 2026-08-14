/**
 * Reconnect coordinator (tracker #62, commit 5) — the single owner of "what Google
 * feature is disconnected, and reconnect it in as few round-trips as possible."
 *
 * Consolidates the previously-separate Drive and Calendar reconnect toasts into ONE
 * prompt. It depends only on the two stores' PUBLIC surfaces (read-only down state,
 * the two `reconnect` primitives, and the calendar fan-out) — it never reaches into
 * store internals.
 *
 * The action is a flat plan → executor (no nested config branching):
 *  - `buildReconnectPlan()` groups the down features by Google account. A calendar
 *    connection joins the Drive group ONLY on a positive account match; every other
 *    connection ('unknown' / different account) is its own single-feature group.
 *  - `reconnectAll()` runs each group: a single-feature group DELEGATES to the
 *    existing per-feature primitive (unchanged behavior); a ≥2 group runs one
 *    unified consent for the scope union and fans the token into both sinks.
 *
 * A third Google-scoped feature would join by contributing to the down set + plan;
 * the executor needs no new branch.
 */
import { ref, computed } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
import { useTranslation } from '@/composables/useTranslation';
import { isFlagEnabled } from '@/config/flags';
import { shouldUseRedirectAuth } from '@/services/google/googleAuth';
import { startUnifiedReconnect } from '@/services/google/unifiedReconnect';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';

type DriveDown = { kind: 'drive'; email: string | null };
type CalendarDown = { kind: 'calendar'; connectionId: string; email: string };
type DownFeature = DriveDown | CalendarDown;
interface ReconnectGroup {
  accountEmail: string | null;
  features: DownFeature[];
}

export function useReconnectCoordinator() {
  const syncStore = useSyncStore();
  const calendarStore = useCalendarSyncStore();
  const { reconnect: driveReconnect } = useGoogleReconnect();
  const { t } = useTranslation();

  const isReconnecting = ref(false);
  const reconnectError = ref<string | null>(null);

  /** Drive is enabled + genuinely down (its storage provider is Drive). */
  const driveDown = computed<DriveDown | null>(() => {
    if (
      !syncStore.showGoogleReconnect ||
      !syncStore.isGoogleDriveAvailable ||
      syncStore.storageProviderType !== 'google_drive'
    ) {
      return null;
    }
    return {
      kind: 'drive',
      email: syncStore.sessionAccountEmail ?? syncStore.providerAccountEmail,
    };
  });

  /** Every calendar connection that is enabled + needs reconnect. */
  const calendarDown = computed<CalendarDown[]>(() => {
    if (!isFlagEnabled('googleCalendarSync')) return [];
    return calendarStore.connections
      .filter((c) => c.status === 'needs_reconnect')
      .map((c) => ({ kind: 'calendar', connectionId: c.id, email: c.accountEmail }));
  });

  const downFeatures = computed<DownFeature[]>(() => [
    ...(driveDown.value ? [driveDown.value] : []),
    ...calendarDown.value,
  ]);

  /** The single prompt descriptor: null when nothing is down. */
  const activeReconnectPrompt = computed(() => {
    const hasDrive = driveDown.value !== null;
    const hasCalendar = calendarDown.value.length > 0;
    if (!hasDrive && !hasCalendar) return null;
    const variant = hasDrive && hasCalendar ? 'both' : hasDrive ? 'drive' : 'calendar';
    return {
      variant,
      titleKey: `reconnectPrompt.${variant}.title`,
      bodyKey: `reconnectPrompt.${variant}.body`,
    } as const;
  });

  /**
   * Group the down set by account. A calendar connection joins the Drive group
   * ONLY on a positive `driveEmail === connection.email` match (Pass 4 — never fold
   * an 'unknown'/different-account connection onto Drive; that would write Drive's
   * token into another account's connection). Everything unmatched is its own
   * single-feature group.
   */
  function buildReconnectPlan(): ReconnectGroup[] {
    const drive = driveDown.value;
    const cals = calendarDown.value;
    const groups: ReconnectGroup[] = [];
    const claimed = new Set<string>();

    if (drive) {
      const driveEmail = drive.email;
      const sameAccount = driveEmail ? cals.filter((c) => c.email === driveEmail) : [];
      sameAccount.forEach((c) => claimed.add(c.connectionId));
      groups.push({ accountEmail: driveEmail, features: [drive, ...sameAccount] });
    }
    for (const c of cals) {
      if (claimed.has(c.connectionId)) continue;
      groups.push({ accountEmail: c.email, features: [c] });
    }
    return groups;
  }

  /** Reconnect everything that's down, in as few consents as possible. */
  async function reconnectAll(): Promise<void> {
    if (isReconnecting.value) return;
    isReconnecting.value = true;
    reconnectError.value = null;
    try {
      for (const group of buildReconnectPlan()) {
        if (group.features.length >= 2) {
          // ≥2 features on one account → ONE unified consent for the scope union.
          const drive = group.features.find((f): f is DriveDown => f.kind === 'drive');
          const outcome = await startUnifiedReconnect(drive?.email ?? undefined);
          if (outcome === 'redirecting') return; // page is navigating away
          if (outcome === 'failed') reconnectError.value = t('reconnectPrompt.error');
          continue;
        }
        // Single-feature group → delegate to the existing per-feature primitive.
        const feature = group.features[0]!;
        if (feature.kind === 'drive') {
          // On a redirect surface the Drive reconnect navigates the page away and
          // returns true; stop the loop so we never start a second consent mid-nav.
          const redirecting = shouldUseRedirectAuth();
          const ok = await driveReconnect(feature.email ?? undefined);
          if (redirecting) return;
          if (!ok) reconnectError.value = t('reconnectPrompt.error');
        } else {
          const result = await calendarStore.reconnect(feature.connectionId);
          if (result.status === 'redirecting') return; // navigating away
          if (result.status === 'failed' && result.code !== 'cancelled') {
            reconnectError.value = t('reconnectPrompt.error');
          }
        }
      }
      // Completed inline (no redirect). Confirm success unless a group failed —
      // the stores' own self-heal clears the prompt reactively.
      if (!reconnectError.value) {
        showToast('success', t('reconnectPrompt.reconnected'));
      }
    } catch (error) {
      reconnectError.value = t('reconnectPrompt.error');
      reportError({
        surface: 'unified-reconnect',
        severity: 'warning',
        message: 'reconnect coordinator: reconnectAll threw',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      isReconnecting.value = false;
    }
  }

  return {
    downFeatures,
    activeReconnectPrompt,
    buildReconnectPlan,
    reconnectAll,
    isReconnecting,
    reconnectError,
  };
}
