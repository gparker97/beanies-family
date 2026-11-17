// Pure checks on the scopes a calendar consent actually granted. Shared by the sync
// and view stores (which never import each other).

/** Can this grant list the account's calendars? Granular consent may have dropped the scope. */
export function hasCalendarListScope(grantedScopes: readonly string[]): boolean {
  return grantedScopes.some((s) => s.includes('calendar.calendarlist'));
}
