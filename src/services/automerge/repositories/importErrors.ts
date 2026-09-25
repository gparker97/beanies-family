/**
 * Thrown when an import batch committed but its entities are not where readers look.
 *
 * Shared by every importer that writes one atomic batch and then verifies the projection (the
 * Google Calendar import, #94; the statement import, #107). It is deliberately NOT a "nothing was
 * imported" failure: the write may well have landed, so a caller that tells the user to try
 * again invites a second set of everything. Callers phrase it as "not confirmed yet".
 */
export class ImportNotVisibleError extends Error {
  missing: number;
  total: number;

  constructor(missing: number, total: number, source = 'createImportedActivities') {
    super(
      `${source}: ${missing} of ${total} entities missing from the projection after a batch write`
    );
    this.name = 'ImportNotVisibleError';
    this.missing = missing;
    this.total = total;
  }
}
