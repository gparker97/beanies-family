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
  sourceId: 'conn-1',
  source: 'own',
  sourceName: 'mum@example.com',
  activityId: 'a1',
  occurrenceDate: '2026-06-11',
  fingerprint,
});

const viewedRaw = (): ClashInfo => ({
  sourceId: 'vc-1',
  source: 'viewed',
  sourceName: "Grandma's calendar",
  activityId: 'a1',
  occurrenceDate: '2026-06-11',
  fingerprint: 'fp-1',
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
    expect(useClash('a1', '2026-06-11').value).toEqual({
      ...raw('fp-1'),
      acknowledged: false,
      label: 'your mum@example.com calendar',
    });
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

describe('useClash label', () => {
  it('a connected calendar keeps the existing wording: "your {email} calendar"', () => {
    clashForMock.mockReturnValue(raw('fp-1'));
    isAcknowledgedMock.mockReturnValue(false);
    expect(useClash('a1', '2026-06-11').value?.label).toBe('your mum@example.com calendar');
  });

  it('a viewed calendar is named exactly as stored, with no "calendar" added', () => {
    clashForMock.mockReturnValue(viewedRaw());
    isAcknowledgedMock.mockReturnValue(false);
    const lookup = useClashLookup();
    expect(lookup('a1', '2026-06-11')?.label).toBe("Grandma's calendar");
  });

  it('a viewed clash joins the ack memory under the viewed calendar id', () => {
    clashForMock.mockReturnValue(viewedRaw());
    isAcknowledgedMock.mockReturnValue(true);
    expect(useClash('a1', '2026-06-11').value?.acknowledged).toBe(true);
    expect(isAcknowledgedMock).toHaveBeenCalledWith('a1', '2026-06-11', 'vc-1', 'fp-1');
  });
});
