// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import {
  driveConnectionId,
  upsertDriveConnection,
  getDriveConnectionByAccount,
  getAllDriveConnections,
  removeDriveConnectionByAccount,
} from '@/services/automerge/repositories/driveRepository';

describe('driveRepository', () => {
  beforeEach(async () => {
    await installInlineBackend();
  });

  describe('driveConnectionId', () => {
    it('normalizes email (trim + lowercase) so casing/whitespace converge', () => {
      expect(driveConnectionId('  Greg@Example.com ')).toBe('greg@example.com');
      expect(driveConnectionId('greg@example.com')).toBe('greg@example.com');
    });
  });

  it('upsert creates then updates the SAME entry keyed by normalized email', async () => {
    await upsertDriveConnection({
      provider: 'google',
      accountEmail: 'Greg@Example.com',
      refreshToken: 'tok-1',
      issuedAt: 1000,
    });
    // Different casing → same logical account → updates in place, not a 2nd row.
    await upsertDriveConnection({
      provider: 'google',
      accountEmail: 'greg@example.com',
      refreshToken: 'tok-2',
      issuedAt: 2000,
    });

    const all = await getAllDriveConnections();
    expect(all).toHaveLength(1);

    const entry = await getDriveConnectionByAccount('GREG@EXAMPLE.COM');
    expect(entry?.refreshToken).toBe('tok-2');
    expect(entry?.issuedAt).toBe(2000);
    expect(entry?.id).toBe('greg@example.com');
  });

  it('keeps separate entries per account (per-account, not family-wide)', async () => {
    await upsertDriveConnection({
      provider: 'google',
      accountEmail: 'a@example.com',
      refreshToken: 'a-tok',
      issuedAt: 1,
    });
    await upsertDriveConnection({
      provider: 'google',
      accountEmail: 'b@example.com',
      refreshToken: 'b-tok',
      issuedAt: 1,
    });
    expect(await getAllDriveConnections()).toHaveLength(2);
    expect((await getDriveConnectionByAccount('a@example.com'))?.refreshToken).toBe('a-tok');
    expect((await getDriveConnectionByAccount('b@example.com'))?.refreshToken).toBe('b-tok');
  });

  it('remove deletes by normalized email; get returns undefined after', async () => {
    await upsertDriveConnection({
      provider: 'google',
      accountEmail: 'greg@example.com',
      refreshToken: 'tok',
      issuedAt: null,
    });
    expect(await removeDriveConnectionByAccount('GREG@example.com ')).toBe(true);
    expect(await getDriveConnectionByAccount('greg@example.com')).toBeUndefined();
    expect(await removeDriveConnectionByAccount('greg@example.com')).toBe(false);
  });
});
