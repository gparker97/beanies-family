import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the capability probe + the picker; mock the Drive-side deps just so the
// module imports cleanly (these tests only exercise connectLocalStorage).
vi.mock('@/services/sync/capabilities', () => ({
  supportsFileSystemAccess: vi.fn(),
}));
vi.mock('@/services/sync/syncService', () => ({
  selectSyncFile: vi.fn(),
  setProvider: vi.fn(),
}));
vi.mock('@/services/google/googleAuth', () => ({
  shouldUseRedirectAuth: vi.fn(() => false),
  startRedirectAuth: vi.fn(),
  isTokenValid: vi.fn(() => true),
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: { createNew: vi.fn() },
}));

import { connectLocalStorage } from '../connectStorage';
import { supportsFileSystemAccess } from '@/services/sync/capabilities';
import * as syncService from '@/services/sync/syncService';

const mockSupports = vi.mocked(supportsFileSystemAccess);
const mockSelect = vi.mocked(syncService.selectSyncFile);

describe('connectLocalStorage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('flags an unsupported browser (Firefox/Safari) distinctly — not as a cancel — and never opens the picker', async () => {
    mockSupports.mockReturnValue(false);

    const r = await connectLocalStorage();

    expect(r).toMatchObject({ status: 'failed', errorKind: 'unsupported-browser' });
    // Crucially NOT cancelled — a cancel would surface the generic "try again",
    // which is wrong here (a retry can never succeed in this browser).
    expect(r).not.toHaveProperty('cancelled');
    // No point opening a picker that doesn't exist.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('connects when a capable browser selects a file', async () => {
    mockSupports.mockReturnValue(true);
    mockSelect.mockResolvedValue(true);

    expect(await connectLocalStorage()).toEqual({ status: 'connected', type: 'local' });
  });

  it('reports a dismissed picker as cancelled (not unsupported-browser) in a capable browser', async () => {
    mockSupports.mockReturnValue(true);
    mockSelect.mockResolvedValue(false);

    const r = await connectLocalStorage();

    expect(r).toMatchObject({ status: 'failed', cancelled: true });
    expect(r).not.toHaveProperty('errorKind');
  });

  it('surfaces a thrown picker error as a generic (reportable) failure', async () => {
    mockSupports.mockReturnValue(true);
    mockSelect.mockRejectedValue(new Error('boom'));

    const r = await connectLocalStorage();

    expect(r).toMatchObject({ status: 'failed', error: 'boom' });
    expect(r).not.toHaveProperty('cancelled');
    expect(r).not.toHaveProperty('errorKind');
  });
});
