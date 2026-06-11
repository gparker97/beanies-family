import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { ClashInfo } from '@/utils/calendar/clashDetection';

// The seam joins detection (calendarClashStore) + memory (overlapAckStore); mock
// both so we test only the enrichment formula.
const clashForMock = vi.fn<(id: string, date: string) => ClashInfo | undefined>();
const isAcknowledgedMock = vi.fn<(a: string, d: string, c: string, fp: string) => boolean>();

vi.mock('@/stores/calendarClashStore', () => ({
  useCalendarClashStore: () => ({ clashFor: clashForMock }),
}));
vi.mock('@/stores/overlapAckStore', () => ({
  useOverlapAckStore: () => ({ isAcknowledged: isAcknowledgedMock }),
}));

import { useClash, useClashLookup } from '@/composables/useClash';

const raw = (fingerprint: string): ClashInfo => ({
  connectionId: 'conn-1',
  calendarLabel: 'mum@example.com',
  activityId: 'a1',
  occurrenceDate: '2026-06-11',
  fingerprint,
});

beforeEach(() => {
  setActivePinia(createPinia());
  clashForMock.mockReset();
  isAcknowledgedMock.mockReset();
});

describe('useClash enrichment', () => {
  it('returns undefined and never consults the ack store when there is no clash', () => {
    clashForMock.mockReturnValue(undefined);
    expect(useClash('a1', '2026-06-11').value).toBeUndefined();
    expect(isAcknowledgedMock).not.toHaveBeenCalled();
  });

  it('enriches with acknowledged=false when not acknowledged', () => {
    clashForMock.mockReturnValue(raw('fp-1'));
    isAcknowledgedMock.mockReturnValue(false);
    expect(useClash('a1', '2026-06-11').value).toEqual({ ...raw('fp-1'), acknowledged: false });
    expect(isAcknowledgedMock).toHaveBeenCalledWith('a1', '2026-06-11', 'conn-1', 'fp-1');
  });

  it('enriches with acknowledged=true when the matching fingerprint is acknowledged', () => {
    clashForMock.mockReturnValue(raw('fp-1'));
    isAcknowledgedMock.mockReturnValue(true);
    expect(useClash('a1', '2026-06-11').value?.acknowledged).toBe(true);
  });

  it('re-raises (acknowledged=false) after the fingerprint changes — a reschedule', () => {
    const lookup = useClashLookup();
    // Ack stored against fp-1 only.
    isAcknowledgedMock.mockImplementation((_a, _d, _c, fp) => fp === 'fp-1');

    clashForMock.mockReturnValue(raw('fp-1'));
    expect(lookup('a1', '2026-06-11')?.acknowledged).toBe(true);

    // Rescheduled → new fingerprint → no longer acknowledged.
    clashForMock.mockReturnValue(raw('fp-2'));
    expect(lookup('a1', '2026-06-11')?.acknowledged).toBe(false);
  });
});
