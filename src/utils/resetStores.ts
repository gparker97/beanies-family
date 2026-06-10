import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { useAssetsStore } from '@/stores/assetsStore';
import { useGoalsStore } from '@/stores/goalsStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useCalendarClashStore } from '@/stores/calendarClashStore';
import { isFlagEnabled } from '@/config/flags';

/**
 * Reset every Pinia store that holds family-scoped state — call on sign-out and
 * on family switch so the next family / session starts clean. This list used to
 * be duplicated verbatim in AppHeader, MobileHamburgerMenu, and SettingsPage;
 * it now lives in one place, so adding a new store is a one-line change here.
 */
export function resetAllAppStores(): void {
  useSyncStore().resetState();
  useFamilyStore().resetState();
  useAccountsStore().resetState();
  useTransactionsStore().resetState();
  useAssetsStore().resetState();
  useGoalsStore().resetState();
  useRecurringStore().resetState();
  useSettingsStore().resetState();
  useMemberFilterStore().resetState();
  useTodoStore().resetState();
  useActivityStore().resetState();
  useHolidayStore().resetState();
  // Tear down the calendar sync engine (pollers + watchers + module state) so it
  // doesn't keep running after sign-out / family-switch (F7). Flag-gated so the
  // store isn't instantiated when the feature is off.
  if (isFlagEnabled('googleCalendarSync')) useCalendarSyncStore().stop();
  // Clear the read-only clash engine's ephemeral busy cache + decoration (#34).
  if (isFlagEnabled('calendarClashNudge')) useCalendarClashStore().stop();
}
