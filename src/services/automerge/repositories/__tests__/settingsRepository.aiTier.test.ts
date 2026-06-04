/**
 * #133 Phase 4 — settingsRepository aiTier default, optional-field backfill, and the
 * legacy BYOK migration in getSettings().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetDoc } = vi.hoisted(() => ({ mockGetDoc: vi.fn() }));

vi.mock('@/services/automerge/docService', () => ({
  getDoc: mockGetDoc,
  changeDoc: vi.fn(),
}));

import { getDefaultSettings, getSettings } from '../settingsRepository';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settingsRepository aiTier (#133)', () => {
  it('getDefaultSettings seeds aiTier="managed"', () => {
    expect(getDefaultSettings().aiTier).toBe('managed');
  });

  it('getSettings returns defaults when no settings doc exists', async () => {
    mockGetDoc.mockReturnValue({});
    const s = await getSettings();
    expect(s.aiTier).toBe('managed');
  });

  it('backfills aiTier="managed" for a legacy doc that predates the field (no BYOK key)', async () => {
    // A doc written before aiTier existed: has the field set but no aiTier, no key.
    mockGetDoc.mockReturnValue({
      settings: { id: 'app_settings', baseCurrency: 'EUR', aiProvider: 'none', aiApiKeys: {} },
    });
    const s = await getSettings();
    expect(s.aiTier).toBe('managed');
    expect(s.baseCurrency).toBe('EUR'); // existing field preserved over the default
  });

  it('migrates a legacy doc with a configured BYOK provider+key to aiTier="byok"', async () => {
    mockGetDoc.mockReturnValue({
      settings: { id: 'app_settings', aiProvider: 'openai', aiApiKeys: { openai: 'sk-legacy' } },
    });
    const s = await getSettings();
    expect(s.aiTier).toBe('byok');
  });

  it('does NOT migrate when the provider has no stored key', async () => {
    mockGetDoc.mockReturnValue({
      settings: { id: 'app_settings', aiProvider: 'openai', aiApiKeys: {} },
    });
    const s = await getSettings();
    expect(s.aiTier).toBe('managed');
  });

  it('preserves an explicitly-stored aiTier (no migration override)', async () => {
    mockGetDoc.mockReturnValue({
      settings: {
        id: 'app_settings',
        aiTier: 'managed',
        aiProvider: 'openai',
        aiApiKeys: { openai: 'sk-x' },
      },
    });
    const s = await getSettings();
    expect(s.aiTier).toBe('managed'); // explicit choice wins over the byok-detection
  });
});
