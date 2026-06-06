import { describe, it, expect } from 'vitest';
import {
  resolveSegmentTravellers,
  isTravellerSubset,
  matchTravellerIds,
  unionTravellerIds,
} from '@/utils/segmentTravellers';
import type { FamilyMember } from '@/types/models';
import type { SegmentBuckets } from '@/utils/travelExtractionToSegments';

function member(id: string, name: string): FamilyMember {
  return { id, name } as FamilyMember;
}

const TRIP = ['dad', 'mum', 'kid1', 'kid2'];

describe('resolveSegmentTravellers', () => {
  it('returns the trip default when the segment list is undefined', () => {
    expect(resolveSegmentTravellers(undefined, TRIP)).toBe(TRIP);
  });
  it('returns the segment list verbatim when defined', () => {
    expect(resolveSegmentTravellers(['dad'], TRIP)).toEqual(['dad']);
  });
  it('returns an empty list verbatim (does not fall back)', () => {
    expect(resolveSegmentTravellers([], TRIP)).toEqual([]);
  });
});

describe('isTravellerSubset', () => {
  it('is false when undefined (everyone)', () => {
    expect(isTravellerSubset(undefined, TRIP)).toBe(false);
  });
  it('is false when the segment covers the full trip', () => {
    expect(isTravellerSubset(['dad', 'mum', 'kid1', 'kid2'], TRIP)).toBe(false);
  });
  it('is true for a strict subset', () => {
    expect(isTravellerSubset(['dad'], TRIP)).toBe(true);
  });
  it('is true for an empty list', () => {
    expect(isTravellerSubset([], TRIP)).toBe(true);
  });
  it('ignores extra ids not on the trip (still covers everyone)', () => {
    expect(isTravellerSubset([...TRIP, 'guest'], TRIP)).toBe(false);
  });
});

describe('matchTravellerIds', () => {
  const roster = [member('m-john', 'John'), member('m-mary', 'Mary'), member('m-amy', 'Amy')];

  it('matches an exact (single-word) name', () => {
    expect(matchTravellerIds(['Mary'], roster)).toEqual(['m-mary']);
  });
  it('matches a full document name against a first-name member', () => {
    expect(matchTravellerIds(['John Smith'], roster)).toEqual(['m-john']);
  });
  it('is case- and space-insensitive', () => {
    expect(matchTravellerIds(['  mARY  '], roster)).toEqual(['m-mary']);
  });
  it('returns [] when nothing matches', () => {
    expect(matchTravellerIds(['Zoe'], roster)).toEqual([]);
  });
  it('dedupes repeated names', () => {
    expect(matchTravellerIds(['John', 'John Smith'], roster)).toEqual(['m-john']);
  });
  it('handles an empty roster', () => {
    expect(matchTravellerIds(['John'], [])).toEqual([]);
  });
  it('is asymmetric: a single-token doc name does NOT match a fuller member name', () => {
    // member stored as "John Smith"; ticket says only "John" → no match (avoids false positives)
    expect(matchTravellerIds(['John'], [member('m-js', 'John Smith')])).toEqual([]);
  });
});

describe('unionTravellerIds', () => {
  it('dedupes the union across all three buckets and skips undefined', () => {
    const buckets = {
      travelSegments: [{ travellerIds: ['dad', 'mum'] }, { travellerIds: undefined }],
      accommodations: [{ travellerIds: ['mum', 'kid1'] }],
      transportation: [{ travellerIds: ['dad'] }],
    } as unknown as SegmentBuckets;
    expect(unionTravellerIds(buckets).sort()).toEqual(['dad', 'kid1', 'mum']);
  });
  it('returns [] when no segment has a list', () => {
    const buckets = {
      travelSegments: [{ travellerIds: undefined }],
      accommodations: [],
      transportation: [],
    } as unknown as SegmentBuckets;
    expect(unionTravellerIds(buckets)).toEqual([]);
  });
});
