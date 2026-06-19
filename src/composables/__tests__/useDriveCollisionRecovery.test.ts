import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveExistingBeanpod = vi.fn();
const mockAdoptDriveStub = vi.fn();
vi.mock('@/services/sync/connectStorage', () => ({
  resolveExistingBeanpod: (...a: unknown[]) => mockResolveExistingBeanpod(...(a as [])),
  adoptDriveStub: (...a: unknown[]) => mockAdoptDriveStub(...(a as [])),
}));

const mockConfirm = vi.fn();
vi.mock('@/composables/useConfirm', () => ({
  confirm: (...a: unknown[]) => mockConfirm(...(a as [])),
}));

import { resolveDriveCollision } from '../useDriveCollisionRecovery';

const COLLISION = { fileId: 'f1', ownedByCurrentAccount: true };
const OPTS = { familyName: 'the-smiths', activeFamilyId: 'fam-1' };

describe('resolveDriveCollision (adopt-existing orchestration — 2026-06-19)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects a different-account collision without confirming or adopting', async () => {
    mockResolveExistingBeanpod.mockResolvedValue({ kind: 'reject-different-account' });
    const r = await resolveDriveCollision(COLLISION, OPTS);
    expect(r).toEqual({ kind: 'reject-different-account' });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockAdoptDriveStub).not.toHaveBeenCalled();
  });

  it('adopts an orphan stub silently (no confirm) and reports adopted-stub', async () => {
    mockResolveExistingBeanpod.mockResolvedValue({ kind: 'adopt-stub', fileId: 'f1' });
    mockAdoptDriveStub.mockResolvedValue({ status: 'connected', type: 'google_drive' });
    const r = await resolveDriveCollision(COLLISION, OPTS);
    expect(r).toEqual({ kind: 'adopted-stub' });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockAdoptDriveStub).toHaveBeenCalledWith('f1', 'the-smiths', {
      activeFamilyId: 'fam-1',
    });
  });

  it('surfaces a failure when adopting the stub throws', async () => {
    mockResolveExistingBeanpod.mockResolvedValue({ kind: 'adopt-stub', fileId: 'f1' });
    mockAdoptDriveStub.mockRejectedValue(new Error('drive down'));
    const r = await resolveDriveCollision(COLLISION, OPTS);
    expect(r).toEqual({ kind: 'failed', error: 'drive down' });
  });

  it('confirms then signals open-existing when the user accepts a populated pod', async () => {
    mockResolveExistingBeanpod.mockResolvedValue({ kind: 'adopt-existing', fileId: 'f1' });
    mockConfirm.mockResolvedValue(true);
    const r = await resolveDriveCollision(COLLISION, OPTS);
    expect(r).toEqual({ kind: 'open-existing', fileId: 'f1' });
    expect(mockAdoptDriveStub).not.toHaveBeenCalled();
  });

  it('declines (back to name entry) when the user cancels the confirm', async () => {
    mockResolveExistingBeanpod.mockResolvedValue({ kind: 'adopt-existing', fileId: 'f1' });
    mockConfirm.mockResolvedValue(false);
    const r = await resolveDriveCollision(COLLISION, OPTS);
    expect(r).toEqual({ kind: 'declined' });
  });
});
