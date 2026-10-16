/**
 * Shared query values for deep-linking into a specific Settings card/drawer via
 * `router.push({ path: '/settings', query: { open: <value> } })`.
 *
 * Kept here (not on `SettingsPage.vue`, a `<script setup>` SFC with only a
 * default export) so both the receiving `cardOpenMap` and any caller that opens
 * a drawer share one literal — renaming a key is a single edit, and drift can't
 * silently no-op the navigation.
 */

/** Opens Settings → Google Calendar. */
export const CALENDAR_SYNC_OPEN = 'calendar-sync';

/** Opens Settings → Reminders. */
export const REMINDERS_OPEN = 'reminders';

/** Opens Settings → AI & Privacy (a no-op unless the family can see the AI card). */
export const AI_SETTINGS_OPEN = 'ai';

/** Opens Settings → Security & Recovery. */
export const SECURITY_OPEN = 'security';

/** Opens Settings → Region & Holidays (country, time zone, holidays and the weather home town). */
// 'country-holidays' is a public URL contract (native bundles and help links ship it): never rename the value.
export const REGION_HOLIDAYS_OPEN = 'country-holidays';
