import { describe, it, expect } from 'vitest';
import { SAVE_STATUS_PRESENTATION } from '@/components/ui/saveStatusPresentation';
import type { SaveStatus } from '@/stores/syncStore';

const ALL_STATUSES: SaveStatus[] = ['saving', 'critical', 'degraded', 'saved', 'hidden'];

describe('SAVE_STATUS_PRESENTATION', () => {
  it('is total — one entry per SaveStatus, so a total saveStatus never indexes a missing key', () => {
    expect(Object.keys(SAVE_STATUS_PRESENTATION).sort()).toEqual([...ALL_STATUSES].sort());
    for (const status of ALL_STATUSES) {
      expect(SAVE_STATUS_PRESENTATION[status]).toBeDefined();
    }
  });

  it('flags attention (hamburger dot + amber tint) only for degraded and critical', () => {
    expect(SAVE_STATUS_PRESENTATION.degraded.attention).toBe(true);
    expect(SAVE_STATUS_PRESENTATION.critical.attention).toBe(true);
    expect(SAVE_STATUS_PRESENTATION.saved.attention).toBe(false);
    expect(SAVE_STATUS_PRESENTATION.saving.attention).toBe(false);
    expect(SAVE_STATUS_PRESENTATION.hidden.attention).toBe(false);
  });

  it('renders nothing only for the hidden state', () => {
    expect(SAVE_STATUS_PRESENTATION.hidden.visible).toBe(false);
    for (const status of ['saving', 'critical', 'degraded', 'saved'] as SaveStatus[]) {
      expect(SAVE_STATUS_PRESENTATION[status].visible).toBe(true);
    }
  });

  it('interpolates relative time only for the saved state', () => {
    expect(SAVE_STATUS_PRESENTATION.saved.usesRelativeTime).toBe(true);
    for (const status of ['saving', 'critical', 'degraded', 'hidden'] as SaveStatus[]) {
      expect(SAVE_STATUS_PRESENTATION[status].usesRelativeTime).toBe(false);
    }
  });
});
