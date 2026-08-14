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
import type { UIStringKey } from '@/services/translation/uiStrings';
import { isFlagEnabled } from '@/config/flags';
import { shouldUseRedirectAuth } from '@/services/google/googleAuth';
import { startUnifiedReconnect } from '@/services/google/unifiedReconnect';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';

type DriveDown = { kind: 'drive'; email: string | null };
type CalendarDown = { kind: 'calendar'; connectionId: string; email: string };
type DownFeature = DriveDown | CalendarDown;
interface ReconnectGroup {
  accountEmail: string | null;
  features: DownFeature[];
}

/** Google account emails are case-insensitive — compare case-folded so a stored
 *  connection email that differs only in case still matches the live session. */
function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
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
    // The "both" prompt only promises "reconnect ONCE" when Drive and every down
    // calendar connection share one account (a single unified consent). When they
    // are on DIFFERENT accounts the plan splits into separate consents, so use the
    // non-"once" body to avoid over-promising (code-review finding).
    const oneConsent =
      variant === 'both' &&
      calendarDown.value.every((c) => sameAccount(c.email, driveDown.value?.email));
    const bodyKey: UIStringKey =
      variant === 'both' && !oneConsent
        ? 'reconnectPrompt.both.bodyMulti'
        : (`reconnectPrompt.${variant}.body` as UIStringKey);
    return {
      variant,
      titleKey: `reconnectPrompt.${variant}.title` as UIStringKey,
      bodyKey,
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
      // Case-insensitive match — Google emails are case-insensitive (finding).
      const sameAccountCals = cals.filter((c) => sameAccount(c.email, driveEmail));
      sameAccountCals.forEach((c) => claimed.add(c.connectionId));
      groups.push({ accountEmail: driveEmail, features: [drive, ...sameAccountCals] });
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
    const variant = activeReconnectPrompt.value?.variant ?? 'none';
    // `ranAny` guards the success toast against an empty/self-healed plan: if the
    // stores self-heal between render and click, the plan is empty and we must NOT
    // claim "Reconnected" for work that never ran (code-review finding).
    let ranAny = false;
    let outcome: 'ok' | 'failed' | 'redirecting' | 'noop' = 'noop';
    try {
      for (const group of buildReconnectPlan()) {
        ranAny = true;
        if (group.features.length >= 2) {
          // ≥2 features on one account → ONE unified consent for the scope union.
          const drive = group.features.find((f): f is DriveDown => f.kind === 'drive');
          const result = await startUnifiedReconnect(drive?.email ?? undefined);
          if (result === 'redirecting') {
            outcome = 'redirecting';
            return; // page is navigating away
          }
          if (result === 'failed') reconnectError.value = t('reconnectPrompt.error');
          continue;
        }
        // Single-feature group → delegate to the existing per-feature primitive.
        const feature = group.features[0]!;
        if (feature.kind === 'drive') {
          // On a redirect surface the Drive reconnect navigates the page away and
          // returns true; stop the loop so we never start a second consent mid-nav.
          const redirecting = shouldUseRedirectAuth();
          const ok = await driveReconnect(feature.email ?? undefined);
          if (redirecting) {
            outcome = 'redirecting';
            return;
          }
          if (!ok) reconnectError.value = t('reconnectPrompt.error');
        } else {
          const result = await calendarStore.reconnect(feature.connectionId);
          if (result.status === 'redirecting') {
            outcome = 'redirecting';
            return; // navigating away
          }
          if (result.status === 'failed' && result.code !== 'cancelled') {
            reconnectError.value = t('reconnectPrompt.error');
          }
        }
      }
      outcome = reconnectError.value ? 'failed' : ranAny ? 'ok' : 'noop';
      // Confirm success only when we actually ran a group and none failed — the
      // stores' own self-heal clears the prompt reactively.
      if (ranAny && !reconnectError.value) {
        showToast('success', t('reconnectPrompt.reconnected'));
      }
    } catch (error) {
      outcome = 'failed';
      reconnectError.value = t('reconnectPrompt.error');
      reportError({
        surface: 'unified-reconnect',
        severity: 'warning',
        message: 'reconnect coordinator: reconnectAll threw',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      isReconnecting.value = false;
      // Success-path signal too (per CLAUDE.md observability rule) so the unified
      // reconnect's outcome RATE by variant is measurable, not just failures.
      logEvent({
        level: outcome === 'failed' ? 'warn' : 'info',
        surface: 'unified-reconnect',
        message: 'reconnect action complete',
        context: { action: `reconnect-all:${variant}:${outcome}` },
      });
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
