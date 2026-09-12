<script setup lang="ts">
/**
 * Unified Google reconnect toast (tracker #62, commit 5) — the SINGLE reconnect
 * prompt that supersedes the separate Drive (`GoogleReconnectToast`) and Calendar
 * (`CalendarReconnectToast`) toasts. Binds `useReconnectCoordinator` to the shared,
 * presentational `ReconnectToast`.
 *
 * It names exactly what's down — "Google Drive + Calendar" when both, or the single
 * feature when only one — and its one button reconnects everything in as few
 * consents as possible (one unified consent for a same-account Drive+Calendar pair;
 * delegated per-feature otherwise). State-driven (like the toasts it replaces): the
 * prompt appears/clears off the stores' reconnect state, so it never routes through
 * `claimInterruption`, and there is no per-incident local dismiss to flash.
 *
 * ## Two audiences for a calendar outage
 *
 * `needs_reconnect` lives in the family-wide CRDT, so one revoked grant was true on
 * every member's device at once — and every one of them got the same actionable,
 * non-dismissable prompt, sitting over the mobile tab bar. For a member who never
 * set the integration up and has no access to the Google account, that is an
 * obstruction with no exit: the one button opens a consent screen for somebody
 * else's account.
 *
 * So a CALENDAR-ONLY outage now splits. Whoever can act gets the prompt unchanged;
 * everybody else gets a dismissable notice naming who to ask, with no button.
 * `useCalendarOutageAudience` makes that call (the decision itself is pure, in
 * `utils/calendar/connectionOwner`).
 *
 * ⚠️ Drive is NOT split, and must not be: unsaved family data is everyone's problem.
 * That guarantee is enforced inside `decideOutageAudience`, not here.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useReconnectCoordinator } from '@/composables/useReconnectCoordinator';
import { useCalendarOutageAudience } from '@/composables/useCalendarOutageAudience';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { isExternalLandingRoute } from '@/utils/appChrome';
import { fillTemplate } from '@/utils/fillTemplate';
import ReconnectToast from '@/components/common/ReconnectToast.vue';

const { t } = useTranslation();
const { getMemberName } = useMemberInfo();
const route = useRoute();
const { downFeatures, activeReconnectPrompt, reconnectAll, isReconnecting, reconnectError } =
  useReconnectCoordinator();

/**
 * Display-only. `activeReconnectPrompt` remains the STATE and is deliberately
 * untouched: `reconnectAll` reads its `variant` to label its own telemetry, so
 * nulling the state would quietly relabel every one of those events `'none'`.
 *
 * This is a SUPPRESSION, not a cancellation — the two names are the comment.
 * Nobody reading `visibleReconnectPrompt` concludes the reconnect was cancelled,
 * and the prompt appears the instant the user navigates to a real app route.
 *
 * WHY: someone opening a shared-recipe link is a visitor, not a user. They have
 * no Google connection of ours to repair, and asking them to reconnect one is
 * both meaningless and alarming. `isExternalLandingRoute` is exactly the right
 * test — `ShareTarget` and `SharedRecipe`, the two routes whose whole job is to
 * serve content to someone arriving from outside. The broader
 * `isPublicEntryRoute` is NOT used: it also covers `OpenFromDrive` and `Login`,
 * where a reconnect prompt is legitimate and hiding it would build a dead end.
 *
 * The computed lives HERE rather than in `useReconnectCoordinator` because this
 * is the composable's only consumer and it is component-scoped, so the composable
 * and its existing tests keep a zero-line diff.
 */
const visibleReconnectPrompt = computed(() =>
  isExternalLandingRoute(route) ? null : activeReconnectPrompt.value
);

const { audience, dismiss } = useCalendarOutageAudience(
  downFeatures,
  computed(() => visibleReconnectPrompt.value?.variant ?? null)
);

/** True when this viewer is being told about an outage they cannot repair. */
const isNotice = computed(() => audience.value.mode === 'notice');

const title = computed(() =>
  isNotice.value
    ? t('reconnectPrompt.calendar.noticeTitle')
    : visibleReconnectPrompt.value
      ? t(visibleReconnectPrompt.value.titleKey)
      : undefined
);

/**
 * The notice body names whoever can fix it, so the reader knows what to do next.
 *
 * Three shapes, because "ask someone" is only useful if the someone is nameable:
 * a resolved member, else the Google account itself, else — when consent returned
 * no address at all (`accountEmail` is the `'unknown'` sentinel) — a form that
 * names neither, rather than rendering "ask whoever manages unknown".
 */
const noticeBody = computed(() => {
  const a = audience.value;
  if (a.mode !== 'notice') return undefined;
  if (a.owner.kind === 'member') {
    return fillTemplate(t('reconnectPrompt.calendar.noticeBody'), {
      name: getMemberName(a.owner.memberId, t('family.unknownMemberInline')),
    });
  }
  return a.owner.accountEmail
    ? fillTemplate(t('reconnectPrompt.calendar.noticeBodyAccount'), {
        account: a.owner.accountEmail,
      })
    : t('reconnectPrompt.calendar.noticeBodyUnknown');
});

const subtitle = computed(() => {
  if (isNotice.value) return noticeBody.value;
  if (reconnectError.value) return reconnectError.value;
  return visibleReconnectPrompt.value ? t(visibleReconnectPrompt.value.bodyKey) : undefined;
});
</script>

<template>
  <ReconnectToast
    v-if="visibleReconnectPrompt && audience.mode !== 'hidden' && title"
    :title="title"
    :subtitle="subtitle"
    :subtitle-is-error="!isNotice && !!reconnectError"
    :busy="isReconnecting"
    :reconnect-label="isNotice ? undefined : t('reconnectPrompt.action')"
    :dismiss-label="isNotice ? t('action.dismiss') : undefined"
    @reconnect="reconnectAll"
    @dismiss="dismiss"
  >
    <template #icon>
      <span class="text-base" aria-hidden="true">&#x1F517;</span>
    </template>
  </ReconnectToast>
</template>
