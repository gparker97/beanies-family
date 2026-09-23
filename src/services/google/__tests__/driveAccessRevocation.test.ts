/**
 * Removing a removed member's Google Drive access (tracker #77).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const drive = vi.hoisted(() => ({
  resolveCanonicalFolderId: vi.fn(),
  revokeEmailsFromFile: vi.fn(),
}));
vi.mock('@/services/google/driveService', () => drive);
vi.mock('@/services/google/googleAuth', () => ({ getValidToken: vi.fn(async () => 'tok') }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { driveRevocationCandidates, revokeMemberDriveAccess } from '../driveAccessRevocation';

describe('driveRevocationCandidates', () => {
  it('never revokes an address a remaining member still uses (a child on a parent’s email)', () => {
    const emails = driveRevocationCandidates(
      { email: 'Parent@Gmail.com', googleAccountEmail: 'kid@gmail.com' },
      [{ email: 'parent@gmail.com', googleAccountEmail: undefined }],
      'owner@gmail.com',
      false
    );
    expect(emails).toEqual(['kid@gmail.com']);
  });

  it('skips placeholders and the actor — unless the actor is removing themselves', () => {
    const removed = { email: 'pending-1@setup.local', googleAccountEmail: 'me@gmail.com' };
    expect(driveRevocationCandidates(removed, [], 'me@gmail.com', false)).toEqual([]);
    expect(driveRevocationCandidates(removed, [], 'me@gmail.com', true)).toEqual(['me@gmail.com']);
  });
});

describe('revokeMemberDriveAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drive.resolveCanonicalFolderId.mockResolvedValue('folder-1');
    drive.revokeEmailsFromFile.mockResolvedValue({ deleted: 1, failed: 0 });
  });

  it('revokes on the FOLDER first, then the file', async () => {
    expect(await revokeMemberDriveAccess({ fileId: 'file-1', emails: ['kid@gmail.com'] })).toBe(
      'revoked'
    );
    expect(drive.revokeEmailsFromFile.mock.calls.map((c) => c[1])).toEqual(['folder-1', 'file-1']);
  });

  it('treats an unresolvable folder as a failure, never as nothing to revoke', async () => {
    drive.resolveCanonicalFolderId.mockResolvedValue(null);
    expect(await revokeMemberDriveAccess({ fileId: 'file-1', emails: ['kid@gmail.com'] })).toBe(
      'failed'
    );
  });

  it('reports a refused delete as a failure', async () => {
    drive.revokeEmailsFromFile.mockResolvedValueOnce({ deleted: 0, failed: 1, lastStatus: 403 });
    expect(await revokeMemberDriveAccess({ fileId: 'file-1', emails: ['kid@gmail.com'] })).toBe(
      'failed'
    );
  });

  it('says nothing-to-revoke when no permission matched and nothing failed', async () => {
    drive.revokeEmailsFromFile.mockResolvedValue({ deleted: 0, failed: 0 });
    expect(await revokeMemberDriveAccess({ fileId: 'file-1', emails: ['kid@gmail.com'] })).toBe(
      'nothing-to-revoke'
    );
  });
});
