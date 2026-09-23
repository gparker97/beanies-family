/**
 * Revoking a removed member's Google Drive access to the family file (tracker #77).
 *
 * Drive is the HARD control for a removed member's access to FUTURE data: whatever key
 * material they still hold, without read access to the file they cannot fetch a new
 * version of it. Everything else removal does is defence in depth.
 *
 * Service, not store: it holds no state, so `familyStore.deleteMember` makes one call and
 * gains no Drive logic.
 */
import type { FamilyMember } from '@/types/models';
import { isUnshareableEmail, sameAccount } from '@/utils/email';
import { resolveCanonicalFolderId, revokeEmailsFromFile } from '@/services/google/driveService';
import { getValidToken } from '@/services/google/googleAuth';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

export interface RemovedMemberSnapshot {
  email?: string | null;
  googleAccountEmail?: string | null;
}

/**
 * The emails whose Drive permissions to remove. Pure.
 *
 * Excludes placeholder addresses, and any address still used by a REMAINING member or by
 * the actor — children commonly carry a parent's contact email, and removing the child
 * must never cut the parent off. The actor exclusion does not apply when the actor IS the
 * removed member (self-removal): then their own address is exactly the one to revoke.
 */
export function driveRevocationCandidates(
  removed: RemovedMemberSnapshot,
  remaining: readonly Pick<FamilyMember, 'email' | 'googleAccountEmail'>[],
  actorEmail: string | null,
  actorIsRemovedMember: boolean
): string[] {
  const inUse = (email: string) =>
    remaining.some(
      (m) => sameAccount(email, m.email) || sameAccount(email, m.googleAccountEmail)
    ) ||
    (!actorIsRemovedMember && sameAccount(email, actorEmail));
  const out: string[] = [];
  for (const raw of [removed.email, removed.googleAccountEmail]) {
    const email = raw?.trim();
    if (!email || isUnshareableEmail(email) || inUse(email)) continue;
    if (!out.some((e) => sameAccount(e, email))) out.push(email);
  }
  return out;
}

export type DriveRevocationResult = 'revoked' | 'nothing-to-revoke' | 'failed';

/**
 * Remove the given emails' permissions from the family file AND its canonical folder.
 *
 * Never throws. `'failed'` covers a token that could not be had, a folder that could not
 * be resolved (`resolveCanonicalFolderId` swallows errors and returns null, so null is a
 * failure, never "nothing to revoke"), a listing failure, or any refused delete.
 */
export async function revokeMemberDriveAccess(input: {
  fileId: string;
  emails: readonly string[];
}): Promise<DriveRevocationResult> {
  const { fileId, emails } = input;
  if (emails.length === 0) return 'nothing-to-revoke';

  let token: string;
  try {
    token = await getValidToken();
  } catch (e) {
    reportFailure('token', undefined, 0, e);
    return 'failed';
  }

  let deleted = 0;
  let failed = false;
  // FOLDER FIRST. A member shared the folder has an INHERITED permission on the file, and
  // Drive refuses to delete an inherited permission on the child — so file-first would
  // report a refusal (and send the family to check Drive by hand) for access the folder
  // delete a moment later removes anyway. After the folder goes, the file only lists what
  // was shared on it directly.
  const targets: Array<{ stage: 'file' | 'folder'; id: string | null }> = [
    { stage: 'folder', id: await resolveCanonicalFolderId(token, fileId) },
    { stage: 'file', id: fileId },
  ];
  for (const { stage, id } of targets) {
    if (!id) {
      reportFailure(stage, undefined, 0, new Error('could not resolve the family folder'));
      failed = true;
      continue;
    }
    try {
      const result = await revokeEmailsFromFile(token, id, emails);
      deleted += result.deleted;
      if (result.failed > 0) {
        reportFailure(stage, result.lastStatus, result.failed);
        failed = true;
      }
    } catch (e) {
      reportFailure(stage, (e as { status?: number }).status, 0, e);
      failed = true;
    }
  }

  if (failed) return 'failed';
  logEvent({
    level: 'info',
    surface: 'member-removal',
    message: 'drive_revoke',
    context: { action: 'drive_revoke', stage: 'folder+file', count: deleted },
  });
  return deleted > 0 ? 'revoked' : 'nothing-to-revoke';
}

function reportFailure(
  stage: 'file' | 'folder' | 'token',
  httpStatus: number | undefined,
  count: number,
  error?: unknown
): void {
  reportError({
    surface: 'member-removal',
    message: `could not remove a removed member's Drive access (${stage})`,
    severity: 'warning',
    error,
    context: {
      action: 'drive_revoke_failed',
      stage,
      count,
      ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
    },
  });
}
