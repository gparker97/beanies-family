// Google Drive refresh-token recovery copies (B). Rides the generic
// `createAutomergeRepository` factory (id/timestamps/CRDT-change handled there).
//
// UNLIKE calendar connections, these are PER-ACCOUNT, not family-wide: the doc
// key is the normalized account email (`driveConnectionId`), so each Google
// account has exactly one entry and a device only ever reads the entry for the
// account it is bound to (the account-match guard lives in `driveTokenRecovery`).
// The local IndexedDB store (`fileHandleStore`) stays the primary token home;
// this collection is an additive recovery copy.

import { createAutomergeRepository } from '../automergeRepository';
import type {
  DriveConnection,
  CreateDriveConnectionInput,
  UpdateDriveConnectionInput,
} from '@/types/models';

const driveRepo = createAutomergeRepository<
  'driveConnections',
  DriveConnection,
  CreateDriveConnectionInput,
  UpdateDriveConnectionInput
>('driveConnections');

/**
 * Deterministic id for a Drive connection — the normalized (trimmed +
 * lowercased) account email. Plain string, NOT a hash: the email is already
 * stored cleartext in `accountEmail` inside the same encrypted doc, so hashing
 * the key buys nothing and costs debuggability. Mirrors `calendarEventLinkId`.
 */
export function driveConnectionId(accountEmail: string): string {
  return accountEmail.trim().toLowerCase();
}

export const getAllDriveConnections = driveRepo.getAll;

export function getDriveConnectionByAccount(
  accountEmail: string
): Promise<DriveConnection | undefined> {
  return driveRepo.getById(driveConnectionId(accountEmail));
}

/**
 * Upsert-by-account-email (idempotent across devices). Creates the entry if
 * absent, otherwise updates the existing record's token/issuedAt in place.
 */
export async function upsertDriveConnection(
  input: CreateDriveConnectionInput
): Promise<DriveConnection> {
  const id = driveConnectionId(input.accountEmail);
  const existing = await driveRepo.getById(id);
  if (existing) {
    // No-op when the refresh token is unchanged — `update()` always bumps
    // `updatedAt` + emits a CRDT op, so without this guard every interactive
    // acquisition that re-issues the same long-lived token would churn the doc
    // and re-sync across all family devices for no value. (issuedAt alone is
    // metadata; the token is the meaningful content.)
    if (existing.refreshToken === input.refreshToken) return existing;
    const updated = await driveRepo.update(id, {
      refreshToken: input.refreshToken,
      issuedAt: input.issuedAt,
      provider: input.provider,
      accountEmail: input.accountEmail,
    });
    // update() returns undefined only if the row vanished between the read and
    // the write (concurrent remove) — fall back to a create so we never silently
    // drop the token.
    return updated ?? driveRepo.createWithId(id, input);
  }
  return driveRepo.createWithId(id, input);
}

export function removeDriveConnectionByAccount(accountEmail: string): Promise<boolean> {
  return driveRepo.remove(driveConnectionId(accountEmail));
}
