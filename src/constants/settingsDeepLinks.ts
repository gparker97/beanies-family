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
