<script setup lang="ts">
/**
 * Quiet, dismissible "connect Google Calendar" banner for the activities page.
 * Self-gating via useCalendarNudge (flag on + no calendar connected + not
 * dismissed + doc loaded) — renders nothing otherwise. Sits below the calendar
 * so it never crowds the flush calendar hero.
 */
import { useRouter } from 'vue-router';
import { useCalendarNudge } from '@/composables/useCalendarNudge';
import { useTranslation } from '@/composables/useTranslation';
import { reportError } from '@/utils/errorReporter';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';

const { t } = useTranslation();
const { showNudge, dismiss } = useCalendarNudge();
const router = useRouter();

/** Open Settings → Google Calendar. router.push rejects on aborted/redirected
 *  nav, so report rather than let it fail silently. */
function connect(): void {
  router.push({ path: '/settings', query: { open: CALENDAR_SYNC_OPEN } }).catch((err) =>
    reportError({
      surface: 'calendar-nudge-connect',
      message: 'calendar-nudge Connect navigation failed',
      error: err,
      severity: 'warning',
    })
  );
}
</script>

<template>
  <div v-if="showNudge" class="cal-nudge" data-testid="calendar-connect-nudge">
    <button
      type="button"
      class="cal-nudge-dismiss"
      :aria-label="t('planner.calendarNudge.dismiss')"
      @click="dismiss"
    >
      <span aria-hidden="true">&#x2715;</span>
    </button>

    <span class="cal-nudge-icon">
      <span aria-hidden="true">&#x1F4C5;</span>
      <span class="cal-nudge-bean" aria-hidden="true">&#x1FAD8;</span>
    </span>

    <span class="cal-nudge-text">
      <span class="cal-nudge-title">{{ t('planner.calendarNudge.title') }}</span>
      <span class="cal-nudge-sub">{{ t('planner.calendarNudge.subtitle') }}</span>
    </span>

    <button type="button" class="cal-nudge-connect" @click="connect">
      {{ t('planner.calendarNudge.connect') }}
    </button>
  </div>
</template>

<style scoped>
.cal-nudge {
  align-items: center;
  background: linear-gradient(180deg, var(--tint-silk-30), var(--tint-silk-20));
  border: 1px solid rgb(174 214 241 / 55%);
  border-radius: var(--sq);
  display: flex;
  gap: 0.75rem;
  padding: 0.8rem 0.75rem;
  position: relative;
}

:global(.dark) .cal-nudge {
  border-color: rgb(174 214 241 / 25%);
}

.cal-nudge-icon {
  align-items: center;
  background: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 2px 8px rgb(44 62 80 / 8%);
  display: flex;
  flex-shrink: 0;
  font-size: 1.15rem;
  height: 2.5rem;
  justify-content: center;
  position: relative;
  width: 2.5rem;
}

:global(.dark) .cal-nudge-icon {
  background: #243342;
}

.cal-nudge-bean {
  bottom: -0.3rem;
  filter: drop-shadow(0 1px 2px rgb(44 62 80 / 20%));
  font-size: 0.85rem;
  position: absolute;
  right: -0.3rem;
}

.cal-nudge-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.cal-nudge-title {
  color: var(--deep-slate);
  font-family: Outfit, sans-serif;
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

:global(.dark) .cal-nudge-title {
  color: rgb(241 242 244);
}

.cal-nudge-sub {
  color: rgb(44 62 80 / 60%);
  font-size: 0.8rem;
  line-height: 1.35;
  margin-top: 0.05rem;
}

:global(.dark) .cal-nudge-sub {
  color: rgb(241 242 244 / 65%);
}

.cal-nudge-connect {
  background: var(--heritage-orange);
  border: none;
  border-radius: 999px;
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  font-family: Outfit, sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.44rem 0.9rem;
  transition: filter 0.15s ease-out;
}

.cal-nudge-connect:hover {
  filter: brightness(1.05);
}

.cal-nudge-connect:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

.cal-nudge-dismiss {
  align-items: center;
  background: rgb(44 62 80 / 6%);
  border: none;
  border-radius: 50%;
  color: rgb(44 62 80 / 45%);
  cursor: pointer;
  display: flex;
  font-size: 0.72rem;
  height: 1.15rem;
  justify-content: center;
  position: absolute;
  right: 0.45rem;
  top: 0.45rem;
  width: 1.15rem;
}

.cal-nudge-dismiss:hover {
  background: rgb(44 62 80 / 12%);
}

.cal-nudge-dismiss:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

:global(.dark) .cal-nudge-dismiss {
  background: rgb(255 255 255 / 10%);
  color: rgb(241 242 244 / 55%);
}
</style>
