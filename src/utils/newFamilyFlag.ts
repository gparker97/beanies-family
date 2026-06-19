/**
 * One-shot signal that THIS session just CREATED a brand-new family (via
 * `syncStore.createNewFile`), as opposed to loading an existing one.
 *
 * Used to seed the what's-new read-state so a brand-new user doesn't get a
 * "what's new" spotlight drawer auto-opening for features they never not-had
 * (2026-06-19). A brand-new family has no `lastSeenWhatsNew` marker, so without
 * this seed every release reads as unread and `openToLatestAutoOpen()` pops the
 * latest spotlight immediately after signup.
 *
 * Module-level (not a store) on purpose: `createNewFile` and the
 * `useNotifications` ready-watcher run in the SAME JS session with no reload
 * between them, and this keeps the dependency decoupled — `syncStore` does NOT
 * import `notificationsStore`; the seed runs in `useNotifications`, which already
 * owns the read-state migration loop. Set by `createNewFile`, consumed once by
 * the watcher. Consume is read-and-reset so it only ever fires for the family
 * that was just created this session.
 */
let familyJustCreated = false;

/** Mark that the current session just created a brand-new family. */
export function markFamilyJustCreated(): void {
  familyJustCreated = true;
}

/** Read-and-reset the just-created flag (true at most once per creation). */
export function consumeFamilyJustCreated(): boolean {
  const v = familyJustCreated;
  familyJustCreated = false;
  return v;
}
